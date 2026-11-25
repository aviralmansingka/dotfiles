package openbao_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/openbao"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// The offline OpenBao substitute. It implements the endpoints this adapter calls
// and the two server-side properties the contract depends on: a wrapping token is
// consumed by exactly one unwrap, and a SecretID is only ever handed out inside a
// wrapped response. No network leaves the test process.
type fakeBao struct {
	mu      sync.Mutex
	next    int
	server  *httptest.Server
	baseURL string

	policies map[string]string
	roles    map[string]*fakeRole
	claims   map[string]string
	wraps    map[string]*fakeWrap
	secretID map[string]*fakeSecretID
	tokens   map[string]*fakeToken
	// accessors is the issued-token table the revocation endpoints read:
	// accessor -> the policies that token carries. It is separate from tokens
	// (which models the value-addressed renew path) because an accessor is what
	// revocation addresses.
	accessors        map[string][]string
	revokedAccessors []string
	listedAccessors  int

	unwraps            int
	roleWrites         int
	mints              int
	claimWrites        int
	destroyedAccessors []string
	wrapTTLSeen        string
	// ignoreWrapTTL makes the server behave like one that does not wrap, which is
	// the misconfiguration the adapter must refuse.
	ignoreWrapTTL bool
	failNext      int
}

type fakeRole struct {
	TokenPolicies []string
	TokenTTL      int64
	TokenMaxTTL   int64
	SecretIDTTL   int64
	SecretIDUses  int
	Renewable     bool
}

type fakeWrap struct {
	SecretID string
	Accessor string
	TTL      int64
	Used     bool
}

type fakeSecretID struct {
	Role      string
	Accessor  string
	UsesLeft  int
	TTL       int64
	Destroyed bool
}

type fakeToken struct {
	TTL       int64
	MaxTTL    int64
	Renewable bool
}

func newFakeBao(t *testing.T) *fakeBao {
	t.Helper()
	f := &fakeBao{
		policies:  map[string]string{},
		roles:     map[string]*fakeRole{},
		claims:    map[string]string{},
		wraps:     map[string]*fakeWrap{},
		secretID:  map[string]*fakeSecretID{},
		tokens:    map[string]*fakeToken{},
		accessors: map[string][]string{},
	}
	f.server = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.server.Close)
	f.baseURL = f.server.URL
	return f
}

func (f *fakeBao) tokenFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "openbao-management-token")
	if err := os.WriteFile(path, []byte("management-token-value"), 0o600); err != nil {
		t.Fatalf("write token file: %v", err)
	}
	return path
}

func (f *fakeBao) admin(t *testing.T) *openbao.IdentityAdmin {
	t.Helper()
	admin, err := openbao.NewIdentityAdmin(openbao.IdentityConfig{
		Address:   f.baseURL,
		TokenFile: f.tokenFile(t),
		HTTP:      f.server.Client(),
	})
	if err != nil {
		t.Fatalf("NewIdentityAdmin: %v", err)
	}
	return admin
}

func (f *fakeBao) hostClient(t *testing.T) *openbao.HostIdentityClient {
	t.Helper()
	client, err := openbao.NewHostIdentityClient(f.baseURL, "", f.server.Client(), 5*time.Second)
	if err != nil {
		t.Fatalf("NewHostIdentityClient: %v", err)
	}
	return client
}

func (f *fakeBao) counts() (unwraps, roleWrites, mints, claimWrites int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.unwraps, f.roleWrites, f.mints, f.claimWrites
}

