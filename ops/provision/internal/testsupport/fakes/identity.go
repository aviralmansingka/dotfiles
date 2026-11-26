package fakes

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/hostsession"
)

// IdentityBackend is an in-process fake of the OpenBao identity mechanics. It
// reproduces the three properties the use case depends on: a role name is claimed
// by exactly one host, a SecretID is only ever handed out response-wrapped, and a
// token that was already issued survives the deletion of its AppRole until it is
// revoked by accessor. That last one is the whole reason revocation enumerates
// accessors rather than trusting the role deletion.
type IdentityBackend struct {
	mu        sync.Mutex
	policies  map[string]application.IdentityPolicy
	roles     map[string]application.IdentityRole
	claims    map[string]string
	tokens    map[string]application.TokenAccessorInfo
	accessor  int
	mints     []string
	revoked   []string
	err       error
	mintErr   error
	lookupErr error
	revokeErr error
	wrapTok   string
}

// NewIdentityBackend builds an empty backend.
func NewIdentityBackend() *IdentityBackend {
	return &IdentityBackend{
		policies: map[string]application.IdentityPolicy{},
		roles:    map[string]application.IdentityRole{},
		claims:   map[string]string{},
		tokens:   map[string]application.TokenAccessorInfo{},
	}
}

var _ application.IdentityBackend = (*IdentityBackend)(nil)

// FailWith makes every call fail.
func (b *IdentityBackend) FailWith(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.err = err
}

// FailMints makes SecretID minting fail.
func (b *IdentityBackend) FailMints(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.mintErr = err
}

// SetWrapToken fixes the wrapping token value the backend hands out, so a test can
// follow one exact value through delivery and assert it reaches no record.
func (b *IdentityBackend) SetWrapToken(value string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.wrapTok = value
}

// SeedRoleClaim records that roleName is already bound to hostID. A test uses it
// to model a role that exists outside this service, or an inventory restored from
// a backup, and prove a second host is refused.
func (b *IdentityBackend) SeedRoleClaim(roleName, hostID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.claims[roleName] = hostID
}

// EnsurePolicy implements application.IdentityBackend.
func (b *IdentityBackend) EnsurePolicy(_ context.Context, policy application.IdentityPolicy) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return b.err
	}
	b.policies[policy.Name] = policy
	return nil
}

// EnsureAppRole implements application.IdentityBackend.
func (b *IdentityBackend) EnsureAppRole(_ context.Context, role application.IdentityRole) (application.IdentityRoleState, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return application.IdentityRoleState{}, b.err
	}
	if claimed, ok := b.claims[role.Name]; ok && claimed != role.HostID {
		return application.IdentityRoleState{}, &domain.RoleClaimError{
			RoleName:    role.Name,
			ClaimedHost: claimed,
			RequestedBy: role.HostID,
		}
	}
	existing, exists := b.roles[role.Name]
	if exists && existing.PolicyName != role.PolicyName {
		return application.IdentityRoleState{}, &domain.RoleClaimError{
			RoleName:    role.Name,
			ClaimedHost: existing.HostID,
			RequestedBy: role.HostID,
		}
	}
	b.claims[role.Name] = role.HostID
	b.roles[role.Name] = role
	return application.IdentityRoleState{Name: role.Name, HostID: role.HostID, Exists: exists}, nil
}

// MintWrappedSecretID implements application.IdentityBackend. It generates a
// SecretID, keeps it on the fake's side, and returns only a wrapping token: the
// caller never sees the value.
func (b *IdentityBackend) MintWrappedSecretID(_ context.Context, roleName string, spec application.IdentityWrapSpec) (application.WrappedSecretID, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return application.WrappedSecretID{}, b.err
	}
	if b.mintErr != nil {
		return application.WrappedSecretID{}, b.mintErr
	}
	b.accessor++
	ttl := spec.TTL
	if ttl <= 0 {
		ttl = domain.BootstrapWrapTTL
	}
	b.mints = append(b.mints, roleName)
	value := b.wrapTok
	if value == "" {
		value = fmt.Sprintf("wrap-token-%s-%04d", roleName, b.accessor)
	}
	return application.WrappedSecretID{
		WrapToken: application.NewSecret("fake:wrap-token", []byte(value)),
		Accessor:  fmt.Sprintf("accessor-%04d", b.accessor),
		TTL:       ttl,
	}, nil
}

