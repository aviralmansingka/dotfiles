package fakes

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// Tailnet is an in-memory tailnet that behaves like the real thing in the two
// ways enrollment depends on: a device registers once per key, and a key is
// single-use.
type Tailnet struct {
	mu             sync.Mutex
	devices        []ports.TailnetDevice
	usedKeys       map[string]string
	joins          int
	removals       int
	absentRemovals int
	lookupErr      error
}

// NewTailnet builds an empty tailnet.
func NewTailnet() *Tailnet {
	return &Tailnet{usedKeys: map[string]string{}}
}

var (
	_ ports.DeviceLookup         = (*Tailnet)(nil)
	_ ports.TailnetDeviceManager = (*Tailnet)(nil)
)

// ErrAuthKeyReused is returned when a key is presented a second time.
var ErrAuthKeyReused = fmt.Errorf("tailnet: auth key was already used")

// Join registers a device with the given name and tag, consuming authKey. A key
// that has been used before is rejected, exactly as the real control plane
// rejects a single-use key on replay.
func (t *Tailnet) Join(hostName, tag, authKey string) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if authKey == "" {
		return "", fmt.Errorf("tailnet: join needs an auth key")
	}
	if existing, used := t.usedKeys[authKey]; used {
		return "", fmt.Errorf("%w (already registered device %s)", ErrAuthKeyReused, existing)
	}
	t.joins++
	deviceID := fmt.Sprintf("n%04d", t.joins)
	t.usedKeys[authKey] = deviceID
	t.devices = append(t.devices, ports.TailnetDevice{
		ID:    deviceID,
		Name:  hostName,
		State: ports.TailnetDeviceStateRunning,
		Tags:  []string{tag},
	})
	return deviceID, nil
}

// FailLookup makes every device lookup fail.
func (t *Tailnet) FailLookup(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lookupErr = err
}

// LookupDevice implements ports.DeviceLookup: exact name and tag.
func (t *Tailnet) LookupDevice(_ context.Context, query ports.DeviceQuery) (ports.TailnetDevice, bool, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.lookupErr != nil {
		return ports.TailnetDevice{}, false, t.lookupErr
	}
	for _, device := range t.devices {
		if device.Name == query.HostName && device.HasTag(query.Tag) {
			return device, true, nil
		}
	}
	return ports.TailnetDevice{}, false, nil
}

// Devices returns a copy of the registered devices, in registration order.
func (t *Tailnet) Devices() []ports.TailnetDevice {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]ports.TailnetDevice(nil), t.devices...)
}

// JoinCount reports how many joins succeeded.
func (t *Tailnet) JoinCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.joins
}

// SetState changes the reported state of the named device.
func (t *Tailnet) SetState(name, state string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i := range t.devices {
		if t.devices[i].Name == name {
			t.devices[i].State = state
		}
	}
}

// RemoveDevice implements ports.TailnetDeviceManager. Removing a device that
// is already gone is success, which is what makes a retried teardown idempotent.
// A request with no device id is refused: the port does not guess by name.
func (t *Tailnet) RemoveDevice(_ context.Context, req ports.RemoveDeviceRequest) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if strings.TrimSpace(req.DeviceID) == "" {
		return &domain.AmbiguousOwnershipError{
			HostID: req.HostID,
			Reason: "the inventory record names no tailnet device id",
		}
	}
	for i := range t.devices {
		if t.devices[i].ID != req.DeviceID {
			continue
		}
		t.devices = append(t.devices[:i], t.devices[i+1:]...)
		t.removals++
		return nil
	}
	t.absentRemovals++
	return nil
}

// Removals reports how many devices were actually deleted.
func (t *Tailnet) Removals() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.removals
}

// AbsentRemovals reports how many removals found the device already gone, which is
// how a test proves the second teardown of a host is harmless.
func (t *Tailnet) AbsentRemovals() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.absentRemovals
}

// DeviceByID returns the device with the given id, if it is still registered.
func (t *Tailnet) DeviceByID(id string) (ports.TailnetDevice, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, device := range t.devices {
		if device.ID == id {
			return device, true
		}
	}
	return ports.TailnetDevice{}, false
}

