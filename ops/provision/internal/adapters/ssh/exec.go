package ssh

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

// maxCapturedOutput bounds captured stdout/stderr so a chatty or hostile host
// cannot exhaust worker memory.
const maxCapturedOutput = 64 << 10

// ExecRunner is the production application.SSHRunner: it starts the local OpenSSH
// client with an argv the adapter built and pipes stdin. It never reads a
// credential from the environment and never interpolates one into argv.
type ExecRunner struct {
	// Binary defaults to "ssh".
	Binary string
}

var _ application.SSHRunner = (*ExecRunner)(nil)

// Run implements application.SSHRunner. A non-zero ssh exit is reported in the
// result, not as an error: the caller decides what a refusal means.
func (r ExecRunner) Run(ctx context.Context, req application.SSHRunRequest) (application.SSHRunResult, error) {
	binary := r.Binary
	if binary == "" {
		binary = sshBinary
	}
	command := exec.CommandContext(ctx, binary, req.Args...)
	// A clean environment: nothing from this process can leak into the client.
	command.Env = []string{"HOME=/nonexistent", "LC_ALL=C"}
	if len(req.Stdin) > 0 {
		command.Stdin = bytes.NewReader(req.Stdin)
	}
	stdout := &limitedBuffer{limit: maxCapturedOutput}
	stderr := &limitedBuffer{limit: maxCapturedOutput}
	command.Stdout = stdout
	command.Stderr = stderr
	err := command.Run()
	result := application.SSHRunResult{Stdout: stdout.String(), Stderr: stderr.String()}
	if command.ProcessState != nil {
		result.ExitCode = command.ProcessState.ExitCode()
	}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
			return result, nil
		}
		return result, fmt.Errorf("ssh %s: %w", req.Label, err)
	}
	return result, nil
}

// limitedBuffer keeps at most limit bytes and discards the rest, so output
// capture cannot grow without bound.
type limitedBuffer struct {
	limit int
	buf   bytes.Buffer
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := b.limit - b.buf.Len()
	if remaining <= 0 {
		return len(p), nil
	}
	if len(p) > remaining {
		b.buf.Write(p[:remaining])
		return len(p), nil
	}
	b.buf.Write(p)
	return len(p), nil
}

func (b *limitedBuffer) String() string { return b.buf.String() }

var _ io.Writer = (*limitedBuffer)(nil)
