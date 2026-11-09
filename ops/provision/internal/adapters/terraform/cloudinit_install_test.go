package terraform_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

// These tests guard the live-run defect of 2026-11-09: cloud-init runs `runcmd`
// with `/bin/sh` and no login environment, so HOME is unset, the upstream Nix
// installer aborted with `$HOME is not set`, the failure was swallowed by a list
// of independent runcmd entries, and a static `final_message` printed "bootstrap
// complete" over a host with no Nix.
//
// Everything here reads the tracked document. Nothing runs cloud-init, nothing
// contacts AWS, and nothing needs a credential.

// loadCloudInit reads the shipped document and returns its text plus the decoded
// top-level mapping, so a test can ask both textual and structural questions.
func loadCloudInit(t *testing.T) (string, map[string]any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(shippedCloudInit))
	if err != nil {
		t.Fatalf("read cloud-init: %v", err)
	}
	var document map[string]any
	if err := yaml.Unmarshal(raw, &document); err != nil {
		t.Fatalf("cloud-init is not valid YAML: %v", err)
	}
	return string(raw), document
}

// lineContaining returns the index of the single line holding substr, and fails
// when the substring is absent or ambiguous.
func lineContaining(t *testing.T, lines []string, substr string) int {
	t.Helper()
	found := -1
	for i, line := range lines {
		if !strings.Contains(line, substr) {
			continue
		}
		if found >= 0 {
			t.Fatalf("cloud-init holds %q on more than one line (%d and %d): the check below needs one", substr, found+1, i+1)
		}
		found = i
	}
	if found < 0 {
		t.Fatalf("cloud-init is missing %q", substr)
	}
	return found
}

// TestCloudInitNixInstallRunsWithExplicitHome is the regression test for the
// observed failure: the installer must be invoked with HOME (and USER) set, both
// in the shell that reaches it and on the invocation line itself.
func TestCloudInitNixInstallRunsWithExplicitHome(t *testing.T) {
	t.Parallel()
	document, _ := loadCloudInit(t)
	lines := strings.Split(document, "\n")

	installer := lineContaining(t, lines, "sh /tmp/nix-install.sh")

	// The environment is exported before the installer runs, so every step below
	// it (and any step added later) inherits it.
	exported := regexp.MustCompile(`^(export )?HOME=/root$`)
	homeExportedAt := -1
	for i := 0; i < installer; i++ {
		if exported.MatchString(strings.TrimSpace(lines[i])) {
			homeExportedAt = i
			break
		}
	}
	if homeExportedAt < 0 {
		t.Fatalf("cloud-init does not export HOME=/root before line %d (the Nix installer runs with no login environment and aborts with `$HOME is not set`)", installer+1)
	}
	if !regexp.MustCompile(`^(export )?USER=root$`).MatchString(strings.TrimSpace(lines[homeExportedAt+1])) &&
		!regexp.MustCompile(`^(export )?USER=root$`).MatchString(strings.TrimSpace(lines[homeExportedAt+2])) {
		t.Fatalf("cloud-init does not export USER=root next to HOME=/root at line %d", homeExportedAt+1)
	}

	// And on the invocation line itself: the installer is the step that reads it,
	// so splitting these steps again must not silently drop the environment.
	if !strings.Contains(lines[installer], "HOME=/root") {
		t.Fatalf("the Nix installer line does not carry HOME=...: %q", strings.TrimSpace(lines[installer]))
	}
	if !strings.Contains(lines[installer], "USER=root") {
		t.Fatalf("the Nix installer line does not carry USER=...: %q", strings.TrimSpace(lines[installer]))
	}

	// Multi-user (daemon) mode is unchanged.
	if !strings.Contains(lines[installer], "--daemon") {
		t.Fatalf("the Nix installer lost --daemon (the host needs the multi-user daemon): %q", strings.TrimSpace(lines[installer]))
	}
}

// TestCloudInitNixInstallIsVerifiedAfterInstall proves a Nix install that did not
// deliver a client fails the boot instead of leaving a host that reports healthy.
func TestCloudInitNixInstallIsVerifiedAfterInstall(t *testing.T) {
	t.Parallel()
	document, _ := loadCloudInit(t)
	lines := strings.Split(document, "\n")

	installer := lineContaining(t, lines, "sh /tmp/nix-install.sh")
	presence := lineContaining(t, lines, "command -v nix")
	version := lineContaining(t, lines, "nix --version")
	if presence < installer {
		t.Fatalf("`command -v nix` is on line %d, before the installer on line %d: it cannot verify anything", presence+1, installer+1)
	}
	if version < installer {
		t.Fatalf("`nix --version` is on line %d, before the installer on line %d: it cannot verify anything", version+1, installer+1)
	}

	// With `set -e` in force, a failing check ends the boot. Without it the check
	// is decoration, which is exactly how the original failure was hidden.
	if !strings.Contains(document, "set -euo pipefail") {
		t.Fatal("cloud-init does not run the bootstrap under `set -euo pipefail`, so a failed step cannot fail the boot")
	}

	// A swallowed failure (`|| true`, `; exit 0`) is the same defect wearing a
	// different hat.
	for i, line := range lines {
		for _, swallow := range []string{"|| true", "|| :", "|| exit 0"} {
			if strings.Contains(line, swallow) {
				t.Fatalf("cloud-init line %d swallows a failure with %q: %q", i+1, swallow, strings.TrimSpace(line))
			}
		}
	}
}

