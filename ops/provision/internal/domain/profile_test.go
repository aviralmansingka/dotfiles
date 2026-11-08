package domain_test

import (
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// approvedProfile is a minimal valid profile; individual tests override one
// field so a failure names exactly the rule that broke.
func approvedProfile() domain.Profile {
	return domain.Profile{
		Name:        "rex",
		DisplayName: "Managed Rex host",
		Provider:    domain.ProviderAWS,
		Regions:     []string{"ap-south-1"},
		Sizes: map[string]domain.SizeSpec{
			"standard": {Name: "standard", InstanceType: "t3.medium", DiskGB: 40},
		},
		Tags:          map[string]string{"fleet-owner": "homelab"},
		SecretBundles: []string{"bao:secret/data/hosts/rex/canary"},
		FlakeRef:      ".#homeConfigurations.remote-mumbai.activationPackage",
	}
}

// TestValidateProfileAcceptsRealFlakeRefs is the D1 regression test: every shape
// an operator actually writes must survive validation.
func TestValidateProfileAcceptsRealFlakeRefs(t *testing.T) {
	t.Parallel()
	accepted := []string{
		".#homeConfigurations.remote-mumbai.activationPackage",
		"github:owner/repo#host",
		"path:./nix#host",
		"github:nixos/nixpkgs/nixos-24.05#nixosConfigurations.canary",
		"github:owner/repo?ref=main#host",
		"git+ssh://git@example.com/owner/repo?ref=main#host",
		"flake:nixpkgs",
		"path:/nix/store/abc123-source#packages.x86_64-linux.rex",
		"sourcehut:~owner/repo#host",
	}
	for _, ref := range accepted {
		ref := ref
		t.Run(ref, func(t *testing.T) {
			t.Parallel()
			profile := approvedProfile()
			profile.FlakeRef = ref
			if err := domain.ValidateProfile(profile); err != nil {
				t.Fatalf("ValidateProfile(%q) = %v, want nil", ref, err)
			}
		})
	}
}

// TestValidateProfileRejectsUnsafeFlakeRefs proves the allow-list still refuses
// injection shapes: shell metacharacters, whitespace, newlines, extra `#`, path
// traversal, and anything that would read as a CLI flag.
func TestValidateProfileRejectsUnsafeFlakeRefs(t *testing.T) {
	t.Parallel()
	rejected := []string{
		"",
		"   ",
		".#host; rm -rf /",
		".#host && reboot",
		".#host | tee /etc/passwd",
		".#host $(id)",
		".#host `id`",
		".#host $(curl http://example.com)",
		".#host\npath:./evil#host",
		".#host with space",
		".#host\twith-tab",
		"path:../../etc/passwd#host",
		".#homeConfigurations.a#b#c",
		"github:owner/repo#",
		"-no-leading-dash",
		"#only-attr-path",
		"github:owner/repo#host\"",
		".#host'quote",
		".#host\"quote",
		".#host*glob",
		".#host>out",
		".#host<input",
		".#host(paren)",
		".#host{bash}",
		`.#host\backslash`,
		"path:./nix#host;sh",
	}
	for _, ref := range rejected {
		ref := ref
		t.Run(strings.ReplaceAll(ref, "\n", `\n`), func(t *testing.T) {
			t.Parallel()
			profile := approvedProfile()
			profile.FlakeRef = ref
			if err := domain.ValidateProfile(profile); err == nil {
				t.Fatalf("ValidateProfile accepted unsafe flake_ref %q", ref)
			}
		})
	}
}

// TestCatalogResolveRejectsClientSuppliedCommandsAndPaths covers acceptance
// criterion 4 at the catalog boundary: the client chooses only name, profile,
// region, and size, and every one of them is matched against the approved
// mapping, so a command, a path, or an unknown provider is refused.
func TestCatalogResolveRejectsClientSuppliedCommandsAndPaths(t *testing.T) {
	t.Parallel()
	catalog, err := domain.NewCatalog([]domain.Profile{approvedProfile()})
	if err != nil {
		t.Fatalf("NewCatalog: %v", err)
	}
	baseline := domain.CreateHostRequest{
		Provider: "aws", Name: "canary-01", Profile: "rex", Region: "ap-south-1", Size: "standard",
	}
	spec, err := catalog.Resolve(baseline)
	if err != nil {
		t.Fatalf("baseline request must resolve: %v", err)
	}
	if spec.FlakeRef != ".#homeConfigurations.remote-mumbai.activationPackage" {
		t.Fatalf("FlakeRef = %q, want the approved profile value", spec.FlakeRef)
	}
	if spec.InstanceType != "t3.medium" || spec.DiskGB != 40 {
		t.Fatalf("size mapping = %s/%d, want t3.medium/40", spec.InstanceType, spec.DiskGB)
	}

	rejected := []struct {
		label  string
		mutate func(*domain.CreateHostRequest)
	}{
		{"command as profile", func(r *domain.CreateHostRequest) { r.Profile = "/bin/sh" }},
		{"command as size", func(r *domain.CreateHostRequest) { r.Size = "$(curl http://example.com)" }},
		{"path as size", func(r *domain.CreateHostRequest) { r.Size = "../../etc/passwd" }},
		{"path as profile", func(r *domain.CreateHostRequest) { r.Profile = "../../etc/shadow" }},
		{"unknown profile", func(r *domain.CreateHostRequest) { r.Profile = "ubuntu" }},
		{"unknown region", func(r *domain.CreateHostRequest) { r.Region = "us-east-1" }},
		{"unknown size", func(r *domain.CreateHostRequest) { r.Size = "large" }},
		{"unknown provider", func(r *domain.CreateHostRequest) { r.Provider = "gcp" }},
		{"empty provider", func(r *domain.CreateHostRequest) { r.Provider = "" }},
		{"shell metacharacter in name", func(r *domain.CreateHostRequest) { r.Name = "canary; rm -rf /" }},
		{"subshell in name", func(r *domain.CreateHostRequest) { r.Name = "canary-$(id)" }},
		{"path traversal in name", func(r *domain.CreateHostRequest) { r.Name = "../etc" }},
	}
	for _, tc := range rejected {
		tc := tc
		t.Run(tc.label, func(t *testing.T) {
			t.Parallel()
			req := baseline
			tc.mutate(&req)
			if _, err := catalog.Resolve(req); err == nil {
				t.Fatalf("Resolve accepted %s: %+v", tc.label, req)
			}
		})
	}
}

// TestCatalogRejectsDuplicateAndEmptyProfileSets guards the catalog invariants
// that make an ambiguous mapping impossible.
func TestCatalogRejectsDuplicateAndEmptyProfileSets(t *testing.T) {
	t.Parallel()
	if _, err := domain.NewCatalog(nil); err == nil {
		t.Fatal("NewCatalog(nil) must fail")
	}
	if _, err := domain.NewCatalog([]domain.Profile{approvedProfile(), approvedProfile()}); err == nil {
		t.Fatal("NewCatalog with a duplicate profile must fail")
	}
}
