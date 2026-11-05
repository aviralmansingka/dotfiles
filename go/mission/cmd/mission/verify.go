package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// cappedOutput keeps the first 1 MiB a check writes. The buffer is a field, not
// an embedded bytes.Buffer: embedding would promote ReadFrom, and io.Copy, which
// os/exec uses for a pipe, prefers a ReaderFrom destination over Write, which
// bypasses the cap.
type cappedOutput struct {
	buf       bytes.Buffer
	truncated bool
}

func (b *cappedOutput) Bytes() []byte { return b.buf.Bytes() }

// checkRun reports what one check process did: the facts every check turns into
// a verdict.
type checkRun struct {
	exit      int // process exit code; meaningful only when exited is true
	exited    bool
	err       error
	deadline  bool
	leftover  bool
	truncated bool
	log       []byte
}

// runGrouped runs one required check in the attempt checkout under the shared
// two-minute deadline, 1 MiB output cap, and process-group kill. go-test and
// cmd: checks both come through here, so neither can drift from that contract.
func runGrouped(cwd string, env []string, command ...string) checkRun {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	c := exec.CommandContext(ctx, command[0], command[1:]...)
	c.Dir = cwd
	if env == nil {
		env = os.Environ()
	}
	c.Env = env
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	c.WaitDelay = 3 * time.Second
	c.Cancel = func() error {
		if c.Process == nil {
			return nil
		}
		return syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
	}
	var log cappedOutput
	c.Stdout = &log
	c.Stderr = &log
	e := c.Run()
	v := checkRun{exit: -1, err: e, deadline: ctx.Err() != nil, truncated: log.truncated, log: log.Bytes()}
	if c.Process != nil && syscall.Kill(-c.Process.Pid, 0) == nil {
		_ = syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
		v.leftover = true
		return v
	}
	var exit *exec.ExitError
	if errors.As(e, &exit) {
		v.exited, v.exit = true, exit.ExitCode()
	}
	return v
}

func goTest(cwd string) (string, string, []byte) {
	v := runGrouped(cwd, append(os.Environ(), "GOTOOLCHAIN=local"), "go", "test", "./...")
	if v.leftover {
		return "inconclusive", "Test process left background work; group stopped", v.log
	}
	if v.deadline {
		return "inconclusive", "Go tests exceeded the two-minute deadline", v.log
	}
	if v.exited {
		return "failed", fmt.Sprintf("go test ./... exited %d", v.exit), v.log
	}
	if v.err != nil {
		return "inconclusive", "Could not run Go tests: " + v.err.Error(), v.log
	}
	summary := "go test ./... passed"
	if v.truncated {
		summary += "; log truncated at 1 MiB"
	}
	return "passed", summary, v.log
}

// cmdCheck runs a cmd: check's body through sh -c in the attempt checkout. It
// reports the same verdicts as go-test: passed on exit 0, failed with the exit
// code in the summary, and inconclusive when the deadline stops the process.
func cmdCheck(name, cwd string) (string, string, []byte) {
	body := strings.TrimSpace(strings.TrimPrefix(name, cmdCheckPrefix))
	v := runGrouped(cwd, nil, "sh", "-c", body)
	if v.leftover {
		return "inconclusive", "Check process left background work; group stopped", v.log
	}
	if v.deadline {
		return "inconclusive", name + " exceeded the two-minute deadline", v.log
	}
	if v.exited {
		return "failed", fmt.Sprintf("%s exited %d", name, v.exit), v.log
	}
	if v.err != nil {
		return "inconclusive", "Could not run " + name + ": " + v.err.Error(), v.log
	}
	summary := name + " passed"
	if v.truncated {
		summary += "; log truncated at 1 MiB"
	}
	return "passed", summary, v.log
}
func (s *Store) verify(h, id, token string) (mission.Record, error) {
	var current mission.Record
	var attempt mission.Attempt
	var st mission.Step
	var before subjectSnapshot
	run := mission.Verification{ID: mission.UID("verify-"), Started: mission.Now(), Runner: "mission/checks@" + platform.Machine()}
	_, e := s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		if !mission.Active(*a) || r.State.Active != id {
			return mission.Problem("stale_attempt", "only the active attempt can run checks")
		}
		if a.Verifying != "" {
			return mission.Problem("verification_busy", "check run %s already owns verification; inspect an interrupted runner before recovery", a.Verifying)
		}
		d, _ := s.dir(h)
		b, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if mission.Digest(b) != a.SpecHash {
			return mission.Problem("brief_changed", "mission changed since this attempt started")
		}
		st = attemptDefinition(*r, *a)
		before = s.subject(*r, *a, st)
		run.SubjectHash = before.Hash
		run.DefinitionHash = definitionHash(st)
		for _, name := range mission.StepChecks(st) {
			run.Results = append(run.Results, mission.CheckResult{Check: name, Version: "1", Verdict: "not_run", At: run.Started, Summary: "Check has not run"})
		}
		a.Verifying = run.ID
		a.Verifications = append(a.Verifications, run)
		attempt = *a
		current = *r
		return nil
	})
	if e != nil {
		return current, e
	}
	// Check processes run without the vault lock so other missions can make progress.
	logs := executeChecks(st, attempt.Cwd, before, &run)
	return s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		if a.Verifying != run.ID || r.State.Active != id {
			return mission.Problem("stale_attempt", "verification no longer owns this attempt")
		}
		return s.recordVerification(r, a, st, &run, before, logs)
	})
}

