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

	"go.temporal.io/sdk/temporal"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

// Activities holds the adapters that perform real work. Every dependency is a
// port from internal/application, so an S01 stub can replace a real integration
// without touching workflow code.
type Activities struct {
	Inventory  application.HostInventory
	Providers  application.HostProvider
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

// CreateHostResource allocates the compute resource.
func (a *Activities) CreateHostResource(ctx context.Context, in workflows.CreateHostResourceInput) (workflows.CreateHostResourceOutput, error) {
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
	a.log("host.resource.created", "host_id", in.HostID, "resource_id", resource.ResourceID)
	return workflows.CreateHostResourceOutput{
		ResourceID:     resource.ResourceID,
		PrivateAddress: resource.PrivateAddress,
	}, nil
}

// EnrollHost performs the trusted-SSH tailnet enrollment.
func (a *Activities) EnrollHost(ctx context.Context, in workflows.EnrollHostInput) (workflows.EnrollHostOutput, error) {
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
	a.log("host.enrolled",
		"host_id", in.HostID,
		"device_id", result.DeviceID,
		"tailnet_tag", result.TailnetTag,
		"resumed", result.Resumed,
	)
	return workflows.EnrollHostOutput{
		DeviceID:           result.DeviceID,
		HostKeyFingerprint: result.HostKey,
		TailnetTag:         result.TailnetTag,
		Resumed:            result.Resumed,
	}, nil
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
func (a *Activities) DestroyHostResource(ctx context.Context, in workflows.DestroyHostResourceInput) error {
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
// workflow history expiry.
func (a *Activities) RecordHostMilestone(ctx context.Context, in workflows.RecordHostMilestoneInput) error {
	now := a.Clock.Now()
	_, err := a.Inventory.UpdateHost(ctx, in.HostID, func(h *domain.Host) error {
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
	switch {
	case errors.As(err, &notImplemented), errors.As(err, &invalid):
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
