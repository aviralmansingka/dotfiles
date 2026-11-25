// Package temporaladapter binds the deterministic workflows to the Temporal SDK:
// activity implementations, the client-backed job orchestrator, and worker
// registration. No credential value crosses this boundary: activity payloads
// carry references, and every failure is sanitized before it becomes an
// application error.
package temporaladapter

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"go.temporal.io/sdk/temporal"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

// Activities holds the adapters that perform real work. Every dependency is a
// port from internal/application, so an S01 stub can replace a real integration
// without touching workflow code.
type Activities struct {
	Inventory application.HostInventory
	Providers application.HostProvider
	// Agent proves a host's SSM agent registered. It is a separate dependency
	// because the check is its own activity, ahead of enrollment.
	Agent      application.SSMAgentProbe
	Enroller   application.HostEnroller
	Deployer   application.ProfileDeployer
	Authorizer application.HostAuthorizer
	Tailnet    application.TailnetDeviceManager
	Clock      application.Clock
	Logger     application.Logger
}

// Validate reports a missing dependency before a worker starts.
func (a *Activities) Validate() error {
	switch {
	case a.Inventory == nil:
		return errors.New("temporal: host inventory is required")
	case a.Providers == nil:
		return errors.New("temporal: host provider is required")
	case a.Enroller == nil:
		return errors.New("temporal: host enroller is required")
	case a.Agent == nil:
		return errors.New("temporal: ssm agent probe is required")
	case a.Deployer == nil:
		return errors.New("temporal: profile deployer is required")
	case a.Authorizer == nil:
		return errors.New("temporal: host authorizer is required")
	case a.Tailnet == nil:
		return errors.New("temporal: tailnet device manager is required")
	case a.Clock == nil:
		return errors.New("temporal: clock is required")
	case a.Logger == nil:
		return errors.New("temporal: logger is required")
	}
	return nil
}

// CreateHostResource allocates the compute resource, or adopts the allocation a
// previous attempt already made.
//
// The order here is the recovery contract. A record that already names a provider
// resource is durable proof that this host owns an instance, so the record wins
// and the provider is not asked again. Otherwise the provider is asked once and
// the public identity is written down immediately, before any later step can run:
// a worker that dies between allocation and its own milestone leaves an adopter,
// not an orphan. The write is not best-effort — an activity that cannot record
// what it allocated fails, and the retry adopts instead of allocating twice.
func (a *Activities) CreateHostResource(ctx context.Context, in workflows.CreateHostResourceInput) (workflows.CreateHostResourceOutput, error) {
	if existing, ok, err := a.recordedResource(ctx, in.HostID); err != nil {
		return workflows.CreateHostResourceOutput{}, a.activityError("create_host_resource", in.HostID, err)
	} else if ok {
		a.log("host.resource.adopted",
			"host_id", in.HostID,
			"resource_id", existing.ResourceID,
			"reason", "the inventory record already owns this resource",
		)
		return workflows.CreateHostResourceOutput{
			ResourceID:     existing.ResourceID,
			PrivateAddress: existing.PrivateAddress,
			Resumed:        true,
		}, nil
	}

	resource, err := a.Providers.CreateHost(ctx, application.ProviderCreateRequest{
		HostID:       in.HostID,
		Name:         in.Name,
		Provider:     domain.Provider(in.Provider),
		Profile:      in.Profile,
		Region:       in.Region,
		Size:         in.Size,
		InstanceType: in.InstanceType,
		DiskGB:       in.DiskGB,
		Tags:         in.Tags,
	})
	if err != nil {
		return workflows.CreateHostResourceOutput{}, a.activityError("create_host_resource", in.HostID, err)
	}
	if err := a.persistResource(ctx, in.HostID, resource); err != nil {
		return workflows.CreateHostResourceOutput{}, a.activityError("create_host_resource.record", in.HostID, err)
	}
	a.log("host.resource.created", "host_id", in.HostID, "resource_id", resource.ResourceID)
	return workflows.CreateHostResourceOutput{
		ResourceID:     resource.ResourceID,
		PrivateAddress: resource.PrivateAddress,
	}, nil
}

