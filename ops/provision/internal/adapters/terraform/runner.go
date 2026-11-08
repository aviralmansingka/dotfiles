package terraform

import (
	"bytes"
	"context"
	"os"
	"os/exec"
)

// Command is one Terraform subprocess.
//
// Args is an argument array. The runner passes it straight to the operating
// system, so there is no command line to interpolate into: a value that
// contains a space, a semicolon, a quote, or a `$` stays one argument and can
// never become a second command, a redirection, or a pipeline.
type Command struct {
	// Dir is the working directory: one per host.
	Dir string
	// Name is the executable, resolved on PATH.
	Name string
	// Args is the argument array, one element per argument.
	Args []string
	// Env is appended to the inherited environment as KEY=VALUE entries.
	Env []string
}

// Result is a completed invocation's output.
type Result struct {
	Stdout string
	Stderr string
}

// CommandRunner runs one command. Tests substitute a recording fake, so the
// adapter's exact argument arrays are asserted without a process, a network, or
// a cloud account.
type CommandRunner interface {
	Run(ctx context.Context, cmd Command) (Result, error)
}

// ExecRunner runs commands with os/exec. It never invokes a shell.
type ExecRunner struct{}

var _ CommandRunner = ExecRunner{}

// Run implements CommandRunner.
func (ExecRunner) Run(ctx context.Context, cmd Command) (Result, error) {
	process := exec.CommandContext(ctx, cmd.Name, cmd.Args...)
	process.Dir = cmd.Dir
	process.Env = append(os.Environ(), cmd.Env...)
	var stdout, stderr bytes.Buffer
	process.Stdout = &stdout
	process.Stderr = &stderr
	err := process.Run()
	return Result{Stdout: stdout.String(), Stderr: stderr.String()}, err
}
