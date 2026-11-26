package tailscale

import (
	"context"
	"fmt"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// deviceStateRegistered is reported for a device that exists in the tailnet but
// is not connected to the control plane.
const deviceStateRegistered = "registered"

// Devices implements the tailnet device lookup used by the enrollment retry rule,
// and the device removal a teardown needs.
type Devices struct {
	api *apiClient
}

var (
	_ ports.DeviceLookup         = (*Devices)(nil)
	_ ports.TailnetDeviceManager = (*Devices)(nil)
)

// NewDevices builds the device lookup adapter.
func NewDevices(cfg ClientConfig) (*Devices, error) {
	api, err := newAPIClient(cfg)
	if err != nil {
		return nil, err
	}
	return &Devices{api: api}, nil
}

type deviceListResponse struct {
	Devices []struct {
		ID                 string   `json:"id"`
		Name               string   `json:"name"`
		Hostname           string   `json:"hostname"`
		Tags               []string `json:"tags"`
		ConnectedToControl bool     `json:"connectedToControl"`
	} `json:"devices"`
}

// LookupDevice implements ports.DeviceLookup.
//
// The match is exact on the host name and requires the approved tag, so a device
// that belongs to another profile — or another fleet — is never mistaken for this
// host.
func (d *Devices) LookupDevice(ctx context.Context, query ports.DeviceQuery) (ports.TailnetDevice, bool, error) {
	if err := domain.ValidateHostName(query.HostName); err != nil {
		return ports.TailnetDevice{}, false, err
	}
	if err := domain.ValidateTailnetTag(query.Tag); err != nil {
		return ports.TailnetDevice{}, false, err
	}

	token, err := d.api.token(ctx)
	if err != nil {
		return ports.TailnetDevice{}, false, err
	}
	defer token.Destroy()

	var reply deviceListResponse
	path := fmt.Sprintf("/api/v2/tailnet/%s/devices", d.api.tailnet)
	if err := d.api.call(ctx, token, "GET", path, nil, &reply); err != nil {
		return ports.TailnetDevice{}, false, err
	}

	for _, device := range reply.Devices {
		if !deviceMatches(device.Name, query.HostName) && !deviceMatches(device.Hostname, query.HostName) {
			continue
		}
		found := ports.TailnetDevice{
			ID:    device.ID,
			Name:  firstNonEmpty(device.Name, device.Hostname),
			State: deviceStateRegistered,
			Tags:  append([]string(nil), device.Tags...),
		}
		if device.ConnectedToControl {
			found.State = ports.TailnetDeviceStateRunning
		}
		if !found.HasTag(query.Tag) {
			// Same name, wrong tag: not this host. Reporting it would let a retry
			// resume a node that the approved policy does not cover.
			continue
		}
		return found, true, nil
	}
	return ports.TailnetDevice{}, false, nil
}

// deviceMatches compares a device name to the host name, ignoring the tailnet
// domain suffix the API appends to Name.
func deviceMatches(candidate, hostName string) bool {
	if candidate == "" {
		return false
	}
	if candidate == hostName {
		return true
	}
	base, _, found := strings.Cut(candidate, ".")
	return found && base == hostName
}

// RemoveDevice implements ports.TailnetDeviceManager: DELETE
// /api/v2/device/<id>.
//
// It removes exactly the recorded device and nothing else. The id comes from the
// inventory record, and it is validated before it reaches a URL path, so a value
// carrying a separator or an escape cannot address a different device.
//
// A 404 is success: the device is gone, which is what the caller asked for, and a
// retried teardown must not fail because the first attempt already did the work. A
// record with no device id is refused rather than guessed at — a name lookup could
// match a node this host does not own.
func (d *Devices) RemoveDevice(ctx context.Context, req ports.RemoveDeviceRequest) error {
	if strings.TrimSpace(req.DeviceID) == "" {
		return &domain.AmbiguousOwnershipError{
			HostID: req.HostID,
			Reason: "the inventory record names no tailnet device id",
		}
	}
	if err := domain.ValidateDeviceID(req.DeviceID); err != nil {
		return err
	}

	token, err := d.api.token(ctx)
	if err != nil {
		return err
	}
	defer token.Destroy()

	if err := d.api.delete(ctx, token, "/api/v2/device/"+req.DeviceID); err != nil {
		return err
	}
	if d.api.cfg.Logger != nil {
		d.api.cfg.Logger.Info("tailnet.device.removed",
			"host_id", req.HostID,
			"device_id", req.DeviceID,
		)
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
