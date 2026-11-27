package ssm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// DeployConfig configures the profile deployer. Every field is a collaborator, a
// path, or a duration: there is no credential field, because nothing in this step
// is secret. The profile is fetched from a Nix flake over the host's own network
// identity, and the only authority used is the control plane's.
type DeployConfig struct {
	// Runner is the SSM Run Command transport. It is the same transport
	// enrollment uses; there is no second control-plane client in this tree.
	Runner ports.SSMRunner
	// Agent proves the host's SSM agent registered, before any activation command
	// is sent. Without it a deploy would spend its attempts waiting on a host it
	// cannot reach.
	Agent ports.SSMAgentProbe
	// Logger records non-secret progress. It receives paths and revisions only.
	Logger ports.Logger
	// Account is the login account the profile manages. Defaults to
	// DefaultDeployAccount.
	Account string
	// Home is that account's home directory. Defaults to /home/<account>.
	Home string
	// Switch is the argument array prefix that activates the profile, run as the
	// account. Defaults to DefaultSwitchArgv. It is server configuration, never
	// client input, and it is validated at construction so a bad value cannot
	// reach a host.
	Switch []string
	// DeployedRoot is where the host records what it deployed. Defaults to
	// DefaultDeployedRoot.
	DeployedRoot string
	// ServeDeadline bounds the wait for rex-serve to report active after it is
	// restarted. Defaults to DefaultServeDeadline.
	ServeDeadline time.Duration
	// PollInterval is how often the wait re-asks. Defaults to
	// DefaultServePollInterval.
	PollInterval time.Duration
	// CommandTimeout bounds one short remote call. Defaults to
	// DefaultDeployCommandTimeout.
	CommandTimeout time.Duration
	// ActivationTimeout bounds the one call that switches the profile. Its default
	// is the control-plane bound the deploy's runner is built with
	// (DeployCommandTimeoutSeconds), because a worker-side context that outlives
	// the document's TimeoutSeconds would only wait for a command the control plane
	// has already cancelled.
	ActivationTimeout time.Duration
	// Wait sleeps between polls. It exists so a test can exhaust the deadline
	// without one, and so the wait is the only thing that consumes wall time.
	Wait func(ctx context.Context, d time.Duration) error
}

// Default serve wait numbers. The unit is a oneshot that runs `tailscale wait` and
// then `tailscale serve --bg`, so a healthy host converges in seconds; the
// deadline is generous because the same unit also waits for tailscaled to
// reconnect to the control server after a boot.
const (
	DefaultServeDeadline     = 5 * time.Minute
	DefaultServePollInterval = 5 * time.Second
)

// Deployer activates the approved profile on a host over the SSM control plane.
//
// The order is the security and the recovery property, and the tests assert it:
//
//  1. refuse a request with no instance id, no approved flake target, or a bad
//     name — before a single remote call, because a deploy addressed by name has
//     no transport at all;
//  2. wait for the host's SSM agent: an unregistered agent means no command can
//     run, and there is no fallback transport;
//  3. resolve the revision the approved flake target actually is, on the host,
//     before anything is activated, so what is recorded is what was built;
//  4. activate the profile, unless the host already records this exact revision
//     as activated — a retry after a partial deploy does not switch twice;
//  5. record what landed: one symlink named by the revision, pointing at the rex
//     binary that revision installed;
//  6. grant the account the tailscaled operator role, then enable and restart
//     rex-serve. Without the grant the Serve unit fails, which is why it is not
//     left to the module's own note;
//  7. poll rex-serve to active with a bounded deadline, and report the tailnet
//     URL Serve published.
//
// Nothing here is interpolated into a shell string: every remote call is an
// argument array (see command), and no argument is, or is derived from, a
// credential.
type Deployer struct {
	cfg  DeployConfig
	host profileHost
}

var _ ports.ProfileDeployer = (*Deployer)(nil)

