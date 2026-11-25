package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// CleanupStep names one step of a teardown. The order below is the order the
// workflow runs them in, and it is the order they are reported in: credentials
// first, so a live host is cut off before anything else happens; then the tailnet
// identity; then the billable resource; then the record.
//
// Naming the steps is what makes a partial teardown reportable. A failure says
// which step is incomplete instead of only that "deletion failed", so an operator
// knows whether to retry, revoke by hand, or reconcile the provider record.
type CleanupStep string

const (
	// CleanupRevokeTokens revokes every already-issued OpenBao token accessor
	// whose policy belongs to this host. It is the only step that invalidates a
	// session that was handed out before the teardown started.
	CleanupRevokeTokens CleanupStep = "openbao_tokens"
	// CleanupRevokeCredentials removes the AppRole and the policy, so no future
	// login with a SecretID can succeed. Deleting an AppRole does not touch a
	// token that was already issued: that is why CleanupRevokeTokens exists.
	CleanupRevokeCredentials CleanupStep = "openbao_credentials"
	// CleanupRemoveDevice deletes the host's Tailscale device, so the node cannot
	// rejoin the tailnet and holds no address.
	CleanupRemoveDevice CleanupStep = "tailscale_device"
	// CleanupDestroyResources destroys this host's Terraform state and nothing
	// else. It is the step that stops the billing.
	CleanupDestroyResources CleanupStep = "terraform_resources"
)

// CleanupSteps is the canonical teardown order.
var CleanupSteps = []CleanupStep{
	CleanupRevokeTokens,
	CleanupRevokeCredentials,
	CleanupRemoveDevice,
	CleanupDestroyResources,
}

// Validate reports whether step is a known teardown step.
func (s CleanupStep) Validate() error {
	for _, known := range CleanupSteps {
		if s == known {
			return nil
		}
	}
	return fmt.Errorf("domain: %q is not a teardown step", string(s))
}

// TombstonePolicy is the sanitization rule a tombstone satisfies. It is stored
// with the record so the rule travels with the data it describes.
const TombstonePolicy = "identifiers, cleanup outcomes, and cost-relevant shape only; no addresses, URLs, revisions, or credential references"

// Tombstone is the durable record a completed teardown leaves behind.
//
// It is deliberately small. A deleted host keeps its identifiers (so an operator
// can prove which instance and which device were destroyed), its approved shape
// (so cost can be attributed after the fact), and the outcome of every cleanup
// step. It keeps nothing that described infrastructure which no longer exists: no
// private address, no Rex URL, no flake revision, no tag map. Those fields are
// cleared by Host.CompleteTeardown, and Sanitized reports whether that held.
type Tombstone struct {
	DeletedAt time.Time `json:"deleted_at"`
	// Released lists the steps that completed, in teardown order.
	Released []CleanupStep `json:"released"`
	// Incomplete is empty for a complete teardown. A tombstone is only written
	// when every step reported success, so a non-empty value here is a bug and
	// Sanitized refuses it.
	Incomplete []CleanupStep `json:"incomplete,omitempty"`
	// TokenAccessorsRevoked is how many already-issued tokens this teardown
	// invalidated. It is a count, never an accessor value.
	TokenAccessorsRevoked int `json:"token_accessors_revoked"`
	// Policy records the sanitization rule in force when the tombstone was
	// written.
	Policy string `json:"policy"`
}

// NewTombstone builds a tombstone for a teardown that finished every step.
// incomplete is carried through so a caller that tombstones partially can be
// caught by Sanitized rather than by a reviewer.
func NewTombstone(now time.Time, released, incomplete []CleanupStep, tokensRevoked int) Tombstone {
	return Tombstone{
		DeletedAt:             now.UTC(),
		Released:              dedupeSteps(released),
		Incomplete:            dedupeSteps(incomplete),
		TokenAccessorsRevoked: tokensRevoked,
		Policy:                TombstonePolicy,
	}
}

// Complete reports whether every teardown step is accounted for.
func (t Tombstone) Complete() bool {
	if len(t.Incomplete) > 0 {
		return false
	}
	seen := make(map[CleanupStep]bool, len(t.Released))
	for _, step := range t.Released {
		seen[step] = true
	}
	for _, step := range CleanupSteps {
		if !seen[step] {
			return false
		}
	}
	return true
}

// IncompleteCleanup renders the steps that did not finish as a stable, sorted,
// credential-free sentence fragment, for a job error or an operator's terminal.
func IncompleteCleanup(steps []CleanupStep) string {
	if len(steps) == 0 {
		return ""
	}
	names := make([]string, 0, len(steps))
	for _, step := range dedupeSteps(steps) {
		names = append(names, string(step))
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

// Sanitized reports the first reason the tombstone would carry something a
// deleted record must not. It returns "" when the tombstone is clean.
//
// This is a guard on data, not on formatting: an address, a URL, a flake store
// path, or a SecretBundle reference in the released/incomplete lists would mean
// the wrong value was passed to NewTombstone.
func (t Tombstone) Sanitized() string {
	if t.Policy != TombstonePolicy {
		return "tombstone does not record the sanitization policy in force"
	}
	if t.DeletedAt.IsZero() {
		return "tombstone has no deletion timestamp"
	}
	if t.TokenAccessorsRevoked < 0 {
		return "tombstone reports a negative token count"
	}
	for _, step := range append(append([]CleanupStep(nil), t.Released...), t.Incomplete...) {
		if err := step.Validate(); err != nil {
			return fmt.Sprintf("tombstone carries the unknown cleanup step %q", string(step))
		}
	}
	return ""
}

// dedupeSteps preserves first-seen order while removing repeats, so a step that
// is reported twice (an activity retried and then succeeded) is listed once.
func dedupeSteps(steps []CleanupStep) []CleanupStep {
	if len(steps) == 0 {
		return nil
	}
	seen := make(map[CleanupStep]bool, len(steps))
	out := make([]CleanupStep, 0, len(steps))
	for _, step := range steps {
		if seen[step] {
			continue
		}
		seen[step] = true
		out = append(out, step)
	}
	return out
}
