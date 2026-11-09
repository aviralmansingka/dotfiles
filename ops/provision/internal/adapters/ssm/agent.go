package ssm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const (
	// DefaultAgentTimeout is how long an enrollment waits for a host's SSM agent
	// to register. A first boot installs packages and starts the daemon, so the
	// window is minutes, not seconds; a host that has not registered by then has
	// failed, and the attempt aborts instead of waiting forever.
	DefaultAgentTimeout = 4 * time.Minute

	// DefaultAgentPollInterval is how often the control plane is asked.
	DefaultAgentPollInterval = 5 * time.Second

	// agentStatusOnline is the control-plane ping status of a reachable agent.
	agentStatusOnline = "Online"
)

// AgentProbeConfig configures the agent check.
type AgentProbeConfig struct {
	Client ClientConfig
	// Timeout bounds the wait. Defaults to DefaultAgentTimeout.
	Timeout time.Duration
	// PollInterval is the query interval. Defaults to DefaultAgentPollInterval.
	PollInterval time.Duration
}

// AgentProbe reports whether an instance's SSM agent has registered with the
// control plane.
//
// This is the gate in front of enrollment: Run Command cannot reach an unregistered
// agent, and there is no fallback transport, so the attempt must fail before
// anything is minted.
type AgentProbe struct {
	client       *Client
	timeout      time.Duration
	pollInterval time.Duration
}

var _ application.SSMAgentProbe = (*AgentProbe)(nil)

// NewAgentProbe validates the configuration and builds the probe.
func NewAgentProbe(cfg AgentProbeConfig) (*AgentProbe, error) {
	client, err := NewClient(cfg.Client)
	if err != nil {
		return nil, err
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = DefaultAgentTimeout
	}
	interval := cfg.PollInterval
	if interval <= 0 {
		interval = DefaultAgentPollInterval
	}
	if interval > timeout {
		return nil, errors.New("ssm: agent poll interval must not exceed the agent timeout")
	}
	return &AgentProbe{client: client, timeout: timeout, pollInterval: interval}, nil
}

// describeInstanceInformation is the part of the reply this adapter reads: one
// record per instance, and only the fields that answer "has it registered, and
// when did it last report".
type describeInstanceInformation struct {
	InstanceInformationList []struct {
		InstanceID   string `json:"InstanceId"`
		PingStatus   string `json:"PingStatus"`
		LastPingTime string `json:"LastPingDateTime"`
	} `json:"InstanceInformationList"`
}

// AwaitRegistration polls the control plane until the agent reports Online, and
// refuses to wait forever. The returned error wraps
// domain.AgentNotRegisteredError, which the job layer reports as a non-retryable
// failure: a host whose agent never registered is not enrolled, and this service
// does not reach for SSH to rescue it.
func (p *AgentProbe) AwaitRegistration(ctx context.Context, instanceID string) (application.SSMAgentStatus, error) {
	if err := domain.ValidateInstanceID(instanceID); err != nil {
		return application.SSMAgentStatus{}, err
	}
	deadline := time.Now().Add(p.timeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}

	var last application.SSMAgentStatus
	for {
		status, err := p.query(ctx, instanceID)
		if err != nil {
			return application.SSMAgentStatus{}, err
		}
		last = status
		if status.Online {
			return status, nil
		}
		if !time.Now().Add(p.pollInterval).Before(deadline) {
			break
		}
		if waitErr := waitFor(ctx, p.pollInterval); waitErr != nil {
			return application.SSMAgentStatus{}, waitErr
		}
	}
	return last, fmt.Errorf("wait for the ssm agent on %s: %w", instanceID, &domain.AgentNotRegisteredError{
		InstanceID: instanceID,
		Waited:     p.timeout,
		PingStatus: last.PingStatus,
	})
}

// query asks the control plane once. An instance the control plane has never seen
// is a "not yet", not an error: that is exactly what a host a few seconds old
// looks like.
func (p *AgentProbe) query(ctx context.Context, instanceID string) (application.SSMAgentStatus, error) {
	result, err := p.client.run(ctx,
		"ssm", "describe-instance-information",
		"--filters", "Key=InstanceIds,Values="+instanceID,
		"--output", "json",
	)
	if err != nil {
		return application.SSMAgentStatus{}, fmt.Errorf("ssm: describe instance information for %s: %w", instanceID, err)
	}
	var decoded describeInstanceInformation
	if err := json.Unmarshal([]byte(result.Stdout), &decoded); err != nil {
		return application.SSMAgentStatus{}, fmt.Errorf("ssm: describe-instance-information reply is not JSON: %w", err)
	}
	for _, info := range decoded.InstanceInformationList {
		// Only a record for this instance counts. The filter asks for one id, and
		// the check makes a reply that ignores the filter harmless.
		if info.InstanceID != instanceID {
			continue
		}
		status := application.SSMAgentStatus{
			InstanceID: info.InstanceID,
			PingStatus: info.PingStatus,
			Online:     info.PingStatus == agentStatusOnline,
		}
		if parsed, err := time.Parse(time.RFC3339, info.LastPingTime); err == nil {
			status.LastPing = parsed
		}
		return status, nil
	}
	return application.SSMAgentStatus{InstanceID: instanceID}, nil
}

// waitFor pauses for d or until the context ends, whichever comes first.
func waitFor(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return fmt.Errorf("ssm: wait: %w", ctx.Err())
	case <-timer.C:
		return nil
	}
}
