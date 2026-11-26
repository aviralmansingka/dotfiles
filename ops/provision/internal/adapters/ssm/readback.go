package ssm

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// The names of the five facts the readback proves. They are constants so a
// failure reports the same name in a job error, a log line, and a test, and so an
// operator can grep for one.
const (
	// FactRexInStore: the rex binary resolves into the Nix store, and it is the
	// binary the host's own deployment record names for the requested revision.
	FactRexInStore = "rex_resolves_to_nix_store"
	// FactUserUnitActive: `systemctl --user is-active rex` reports active.
	FactUserUnitActive = "rex_user_unit_active"
	// FactServeMapping: `tailscale serve status` maps the tailnet HTTPS port to
	// the loopback listener.
	FactServeMapping = "tailscale_serve_maps_" + servePort + "_to_" + rexListenAddress
	// FactProfileLinks: the three profile config links exist.
	FactProfileLinks = "rex_config_links_present"
	// FactLinger: linger is on for the account, so the user unit starts at boot.
	FactLinger = "linger_enabled"

	// maxRecordedRevisions bounds how many deployment records the readback scans.
	// A host is redeployed a handful of times, not hundreds; the bound keeps one
	// long-lived host from turning a readback into an unbounded number of
	// control-plane calls.
	maxRecordedRevisions = 5
)

// ReadbackConfig configures the readback. It is deliberately smaller than
// DeployConfig: reading the host needs no activation command, no switch command,
// and no wait.
type ReadbackConfig struct {
	// Runner is the SSM Run Command transport, the same one enrollment and the
	// deploy use.
	Runner ports.SSMRunner
	// Logger records non-secret progress.
	Logger ports.Logger
	// Account is the login account the profile manages. Defaults to
	// DefaultDeployAccount.
	Account string
	// Home is that account's home directory. Defaults to /home/<account>.
	Home string
	// DeployedRoot is where the deploy recorded what it deployed. Defaults to
	// DefaultDeployedRoot, and must agree with the deployer's: a readback that
	// looked somewhere else would prove nothing.
	DeployedRoot string
	// CommandTimeout bounds one remote call. Defaults to
	// DefaultDeployCommandTimeout.
	CommandTimeout time.Duration
}

// Reader asks a host what landed on it.
//
// It runs after the deploy and before the workflow may report ready, and it
// believes nothing the deploy reported: every fact is read off the host. A host
// that answers with any fact wrong fails the job with a domain.ProfileNotReadyError
// naming that fact.
type Reader struct {
	cfg  ReadbackConfig
	host profileHost
}

var _ ports.ProfileReadback = (*Reader)(nil)

// NewReader validates the configuration and builds the readback.
func NewReader(cfg ReadbackConfig) (*Reader, error) {
	if cfg.Runner == nil {
		return nil, errNoTransport
	}
	host, err := resolveProfileHost(cfg.Account, cfg.Home, cfg.DeployedRoot)
	if err != nil {
		return nil, err
	}
	if cfg.CommandTimeout <= 0 {
		cfg.CommandTimeout = DefaultDeployCommandTimeout
	}
	return &Reader{cfg: cfg, host: host}, nil
}

