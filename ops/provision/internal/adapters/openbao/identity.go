package openbao

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// IdentityConfig locates the management API and the token file. Every field is a
// path, a URL, or a lifetime: no credential value has a field here.
type IdentityConfig struct {
	// Address is the OpenBao base URL, for example http://127.0.0.1:8200.
	Address string
	// TokenFile is a mode-0600 file holding the management token. It is read once
	// at construction, never at call time and never from the environment.
	TokenFile string
	// Namespace is optional (OpenBao Enterprise namespaces).
	Namespace string
	// HTTP defaults to a client with a bounded timeout.
	HTTP HTTPClient
	// Timeout bounds one call. Defaults to 10s.
	Timeout time.Duration
}

// IdentityAdmin implements application.IdentityBackend against OpenBao's policy,
// AppRole, and KV APIs. It decides nothing: every name, policy document, and
// lifetime comes from the domain, and the SecretID it mints is wrapped
// server-side, so the value exists only inside OpenBao until the host unwraps it.
type IdentityAdmin struct {
	client *baoClient
}

var _ application.IdentityBackend = (*IdentityAdmin)(nil)

// NewIdentityAdmin reads the management token once and builds the adapter.
func NewIdentityAdmin(cfg IdentityConfig) (*IdentityAdmin, error) {
	client, err := newBaoClient(cfg.Address, cfg.Namespace, cfg.HTTP, cfg.Timeout)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.TokenFile) == "" {
		return nil, errors.New("openbao: token file path is required")
	}
	raw, err := os.ReadFile(cfg.TokenFile)
	if err != nil {
		return nil, fmt.Errorf("openbao: read token file: %w", err)
	}
	token := strings.TrimSpace(string(raw))
	clear(raw)
	if token == "" {
		return nil, errors.New("openbao: token file is empty")
	}
	client.token = application.NewSecret("openbao:management-token", []byte(token))
	return &IdentityAdmin{client: client}, nil
}

// EnsurePolicy writes the host's ACL policy document exactly as rendered.
func (a *IdentityAdmin) EnsurePolicy(ctx context.Context, policy application.IdentityPolicy) error {
	if policy.Name == "" || policy.Document == "" {
		return errors.New("openbao: policy name and document are required")
	}
	body := map[string]any{"policy": policy.Document}
	if err := a.client.write(ctx, http.MethodPut, "sys/policies/acl/"+policy.Name, body); err != nil {
		return fmt.Errorf("openbao: write policy %s: %w", policy.Name, err)
	}
	return nil
}

