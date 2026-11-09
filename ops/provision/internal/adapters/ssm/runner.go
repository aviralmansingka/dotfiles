package ssm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const (
	// DefaultCommandTimeoutSeconds is how long the host may take to finish one
	// enrollment command. A command that outlives it is cancelled by the control
	// plane, which is what bounds a hung `tailscale up`.
	DefaultCommandTimeoutSeconds = 180

	// DefaultPollInterval is how often the invocation is polled for its status.
	DefaultPollInterval = 2 * time.Second
)

// RunnerConfig configures the SSM Run Command transport.
type RunnerConfig struct {
	Client ClientConfig
	// CommandTimeoutSeconds bounds one host command. Defaults to
	// DefaultCommandTimeoutSeconds.
	CommandTimeoutSeconds int
	// PollInterval is the status poll interval. Defaults to DefaultPollInterval.
	PollInterval time.Duration
}

// Runner delivers one command to one instance over SSM Run Command.
type Runner struct {
	client       *Client
	timeout      int
	pollInterval time.Duration
}

var _ application.SSMRunner = (*Runner)(nil)

// NewRunner validates the configuration and builds the transport.
func NewRunner(cfg RunnerConfig) (*Runner, error) {
	client, err := NewClient(cfg.Client)
	if err != nil {
		return nil, err
	}
	timeout := cfg.CommandTimeoutSeconds
	if timeout <= 0 {
		timeout = DefaultCommandTimeoutSeconds
	}
	if timeout > 24*60*60 {
		return nil, errors.New("ssm: command timeout must be at most one day")
	}
	interval := cfg.PollInterval
	if interval <= 0 {
		interval = DefaultPollInterval
	}
	return &Runner{client: client, timeout: timeout, pollInterval: interval}, nil
}

// sendCommandInput is the `ssm send-command` request body. It is written to a
// file and passed as `--cli-input-json` rather than as flags, because the command
// script is multi-line text: one JSON string keeps it a single value instead of
// letting the CLI's shorthand parser interpret it.
//
// The script carries a parameter name and a nonce only. SSM keeps this document
// in command history, so it must never carry a credential.
type sendCommandInput struct {
	InstanceIDs    []string            `json:"InstanceIds"`
	DocumentName   string              `json:"DocumentName"`
	Comment        string              `json:"Comment"`
	TimeoutSeconds int                 `json:"TimeoutSeconds"`
	Parameters     map[string][]string `json:"Parameters"`
}

// sendCommandOutput is the part of the send-command reply this adapter reads.
type sendCommandOutput struct {
	Command struct {
		CommandID string `json:"CommandId"`
	} `json:"Command"`
}

// invocation is the part of `get-command-invocation` this adapter reads.
type invocation struct {
	CommandID               string `json:"CommandId"`
	InstanceID              string `json:"InstanceId"`
	Comment                 string `json:"Comment"`
	Status                  string `json:"Status"`
	ResponseCode            int    `json:"ResponseCode"`
	StandardOutputContent   string `json:"StandardOutputContent"`
	StandardErrorContent    string `json:"StandardErrorContent"`
	StandardOutputTruncated *bool  `json:"StandardOutputTruncated"`
}

// RunCommand implements application.SSMRunner: it sends the command by instance
// id, then polls the invocation until it reaches a terminal status.
func (r *Runner) RunCommand(ctx context.Context, req application.SSMRunRequest) (application.SSMRunResult, error) {
	if err := domain.ValidateInstanceID(req.InstanceID); err != nil {
		return application.SSMRunResult{}, err
	}
	if strings.TrimSpace(req.Command) == "" {
		return application.SSMRunResult{}, errors.New("ssm: refusing to send an empty command")
	}

	commandID, err := r.send(ctx, req)
	if err != nil {
		return application.SSMRunResult{}, err
	}
	result, err := r.await(ctx, commandID, req.InstanceID)
	if err != nil {
		return result, err
	}
	if result.InstanceID != req.InstanceID {
		// The control plane answered for another instance. IAM addressing makes
		// this pathological, so it is refused rather than repaired.
		return application.SSMRunResult{}, fmt.Errorf(
			"ssm: invocation for instance %q answered for %q; refusing a reply that belongs to another host",
			req.InstanceID, result.InstanceID)
	}
	if req.Comment != "" && result.Comment != req.Comment {
		return application.SSMRunResult{}, fmt.Errorf(
			"ssm: invocation correlation comment %q does not match %q", result.Comment, req.Comment)
	}
	return result, nil
}

