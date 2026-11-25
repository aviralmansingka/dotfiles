// Package terraform holds the AWS EC2 compute-provider adapter.
//
// AWS is the real provider, built on the isolated per-host Terraform root in
// ops/provision/terraform/aws (S02). Stub stays as the explicit refusal used by
// tests and by any composition that must not allocate resources at all: a
// missing provider must never look like a successful one.
package terraform

import (
	"context"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Stub refuses every provider operation. It exists so the workflow, activity,
// and API layers can be exercised without ever allocating a resource, and so a
// missing provider can never look like a successful one.
type Stub struct{}

// NewStub builds the provider stub.
func NewStub() *Stub { return &Stub{} }

var _ application.HostProvider = (*Stub)(nil)

// CreateHost implements application.HostProvider by refusing.
func (*Stub) CreateHost(_ context.Context, _ application.ProviderCreateRequest) (application.ProviderResource, error) {
	return application.ProviderResource{}, &domain.NotImplementedError{
		Component: "terraform aws provider stub",
		Step:      "compose the real AWS provider (terraform.NewAWS) instead",
	}
}

// StatusHost implements application.HostProvider by refusing.
func (*Stub) StatusHost(_ context.Context, _ application.ProviderStatusRequest) (application.ProviderResourceStatus, error) {
	return application.ProviderResourceStatus{}, &domain.NotImplementedError{
		Component: "terraform aws provider stub",
		Step:      "compose the real AWS provider (terraform.NewAWS) instead",
	}
}

// DestroyHost implements application.HostProvider by refusing.
func (*Stub) DestroyHost(_ context.Context, _ application.ProviderDestroyRequest) error {
	return &domain.NotImplementedError{
		Component: "terraform aws provider stub",
		Step:      "compose the real AWS provider (terraform.NewAWS) instead",
	}
}
