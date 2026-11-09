package ssm

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// maxCapturedOutput bounds captured stdout/stderr so one verbose CLI failure
// cannot exhaust worker memory.
const maxCapturedOutput = 64 << 10

// Command is one AWS CLI invocation.
//
// Args is an argument array. The executor passes it straight to the operating
// system, so there is no command line to interpolate into: a value that contains
// a space, a semicolon, a quote, or a `$` stays one argument and can never become
// a second command, a redirection, or a pipeline. An SSM command's script never
// travels in this array; it goes in a JSON input file.
type Command struct {
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

// Executor runs one command. Tests substitute a recording fake, so the adapter's
// exact argument arrays are asserted without a process and without an account.
type Executor interface {
	Exec(ctx context.Context, cmd Command) (Result, error)
}

// CLIExecutor runs commands with os/exec. It never invokes a shell.
type CLIExecutor struct{}

var _ Executor = CLIExecutor{}

// Exec implements Executor.
func (CLIExecutor) Exec(ctx context.Context, cmd Command) (Result, error) {
	process := exec.CommandContext(ctx, cmd.Name, cmd.Args...)
	process.Env = append(os.Environ(), cmd.Env...)
	stdout := &limitedBuffer{limit: maxCapturedOutput}
	stderr := &limitedBuffer{limit: maxCapturedOutput}
	process.Stdout = stdout
	process.Stderr = stderr
	err := process.Run()
	return Result{Stdout: stdout.String(), Stderr: stderr.String()}, err
}

// limitedBuffer keeps at most limit bytes and discards the rest.
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

// ClientConfig configures the one AWS CLI binding every SSM call in this package
// uses. There is deliberately no credential field: the CLI runs with the worker's
// own credential source, and no token is ever read here.
type ClientConfig struct {
	// Binary is the AWS CLI executable. Defaults to "aws".
	Binary string
	// Region is the region of every call. Defaults to DefaultRegion.
	Region string
	// Executor runs the CLI. Defaults to CLIExecutor.
	Executor Executor
}

// Client is the AWS CLI binding. Every argument array it builds is asserted by
// the tests, and none of them ever carries a credential value.
type Client struct {
	binary   string
	region   string
	executor Executor
}

// NewClient validates the configuration and builds the binding.
func NewClient(cfg ClientConfig) (*Client, error) {
	binary := cfg.Binary
	if binary == "" {
		binary = DefaultBinary
	}
	if strings.ContainsAny(binary, `/\ `) {
		return nil, fmt.Errorf("ssm: binary %q must be a bare executable name", binary)
	}
	region := cfg.Region
	if region == "" {
		region = DefaultRegion
	}
	if err := domain.ValidateAWSRegion(region); err != nil {
		return nil, fmt.Errorf("ssm: region: %w", err)
	}
	executor := cfg.Executor
	if executor == nil {
		executor = CLIExecutor{}
	}
	return &Client{binary: binary, region: region, executor: executor}, nil
}

// Region reports the region every call is made in.
func (c *Client) Region() string { return c.region }

// env pins the region and disables the interactive pager. Nothing else is
// injected: the CLI's credential source is the worker's own.
func (c *Client) env() []string {
	return []string{
		"AWS_DEFAULT_REGION=" + c.region,
		// An empty pager value disables paging, so a call can never block on a
		// terminal that is not there.
		"AWS_PAGER=",
	}
}

// run executes one `aws <service> <operation> ...` call and returns the result.
// A non-zero exit is reported as an error carrying bounded, sanitized stderr;
// stdout is never echoed, because one of these calls reads a parameter value.
func (c *Client) run(ctx context.Context, args ...string) (Result, error) {
	result, err := c.executor.Exec(ctx, Command{Name: c.binary, Args: args, Env: c.env()})
	if err != nil {
		step := "aws"
		if len(args) > 1 {
			step = "aws " + args[0] + " " + args[1]
		}
		detail := domain.SanitizeMessage(result.Stderr)
		if detail == "operation failed" {
			detail = domain.SanitizeMessage(err.Error())
		}
		return result, fmt.Errorf("%s: %w: %s", step, err, detail)
	}
	return result, nil
}

// notFound reports whether an error is the CLI's "does not exist" answer, which
// for a delete is success and for a poll is "not yet".
func notFound(err error, needles ...string) bool {
	if err == nil {
		return false
	}
	text := err.Error()
	for _, needle := range needles {
		if strings.Contains(text, needle) {
			return true
		}
	}
	return false
}