// NewDeployer validates the configuration and builds the deployer.
func NewDeployer(cfg DeployConfig) (*Deployer, error) {
	switch {
	case cfg.Runner == nil:
		return nil, errNoTransport
	case cfg.Agent == nil:
		return nil, errors.New("ssm: agent probe is required: the deploy gates on the host's SSM agent")
	}
	host, err := resolveProfileHost(cfg.Account, cfg.Home, cfg.DeployedRoot)
	if err != nil {
		return nil, err
	}
	if len(cfg.Switch) == 0 {
		cfg.Switch = append([]string(nil), DefaultSwitchArgv...)
	}
	if err := validateArgv(cfg.Switch); err != nil {
		return nil, fmt.Errorf("ssm: switch command: %w", err)
	}
	if cfg.ServeDeadline <= 0 {
		cfg.ServeDeadline = DefaultServeDeadline
	}
	if cfg.ServeDeadline > 30*time.Minute {
		return nil, errors.New("ssm: serve deadline must be at most 30 minutes")
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = DefaultServePollInterval
	}
	if cfg.CommandTimeout <= 0 {
		cfg.CommandTimeout = DefaultDeployCommandTimeout
	}
	if cfg.ActivationTimeout <= 0 {
		cfg.ActivationTimeout = time.Duration(DeployCommandTimeoutSeconds) * time.Second
	}
	if cfg.Wait == nil {
		cfg.Wait = waitFor
	}
	return &Deployer{cfg: cfg, host: host}, nil
}

// DeployProfile implements ports.ProfileDeployer.
func (d *Deployer) DeployProfile(ctx context.Context, req ports.DeployRequest) (ports.DeployResult, error) {
	if err := d.validate(req); err != nil {
		return ports.DeployResult{}, err
	}

	// 2. The agent gate. It runs before anything else that touches the host, so an
	// unreachable host costs one control-plane query and no partial activation.
	agent, err := d.cfg.Agent.AwaitRegistration(ctx, req.InstanceID)
	if err != nil {
		return ports.DeployResult{}, fmt.Errorf("deploy profile to %s: %w", req.InstanceID, err)
	}
	logInfo(d.cfg.Logger, "host.deploy.agent_online",
		"host_id", req.HostID,
		"instance_id", agent.InstanceID,
		"ping_status", agent.PingStatus,
	)

	// 3. Resolve what the approved target actually is, on the host, before it is
	// activated. The revision recorded later is this one, not a caller's claim.
	revision, err := d.resolveRevision(ctx, req)
	if err != nil {
		return ports.DeployResult{}, err
	}

	// 4. Activate, unless this exact revision is already recorded as activated.
	recorded, err := d.activatedRexPath(ctx, req, revision)
	if err != nil {
		return ports.DeployResult{}, err
	}
	if recorded != "" {
		logInfo(d.cfg.Logger, "host.deploy.adopted",
			"host_id", req.HostID,
			"flake_revision", shortRevision(revision),
			"rex_path", recorded,
			"reason", "the host already records this revision as activated; a retry does not switch it again",
		)
	} else {
		if err := d.activate(ctx, req); err != nil {
			return ports.DeployResult{}, err
		}
		// 5. Record what landed. It happens immediately after the switch, before
		// any Serve work, so a retry after a Serve failure adopts instead of
		// rebuilding the profile for another twenty minutes.
		rexPath, err := d.rexPath(ctx, req)
		if err != nil {
			return ports.DeployResult{}, err
		}
		if err := d.recordDeployment(ctx, req, revision, rexPath); err != nil {
			return ports.DeployResult{}, err
		}
	}

	// 6. Publish it.
	if err := d.grantOperator(ctx, req); err != nil {
		return ports.DeployResult{}, err
	}
	if err := d.restartServe(ctx, req); err != nil {
		return ports.DeployResult{}, err
	}
	// 7. Poll, bounded.
	url, err := d.awaitServe(ctx, req)
	if err != nil {
		return ports.DeployResult{}, err
	}
	logInfo(d.cfg.Logger, "host.deployed",
		"host_id", req.HostID,
		"flake_revision", shortRevision(revision),
		"rex_url", url,
	)
	return ports.DeployResult{FlakeRevision: revision, RexURL: url}, nil
}

