package ssh

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const (
	// sshBinary is the local client. It is a constant, never a configuration
	// value: an operator cannot point enrollment at another program.
	sshBinary = "ssh"
	// sshUser is the bootstrap login on a fleet host.
	sshUser = "ubuntu"

	// hostKeyCommand fetches the host public key over SSM. `set +x` disables shell
	// tracing first, so no command echo can carry anything to a log.
	hostKeyCommand = "set +x; cat /etc/ssh/ssh_host_ed25519_key.pub"

	// defaultRemoteKeyPath is where the enrollment key is written on the host. It
	// lives under /run, so a reboot removes it even if cleanup never ran.
	defaultRemoteKeyPath = "/run/fleet-enroll/auth-key"

	// knownHostsMode is the only mode the pinned known_hosts file may have.
	knownHostsMode os.FileMode = 0o600
	// knownHostsDirMode keeps the per-enrollment directory private.
	knownHostsDirMode os.FileMode = 0o700
	// remoteKeyMode is the mode the key file must have on the host.
	remoteKeyMode = 0o600

	// stepTimeout bounds one SSM or SSH step.
	stepTimeout = 2 * time.Minute
	// cleanupTimeout bounds the best-effort removal of the remote key file, which
	// runs on success and on failure with a context that outlives the failure.
	cleanupTimeout = 30 * time.Second
)

// EnrollConfig is the enroller's collaborators and non-secret settings.
type EnrollConfig struct {
	// Runner fetches the host public key over SSM. IAM authorizes it, so the reply
	// is the trust anchor for everything that follows.
	Runner application.SSMRunner
	// SSH runs the verified local ssh argv the adapter builds.
	SSH    application.SSHRunner
	Minter application.AuthKeyMinter
	// IdentityFile is the path of the operator's bootstrap login key. It is a
	// path reference; no key material is read, copied, or stored by this package.
	IdentityFile string
	// KnownHostsDir holds one private known_hosts file per enrollment. Empty means
	// the system temporary directory.
	KnownHostsDir string
	// RemoteKeyPath defaults to /run/fleet-enroll/auth-key.
	RemoteKeyPath string
	Logger        application.Logger
	Clock         application.Clock
}

// Enroller is the trusted-SSH bootstrap: it pins the host key before it mints
// anything, delivers the enrollment key over stdin, joins the tailnet under the
// approved tag, and removes the key file on every path.
type Enroller struct {
	cfg           EnrollConfig
	remoteKeyPath string
}

var _ application.HostEnroller = (*Enroller)(nil)

// NewEnroller validates the configuration.
func NewEnroller(cfg EnrollConfig) (*Enroller, error) {
	if cfg.Runner == nil {
		return nil, errors.New("ssh: SSM runner is required")
	}
	if cfg.SSH == nil {
		return nil, errors.New("ssh: SSH runner is required")
	}
	if cfg.Minter == nil {
		return nil, errors.New("ssh: auth-key minter is required")
	}
	if cfg.Logger == nil {
		return nil, errors.New("ssh: logger is required")
	}
	if strings.TrimSpace(cfg.IdentityFile) == "" {
		return nil, errors.New("ssh: bootstrap identity file path is required")
	}
	remoteKeyPath := cfg.RemoteKeyPath
	if remoteKeyPath == "" {
		remoteKeyPath = defaultRemoteKeyPath
	}
	if !strings.HasPrefix(remoteKeyPath, "/run/") {
		return nil, fmt.Errorf("ssh: remote key path %q must live under /run", remoteKeyPath)
	}
	return &Enroller{cfg: cfg, remoteKeyPath: remoteKeyPath}, nil
}

