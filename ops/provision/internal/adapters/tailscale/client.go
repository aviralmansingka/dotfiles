// Package tailscale holds the tailnet adapters. S03 mints enrollment keys and
// looks up existing devices; S07 removes devices.
//
// Nothing here holds a credential value in a struct field, an argument, or a log
// line: the OAuth client secret is read from an OpenBao reference through the
// ports.SecretSource port at call time and is placed only in the request
// body that must carry it.
package tailscale

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// DefaultBaseURL is the public Tailscale API.
const DefaultBaseURL = "https://api.tailscale.com"

// maxResponseBytes bounds an API reply so a hostile endpoint cannot exhaust
// memory.
const maxResponseBytes = 1 << 20

// HTTPClient is the one network surface these adapters need. http.Client
// implements it; a test can substitute a recorder or a fake.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// ClientConfig is the non-secret adapter configuration plus the secret source.
type ClientConfig struct {
	HTTP    HTTPClient
	BaseURL string
	// Tailnet is the tailnet to operate on. Empty means the credential's default
	// tailnet, which the API spells "-".
	Tailnet string
	// OAuthClientID is the public client id. The client *secret* is never here: it
	// is read from OAuthSecretRef.
	OAuthClientID string
	// OAuthSecretRef is an OpenBao reference such as
	// bao:secret/data/fleet/tailscale-oauth. It is a path, not a value.
	OAuthSecretRef string
	Secrets        ports.SecretSource
	Clock          ports.Clock
	Logger         ports.Logger
}

// apiClient exchanges the OAuth client credential for a short-lived API token
// and performs authenticated JSON calls.
type apiClient struct {
	http    HTTPClient
	baseURL string
	tailnet string
	cfg     ClientConfig
}

func newAPIClient(cfg ClientConfig) (*apiClient, error) {
	if cfg.HTTP == nil {
		return nil, fmt.Errorf("tailscale: http client is required")
	}
	if cfg.Secrets == nil {
		return nil, fmt.Errorf("tailscale: secret source is required")
	}
	if cfg.Logger == nil {
		return nil, fmt.Errorf("tailscale: logger is required")
	}
	base := strings.TrimSpace(cfg.BaseURL)
	if base == "" {
		base = DefaultBaseURL
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return nil, fmt.Errorf("tailscale: base url: %w", err)
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopback(parsed.Hostname())) {
		return nil, fmt.Errorf("tailscale: base url must be https (http is allowed only for a loopback test endpoint), got %q", base)
	}
	tailnet := cfg.Tailnet
	if tailnet == "" {
		tailnet = "-"
	}
	return &apiClient{
		http:    cfg.HTTP,
		baseURL: strings.TrimRight(parsed.String(), "/"),
		tailnet: tailnet,
		cfg:     cfg,
	}, nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// token exchanges the OAuth client credential for a bearer token. The secret is
// read from the secret source here, used to build one form body, and never
// stored: the returned Secret holds only the issued API token.
func (c *apiClient) token(ctx context.Context) (domain.Secret, error) {
	if strings.TrimSpace(c.cfg.OAuthClientID) == "" {
		return domain.Secret{}, fmt.Errorf("tailscale: oauth client id is not configured")
	}
	clientSecret, err := ports.FetchSecretFrom(ctx, c.cfg.Secrets, c.cfg.OAuthSecretRef)
	if err != nil {
		return domain.Secret{}, err
	}
	defer clientSecret.Destroy()

	// A KV value is whatever an operator wrote, and a KV write made from a file
	// carries that file's trailing newline — the lab's `fleet/tailscale-oauth`
	// does, at 64 bytes for a 63-byte secret. Tailscale answers a secret with a
	// newline stuck to it with `401 API token invalid`, which reads like a revoked
	// credential and sent the first live run looking in the wrong place. An OAuth
	// client secret is opaque bytes and nothing else, so the surrounding
	// whitespace is trimmed at the one point where the value becomes a form field.
	secretValue := strings.TrimSpace(string(clientSecret.Bytes()))

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", c.cfg.OAuthClientID)
	// The only place the client secret exists: the token request body. It is not
	// an argv word, an environment variable, or a log field.
	form.Set("client_secret", secretValue)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v2/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return domain.Secret{}, fmt.Errorf("tailscale: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	var reply struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := c.do(ctx, req, &reply); err != nil {
		return domain.Secret{}, fmt.Errorf("tailscale: oauth token exchange: %w", err)
	}
	if strings.TrimSpace(reply.AccessToken) == "" {
		return domain.Secret{}, fmt.Errorf("tailscale: oauth token exchange returned no access token")
	}
	if reply.TokenType != "" && !strings.EqualFold(reply.TokenType, "bearer") {
		return domain.Secret{}, fmt.Errorf("tailscale: oauth token exchange returned type %q", reply.TokenType)
	}
	return domain.NewSecret("tailscale:api-token", []byte(reply.AccessToken)), nil
}

// call performs an authenticated JSON request. token is destroyed by the caller.
func (c *apiClient) call(ctx context.Context, token domain.Secret, method, path string, body, out any) error {
	return c.callAllowing(ctx, token, method, path, body, out, nil)
}

// delete performs an authenticated DELETE and treats 404 as success.
//
// A device that is already gone is the outcome the caller wanted, so a retried
// teardown that reaches this call a second time must not fail. No other status is
// tolerated: a 403 means the OAuth client cannot manage devices, and silently
// reporting success would leave the node in the tailnet.
func (c *apiClient) delete(ctx context.Context, token domain.Secret, path string) error {
	return c.callAllowing(ctx, token, http.MethodDelete, path, nil, nil, []int{http.StatusNotFound})
}

// callAllowing is call with an explicit set of non-2xx statuses that count as
// success for this endpoint.
func (c *apiClient) callAllowing(ctx context.Context, token domain.Secret, method, path string, body, out any, accept []int) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("tailscale: encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("tailscale: build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+string(token.Bytes()))
	if err := c.doAllowing(ctx, req, out, accept); err != nil {
		return err
	}
	return nil
}

// doAllowing is do with an explicit accept list for non-2xx statuses.
func (c *apiClient) doAllowing(ctx context.Context, req *http.Request, out any, accept []int) error {
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", req.Method, req.URL.Path, err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("%s %s: read response: %w", req.Method, req.URL.Path, err)
	}
	ok := response.StatusCode >= 200 && response.StatusCode < 300
	for _, status := range accept {
		if response.StatusCode == status {
			ok = true
		}
	}
	if !ok {
		return fmt.Errorf("%s %s: status %d: %s",
			req.Method, req.URL.Path, response.StatusCode, domain.SanitizeMessage(string(payload)))
	}
	if out == nil || len(bytes.TrimSpace(payload)) == 0 {
		return nil
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("%s %s: decode response: %w", req.Method, req.URL.Path, err)
	}
	return nil
}

func (c *apiClient) do(ctx context.Context, req *http.Request, out any) error {
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", req.Method, req.URL.Path, err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("%s %s: read response: %w", req.Method, req.URL.Path, err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// The body of a failure may quote the credential, so it is sanitized
		// before it can reach a log line or a job error.
		return fmt.Errorf("%s %s: status %d: %s",
			req.Method, req.URL.Path, response.StatusCode, domain.SanitizeMessage(string(payload)))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("%s %s: decode response: %w", req.Method, req.URL.Path, err)
	}
	return nil
}

// now is the adapter clock, defaulting to wall clock when a test supplies none.
func (c *apiClient) now() time.Time {
	if c.cfg.Clock == nil {
		return time.Now().UTC()
	}
	return c.cfg.Clock.Now().UTC()
}
