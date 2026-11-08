package openbao

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// maxResponseBytes bounds a KV reply.
const maxResponseBytes = 1 << 20

// SecretSourceConfig locates OpenBao and the access token file. It holds no
// credential value: TokenFile is a path.
type SecretSourceConfig struct {
	// Address is the OpenBao base URL, for example http://127.0.0.1:8200.
	Address string
	// TokenFile is a file only the service user can read. The token is read once at
	// construction; it is never an environment variable read at call time and never
	// a command argument.
	TokenFile string
	// Namespace is optional (OpenBao Enterprise namespaces).
	Namespace string
	// HTTP defaults to a client with a bounded timeout.
	HTTP HTTPClient
	// Timeout bounds one read. Defaults to 10s.
	Timeout time.Duration
}

// HTTPClient is the network surface this adapter needs.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// SecretSource implements application.SecretSource against OpenBao's KV API.
type SecretSource struct {
	address   string
	namespace string
	token     application.Secret
	http      HTTPClient
}

var _ application.SecretSource = (*SecretSource)(nil)

// NewSecretSource reads the access token file once and builds the source.
func NewSecretSource(cfg SecretSourceConfig) (*SecretSource, error) {
	address := strings.TrimRight(strings.TrimSpace(cfg.Address), "/")
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
	client := cfg.HTTP
	if client == nil {
		timeout := cfg.Timeout
		if timeout <= 0 {
			timeout = 10 * time.Second
		}
		client = &http.Client{Timeout: timeout}
	}
	return &SecretSource{
		address:   address,
		namespace: cfg.Namespace,
		// The token is held as a Secret: %v, %#v, and JSON all render a placeholder.
		token: application.NewSecret("openbao:access-token", []byte(token)),
		http:  client,
	}, nil
}

// FetchSecret implements application.SecretSource.
//
// The reference is `bao:<kv-path>`; the scheme prefix is stripped and the rest is
// appended to /v1/. The token travels in a header, so it is never in a URL, a log
// line, or an argument.
func (s *SecretSource) FetchSecret(ctx context.Context, ref string) (application.Secret, error) {
	if err := domain.ValidateSecretRef(ref); err != nil {
		return application.Secret{}, err
	}
	scheme, kvPath, found := strings.Cut(ref, ":")
	if !found || kvPath == "" {
		return application.Secret{}, domain.Invalid("secret_ref", "must be scheme:path")
	}
	if scheme != "bao" {
		return application.Secret{}, domain.Invalid("secret_ref", fmt.Sprintf("scheme %q is not supported", scheme))
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.address+"/v1/"+strings.TrimLeft(kvPath, "/"), nil)
	if err != nil {
		return application.Secret{}, fmt.Errorf("openbao: build request: %w", err)
	}
	request.Header.Set("X-Vault-Token", string(s.token.Bytes()))
	request.Header.Set("Accept", "application/json")
	if s.namespace != "" {
		request.Header.Set("X-Vault-Namespace", s.namespace)
	}

	response, err := s.http.Do(request)
	if err != nil {
		return application.Secret{}, fmt.Errorf("openbao: read %s: %w", kvPath, err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return application.Secret{}, fmt.Errorf("openbao: read %s: %w", kvPath, err)
	}
	if response.StatusCode != http.StatusOK {
		// A failure body is quoted only after sanitizing: it can echo the request.
		return application.Secret{}, fmt.Errorf("openbao: read %s: status %d: %s",
			kvPath, response.StatusCode, domain.SanitizeMessage(string(payload)))
	}

	value, err := extractValue(payload)
	if err != nil {
		return application.Secret{}, fmt.Errorf("openbao: read %s: %w", kvPath, err)
	}
	return application.NewSecret(ref, []byte(value)), nil
}

// extractValue reads the credential field from a KV v2 (data.data.value) or KV v1
// (data.value) reply.
func extractValue(payload []byte) (string, error) {
	var reply struct {
		Data struct {
			Value string                     `json:"value"`
			Data  map[string]json.RawMessage `json:"data"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&reply); err != nil {
		return "", fmt.Errorf("response is not JSON")
	}
	if reply.Data.Value != "" {
		return reply.Data.Value, nil
	}
	if encoded, ok := reply.Data.Data["value"]; ok {
		var value string
		if err := json.Unmarshal(encoded, &value); err == nil && value != "" {
			return value, nil
		}
	}
	return "", fmt.Errorf("no value field in secret")
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