// Enroll implements application.HostEnroller.
//
// Order is the security property, and it is asserted by the tests:
//  1. fetch and validate the host public key over SSM (fail closed on any
//     mismatch),
//  2. write the pinned known_hosts file with mode 0600,
//  3. only then mint the enrollment key, so a forged host aborts before a single
//     secret byte exists,
//  4. deliver the key over stdin into a 0600 file under /run,
//  5. join under the approved tag and confirm the tag the node reports,
//  6. remove the key file on both the success and the failure path.
func (e *Enroller) Enroll(ctx context.Context, req application.EnrollRequest) (application.EnrollResult, error) {
	if err := e.validate(req); err != nil {
		return application.EnrollResult{}, err
	}
	policy := req.KeyPolicyOrDefault()
	if err := policy.Validate(); err != nil {
		return application.EnrollResult{}, domain.Invalid("auth_key_policy", err.Error())
	}

	hostKey, err := e.pinHostKey(ctx, req.InstanceID)
	if err != nil {
		return application.EnrollResult{}, err
	}

	knownHostsPath, removeKnownHosts, err := e.writeKnownHosts(hostKey, req.PrivateAddress)
	if err != nil {
		return application.EnrollResult{}, err
	}
	defer removeKnownHosts()

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

	// The key file is removed on every path, including a panic in a step.
	defer e.removeRemoteKeyFile(ctx, knownHostsPath, req.PrivateAddress)

	keyBytes := key.Key.Bytes()
	defer clear(keyBytes)
	if err := e.deliverKey(ctx, req, knownHostsPath, keyBytes); err != nil {
		return application.EnrollResult{}, err
	}
	deviceID, err := e.join(ctx, req, knownHostsPath)
	if err != nil {
		return application.EnrollResult{}, err
	}

	return application.EnrollResult{
		DeviceID:   deviceID,
		HostKey:    hostKey.Fingerprint,
		TailnetTag: req.TailnetTag,
	}, nil
}

// validate refuses a request before any I/O. The tag must be the approved one,
// the address must be a private IP, and the instance id must be well formed,
// because all three are interpolated into a remote command.
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
	ip := net.ParseIP(req.PrivateAddress)
	if ip == nil || ip.IsLoopback() || !ip.IsPrivate() {
		return domain.Invalid("private_address", "must be the host's private IPv4 address")
	}
	return nil
}

// pinHostKey fetches the host public key over SSM and refuses anything that does
// not provably belong to this instance. It mints nothing and writes no secret:
// every failure here happens before a credential exists.
func (e *Enroller) pinHostKey(ctx context.Context, instanceID string) (domain.HostPublicKey, error) {
	stepCtx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()

	result, err := e.cfg.Runner.RunCommand(stepCtx, application.SSMRunRequest{
		InstanceID: instanceID,
		// The comment is the correlation token: a reply from another invocation
		// carries another value and is refused.
		Comment: instanceID,
		Command: hostKeyCommand,
	})
	if err != nil {
		return domain.HostPublicKey{}, fmt.Errorf("fetch host public key: %w", err)
	}
	if result.InstanceID != instanceID {
		return domain.HostPublicKey{}, fmt.Errorf(
			"fetch host public key: reply names instance %q, not %q; refusing a key that does not belong to this host",
			result.InstanceID, instanceID)
	}
	if result.Comment != instanceID {
		return domain.HostPublicKey{}, fmt.Errorf(
			"fetch host public key: reply correlation comment %q does not match %q", result.Comment, instanceID)
	}
	if result.Status != "Success" || result.ExitCode != 0 {
		return domain.HostPublicKey{}, fmt.Errorf(
			"fetch host public key: command did not succeed (status %q, exit %d)", result.Status, result.ExitCode)
	}
	lines := nonEmptyLines(result.Stdout)
	if len(lines) == 0 {
		return domain.HostPublicKey{}, errors.New("fetch host public key: no key returned")
	}
	if len(lines) > 1 {
		return domain.HostPublicKey{}, fmt.Errorf("fetch host public key: expected one key, got %d lines", len(lines))
	}
	hostKey, err := domain.ParseHostPublicKey(lines[0], instanceID)
	if err != nil {
		return domain.HostPublicKey{}, err
	}
	e.cfg.Logger.Info("host.key.pinned",
		"instance_id", instanceID,
		"host_key", hostKey.Fingerprint,
	)
	return hostKey, nil
}