func (f *fakeBao) handle(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	path := strings.TrimPrefix(r.URL.Path, "/v1/")
	if f.failNext > 0 {
		f.failNext--
		writeError(w, http.StatusInternalServerError, "injected failure")
		return
	}
	switch {
	case strings.HasPrefix(path, "sys/policies/acl/"):
		name := strings.TrimPrefix(path, "sys/policies/acl/")
		switch r.Method {
		case http.MethodPut:
			var body struct {
				Policy string `json:"policy"`
			}
			if !decodeRequest(w, r, &body) {
				return
			}
			f.policies[name] = body.Policy
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			delete(f.policies, name)
			w.WriteHeader(http.StatusNoContent)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}

	case strings.HasPrefix(path, "secret/data/fleet/identity/roles/"):
		role := strings.TrimPrefix(path, "secret/data/fleet/identity/roles/")
		switch r.Method {
		case http.MethodGet:
			host, ok := f.claims[role]
			if !ok {
				writeError(w, http.StatusNotFound, "no such claim")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
				"data": map[string]any{"host_id": host, "role_name": role},
			}})
		case http.MethodPost:
			var body struct {
				Data    map[string]any `json:"data"`
				Options map[string]any `json:"options"`
			}
			if !decodeRequest(w, r, &body) {
				return
			}
			if _, exists := f.claims[role]; exists {
				if cas, _ := body.Options["cas"].(float64); cas == 0 {
					writeError(w, http.StatusBadRequest, "check-and-set parameter did not match the current version")
					return
				}
			}
			host, _ := body.Data["host_id"].(string)
			f.claims[role] = host
			f.claimWrites++
			writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{}})
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}

	case strings.HasPrefix(path, "secret/metadata/fleet/identity/roles/"):
		role := strings.TrimPrefix(path, "secret/metadata/fleet/identity/roles/")
		delete(f.claims, role)
		w.WriteHeader(http.StatusNoContent)

	case path == "auth/token/accessors":
		// LIST is a GET with `?list=true`, which is how the adapter spells it.
		if r.Method != http.MethodGet || !strings.Contains(r.URL.RawQuery, "list=true") {
			writeError(w, http.StatusMethodNotAllowed, "accessor listing must be a LIST")
			return
		}
		f.listedAccessors++
		keys := make([]string, 0, len(f.accessors))
		for accessor := range f.accessors {
			keys = append(keys, accessor)
		}
		sort.Strings(keys)
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"keys": keys}})

	case path == "auth/token/lookup-accessor":
		var body struct {
			Accessor string `json:"accessor"`
		}
		if !decodeRequest(w, r, &body) {
			return
		}
		policies, ok := f.accessors[body.Accessor]
		if !ok {
			writeError(w, http.StatusNotFound, "bad token accessor")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
			"accessor": body.Accessor,
			"policies": policies,
		}})

	case path == "auth/token/revoke-accessor":
		var body struct {
			Accessor string `json:"accessor"`
		}
		if !decodeRequest(w, r, &body) {
			return
		}
		if _, ok := f.accessors[body.Accessor]; !ok {
			writeError(w, http.StatusBadRequest, "token not found")
			return
		}
		delete(f.accessors, body.Accessor)
		f.revokedAccessors = append(f.revokedAccessors, body.Accessor)
		w.WriteHeader(http.StatusNoContent)

	case path == "auth/approle/login":
		var body struct {
			RoleID   string `json:"role_id"`
			SecretID string `json:"secret_id"`
		}
		if !decodeRequest(w, r, &body) {
			return
		}
		record, ok := f.secretID[body.SecretID]
		if !ok || record.Destroyed || record.UsesLeft <= 0 || body.RoleID != record.Role {
			writeError(w, http.StatusBadRequest, "invalid role or secret id")
			return
		}
		record.UsesLeft--
		role := f.roles[body.RoleID]
		token := f.issueToken(role)
		writeJSON(w, http.StatusOK, map[string]any{"auth": map[string]any{
			"client_token":   token,
			"accessor":       fmt.Sprintf("token-accessor-%d", f.next),
			"lease_duration": role.TokenTTL,
			"renewable":      role.Renewable,
		}})

	case path == "auth/token/renew-self":
		token := r.Header.Get("X-Vault-Token")
		if _, ok := f.tokens[token]; !ok {
			writeError(w, http.StatusForbidden, "permission denied")
			return
		}
		f.next++
		record := f.tokens[token]
		writeJSON(w, http.StatusOK, map[string]any{"auth": map[string]any{
			"client_token":   token,
			"accessor":       fmt.Sprintf("token-accessor-%d", f.next),
			"lease_duration": record.TTL,
			"renewable":      record.Renewable,
		}})

	case path == "sys/wrapping/unwrap":
		wrapToken := r.Header.Get("X-Vault-Token")
		record, ok := f.wraps[wrapToken]
		if !ok || record.Used {
			writeError(w, http.StatusBadRequest, "wrapping token is not valid or does not exist")
			return
		}
		record.Used = true
		f.unwraps++
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
			"secret_id": record.SecretID,
			"ttl":       record.TTL,
		}})

	case strings.HasPrefix(path, "auth/approle/role/"):
		rest := strings.TrimPrefix(path, "auth/approle/role/")
		switch {
		case strings.HasSuffix(rest, "/secret-id"):
			roleName := strings.TrimSuffix(rest, "/secret-id")
			if _, ok := f.roles[roleName]; !ok {
				writeError(w, http.StatusNotFound, "no such role")
				return
			}
			f.next++
			f.mints++
			secretID := fmt.Sprintf("secret-id-value-%04d", f.next)
			accessor := fmt.Sprintf("secret-id-accessor-%04d", f.next)
			role := f.roles[roleName]
			f.secretID[secretID] = &fakeSecretID{Role: roleName, Accessor: accessor, UsesLeft: role.SecretIDUses, TTL: role.SecretIDTTL}
			if header := r.Header.Get("X-Vault-Wrap-TTL"); header != "" && !f.ignoreWrapTTL {
				f.wrapTTLSeen = header
				wrapTTL, _ := time.ParseDuration(header + "s")
				wrapToken := fmt.Sprintf("wrap-token-%04d", f.next)
				f.wraps[wrapToken] = &fakeWrap{SecretID: secretID, Accessor: accessor, TTL: int64(wrapTTL / time.Second)}
				writeJSON(w, http.StatusOK, map[string]any{"wrap_info": map[string]any{
					"token":            wrapToken,
					"accessor":         fmt.Sprintf("wrap-accessor-%04d", f.next),
					"wrapped_accessor": accessor,
					"ttl":              int64(wrapTTL / time.Second),
				}})
				return
			}
			// No wrap header honoured: the value is in the clear, which the adapter
			// must refuse.
			writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
				"secret_id":          secretID,
				"secret_id_accessor": accessor,
			}})

		case strings.HasSuffix(rest, "/secret-id-accessor/destroy"):
			roleName := strings.TrimSuffix(rest, "/secret-id-accessor/destroy")
			var body struct {
				Accessor string `json:"secret_id_accessor"`
			}
			if !decodeRequest(w, r, &body) {
				return
			}
			f.destroyedAccessors = append(f.destroyedAccessors, body.Accessor)
			for _, record := range f.secretID {
				if record.Role == roleName && record.Accessor == body.Accessor {
					record.Destroyed = true
				}
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			roleName := rest
			switch r.Method {
			case http.MethodGet:
				role, ok := f.roles[roleName]
				if !ok {
					writeError(w, http.StatusNotFound, "no such role")
					return
				}
				writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
					"token_policies":     role.TokenPolicies,
					"token_ttl":          role.TokenTTL,
					"token_max_ttl":      role.TokenMaxTTL,
					"secret_id_num_uses": role.SecretIDUses,
				}})
			case http.MethodPost:
				var body struct {
					TokenPolicies []string `json:"token_policies"`
					TokenTTL      int64    `json:"token_ttl"`
					TokenMaxTTL   int64    `json:"token_max_ttl"`
					Renewable     *bool    `json:"renewable"`
					SecretIDTTL   int64    `json:"secret_id_ttl"`
					SecretIDUses  int      `json:"secret_id_num_uses"`
				}
				if !decodeRequest(w, r, &body) {
					return
				}
				renewable := true
				if body.Renewable != nil {
					renewable = *body.Renewable
				}
				f.roles[roleName] = &fakeRole{
					TokenPolicies: body.TokenPolicies,
					TokenTTL:      body.TokenTTL,
					TokenMaxTTL:   body.TokenMaxTTL,
					SecretIDTTL:   body.SecretIDTTL,
					SecretIDUses:  body.SecretIDUses,
					Renewable:     renewable,
				}
				f.roleWrites++
				w.WriteHeader(http.StatusNoContent)
			case http.MethodDelete:
				delete(f.roles, roleName)
				w.WriteHeader(http.StatusNoContent)
			default:
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			}
		}

	default:
		writeError(w, http.StatusNotFound, "unknown path")
	}
}