// EnsureAppRole creates or updates the host's role, after checking the ownership
// claim and the policy binding the role already carries.
//
// The claim is a non-secret KV record at secret/data/fleet/identity/roles/<role>.
// It is written create-only, so the second host that reaches an existing role
// name is refused instead of silently sharing it.
func (a *IdentityAdmin) EnsureAppRole(ctx context.Context, role application.IdentityRole) (application.IdentityRoleState, error) {
	if role.Name == "" || role.HostID == "" || role.PolicyName == "" {
		return application.IdentityRoleState{}, errors.New("openbao: role name, host id, and policy are required")
	}
	claimPath, err := domain.RoleClaimPath(role.Name)
	if err != nil {
		return application.IdentityRoleState{}, err
	}
	claimed, found, err := a.readClaim(ctx, claimPath)
	if err != nil {
		return application.IdentityRoleState{}, err
	}
	if found && claimed != role.HostID {
		return application.IdentityRoleState{}, &domain.RoleClaimError{
			RoleName:    role.Name,
			ClaimedHost: claimed,
			RequestedBy: role.HostID,
		}
	}

	policies, exists, err := a.readRolePolicies(ctx, role.Name)
	if err != nil {
		return application.IdentityRoleState{}, err
	}
	if exists && !containsString(policies, role.PolicyName) {
		attributed := claimed
		if attributed == "" {
			attributed = "an unknown host"
		}
		return application.IdentityRoleState{}, &domain.RoleClaimError{
			RoleName:    role.Name,
			ClaimedHost: attributed,
			RequestedBy: role.HostID,
		}
	}

	body := map[string]any{
		"token_policies":          []string{role.PolicyName},
		"token_ttl":               int64(role.TokenTTL / time.Second),
		"token_max_ttl":           int64(role.TokenMax / time.Second),
		"token_explicit_max_ttl":  int64(role.TokenMax / time.Second),
		"token_no_default_policy": true,
		"renewable":               role.Renewable,
		"bind_secret_id":          true,
		"secret_id_ttl":           int64(role.SecretIDTTL / time.Second),
		"secret_id_num_uses":      role.SecretIDUses,
	}
	if err := a.client.write(ctx, http.MethodPost, domain.AppRolePathPrefix+role.Name, body); err != nil {
		return application.IdentityRoleState{}, fmt.Errorf("openbao: write role %s: %w", role.Name, err)
	}

	if !found {
		claimBody := map[string]any{
			"data":    map[string]any{"host_id": role.HostID, "role_name": role.Name},
			"options": map[string]any{"cas": 0},
		}
		if err := a.client.write(ctx, http.MethodPost, claimPath, claimBody); err != nil {
			// A concurrent writer may have created the claim first. Re-read it and
			// let the value decide, so a lost race is a refusal rather than a
			// silent overwrite.
			current, ok, readErr := a.readClaim(ctx, claimPath)
			if readErr == nil && ok && current == role.HostID {
				return application.IdentityRoleState{Name: role.Name, HostID: role.HostID, Exists: exists}, nil
			}
			if readErr == nil && ok {
				return application.IdentityRoleState{}, &domain.RoleClaimError{
					RoleName:    role.Name,
					ClaimedHost: current,
					RequestedBy: role.HostID,
				}
			}
			return application.IdentityRoleState{}, fmt.Errorf("openbao: claim role %s: %w", role.Name, err)
		}
	}
	return application.IdentityRoleState{Name: role.Name, HostID: role.HostID, Exists: exists}, nil
}

// MintWrappedSecretID mints a SecretID with response wrapping and returns only
// the wrapping token. An unwrapped reply is refused: a SecretID must never reach
// this process.
func (a *IdentityAdmin) MintWrappedSecretID(ctx context.Context, roleName string, spec application.IdentityWrapSpec) (application.WrappedSecretID, error) {
	ttl := spec.TTL
	if ttl <= 0 {
		ttl = domain.BootstrapWrapTTL
	}
	wrapped, err := a.client.mintWrapped(ctx, roleName, ttl)
	if err != nil {
		return application.WrappedSecretID{}, err
	}
	return wrapped, nil
}

// DeleteAppRole deletes the role, then the ownership claim, so the identity can be
// rebuilt cleanly by a later provisioning run. OpenBao deletes every SecretID of
// the role with it.
func (a *IdentityAdmin) DeleteAppRole(ctx context.Context, roleName string) error {
	if err := a.client.delete(ctx, domain.AppRolePathPrefix+roleName); err != nil {
		return fmt.Errorf("openbao: delete role %s: %w", roleName, err)
	}
	claimPath, err := domain.RoleClaimPath(roleName)
	if err != nil {
		return err
	}
	metadataPath := strings.Replace(claimPath, "secret/data/", "secret/metadata/", 1)
	if err := a.client.delete(ctx, metadataPath); err != nil {
		return fmt.Errorf("openbao: delete role claim %s: %w", roleName, err)
	}
	return nil
}

// DeletePolicy deletes the host's ACL policy.
func (a *IdentityAdmin) DeletePolicy(ctx context.Context, name string) error {
	if err := a.client.delete(ctx, "sys/policies/acl/"+name); err != nil {
		return fmt.Errorf("openbao: delete policy %s: %w", name, err)
	}
	return nil
}