// writeKnownHosts writes the pinned entry to a private file and returns its path.
// The file is its own file, used by its own enrollment: nothing else can inherit
// trust from it.
func (e *Enroller) writeKnownHosts(key domain.HostPublicKey, address string) (string, func(), error) {
	if parent := strings.TrimSpace(e.cfg.KnownHostsDir); parent != "" {
		if err := os.MkdirAll(parent, knownHostsDirMode); err != nil {
			return "", func() {}, fmt.Errorf("known_hosts: create %s: %w", parent, err)
		}
	}
	dir, err := os.MkdirTemp(e.cfg.KnownHostsDir, "fleet-known-hosts-")
	if err != nil {
		return "", func() {}, fmt.Errorf("known_hosts: create private directory: %w", err)
	}
	remove := func() {
		_ = os.RemoveAll(dir)
	}
	if err := os.Chmod(dir, knownHostsDirMode); err != nil {
		remove()
		return "", func() {}, fmt.Errorf("known_hosts: set directory mode: %w", err)
	}
	path := filepath.Join(dir, "known_hosts")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, knownHostsMode)
	if err != nil {
		remove()
		return "", func() {}, fmt.Errorf("known_hosts: create file: %w", err)
	}
	if _, err := file.WriteString(key.KnownHostsLine(address) + "\n"); err != nil {
		_ = file.Close()
		remove()
		return "", func() {}, fmt.Errorf("known_hosts: write entry: %w", err)
	}
	if err := file.Close(); err != nil {
		remove()
		return "", func() {}, fmt.Errorf("known_hosts: close file: %w", err)
	}
	// Chmod after the write: an inherited umask can only ever make this stricter,
	// and the assertion here makes the final mode exact.
	if err := os.Chmod(path, knownHostsMode); err != nil {
		remove()
		return "", func() {}, fmt.Errorf("known_hosts: set mode: %w", err)
	}
	return path, remove, nil
}

// deliverKey writes the enrollment key on the host over stdin. The key is read
// from a pipe, never from an argument: argv holds no key material.
func (e *Enroller) deliverKey(ctx context.Context, req application.EnrollRequest, knownHostsPath string, key []byte) error {
	stepCtx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()

	// umask 077 makes the file 0600 before a byte is written; chmod 600 asserts it.
	writeCommand := fmt.Sprintf(
		"set +x; umask 077; mkdir -p %s; cat > %s; rc=$?; chmod 600 %s; exit $rc",
		path.Dir(e.remoteKeyPath), e.remoteKeyPath, e.remoteKeyPath)
	result, err := e.cfg.SSH.Run(stepCtx, application.SSHRunRequest{
		Label: "deliver-enrollment-key",
		Args:  e.sshArgs(knownHostsPath, req.PrivateAddress, writeCommand),
		Stdin: key,
	})
	if err != nil {
		return fmt.Errorf("deliver enrollment key: %w", err)
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("deliver enrollment key: ssh exited %d: %s", result.ExitCode, domain.SanitizeMessage(result.Stderr))
	}
	return nil
}

