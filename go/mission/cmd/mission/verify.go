package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func (s *App) verify(h, id, token string) (mission.Record, error) {
	var current mission.Record
	var attempt mission.Attempt
	var st mission.Step
	var before mission.Snapshot
	run := mission.Verification{ID: mission.UID("verify-"), Started: mission.Now(), Runner: "mission/checks@" + platform.Machine()}
	_, e := s.update(h, func(r *mission.Record) error {
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
		d, _ := s.Repo.Dir(h)
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
		run.DefinitionHash = mission.DefinitionHash(st)
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
	logs := s.executeChecks(st, attempt.Cwd, before, &run)
	return s.update(h, func(r *mission.Record) error {
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
func (s *App) executeChecks(st mission.Step, cwd string, before mission.Snapshot, run *mission.Verification) [][]byte {
	logs := make([][]byte, len(run.Results))
	blocked := false
	for i := range run.Results {
		res := &run.Results[i]
		res.At = mission.Now()
		if blocked {
			res.Summary = mission.BlockedSummary
			continue
		}
		if verdict, summary, ok := mission.PureCheck(res.Check, before); ok {
			res.Verdict, res.Summary = verdict, summary
		} else if out, log, e := s.Checks.Run(res.Check, cwd, before); e != nil {
			res.Verdict, res.Summary = "inconclusive", e.Error()
		} else {
			res.Verdict, res.Summary, logs[i] = out.Verdict, out.Summary, log
		}
		if mission.Blocks(res.Verdict) {
			blocked = true
		}
	}
	return logs
}

// recordVerification finalizes one check run on an attempt.
func (s *App) recordVerification(r *mission.Record, a *mission.Attempt, st mission.Step, run *mission.Verification, before mission.Snapshot, logs [][]byte) error {
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
		p, e := s.Repo.Path(r.Mission.Repo, r.Mission.Slug, rel)
		if e != nil {
			return e
		}
		b := []byte(fmt.Sprintf("check: %s\nversion: %s\nverdict: %s\nsubject: %s\nrunner: %s\nsummary: %s\n\n", res.Check, res.Version, res.Verdict, run.SubjectHash, run.Runner, res.Summary))
		b = append(b, logs[i]...)
		if e = platform.AtomicWrite(p, b); e != nil {
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
	a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "checks-completed", At: mission.Now(), Summary: mission.VerificationSummary(*run)})
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