// ListTokenAccessors lists the accessor of every issued token.
//
// OpenBao has no endpoint that revokes "every token of this role", so revocation
// has to enumerate. `LIST auth/token/accessors` needs `sudo` on
// auth/token/accessors; the management token this adapter reads must carry it, and
// the README states that. Accessors are identifiers, not credentials: an accessor
// cannot be used to authenticate.
func (a *IdentityAdmin) ListTokenAccessors(ctx context.Context) ([]string, error) {
	var reply struct {
		Data struct {
			Keys []string `json:"keys"`
		} `json:"data"`
	}
	found, err := a.client.read(ctx, domain.TokenAccessorsPath+"?list=true", &reply)
	if err != nil {
		return nil, fmt.Errorf("openbao: list token accessors: %w", err)
	}
	if !found {
		return nil, nil
	}
	return append([]string(nil), reply.Data.Keys...), nil
}

// LookupTokenAccessor reports the policies one accessor carries. A token that
// expired between the listing and this call is reported as not found with no
// error: it is already gone, which is the outcome revocation wanted.
func (a *IdentityAdmin) LookupTokenAccessor(ctx context.Context, accessor string) (application.TokenAccessorInfo, bool, error) {
	if strings.TrimSpace(accessor) == "" {
		return application.TokenAccessorInfo{}, false, errors.New("openbao: token accessor is required")
	}
	var reply struct {
		Data struct {
			Accessor string   `json:"accessor"`
			Policies []string `json:"policies"`
		} `json:"data"`
	}
	found, err := a.client.writeIntoStatus(ctx, domain.TokenLookupAccessorPath, map[string]any{"accessor": accessor}, &reply)
	if err != nil {
		return application.TokenAccessorInfo{}, false, fmt.Errorf("openbao: look up token accessor: %w", err)
	}
	if !found {
		return application.TokenAccessorInfo{}, false, nil
	}
	return application.TokenAccessorInfo{
		Accessor: firstNonEmptyString(reply.Data.Accessor, accessor),
		Policies: append([]string(nil), reply.Data.Policies...),
	}, true, nil
}

// RevokeTokenAccessor invalidates one issued token. Revoking an accessor that is
// already gone is success, so a retried teardown is idempotent.
func (a *IdentityAdmin) RevokeTokenAccessor(ctx context.Context, accessor string) error {
	if strings.TrimSpace(accessor) == "" {
		return errors.New("openbao: token accessor is required")
	}
	if err := a.client.write(ctx, http.MethodPost, domain.TokenRevokeAccessorPath, map[string]any{"accessor": accessor}); err != nil {
		return fmt.Errorf("openbao: revoke token accessor: %w", err)
	}
	return nil
}

// firstNonEmptyString returns the first non-empty value.
func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// writeIntoStatus is writeInto but reports a 404 as "not found" instead of a
// failure. It exists for the token lookup, where a token that expired between
// listing and lookup is a normal answer rather than an error.
func (c *baoClient) writeIntoStatus(ctx context.Context, path string, body, out any) (bool, error) {
	request, err := c.request(ctx, http.MethodPost, path, body)
	if err != nil {
		return false, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return false, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return false, fmt.Errorf("read body: %w", err)
	}
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return false, fmt.Errorf("status %d: %s", response.StatusCode, domain.SanitizeMessage(string(payload)))
	}
	if out != nil && len(bytes.TrimSpace(payload)) > 0 {
		if err := json.Unmarshal(payload, out); err != nil {
			return false, fmt.Errorf("response is not JSON: %s", domain.SanitizeMessage(string(payload)))
		}
	}
	return true, nil
}

// readClaim reads the ownership record. A missing record is not an error.
func (a *IdentityAdmin) readClaim(ctx context.Context, claimPath string) (string, bool, error) {
	var reply struct {
		Data struct {
			Data map[string]any `json:"data"`
		} `json:"data"`
	}
	found, err := a.client.read(ctx, claimPath, &reply)
	if err != nil {
		return "", false, fmt.Errorf("openbao: read role claim: %w", err)
	}
	if !found {
		return "", false, nil
	}
	hostID, _ := reply.Data.Data["host_id"].(string)
	return hostID, true, nil
}