// send issues `ssm send-command` and returns the command id to poll.
func (r *Runner) send(ctx context.Context, req application.SSMRunRequest) (string, error) {
	body := sendCommandInput{
		InstanceIDs:    []string{req.InstanceID},
		DocumentName:   runShellScriptDocument,
		Comment:        req.Comment,
		TimeoutSeconds: r.timeout,
		Parameters:     map[string][]string{"commands": {req.Command}},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("ssm: encode send-command input: %w", err)
	}
	file, err := os.CreateTemp("", "fleet-ssm-command-*.json")
	if err != nil {
		return "", fmt.Errorf("ssm: create send-command input: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(encoded); err != nil {
		_ = file.Close()
		return "", fmt.Errorf("ssm: write send-command input: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("ssm: close send-command input: %w", err)
	}

	result, err := r.client.run(ctx,
		"ssm", "send-command",
		"--cli-input-json", "file://"+file.Name(),
		"--output", "json",
	)
	if err != nil {
		return "", fmt.Errorf("ssm: send command to %s: %w", req.InstanceID, err)
	}
	var decoded sendCommandOutput
	if err := json.Unmarshal([]byte(result.Stdout), &decoded); err != nil {
		return "", fmt.Errorf("ssm: send-command reply is not JSON: %w", err)
	}
	if decoded.Command.CommandID == "" {
		return "", fmt.Errorf("ssm: send-command to %s returned no command id", req.InstanceID)
	}
	return decoded.Command.CommandID, nil
}

// await polls the invocation until it is terminal or the context ends.
//
// "InvocationDoesNotExist" is not an error here: it is the normal answer for the
// first moments after send-command, before the control plane has materialized the
// invocation record.
func (r *Runner) await(ctx context.Context, commandID, instanceID string) (application.SSMRunResult, error) {
	for {
		result, err := r.client.run(ctx,
			"ssm", "get-command-invocation",
			"--command-id", commandID,
			"--instance-id", instanceID,
			"--output", "json",
		)
		if err != nil {
			if notFound(err, "InvocationDoesNotExist") {
				if waitErr := r.wait(ctx); waitErr != nil {
					return application.SSMRunResult{}, waitErr
				}
				continue
			}
			return application.SSMRunResult{}, fmt.Errorf("ssm: poll invocation %s: %w", commandID, err)
		}
		var inv invocation
		if err := json.Unmarshal([]byte(result.Stdout), &inv); err != nil {
			return application.SSMRunResult{}, fmt.Errorf("ssm: invocation reply is not JSON: %w", err)
		}
		if inv.CommandID != "" && inv.CommandID != commandID {
			return application.SSMRunResult{}, fmt.Errorf(
				"ssm: asked for invocation %s and got %s; refusing a reply that belongs to another command",
				commandID, inv.CommandID)
		}
		if terminal(inv.Status) {
			return application.SSMRunResult{
				InstanceID: inv.InstanceID,
				Comment:    inv.Comment,
				Status:     inv.Status,
				ExitCode:   inv.ResponseCode,
				Stdout:     inv.StandardOutputContent,
				Stderr:     inv.StandardErrorContent,
			}, nil
		}
		if waitErr := r.wait(ctx); waitErr != nil {
			return application.SSMRunResult{}, waitErr
		}
	}
}

func (r *Runner) wait(ctx context.Context) error {
	timer := time.NewTimer(r.pollInterval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return fmt.Errorf("ssm: wait for the invocation: %w", ctx.Err())
	case <-timer.C:
		return nil
	}
}

// terminal reports whether an invocation status will not change again.
func terminal(status string) bool {
	switch status {
	case "", "Pending", "InProgress", "Delayed":
		return false
	default:
		return true
	}
}
