// Package checks is the mission checks as this machine runs them.
//
// It owns the two facts a check run cannot learn from the ledger: the
// fingerprint of an attempt's checkout, and the presets that start a process —
// go-test and cmd: — with their two-minute deadline, 1 MiB output cap, and
// process-group kill. The core owns the run itself: the order, the before and
// after fingerprint bracket, and the record. The verdicts, the summaries, and
// the log bytes are this package's, because they are the facts about a process
// that ran here.
package checks

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// Runner is the mission.Checker adapter. It holds no state: every run reads the
// checkout it is given.
type Runner struct{}

// New returns the checker the mission core runs on this host.
func New() *Runner { return &Runner{} }

// Fingerprint completes one snapshot of an attempt's input. The artifact facts
// arrive already read, so reading the result stays with the ledger; this adds
// the repository facts and the hash over both. A checkout that cannot be
// fingerprinted is not an error here: it is RepoErr on the snapshot, and the
// check that needs it turns inconclusive, which is what the ledger records.
func (r *Runner) Fingerprint(a mission.Attempt, st mission.Step, snap mission.Snapshot) (mission.Snapshot, error) {
	value := snap.ArtifactHash
	if snap.ArtifactErr != nil {
		value = "unavailable:" + snap.ArtifactErr.Error()
	}
	values := []string{a.ID, mission.DefinitionHash(st), value}
	goTestDeclared, cmdDeclared := false, false
	for _, name := range mission.StepChecks(st) {
		if name == mission.CheckGoTest {
			goTestDeclared = true
		}
		if strings.HasPrefix(name, mission.CmdCheckPrefix) {
			cmdDeclared = true
		}
	}
	if goTestDeclared || cmdDeclared {
		// A cmd: check binds to the same repository fingerprint as go-test, so a
		// change to the checkout invalidates its evidence too. Only go-test owns
		// RepoErr; a cmd: check runs in any checkout it is given.
		h, e := repositoryHash(a.Cwd)
		if goTestDeclared {
			snap.RepoErr = e
		}
		if e != nil {
			h = "unavailable:" + e.Error()
		}
		values = append(values, h)
	}
	snap.Hash = mission.Digest([]byte(strings.Join(values, "\n")))
	return snap, nil
}

// Run executes one process preset in the attempt checkout. A name this adapter
// does not own is an error, not a verdict: the core judges the pure presets and
// the mission definition refuses a name nothing can run.
func (r *Runner) Run(name, cwd string, snap mission.Snapshot) (mission.CheckResult, []byte, error) {
	res := mission.CheckResult{Check: name, Version: "1"}
	switch {
	case name == mission.CheckGoTest:
		verdict, summary, log := goTestCheck(cwd, snap)
		res.Verdict, res.Summary = verdict, summary
		return res, log, nil
	case strings.HasPrefix(name, mission.CmdCheckPrefix):
		verdict, summary, log := cmdCheck(name, cwd)
		res.Verdict, res.Summary = verdict, summary
		return res, log, nil
	}
	return res, nil, fmt.Errorf("unknown check %q", name)
}

// moduleRoot finds the one Go module inside an attempt checkout. The go-test
// fingerprint and the test run both scope to it: a file outside the module, such
// as a stow symlink elsewhere in the checkout, cannot block the check.
func moduleRoot(cwd string) (string, error) {
	var found []string
	e := filepath.WalkDir(cwd, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "node_modules", "vendor":
				return fs.SkipDir
			}
			return nil
		}
		if d.Name() == "go.mod" {
			found = append(found, filepath.Dir(p))
		}
		return nil
	})
	if e != nil {
		return "", e
	}
	switch len(found) {
	case 0:
		return "", fmt.Errorf("go-test requires a go.mod inside the checkout")
	case 1:
		return found[0], nil
	}
	sort.Strings(found)
	return "", fmt.Errorf("go-test found %d Go modules in the checkout; keep one", len(found))
}

func repositoryHash(cwd string) (string, error) {
	top, e := exec.Command("git", "-C", cwd, "rev-parse", "--show-toplevel").Output()
	if e != nil {
		return "", fmt.Errorf("go-test evidence requires a Git checkout")
	}
	root, e := filepath.EvalSymlinks(strings.TrimSpace(string(top)))
	if e != nil || root != cwd {
		return "", fmt.Errorf("go-test requires the Git checkout root as the attempt cwd")
	}
	module, e := moduleRoot(cwd)
	if e != nil {
		return "", e
	}
	rel, e := filepath.Rel(cwd, module)
	if e != nil {
		return "", e
	}
	args := []string{"ls-files", "-z", "--cached", "--others", "--exclude-standard"}
	if rel != "." {
		args = append(args, "--", filepath.ToSlash(rel))
	}
	c := exec.Command("git", append([]string{"-C", cwd}, args...)...)
	b, e := c.Output()
	if e != nil {
		return "", fmt.Errorf("go-test evidence requires a Git checkout")
	}
	files := strings.Split(strings.TrimSuffix(string(b), "\x00"), "\x00")
	sort.Strings(files)
	if len(files) > 10000 {
		return "", fmt.Errorf("source snapshot exceeds 10000 files")
	}
	var tree bytes.Buffer
	var total int64
	for _, name := range files {
		if name == "" {
			continue
		}
		p := filepath.Join(cwd, filepath.FromSlash(name))
		inside, e := filepath.Rel(module, p)
		if e != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(os.PathSeparator)) {
			return "", fmt.Errorf("source path escapes the Go module")
		}
		name = filepath.ToSlash(inside)
		st, e := os.Lstat(p)
		if os.IsNotExist(e) {
			fmt.Fprintf(&tree, "%s\x00deleted\n", name)
			continue
		}
		if e != nil {
			return "", e
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("source snapshot contains symlink %s; cannot establish a complete input fingerprint", name)
		}
		if !st.Mode().IsRegular() {
			return "", fmt.Errorf("cannot snapshot %s", name)
		}
		total += st.Size()
		if total > 64<<20 {
			return "", fmt.Errorf("source snapshot exceeds 64 MiB")
		}
		b, e := platform.BoundedFile(p, 16<<20)
		if e != nil {
			return "", e
		}
		fmt.Fprintf(&tree, "%s\x00%s\x00%s\n", name, st.Mode(), mission.Digest(b))
	}
	return mission.Digest(tree.Bytes()), nil
}

// cappedOutput keeps the first 1 MiB a check writes. The buffer is a field, not
// an embedded bytes.Buffer: embedding would promote ReadFrom, and io.Copy, which
// os/exec uses for a pipe, prefers a ReaderFrom destination over Write, which
// bypasses the cap.
type cappedOutput struct {
	buf       bytes.Buffer
	truncated bool
}

func (b *cappedOutput) Bytes() []byte { return b.buf.Bytes() }

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

// goTestCheck judges one go-test preset: the module under the checkout is found
// first, then the snapshot's repository failure decides, exactly as the ledger
// recorded it before the port existed.
func goTestCheck(cwd string, snap mission.Snapshot) (string, string, []byte) {
	module, e := moduleRoot(cwd)
	if snap.RepoErr != nil {
		return "inconclusive", snap.RepoErr.Error(), nil
	}
	if e != nil {
		return "inconclusive", e.Error(), nil
	}
	v := runGrouped(module, append(os.Environ(), "GOTOOLCHAIN=local"), "go", "test", "./...")
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
	body := strings.TrimSpace(strings.TrimPrefix(name, mission.CmdCheckPrefix))
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