// validate refuses a request before any remote call.
func (d *Deployer) validate(req ports.DeployRequest) error {
	if strings.TrimSpace(req.HostID) == "" {
		return missingSetting("host_id", "is required")
	}
	if err := domain.ValidateHostName(req.Name); err != nil {
		return err
	}
	if strings.TrimSpace(req.Profile) == "" {
		return missingSetting("profile", "is required: the approved profile names the endpoint this deploys")
	}
	if strings.TrimSpace(req.InstanceID) == "" {
		return missingSetting("instance_id",
			"is required: every control-plane call is addressed to an instance, and this service has no other transport")
	}
	if err := domain.ValidateInstanceID(req.InstanceID); err != nil {
		return err
	}
	return domain.ValidateRemoteFlakeRef(req.FlakeRef)
}

// call builds the runner for one step. The comment names the step so an operator
// reading SSM command history can tell an activation from a poll, and the reply
// has to echo it.
func (d *Deployer) call(req ports.DeployRequest, step string, timeout time.Duration) remote {
	return remote{
		runner:     d.cfg.Runner,
		instanceID: req.InstanceID,
		comment:    req.InstanceID + ":" + step,
		timeout:    timeout,
	}
}

// asAccount prefixes an argument array so it runs as the profile's account with
// that account's HOME. The wrapper is argv, not a shell: `runuser` and `env` are
// programs and every value after them is one word.
func (d *Deployer) asAccount(argv command) command {
	prefix := command{"runuser", "-u", d.host.account, "--", "env",
		"HOME=" + d.host.home,
		"USER=" + d.host.account,
		"LOGNAME=" + d.host.account,
	}
	return append(prefix, argv...)
}

// flakeMetadata is the part of `nix flake metadata --json` this adapter reads.
type flakeMetadata struct {
	Revision string `json:"revision"`
	Locked   struct {
		Rev string `json:"rev"`
	} `json:"locked"`
}

// rev returns the commit the flake resolved to.
func (m flakeMetadata) rev() string {
	if m.Revision != "" {
		return m.Revision
	}
	return m.Locked.Rev
}

// flakeTarget is the part of a reference before the `#`: the flake itself.
//
// `nix flake metadata` resolves a flake and never an attribute, and it refuses a
// reference that carries a fragment ("unexpected fragment 'x' in flake
// reference"), so the resolution is handed the target alone. The fragment stays
// with the command that runs an attribute -- `--flake <ref>#<attr>` in the
// activation -- because that is the command that needs one.
func flakeTarget(ref string) string {
	target, _, _ := strings.Cut(ref, "#")
	return target
}