// join runs `tailscale up` with the key file reference, the approved tag, and the
// host name, then reports the node identity and confirms the tag it registered
// with.
func (e *Enroller) join(ctx context.Context, req application.EnrollRequest, knownHostsPath string) (string, error) {
	stepCtx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()

	// The key travels as a file: reference, never as a value. `tailscale up` and
	// `tailscale status` need root to reach the daemon socket; `rm -f` does not,
	// because the key file belongs to the login user. `rm -f` runs whatever
	// `tailscale up` returns, so a failed join does not leave the key behind until
	// the deferred cleanup runs.
	joinCommand := fmt.Sprintf(
		"set +x; sudo -n tailscale up --auth-key=file:%s --advertise-tags=%s --hostname=%s --accept-routes=false; rc=$?; rm -f %s; [ $rc -ne 0 ] && exit $rc; sudo -n tailscale status --json",
		e.remoteKeyPath, req.TailnetTag, req.Name, e.remoteKeyPath)
	result, err := e.cfg.SSH.Run(stepCtx, application.SSHRunRequest{
		Label: "join-tailnet",
		Args:  e.sshArgs(knownHostsPath, req.PrivateAddress, joinCommand),
	})
	if err != nil {
		return "", fmt.Errorf("join tailnet: %w", err)
	}
	if result.ExitCode != 0 {
		return "", fmt.Errorf("join tailnet: ssh exited %d: %s", result.ExitCode, domain.SanitizeMessage(result.Stderr))
	}

	var status struct {
		Self struct {
			ID       string   `json:"ID"`
			HostName string   `json:"HostName"`
			Tags     []string `json:"Tags"`
		} `json:"Self"`
	}
	if err := json.Unmarshal([]byte(result.Stdout), &status); err != nil {
		return "", fmt.Errorf("join tailnet: node status is not JSON: %w", err)
	}
	if strings.TrimSpace(status.Self.ID) == "" {
		return "", errors.New("join tailnet: node status reported no device id")
	}
	tagFound := false
	for _, tag := range status.Self.Tags {
		if tag == req.TailnetTag {
			tagFound = true
			break
		}
	}
	if !tagFound {
		return "", fmt.Errorf("join tailnet: node joined with tags %v, which do not include the approved tag %q",
			status.Self.Tags, req.TailnetTag)
	}
	e.cfg.Logger.Info("host.enroll.joined",
		"host_id", req.HostID,
		"device_id", status.Self.ID,
		"tailnet_tag", req.TailnetTag,
	)
	return status.Self.ID, nil
}

// removeRemoteKeyFile deletes the key file on the host. It runs on success and on
// failure, with a context that is not cancelled by the failure that caused it.
func (e *Enroller) removeRemoteKeyFile(ctx context.Context, knownHostsPath, address string) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
	defer cancel()
	command := fmt.Sprintf("set +x; rm -f %s", e.remoteKeyPath)
	result, err := e.cfg.SSH.Run(cleanupCtx, application.SSHRunRequest{
		Label: "remove-enrollment-key",
		Args:  e.sshArgs(knownHostsPath, address, command),
	})
	if err != nil {
		e.cfg.Logger.Warn("host.enroll.key_cleanup_failed", "address", address, "error", domain.SanitizeMessage(err.Error()))
		return
	}
	if result.ExitCode != 0 {
		e.cfg.Logger.Warn("host.enroll.key_cleanup_failed", "address", address,
			"error", domain.SanitizeMessage(fmt.Sprintf("ssh exited %d", result.ExitCode)))
	}
}

// sshArgs builds the complete argv. Every invocation pins the host key: a
// dedicated known_hosts file, StrictHostKeyChecking=yes, and no acceptance of an
// unknown key. `--` ends option parsing before the destination.
func (e *Enroller) sshArgs(knownHostsPath, address, remoteCommand string) []string {
	return []string{
		"-F", "/dev/null",
		"-o", "BatchMode=yes",
		"-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + knownHostsPath,
		"-o", "GlobalKnownHostsFile=/dev/null",
		"-o", "IdentitiesOnly=yes",
		"-o", "PasswordAuthentication=no",
		"-o", "ConnectTimeout=15",
		"-i", e.cfg.IdentityFile,
		"--", sshUser + "@" + address,
		"sh", "-c", remoteCommand,
	}
}

func nonEmptyLines(blob string) []string {
	var out []string
	for _, line := range strings.Split(blob, "\n") {
		if trimmed := strings.TrimRight(line, "\r"); strings.TrimSpace(trimmed) != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