// DeleteAppRole implements application.IdentityBackend.
func (b *IdentityBackend) DeleteAppRole(_ context.Context, roleName string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return b.err
	}
	delete(b.roles, roleName)
	delete(b.claims, roleName)
	return nil
}

// DeletePolicy implements application.IdentityBackend.
func (b *IdentityBackend) DeletePolicy(_ context.Context, name string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return b.err
	}
	delete(b.policies, name)
	return nil
}

// ListTokenAccessors implements application.IdentityBackend.
func (b *IdentityBackend) ListTokenAccessors(_ context.Context) ([]string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return nil, b.err
	}
	if b.lookupErr != nil {
		return nil, b.lookupErr
	}
	accessors := make([]string, 0, len(b.tokens))
	for accessor := range b.tokens {
		accessors = append(accessors, accessor)
	}
	// Deterministic order: a test asserts the exact revocation sequence.
	for i := 1; i < len(accessors); i++ {
		for j := i; j > 0 && accessors[j] < accessors[j-1]; j-- {
			accessors[j], accessors[j-1] = accessors[j-1], accessors[j]
		}
	}
	return accessors, nil
}

// LookupTokenAccessor implements application.IdentityBackend. A token that is
// gone is reported as not found rather than as an error, exactly as the real
// server reports an expired token.
func (b *IdentityBackend) LookupTokenAccessor(_ context.Context, accessor string) (application.TokenAccessorInfo, bool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return application.TokenAccessorInfo{}, false, b.err
	}
	if b.lookupErr != nil {
		return application.TokenAccessorInfo{}, false, b.lookupErr
	}
	info, ok := b.tokens[accessor]
	return info, ok, nil
}

// RevokeTokenAccessor implements application.IdentityBackend.
func (b *IdentityBackend) RevokeTokenAccessor(_ context.Context, accessor string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.revokeErr != nil {
		return b.revokeErr
	}
	if b.err != nil {
		return b.err
	}
	delete(b.tokens, accessor)
	b.revoked = append(b.revoked, accessor)
	return nil
}

// IssueToken records an already-issued token carrying policies, which is what a
// host that logged in before a teardown holds. It returns the accessor so a test
// can assert on the exact value.
func (b *IdentityBackend) IssueToken(policies ...string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.accessor++
	accessor := fmt.Sprintf("accessor-%04d", b.accessor)
	b.tokens[accessor] = application.TokenAccessorInfo{
		Accessor: accessor,
		Policies: append([]string(nil), policies...),
	}
	return accessor
}

// IssueAppRoleToken records an issued token carrying the AppRole's own policy set
// plus the default policy, which is what a real AppRole login produces.
func (b *IdentityBackend) IssueAppRoleToken(roleName string, defaults ...string) string {
	policies := append([]string(nil), defaults...)
	if role, ok := b.roles[roleName]; ok {
		policies = append(policies, role.PolicyName)
	}
	return b.IssueToken(policies...)
}

// Tokens returns the accessor of every token that is still valid.
func (b *IdentityBackend) Tokens() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	accessors := make([]string, 0, len(b.tokens))
	for accessor := range b.tokens {
		accessors = append(accessors, accessor)
	}
	return accessors
}

// Revoked returns the accessors this backend invalidated, in the order they were
// revoked.
func (b *IdentityBackend) Revoked() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.revoked...)
}

