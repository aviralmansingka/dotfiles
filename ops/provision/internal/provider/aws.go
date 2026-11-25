package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// HostKeySource supplies the host key that was observed and recorded for a host.
//
// The provider cannot derive it: a host key is generated on the machine at first
// boot. Whatever verified it first — the bootstrap step, over the control plane —
// is what records it here, and this is the only question the contract asks that a
// cloud API cannot answer on its own.
type HostKeySource interface {
	// TrustedHostKey returns the recorded key. found is false when nothing has been
	// recorded for this host.
	TrustedHostKey(ctx context.Context, hostID, resourceID string) (HostKey, bool, error)
}

// AWSIdentity implements Contract for the AWS EC2 provider. It is a thin
// composition, and that is the point: the five operations are all it offers, so a
// caller written against Contract cannot reach into the Terraform adapter's
// specifics.
type AWSIdentity struct {
	base  application.HostProvider
	hosts HostKeySource
}

var _ Contract = (*AWSIdentity)(nil)

// NewAWSIdentity builds the contract adapter over the AWS provider port and the
// host-key source. Both are required: without the provider nothing can be
// allocated, and without the key source the trusted-host-key operation would have
// to invent an answer.
func NewAWSIdentity(base application.HostProvider, hosts HostKeySource) (*AWSIdentity, error) {
	if base == nil {
		return nil, errors.New("provider: aws host provider is required")
	}
	if hosts == nil {
		return nil, errors.New("provider: host key source is required")
	}
	return &AWSIdentity{base: base, hosts: hosts}, nil
}

// Create allocates, or adopts the allocation this host already owns. The adoption
// decision lives in the provider port, so a retried create cannot allocate twice.
func (a *AWSIdentity) Create(ctx context.Context, req CreateRequest) (application.ProviderResource, error) {
	return a.base.CreateHost(ctx, application.ProviderCreateRequest{
		HostID:       req.HostID,
		Name:         req.Name,
		Provider:     req.Provider,
		Profile:      req.Profile,
		Region:       req.Region,
		Size:         req.Size,
		InstanceType: req.InstanceType,
		DiskGB:       req.DiskGB,
		Tags:         req.Tags,
	})
}

// Status reports whether this host's resource still exists. Never ErrNotRecorded:
// "it does not exist" is the answer, not an error.
func (a *AWSIdentity) Status(ctx context.Context, req StatusRequest) (ResourceStatus, error) {
	status, err := a.base.StatusHost(ctx, application.ProviderStatusRequest{
		HostID:     req.HostID,
		Name:       req.Name,
		Provider:   req.Provider,
		Profile:    req.Profile,
		Region:     req.Region,
		Size:       req.Size,
		ResourceID: req.ResourceID,
	})
	if err != nil {
		return ResourceStatus{}, err
	}
	return ResourceStatus{
		Exists:         status.Exists,
		ResourceID:     status.ResourceID,
		PrivateAddress: status.PrivateAddress,
	}, nil
}

// Destroy releases this host's resource. Destroying one that is already gone is
// success, which keeps a retried teardown idempotent.
func (a *AWSIdentity) Destroy(ctx context.Context, req DestroyRequest) error {
	return a.base.DestroyHost(ctx, application.ProviderDestroyRequest{
		HostID:     req.HostID,
		Name:       req.Name,
		Provider:   req.Provider,
		Profile:    req.Profile,
		Region:     req.Region,
		Size:       req.Size,
		ResourceID: req.ResourceID,
	})
}

// BootstrapAddress names the control-plane path to the host.
//
// The AWS provider has no routable bootstrap address by design: enrollment runs
// over SSM, IAM authorizes each call against exactly one instance id, and no
// inbound port exists. The instance id is the address, and it is not a credential:
// presenting it confers nothing without the worker's own IAM identity.
func (a *AWSIdentity) BootstrapAddress(ctx context.Context, req BootstrapRequest) (BootstrapAddress, error) {
	instanceID := strings.TrimSpace(req.ResourceID)
	if instanceID == "" {
		// Fall back to recorded state rather than to a guess. A bootstrap address
		// invented from a name would address whatever happens to hold that name.
		status, err := a.Status(ctx, StatusRequest{
			HostID:   req.HostID,
			Name:     req.Name,
			Provider: domain.ProviderAWS,
			Profile:  req.Profile,
			Region:   req.Region,
			Size:     req.Size,
		})
		if err != nil {
			return BootstrapAddress{}, err
		}
		if !status.Exists {
			return BootstrapAddress{}, fmt.Errorf("%w: host %s", ErrNotRecorded, req.HostID)
		}
		instanceID = status.ResourceID
	}
	if instanceID == "" {
		return BootstrapAddress{}, fmt.Errorf("%w: host %s", ErrUnsupportedTransport, req.HostID)
	}
	return BootstrapAddress{
		Transport: TransportSSM,
		Address:   instanceID,
	}, nil
}

// TrustedHostKey returns the key the bootstrap step recorded for this resource.
// Nothing recorded means the caller has nothing to verify against, and that is an
// error rather than an empty value: connecting anyway would be trusting whatever
// answers.
func (a *AWSIdentity) TrustedHostKey(ctx context.Context, req HostKeyRequest) (HostKey, error) {
	key, found, err := a.hosts.TrustedHostKey(ctx, req.HostID, req.ResourceID)
	if err != nil {
		return HostKey{}, err
	}
	if !found || strings.TrimSpace(key.Fingerprint) == "" {
		return HostKey{}, fmt.Errorf("%w: host %s", ErrHostKeyNotRecorded, req.HostID)
	}
	key.Known = true
	return key, nil
}