// TestCloudInitHasNoUnconditionalSuccessMessage is the other half of the live
// defect: `final_message` prints whether or not the runcmd block succeeded, so the
// success report has to live inside the guarded script, after the checks.
func TestCloudInitHasNoUnconditionalSuccessMessage(t *testing.T) {
	t.Parallel()
	document, decoded := loadCloudInit(t)
	lines := strings.Split(document, "\n")

	if _, ok := decoded["final_message"]; ok {
		t.Fatal("cloud-init sets final_message, which is printed even when runcmd fails: the success report must be the last command of the guarded script")
	}
	if strings.Contains(document, "final_message") {
		t.Fatal("cloud-init mentions final_message; remove the static success report entirely")
	}

	// The success report exists, but only as the final line of the bootstrap: it
	// is reached only after every check above passed.
	report := lineContaining(t, lines, "bootstrap complete")
	for _, guard := range []string{"command -v nix", "nix --version", "snap install aws-cli"} {
		if at := lineContaining(t, lines, guard); report < at {
			t.Fatalf("the success report on line %d prints before %q on line %d", report+1, guard, at+1)
		}
	}

	// One runcmd shell, so `set -euo pipefail` covers every step. A list of
	// independent entries is what let the installer failure be swallowed.
	entry, ok := decoded["runcmd"].([]any)
	if !ok || len(entry) != 1 {
		t.Fatalf("runcmd must be exactly one shell block so `set -e` covers every step, got %d entries", len(entry))
	}
	if _, ok := entry[0].(string); !ok {
		t.Fatalf("runcmd entry must be a block-scalar string, got %T", entry[0])
	}
}

// TestCloudInitHoldsNoSecretOrPrivateKeyMaterial keeps the document public: it is
// passed as EC2 user data, it is visible in instance metadata, and it is read
// into a Terraform run directory per host.
func TestCloudInitHoldsNoSecretOrPrivateKeyMaterial(t *testing.T) {
	t.Parallel()
	document, _ := loadCloudInit(t)

	for _, forbidden := range []string{
		"BEGIN OPENSSH PRIVATE KEY",
		"BEGIN RSA PRIVATE KEY",
		"BEGIN EC PRIVATE KEY",
		"BEGIN PRIVATE KEY",
		"PRIVATE KEY-----",
		"tskey-",
		"--auth-key",
		"--advertise-tags",
		"client_secret",
		"client-secret",
		"aws_secret_access_key",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_ACCESS_KEY_ID",
		"aws_access_key_id",
		"AKIA",
		"fleet-enroll.key",
		"get-parameter",
		"Authorization:",
		"PASSWORD=",
		"PASSWORD:",
		"TOKEN=",
		"SECRET=",
		"Bearer ",
	} {
		if strings.Contains(document, forbidden) {
			t.Fatalf("cloud-init must not contain %q: it is public user data", forbidden)
		}
	}
}

// TestCloudInitKeepsBootstrapStepOrder pins the order the reviewed bootstrap has:
// Nix, then the tailscaled unit, then the AWS CLI the enrollment script needs.
func TestCloudInitKeepsBootstrapStepOrder(t *testing.T) {
	t.Parallel()
	document, _ := loadCloudInit(t)
	lines := strings.Split(document, "\n")

	nix := lineContaining(t, lines, "sh /tmp/nix-install.sh")
	tailscale := lineContaining(t, lines, "sh /tmp/tailscale-install.sh")
	awscli := lineContaining(t, lines, "snap install aws-cli --classic")

	if !(nix < tailscale && tailscale < awscli) {
		t.Fatalf("bootstrap step order changed: nix line %d, tailscaled line %d, aws-cli line %d (expected nix < tailscaled < aws-cli)",
			nix+1, tailscale+1, awscli+1)
	}

	// The tailscaled step still ends with the socket readiness probe, and the CLI
	// is still verified after it is installed.
	for _, required := range []string{
		"systemctl enable tailscaled",
		"systemctl start tailscaled",
		"/var/run/tailscale/tailscaled.sock",
		"aws --version",
	} {
		if !strings.Contains(document, required) {
			t.Fatalf("cloud-init is missing %q", required)
		}
	}
	if lineContaining(t, lines, "aws --version") < awscli {
		t.Fatal("aws --version runs before snap install aws-cli: the check cannot fail the boot for a missing CLI")
	}
}
