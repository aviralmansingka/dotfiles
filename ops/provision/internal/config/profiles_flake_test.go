package config_test

import (
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/config"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// flakeFile is the flake the profiles' targets must exist in. The path is
// relative to this package: ops/provision/internal/config -> repo root.
const flakeFile = "../../../../flake.nix"

// flakeTargetPattern is the one shape the service treats as a deploy target: a
// Home Manager activation package of an exposed homeConfigurations output. The
// service never runs `nix` itself, so this shape check plus the exposure check
// below is what keeps a shipped profile from naming a target that cannot build.
var flakeTargetPattern = regexp.MustCompile(`^\.#homeConfigurations\.([A-Za-z0-9_-]+)\.activationPackage$`)

// TestShippedProfilesNameExposedFlakeTargets closes the loop the API depends on:
// a profile's flake_ref is resolved server-side from config/profiles.yaml, and
// the flake is what the host actually builds. If the logical `rex` profile ever
// points at an output the flake does not expose, the deploy step fails on a live
// host with a Nix attribute error instead of at configuration load, so the
// mapping is asserted here, offline, against flake.nix itself.
func TestShippedProfilesNameExposedFlakeTargets(t *testing.T) {
	t.Parallel()
	catalog, err := config.LoadProfiles(shippedProfiles)
	if err != nil {
		t.Fatalf("LoadProfiles(%s): %v", shippedProfiles, err)
	}
	exposed, err := homeConfigurationNames(flakeFile)
	if err != nil {
		t.Fatalf("read flake outputs: %v", err)
	}
	for _, profile := range catalog.Profiles() {
		match := flakeTargetPattern.FindStringSubmatch(profile.FlakeRef)
		if match == nil {
			t.Fatalf("profile %q flake_ref %q is not .#homeConfigurations.<name>.activationPackage", profile.Name, profile.FlakeRef)
		}
		if !exposed[match[1]] {
			t.Fatalf("profile %q flake_ref %q names homeConfigurations.%s, which %s does not expose (exposed: %s)",
				profile.Name, profile.FlakeRef, match[1], flakeFile, strings.Join(sortedNames(exposed), ", "))
		}
	}
}

// TestRexProfileMapsToTheManagedHostOutput pins the one mapping the provisioning
// mission names: the logical profile `rex` is served by the flake's managed Rex
// host output. It is the same assertion as above, stated as a contract, so a
// rename of either side has to be a deliberate change in both files.
func TestRexProfileMapsToTheManagedHostOutput(t *testing.T) {
	t.Parallel()
	catalog, err := config.LoadProfiles(shippedProfiles)
	if err != nil {
		t.Fatalf("LoadProfiles(%s): %v", shippedProfiles, err)
	}
	profile, ok := catalog.Profile("rex")
	if !ok {
		t.Fatalf("the shipped profile file has no %q profile", "rex")
	}
	const want = ".#homeConfigurations.remote-mumbai.activationPackage"
	if profile.FlakeRef != want {
		t.Fatalf("profile %q flake_ref = %q, want %q", profile.Name, profile.FlakeRef, want)
	}
}

// TestUnknownProfileIsRejected proves a request cannot reach a provider with a
// profile name the catalog does not ship. The profile field is the only place a
// client could try to choose a flake target, so the refusal is the guarantee.
func TestUnknownProfileIsRejected(t *testing.T) {
	t.Parallel()
	catalog, err := config.LoadProfiles(shippedProfiles)
	if err != nil {
		t.Fatalf("LoadProfiles(%s): %v", shippedProfiles, err)
	}
	approved := catalog.Profiles()
	if len(approved) == 0 {
		t.Fatal("the shipped profile file has no profiles")
	}
	for _, name := range []string{"unknown", "REX", "rex-01", ""} {
		name := name
		t.Run("profile="+name, func(t *testing.T) {
			t.Parallel()
			_, err := catalog.Resolve(domain.CreateHostRequest{
				Provider: string(domain.ProviderAWS),
				Name:     "canary-01",
				Profile:  name,
				Region:   approved[0].Regions[0],
				Size:     "standard",
			})
			if err == nil {
				t.Fatalf("Resolve accepted unknown profile %q", name)
			}
			var invalid *domain.ValidationError
			if !errors.As(err, &invalid) {
				t.Fatalf("Resolve error for profile %q = %T (%v), want a *domain.ValidationError", name, err, err)
			}
			if invalid.Field != "profile" {
				t.Fatalf("Resolve error field for profile %q = %q, want %q", name, invalid.Field, "profile")
			}
		})
	}
}

// homeConfigurationNames reads the attribute names of the flake's
// `homeConfigurations` output. It parses the file instead of running `nix`,
// because the Go suite runs offline and on hosts without a Nix install; the
// output block is a flat attrset, which is all this needs to understand.
func homeConfigurationNames(path string) (map[string]bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	names := make(map[string]bool)
	inside := false
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if !inside {
			inside = strings.HasPrefix(trimmed, "homeConfigurations = {")
			continue
		}
		if trimmed == "};" {
			return names, nil
		}
		name, _, ok := strings.Cut(trimmed, "=")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		if name != "" && !strings.ContainsAny(name, " \"{};") {
			names[name] = true
		}
	}
	return nil, errors.New("flake.nix has no homeConfigurations block")
}

func sortedNames(set map[string]bool) []string {
	names := make([]string, 0, len(set))
	for name := range set {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
