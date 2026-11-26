package ports

import (
	"context"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// IdentityPolicy is one ACL policy document, already rendered by the domain.
// Document is policy text; it contains paths and capabilities, never a value.
//
// The identity contracts live here rather than in the use-case package so an
// adapter can implement them without importing the use cases. No credential value
// crosses any of them in the clear.
type IdentityPolicy struct {
	Name     string
	HostID   string
	Document string
}

// IdentityRole is the AppRole definition for one host. Every lifetime is derived
// from the domain policy types, and HostID is the claim that makes the role
// unusable by any other host.
type IdentityRole struct {
	Name       string
	HostID     string
	HostName   string
	PolicyName string
	TokenTTL   time.Duration
	TokenMax   time.Duration
	Renewable  bool
	// SecretIDTTL and SecretIDUses describe the rotating login SecretID. The
	// one-use bootstrap SecretID is minted separately and is not part of the role
	// definition.
	SecretIDTTL  time.Duration
	SecretIDUses int
}

// IdentityRoleState is what the backend found or created for a role.
type IdentityRoleState struct {
	Name string
	// HostID is the claim the existing role carries. A different claim is a
	// refusal, not an update.
	HostID string
	Exists bool
}

// IdentityWrapSpec is the response-wrapping request for one SecretID.
type IdentityWrapSpec struct {
	TTL time.Duration
}

// WrappedSecretID is a minted SecretID that has never been seen in the clear: the
// backend wraps it server-side and returns only the wrapping token.
//
// There is deliberately no SecretID field anywhere on this type. The value only
// exists inside OpenBao until the host unwraps it.
type WrappedSecretID struct {
	// WrapToken is the one-use token that unwraps the SecretID. It is a Secret so
	// no format verb or JSON encoder can print it.
	WrapToken domain.Secret
	// Accessor identifies the SecretID for rotation and revocation without
	// revealing it.
	Accessor string
	// TTL is how long the wrapping token is valid.
	TTL time.Duration
}

// TokenAccessorInfo is what OpenBao reports about one issued token, without the
// token value. Policies is the only field this service decides on.
type TokenAccessorInfo struct {
	Accessor string
	Policies []string
}

// RevocationReport is the outcome of one full host revocation. Every field
// describes something this call actually did, so a caller can tell "revoked" from
// "there was nothing to revoke" without reading a log.
type RevocationReport struct {
	// TokensRevoked is how many already-issued token accessors this call
	// invalidated. It is a count: no accessor or token value is ever returned.
	TokensRevoked int
	// TokensRemaining is how many accessors still carry this host's policy when
	// the call finished. A non-zero value is a partial revocation and the caller
	// must report it as incomplete.
	TokensRemaining int
	// CredentialsDeleted records that the AppRole (and with it every SecretID)
	// is gone, so no future login can succeed.
	CredentialsDeleted bool
	// PolicyDeleted records that the host's ACL policy is gone.
	PolicyDeleted bool
}

// TokenRevocation is one token-revocation pass.
type TokenRevocation struct {
	Revoked   int
	Remaining int
}

// CredentialRevocation is one login-credential revocation pass.
type CredentialRevocation struct {
	// RoleDeleted records that the AppRole is gone, which also deletes every
	// SecretID belonging to it.
	RoleDeleted bool
	// PolicyDeleted records that the host's ACL policy is gone.
	PolicyDeleted bool
}

// IdentityBackend is the OpenBao mechanics port: policies, AppRoles,
// response-wrapped SecretIDs, and token revocation. It is implemented by the
// openbao adapter and by an in-process fake in tests.
//
// EnsureAppRole must refuse a role whose claim belongs to another host
// (domain.RoleClaimError) and must be idempotent for the same host.
//
// The token methods exist because deleting an AppRole does not invalidate a token
// that was already issued. OpenBao has no "revoke every token of this role"
// endpoint, so revocation lists accessors, looks each one up, and revokes the
// ones carrying this host's policy. ListTokenAccessors therefore needs the
// management token to hold `sudo` on auth/token/accessors.
type IdentityBackend interface {
	EnsurePolicy(ctx context.Context, policy IdentityPolicy) error
	EnsureAppRole(ctx context.Context, role IdentityRole) (IdentityRoleState, error)
	MintWrappedSecretID(ctx context.Context, roleName string, spec IdentityWrapSpec) (WrappedSecretID, error)
	DeleteAppRole(ctx context.Context, roleName string) error
	DeletePolicy(ctx context.Context, name string) error
	// ListTokenAccessors returns the accessor of every issued token. An accessor
	// identifies a token for revocation without revealing it.
	ListTokenAccessors(ctx context.Context) ([]string, error)
	// LookupTokenAccessor reports the policies one accessor carries. A token that
	// expired between listing and lookup is reported as not found, not as an
	// error.
	LookupTokenAccessor(ctx context.Context, accessor string) (TokenAccessorInfo, bool, error)
	// RevokeTokenAccessor invalidates one issued token. Revoking an accessor that
	// is already gone is success, so revocation is idempotent.
	RevokeTokenAccessor(ctx context.Context, accessor string) error
}

// BootstrapMaterial is the out-of-band delivery of one wrapping token. It is the
// only type that carries the token, and it is never a job payload, a workflow
// input, an activity result, or a log field.
type BootstrapMaterial struct {
	HostID  string
	RoleID  string
	WrapTok domain.Secret
	TTL     time.Duration
}

// BootstrapDelivery writes bootstrap material where the host can read it: a
// mode-0600 file outside the Nix store, Git, Terraform state, and job records.
type BootstrapDelivery interface {
	// DeliverBootstrap stores the wrapping token and returns a path an operator
	// can name. The path is safe to log; the token is not.
	DeliverBootstrap(ctx context.Context, material BootstrapMaterial) (string, error)
}