// ReadBackProfile implements ports.ProfileReadback.
func (r *Reader) ReadBackProfile(ctx context.Context, req ports.ReadbackRequest) (ports.ReadbackResult, error) {
	if err := r.validate(req); err != nil {
		return ports.ReadbackResult{}, err
	}
	facts := make([]string, 0, 5)

	// Fact 1: the rex binary is the profile's, and the revision it belongs to is
	// the one that was asked for. The revision this returns is the one the host
	// records, not the one the request carried.
	revision, rexPath, err := r.rexInStore(ctx, req)
	if err != nil {
		return ports.ReadbackResult{}, err
	}
	facts = append(facts, FactRexInStore)

	// Fact 2: the server unit is running.
	if err := r.userUnitActive(ctx, req); err != nil {
		return ports.ReadbackResult{}, err
	}
	facts = append(facts, FactUserUnitActive)

	// Fact 3: the tailnet publishes it, on the loopback address the profile ships.
	url, err := r.serveMapping(ctx, req)
	if err != nil {
		return ports.ReadbackResult{}, err
	}
	facts = append(facts, FactServeMapping)

	// Fact 4: the three config links the profile delivers exist.
	if err := r.configLinks(ctx, req); err != nil {
		return ports.ReadbackResult{}, err
	}
	facts = append(facts, FactProfileLinks)

	// Fact 5: linger, so the user unit survives the last session closing and comes
	// back at boot.
	if err := r.linger(ctx, req); err != nil {
		return ports.ReadbackResult{}, err
	}
	facts = append(facts, FactLinger)

	logInfo(r.cfg.Logger, "host.profile.verified",
		"host_id", req.HostID,
		"flake_revision", shortRevision(revision),
		"rex_path", rexPath,
		"rex_url", url,
		"facts", strings.Join(facts, ","),
	)
	return ports.ReadbackResult{
		FlakeRevision: revision,
		RexURL:        url,
		RexPath:       rexPath,
		Facts:         facts,
	}, nil
}

// validate refuses a request before any remote call, exactly as the deploy does.
func (r *Reader) validate(req ports.ReadbackRequest) error {
	if strings.TrimSpace(req.HostID) == "" {
		return missingSetting("host_id", "is required")
	}
	if err := domain.ValidateHostName(req.Name); err != nil {
		return err
	}
	if strings.TrimSpace(req.InstanceID) == "" {
		return missingSetting("instance_id",
			"is required: the readback is addressed to an instance, and this service has no other transport")
	}
	if err := domain.ValidateInstanceID(req.InstanceID); err != nil {
		return err
	}
	return validateRevision(req.FlakeRevision)
}

func (r *Reader) call(req ports.ReadbackRequest, step string) remote {
	return remote{
		runner:     r.cfg.Runner,
		instanceID: req.InstanceID,
		comment:    req.InstanceID + ":" + step,
		timeout:    r.cfg.CommandTimeout,
	}
}

// notReady builds the failure for one fact. It is a report about the host, not a
// transport failure: the command ran and the answer was wrong.
func (r *Reader) notReady(req ports.ReadbackRequest, fact, reason string) error {
	return &domain.ProfileNotReadyError{
		HostID: req.HostID,
		Fact:   fact,
		Reason: domain.SanitizeMessage(reason),
	}
}

