package tailscale_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/tailscale"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

const (
	oauthRef        = "bao:secret/data/fleet/tailscale-oauth"
	oauthSecret     = "fake-oauth-client-secret-do-not-log"
	clientID        = "fake-client-id"
	mintedKey       = "tskey-auth-fake-0001"
	mintedKeyID     = "key-fake-0001"
	apiToken        = "fake-api-token-0001"
	hostName        = "rex-1"
	hostID          = "host-0001"
	approvedTagOnly = domain.ApprovedTailnetTag
)

// mintBody mirrors the documented API shape so the test asserts the wire body,
// not an adapter struct.
type mintBody struct {
	Capabilities struct {
		Devices struct {
			Create struct {
				Reusable      bool     `json:"reusable"`
				Ephemeral     bool     `json:"ephemeral"`
				Preauthorized bool     `json:"preauthorized"`
				Tags          []string `json:"tags"`
			} `json:"create"`
		} `json:"devices"`
	} `json:"capabilities"`
	ExpirySeconds int    `json:"expirySeconds"`
	Description   string `json:"description"`
}

// fakeAPI is an offline stand-in for the Tailscale API. It records every request
// so a test can assert what left the process without performing a network call to
// a real service.
type fakeAPI struct {
	t      *testing.T
	server *httptest.Server

	mu           sync.Mutex
	tokenCalls   int
	keyCalls     int
	deviceCalls  int
	oauthForms   []url.Values
	keyBodies    []mintBody
	keyBodyRaw   []string
	authHeaders  []string
	keyExpiry    string
	devicesReply string
}

func newFakeAPI(t *testing.T) *fakeAPI {
	t.Helper()
	api := &fakeAPI{t: t, keyExpiry: "2026-11-08T12:10:00Z"}
	api.devicesReply = `{"devices":[]}`
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/oauth/token", api.handleToken)
	mux.HandleFunc("/api/v2/tailnet/-/keys", api.handleKeys)
	mux.HandleFunc("/api/v2/tailnet/-/devices", api.handleDevices)
	api.server = httptest.NewServer(mux)
	t.Cleanup(api.server.Close)
	return api
}

func (a *fakeAPI) handleToken(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tokenCalls++
	if r.Method != http.MethodPost {
		a.t.Errorf("token method = %s, want POST", r.Method)
	}
	body, err := url.ParseQuery(readAll(a.t, r))
	if err != nil {
		a.t.Errorf("token body is not a form: %v", err)
	}
	a.oauthForms = append(a.oauthForms, body)
	if body.Get("client_secret") != oauthSecret {
		a.t.Errorf("token request did not carry the secret from the secret source")
	}
	if body.Get("client_id") != clientID || body.Get("grant_type") != "client_credentials" {
		a.t.Errorf("token request carried unexpected fields: %v", body)
	}
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"access_token":"`+apiToken+`","token_type":"Bearer","expires_in":600}`)
}

func (a *fakeAPI) handleKeys(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.keyCalls++
	a.authHeaders = append(a.authHeaders, r.Header.Get("Authorization"))
	raw := readAll(a.t, r)
	a.keyBodyRaw = append(a.keyBodyRaw, raw)
	var body mintBody
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		a.t.Errorf("key body is not JSON: %v", err)
	}
	a.keyBodies = append(a.keyBodies, body)
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"id":"%s","key":"%s","expires":"%s"}`, mintedKeyID, mintedKey, a.keyExpiry)
}

func (a *fakeAPI) handleDevices(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.deviceCalls++
	a.authHeaders = append(a.authHeaders, r.Header.Get("Authorization"))
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, a.devicesReply)
}

func (a *fakeAPI) counts() (token, key, device int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.tokenCalls, a.keyCalls, a.deviceCalls
}

func readAll(t *testing.T, r *http.Request) string {
	t.Helper()
	defer func() { _ = r.Body.Close() }()
	buf := make([]byte, 0, 4096)
	chunk := make([]byte, 1024)
	for {
		n, err := r.Body.Read(chunk)
		buf = append(buf, chunk[:n]...)
		if err != nil {
			break
		}
	}
	return string(buf)
}

func newMinter(t *testing.T, api *fakeAPI, secrets ports.SecretSource) (*tailscale.Minter, *fakes.Logger) {
	t.Helper()
	logger := &fakes.Logger{}
	minter, err := tailscale.NewMinter(tailscale.ClientConfig{
		HTTP:           api.server.Client(),
		BaseURL:        api.server.URL,
		OAuthClientID:  clientID,
		OAuthSecretRef: oauthRef,
		Secrets:        secrets,
		Clock:          fakes.NewClock(),
		Logger:         logger,
	})
	if err != nil {
		t.Fatalf("NewMinter: %v", err)
	}
	return minter, logger
}