// FailRevokes makes every accessor revocation fail, which models a management
// token without `sudo` on auth/token/revoke-accessor.
func (b *IdentityBackend) FailRevokes(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.revokeErr = err
}

// FailLookups makes listing and looking up token accessors fail.
func (b *IdentityBackend) FailLookups(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lookupErr = err
}

// FailListTokenAccessors makes listing token accessors fail while leaving lookup
// and revocation alone, which is the shape of a management token that lacks
// `sudo` on auth/token/accessors.
func (b *IdentityBackend) FailListTokenAccessors(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lookupErr = err
}

// Policy returns the stored policy for a name.
func (b *IdentityBackend) Policy(name string) (application.IdentityPolicy, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	policy, ok := b.policies[name]
	return policy, ok
}

// PolicyNames returns the stored policy names.
func (b *IdentityBackend) PolicyNames() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return sortedKeys(b.policies)
}

// Role returns the stored role for a name.
func (b *IdentityBackend) Role(name string) (application.IdentityRole, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	role, ok := b.roles[name]
	return role, ok
}

// RoleNames returns the stored role names.
func (b *IdentityBackend) RoleNames() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return sortedKeys(b.roles)
}

// Mints returns the role names a SecretID was minted for.
func (b *IdentityBackend) Mints() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.mints...)
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	// Small maps; a plain insertion sort keeps the helper dependency-free.
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// Bootstrap is a fake BootstrapDelivery. It records the material it was given so
// a test can assert the delivery happened, and it keeps the token in a Secret so
// an accidental format verb prints a placeholder.
type Bootstrap struct {
	mu         sync.Mutex
	deliveries []application.BootstrapMaterial
	paths      []string
	err        error
}

// NewBootstrap builds an empty fake delivery.
func NewBootstrap() *Bootstrap { return &Bootstrap{} }

var _ application.BootstrapDelivery = (*Bootstrap)(nil)

// FailWith makes every delivery fail.
func (b *Bootstrap) FailWith(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.err = err
}

// DeliverBootstrap implements application.BootstrapDelivery.
func (b *Bootstrap) DeliverBootstrap(_ context.Context, material application.BootstrapMaterial) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.err != nil {
		return "", b.err
	}
	b.deliveries = append(b.deliveries, material)
	path := fmt.Sprintf("bootstrap/%s/approle-wrap-token", material.HostID)
	b.paths = append(b.paths, path)
	return path, nil
}

// Deliveries returns the delivered material.
func (b *Bootstrap) Deliveries() []application.BootstrapMaterial {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]application.BootstrapMaterial(nil), b.deliveries...)
}

// Paths returns the delivered paths.
func (b *Bootstrap) Paths() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.paths...)
}

// HostSessions is a fake HostSessionClient: one-use unwrap, a configurable login
// and renewal TTL, and rotation. It holds no real credential and makes no network
// call.
type HostSessions struct {
	mu            sync.Mutex
	issued        map[string]string
	consumed      map[string]bool
	loginTTL      time.Duration
	renewTTL      time.Duration
	renewable     bool
	accessors     int
	unwraps       int
	logins        []string
	rotations     []string
	err           error
	unwrapErr     error
	issuesSession int
}

// NewHostSessions builds a fake host-side client with a 10 minute login TTL.
func NewHostSessions() *HostSessions {
	return &HostSessions{
		issued:    map[string]string{},
		consumed:  map[string]bool{},
		loginTTL:  10 * time.Minute,
		renewTTL:  5 * time.Minute,
		renewable: true,
	}
}

var _ hostsession.HostSessionClient = (*HostSessions)(nil)

// IssueWrapToken registers a wrapping token that unwraps to a fake SecretID.
func (h *HostSessions) IssueWrapToken(wrapToken string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.issued[wrapToken] = "secret-id-value"
}

// SetLoginTTL changes the lifetime a login reports.
func (h *HostSessions) SetLoginTTL(ttl time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.loginTTL = ttl
}

