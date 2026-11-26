package application_test

import (
	"context"
	"errors"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/token"
)

var createRequest = domain.CreateHostRequest{
	Provider: "aws", Name: "canary-01", Profile: "rex", Region: "ap-south-1", Size: "standard",
}

// TestAuthorizeAcceptsOnlyIssuedDigests covers acceptance criterion 1 at the use
// case layer: only a known, unrevoked digest resolves to a principal.
func TestAuthorizeAcceptsOnlyIssuedDigests(t *testing.T) {
	t.Parallel()
	harness := fakes.NewHarness(t)
	ctx := context.Background()

	principal, err := harness.Service.Authorize(ctx, fakes.TestToken)
	if err != nil {
		t.Fatalf("Authorize(valid): %v", err)
	}
	if principal.ClientID != "test-client" {
		t.Fatalf("client id = %q, want test-client", principal.ClientID)
	}

	rejected := []struct {
		label string
		token string
	}{
		{"empty token", ""},
		{"whitespace token", "   "},
		{"unknown token", "not-an-issued-token"},
		{"revoked token", fakes.RevokedToken},
		{"digest used as a token", token.Digest(fakes.TestToken)},
	}
	for _, tc := range rejected {
		tc := tc
		t.Run(tc.label, func(t *testing.T) {
			t.Parallel()
			if _, err := fakes.NewHarness(t).Service.Authorize(ctx, tc.token); !errors.Is(err, domain.ErrUnauthorized) {
				t.Fatalf("Authorize(%s) = %v, want ErrUnauthorized", tc.label, err)
			}
		})
	}
}

// TestFailedStartReleasesTheReservation proves a rejected workflow start does not
// wedge the Idempotency-Key: the reservation is released, the host is marked
// failed, no workflow was started, and a retry with the same key is accepted.
func TestFailedStartReleasesTheReservation(t *testing.T) {
	t.Parallel()
	harness := fakes.NewHarness(t)
	ctx := context.Background()
	principal := ports.Principal{ClientID: "test-client"}

	harness.Orchestrator.FailStarts(errors.New("temporal unavailable"))
	if _, err := harness.Service.CreateHost(ctx, principal, "idem-key-0001", createRequest); err == nil {
		t.Fatal("CreateHost must fail when the workflow cannot start")
	}
	if starts := harness.Orchestrator.TotalStarts(); starts != 0 {
		t.Fatalf("workflows started = %d, want 0", starts)
	}
	if _, found, err := harness.Store.Lookup(ctx, "idem-key-0001"); err != nil || found {
		t.Fatalf("reservation was not released: found=%v err=%v", found, err)
	}
	hosts, err := harness.Store.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("host rows = %d, want the failed attempt recorded once", len(hosts))
	}
	if hosts[0].State != domain.HostStateFailed {
		t.Fatalf("host state = %q, want %q", hosts[0].State, domain.HostStateFailed)
	}

	harness.Orchestrator.FailStarts(nil)
	accepted, err := harness.Service.CreateHost(ctx, principal, "idem-key-0001", createRequest)
	if err != nil {
		t.Fatalf("retry with the same key after a failed start: %v", err)
	}
	if accepted.HostID == "" || accepted.JobID == "" {
		t.Fatalf("retry response is missing identifiers: %+v", accepted)
	}
	if starts := harness.Orchestrator.TotalStarts(); starts != 1 {
		t.Fatalf("workflows started = %d, want 1", starts)
	}
}

// TestRepeatedDeleteReusesOneJob keeps teardown idempotent: two DELETE requests
// produce one deletion job.
func TestRepeatedDeleteReusesOneJob(t *testing.T) {
	t.Parallel()
	harness := fakes.NewHarness(t)
	ctx := context.Background()
	principal := ports.Principal{ClientID: "test-client"}

	accepted, err := harness.Service.CreateHost(ctx, principal, "idem-key-0001", createRequest)
	if err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	first, err := harness.Service.DeleteHost(ctx, principal, accepted.HostID)
	if err != nil {
		t.Fatalf("DeleteHost: %v", err)
	}
	second, err := harness.Service.DeleteHost(ctx, principal, accepted.HostID)
	if err != nil {
		t.Fatalf("repeated DeleteHost: %v", err)
	}
	if first.JobID != second.JobID {
		t.Fatalf("repeated delete produced %q then %q", first.JobID, second.JobID)
	}
	if starts := harness.Orchestrator.StartCount(first.JobID); starts != 1 {
		t.Fatalf("delete job started %d times, want 1", starts)
	}
	host, err := harness.Store.GetHost(ctx, accepted.HostID)
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if host.State != domain.HostStateDeleting {
		t.Fatalf("host state = %q, want %q", host.State, domain.HostStateDeleting)
	}

	// Another client cannot see or delete the host.
	other := ports.Principal{ClientID: "other-client"}
	if _, err := harness.Service.DeleteHost(ctx, other, accepted.HostID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cross-client delete = %v, want ErrNotFound", err)
	}
	if _, err := harness.Service.GetJob(ctx, other, first.JobID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cross-client job read = %v, want ErrNotFound", err)
	}
}

// TestListHostsIsOwnerScopedAndNewestFirst covers inventory reads.
func TestListHostsIsOwnerScopedAndNewestFirst(t *testing.T) {
	t.Parallel()
	harness := fakes.NewHarness(t)
	ctx := context.Background()
	owner := ports.Principal{ClientID: "test-client"}

	first, err := harness.Service.CreateHost(ctx, owner, "idem-key-0001", createRequest)
	if err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	harness.Clock.Advance(60_000_000_000) // one minute
	later := createRequest
	later.Name = "canary-02"
	second, err := harness.Service.CreateHost(ctx, owner, "idem-key-0002", later)
	if err != nil {
		t.Fatalf("CreateHost: %v", err)
	}

	hosts, err := harness.Service.ListHosts(ctx, owner)
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if len(hosts) != 2 {
		t.Fatalf("hosts = %d, want 2", len(hosts))
	}
	if hosts[0].ID != second.HostID || hosts[1].ID != first.HostID {
		t.Fatalf("hosts are not newest first: %s then %s", hosts[0].ID, hosts[1].ID)
	}

	other := ports.Principal{ClientID: "other-client"}
	otherHosts, err := harness.Service.ListHosts(ctx, other)
	if err != nil {
		t.Fatalf("ListHosts(other): %v", err)
	}
	if len(otherHosts) != 0 {
		t.Fatalf("another client sees %d host(s), want 0", len(otherHosts))
	}
	if otherHosts == nil {
		t.Fatal("an empty result must be an empty slice, not nil")
	}
}
