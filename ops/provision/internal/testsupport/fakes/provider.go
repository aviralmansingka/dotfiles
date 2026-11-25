// Package fakes holds in-process substitutes for the ports the tree depends on.
//
// Nothing here touches a network, a cloud API, a multiplexer, or a real credential.
// Each fake reproduces the properties the production adapter is relied on for, and
// records what it was asked to do so a test can assert on the call pattern rather
// than only on the outcome.
package fakes

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/provider"
)

// Provider is an in-memory compute provider. It implements the five-operation
// provider contract, so it is interchangeable with the AWS adapter in any test that
// exercises the contract surface.
//
// It models the two retry properties the contract requires: Create for a host that
// already owns a resource adopts it instead of allocating a second one, and Destroy
// of a resource that is already gone reports success.
type Provider struct {
	mu        sync.Mutex
	resources map[string]application.ProviderResource // keyed by host id
	names     map[string]string                       // host id -> host name
	keys      map[string]provider.HostKey             // keyed by host id
	creates   int
	allocates int
	destroys  int
	statuses  int
	refusals  []string
}

var (
	_ provider.Contract        = (*Provider)(nil)
	_ application.HostProvider = (*Provider)(nil)
)

// NewProvider builds an empty provider.
func NewProvider() *Provider {
	return &Provider{
		resources: map[string]application.ProviderResource{},
		names:     map[string]string{},
		keys:      map[string]provider.HostKey{},
	}
}

// RecordHostKey records the trusted host key the bootstrap step would have
// observed, so the trusted-host-key operation has something to return.
func (p *Provider) RecordHostKey(hostID, algorithm, fingerprint string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.keys[hostID] = provider.HostKey{Algorithm: algorithm, Fingerprint: fingerprint, Known: true}
}

// Create implements the contract. A second call for the same host adopts the first
// allocation and reports the same identity.
func (p *Provider) Create(_ context.Context, req provider.CreateRequest) (application.ProviderResource, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.creates++
	if existing, ok := p.resources[req.HostID]; ok {
		p.names[req.HostID] = req.Name
		return existing, nil
	}
	p.allocates++
	resource := application.ProviderResource{
		ResourceID:     fmt.Sprintf("i-%016d", p.allocates),
		PrivateAddress: fmt.Sprintf("10.99.1.%d", 10+p.allocates),
	}
	p.resources[req.HostID] = resource
	p.names[req.HostID] = req.Name
	return resource, nil
}

// Status implements the contract.
func (p *Provider) Status(_ context.Context, req provider.StatusRequest) (provider.ResourceStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.statuses++
	resource, ok := p.resources[req.HostID]
	if !ok {
		return provider.ResourceStatus{Exists: false}, nil
	}
	return provider.ResourceStatus{
		Exists:         true,
		ResourceID:     resource.ResourceID,
		PrivateAddress: resource.PrivateAddress,
	}, nil
}

// Destroy implements the contract. A resource that is already gone is success.
func (p *Provider) Destroy(_ context.Context, req provider.DestroyRequest) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	existing, ok := p.resources[req.HostID]
	if !ok {
		return nil
	}
	// The ownership check the real adapter performs: a request that names a
	// different instance than the record does is refused, not destroyed.
	if req.ResourceID != "" && existing.ResourceID != req.ResourceID {
		p.refusals = append(p.refusals, fmt.Sprintf("destroy refused for %s: state holds %s, record says %s", req.HostID, existing.ResourceID, req.ResourceID))
		return fmt.Errorf("fake provider: host %q state holds %q, not the recorded %q; refusing to destroy",
			req.Name, existing.ResourceID, req.ResourceID)
	}
	p.destroys++
	delete(p.resources, req.HostID)
	return nil
}

// BootstrapAddress implements the contract: the control plane plus the instance id.
func (p *Provider) BootstrapAddress(_ context.Context, req provider.BootstrapRequest) (provider.BootstrapAddress, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	resource, ok := p.resources[req.HostID]
	if !ok {
		return provider.BootstrapAddress{}, fmt.Errorf("%w: host %s", provider.ErrNotRecorded, req.HostID)
	}
	return provider.BootstrapAddress{
		Transport:      provider.TransportSSM,
		Address:        resource.ResourceID,
		PrivateAddress: resource.PrivateAddress,
	}, nil
}

// TrustedHostKey implements the contract.
func (p *Provider) TrustedHostKey(_ context.Context, req provider.HostKeyRequest) (provider.HostKey, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	key, ok := p.keys[req.HostID]
	if !ok {
		return provider.HostKey{}, fmt.Errorf("%w: host %s", provider.ErrHostKeyNotRecorded, req.HostID)
	}
	return key, nil
}

// ---- application.HostProvider, so the fake can stand in for the Terraform adapter

// CreateHost implements application.HostProvider.
func (p *Provider) CreateHost(ctx context.Context, req application.ProviderCreateRequest) (application.ProviderResource, error) {
	return p.Create(ctx, provider.CreateRequest{
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

// StatusHost implements application.HostProvider.
func (p *Provider) StatusHost(ctx context.Context, req application.ProviderStatusRequest) (application.ProviderResourceStatus, error) {
	status, err := p.Status(ctx, provider.StatusRequest{
		HostID:     req.HostID,
		Name:       req.Name,
		Provider:   req.Provider,
		Profile:    req.Profile,
		Region:     req.Region,
		Size:       req.Size,
		ResourceID: req.ResourceID,
	})
	if err != nil {
		return application.ProviderResourceStatus{}, err
	}
	return application.ProviderResourceStatus{
		Exists:         status.Exists,
		ResourceID:     status.ResourceID,
		PrivateAddress: status.PrivateAddress,
	}, nil
}

// DestroyHost implements application.HostProvider.
func (p *Provider) DestroyHost(ctx context.Context, req application.ProviderDestroyRequest) error {
	return p.Destroy(ctx, provider.DestroyRequest{
		HostID:     req.HostID,
		Name:       req.Name,
		Provider:   req.Provider,
		Profile:    req.Profile,
		Region:     req.Region,
		Size:       req.Size,
		ResourceID: req.ResourceID,
	})
}

// ---- observation helpers

// Creates reports how many create calls arrived, adopted ones included.
func (p *Provider) Creates() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.creates
}

// Allocations reports how many resources were actually created.
func (p *Provider) Allocations() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.allocates
}

// Destroys reports how many resources were destroyed.
func (p *Provider) Destroys() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.destroys
}

// Statuses reports how many status calls arrived.
func (p *Provider) Statuses() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.statuses
}

// Resource returns the resource for a host, if it still exists.
func (p *Provider) Resource(hostID string) (application.ProviderResource, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	resource, ok := p.resources[hostID]
	return resource, ok
}

// HostIDs returns the hosts that still own a resource, sorted.
func (p *Provider) HostIDs() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	ids := make([]string, 0, len(p.resources))
	for id := range p.resources {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Refusals returns the ownership refusals the provider issued.
func (p *Provider) Refusals() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.refusals...)
}

// ErrNoResource is returned by helpers that require a resource to exist.
var ErrNoResource = errors.New("fake provider: no resource")
