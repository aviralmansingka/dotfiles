package ssm

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// The host-side facts every profile step depends on. They are constants rather
// than configuration because each one is a property of the profile the flake
// ships (nix/modules/remote/rex-host.nix), not something an operator tunes: the
// account is the login user cloud-init creates, the Serve port and the loopback
// address are the module's own, and the links are the module's `home.file` set.
const (
	// DefaultDeployAccount is the login account the profile manages. cloud-init
	// creates it, enables linger for it, and the enrollment step joins the tailnet
	// on its behalf.
	DefaultDeployAccount = "ubuntu"

	// DefaultDeployedRoot is where the provisioner records what it deployed. The
	// record is one symlink per revision, named by the revision and pointing at the
	// rex binary that revision installed, so the readback can prove which revision
	// the host is actually running instead of trusting the request it was handed.
	//
	// It is provisioning state, not Nix state: it lives outside the store because
	// the store is content-addressed and a store path cannot carry a revision.
	DefaultDeployedRoot = "/var/lib/fleet-profile"

	// nixStorePrefix is the only place a deployed binary may come from.
	nixStorePrefix = "/nix/store/"

	// rexBinary is the profile's client/server binary.
	rexBinary = "rex"

	// rexServeUnit publishes the Rex server through Tailscale Serve. It is a
	// Home Manager *user* unit, so every call about it runs against the account's
	// own user manager.
	rexServeUnit = "rex-serve"
	// rexUserUnit is the server unit. The readback asks whether it is active; the
	// deploy restarts Serve, which depends on it.
	rexUserUnit = "rex"

	// servePort is the tailnet HTTPS port Serve publishes on, and
	// rexListenAddress is the loopback endpoint it proxies. Both come from
	// nix/modules/remote/rex-host.nix, and the readback refuses a mapping that
	// points anywhere else.
	servePort        = "443"
	rexListenAddress = "127.0.0.1:7297"

	// DefaultDeployCommandTimeout bounds one remote call made by the profile
	// steps. The activation is the long one and has its own bound below.
	DefaultDeployCommandTimeout = 5 * time.Minute

	// DeployCommandTimeoutSeconds is the control-plane timeout one activation
	// command is sent with.
	//
	// It is much larger than the enrollment command's 180 seconds because this is
	// not an enrollment: a real profile deploy took 22 minutes on 2026-11-09 (a
	// cold x86_64-linux build on the host), and the control plane cancels a
	// command that outlives its own TimeoutSeconds whatever the worker's context
	// says. The worker therefore builds a second runner from the same SSM client
	// configuration with this bound instead of reusing the enrollment one.
	DeployCommandTimeoutSeconds = 2700
)

// DefaultSwitchArgv activates the profile.
//
// The host has Nix (cloud-init installs the multi-user daemon) but not
// home-manager: this is a fresh machine the profile has never touched, so the
// first deploy has to fetch the tool that switches the profile. `nix run` does
// that without installing anything first, and the trailing `--` is what makes
// `switch` an argument of home-manager rather than of `nix run`.
var DefaultSwitchArgv = []string{"nix", "run", "github:nix-community/home-manager", "--", "switch"}

// profileHost is the resolved shape of the account and the paths a step talks to.
type profileHost struct {
	account      string
	home         string
	deployedRoot string
}

// machine is the systemd machine reference for the account's user manager.
// `systemctl --user -M ubuntu@.host` addresses that manager from root without a
// session, which is what a run-command has.
func (h profileHost) machine() string { return h.account + "@.host" }

// rexLink is where the profile's rex binary appears for the account.
func (h profileHost) rexLink() string { return h.home + "/.nix-profile/bin/" + rexBinary }

// marker is the deployment record for one revision.
func (h profileHost) marker(revision string) string { return h.deployedRoot + "/" + revision }

// configLinks are the three profile files nix/modules/remote/rex-host.nix links
// into the account's config directory. `install.sh` stow never runs on a
// provisioned host, so these links are the whole delivery mechanism for them.
func (h profileHost) configLinks() []string {
	return []string{
		h.home + "/.config/rex/init.lua",
		h.home + "/.config/rex/missions.lua",
		h.home + "/.config/rex/notify-ntfy.lua",
	}
}