// resolveRevision asks the host which commit the approved flake target is.
//
// It runs as the account, because that is whose Nix profile and cache will build
// the profile, and it runs before activation, so a flake target that does not
// resolve fails the job before anything on the host is touched.
func (d *Deployer) resolveRevision(ctx context.Context, req ports.DeployRequest) (string, error) {
	argv := d.asAccount(command{"nix", "flake", "metadata", "--json", flakeTarget(req.FlakeRef)})
	result, err := d.call(req, "flake-metadata", d.cfg.CommandTimeout).run(ctx, argv)
	if err != nil {
		return "", fmt.Errorf("resolve the flake revision on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("resolve the flake revision", result); err != nil {
		return "", err
	}
	var metadata flakeMetadata
	if err := json.Unmarshal([]byte(result.Stdout), &metadata); err != nil {
		return "", fmt.Errorf("resolve the flake revision on %s: the host did not report flake metadata: %w",
			req.InstanceID, err)
	}
	revision := metadata.rev()
	if revision == "" {
		return "", fmt.Errorf("resolve the flake revision on %s: %q resolved to no commit; a deploy records an immutable revision",
			req.InstanceID, req.FlakeRef)
	}
	if err := validateRevision(revision); err != nil {
		return "", err
	}
	return revision, nil
}

// activatedRexPath reports the binary the host already records as activated for
// this revision, or "" when it records none that is live.
//
// The record is the recovery contract: it is written right after a successful
// switch and before any Serve work, so a deploy that failed at the Serve step is
// adopted by its retry instead of building the profile a second time. Adoption
// needs both halves to agree — the record exists for this revision, and the
// account's rex resolves to the binary that record names. A record left behind by a
// rollback, or a generation switched by hand, fails the second half and the deploy
// rebuilds rather than adopting a state the readback would refuse.
//
// Both probes tolerate a non-zero exit, because "no record" is the ordinary answer
// on a first deploy.
func (d *Deployer) activatedRexPath(ctx context.Context, req ports.DeployRequest, revision string) (string, error) {
	result, err := d.call(req, "recorded-deploy", d.cfg.CommandTimeout).run(ctx, command{"readlink", "-f", d.host.marker(revision)})
	if err != nil {
		return "", fmt.Errorf("read the deployment record on %s: %w", req.InstanceID, err)
	}
	if result.ExitCode != 0 {
		return "", nil
	}
	recorded := strings.TrimSpace(result.Stdout)
	if !strings.HasPrefix(recorded, nixStorePrefix) {
		// A record that does not point into the store is not a deployment this
		// service made. It is ignored rather than trusted.
		return "", nil
	}
	result, err = d.call(req, "recorded-deploy", d.cfg.CommandTimeout).run(ctx, command{"readlink", "-f", d.host.rexLink()})
	if err != nil {
		return "", fmt.Errorf("resolve the rex binary on %s: %w", req.InstanceID, err)
	}
	if result.ExitCode != 0 || strings.TrimSpace(result.Stdout) != recorded {
		return "", nil
	}
	return recorded, nil
}

// activate switches the profile on the host.
func (d *Deployer) activate(ctx context.Context, req ports.DeployRequest) error {
	argv := d.asAccount(append(append(command(nil), d.cfg.Switch...), "--flake", req.FlakeRef))
	logInfo(d.cfg.Logger, "host.deploy.activating",
		"host_id", req.HostID,
		"flake_ref", req.FlakeRef,
		"account", d.host.account,
	)
	result, err := d.call(req, "activate", d.cfg.ActivationTimeout).run(ctx, argv)
	if err != nil {
		return fmt.Errorf("activate the profile on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("activate the profile", result); err != nil {
		return err
	}
	return nil
}

// rexPath reads the store path of the rex binary the account now runs.
func (d *Deployer) rexPath(ctx context.Context, req ports.DeployRequest) (string, error) {
	result, err := d.call(req, "rex-path", d.cfg.CommandTimeout).run(ctx, command{"readlink", "-f", d.host.rexLink()})
	if err != nil {
		return "", fmt.Errorf("read the rex binary path on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("read the rex binary path", result); err != nil {
		return "", err
	}
	path := strings.TrimSpace(result.Stdout)
	if !strings.HasPrefix(path, nixStorePrefix) {
		return "", fmt.Errorf("the profile switched on %s but %s does not resolve into %s",
			req.InstanceID, d.host.rexLink(), nixStorePrefix)
	}
	return path, nil
}

// recordDeployment writes the deployment record for one revision: a symlink
// named by the revision, pointing at the rex binary that revision installed.
//
// A symlink rather than a file because the control plane carries one argument
// array and no stdin, and because `ln -sfn` is idempotent: a retried deploy
// replaces the same link instead of accumulating records. It carries no
// credential — a store path and a revision are public.
func (d *Deployer) recordDeployment(ctx context.Context, req ports.DeployRequest, revision, rexPath string) error {
	mkdir := command{"mkdir", "-p", d.host.deployedRoot}
	result, err := d.call(req, "record-deploy", d.cfg.CommandTimeout).run(ctx, mkdir)
	if err != nil {
		return fmt.Errorf("record the deployment on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("record the deployment", result); err != nil {
		return err
	}
	link := command{"ln", "-sfn", rexPath, d.host.marker(revision)}
	result, err = d.call(req, "record-deploy", d.cfg.CommandTimeout).run(ctx, link)
	if err != nil {
		return fmt.Errorf("record the deployment on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("record the deployment", result); err != nil {
		return err
	}
	logInfo(d.cfg.Logger, "host.deploy.recorded",
		"host_id", req.HostID,
		"flake_revision", shortRevision(revision),
		"rex_path", rexPath,
	)
	return nil
}

// grantOperator gives the account the tailscaled operator role.
//
// Serve is a user unit that talks to the system daemon, and without this grant it
// fails: the unit's own module documents the same command as an operator step
// (`sudo tailscale set --operator=$USER`). Running it here is what makes the
// deploy self-contained; it is idempotent, so a retry re-issues it harmlessly.
func (d *Deployer) grantOperator(ctx context.Context, req ports.DeployRequest) error {
	argv := command{"tailscale", "set", "--operator=" + d.host.account}
	result, err := d.call(req, "operator-grant", d.cfg.CommandTimeout).run(ctx, argv)
	if err != nil {
		return fmt.Errorf("grant the tailscaled operator role on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("grant the tailscaled operator role", result); err != nil {
		return err
	}
	return nil
}

// restartServe reloads the account's user manager, enables rex-serve, and
// restarts it so it re-publishes the Serve mapping.
//
// Every call is addressed with `--user -M <account>@.host`: the unit is a user
// unit and a run-command has no session to be in, so the machine reference is how
// the account's own manager is reached from root.
func (d *Deployer) restartServe(ctx context.Context, req ports.DeployRequest) error {
	steps := []struct {
		name string
		argv command
	}{
		{"serve-daemon-reload", command{"systemctl", "--user", "-M", d.host.machine(), "daemon-reload"}},
		{"serve-enable", command{"systemctl", "--user", "-M", d.host.machine(), "enable", rexServeUnit}},
		{"serve-restart", command{"systemctl", "--user", "-M", d.host.machine(), "restart", rexServeUnit}},
	}
	for _, step := range steps {
		result, err := d.call(req, step.name, d.cfg.CommandTimeout).run(ctx, step.argv)
		if err != nil {
			return fmt.Errorf("publish rex through tailscale serve on %s: %w", req.InstanceID, err)
		}
		if err := succeeded("publish rex through tailscale serve", result); err != nil {
			return err
		}
	}
	return nil
}

// awaitServe polls rex-serve until it reports active, then reads the tailnet
// address Serve published. The deadline is the step's own bound: a unit that
// never converges fails the deploy here, naming the last state it reported,
// rather than leaving the workflow to discover it later.
func (d *Deployer) awaitServe(ctx context.Context, req ports.DeployRequest) (string, error) {
	deadline := time.Now().Add(d.cfg.ServeDeadline)
	argv := command{"systemctl", "--user", "-M", d.host.machine(), "is-active", rexServeUnit}
	last := "unknown"
	for {
		result, err := d.call(req, "serve-poll", d.cfg.CommandTimeout).run(ctx, argv)
		if err != nil {
			return "", fmt.Errorf("poll rex-serve on %s: %w", req.InstanceID, err)
		}
		last = strings.TrimSpace(result.Stdout)
		if last == stateActive {
			break
		}
		if !time.Now().Before(deadline) {
			return "", fmt.Errorf(
				"rex-serve on %s did not become active within %s (last state: %q); the account needs the tailscaled operator grant and the Serve mapping defaults to %s",
				req.InstanceID, d.cfg.ServeDeadline, last, rexListenAddress)
		}
		if err := d.cfg.Wait(ctx, d.cfg.PollInterval); err != nil {
			return "", fmt.Errorf("wait for rex-serve on %s: %w", req.InstanceID, err)
		}
	}
	status, err := d.call(req, "serve-status", d.cfg.CommandTimeout).run(ctx, command{"tailscale", "serve", "status"})
	if err != nil {
		return "", fmt.Errorf("read the serve status on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("read the serve status", status); err != nil {
		return "", err
	}
	url, _, ok := parseServeStatus(status.Stdout)
	if !ok {
		return "", fmt.Errorf(
			"rex-serve on %s reports active but tailscale serve publishes no HTTPS address; the mapping is %s",
			req.InstanceID, rexListenAddress)
	}
	return url, nil
}

// stateActive is what `systemctl is-active` prints for a running unit, and what it
// prints for a oneshot that finished successfully and remains in place.
const stateActive = "active"
