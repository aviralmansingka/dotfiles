package ssm_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

func newAgentProbe(t *testing.T, executor *fakeExecutor) *ssm.AgentProbe {
	t.Helper()
	probe, err := ssm.NewAgentProbe(ssm.AgentProbeConfig{
		Client:       ssm.ClientConfig{Executor: executor},
		Timeout:      50 * time.Millisecond,
		PollInterval: time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewAgentProbe: %v", err)
	}
	return probe
}

// TestAgentProbeWaitsForOnlineRegistration covers the steady state: the instance
// is not registered at first, then reports Online, and the probe returns as soon
// as it does.
func TestAgentProbeWaitsForOnlineRegistration(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{respond: func(call int, _ ssm.Command) (ssm.Result, error) {
		if call < 2 {
			return ssm.Result{Stdout: `{"InstanceInformationList":[]}`}, nil
		}
		return ssm.Result{Stdout: fmt.Sprintf(
			`{"InstanceInformationList":[{"InstanceId":%q,"PingStatus":"Online","LastPingDateTime":"2026-11-09T05:00:00Z"}]}`,
			instanceID)}, nil
	}}
	status, err := newAgentProbe(t, executor).AwaitRegistration(context.Background(), instanceID)
	if err != nil {
		t.Fatalf("AwaitRegistration: %v", err)
	}
	if !status.Online || status.PingStatus != "Online" {
		t.Fatalf("status = %+v, want Online", status)
	}
	if status.LastPing.IsZero() {
		t.Fatal("the last ping time was not read")
	}
	if len(executor.calls) != 3 {
		t.Fatalf("aws calls = %d, want 3", len(executor.calls))
	}
	// The query is by instance id, never by a tag that another host could share.
	if argv := executor.argv(0); !strings.Contains(argv, "ssm describe-instance-information") ||
		!strings.Contains(argv, "Key=InstanceIds,Values="+instanceID) {
		t.Fatalf("the agent query is not addressed by instance id: %s", argv)
	}
}

// TestAgentProbeFailsClosedWhenTheAgentNeverRegisters is the fail-closed rule: the
// probe gives up, names the instance, and reports a status the job layer treats as
// permanent — there is no SSH fallback to try instead.
func TestAgentProbeFailsClosedWhenTheAgentNeverRegisters(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{respond: func(int, ssm.Command) (ssm.Result, error) {
		return ssm.Result{Stdout: fmt.Sprintf(
			`{"InstanceInformationList":[{"InstanceId":%q,"PingStatus":"ConnectionLost"}]}`, instanceID)}, nil
	}}
	_, err := newAgentProbe(t, executor).AwaitRegistration(context.Background(), instanceID)
	if err == nil {
		t.Fatal("AwaitRegistration must fail when the agent never comes online")
	}
	var notRegistered *domain.AgentNotRegisteredError
	if !errors.As(err, &notRegistered) {
		t.Fatalf("error does not wrap AgentNotRegisteredError: %v", err)
	}
	if notRegistered.InstanceID != instanceID {
		t.Fatalf("error names instance %q, want %q", notRegistered.InstanceID, instanceID)
	}
	if notRegistered.PingStatus != "ConnectionLost" {
		t.Fatalf("error ping status = %q, want the control plane's answer", notRegistered.PingStatus)
	}
	// The message says so outright: this service does not fall back to ssh.
	jobErr := application.SanitizeError(err)
	if jobErr.Retryable {
		t.Fatal("an unregistered agent must be a non-retryable job failure")
	}
	if jobErr.Code != application.CodeAgentUnavailable {
		t.Fatalf("job error code = %q, want %q", jobErr.Code, application.CodeAgentUnavailable)
	}
	if !strings.Contains(jobErr.Message, "does not fall back to ssh") {
		t.Fatalf("the job error does not state the fail-closed rule: %q", jobErr.Message)
	}
}

// TestAgentProbeIgnoresARecordForAnotherInstance: the filter is not trusted. A
// reply that names a different instance is not this host's answer.
func TestAgentProbeIgnoresARecordForAnotherInstance(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{respond: func(int, ssm.Command) (ssm.Result, error) {
		return ssm.Result{Stdout: fmt.Sprintf(
			`{"InstanceInformationList":[{"InstanceId":%q,"PingStatus":"Online"}]}`, otherInstance)}, nil
	}}
	_, err := newAgentProbe(t, executor).AwaitRegistration(context.Background(), instanceID)
	if err == nil {
		t.Fatal("a record for another instance must not count as this host's registration")
	}
}

// TestAgentProbeStopsWhenTheContextEnds keeps a canceled job from waiting out the
// whole window.
func TestAgentProbeStopsWhenTheContextEnds(t *testing.T) {
	t.Parallel()
	probe, err := ssm.NewAgentProbe(ssm.AgentProbeConfig{
		Client:       ssm.ClientConfig{Executor: &fakeExecutor{}},
		Timeout:      time.Minute,
		PollInterval: 10 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewAgentProbe: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := probe.AwaitRegistration(ctx, instanceID); err == nil {
		t.Fatal("a canceled context must end the wait")
	}
}

// TestNewAgentProbeRejectsANonsenseWindow keeps a poll interval longer than the
// timeout from making the probe wait once and give up.
func TestNewAgentProbeRejectsANonsenseWindow(t *testing.T) {
	t.Parallel()
	if _, err := ssm.NewAgentProbe(ssm.AgentProbeConfig{
		Client:       ssm.ClientConfig{Executor: &fakeExecutor{}},
		Timeout:      time.Second,
		PollInterval: time.Minute,
	}); err == nil {
		t.Fatal("NewAgentProbe must refuse an interval longer than the timeout")
	}
	if _, err := ssm.NewAgentProbe(ssm.AgentProbeConfig{
		Client: ssm.ClientConfig{Executor: &fakeExecutor{}, Region: "mars-north-1"},
	}); err == nil {
		t.Fatal("NewAgentProbe must refuse an unapproved region")
	}
}
