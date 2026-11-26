package tailscale

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// clockSkewGrace tolerates a few seconds of clock difference between this host
// and the API when the issued expiry is compared against the policy bound.
const clockSkewGrace = 60 * time.Second

// Minter mints one enrollment key per host through the Tailscale API.
//
// The request body is built from the domain policy value and the server-resolved
// tag; it is never built from request fields a client could influence.
type Minter struct {
	api *apiClient
}

var _ ports.AuthKeyMinter = (*Minter)(nil)

// NewMinter builds the key minter.
func NewMinter(cfg ClientConfig) (*Minter, error) {
	api, err := newAPIClient(cfg)
	if err != nil {
		return nil, err
	}
	return &Minter{api: api}, nil
}

// mintKeyRequest is the exact API body. It mirrors the API shape one field at a
// time so a test can assert every option the service mints with.
type mintKeyRequest struct {
	Capabilities  mintCapabilities `json:"capabilities"`
	ExpirySeconds int              `json:"expirySeconds"`
	Description   string           `json:"description,omitempty"`
}

type mintCapabilities struct {
	Devices mintDevices `json:"devices"`
}

type mintDevices struct {
	Create mintCreate `json:"create"`
}

type mintCreate struct {
	Reusable      bool     `json:"reusable"`
	Ephemeral     bool     `json:"ephemeral"`
	Preauthorized bool     `json:"preauthorized"`
	Tags          []string `json:"tags"`
}

type mintKeyResponse struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Expires string `json:"expires"`
}

// newMintKeyRequest renders the policy and the approved tag into a body.
func newMintKeyRequest(policy domain.AuthKeyPolicy, tag, description string) mintKeyRequest {
	return mintKeyRequest{
		Capabilities: mintCapabilities{Devices: mintDevices{Create: mintCreate{
			Reusable:      policy.Reusable,
			Ephemeral:     policy.Ephemeral,
			Preauthorized: policy.Preauthorized,
			Tags:          []string{tag},
		}}},
		ExpirySeconds: policy.ExpirySeconds,
		Description:   description,
	}
}

// MintAuthKey implements ports.AuthKeyMinter.
//
// It refuses before it opens a connection when the tag is not the approved one or
// the policy is not the approved shape, so a weakened or client-chosen value
// cannot produce a network call at all.
func (m *Minter) MintAuthKey(ctx context.Context, req ports.AuthKeyRequest) (ports.AuthKey, error) {
	if err := domain.ValidateHostName(req.HostName); err != nil {
		return ports.AuthKey{}, err
	}
	if err := domain.ValidateTailnetTag(req.Tag); err != nil {
		return ports.AuthKey{}, err
	}
	if !domain.IsApprovedTailnetTag(req.Tag) {
		return ports.AuthKey{}, domain.Invalid("tailnet_tag",
			fmt.Sprintf("%q is not the approved tag %q; a tag is resolved server-side and never supplied by a client",
				req.Tag, domain.ApprovedTailnetTag))
	}
	if err := req.Policy.Validate(); err != nil {
		return ports.AuthKey{}, domain.Invalid("auth_key_policy", err.Error())
	}

	body := newMintKeyRequest(req.Policy, req.Tag, req.HostName)

	token, err := m.api.token(ctx)
	if err != nil {
		return ports.AuthKey{}, err
	}
	defer token.Destroy()

	var reply mintKeyResponse
	path := fmt.Sprintf("/api/v2/tailnet/%s/keys", m.api.tailnet)
	if err := m.api.call(ctx, token, "POST", path, body, &reply); err != nil {
		return ports.AuthKey{}, err
	}
	if strings.TrimSpace(reply.ID) == "" || strings.TrimSpace(reply.Key) == "" {
		return ports.AuthKey{}, fmt.Errorf("tailscale: key response is missing id or key")
	}
	expiry, err := m.issuedExpiry(reply.Expires, req.Policy)
	if err != nil {
		return ports.AuthKey{}, err
	}

	m.api.cfg.Logger.Info("tailnet.authkey.minted",
		"host_id", req.HostID,
		"key_id", reply.ID,
		"tailnet_tag", req.Tag,
		"expiry", expiry.Format(time.RFC3339),
		"expiry_seconds", req.Policy.ExpirySeconds,
		"reusable", req.Policy.Reusable,
		"ephemeral", req.Policy.Ephemeral,
		"preauthorized", req.Policy.Preauthorized,
	)
	return ports.AuthKey{
		ID:      reply.ID,
		Key:     domain.NewSecret("tailscale:authkey:"+reply.ID, []byte(strings.TrimSpace(reply.Key))),
		Expiry:  expiry,
		Tailnet: m.api.tailnet,
	}, nil
}

// issuedExpiry bounds the life of the key the API actually issued. A key with no
// reported expiry, an expiry in the past, or an expiry beyond the policy window is
// refused rather than delivered.
func (m *Minter) issuedExpiry(raw string, policy domain.AuthKeyPolicy) (time.Time, error) {
	now := m.api.now()
	limit := now.Add(time.Duration(policy.ExpirySeconds)*time.Second + clockSkewGrace)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return now.Add(time.Duration(policy.ExpirySeconds) * time.Second), nil
	}
	expiry, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("tailscale: key expiry %q is not RFC3339", raw)
	}
	if !expiry.After(now) {
		return time.Time{}, fmt.Errorf("tailscale: key expiry %s is not in the future", expiry.Format(time.RFC3339))
	}
	if expiry.After(limit) {
		return time.Time{}, fmt.Errorf("tailscale: key expiry %s exceeds the %ds policy window",
			expiry.Format(time.RFC3339), policy.ExpirySeconds)
	}
	return expiry, nil
}