// recordedResource reports the provider resource the inventory already assigns to
// hostID. A record without a resource id is not an allocation.
func (a *Activities) recordedResource(ctx context.Context, hostID string) (domain.Host, bool, error) {
	host, err := a.Inventory.GetHost(ctx, hostID)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return domain.Host{}, false, nil
	case err != nil:
		return domain.Host{}, false, err
	}
	if host.ResourceID == "" {
		return domain.Host{}, false, nil
	}
	return host, true, nil
}

// recordedDevice reports the tailnet device the inventory already assigns to
// hostID.
func (a *Activities) recordedDevice(ctx context.Context, hostID string) (string, bool, error) {
	host, err := a.Inventory.GetHost(ctx, hostID)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return "", false, nil
	case err != nil:
		return "", false, err
	}
	if host.DeviceID == "" {
		return "", false, nil
	}
	return host.DeviceID, true, nil
}

func (a *Activities) persistResource(ctx context.Context, hostID string, resource application.ProviderResource) error {
	now := a.Clock.Now()
	_, err := a.Inventory.UpdateHost(ctx, hostID, func(h *domain.Host) error {
		h.MarkResource(resource.ResourceID, resource.PrivateAddress, now)
		return nil
	})
	return err
}

// CheckSSMAgent waits for the host's SSM agent to register and records the
// answer. It runs before enrollment, and it is the only gate: a host whose agent
// never registers fails the job, and nothing falls back to SSH.
func (a *Activities) CheckSSMAgent(ctx context.Context, in workflows.CheckSSMAgentInput) (workflows.CheckSSMAgentOutput, error) {
	status, err := a.Agent.AwaitRegistration(ctx, in.InstanceID)
	if err != nil {
		return workflows.CheckSSMAgentOutput{}, a.activityError("check_ssm_agent", in.HostID, err)
	}
	a.log("host.agent.online",
		"host_id", in.HostID,
		"instance_id", status.InstanceID,
		"ping_status", status.PingStatus,
	)
	return workflows.CheckSSMAgentOutput{
		InstanceID: status.InstanceID,
		PingStatus: status.PingStatus,
		Online:     status.Online,
	}, nil
}

// EnrollHost performs the SSM tailnet enrollment, or adopts the device a previous
// attempt already enrolled.
//
// The inventory record wins for the same reason it does for the resource: a device
// id in the record proves this host already holds a tailnet identity, so a resume
// does not ask for a second one. The adapter resumes an already-running device on
// its own, so both layers agree, and a device that joined just before a crash
// without being recorded still resumes instead of joining twice.
func (a *Activities) EnrollHost(ctx context.Context, in workflows.EnrollHostInput) (workflows.EnrollHostOutput, error) {
	if deviceID, ok, err := a.recordedDevice(ctx, in.HostID); err != nil {
		return workflows.EnrollHostOutput{}, a.activityError("enroll_host", in.HostID, err)
	} else if ok {
		a.log("host.enroll.adopted", "host_id", in.HostID, "device_id", deviceID, "reason", "the inventory record already owns this device")
		return workflows.EnrollHostOutput{DeviceID: deviceID, Resumed: true}, nil
	}

	result, err := a.Enroller.Enroll(ctx, application.EnrollRequest{
		HostID:         in.HostID,
		Name:           in.Name,
		InstanceID:     in.ResourceID,
		PrivateAddress: in.PrivateAddress,
		Profile:        in.Profile,
		SecretBundles:  in.SecretBundles,
	})
	if err != nil {
		return workflows.EnrollHostOutput{}, a.activityError("enroll_host", in.HostID, err)
	}
	if err := a.persistDevice(ctx, in.HostID, result.DeviceID); err != nil {
		return workflows.EnrollHostOutput{}, a.activityError("enroll_host.record", in.HostID, err)
	}
	a.log("host.enrolled",
		"host_id", in.HostID,
		"device_id", result.DeviceID,
		"tailnet_tag", result.TailnetTag,
		"resumed", result.Resumed,
	)
	return workflows.EnrollHostOutput{
		DeviceID:   result.DeviceID,
		TailnetTag: result.TailnetTag,
		Resumed:    result.Resumed,
	}, nil
}