func (f *fakeBao) issueToken(role *fakeRole) string {
	f.next++
	token := fmt.Sprintf("session-token-%04d", f.next)
	f.tokens[token] = &fakeToken{TTL: role.TokenTTL, MaxTTL: role.TokenMaxTTL, Renewable: role.Renewable}
	return token
}

// decodeRequest decodes a request body. It reports the failure itself, because the
// handler runs on the server goroutine where t.Fatalf is not allowed.
func decodeRequest(w http.ResponseWriter, r *http.Request, out any) bool {
	if err := json.NewDecoder(r.Body).Decode(out); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"errors": []string{message}})
}

// perHostPolicies calls the adapter for two hosts and returns the policy documents
// and role definitions the server received.
func perHostPolicies(t *testing.T, f *fakeBao) *openbao.IdentityAdmin {
	t.Helper()
	admin := f.admin(t)
	ctx := context.Background()
	for _, hostID := range []string{"host-0001", "host-0002"} {
		identity, err := domain.NewHostIdentity(hostID, "canary-0"+hostID[len(hostID)-1:])
		if err != nil {
			t.Fatalf("NewHostIdentity(%s): %v", hostID, err)
		}
		policy, err := domain.HostPolicyDocument(identity, []string{identity.CanaryRef()})
		if err != nil {
			t.Fatalf("HostPolicyDocument(%s): %v", hostID, err)
		}
		if err := admin.EnsurePolicy(ctx, application.IdentityPolicy{
			Name: policy.Name, HostID: hostID, Document: policy.HCL(),
		}); err != nil {
			t.Fatalf("EnsurePolicy(%s): %v", hostID, err)
		}
		if _, err := admin.EnsureAppRole(ctx, application.IdentityRole{
			Name:         identity.RoleName,
			HostID:       hostID,
			HostName:     identity.HostName,
			PolicyName:   identity.PolicyName,
			TokenTTL:     domain.AuthorizationTokenTTL,
			TokenMax:     domain.MaxAuthorizationTokenTTL,
			Renewable:    true,
			SecretIDTTL:  domain.LoginSecretIDTTL,
			SecretIDUses: domain.LoginSecretIDUses,
		}); err != nil {
			t.Fatalf("EnsureAppRole(%s): %v", hostID, err)
		}
	}
	return admin
}

