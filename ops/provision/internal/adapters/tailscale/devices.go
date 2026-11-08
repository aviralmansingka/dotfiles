package tailscale

import (
	"context"
	"fmt"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// deviceStateRegistered is reported for a device that exists in the tailnet but
// is not connected to the control plane.
const deviceStateRegistered = "registered"

// Devices implements the tailnet device lookup used by the enrollment retry rule.
type Devices struct {
	api *apiClient
}

var _ application.DeviceLookup = (*Devices)(nil)

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

// LookupDevice implements application.DeviceLookup.
//
// The match is exact on the host name and requires the approved tag, so a device
// that belongs to another profile — or another fleet — is never mistaken for this
// host.
func (d *Devices) LookupDevice(ctx context.Context, query application.DeviceQuery) (application.TailnetDevice, bool, error) {
	if err := domain.ValidateHostName(query.HostName); err != nil {
		return application.TailnetDevice{}, false, err
	}
	if err := domain.ValidateTailnetTag(query.Tag); err != nil {
		return application.TailnetDevice{}, false, err
	}

	token, err := d.api.token(ctx)
	if err != nil {
		return application.TailnetDevice{}, false, err
	}
	defer token.Destroy()

	var reply deviceListResponse
	path := fmt.Sprintf("/api/v2/tailnet/%s/devices", d.api.tailnet)
	if err := d.api.call(ctx, token, "GET", path, nil, &reply); err != nil {
		return application.TailnetDevice{}, false, err
	}

	for _, device := range reply.Devices {
		if !deviceMatches(device.Name, query.HostName) && !deviceMatches(device.Hostname, query.HostName) {
			continue
		}
		found := application.TailnetDevice{
			ID:    device.ID,
			Name:  firstNonEmpty(device.Name, device.Hostname),
			State: deviceStateRegistered,
			Tags:  append([]string(nil), device.Tags...),
		}
		if device.ConnectedToControl {
			found.State = application.TailnetDeviceStateRunning
		}
		if !found.HasTag(query.Tag) {
			// Same name, wrong tag: not this host. Reporting it would let a retry
			// resume a node that the approved policy does not cover.
			continue
		}
		return found, true, nil
	}
	return application.TailnetDevice{}, false, nil
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
