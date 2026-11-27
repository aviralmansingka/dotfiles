package ssm

import "testing"

// TestSwitchTargetNamesTheHomeManagerConfiguration pins the one rewrite the switch
// needs, in the package that owns it.
//
// The live failure of 2026-11-27: the switch was handed the catalog's full
// attribute path and `home-manager switch --flake` read it as a configuration
// name, so Nix refused with `does not provide attribute
// 'packages.x86_64-linux.homeConf…'`. Home-manager builds the activation package
// itself, so the name is what belongs in that position.
func TestSwitchTargetNamesTheHomeManagerConfiguration(t *testing.T) {
	t.Parallel()
	const rev = "704777b201e001fa6883426bd1205f1f18494f75"
	cases := map[string]struct {
		ref  string
		want string
	}{
		"a home-manager output becomes its configuration name": {
			ref:  "git+https://github.com/owner/repo?rev=" + rev + "#homeConfigurations.remote-mumbai.activationPackage",
			want: "git+https://github.com/owner/repo?rev=" + rev + "#remote-mumbai",
		},
		"a forge shorthand keeps its prefix": {
			ref:  "github:owner/repo/" + rev + "#homeConfigurations.probe.activationPackage",
			want: "github:owner/repo/" + rev + "#probe",
		},
		// A build-shaped switch is the reason this is a rewrite and not a strip:
		// every other attribute path is handed on unchanged.
		"another attribute path is untouched": {
			ref:  "github:owner/repo/" + rev + "#packages.x86_64-linux.rex",
			want: "github:owner/repo/" + rev + "#packages.x86_64-linux.rex",
		},
		"a deeper home-manager path is untouched": {
			ref:  "github:owner/repo/" + rev + "#homeConfigurations.remote-mumbai.config.home.username",
			want: "github:owner/repo/" + rev + "#homeConfigurations.remote-mumbai.config.home.username",
		},
		"a reference with no fragment is untouched": {
			ref:  "github:owner/repo/" + rev,
			want: "github:owner/repo/" + rev,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if got := switchTarget(tc.ref); got != tc.want {
				t.Fatalf("switchTarget(%q) = %q, want %q", tc.ref, got, tc.want)
			}
		})
	}
}
