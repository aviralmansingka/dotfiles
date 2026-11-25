package domain_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// tombstoneTime is the fixed instant every test in this file uses, so a comparison
// never depends on the wall clock.
var tombstoneTime = time.Date(2026, 11, 25, 15, 4, 5, 0, time.UTC)

// TestTombstoneIsCompleteOnlyWhenEveryStepReleased pins the completeness rule: a
// tombstone is a claim that every cleanup step finished, so one that omits a step is
// not complete and CompleteTeardown refuses it.
func TestTombstoneIsCompleteOnlyWhenEveryStepReleased(t *testing.T) {
	t.Parallel()

	full := domain.NewTombstone(tombstoneTime, domain.CleanupSteps, nil, 3)
	if !full.Complete() {
		t.Fatalf("a tombstone with every step released is not complete: %+v", full)
	}
	if reason := full.Sanitized(); reason != "" {
		t.Fatalf("a complete tombstone is not sanitized: %s", reason)
	}

	var partialSteps []domain.CleanupStep
	for _, step := range domain.CleanupSteps {
		if step != domain.CleanupRemoveDevice {
			partialSteps = append(partialSteps, step)
		}
	}
	partial := domain.NewTombstone(tombstoneTime, partialSteps, nil, 0)
	if partial.Complete() {
		t.Fatal("a tombstone that omits the device step reported itself complete")
	}

	withIncomplete := domain.NewTombstone(tombstoneTime, domain.CleanupSteps, []domain.CleanupStep{domain.CleanupRemoveDevice}, 0)
	if withIncomplete.Complete() {
		t.Fatal("a tombstone with an incomplete step reported itself complete")
	}
	if reason := withIncomplete.Sanitized(); reason != "" {
		// The step name is valid, so Sanitized still passes: completeness and
		// sanitization are separate checks and CompleteTeardown applies both.
		t.Fatalf("an incomplete-but-well-formed tombstone should pass Sanitized, got %s", reason)
	}
}

// TestTombstoneRefusesAnUnknownStep keeps a typo or a foreign name from becoming a
// durable claim about cleanup.
func TestTombstoneRefusesAnUnknownStep(t *testing.T) {
	t.Parallel()
	tombstone := domain.NewTombstone(tombstoneTime, []domain.CleanupStep{"openbao_credential"}, nil, 0)
	reason := tombstone.Sanitized()
	if reason == "" {
		t.Fatal("a tombstone carrying an unknown step passed sanitization")
	}
	if !strings.Contains(reason, "openbao_credential") {
		t.Fatalf("the reason does not name the offending step: %s", reason)
	}
}

// TestTombstoneWithoutAPolicyIsRefused proves the record states the rule it was
// written under: a tombstone whose Policy field was lost is not trustworthy.
func TestTombstoneWithoutAPolicyIsRefused(t *testing.T) {
	t.Parallel()
	tombstone := domain.NewTombstone(tombstoneTime, domain.CleanupSteps, nil, 0)
	tombstone.Policy = ""
	if reason := tombstone.Sanitized(); reason == "" {
		t.Fatal("a tombstone with no recorded policy passed sanitization")
	}
	tombstone.Policy = domain.TombstonePolicy
	tombstone.DeletedAt = time.Time{}
	if reason := tombstone.Sanitized(); reason == "" {
		t.Fatal("a tombstone with no deletion time passed sanitization")
	}
}

