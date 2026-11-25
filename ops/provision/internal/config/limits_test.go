package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/config"
)

// TestServiceRefusesAConcurrencyBoundOutsideTheApprovedRange is the offline half of
// the bounded-concurrency property: the numbers the worker is built from cannot be
// zero (no work) or unbounded (a burst of API calls fanning out Terraform, SSM, and
// provider calls without limit). The worker takes its two concurrency limits
// straight from these fields, so refusing bad values here is what keeps the bound.
func TestServiceRefusesAConcurrencyBoundOutsideTheApprovedRange(t *testing.T) {
	t.Parallel()
	base, err := os.ReadFile("../../config/service.example.yaml")
	if err != nil {
		t.Fatalf("read example: %v", err)
	}

	cases := []struct {
		name     string
		from     string
		to       string
		wantPass bool
	}{
		{"approved values load", "max_concurrent_jobs: 4", "max_concurrent_jobs: 4", true},
		{"zero jobs is refused", "max_concurrent_jobs: 4", "max_concurrent_jobs: 0", false},
		{"negative jobs is refused", "max_concurrent_jobs: 4", "max_concurrent_jobs: -1", false},
		{"above the ceiling is refused", "max_concurrent_jobs: 4", "max_concurrent_jobs: 65", false},
		{"zero provisioning is refused", "max_concurrent_provisioning: 2", "max_concurrent_provisioning: 0", false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			body := strings.Replace(string(base), testCase.from, testCase.to, 1)
			if testCase.from != testCase.to && body == string(base) {
				t.Fatalf("the example no longer contains %q", testCase.from)
			}
			path := filepath.Join(t.TempDir(), "service.yaml")
			if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
				t.Fatalf("write config: %v", err)
			}
			_, err := config.LoadService(path)
			if testCase.wantPass && err != nil {
				t.Fatalf("the approved bound was refused: %v", err)
			}
			if !testCase.wantPass && err == nil {
				t.Fatal("a bound outside the approved range was accepted")
			}
		})
	}
}