// executeChecks runs the required checks on one frozen subject snapshot.
func executeChecks(st mission.Step, cwd string, before subjectSnapshot, run *mission.Verification) [][]byte {
	logs := make([][]byte, len(run.Results))
	blocked := false
	for i := range run.Results {
		res := &run.Results[i]
		res.At = mission.Now()
		if blocked {
			res.Summary = "Earlier required check did not pass"
			continue
		}
		res.Verdict = "passed"
		switch res.Check {
		case "nonempty-artifact":
			if before.ArtifactErr != nil {
				res.Verdict = "failed"
				res.Summary = "Result unavailable: " + before.ArtifactErr.Error()
			} else if !utf8.Valid(before.Artifact) || len(bytes.TrimSpace(before.Artifact)) == 0 {
				res.Verdict = "failed"
				res.Summary = "Result must contain non-whitespace UTF-8 text"
			} else {
				res.Summary = "Nonempty UTF-8 result exists"
			}
		case "json-valid":
			if !json.Valid(before.Artifact) {
				res.Verdict = "failed"
				res.Summary = "Result is not one valid JSON value"
			} else {
				res.Summary = "Result parses as one JSON value"
			}
		case "go-test":
			module, e := moduleRoot(cwd)
			if before.RepoErr != nil {
				res.Verdict = "inconclusive"
				res.Summary = before.RepoErr.Error()
			} else if e != nil {
				res.Verdict, res.Summary = "inconclusive", e.Error()
			} else {
				res.Verdict, res.Summary, logs[i] = goTest(module)
			}
		default:
			if strings.HasPrefix(res.Check, cmdCheckPrefix) {
				res.Verdict, res.Summary, logs[i] = cmdCheck(res.Check, cwd)
			}
		}
		if res.Verdict != "passed" {
			blocked = true
		}
	}
	return logs
}

// recordVerification finalizes one check run on an attempt.
func (s *Store) recordVerification(r *mission.Record, a *mission.Attempt, st mission.Step, run *mission.Verification, before subjectSnapshot, logs [][]byte) error {
	after := s.subject(*r, *a, st)
	if after.Hash != before.Hash {
		for i := range run.Results {
			if run.Results[i].Verdict == "passed" {
				run.Results[i].Verdict = "inconclusive"
				run.Results[i].Summary = "Checked input changed during verification; rerun checks"
			}
		}
	}
	run.Ended = mission.Now()
	for i := range run.Results {
		res := &run.Results[i]
		rel := filepath.ToSlash(filepath.Join("artifacts", fmt.Sprintf("%03d", a.Sequence), "checks", run.ID, checkLogName(res.Check)))
		p, e := s.path(r.Mission.Repo, r.Mission.Slug, rel)
		if e != nil {
			return e
		}
		b := []byte(fmt.Sprintf("check: %s\nversion: %s\nverdict: %s\nsubject: %s\nrunner: %s\nsummary: %s\n\n", res.Check, res.Version, res.Verdict, run.SubjectHash, run.Runner, res.Summary))
		b = append(b, logs[i]...)
		if e = atomicWrite(p, b); e != nil {
			return e
		}
		res.Evidence = []mission.Evidence{{Path: rel, Hash: mission.Digest(b)}}
		if before.ArtifactErr == nil {
			res.Evidence = append(res.Evidence, mission.Evidence{Path: a.Artifact, Hash: before.ArtifactHash})
		}
	}
	for i := range a.Verifications {
		if a.Verifications[i].ID == run.ID {
			a.Verifications[i] = *run
		}
	}
	a.Verifying = ""
	a.Updated = mission.Now()
	a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "checks-completed", At: mission.Now(), Summary: verificationSummary(*run)})
	return nil
}

// checkLogName turns a check name into one safe evidence log file name. A cmd:
// name is free text and can hold spaces or slashes, which must not become a path
// or a missing directory; a name that sanitization changed carries a digest tail
// so two different commands can never share one log.
func checkLogName(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	if safe := b.String(); safe != name {
		return safe + "-" + strings.TrimPrefix(mission.Digest([]byte(name)), "sha256:")[:8] + ".log"
	}
	return b.String() + ".log"
}

func (b *cappedOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := (1 << 20) - b.buf.Len()
	if remaining > 0 {
		_, _ = b.buf.Write(p[:min(n, remaining)])
	}
	if n > remaining {
		b.truncated = true
	}
	return n, nil
}