func defaultSecrets() *fakes.Secrets {
	return fakes.NewSecrets(map[string]string{oauthRef: oauthSecret})
}

// TestMintedRequestCarriesTheApprovedPolicyAndTag asserts the whole wire body:
// every policy field, the single approved tag, and the expiry within the bound.
func TestMintedRequestCarriesTheApprovedPolicyAndTag(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	secrets := defaultSecrets()
	minter, logger := newMinter(t, api, secrets)

	presented := domain.ApprovedAuthKeyPolicy()
	if err := presented.Validate(); err != nil {
		t.Fatalf("approved policy must validate: %v", err)
	}
	key, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
		HostID:   hostID,
		HostName: hostName,
		Tag:      domain.ApprovedTailnetTag,
		Policy:   presented,
	})
	if err != nil {
		t.Fatalf("MintAuthKey: %v", err)
	}

	if _, keys, _ := api.counts(); keys != 1 {
		t.Fatalf("key requests = %d, want 1", keys)
	}
	body := api.keyBodies[0]
	create := body.Capabilities.Devices.Create
	if !create.Preauthorized {
		t.Error("preauthorized = false, want true")
	}
	if create.Ephemeral {
		t.Error("ephemeral = true, want false")
	}
	if create.Reusable {
		t.Error("reusable = true, want false")
	}
	if body.ExpirySeconds != presented.ExpirySeconds {
		t.Errorf("expirySeconds = %d, want %d", body.ExpirySeconds, presented.ExpirySeconds)
	}
	if body.ExpirySeconds < domain.MinAuthKeyExpirySeconds || body.ExpirySeconds > domain.MaxAuthKeyExpirySeconds {
		t.Errorf("expirySeconds = %d, want within [%d, %d]",
			body.ExpirySeconds, domain.MinAuthKeyExpirySeconds, domain.MaxAuthKeyExpirySeconds)
	}
	if len(create.Tags) != 1 || create.Tags[0] != approvedTagOnly {
		t.Errorf("tags = %v, want exactly [%q]", create.Tags, approvedTagOnly)
	}
	if body.Description != hostName {
		t.Errorf("description = %q, want %q", body.Description, hostName)
	}
	if api.authHeaders[0] != "Bearer "+apiToken {
		t.Errorf("Authorization = %q, want the exchanged bearer token", api.authHeaders[0])
	}
	if refs := secrets.Refs(); len(refs) != 1 || refs[0] != oauthRef {
		t.Errorf("secret source reads = %v, want exactly [%q]", refs, oauthRef)
	}
	if key.ID != mintedKeyID {
		t.Errorf("key id = %q, want %q", key.ID, mintedKeyID)
	}
	wantExpiry := time.Date(2026, 11, 8, 12, 10, 0, 0, time.UTC)
	if !key.Expiry.Equal(wantExpiry) {
		t.Errorf("expiry = %s, want %s", key.Expiry.Format(time.RFC3339), wantExpiry.Format(time.RFC3339))
	}
	for _, line := range logger.Lines() {
		if strings.Contains(line, mintedKey) || strings.Contains(line, oauthSecret) {
			t.Fatalf("log line leaked key material: %s", line)
		}
	}
}

// TestAuthKeyCannotBeRendered is the "credentials never reach a log or a state
// document" assertion for the minted value itself.
func TestAuthKeyCannotBeRendered(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	minter, _ := newMinter(t, api, defaultSecrets())
	key, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
		HostID:   hostID,
		HostName: hostName,
		Tag:      domain.ApprovedTailnetTag,
		Policy:   domain.ApprovedAuthKeyPolicy(),
	})
	if err != nil {
		t.Fatalf("MintAuthKey: %v", err)
	}
	if got := key.Key.Bytes(); string(got) != mintedKey {
		t.Fatalf("Bytes() did not reveal the minted key, got %d bytes", len(got))
	}
	rendered := fmt.Sprintf("%v %s %#v", key.Key, key.Key, key.Key)
	if strings.Contains(rendered, mintedKey) {
		t.Fatalf("formatted secret leaked the key: %s", rendered)
	}
	encoded, err := json.Marshal(key)
	if err != nil {
		t.Fatalf("marshal AuthKey: %v", err)
	}
	if strings.Contains(string(encoded), mintedKey) {
		t.Fatalf("JSON form leaked the key: %s", encoded)
	}
	for _, line := range api.keyBodyRaw {
		if line == "" {
			t.Fatal("recorded key request body is empty")
		}
	}
}