// rexInStore proves fact 1 and returns the revision the host is actually running.
//
// A Nix store path is a content hash, so it cannot carry a revision itself. What
// carries it is the deployment record the deploy step writes: `<root>/<revision>`
// is a symlink named by the revision, pointing at the rex binary that revision
// installed. So the fact is proved by walking the host's records and finding the
// one the live binary belongs to:
//
//   - `rex` must resolve into the Nix store (a wrapper script or a distro package
//     is not the deployed profile);
//   - the record it belongs to must exist, and that record's name is the revision
//     this readback reports;
//   - that revision must be the one that was asked for, so a host running an older
//     generation fails instead of being reported ready.
func (r *Reader) rexInStore(ctx context.Context, req ports.ReadbackRequest) (string, string, error) {
	call := r.call(req, "readback-rex")

	result, err := call.run(ctx, command{"readlink", "-f", r.host.rexLink()})
	if err != nil {
		return "", "", fmt.Errorf("resolve the rex binary on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("resolve the rex binary", result); err != nil {
		return "", "", r.notReady(req, FactRexInStore, fmt.Sprintf(
			"%s does not resolve (%v)", r.host.rexLink(), err))
	}
	resolved := strings.TrimSpace(result.Stdout)
	if !strings.HasPrefix(resolved, nixStorePrefix) {
		return "", "", r.notReady(req, FactRexInStore, fmt.Sprintf(
			"rex resolves to %s, which is not in %s", resolved, nixStorePrefix))
	}

	recorded, err := r.recordedRevisions(ctx, req)
	if err != nil {
		return "", "", err
	}
	if len(recorded) == 0 {
		return "", "", r.notReady(req, FactRexInStore, fmt.Sprintf(
			"the host records no deployment under %s", r.host.deployedRoot))
	}
	// The requested revision is always scanned: records sort by name, so a host
	// deployed more than maxRecordedRevisions times could otherwise drop the one
	// that matters off the end of the list.
	candidates := append([]string{req.FlakeRevision}, recorded...)
	scanned := make([]string, 0, maxRecordedRevisions+1)
	for _, revision := range candidates {
		if revision == "" || containsString(scanned, revision) {
			continue
		}
		scanned = append(scanned, revision)
		if len(scanned) > maxRecordedRevisions {
			break
		}
	}

	var owners []string
	for _, revision := range scanned {
		result, err := call.run(ctx, command{"readlink", "-f", r.host.marker(revision)})
		if err != nil {
			return "", "", fmt.Errorf("read the deployment record on %s: %w", req.InstanceID, err)
		}
		if result.ExitCode != 0 {
			continue
		}
		if strings.TrimSpace(result.Stdout) == resolved {
			owners = append(owners, revision)
		}
	}
	switch {
	case len(owners) == 0:
		return "", "", r.notReady(req, FactRexInStore, fmt.Sprintf(
			"rex resolves to %s, which belongs to none of the recorded revisions %s",
			resolved, shortRevisions(scanned)))
	case owners[0] != req.FlakeRevision:
		return "", "", r.notReady(req, FactRexInStore, fmt.Sprintf(
			"the host runs the rex binary of revision %s, not the requested %s",
			shortRevision(owners[0]), shortRevision(req.FlakeRevision)))
	}
	return owners[0], resolved, nil
}

// shortRevisions abbreviates a list of commits for a message: the scrubber every
// error passes through redacts a 40-character hex run as a credential shape.
func shortRevisions(revisions []string) string {
	abbreviated := make([]string, 0, len(revisions))
	for _, revision := range revisions {
		abbreviated = append(abbreviated, shortRevision(revision))
	}
	return strings.Join(abbreviated, ",")
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// recordedRevisions lists the revision names the host records as deployed. A host
// that has been deployed only once has one; a redeployed host has several, newest
// last, because the record names sort by revision rather than by time — which is
// why the readback identifies the live one by the binary it points at instead of
// assuming an order.
func (r *Reader) recordedRevisions(ctx context.Context, req ports.ReadbackRequest) ([]string, error) {
	result, err := r.call(req, "readback-records").run(ctx, command{"ls", "-1", r.host.deployedRoot})
	if err != nil {
		return nil, fmt.Errorf("list the deployment records on %s: %w", req.InstanceID, err)
	}
	if result.ExitCode != 0 {
		// No records directory at all is the honest answer for a host that was
		// never deployed; the caller reports it as the failed fact.
		return nil, nil
	}
	var revisions []string
	for _, line := range strings.Split(result.Stdout, "\n") {
		name := strings.TrimSpace(line)
		if name == "" || !revisionPattern.MatchString(name) {
			continue
		}
		revisions = append(revisions, name)
	}
	return revisions, nil
}

// userUnitActive proves fact 2.
func (r *Reader) userUnitActive(ctx context.Context, req ports.ReadbackRequest) error {
	argv := command{"systemctl", "--user", "-M", r.host.machine(), "is-active", rexUserUnit}
	result, err := r.call(req, "readback-unit").run(ctx, argv)
	if err != nil {
		return fmt.Errorf("read the rex unit state on %s: %w", req.InstanceID, err)
	}
	state := strings.TrimSpace(result.Stdout)
	if state != stateActive {
		return r.notReady(req, FactUserUnitActive, fmt.Sprintf(
			"systemctl --user is-active %s reported %q", rexUserUnit, state))
	}
	return nil
}

// serveMapping proves fact 3 and returns the address the tailnet publishes.
func (r *Reader) serveMapping(ctx context.Context, req ports.ReadbackRequest) (string, error) {
	result, err := r.call(req, "readback-serve").run(ctx, command{"tailscale", "serve", "status"})
	if err != nil {
		return "", fmt.Errorf("read the serve status on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("read the serve status", result); err != nil {
		return "", r.notReady(req, FactServeMapping, err.Error())
	}
	url, mapping, ok := parseServeStatus(result.Stdout)
	if !ok {
		return "", r.notReady(req, FactServeMapping, fmt.Sprintf(
			"tailscale serve publishes no https://<host> mapping of %s on port %s (status: %s)",
			rexListenAddress, servePort, domain.SanitizeMessage(result.Stdout)))
	}
	if mapping != rexListenAddress {
		return "", r.notReady(req, FactServeMapping, fmt.Sprintf(
			"tailscale serve maps HTTPS to %s, not to %s", mapping, rexListenAddress))
	}
	return url, nil
}

// configLinks proves fact 4.
func (r *Reader) configLinks(ctx context.Context, req ports.ReadbackRequest) error {
	links := r.host.configLinks()
	argv := append(command{"ls", "-l"}, links...)
	result, err := r.call(req, "readback-links").run(ctx, argv)
	if err != nil {
		return fmt.Errorf("read the profile links on %s: %w", req.InstanceID, err)
	}
	if result.ExitCode != 0 {
		return r.notReady(req, FactProfileLinks, fmt.Sprintf(
			"a profile link is missing (%s)", domain.SanitizeMessage(result.Stderr)))
	}
	for _, link := range links {
		if !strings.Contains(result.Stdout, link) {
			return r.notReady(req, FactProfileLinks, fmt.Sprintf("%s is missing", link))
		}
	}
	return nil
}

// linger proves fact 5.
func (r *Reader) linger(ctx context.Context, req ports.ReadbackRequest) error {
	argv := command{"loginctl", "show-user", r.host.account, "--property=Linger"}
	result, err := r.call(req, "readback-linger").run(ctx, argv)
	if err != nil {
		return fmt.Errorf("read linger on %s: %w", req.InstanceID, err)
	}
	if err := succeeded("read linger", result); err != nil {
		return r.notReady(req, FactLinger, err.Error())
	}
	if strings.TrimSpace(result.Stdout) != lingerOn {
		return r.notReady(req, FactLinger, fmt.Sprintf(
			"loginctl reports %q; without linger the user service stops when the last session closes and never starts at boot",
			domain.SanitizeMessage(result.Stdout)))
	}
	return nil
}

// lingerOn is what `loginctl show-user <account> --property=Linger` prints when it
// is granted.
const lingerOn = "Linger=yes"

// parseServeStatus reads `tailscale serve status` for the published HTTPS address
// and the loopback target behind it.
//
// The text form is what the module's own validation and the S04 runbook read, so a
// provisioner that understood only `--json` would prove a different thing from the
// operator. Two shapes are accepted, because the CLI prints both:
//
//	https://mumbai.tailnet.ts.net (tailnet only)
//	|-- / proxy http://127.0.0.1:7297
//
// and the newer
//
//	https://mumbai.tailnet.ts.net/
//	|-- / proxy http://127.0.0.1:7297
//
// The address must be HTTPS on the default Serve port: an explicit port or a
// sub-path mapping is not the address this service returns.
func parseServeStatus(status string) (url, mapping string, ok bool) {
	lines := strings.Split(status, "\n")
	for _, line := range lines {
		address, found := strings.CutPrefix(strings.TrimSpace(line), "https://")
		if !found {
			continue
		}
		if index := strings.IndexAny(address, " \t"); index >= 0 {
			address = address[:index]
		}
		address = strings.TrimSuffix(address, "/")
		if address == "" || strings.ContainsAny(address, ":/") {
			continue
		}
		url = "https://" + address
		break
	}
	if url == "" {
		return "", "", false
	}
	for _, line := range lines {
		field := strings.TrimSpace(line)
		index := strings.Index(field, "proxy")
		if index < 0 {
			continue
		}
		target := strings.TrimSpace(field[index+len("proxy"):])
		if cut := strings.Index(target, "://"); cut >= 0 {
			target = target[cut+3:]
		}
		if index := strings.IndexAny(target, " \t"); index >= 0 {
			target = target[:index]
		}
		target = strings.TrimSuffix(target, "/")
		if target == "" {
			continue
		}
		return url, target, true
	}
	return "", "", false
}