// Secrets is a SecretSource over an in-memory map of references to values. It
// records every reference read so a test can assert which one was used.
type Secrets struct {
	mu      sync.Mutex
	values  map[string]string
	refs    []string
	readErr error
}

// NewSecrets builds a secret source.
func NewSecrets(values map[string]string) *Secrets {
	return &Secrets{values: values}
}

var _ ports.SecretSource = (*Secrets)(nil)

// FailWith makes every read fail.
func (s *Secrets) FailWith(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.readErr = err
}

// FetchSecret implements ports.SecretSource.
func (s *Secrets) FetchSecret(_ context.Context, ref string) (domain.Secret, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refs = append(s.refs, ref)
	if s.readErr != nil {
		return domain.Secret{}, s.readErr
	}
	value, ok := s.values[ref]
	if !ok {
		return domain.Secret{}, fmt.Errorf("fake secret source: %s not found", ref)
	}
	return domain.NewSecret(ref, []byte(value)), nil
}

// Refs returns the references that were read.
func (s *Secrets) Refs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.refs...)
}

// Minter is a fake ports.AuthKeyMinter. It hands out one fixed key so a
// test can follow that key through delivery, and it counts mints so a test can
// prove a resumed enrollment minted nothing.
type Minter struct {
	mu       sync.Mutex
	key      string
	err      error
	requests []ports.AuthKeyRequest
}

// NewMinter builds a minter that hands out key.
func NewMinter(key string) *Minter { return &Minter{key: key} }

var _ ports.AuthKeyMinter = (*Minter)(nil)

// FailWith makes the next and every later mint fail.
func (m *Minter) FailWith(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.err = err
}

// MintAuthKey implements ports.AuthKeyMinter.
func (m *Minter) MintAuthKey(_ context.Context, req ports.AuthKeyRequest) (ports.AuthKey, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return ports.AuthKey{}, m.err
	}
	m.requests = append(m.requests, req)
	return ports.AuthKey{
		ID:      "key-0001",
		Key:     domain.NewSecret("fake:authkey", []byte(m.key)),
		Tailnet: "fake",
	}, nil
}

// MintCount reports how many keys were minted.
func (m *Minter) MintCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.requests)
}

// Requests returns the requests the minter received.
func (m *Minter) Requests() []ports.AuthKeyRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]ports.AuthKeyRequest(nil), m.requests...)
}

// Enroller is a fake ports.HostEnroller. With a Tailnet attached it joins
// the device for real in that fake, so "a retry must not create a second device"
// can be asserted against device state rather than against a call counter alone.
type Enroller struct {
	mu       sync.Mutex
	tailnet  *Tailnet
	err      error
	calls    []ports.EnrollRequest
	nextKey  int
	keyValue string
}

// NewEnroller builds a fake enroller. tailnet may be nil.
func NewEnroller(tailnet *Tailnet) *Enroller {
	return &Enroller{tailnet: tailnet}
}

var _ ports.HostEnroller = (*Enroller)(nil)

// FailWith makes every enrollment fail.
func (e *Enroller) FailWith(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.err = err
}

// Enroll implements ports.HostEnroller.
func (e *Enroller) Enroll(_ context.Context, req ports.EnrollRequest) (ports.EnrollResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.err != nil {
		return ports.EnrollResult{}, e.err
	}
	e.calls = append(e.calls, req)
	if e.tailnet == nil {
		return ports.EnrollResult{DeviceID: "n-fake"}, nil
	}
	e.nextKey++
	key := fmt.Sprintf("%s-auth-%d", strings.TrimSpace(e.keyValue), e.nextKey)
	deviceID, err := e.tailnet.Join(req.Name, req.TailnetTag, key)
	if err != nil {
		return ports.EnrollResult{}, err
	}
	return ports.EnrollResult{DeviceID: deviceID}, nil
}

// CallCount reports how many enrollments ran.
func (e *Enroller) CallCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.calls)
}

// Requests returns the enrollment requests the fake received.
func (e *Enroller) Requests() []ports.EnrollRequest {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]ports.EnrollRequest(nil), e.calls...)
}