// TestIdentityAdminCreatesAPerHostRoleWithAScopedPolicy is properties 2 and 4
// against the real HTTP mechanics: one role and one policy per host, the policy
// scoped to the host's own canary, and the role's lifetimes inside the bound.
func TestIdentityAdminCreatesAPerHostRoleWithAScopedPolicy(t *testing.T) {
	t.Parallel()
	f := newFakeBao(t)
	perHostPolicies(t, f)

	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.roles) != 2 || len(f.policies) != 2 {
		t.Fatalf("server holds %d roles and %d policies, want one of each per host", len(f.roles), len(f.policies))
	}
	role, ok := f.roles["fleet-host-host-0001"]
	if !ok {
		t.Fatalf("role names = %v", mapKeys(f.roles))
	}
	if len(role.TokenPolicies) != 1 || role.TokenPolicies[0] != "fleet-policy-host-0001" {
		t.Fatalf("role policies = %v, want only the host's own policy", role.TokenPolicies)
	}
	if role.TokenTTL <= 0 || role.TokenTTL > 900 || role.TokenMaxTTL > 900 {
		t.Fatalf("role TTLs = ttl %ds max %ds, want (0, 900]", role.TokenTTL, role.TokenMaxTTL)
	}
	if !role.Renewable {
		t.Fatal("the role must be renewable")
	}
	if role.SecretIDTTL <= 0 || role.SecretIDUses < 2 {
		t.Fatalf("login credential = ttl %ds uses %d, want a reboot-safe rotating credential", role.SecretIDTTL, role.SecretIDUses)
	}
	if f.claims["fleet-host-host-0001"] != "host-0001" {
		t.Fatalf("role claim = %q, want host-0001", f.claims["fleet-host-host-0001"])
	}
	policy := f.policies["fleet-policy-host-0001"]
	if !strings.Contains(policy, `path "secret/data/hosts/host-0001/*"`) {
		t.Fatalf("policy does not scope to the host tree:\n%s", policy)
	}
	if strings.Contains(policy, "host-0002") {
		t.Fatalf("policy names another host:\n%s", policy)
	}
	if !strings.Contains(policy, `path "auth/approle/role/*"`) || !strings.Contains(policy, `capabilities = ["deny"]`) {
		t.Fatalf("policy does not deny identity creation:\n%s", policy)
	}
}

