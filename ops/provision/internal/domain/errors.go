// Package domain holds the provision service's host, profile, request, and job
// rules. It is deliberately free of Temporal, cloud-provider, and transport
// imports so the rules can be tested in isolation.
package domain

import (
	"errors"
	"fmt"
)

// Sentinel errors shared across layers. Transport adapters map them to status
// codes; nothing in this package knows about HTTP.
var (
	// ErrNotFound reports a resource that does not exist or is not owned by the
	// caller. Both cases are reported identically so ownership is not leaked.
	ErrNotFound = errors.New("resource not found")
	// ErrUnauthorized reports a missing, unknown, or revoked client token.
	ErrUnauthorized = errors.New("unauthorized")
	// ErrIdempotencyConflict reports an Idempotency-Key reused with a different
	// request body.
	ErrIdempotencyConflict = errors.New("idempotency key reused with a different request")
	// ErrHostDeleted reports a mutation attempted against a tombstoned host.
	ErrHostDeleted = errors.New("host is deleted")
)

// ValidationError reports a client-supplied value that failed a domain rule.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field == "" {
		return "invalid request: " + e.Message
	}
	return fmt.Sprintf("invalid request: %s: %s", e.Field, e.Message)
}

// Invalid builds a ValidationError.
func Invalid(field, message string) *ValidationError {
	return &ValidationError{Field: field, Message: message}
}

// NotImplementedError reports a capability that exists as a port but has no
// real implementation yet. S01 ships these so a missing integration can never
// masquerade as a successful provisioning step.
type NotImplementedError struct {
	Component string
	Step      string
}

func (e *NotImplementedError) Error() string {
	return fmt.Sprintf("%s is not implemented in S01: %s", e.Component, e.Step)
}