// readRolePolicies reads the token policies an existing role carries. A missing
// role is not an error.
func (a *IdentityAdmin) readRolePolicies(ctx context.Context, roleName string) ([]string, bool, error) {
	var reply struct {
		Data struct {
			TokenPolicies []string `json:"token_policies"`
			Policies      []string `json:"policies"`
		} `json:"data"`
	}
	found, err := a.client.read(ctx, domain.AppRolePathPrefix+roleName, &reply)
	if err != nil {
		return nil, false, fmt.Errorf("openbao: read role %s: %w", roleName, err)
	}
	if !found {
		return nil, false, nil
	}
	policies := reply.Data.TokenPolicies
	if len(policies) == 0 {
		policies = reply.Data.Policies
	}
	return policies, true, nil
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// HostIdentityClient implements application.HostSessionClient on the host: it
// unwraps a one-use SecretID, logs in, renews, and rotates. It holds no
// management token and no SecretID: the only credential it ever holds is the
// wrapping token it is given and the session token it gets back.
type HostIdentityClient struct {
	client *baoClient

	mu       sync.Mutex
	consumed map[string]bool
}

var _ application.HostSessionClient = (*HostIdentityClient)(nil)

// NewHostIdentityClient builds the host-side client.
func NewHostIdentityClient(address, namespace string, httpClient HTTPClient, timeout time.Duration) (*HostIdentityClient, error) {
	client, err := newBaoClient(address, namespace, httpClient, timeout)
	if err != nil {
		return nil, err
	}
	return &HostIdentityClient{client: client, consumed: map[string]bool{}}, nil
}

// UnwrapSecretID unwraps a one-use wrapping token. The token is marked consumed
// before the call, so a replay is refused locally even if the server call fails
// midway; OpenBao refuses a second unwrap independently.
func (h *HostIdentityClient) UnwrapSecretID(ctx context.Context, wrapToken application.Secret) (application.Secret, error) {
	value := wrapToken.Bytes()
	defer clear(value)
	if len(value) == 0 {
		return application.Secret{}, errors.New("openbao: wrapping token is required")
	}
	fingerprint := digest(value)
	h.mu.Lock()
	if h.consumed[fingerprint] {
		h.mu.Unlock()
		return application.Secret{}, &domain.WrapTokenConsumedError{}
	}
	h.consumed[fingerprint] = true
	h.mu.Unlock()

	var reply struct {
		Data map[string]any `json:"data"`
	}
	request, err := h.client.request(ctx, http.MethodPost, domain.WrappingUnwrapPath, nil)
	if err != nil {
		return application.Secret{}, fmt.Errorf("openbao: unwrap secret id: %w", err)
	}
	// The wrapping token is the request token, never a body field or a URL.
	request.Header.Set("X-Vault-Token", string(value))
	if err := h.client.do(request, &reply); err != nil {
		return application.Secret{}, fmt.Errorf("openbao: unwrap secret id: %w", err)
	}
	secretID, _ := reply.Data["secret_id"].(string)
	if secretID == "" {
		return application.Secret{}, errors.New("openbao: unwrap returned no secret id")
	}
	return application.NewSecret("openbao:wrapped-secret-id", []byte(secretID)), nil
}

// Login exchanges the AppRole credentials for a short-lived token.
func (h *HostIdentityClient) Login(ctx context.Context, roleID string, secretID application.Secret) (application.HostSession, error) {
	value := secretID.Bytes()
	defer clear(value)
	if roleID == "" || len(value) == 0 {
		return application.HostSession{}, errors.New("openbao: role id and secret id are required")
	}
	body := map[string]any{"role_id": roleID, "secret_id": string(value)}
	var reply loginReply
	if err := h.client.writeInto(ctx, http.MethodPost, domain.AppRoleLoginPath, body, &reply); err != nil {
		return application.HostSession{}, fmt.Errorf("openbao: approle login: %w", err)
	}
	return reply.session()
}

// RenewSelf renews the session token in hand.
func (h *HostIdentityClient) RenewSelf(ctx context.Context, token application.Secret) (application.HostSession, error) {
	value := token.Bytes()
	defer clear(value)
	if len(value) == 0 {
		return application.HostSession{}, errors.New("openbao: session token is required")
	}
	request, err := h.client.request(ctx, http.MethodPost, domain.TokenRenewPath,
		map[string]any{"increment": int64(domain.TokenRenewIncrement / time.Second)})
	if err != nil {
		return application.HostSession{}, fmt.Errorf("openbao: renew token: %w", err)
	}
	request.Header.Set("X-Vault-Token", string(value))
	var reply loginReply
	if err := h.client.do(request, &reply); err != nil {
		return application.HostSession{}, fmt.Errorf("openbao: renew token: %w", err)
	}
	return reply.session()
}

// RotateSecretID mints a fresh wrapped SecretID and destroys the previous one
// after the new one exists, so a host always has a usable login credential.
func (h *HostIdentityClient) RotateSecretID(ctx context.Context, roleName string, previousAccessor string) (application.WrappedSecretID, error) {
	wrapped, err := h.client.mintWrapped(ctx, roleName, domain.BootstrapWrapTTL)
	if err != nil {
		return application.WrappedSecretID{}, err
	}
	if previousAccessor != "" {
		destroy := map[string]any{"secret_id_accessor": previousAccessor}
		if err := h.client.write(ctx, http.MethodPost,
			domain.AppRolePathPrefix+roleName+"/secret-id-accessor/destroy", destroy); err != nil {
			wrapped.WrapToken.Destroy()
			return application.WrappedSecretID{}, fmt.Errorf("openbao: retire previous secret id accessor: %w", err)
		}
	}
	return wrapped, nil
}

// loginReply is the auth block of a login or renewal reply.
type loginReply struct {
	Auth struct {
		ClientToken   string `json:"client_token"`
		Accessor      string `json:"accessor"`
		LeaseDuration int64  `json:"lease_duration"`
		Renewable     bool   `json:"renewable"`
	} `json:"auth"`
}

func (r loginReply) session() (application.HostSession, error) {
	if r.Auth.ClientToken == "" {
		return application.HostSession{}, errors.New("openbao: auth reply carried no client token")
	}
	return application.HostSession{
		Token:     application.NewSecret("openbao:session-token", []byte(r.Auth.ClientToken)),
		TTL:       time.Duration(r.Auth.LeaseDuration) * time.Second,
		Renewable: r.Auth.Renewable,
		Accessor:  r.Auth.Accessor,
	}, nil
}

// mintWrapped asks for a response-wrapped SecretID. The wrap TTL travels in a
// header and the reply is required to be wrapped: an unwrapped SecretID is a hard
// error, because the value must never enter this process.
func (c *baoClient) mintWrapped(ctx context.Context, roleName string, ttl time.Duration) (application.WrappedSecretID, error) {
	if roleName == "" {
		return application.WrappedSecretID{}, errors.New("openbao: role name is required")
	}
	request, err := c.request(ctx, http.MethodPost, domain.AppRolePathPrefix+roleName+domain.SecretIDPathSuffix, map[string]any{})
	if err != nil {
		return application.WrappedSecretID{}, fmt.Errorf("openbao: mint secret id: %w", err)
	}
	request.Header.Set("X-Vault-Wrap-TTL", fmt.Sprintf("%d", int64(ttl/time.Second)))
	var reply struct {
		WrapInfo struct {
			Token           string `json:"token"`
			Accessor        string `json:"accessor"`
			WrappedAccessor string `json:"wrapped_accessor"`
			TTL             int64  `json:"ttl"`
		} `json:"wrap_info"`
		Data struct {
			SecretID string `json:"secret_id"`
		} `json:"data"`
	}
	if err := c.do(request, &reply); err != nil {
		return application.WrappedSecretID{}, fmt.Errorf("openbao: mint secret id for role %s: %w", roleName, err)
	}
	if reply.WrapInfo.Token == "" {
		// A server that ignored the wrap header would hand us a SecretID in the
		// clear. Refuse, and do not echo the reply: it may contain the value.
		return application.WrappedSecretID{}, errors.New("openbao: server did not response-wrap the secret id; refusing an unwrapped credential")
	}
	wrapTTL := time.Duration(reply.WrapInfo.TTL) * time.Second
	if wrapTTL <= 0 {
		wrapTTL = ttl
	}
	accessor := reply.WrapInfo.WrappedAccessor
	if accessor == "" {
		accessor = reply.WrapInfo.Accessor
	}
	return application.WrappedSecretID{
		WrapToken: application.NewSecret("openbao:wrapping-token", []byte(reply.WrapInfo.Token)),
		Accessor:  accessor,
		TTL:       wrapTTL,
	}, nil
}

// baoClient is the shared HTTP mechanics: address, namespace, optional token,
// bounded reads, and sanitized failures. A token travels in a header, so it is
// never in a URL, a log line, or an argument.
type baoClient struct {
	address   string
	namespace string
	token     application.Secret
	http      HTTPClient
}

func newBaoClient(address, namespace string, httpClient HTTPClient, timeout time.Duration) (*baoClient, error) {
	address = strings.TrimRight(strings.TrimSpace(address), "/")
	if address == "" {
		return nil, errors.New("openbao: address is required")
	}
	parsed, err := url.Parse(address)
	if err != nil {
		return nil, fmt.Errorf("openbao: address: %w", err)
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopback(parsed.Hostname())) {
		return nil, fmt.Errorf("openbao: address must be https (http is allowed only for loopback), got %q", address)
	}
	if httpClient == nil {
		if timeout <= 0 {
			timeout = 10 * time.Second
		}
		httpClient = &http.Client{Timeout: timeout}
	}
	return &baoClient{address: address, namespace: namespace, http: httpClient}, nil
}

// request builds one request with the namespace header and the token when the
// client holds one.
func (c *baoClient) request(ctx context.Context, method, path string, body any) (*http.Request, error) {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("encode request: %w", err)
		}
		payload = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.address+"/v1/"+strings.TrimLeft(path, "/"), payload)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.namespace != "" {
		request.Header.Set("X-Vault-Namespace", c.namespace)
	}
	if !c.token.Empty() {
		request.Header.Set("X-Vault-Token", string(c.token.Bytes()))
	}
	return request, nil
}

