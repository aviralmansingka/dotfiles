package tailscale_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/tailscale"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// removalAPI is an offline stand-in for the Tailscale device endpoints. It records
// the exact method and path of every removal so a test asserts what left the
// process, and it never contacts a real control plane.
type removalAPI struct {
	t      *testing.T
	server *httptest.Server

	mu       sync.Mutex
	removals []string
	status   int
	body     string
}

func newRemovalAPI(t *testing.T) *removalAPI {
	t.Helper()
	api := &removalAPI{t: t, status: http.StatusOK}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"` + apiToken + `","token_type":"Bearer","expires_in":600}`))
	})
	mux.HandleFunc("/api/v2/device/", api.handleDevice)
	api.server = httptest.NewServer(mux)
	t.Cleanup(api.server.Close)
	return api
}

func (a *removalAPI) handleDevice(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.removals = append(a.removals, r.Method+" "+r.URL.Path)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(a.status)
	_, _ = w.Write([]byte(a.body))
}

// Removals returns the recorded "METHOD /path" pairs.
func (a *removalAPI) Removals() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.removals...)
}

// Respond makes the next device call answer with status and body.
func (a *removalAPI) Respond(status int, body string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.status = status
	a.body = body
}

func newDevices(t *testing.T, api *removalAPI) *tailscale.Devices {
	t.Helper()
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
	return devices
}

// TestRemoveDeviceDeletesExactlyTheRecordedDevice asserts the wire call: one
// DELETE to that device's path and nothing else. This is the operation that makes
// the node leave the tailnet, so the path is the whole property.
func TestRemoveDeviceDeletesExactlyTheRecordedDevice(t *testing.T) {
	t.Parallel()
	api := newRemovalAPI(t)
	devices := newDevices(t, api)

	if err := devices.RemoveDevice(context.Background(), ports.RemoveDeviceRequest{
		HostID:   hostID,
		HostName: hostName,
		DeviceID: "n1234CNTRL",
	}); err != nil {
		t.Fatalf("RemoveDevice: %v", err)
	}
	removals := api.Removals()
	if len(removals) != 1 {
		t.Fatalf("device calls = %v, want exactly one", removals)
	}
	if removals[0] != "DELETE /api/v2/device/n1234CNTRL" {
		t.Fatalf("device call = %q, want DELETE /api/v2/device/n1234CNTRL", removals[0])
	}
}

// TestRemoveDeviceTreatsAnAlreadyGoneDeviceAsSuccess is the idempotency half: a
// retried teardown must not fail because the first attempt already removed the
// device.
func TestRemoveDeviceTreatsAnAlreadyGoneDeviceAsSuccess(t *testing.T) {
	t.Parallel()
	api := newRemovalAPI(t)
	api.Respond(http.StatusNotFound, `{"message":"device not found"}`)
	devices := newDevices(t, api)

	if err := devices.RemoveDevice(context.Background(), ports.RemoveDeviceRequest{
		HostID:   hostID,
		HostName: hostName,
		DeviceID: "n1234CNTRL",
	}); err != nil {
		t.Fatalf("removing an already-gone device must succeed, got %v", err)
	}
}

// TestRemoveDeviceReportsAnAuthorizationFailure proves a 403 is not swallowed: an
// OAuth client that cannot manage devices would otherwise leave the node in the
// tailnet while the teardown reported success.
func TestRemoveDeviceReportsAnAuthorizationFailure(t *testing.T) {
	t.Parallel()
	api := newRemovalAPI(t)
	api.Respond(http.StatusForbidden, `{"message":"insufficient scope"}`)
	devices := newDevices(t, api)

	err := devices.RemoveDevice(context.Background(), ports.RemoveDeviceRequest{
		HostID:   hostID,
		HostName: hostName,
		DeviceID: "n1234CNTRL",
	})
	if err == nil {
		t.Fatal("a refused removal must not be reported as success")
	}
	if !strings.Contains(err.Error(), "403") {
		t.Fatalf("error = %v, want the status in the message", err)
	}
}

// TestRemoveDeviceRefusesWithoutARecordedDeviceID keeps the operation from
// guessing. Looking a device up by name could match a node this host does not own,
// so a record with no device id is a refusal and the teardown reports that step as
// incomplete.
func TestRemoveDeviceRefusesWithoutARecordedDeviceID(t *testing.T) {
	t.Parallel()
	api := newRemovalAPI(t)
	devices := newDevices(t, api)

	err := devices.RemoveDevice(context.Background(), ports.RemoveDeviceRequest{
		HostID:   hostID,
		HostName: hostName,
	})
	if err == nil {
		t.Fatal("a removal with no device id must be refused")
	}
	var ambiguous *domain.AmbiguousOwnershipError
	if !errors.As(err, &ambiguous) {
		t.Fatalf("error = %T (%v), want an ambiguous-ownership refusal", err, err)
	}
	if calls := api.Removals(); len(calls) != 0 {
		t.Fatalf("device calls = %v, want none for an unidentified device", calls)
	}
}

// TestRemoveDeviceRefusesAnUnsafeDeviceID proves the id is validated before it
// reaches a URL path, so a value cannot address a different resource or escape the
// path.
func TestRemoveDeviceRefusesAnUnsafeDeviceID(t *testing.T) {
	t.Parallel()
	api := newRemovalAPI(t)
	devices := newDevices(t, api)

	for _, id := range []string{"../keys", "n1/../n2", "n1?x=1", "n1 n2", "%2e%2e"} {
		err := devices.RemoveDevice(context.Background(), ports.RemoveDeviceRequest{
			HostID:   hostID,
			HostName: hostName,
			DeviceID: id,
		})
		if err == nil {
			t.Fatalf("device id %q was accepted", id)
		}
		var invalid *domain.ValidationError
		if !errors.As(err, &invalid) {
			t.Fatalf("device id %q error = %T (%v), want a validation refusal", id, err, err)
		}
	}
	if calls := api.Removals(); len(calls) != 0 {
		t.Fatalf("device calls = %v, want none for a rejected id", calls)
	}
}
