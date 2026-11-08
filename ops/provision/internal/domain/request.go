package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
)

// CreateHostRequest is the complete set of values a client may influence when
// creating a host. There is deliberately no field for an executable, flake URL,
// Terraform state path, OpenBao path, IAM role, tag, instance type, or disk
// size: those are resolved server-side from the approved profile, and the
// transport decoder rejects any attempt to send them.
type CreateHostRequest struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Profile  string `json:"profile"`
	Region   string `json:"region"`
	Size     string `json:"size"`
}

// idempotencyKeyPattern keeps keys usable as durable ledger keys and Temporal
// workflow-id fragments without escaping.
var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)

// ValidateIdempotencyKey enforces the accepted key shape.
func ValidateIdempotencyKey(key string) error {
	if key == "" {
		return Invalid("Idempotency-Key", "is required")
	}
	if !idempotencyKeyPattern.MatchString(key) {
		return Invalid("Idempotency-Key", "must be 8 to 128 characters of [A-Za-z0-9._:-]")
	}
	return nil
}

// Fingerprint hashes the canonical form of a validated request. Two requests
// with the same Idempotency-Key and the same fingerprint are the same request;
// a different fingerprint is a conflict.
func Fingerprint(req CreateHostRequest) (string, error) {
	canonical, err := json.Marshal(struct {
		Provider string `json:"provider"`
		Name     string `json:"name"`
		Profile  string `json:"profile"`
		Region   string `json:"region"`
		Size     string `json:"size"`
	}{req.Provider, req.Name, req.Profile, req.Region, req.Size})
	if err != nil {
		return "", fmt.Errorf("fingerprint request: %w", err)
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}
