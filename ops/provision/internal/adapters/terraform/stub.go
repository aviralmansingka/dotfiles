// Package terraform holds the AWS EC2 compute-provider adapter. S01 ships only
// a stub: S02 replaces it with the isolated per-host Terraform entry point.
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
		Component: "terraform aws provider",
		Step:      "S02 creates ops/provision/terraform/aws",
	}
}

// DestroyHost implements application.HostProvider by refusing.
func (*Stub) DestroyHost(_ context.Context, _ application.ProviderDestroyRequest) error {
	return &domain.NotImplementedError{
		Component: "terraform aws provider",
		Step:      "S02 creates ops/provision/terraform/aws",
	}
}
