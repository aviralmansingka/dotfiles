package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// EnrollmentDeps are the collaborators the enrollment use case needs.
type EnrollmentDeps struct {
	// Profiles resolves the approved tailnet tag and key policy. It is the only
	// source of a tag in the service.
	Profiles domain.Catalog
	// Devices reports already-registered tailnet devices. It is required: without
	// it a retry cannot tell "already enrolled" from "not enrolled yet", and a
	// blind re-mint would register a second node for the same host.
	Devices ports.DeviceLookup
	// Enroller performs the host enrollment (SSM-only in this tree).
	Enroller ports.HostEnroller
	Logger   ports.Logger
}

// EnrollmentService is the enrollment use case: it resolves the approved tag, and
// it consults existing device state before any new identity is minted.
//
// It implements HostEnroller, so the Temporal activity keeps a single port and
// the workflow never learns about device lookups or key minting.
type EnrollmentService struct {
	profiles domain.Catalog
	devices  ports.DeviceLookup
	enroller ports.HostEnroller
	log      ports.Logger
}

// NewEnrollmentService validates dependencies and builds the use case.
func NewEnrollmentService(deps EnrollmentDeps) (*EnrollmentService, error) {
	if deps.Devices == nil {
		return nil, errors.New("application: device lookup is required for enrollment")
	}
	if deps.Enroller == nil {
		return nil, errors.New("application: host enroller is required")
	}
	if deps.Logger == nil {
		return nil, errors.New("application: logger is required")
	}
	return &EnrollmentService{
		profiles: deps.Profiles,
		devices:  deps.Devices,
		enroller: deps.Enroller,
		log:      deps.Logger,
	}, nil
}

var _ ports.HostEnroller = (*EnrollmentService)(nil)

// Enroll resumes an already-running device or runs the bootstrap once.
//
// The order is the point:
//  1. resolve the tag from the approved profile (never from the request),
//  2. look the device up by host name and that tag,
//  3. resume when it is already running — no key minted, no second node,
//  4. otherwise bootstrap, which is the only path that mints a key.
func (s *EnrollmentService) Enroll(ctx context.Context, req ports.EnrollRequest) (ports.EnrollResult, error) {
	profile, ok := s.profiles.Profile(req.Profile)
	if !ok {
		return ports.EnrollResult{}, domain.Invalid("profile", fmt.Sprintf("%q is not an approved profile", req.Profile))
	}
	// A tag on the request is allowed only when it is exactly the one the profile
	// resolves to: the workflow copies it back from the plan, and any other value
	// means a client-selected tag reached the application layer.
	plan, err := domain.ResolveEnrollment(profile, nil)
	if err != nil {
		return ports.EnrollResult{}, err
	}
	if req.TailnetTag != "" && req.TailnetTag != plan.Tag {
		return ports.EnrollResult{}, domain.Invalid("tailnet_tag",
			"is resolved server-side from the approved profile; a client cannot select a tag")
	}
	if err := req.KeyPolicyOrDefault().Validate(); err != nil {
		return ports.EnrollResult{}, domain.Invalid("auth_key_policy", err.Error())
	}

	device, found, err := s.devices.LookupDevice(ctx, ports.DeviceQuery{HostName: req.Name, Tag: plan.Tag})
	if err != nil {
		// A lookup failure must not fall through to minting: that is exactly the
		// path that would register a second device for a host that already has one.
		return ports.EnrollResult{}, fmt.Errorf("look up tailnet device %q: %w", req.Name, err)
	}
	if found && device.HasTag(plan.Tag) && device.Running() {
		s.log.Info("host.enroll.resumed",
			"host_id", req.HostID,
			"device_id", device.ID,
			"tailnet_tag", plan.Tag,
		)
		return ports.EnrollResult{
			DeviceID:   device.ID,
			TailnetTag: plan.Tag,
			Resumed:    true,
		}, nil
	}
	if found {
		// Registered but not running: it never came up, so this attempt bootstraps
		// again. The stale record is reported by device id only.
		s.log.Warn("host.enroll.device_not_running",
			"host_id", req.HostID,
			"device_id", device.ID,
			"state", device.State,
			"tailnet_tag", plan.Tag,
		)
	}

	result, err := s.enroller.Enroll(ctx, ports.EnrollRequest{
		HostID:         req.HostID,
		Name:           req.Name,
		InstanceID:     req.InstanceID,
		PrivateAddress: req.PrivateAddress,
		Profile:        profile.Name,
		TailnetTag:     plan.Tag,
		KeyPolicy:      plan.KeyPolicy,
		SecretBundles:  append([]string(nil), req.SecretBundles...),
	})
	if err != nil {
		return ports.EnrollResult{}, err
	}
	if result.DeviceID == "" {
		return ports.EnrollResult{}, errors.New("application: enrollment reported no device id")
	}
	result.TailnetTag = plan.Tag
	result.Resumed = false
	s.log.Info("host.enroll.enrolled",
		"host_id", req.HostID,
		"device_id", result.DeviceID,
		"tailnet_tag", plan.Tag,
	)
	return result, nil
}