// TestCompleteTeardownClearsInfrastructureDetail is the sanitization property stated
// on the record: identifiers and cost-relevant shape survive, and everything that
// described a machine which no longer exists is cleared.
func TestCompleteTeardownClearsInfrastructureDetail(t *testing.T) {
	t.Parallel()
	host := domain.Host{
		ID:             "host-0001",
		Name:           "canary-01",
		Provider:       domain.ProviderAWS,
		Profile:        "rex",
		Region:         "ap-south-1",
		Size:           "standard",
		InstanceType:   "t3.medium",
		DiskGB:         40,
		Tags:           map[string]string{"owner": "fleet"},
		SecretBundles:  []string{"bao:secret/data/hosts/host-0001/canary"},
		OwnerClientID:  "test-client",
		State:          domain.HostStateDeleting,
		ResourceID:     "i-0123456789abcdef0",
		DeviceID:       "n1234CNTRL",
		FlakeRevision:  "sha256:abc123",
		PrivateAddress: "10.99.1.10",
		RexURL:         "https://canary-01.fleet.example",
		CreatedAt:      tombstoneTime.Add(-time.Hour),
		UpdatedAt:      tombstoneTime,
	}

	tombstone := domain.NewTombstone(tombstoneTime, domain.CleanupSteps, nil, 2)
	if err := host.CompleteTeardown(tombstone); err != nil {
		t.Fatalf("CompleteTeardown: %v", err)
	}

	if host.State != domain.HostStateDeleted {
		t.Fatalf("state = %q, want deleted", host.State)
	}
	if host.Tombstone == nil || !host.Tombstone.Complete() {
		t.Fatalf("tombstone = %+v, want a complete one", host.Tombstone)
	}
	if len(host.PendingCleanup) != 0 {
		t.Fatalf("pending cleanup = %v, want none", host.PendingCleanup)
	}
	// Kept for audit.
	if host.ResourceID != "i-0123456789abcdef0" || host.DeviceID != "n1234CNTRL" {
		t.Fatalf("identifiers = %q/%q, want them kept", host.ResourceID, host.DeviceID)
	}
	if host.InstanceType != "t3.medium" || host.DiskGB != 40 {
		t.Fatalf("shape = %s/%d, want it kept for cost attribution", host.InstanceType, host.DiskGB)
	}
	if len(host.SecretBundles) != 1 {
		t.Fatalf("secret bundle references = %v, want the references kept so the revocation is auditable", host.SecretBundles)
	}
	// Cleared.
	for name, value := range map[string]string{
		"private address": host.PrivateAddress,
		"rex url":         host.RexURL,
		"flake revision":  host.FlakeRevision,
	} {
		if value != "" {
			t.Fatalf("%s = %q, want it cleared", name, value)
		}
	}
	if len(host.Tags) != 0 {
		t.Fatalf("tags = %v, want them cleared", host.Tags)
	}

	encoded, err := json.Marshal(host)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, forbidden := range []string{"10.99.1.10", "canary-01.fleet.example", "sha256:abc123", `"owner"`} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("the tombstoned record still carries %q: %s", forbidden, encoded)
		}
	}
}

// TestCompleteTeardownRefusesAnIncompleteStep is the guard that matters: a record
// must never say "deleted" while a cleanup step is unfinished.
func TestCompleteTeardownRefusesAnIncompleteStep(t *testing.T) {
	t.Parallel()
	host := domain.Host{ID: "host-0001", State: domain.HostStateDeleting}
	tombstone := domain.NewTombstone(tombstoneTime, domain.CleanupSteps[:3], []domain.CleanupStep{domain.CleanupDestroyResources}, 0)

	err := host.CompleteTeardown(tombstone)
	if err == nil {
		t.Fatal("an incomplete teardown was tombstoned")
	}
	if !strings.Contains(err.Error(), string(domain.CleanupDestroyResources)) {
		t.Fatalf("the refusal does not name the unfinished step: %v", err)
	}
	if host.State == domain.HostStateDeleted || host.Tombstone != nil {
		t.Fatal("the record was tombstoned despite the refusal")
	}
}

// TestPartialTeardownKeepsTheRecordOutOfDeleted proves a partial teardown is visible
// on the record: the state stays out of "deleted" and the pending steps are durable.
func TestPartialTeardownKeepsTheRecordOutOfDeleted(t *testing.T) {
	t.Parallel()
	host := domain.Host{ID: "host-0001", State: domain.HostStateDeleting}
	host.MarkCleanupIncomplete([]domain.CleanupStep{
		domain.CleanupRemoveDevice,
		domain.CleanupRevokeTokens,
		domain.CleanupRemoveDevice,
	}, tombstoneTime)

	if host.State != domain.HostStateFailed {
		t.Fatalf("state = %q, want failed", host.State)
	}
	if !host.NeedsCleanup() {
		t.Fatal("the record does not report pending cleanup")
	}
	if got := domain.IncompleteCleanup(host.PendingCleanup); got != "openbao_tokens, tailscale_device" {
		t.Fatalf("pending cleanup = %q, want the steps deduplicated and sorted", got)
	}
	if !host.UpdatedAt.Equal(tombstoneTime) {
		t.Fatalf("updated at = %s, want the supplied time", host.UpdatedAt)
	}

	// A tombstoned record is not reopened by a later partial report.
	deleted := domain.Host{ID: "host-0002", State: domain.HostStateDeleted}
	deleted.MarkCleanupIncomplete([]domain.CleanupStep{domain.CleanupRemoveDevice}, tombstoneTime)
	if deleted.State != domain.HostStateDeleted {
		t.Fatalf("a tombstoned record was reopened to %q", deleted.State)
	}
}
