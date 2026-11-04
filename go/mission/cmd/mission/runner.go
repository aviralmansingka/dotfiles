package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"mission.local/prototype/internal/domain/mission"
)

// The parent retains ownership until Wait proves that the tracked process exited.
// Children must stay in the foreground: a detached writer cannot be tracked by this prototype.
func runAgent(s *Store, handle, agent, cwd string, argv []string) (record mission.Record, err error) {
	if len(argv) == 0 {
		return mission.Record{}, mission.Problem("usage", "run requires -- COMMAND ARGS...")
	}
	c, e := s.claim(handle, agent, "", cwd, true)
	if e != nil {
		return mission.Record{}, e
	}
	started := false
	defer func() {
		if !started && err != nil {
			_, _ = s.finish(handle, c.Attempt.ID, c.Token, true, "Launch setup failed: "+err.Error(), true, 127)
		}
	}()
	output := artifactPath(s, c)
	if e = os.MkdirAll(filepath.Dir(output), 0700); e != nil {
		return mission.Record{}, e
	}
	brief := filepath.Join(filepath.Dir(output), "brief.md")
	if e = atomicWrite(brief, []byte(c.Attempt.Brief)); e != nil {
		return mission.Record{}, e
	}
	log, e := os.OpenFile(filepath.Join(filepath.Dir(output), "session.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return mission.Record{}, e
	}
	defer log.Close()
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = c.Attempt.Cwd
	cmd.Env = os.Environ()
	exe, _ := os.Executable()
	c.Environment["MISSION_BIN"] = exe
	c.Environment["MISSION_BRIEF"] = brief
	c.Environment["MISSION_STEP"] = c.Step.ID
	for k, v := range c.Environment {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.Stdin = os.Stdin
	cmd.Stdout = io.MultiWriter(os.Stderr, log)
	cmd.Stderr = io.MultiWriter(os.Stderr, log)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = 3 * time.Second
	if e = cmd.Start(); e != nil {
		r, fe := s.finish(handle, c.Attempt.ID, c.Token, true, "Process did not start: "+e.Error(), true, 127)
		if fe != nil {
			return r, fe
		}
		return r, mission.Problem("process_start_failed", "%v", e)
	}
	started = true
	_, recordErr := s.mutate(handle, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
		if e != nil {
			return e
		}
		a.PID = cmd.Process.Pid
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "process-start", At: mission.Now(), Summary: fmt.Sprintf("Tracked process %d started", a.PID)})
		return nil
	})
	sigs := make(chan os.Signal, 2)
	done := make(chan struct{})
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		select {
		case <-sigs:
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
		case <-done:
		}
	}()
	if recordErr != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	}
	waitErr := cmd.Wait()
	close(done)
	signal.Stop(sigs)
	_ = log.Sync()
	code := 0
	if waitErr != nil {
		code = 1
		if x, ok := waitErr.(*exec.ExitError); ok {
			code = x.ExitCode()
		}
	}
	// Commit exit evidence before checking the artifact. A missing artifact must not erase process facts.
	_, e = s.mutate(handle, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
		if e != nil {
			return e
		}
		a.ProcessExited = true
		a.ExitCode = code
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "process-exit", At: mission.Now(), Summary: fmt.Sprintf("Wait observed exit %d", code)})
		return nil
	})
	if e != nil {
		return mission.Record{}, e
	}
	if syscall.Kill(-cmd.Process.Pid, 0) == nil {
		_, _ = s.hook(handle, c.Attempt.ID, c.Token, mission.Event{Type: "question", Summary: "Tracked process exited but its process group still exists. Ownership retained; inspect descendants before reconciliation."})
		return mission.Record{}, mission.Problem("needs_reconciliation", "tracked process exited, but descendants remain in process group %d; attempt ownership retained", cmd.Process.Pid)
	}
	r, e := s.finish(handle, c.Attempt.ID, c.Token, waitErr != nil || recordErr != nil, "Run wrapper observed process exit", true, code)
	if e != nil {
		original := e
		_, fe := s.finish(handle, c.Attempt.ID, c.Token, true, "Completion rejected: "+e.Error(), true, code)
		if fe != nil {
			return r, mission.Problem("needs_reconciliation", "process exited; attempt remains held: %v; original error: %v", fe, original)
		}
		return r, original
	}
	if recordErr != nil {
		return r, recordErr
	}
	if waitErr != nil {
		return r, mission.Problem("process_failed", "agent process exited with code %d", code)
	}
	if r.State.Status == "failed" {
		return r, mission.Problem("agent_reported_failure", "agent reported failure before its process exited")
	}
	return r, nil
}