// TestClientSuppliedTagCannotReachTheBody proves a tag that is not the approved
// one never produces a request at all — the body cannot even be built.
func TestClientSuppliedTagCannotReachTheBody(t *testing.T) {
	t.Parallel()
	for _, tag := range []string{"tag:evil", "tag:aws-host-evil", "aws-host", "", "tag:AWS-HOST"} {
		tag := tag
		t.Run(tag, func(t *testing.T) {
			t.Parallel()
			api := newFakeAPI(t)
			minter, _ := newMinter(t, api, defaultSecrets())
			_, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
				HostID:   hostID,
				HostName: hostName,
				Tag:      tag,
				Policy:   domain.ApprovedAuthKeyPolicy(),
			})
			if err == nil {
				t.Fatalf("tag %q must be refused", tag)
			}
			if token, key, _ := api.counts(); token != 0 || key != 0 {
				t.Fatalf("tag %q reached the API: token calls %d, key calls %d", tag, token, key)
			}
		})
	}
}

// TestRelaxedPolicyIsRefusedBeforeAnyRequest proves a weakened policy cannot
// even produce a network call.
func TestRelaxedPolicyIsRefusedBeforeAnyRequest(t *testing.T) {
	t.Parallel()
	cases := map[string]func(*domain.AuthKeyPolicy){
		"reusable":          func(p *domain.AuthKeyPolicy) { p.Reusable = true },
		"ephemeral":         func(p *domain.AuthKeyPolicy) { p.Ephemeral = true },
		"not preauthorized": func(p *domain.AuthKeyPolicy) { p.Preauthorized = false },
		"expiry too long":   func(p *domain.AuthKeyPolicy) { p.ExpirySeconds = domain.MaxAuthKeyExpirySeconds + 1 },
	}
	for name, mutate := range cases {
		name, mutate := name, mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			api := newFakeAPI(t)
			minter, _ := newMinter(t, api, defaultSecrets())
			policy := domain.ApprovedAuthKeyPolicy()
			mutate(&policy)
			if _, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
				HostID: hostID, HostName: hostName, Tag: domain.ApprovedTailnetTag, Policy: policy,
			}); err == nil {
				t.Fatal("relaxed policy must be refused")
			}
			if token, key, _ := api.counts(); token != 0 || key != 0 {
				t.Fatalf("relaxed policy reached the API: token calls %d, key calls %d", token, key)
			}
		})
	}
}

// TestKeyExpiryBeyondThePolicyWindowIsRefused proves the service does not accept
// a key whose reported life exceeds the policy it asked for.
func TestKeyExpiryBeyondThePolicyWindowIsRefused(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	api.keyExpiry = "2026-11-08T14:00:00Z" // two hours, far beyond the ten-minute policy
	minter, _ := newMinter(t, api, defaultSecrets())
	if _, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
		HostID: hostID, HostName: hostName, Tag: domain.ApprovedTailnetTag, Policy: domain.ApprovedAuthKeyPolicy(),
	}); err == nil {
		t.Fatal("a key with an expiry beyond the policy window must be refused")
	}
}

// TestSecretSourceFailureIsReportedWithoutLeaking proves a secret read failure
// aborts before the key endpoint and names only the reference.
func TestSecretSourceFailureIsReportedWithoutLeaking(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	secrets := defaultSecrets()
	secrets.FailWith(fmt.Errorf("openbao: permission denied"))
	minter, _ := newMinter(t, api, secrets)
	_, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
		HostID: hostID, HostName: hostName, Tag: domain.ApprovedTailnetTag, Policy: domain.ApprovedAuthKeyPolicy(),
	})
	if err == nil {
		t.Fatal("a failing secret source must abort the mint")
	}
	if strings.Contains(err.Error(), oauthSecret) {
		t.Fatalf("error leaked the client secret: %v", err)
	}
	if _, keys, _ := api.counts(); keys != 0 {
		t.Fatalf("key requests = %d, want 0", keys)
	}
}

// TestReplayAwareTailnetRejectsSecondUseOfTheSameKey proves single-use is
// enforced: the key the service minted registers one device and a replay of that
// same key is refused.
func TestReplayAwareTailnetRejectsSecondUseOfTheSameKey(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	minter, _ := newMinter(t, api, defaultSecrets())
	key, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
		HostID: hostID, HostName: hostName, Tag: domain.ApprovedTailnetTag, Policy: domain.ApprovedAuthKeyPolicy(),
	})
	if err != nil {
		t.Fatalf("MintAuthKey: %v", err)
	}
	tailnet := fakes.NewTailnet()
	deviceID, err := tailnet.Join(hostName, domain.ApprovedTailnetTag, string(key.Key.Bytes()))
	if err != nil {
		t.Fatalf("first join with a fresh key must succeed: %v", err)
	}
	if deviceID == "" {
		t.Fatal("first join reported no device id")
	}
	if _, err := tailnet.Join("rex-2", domain.ApprovedTailnetTag, string(key.Key.Bytes())); err == nil {
		t.Fatal("a second use of the same key must be refused")
	}
	if tailnet.JoinCount() != 1 {
		t.Fatalf("joins = %d, want 1", tailnet.JoinCount())
	}
}