func (c *baoClient) write(ctx context.Context, method, path string, body any) error {
	return c.writeInto(ctx, method, path, body, nil)
}

func (c *baoClient) writeInto(ctx context.Context, method, path string, body, out any) error {
	request, err := c.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	return c.do(request, out)
}

// read performs a GET. A 404 is reported as "not found" with no error, because
// "no such policy, role, or claim" is a normal answer.
func (c *baoClient) read(ctx context.Context, path string, out any) (bool, error) {
	request, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return false, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return false, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return false, fmt.Errorf("read body: %w", err)
	}
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("status %d: %s", response.StatusCode, domain.SanitizeMessage(string(payload)))
	}
	if out != nil {
		if err := json.Unmarshal(payload, out); err != nil {
			return false, fmt.Errorf("response is not JSON: %s", domain.SanitizeMessage(string(payload)))
		}
	}
	return true, nil
}

// delete performs a DELETE; a missing object is success, so revocation is
// idempotent.
func (c *baoClient) delete(ctx context.Context, path string) error {
	request, err := c.request(ctx, http.MethodDelete, path, nil)
	if err != nil {
		return err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusOK {
		return nil
	}
	return fmt.Errorf("status %d: %s", response.StatusCode, domain.SanitizeMessage(string(payload)))
}

// do sends a request and decodes a JSON reply. Every failure is sanitized: a
// server error body can echo the request.
func (c *baoClient) do(request *http.Request, out any) error {
	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("status %d: %s", response.StatusCode, domain.SanitizeMessage(string(payload)))
	}
	if out == nil || len(bytes.TrimSpace(payload)) == 0 {
		return nil
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("response is not JSON: %s", domain.SanitizeMessage(string(payload)))
	}
	return nil
}

func digest(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}
