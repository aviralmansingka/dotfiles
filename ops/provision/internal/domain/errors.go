// Package domain holds the provision service's host, profile, request, and job
// rules. It is deliberately free of Temporal, cloud-provider, and transport
// imports so the rules can be tested in isolation.
package domain

import (
	"errors"
	"fmt"
	"time"
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

// AmbiguousOwnershipError reports a teardown that cannot prove which resource it
// owns. It is never retried automatically and never treated as "nothing to do":
// a destroy with no recorded provider identity could remove a resource another
// job owns, or leave an orphan nobody can find. The operator reconciles it by
// hand.
type AmbiguousOwnershipError struct {
	HostID string
	Reason string
}

func (e *AmbiguousOwnershipError) Error() string {
	return fmt.Sprintf("refusing to destroy host %s: ownership is ambiguous (%s); reconcile the provider record by hand", e.HostID, e.Reason)
}

// AgentNotRegisteredError reports that a host's SSM agent never registered with
// the control plane inside the allowed window.
//
// It is deliberately its own type, and deliberately not retryable at the workflow
// level: enrollment fails closed here instead of falling back to another
// transport, waiting indefinitely, or dialling an address that might be something
// else.
type AgentNotRegisteredError struct {
	InstanceID string
	Waited     time.Duration
	// PingStatus is the last status the control plane reported, if it knew the
	// instance at all.
	PingStatus string
}

func (e *AgentNotRegisteredError) Error() string {
	status := e.PingStatus
	if status == "" {
		status = "never registered"
	}
	return fmt.Sprintf("ssm agent on instance %s did not come online within %s (ping status: %s); enrollment fails closed and does not fall back to ssh",
		e.InstanceID, e.Waited.Round(time.Second), status)
}