// TestLookupDeviceMatchesNameAndApprovedTag proves the retry lookup keys on both,
// so a same-named device under another tag is not resumed as this host.
func TestLookupDeviceMatchesNameAndApprovedTag(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	api.devicesReply = `{"devices":[
		{"id":"n-wrong-tag","name":"rex-1.tailnet.ts.net","hostname":"rex-1","tags":["tag:other"],"connectedToControl":true},
		{"id":"n-other-host","name":"rex-2","hostname":"rex-2","tags":["tag:aws-host"],"connectedToControl":true},
		{"id":"n-right","name":"rex-1.tailnet.ts.net","hostname":"rex-1","tags":["tag:aws-host"],"connectedToControl":true}
	]}`
	devices, err := tailscale.NewDevices(tailscale.ClientConfig{
		HTTP:           api.server.Client(),
		BaseURL:        api.server.URL,
		OAuthClientID:  clientID,
		OAuthSecretRef: oauthRef,
		Secrets:        defaultSecrets(),
		Logger:         &fakes.Logger{},
		Clock:          fakes.NewClock(),
	})
	if err != nil {
		t.Fatalf("NewDevices: %v", err)
	}
	found, ok, err := devices.LookupDevice(context.Background(), ports.DeviceQuery{
		HostName: hostName,
		Tag:      domain.ApprovedTailnetTag,
	})
	if err != nil {
		t.Fatalf("LookupDevice: %v", err)
	}
	if !ok {
		t.Fatal("device not found")
	}
	if found.ID != "n-right" {
		t.Fatalf("device id = %q, want n-right", found.ID)
	}
	if !found.Running() {
		t.Fatalf("state = %q, want running", found.State)
	}

	missing, ok, err := devices.LookupDevice(context.Background(), ports.DeviceQuery{
		HostName: "rex-9",
		Tag:      domain.ApprovedTailnetTag,
	})
	if err != nil || ok {
		t.Fatalf("LookupDevice(rex-9) = %v, %v; want not found", ok, err)
	}
	if missing.ID != "" {
		t.Fatalf("missing device id = %q, want empty", missing.ID)
	}
}

// TestLookupDeviceReportsRegisteredWhenNotConnected proves a device that exists
// but is not connected to the control plane is not reported as running, so the
// enrollment retries instead of resuming a host that never came up.
func TestLookupDeviceReportsRegisteredWhenNotConnected(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	api.devicesReply = `{"devices":[{"id":"n-1","name":"rex-1","hostname":"rex-1","tags":["tag:aws-host"],"connectedToControl":false}]}`
	devices, err := tailscale.NewDevices(tailscale.ClientConfig{
		HTTP:           api.server.Client(),
		BaseURL:        api.server.URL,
		OAuthClientID:  clientID,
		OAuthSecretRef: oauthRef,
		Secrets:        defaultSecrets(),
		Logger:         &fakes.Logger{},
		Clock:          fakes.NewClock(),
	})
	if err != nil {
		t.Fatalf("NewDevices: %v", err)
	}
	found, ok, err := devices.LookupDevice(context.Background(), ports.DeviceQuery{
		HostName: hostName,
		Tag:      domain.ApprovedTailnetTag,
	})
	if err != nil || !ok {
		t.Fatalf("LookupDevice = %v, %v; want found", ok, err)
	}
	if found.Running() {
		t.Fatalf("state = %q, want a non-running state", found.State)
	}
}

// TestOAuthClientSecretIsTrimmedBeforeTheExchange reproduces the first live run's
// failure: the KV value `secret/data/fleet/tailscale-oauth` carries a trailing
// newline (64 bytes for a 63-byte secret), Tailscale answers `401 API token
// invalid` for the untrimmed value, and the job died in EnrollHost as if the
// credential had been revoked. The fake API asserts the form field equals the
// secret exactly, so a value that still carried the newline fails this test.
func TestOAuthClientSecretIsTrimmedBeforeTheExchange(t *testing.T) {
	t.Parallel()
	api := newFakeAPI(t)
	secrets := fakes.NewSecrets(map[string]string{oauthRef: oauthSecret + "\n"})
	minter, _ := newMinter(t, api, secrets)

	if _, err := minter.MintAuthKey(context.Background(), ports.AuthKeyRequest{
		HostID: hostID, HostName: hostName, Tag: domain.ApprovedTailnetTag, Policy: domain.ApprovedAuthKeyPolicy(),
	}); err != nil {
		t.Fatalf("MintAuthKey with a newline-terminated client secret: %v", err)
	}
	if tokenCalls, _, _ := api.counts(); tokenCalls != 1 {
		t.Fatalf("token calls = %d, want 1", tokenCalls)
	}
}
