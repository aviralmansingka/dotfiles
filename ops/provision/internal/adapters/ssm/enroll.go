package ssm

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const (
	// nonceBytes is the entropy of the per-attempt parameter segment. 128 bits
	// makes a collision between two attempts on the same host implausible, and the
	// nonce is what ties one command to one parameter.
	nonceBytes = 16

	// stepTimeout bounds the one command that delivers a key.
	stepTimeout = 5 * time.Minute
	// cleanupTimeout bounds the parameter deletion, which runs on the success and
	// on the failure path with a context that outlives the failure.
	cleanupTimeout = 30 * time.Second
)

// EnrollConfig is the enroller's collaborators and non-secret settings. Region,
// ParameterPrefix, and HostKeyPath must agree with the client configuration and
// with terraform/aws/main.tf; TestInstanceRoleReadsOnlyItsOwnEnrollmentPrefix
// binds the prefix, and the region is the one the provider pins.
type EnrollConfig struct {
	// Runner delivers the enrollment command over SSM Run Command.
	Runner application.SSMRunner
	// Parameters stores and deletes the encrypted parameter that carries the key.
	Parameters application.SSMParameterStore
	// Agent proves the host's SSM agent registered before anything is minted.
	Agent application.SSMAgentProbe
	// Minter mints the single-use, preauthorized enrollment key.
	Minter application.AuthKeyMinter
	// ParameterPrefix is the store path host parameters live under. Defaults to
	// DefaultParameterPrefix.
	ParameterPrefix string
	// Region is the region of the parameter and of the host's own read. Defaults
	// to DefaultRegion.
	Region string
	// HostKeyPath is where the host writes the key. Defaults to
	// DefaultHostKeyPath, and must live under /run so a reboot removes it.
	HostKeyPath string
	// Nonce mints the parameter's last path segment. Defaults to 128 random bits,
	// which is what production uses; a test substitutes a fixed value so the
	// parameter name is assertable.
	Nonce  func() (string, error)
	Logger application.Logger
}

// Enroller enrolls a host through the SSM control plane only.
type Enroller struct {
	cfg EnrollConfig
}

var _ application.HostEnroller = (*Enroller)(nil)

// NewEnroller validates the configuration and builds the enroller.
func NewEnroller(cfg EnrollConfig) (*Enroller, error) {
	switch {
	case cfg.Runner == nil:
		return nil, errors.New("ssm: run-command transport is required")
	case cfg.Parameters == nil:
		return nil, errors.New("ssm: parameter store is required")
	case cfg.Agent == nil:
		return nil, errors.New("ssm: agent probe is required")
	case cfg.Minter == nil:
		return nil, errors.New("ssm: auth-key minter is required")
	case cfg.Logger == nil:
		return nil, errors.New("ssm: logger is required")
	}
	if cfg.ParameterPrefix == "" {
		cfg.ParameterPrefix = DefaultParameterPrefix
	}
	if err := ValidateParameterName(cfg.ParameterPrefix); err != nil {
		return nil, fmt.Errorf("ssm: parameter prefix: %w", err)
	}
	if cfg.Region == "" {
		cfg.Region = DefaultRegion
	}
	if err := domain.ValidateAWSRegion(cfg.Region); err != nil {
		return nil, fmt.Errorf("ssm: region: %w", err)
	}
	if cfg.HostKeyPath == "" {
		cfg.HostKeyPath = DefaultHostKeyPath
	}
	if !strings.HasPrefix(cfg.HostKeyPath, "/run/") {
		return nil, fmt.Errorf("ssm: host key path %q must live under /run", cfg.HostKeyPath)
	}
	if strings.ContainsAny(cfg.HostKeyPath, "'\"`$ \t") {
		return nil, fmt.Errorf("ssm: host key path %q must not contain quotes, whitespace, or shell metacharacters", cfg.HostKeyPath)
	}
	if cfg.Nonce == nil {
		cfg.Nonce = RandomNonce
	}
	return &Enroller{cfg: cfg}, nil
}