// TestIdentityAdminRefusesAnotherHostsRoleClaim is property 2's refusal against
// the server: an existing claim for the derived role name stops authorization
// before a role is written.
func TestIdentityAdminRefusesAnotherHostsRoleClaim(t *testing.T) {
	t.Parallel()
	f := newFakeBao(t)
	admin := f.admin(t)
	// The claim exists outside this run and belongs to a different host.
	identity, err := domain.NewHostIdentity("host-0002", "canary-02")
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}
	f.mu.Lock()
	f.claims[identity.RoleName] = "host-0001"
	f.mu.Unlock()

	_, err = admin.EnsureAppRole(context.Background(), application.IdentityRole{
		Name:         identity.RoleName,
		HostID:       identity.HostID,
		HostName:     identity.HostName,
		PolicyName:   identity.PolicyName,
		TokenTTL:     domain.AuthorizationTokenTTL,
		TokenMax:     domain.MaxAuthorizationTokenTTL,
		Renewable:    true,
		SecretIDTTL:  domain.LoginSecretIDTTL,
		SecretIDUses: domain.LoginSecretIDUses,
	})
	if err == nil {
		t.Fatal("EnsureAppRole must refuse a role claimed by another host")
	}
	var claim *domain.RoleClaimError
	if !errors.As(err, &claim) {
		t.Fatalf("error = %T (%v), want *domain.RoleClaimError", err, err)
	}
	if claim.ClaimedHost != "host-0001" {
		t.Fatalf("claim error = %+v", claim)
	}
	if _, roleWrites, _, _ := f.counts(); roleWrites != 0 {
		t.Fatalf("a refused host wrote %d roles", roleWrites)
	}
}

// TestIdentityAdminMintsOnlyWrappedSecretIDs is property 3 against the server: the
// wrap TTL travels in the header, the reply is a wrapping token, and no SecretID
// reaches the caller.
func TestIdentityAdminMintsOnlyWrappedSecretIDs(t *testing.T) {
	t.Parallel()
	f := newFakeBao(t)
	admin := perHostPolicies(t, f)
	wrapped, err := admin.MintWrappedSecretID(context.Background(), "fleet-host-host-0001",
		application.IdentityWrapSpec{TTL: domain.BootstrapWrapTTL})
	if err != nil {
		t.Fatalf("MintWrappedSecretID: %v", err)
	}
	if wrapped.WrapToken.Empty() {
		t.Fatal("no wrapping token was returned")
	}
	if wrapped.Accessor == "" {
		t.Fatal("no SecretID accessor was returned, so rotation could not identify the credential")
	}
	if wrapped.TTL <= 0 || wrapped.TTL > 900*time.Second {
		t.Fatalf("wrap TTL = %s, want a short one-use window", wrapped.TTL)
	}
	f.mu.Lock()
	wrapTTL := f.wrapTTLSeen
	secretID := ""
	for value := range f.secretID {
		secretID = value
	}
	f.mu.Unlock()
	if wrapTTL != "600" {
		t.Fatalf("X-Vault-Wrap-TTL = %q, want the configured 600 seconds", wrapTTL)
	}
	if secretID == "" {
		t.Fatal("the fake server minted no SecretID, so the test proves nothing")
	}
	rendered := fmt.Sprintf("%v %#v", wrapped, wrapped)
	if strings.Contains(rendered, secretID) {
		t.Fatalf("a SecretID rendered from the result: %s", rendered)
	}
}