// SetRenewTTL changes the lifetime a renewal reports.
func (h *HostSessions) SetRenewTTL(ttl time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.renewTTL = ttl
}

// SetRenewable changes whether issued sessions report as renewable.
func (h *HostSessions) SetRenewable(renewable bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.renewable = renewable
}

// FailWith makes every call fail.
func (h *HostSessions) FailWith(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.err = err
}

// FailUnwrap makes unwrapping fail.
func (h *HostSessions) FailUnwrap(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.unwrapErr = err
}

// UnwrapSecretID implements hostsession.HostSessionClient. A wrapping token that
// was already consumed is refused before anything else, which is the replay
// guard.
func (h *HostSessions) UnwrapSecretID(_ context.Context, wrapToken application.Secret) (application.Secret, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.err != nil {
		return application.Secret{}, h.err
	}
	if h.unwrapErr != nil {
		return application.Secret{}, h.unwrapErr
	}
	value := string(wrapToken.Bytes())
	if h.consumed[value] {
		return application.Secret{}, &domain.WrapTokenConsumedError{}
	}
	secretID, ok := h.issued[value]
	if !ok {
		return application.Secret{}, fmt.Errorf("fake host sessions: unknown wrapping token")
	}
	h.consumed[value] = true
	h.unwraps++
	return application.NewSecret("fake:secret-id", []byte(secretID)), nil
}

// Login implements hostsession.HostSessionClient.
func (h *HostSessions) Login(_ context.Context, roleID string, secretID application.Secret) (hostsession.HostSession, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.err != nil {
		return hostsession.HostSession{}, h.err
	}
	if secretID.Empty() {
		return hostsession.HostSession{}, fmt.Errorf("fake host sessions: login without a secret id")
	}
	h.logins = append(h.logins, roleID)
	h.issuesSession++
	return hostsession.HostSession{
		Token:     application.NewSecret("fake:session", []byte(fmt.Sprintf("session-token-%04d", h.issuesSession))),
		TTL:       h.loginTTL,
		Renewable: h.renewable,
		Accessor:  fmt.Sprintf("token-accessor-%04d", h.issuesSession),
	}, nil
}

// RenewSelf implements hostsession.HostSessionClient.
func (h *HostSessions) RenewSelf(_ context.Context, token application.Secret) (hostsession.HostSession, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.err != nil {
		return hostsession.HostSession{}, h.err
	}
	if token.Empty() {
		return hostsession.HostSession{}, fmt.Errorf("fake host sessions: renewal without a token")
	}
	h.issuesSession++
	return hostsession.HostSession{
		Token:     application.NewSecret("fake:session", []byte(fmt.Sprintf("session-token-%04d", h.issuesSession))),
		TTL:       h.renewTTL,
		Renewable: h.renewable,
		Accessor:  fmt.Sprintf("token-accessor-%04d", h.issuesSession),
	}, nil
}

// RotateSecretID implements hostsession.HostSessionClient.
func (h *HostSessions) RotateSecretID(_ context.Context, roleName, previousAccessor string) (application.WrappedSecretID, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.err != nil {
		return application.WrappedSecretID{}, h.err
	}
	h.rotations = append(h.rotations, roleName+"|"+previousAccessor)
	h.accessors++
	return application.WrappedSecretID{
		WrapToken: application.NewSecret("fake:wrap-token", []byte(fmt.Sprintf("rotate-wrap-%04d", h.accessors))),
		Accessor:  fmt.Sprintf("rotated-accessor-%04d", h.accessors),
		TTL:       domain.BootstrapWrapTTL,
	}, nil
}

// LoginCount reports how many logins ran.
func (h *HostSessions) LoginCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.logins)
}

// UnwrapCount reports how many unwraps succeeded.
func (h *HostSessions) UnwrapCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.unwraps
}

// Rotations returns the rotation calls, as role|accessor.
func (h *HostSessions) Rotations() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.rotations...)
}
