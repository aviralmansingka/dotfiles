// Package provider defines the minimal contract a compute provider must satisfy to
// take part in host provisioning, and the AWS implementation of it.
//
// The contract is deliberately five operations and no more. Together they are the
// complete surface the provisioning lifecycle needs, and nothing else:
//
//	create             allocate a resource for one host
//	status             report whether that resource exists, and how to reach it
//	destroy            release it
//	bootstrap-address  how a first-contact step reaches the machine
//	trusted-host-key   which host key that machine is expected to present
//
// Anything a specific cloud needs beyond these belongs to its own adapter, not to
// the contract: a provider that has to be asked about VPCs, subnets, or IAM in the
// shared vocabulary would make every other provider implement those concepts too.
//
// Only AWS is implemented. A local VM provider and the other clouds are
// deliberately absent: they are the reason the seam exists, and they are not built.
// NewUnimplemented supplies a provider that satisfies the interface and refuses
// every call, so a half-wired provider fails at the first operation instead of
// reporting success.
package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// Errors the contract reports. They are typed so a caller can branch on them
// without reading a message.
var (
	// ErrNotRecorded reports that the provider holds no state for this host: it was
	// never created here, or it has already been destroyed. It is never treated as
	// a failure of an idempotent destroy.
	ErrNotRecorded = errors.New("provider: no resource is recorded for this host")
	// ErrHostKeyNotRecorded reports that no trusted host key has been recorded for
	// the resource. A caller must not connect on an unverified key, so this is an
	// error and not an empty value.
	ErrHostKeyNotRecorded = errors.New("provider: no trusted host key has been recorded for this host")
	// ErrUnsupportedTransport reports that a provider cannot name a transport for
	// its bootstrap address, which means no first-contact path exists.
	ErrUnsupportedTransport = errors.New("provider: this provider exposes no bootstrap transport")
)

// Transport names how a bootstrap step reaches a machine. It is the address
// family, not a port: a provider that reaches a host over a control plane has no
// routable address at all.
type Transport string

const (
	// TransportSSM is the AWS Systems Manager control plane. The address is the
	// instance id, IAM authorizes the call, and no inbound port exists.
	TransportSSM Transport = "ssm"
)

// CreateRequest is what a provider receives to allocate one host. Every value is
// already resolved server-side from the approved catalog: the provider re-derives
// the shape from Profile and Size rather than trusting InstanceType and DiskGB.
type CreateRequest struct {
	HostID       string
	Name         string
	Provider     domain.Provider
	Profile      string
	Region       string
	Size         string
	InstanceType string
	DiskGB       int
	Tags         map[string]string
}

// DestroyRequest identifies the resource to release. Profile and Size are
// required because a per-host state object needs the same variable set it was
// created with.
type DestroyRequest struct {
	HostID     string
	Name       string
	Provider   domain.Provider
	Profile    string
	Region     string
	Size       string
	ResourceID string
}

// StatusRequest asks whether one host's resource still exists. It carries exactly
// the values that address a per-host state object, and nothing else, so a status
// call can never be widened into someone else's state.
type StatusRequest struct {
	HostID     string
	Name       string
	Provider   domain.Provider
	Profile    string
	Region     string
	Size       string
	ResourceID string
}

// ResourceStatus is the provider's answer about one host.
type ResourceStatus struct {
	// Exists reports whether the provider currently holds a resource for the host.
	Exists bool
	// ResourceID is the provider's public identity, empty when Exists is false.
	ResourceID string
	// PrivateAddress is metadata, not a transport: no provisioning step connects to
	// it.
	PrivateAddress string
}

// BootstrapRequest asks how a first-contact step reaches one host.
type BootstrapRequest struct {
	HostID     string
	Name       string
	Profile    string
	Region     string
	Size       string
	ResourceID string
}

// BootstrapAddress is the first-contact path to a machine.
type BootstrapAddress struct {
	// Transport is the address family.
	Transport Transport
	// Address is the identifier inside that transport. For TransportSSM it is the
	// instance id: the control plane authorizes the call, so the value is not a
	// secret and confers no access on its own.
	Address string
	// PrivateAddress is the machine's private IP, as metadata.
	PrivateAddress string
}

// HostKeyRequest asks which host key one resource is expected to present.
type HostKeyRequest struct {
	HostID     string
	Name       string
	ResourceID string
}

// HostKey is the SSH host key a machine is expected to present.
//
// It cannot be derived from provider state. A host key is generated on the machine
// at first boot, so the value is whatever the bootstrap step observed and recorded.
// The contract exposes it because a caller that connects to a machine has to have
// something to compare against, and "trust the first key you see" is not an answer.
type HostKey struct {
	// Algorithm is the key type, for example ssh-ed25519.
	Algorithm string
	// Fingerprint is the SHA256 fingerprint, in the form ssh-keygen writes.
	Fingerprint string
	// Known is false only when the caller asked for a key that was never recorded
	// and the implementation chooses to report that as a value rather than
	// ErrHostKeyNotRecorded.
	Known bool
}

// Contract is the minimal provider surface.
//
// The five methods must be idempotent in the two places the lifecycle retries:
// Destroy of a resource that is already gone reports success, and Create for a
// host that already has a resource adopts it instead of allocating a second one.
// Those two properties are what make a retried workflow safe, so they are part of
// the contract rather than an implementation detail.
type Contract interface {
	Create(ctx context.Context, req CreateRequest) (ports.ProviderResource, error)
	Status(ctx context.Context, req StatusRequest) (ResourceStatus, error)
	Destroy(ctx context.Context, req DestroyRequest) error
	BootstrapAddress(ctx context.Context, req BootstrapRequest) (BootstrapAddress, error)
	TrustedHostKey(ctx context.Context, req HostKeyRequest) (HostKey, error)
}

// Unimplemented is a provider that satisfies the contract and refuses every call.
// It exists so an unbuilt provider (a local VM backend, another cloud) can be named
// in configuration without any risk of it silently reporting success.
type Unimplemented struct {
	// Name is the provider being refused, used in the refusal message.
	Name string
}

var _ Contract = (*Unimplemented)(nil)

// NewUnimplemented builds a refusing provider.
func NewUnimplemented(name string) *Unimplemented { return &Unimplemented{Name: name} }

func (u *Unimplemented) refusal(operation string) error {
	name := strings.TrimSpace(u.Name)
	if name == "" {
		name = "this provider"
	}
	return &domain.NotImplementedError{
		Component: name + " provider",
		Step:      fmt.Sprintf("%s is not implemented; only AWS is", operation),
	}
}

// Create implements Contract by refusing.
func (u *Unimplemented) Create(context.Context, CreateRequest) (ports.ProviderResource, error) {
	return ports.ProviderResource{}, u.refusal("create")
}

// Status implements Contract by refusing.
func (u *Unimplemented) Status(context.Context, StatusRequest) (ResourceStatus, error) {
	return ResourceStatus{}, u.refusal("status")
}

// Destroy implements Contract by refusing.
func (u *Unimplemented) Destroy(context.Context, DestroyRequest) error {
	return u.refusal("destroy")
}

// BootstrapAddress implements Contract by refusing.
func (u *Unimplemented) BootstrapAddress(context.Context, BootstrapRequest) (BootstrapAddress, error) {
	return BootstrapAddress{}, u.refusal("bootstrap-address")
}

// TrustedHostKey implements Contract by refusing.
func (u *Unimplemented) TrustedHostKey(context.Context, HostKeyRequest) (HostKey, error) {
	return HostKey{}, u.refusal("trusted-host-key")
}