func (a *Activities) persistDevice(ctx context.Context, hostID, deviceID string) error {
	now := a.Clock.Now()
	_, err := a.Inventory.UpdateHost(ctx, hostID, func(h *domain.Host) error {
		h.MarkDevice(deviceID, now)
		return nil
	})
	return err
}

// DeployProfile deploys the approved flake profile.
func (a *Activities) DeployProfile(ctx context.Context, in workflows.DeployProfileInput) (workflows.DeployProfileOutput, error) {
	result, err := a.Deployer.DeployProfile(ctx, application.DeployRequest{
		HostID:   in.HostID,
		Name:     in.Name,
		Profile:  in.Profile,
		FlakeRef: in.FlakeRef,
	})
	if err != nil {
		return workflows.DeployProfileOutput{}, a.activityError("deploy_profile", in.HostID, err)
	}
	a.log("host.deployed", "host_id", in.HostID, "flake_revision", result.FlakeRevision)
	return workflows.DeployProfileOutput{FlakeRevision: result.FlakeRevision, RexURL: result.RexURL}, nil
}

// AuthorizeHost grants the approved secret bundles.
func (a *Activities) AuthorizeHost(ctx context.Context, in workflows.AuthorizeHostInput) error {
	if err := a.Authorizer.AuthorizeHost(ctx, application.AuthorizeRequest{
		HostID:        in.HostID,
		Name:          in.Name,
		Profile:       in.Profile,
		SecretBundles: in.SecretBundles,
	}); err != nil {
		return a.activityError("authorize_host", in.HostID, err)
	}
	a.log("host.authorized", "host_id", in.HostID)
	return nil
}

// RevokeHostAccess revokes the host's OpenBao identity.
func (a *Activities) RevokeHostAccess(ctx context.Context, in workflows.RevokeHostAccessInput) error {
	if err := a.Authorizer.RevokeHost(ctx, application.AuthorizeRequest{
		HostID:        in.HostID,
		Name:          in.Name,
		Profile:       in.Profile,
		SecretBundles: in.SecretBundles,
	}); err != nil {
		return a.activityError("revoke_host_access", in.HostID, err)
	}
	a.log("host.access_revoked", "host_id", in.HostID)
	return nil
}

// RemoveDevice removes the tailnet device.
func (a *Activities) RemoveDevice(ctx context.Context, in workflows.RemoveDeviceInput) error {
	if err := a.Tailnet.RemoveDevice(ctx, application.RemoveDeviceRequest{
		HostID:   in.HostID,
		DeviceID: in.DeviceID,
	}); err != nil {
		return a.activityError("remove_device", in.HostID, err)
	}
	a.log("host.device_removed", "host_id", in.HostID)
	return nil
}

// DestroyHostResource destroys the provider resource.
//
// A destroy without a recorded provider identity is refused, permanently. The
// record is what proves the mapping from this host to that instance; without it a
// destroy would either remove a resource this job does not own or leave an orphan
// that nothing can find. Ambiguity is an operator decision, never an automatic
// teardown.
func (a *Activities) DestroyHostResource(ctx context.Context, in workflows.DestroyHostResourceInput) error {
	if strings.TrimSpace(in.ResourceID) == "" {
		return a.activityError("destroy_host_resource", in.HostID, &domain.AmbiguousOwnershipError{
			HostID: in.HostID,
			Reason: "the inventory record names no provider resource id",
		})
	}
	if err := a.Providers.DestroyHost(ctx, application.ProviderDestroyRequest{
		HostID:     in.HostID,
		Name:       in.Name,
		Provider:   domain.Provider(in.Provider),
		Profile:    in.Profile,
		Region:     in.Region,
		Size:       in.Size,
		ResourceID: in.ResourceID,
	}); err != nil {
		return a.activityError("destroy_host_resource", in.HostID, err)
	}
	a.log("host.resource.destroyed", "host_id", in.HostID)
	return nil
}

