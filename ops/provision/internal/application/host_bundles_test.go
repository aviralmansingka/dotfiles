package application_test

import (
	"context"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// TestCreateHostRendersTheApprovedBundlesForItsOwnHost proves the profile's
// per-host mapping is rendered against the generated host identity before
// anything is recorded: the persisted host names its own KV paths, and the
// approved shared template never reaches a record, a workflow payload, or the
// OpenBao policy.
func TestCreateHostRendersTheApprovedBundlesForItsOwnHost(t *testing.T) {
	t.Parallel()
	harness := fakes.NewHarness(t)
	accepted, err := harness.Service.CreateHost(context.Background(),
		application.Principal{ClientID: "test-client"},
		"idem-key-0001",
		domain.CreateHostRequest{
			Provider: string(domain.ProviderAWS),
			Name:     "canary-01",
			Profile:  "rex",
			Region:   "ap-south-1",
			Size:     "standard",
		})
	if err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	host, err := harness.Store.GetHost(context.Background(), accepted.HostID)
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if len(host.SecretBundles) != 1 {
		t.Fatalf("recorded bundles = %v, want the one approved bundle", host.SecretBundles)
	}
	want := "bao:secret/data/hosts/" + accepted.HostID + "/canary"
	if host.SecretBundles[0] != want {
		t.Fatalf("recorded bundle = %q, want the host's own %q", host.SecretBundles[0], want)
	}
}
