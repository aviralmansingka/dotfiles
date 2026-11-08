package terraform_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/terraform"
)

// TestExecRunnerPassesArgumentsWithoutAShell proves the real runner hands the
// operating system an argument array. If a shell were involved, the metacharacters
// below would expand or split.
func TestExecRunnerPassesArgumentsWithoutAShell(t *testing.T) {
	t.Parallel()
	echo := "/bin/echo"
	if _, err := os.Stat(echo); err != nil {
		t.Skipf("%s is not available on this host", echo)
	}
	hostile := []string{
		"a; rm -rf /tmp/should-not-exist",
		"$(id)",
		"`id`",
		"two words stay one argument",
		"| cat",
		"> /tmp/should-not-exist",
		"&& echo pwned",
	}
	result, err := terraform.ExecRunner{}.Run(context.Background(), terraform.Command{
		Name: echo,
		Args: hostile,
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := strings.Join(hostile, " ") + "\n"
	if result.Stdout != want {
		t.Fatalf("stdout = %q, want the literal arguments %q", result.Stdout, want)
	}
	if _, statErr := os.Stat("/tmp/should-not-exist"); statErr == nil {
		t.Fatal("a redirection argument was interpreted by a shell")
	}
}

// TestExecRunnerReportsExitStatus proves a failing command is reported as an
// error, so a failed Terraform step can never look like a success.
func TestExecRunnerReportsExitStatus(t *testing.T) {
	t.Parallel()
	sh := "/bin/sh"
	if _, err := os.Stat(sh); err != nil {
		t.Skipf("%s is not available on this host", sh)
	}
	result, err := terraform.ExecRunner{}.Run(context.Background(), terraform.Command{
		Name: sh,
		Args: []string{"-c", "echo boom >&2; exit 3"},
	})
	if err == nil {
		t.Fatal("Run reported success for exit status 3")
	}
	if !strings.Contains(result.Stderr, "boom") {
		t.Fatalf("stderr = %q, want the failure text", result.Stderr)
	}
}