// RecordHostMilestone persists progress in the inventory so ownership survives
// workflow history expiry. The resource and device ids travel with every
// milestone: a milestone that supersedes an earlier one cannot lose the
// allocation it already records.
func (a *Activities) RecordHostMilestone(ctx context.Context, in workflows.RecordHostMilestoneInput) error {
	now := a.Clock.Now()
	_, err := a.Inventory.UpdateHost(ctx, in.HostID, func(h *domain.Host) error {
		if domain.JobState(in.State) == domain.JobCanceled {
			// A canceled job is not a failure and not a teardown: the record stays
			// provisioning so whatever it allocated is still owned and reconcilable.
			h.State = domain.HostStateProvisioning
			h.UpdatedAt = now.UTC()
		} else {
			switch domain.HostState(in.State) {
			case domain.HostStateReady:
				h.MarkReady(in.FlakeRevision, in.PrivateAddress, in.RexURL, now)
			case domain.HostStateFailed:
				h.MarkFailed(now)
			case domain.HostStateDeleting:
				h.MarkDeleting(now)
			case domain.HostStateDeleted:
				h.MarkDeleted(now)
			default:
				h.State = domain.HostStateProvisioning
				h.UpdatedAt = now.UTC()
			}
		}
		if in.ResourceID != "" {
			h.MarkResource(in.ResourceID, in.PrivateAddress, now)
		}
		if in.DeviceID != "" {
			h.MarkDevice(in.DeviceID, now)
		}
		if in.PrivateAddress != "" {
			h.PrivateAddress = in.PrivateAddress
		}
		if in.FlakeRevision != "" {
			h.FlakeRevision = in.FlakeRevision
		}
		if in.RexURL != "" {
			h.RexURL = in.RexURL
		}
		return nil
	})
	if err != nil {
		return err
	}
	a.log("host.milestone", "host_id", in.HostID, "stage", in.Stage, "state", in.State)
	return nil
}

// activityError converts a domain failure into a Temporal application error.
// Not-implemented and validation failures are non-retryable and carry a
// sanitized message; anything else is returned as-is so the SDK retry policy
// applies.
func (a *Activities) activityError(operation, hostID string, err error) error {
	jobErr := application.SanitizeError(err)
	a.log("activity.failed", "operation", operation, "host_id", hostID, "code", jobErr.Code, "error", jobErr.Message)
	var notImplemented *domain.NotImplementedError
	var invalid *domain.ValidationError
	var agent *domain.AgentNotRegisteredError
	var claim *domain.RoleClaimError
	var consumed *domain.WrapTokenConsumedError
	var identityErr *domain.IdentityError
	var ambiguous *domain.AmbiguousOwnershipError
	switch {
	case errors.As(err, &notImplemented), errors.As(err, &invalid), errors.As(err, &agent),
		errors.As(err, &claim), errors.As(err, &consumed), errors.As(err, &identityErr),
		errors.As(err, &ambiguous):
		return temporal.NewNonRetryableApplicationError(jobErr.Message, jobErr.Code, nil)
	default:
		return fmt.Errorf("%s: %s", operation, jobErr.Message)
	}
}

func (a *Activities) log(msg string, kv ...any) {
	if a.Logger == nil {
		return
	}
	a.Logger.Info(msg, kv...)
}