// Enroll implements application.HostEnroller.
//
// The order is the security property, and the tests assert it:
//  1. wait for the SSM agent to register. An unregistered agent cannot run a
//     command, and there is no fallback transport, so this aborts before a single
//     secret exists;
//  2. only then mint the enrollment key;
//  3. store it as a SecureString at <prefix>/<host>/<nonce> under the AWS-managed
//     `alias/aws/ssm` key, so the command that delivers it carries a path, never a
//     value;
//  4. run the host script through SSM Run Command addressed by instance id: read
//     the parameter, write /run/fleet-enroll.key 0600, `tailscale up
//     --auth-key=file:`, remove the file;
//  5. delete the parameter on success and on failure.
func (e *Enroller) Enroll(ctx context.Context, req application.EnrollRequest) (application.EnrollResult, error) {
	if err := e.validate(req); err != nil {
		return application.EnrollResult{}, err
	}
	policy := req.KeyPolicyOrDefault()
	if err := policy.Validate(); err != nil {
		return application.EnrollResult{}, domain.Invalid("auth_key_policy", err.Error())
	}

	// 1. Fail closed on an unregistered agent, before any key is minted.
	agent, err := e.cfg.Agent.AwaitRegistration(ctx, req.InstanceID)
	if err != nil {
		return application.EnrollResult{}, fmt.Errorf("enrollment transport for %s is not ready: %w", req.InstanceID, err)
	}
	e.cfg.Logger.Info("host.enroll.agent_online",
		"instance_id", agent.InstanceID,
		"ping_status", agent.PingStatus,
	)

	// 2. Mint, now that the control plane has proven it can reach the host.
	key, err := e.cfg.Minter.MintAuthKey(ctx, application.AuthKeyRequest{
		HostID:   req.HostID,
		HostName: req.Name,
		Tag:      req.TailnetTag,
		Policy:   policy,
	})
	if err != nil {
		return application.EnrollResult{}, err
	}
	defer key.Key.Destroy()

	nonce, err := e.cfg.Nonce()
	if err != nil {
		return application.EnrollResult{}, fmt.Errorf("ssm: mint the enrollment nonce: %w", err)
	}
	if err := validateNonce(nonce); err != nil {
		return application.EnrollResult{}, err
	}
	parameter := path.Join(e.cfg.ParameterPrefix, req.Name, nonce)

	// 3. Store the key. Until this succeeds there is nothing to clean up.
	if err := e.cfg.Parameters.PutSecureParameter(ctx, application.SecureParameterRequest{
		Name:  parameter,
		Value: key.Key,
	}); err != nil {
		return application.EnrollResult{}, err
	}
	// 4. The parameter does not outlive the attempt: it is deleted on the success
	// and on the failure path, with a context the failure cannot cancel.
	result, err := e.run(ctx, req, parameter, nonce)
	if deleteErr := e.deleteParameter(ctx, parameter); deleteErr != nil {
		if err == nil {
			return application.EnrollResult{}, deleteErr
		}
		e.cfg.Logger.Error("host.enroll.parameter_cleanup_failed",
			"parameter", parameter,
			"error", domain.SanitizeMessage(deleteErr.Error()),
		)
	}
	return result, err
}

// run delivers the command and reads back the node identity it reports.
func (e *Enroller) run(ctx context.Context, req application.EnrollRequest, parameter, nonce string) (application.EnrollResult, error) {
	script, err := Script(ScriptOptions{
		ParameterName: parameter,
		Nonce:         nonce,
		Region:        e.cfg.Region,
		HostKeyPath:   e.cfg.HostKeyPath,
		HostName:      req.Name,
		Tag:           req.TailnetTag,
	})
	if err != nil {
		return application.EnrollResult{}, err
	}

	stepCtx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()
	result, err := e.cfg.Runner.RunCommand(stepCtx, application.SSMRunRequest{
		InstanceID: req.InstanceID,
		// The comment is the correlation token: a reply from another invocation
		// carries another value and is refused below.
		Comment: req.InstanceID,
		Command: script,
	})
	if err != nil {
		return application.EnrollResult{}, fmt.Errorf("deliver the enrollment key over ssm: %w", err)
	}
	if result.InstanceID != req.InstanceID {
		return application.EnrollResult{}, fmt.Errorf(
			"deliver the enrollment key over ssm: reply names instance %q, not %q", result.InstanceID, req.InstanceID)
	}
	if result.Comment != req.InstanceID {
		return application.EnrollResult{}, fmt.Errorf(
			"deliver the enrollment key over ssm: reply correlation comment %q does not match %q", result.Comment, req.InstanceID)
	}
	if result.Status != statusSuccess || result.ExitCode != 0 {
		// Only stderr is quoted, and it is sanitized: stdout of a successful run is
		// the node status, and a credential must never reach a job record.
		return application.EnrollResult{}, fmt.Errorf(
			"deliver the enrollment key over ssm: command did not succeed (status %q, exit %d): %s",
			result.Status, result.ExitCode, domain.SanitizeMessage(result.Stderr))
	}

	deviceID, status, err := deviceFromStatus(result.Stdout, req.TailnetTag)
	if err != nil {
		return application.EnrollResult{}, err
	}
	e.cfg.Logger.Info("host.enroll.joined",
		"host_id", req.HostID,
		"device_id", deviceID,
		"tailnet_tag", req.TailnetTag,
		"node_hostname", status.Self.HostName,
	)
	return application.EnrollResult{
		DeviceID:   deviceID,
		TailnetTag: req.TailnetTag,
	}, nil
}