// resolveProfileHost defaults and validates the account, home, and record root.
func resolveProfileHost(account, home, deployedRoot string) (profileHost, error) {
	if account == "" {
		account = DefaultDeployAccount
	}
	if home == "" {
		home = "/home/" + account
	}
	if deployedRoot == "" {
		deployedRoot = DefaultDeployedRoot
	}
	for _, path := range []string{account, home, deployedRoot} {
		if err := validateArg(path); err != nil {
			return profileHost{}, fmt.Errorf("ssm: profile host setting: %w", err)
		}
	}
	return profileHost{account: account, home: home, deployedRoot: deployedRoot}, nil
}

// remote is the one place this package's profile steps run a program on a host.
//
// It is the same SSM Run Command transport enrollment uses, addressed the same
// way — by instance id, with a comment the reply must echo — so a reply that
// belongs to another invocation or another host is refused rather than read.
type remote struct {
	runner     ports.SSMRunner
	instanceID string
	comment    string
	timeout    time.Duration
}

// run sends one command and returns the invocation's report. A non-zero exit is
// not turned into an error here: some steps ask a question whose "no" is a valid
// answer (`is-active` on a unit that is not up yet), and the caller decides. A
// transport failure is an error.
func (r remote) run(ctx context.Context, argv command) (ports.SSMRunResult, error) {
	script, err := argv.render()
	if err != nil {
		return ports.SSMRunResult{}, err
	}
	callCtx := ctx
	if r.timeout > 0 {
		var cancel context.CancelFunc
		callCtx, cancel = context.WithTimeout(ctx, r.timeout)
		defer cancel()
	}
	result, err := r.runner.RunCommand(callCtx, ports.SSMRunRequest{
		InstanceID: r.instanceID,
		Comment:    r.comment,
		Command:    script,
	})
	if err != nil {
		return ports.SSMRunResult{}, err
	}
	if result.InstanceID != r.instanceID {
		return ports.SSMRunResult{}, fmt.Errorf(
			"ssm: reply names instance %q, not %q; refusing a reply that belongs to another host",
			result.InstanceID, r.instanceID)
	}
	if result.Comment != r.comment {
		return ports.SSMRunResult{}, fmt.Errorf(
			"ssm: reply correlation comment %q does not match %q", result.Comment, r.comment)
	}
	return result, nil
}

// succeeded turns a non-zero exit into an error naming the step. Only stderr is
// quoted, and it is sanitized: a host program can print anything, and a job
// record is not the place to find out what.
func succeeded(step string, result ports.SSMRunResult) error {
	if result.ExitCode == 0 && strings.EqualFold(result.Status, statusSuccess) {
		return nil
	}
	return fmt.Errorf("%s did not succeed (status %q, exit %d): %s",
		step, result.Status, result.ExitCode, domain.SanitizeMessage(result.Stderr))
}

// revisionPattern bounds a revision before it becomes a path segment and an
// argument: a deployed revision is a git commit hash, so it is lowercase hex.
var revisionPattern = regexp.MustCompile(`^[0-9a-f]{7,64}$`)

// shortRevision abbreviates a commit for a message. The scrubber every error and
// log line passes through redacts a 40-character hex run as a credential-shaped
// blob, and it is right to: it cannot tell a SHA-1 from a token. So a message names
// the conventional twelve-character abbreviation, and the full revision travels in
// the payload, the deployment record, and the host's own readback instead.
func shortRevision(revision string) string {
	const abbreviated = 12
	if len(revision) <= abbreviated {
		return revision
	}
	return revision[:abbreviated]
}

// validateRevision enforces the shape of a flake revision. It is a path segment
// and an argument, so it is a git hash and nothing else.
func validateRevision(revision string) error {
	if !revisionPattern.MatchString(revision) {
		return domain.Invalid("flake_revision",
			fmt.Sprintf("%q is not a commit hash; a deployed revision must be lowercase hex", revision))
	}
	return nil
}

// logLine renders one structured log line through the logger, if there is one.
func logInfo(logger ports.Logger, msg string, kv ...any) {
	if logger == nil {
		return
	}
	logger.Info(msg, kv...)
}

// missingSetting reports a request field a step cannot proceed without, as a
// validation error: a refusal before any remote call, and a permanent one.
func missingSetting(field, why string) error {
	return domain.Invalid(field, why)
}

var errNoTransport = errors.New("ssm: no run-command transport configured")