// TestIdentityAdminRefusesAnUnwrappedSecretID is property 3's fail-closed case: a
// server that does not wrap would hand over the value in the clear, so the adapter
// refuses and never echoes it.
func TestIdentityAdminRefusesAnUnwrappedSecretID(t *testing.T) {
	t.Parallel()
	f := newFakeBao(t)
	admin := perHostPolicies(t, f)
	f.mu.Lock()
	f.ignoreWrapTTL = true
	f.mu.Unlock()

	_, err := admin.MintWrappedSecretID(context.Background(), "fleet-host-host-0001",
		application.IdentityWrapSpec{TTL: domain.BootstrapWrapTTL})
	if err == nil {
		t.Fatal("an unwrapped SecretID reply must be refused")
	}
	if !strings.Contains(err.Error(), "response-wrap") {
		t.Fatalf("error = %v, want the wrapping refusal", err)
	}
	f.mu.Lock()
	secretID := ""
	for value := range f.secretID {
		secretID = value
	}
	f.mu.Unlock()
	if secretID != "" && strings.Contains(err.Error(), secretID) {
		t.Fatalf("the refusal echoed the SecretID: %v", err)
	}
}

// TestHostClientUnwrapsOnceThenRefusesReplay is property 3's host half against the
// server: the first unwrap returns a SecretID, a replay is refused locally without
// a second request, and a fresh client is refused by the server's own one-use rule.
func TestHostClientUnwrapsOnceThenRefusesReplay(t *testing.T) {
	t.Parallel()
	f := newFakeBao(t)
	admin := perHostPolicies(t, f)
	wrapped, err := admin.MintWrappedSecretID(context.Background(), "fleet-host-host-0001",
		application.IdentityWrapSpec{TTL: domain.BootstrapWrapTTL})
	if err != nil {
		t.Fatalf("MintWrappedSecretID: %v", err)
	}

	client := f.hostClient(t)
	secretID, err := client.UnwrapSecretID(context.Background(), wrapped.WrapToken)
	if err != nil {
		t.Fatalf("UnwrapSecretID: %v", err)
	}
	if secretID.Empty() {
		t.Fatal("unwrap returned no SecretID")
	}
	if _, err := client.UnwrapSecretID(context.Background(), wrapped.WrapToken); err == nil {
		t.Fatal("a replay must be refused")
	} else {
		var consumed *domain.WrapTokenConsumedError
		if !errors.As(err, &consumed) {
			t.Fatalf("replay error = %T (%v), want *domain.WrapTokenConsumedError", err, err)
		}
	}
	if unwraps, _, _, _ := f.counts(); unwraps != 1 {
		t.Fatalf("server unwraps = %d, want 1: the replay must not reach the server", unwraps)
	}

	// A second host process has no local memory, so the server's one-use rule is
	// what refuses it.
	other := f.hostClient(t)
	if _, err := other.UnwrapSecretID(context.Background(), wrapped.WrapToken); err == nil {
		t.Fatal("a second unwrap from a fresh client must be refused by the server")
	}
	if unwraps, _, _, _ := f.counts(); unwraps != 1 {
		t.Fatalf("server unwraps = %d, want 1", unwraps)
	}
}