// deleteParameter removes the parameter with a context that is not cancelled by
// the failure that triggered the cleanup.
func (e *Enroller) deleteParameter(ctx context.Context, parameter string) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	defer cancel()
	return e.cfg.Parameters.DeleteParameter(cleanupCtx, parameter)
}

// validate refuses a request before any I/O. The tag must be the approved one,
// the instance id must be well formed, and the host name must be a name, because
// all three are interpolated into the host script.
func (e *Enroller) validate(req application.EnrollRequest) error {
	if strings.TrimSpace(req.HostID) == "" {
		return domain.Invalid("host_id", "is required")
	}
	if err := domain.ValidateHostName(req.Name); err != nil {
		return err
	}
	if err := domain.ValidateInstanceID(req.InstanceID); err != nil {
		return err
	}
	if err := domain.ValidateTailnetTag(req.TailnetTag); err != nil {
		return err
	}
	if !domain.IsApprovedTailnetTag(req.TailnetTag) {
		return domain.Invalid("tailnet_tag",
			fmt.Sprintf("%q is not the approved tag %q", req.TailnetTag, domain.ApprovedTailnetTag))
	}
	return nil
}

// RandomNonce returns 128 random bits as lowercase hex.
func RandomNonce() (string, error) {
	buf := make([]byte, nonceBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// validateNonce enforces the shape of the parameter's last path segment. It must
// be a name segment, because it is interpolated into the store path and compared
// by the host script.
func validateNonce(nonce string) error {
	if nonce == "" {
		return errors.New("ssm: the enrollment nonce is empty")
	}
	for _, r := range nonce {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
		default:
			return fmt.Errorf("ssm: the enrollment nonce %q must be lowercase alphanumeric with dashes", nonce)
		}
	}
	return nil
}

// nodeStatus is the part of `tailscale status --json` this adapter reads.
type nodeStatus struct {
	Self struct {
		ID       string   `json:"ID"`
		HostName string   `json:"HostName"`
		Tags     []string `json:"Tags"`
	} `json:"Self"`
}

// deviceFromStatus parses the host's reported node status and confirms the tag it
// registered with.
func deviceFromStatus(stdout, wantTag string) (string, nodeStatus, error) {
	var status nodeStatus
	body := extractJSONObject(stdout)
	if body == "" {
		return "", status, errors.New("deliver the enrollment key over ssm: the host reported no node status")
	}
	if err := json.Unmarshal([]byte(body), &status); err != nil {
		return "", status, fmt.Errorf("deliver the enrollment key over ssm: node status is not JSON: %w", err)
	}
	if strings.TrimSpace(status.Self.ID) == "" {
		return "", status, errors.New("deliver the enrollment key over ssm: node status reported no device id")
	}
	for _, tag := range status.Self.Tags {
		if tag == wantTag {
			return status.Self.ID, status, nil
		}
	}
	return "", status, fmt.Errorf(
		"deliver the enrollment key over ssm: node joined with tags %v, which do not include the approved tag %q",
		status.Self.Tags, wantTag)
}

// extractJSONObject returns the first top-level JSON object in text. The host
// script prints nothing but `tailscale status --json`, and a tolerant slice keeps
// one chatty line from failing an enrollment that succeeded.
func extractJSONObject(text string) string {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end < start {
		return ""
	}
	return text[start : end+1]
}
