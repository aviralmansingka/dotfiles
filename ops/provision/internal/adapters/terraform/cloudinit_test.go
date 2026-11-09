package terraform_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// shippedCloudInit is the bootstrap document the per-host Terraform root passes
// as EC2 user_data.
const shippedCloudInit = "../../../terraform/aws/cloud-init.yaml"

// TestShippedCloudInitInstallsTailscaledAndHoldsNoSecret covers the S03 bootstrap
// step: the system tailscaled install is an explicit cloud-init step, not a Home
// Manager fragment, and the document carries no credential of any kind.
func TestShippedCloudInitInstallsTailscaledAndHoldsNoSecret(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Clean(shippedCloudInit))
	if err != nil {
		t.Fatalf("read cloud-init: %v", err)
	}
	document := string(raw)

	// The daemon is installed and enabled as a system unit.
	for _, required := range []string{
		"tailscale.com/install.sh",
		"systemctl enable tailscaled",
		"systemctl start tailscaled",
		// The host reads its own enrollment parameter, so the CLI is a bootstrap
		// step and not an enrollment-time surprise.
		"snap install aws-cli --classic",
	} {
		if !strings.Contains(document, required) {
			t.Fatalf("cloud-init is missing %q", required)
		}
	}

	// No credential, no key, and no tag: enrollment happens later, out of band.
	for _, forbidden := range []string{
		"tskey-",
		"--auth-key",
		"fleet-enroll.key",
		"get-parameter",
		"OPENSSH PRIVATE KEY",
		"client_secret",
		"client-secret",
		"tag:aws-host",
		"Authorization:",
	} {
		if strings.Contains(document, forbidden) {
			t.Fatalf("cloud-init must not contain %q", forbidden)
		}
	}
	if strings.Contains(document, "home-manager") || strings.Contains(document, "homeConfigurations") {
		t.Fatal("the tailscaled install must be a system step, not a Home Manager fragment")
	}
}

// TestShippedCloudInitIsTheOnlyUserDataPath proves the Terraform root reads the
// documented bootstrap document rather than an inline blob, so the step above is
// the one a real host runs.
func TestShippedCloudInitIsTheOnlyUserDataPath(t *testing.T) {
	t.Parallel()
	mainTF, err := os.ReadFile(filepath.Clean("../../../terraform/aws/main.tf"))
	if err != nil {
		t.Fatalf("read main.tf: %v", err)
	}
	if !strings.Contains(string(mainTF), `user_data                   = file("${path.module}/cloud-init.yaml")`) {
		t.Fatal("main.tf must read cloud-init.yaml as user_data")
	}
}
