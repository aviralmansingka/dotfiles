package openbao_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/openbao"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

const (
	accessToken = "fake-openbao-access-token-0001"
	secretValue = "fake-oauth-client-secret-0002"
	secretRef   = "bao:secret/data/fleet/tailscale-oauth"
)

// kvServer is an offline OpenBao KV endpoint that records what it was asked for.
type kvServer struct {
	server *httptest.Server

	mu       sync.Mutex
	paths    []string
	headers  []string
	body     string
	status   int
	withAuth bool
}

func newKVServer(t *testing.T) *kvServer {
	t.Helper()
	kv := &kvServer{
		status: http.StatusOK,
		body:   `{"data":{"data":{"value":"` + secretValue + `"},"metadata":{"version":1}}}`,
	}
	kv.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		kv.mu.Lock()
		defer kv.mu.Unlock()
		kv.paths = append(kv.paths, r.URL.Path)
		kv.headers = append(kv.headers, r.Header.Get("X-Vault-Token"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(kv.status)
		fmt.Fprint(w, kv.body)
	}))
	t.Cleanup(kv.server.Close)
	return kv
}

func (kv *kvServer) requests() int {
	kv.mu.Lock()
	defer kv.mu.Unlock()
	return len(kv.paths)
}

// writeTokenFile writes the access token where the adapter expects it: a file the
// service user can read, never an environment variable and never argv.
func writeTokenFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "openbao-token")
	if err := os.WriteFile(path, []byte(accessToken+"\n"), 0o600); err != nil {
		t.Fatalf("write token file: %v", err)
	}
	return path
}

func newSource(t *testing.T, kv *kvServer) *openbao.SecretSource {
	t.Helper()
	source, err := openbao.NewSecretSource(openbao.SecretSourceConfig{
		Address:   kv.server.URL,
		TokenFile: writeTokenFile(t),
		HTTP:      kv.server.Client(),
	})
	if err != nil {
		t.Fatalf("NewSecretSource: %v", err)
	}
	return source
}

// TestFetchSecretReadsKVThroughAPort proves the OAuth credential comes from a
// reference through the port, with the token in a header and the value redacted in
// every non-explicit rendering.
func TestFetchSecretReadsKVThroughAPort(t *testing.T) {
	t.Parallel()
	kv := newKVServer(t)
	source := newSource(t, kv)

	secret, err := source.FetchSecret(context.Background(), secretRef)
	if err != nil {
		t.Fatalf("FetchSecret: %v", err)
	}
	if got := string(secret.Bytes()); got != secretValue {
		t.Fatalf("secret value length %d, want the configured value", len(got))
	}
	if secret.Ref() != secretRef {
		t.Fatalf("ref = %q, want %q", secret.Ref(), secretRef)
	}
	if rendered := fmt.Sprintf("%v %s %#v", secret, secret, secret); strings.Contains(rendered, secretValue) {
		t.Fatalf("formatted secret leaked the value: %s", rendered)
	}
	encoded, err := json.Marshal(secret)
	if err != nil {
		t.Fatalf("marshal secret: %v", err)
	}
	if strings.Contains(string(encoded), secretValue) {
		t.Fatalf("JSON form leaked the value: %s", encoded)
	}

	if kv.requests() != 1 {
		t.Fatalf("requests = %d, want 1", kv.requests())
	}
	if kv.paths[0] != "/v1/secret/data/fleet/tailscale-oauth" {
		t.Fatalf("path = %q, want the KV path from the reference", kv.paths[0])
	}
	if kv.headers[0] != accessToken {
		t.Fatalf("request did not carry the token from the token file")
	}
	if strings.Contains(kv.paths[0], accessToken) {
		t.Fatal("the token must never appear in a request URL")
	}
}

// TestFetchSecretRefusesUnsupportedRefs proves an unreferenceable value cannot
// become a request: a flag, a URL, or a traversal path is rejected offline.
func TestFetchSecretRefusesUnsupportedRefs(t *testing.T) {
	t.Parallel()
	kv := newKVServer(t)
	source := newSource(t, kv)
	for _, ref := range []string{"", "--api-key", "vault:secret/data/x", "bao:", "bao:secret/data/../x", "/etc/passwd"} {
		if _, err := source.FetchSecret(context.Background(), ref); err == nil {
			t.Fatalf("ref %q must be refused", ref)
		}
	}
	if kv.requests() != 0 {
		t.Fatalf("requests = %d, want 0: a refused reference must not reach the server", kv.requests())
	}
}

// TestFetchSecretFailureIsSanitized proves an error body cannot echo a credential
// into a job error.
func TestFetchSecretFailureIsSanitized(t *testing.T) {
	t.Parallel()
	kv := newKVServer(t)
	kv.status = http.StatusForbidden
	kv.body = `{"errors":["permission denied for token=` + accessToken + `"]}`
	source := newSource(t, kv)

	_, err := source.FetchSecret(context.Background(), secretRef)
	if err == nil {
		t.Fatal("a failed KV read must be an error")
	}
	if strings.Contains(err.Error(), accessToken) {
		t.Fatalf("error leaked the access token: %v", err)
	}
}

// TestSecretSourceRequiresAReadableTokenFile proves the adapter refuses to start
// without the token, rather than reading one from the environment at call time.
func TestSecretSourceRequiresAReadableTokenFile(t *testing.T) {
	t.Parallel()
	if _, err := openbao.NewSecretSource(openbao.SecretSourceConfig{
		Address:   "http://127.0.0.1:8200",
		TokenFile: filepath.Join(t.TempDir(), "missing"),
	}); err == nil {
		t.Fatal("a missing token file must be refused")
	}
	if _, err := openbao.NewSecretSource(openbao.SecretSourceConfig{
		Address:   "http://example.com:8200",
		TokenFile: writeTokenFile(t),
	}); err == nil {
		t.Fatal("a non-loopback http address must be refused")
	}
}

// TestFetchSecretFromRefusesEmptyValues proves an empty credential fails closed
// instead of reaching a key-minting call.
func TestFetchSecretFromRefusesEmptyValues(t *testing.T) {
	t.Parallel()
	kv := newKVServer(t)
	kv.body = `{"data":{"data":{"value":""}}}`
	source := newSource(t, kv)
	if _, err := ports.FetchSecretFrom(context.Background(), source, secretRef); err == nil {
		t.Fatal("an empty secret must be refused")
	}
}