// TestHostClientLoginRenewsAndRotates is property 5 against the server: login
// issues a short-lived renewable token, renewal stays inside the bound, and
// rotation retires the previous credential only after the new one exists.
func TestHostClientLoginRenewsAndRotates(t *testing.T) {
	t.Parallel()
	f := newFakeBao(t)
	admin := perHostPolicies(t, f)
	wrapped, err := admin.MintWrappedSecretID(context.Background(), "fleet-host-host-0001",
		application.IdentityWrapSpec{TTL: domain.BootstrapWrapTTL})
	if err != nil {
		t.Fatalf("MintWrappedSecretID: %v", err)
	}
	client := f.hostClient(t)
	secretID, err := client.UnwrapSecretID(context.Background(), wrapped.WrapToken)
	if err != nil {
		t.Fatalf("UnwrapSecretID: %v", err)
	}
	session, err := client.Login(context.Background(), "fleet-host-host-0001", secretID)
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if session.Token.Empty() {
		t.Fatal("login returned no token")
	}
	if session.TTL <= 0 || session.TTL > domain.MaxAuthorizationTokenTTL {
		t.Fatalf("login TTL = %s, want (0, 900s]", session.TTL)
	}
	if !session.Renewable {
		t.Fatal("the token must be renewable")
	}
	renewed, err := client.RenewSelf(context.Background(), session.Token)
	if err != nil {
		t.Fatalf("RenewSelf: %v", err)
	}
	if renewed.TTL <= 0 || renewed.TTL > domain.MaxAuthorizationTokenTTL {
		t.Fatalf("renewed TTL = %s, want (0, 900s]", renewed.TTL)
	}

	rotated, err := client.RotateSecretID(context.Background(), "fleet-host-host-0001", wrapped.Accessor)
	if err != nil {
		t.Fatalf("RotateSecretID: %v", err)
	}
	if rotated.WrapToken.Empty() || rotated.Accessor == "" || rotated.Accessor == wrapped.Accessor {
		t.Fatalf("rotation result = %+v, want a fresh wrapped credential", rotated)
	}
	f.mu.Lock()
	destroyed := append([]string(nil), f.destroyedAccessors...)
	f.mu.Unlock()
	if len(destroyed) != 1 || destroyed[0] != wrapped.Accessor {
		t.Fatalf("destroyed accessors = %v, want the previous %q", destroyed, wrapped.Accessor)
	}
	// The retired credential can no longer log in; the new one can.
	if _, err := client.Login(context.Background(), "fleet-host-host-0001", secretID); err == nil {
		t.Fatal("the retired SecretID must not log in")
	}
	freshID, err := client.UnwrapSecretID(context.Background(), rotated.WrapToken)
	if err != nil {
		t.Fatalf("unwrap rotated credential: %v", err)
	}
	if _, err := client.Login(context.Background(), "fleet-host-host-0001", freshID); err != nil {
		t.Fatalf("the rotated credential must log in: %v", err)
	}
}

// TestIdentityAdminRevokeDeletesRoleClaimAndPolicy is the teardown path: nothing
// that could authorize the host survives.
func TestIdentityAdminRevokeDeletesRoleClaimAndPolicy(t *testing.T) {
	t.Parallel()
	f := newFakeBao(t)
	admin := perHostPolicies(t, f)
	if err := admin.DeleteAppRole(context.Background(), "fleet-host-host-0001"); err != nil {
		t.Fatalf("DeleteAppRole: %v", err)
	}
	if err := admin.DeletePolicy(context.Background(), "fleet-policy-host-0001"); err != nil {
		t.Fatalf("DeletePolicy: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.roles["fleet-host-host-0001"]; ok {
		t.Fatal("the role survived revocation")
	}
	if _, ok := f.claims["fleet-host-host-0001"]; ok {
		t.Fatal("the role claim survived revocation")
	}
	if _, ok := f.policies["fleet-policy-host-0001"]; ok {
		t.Fatal("the revoked host's policy survived")
	}
	if _, ok := f.policies["fleet-policy-host-0002"]; !ok {
		t.Fatal("the other host's policy was removed too")
	}
}

func mapKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
