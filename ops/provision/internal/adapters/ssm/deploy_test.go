package ssm_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// deployRequest is one fully resolved deploy: addressed by instance id, aimed at a
// fully qualified flake target.
func deployRequest() ports.DeployRequest {
	return ports.DeployRequest{
		HostID:     "host-0001",
		Name:       hostName,
		Profile:    "rex",
		FlakeRef:   flakeRef,
		InstanceID: instanceID,
	}
}

// newDeployer builds the adapter against a scripted host.
func newDeployer(t *testing.T, runner *profileRunner, agent ports.SSMAgentProbe, logger ports.Logger) *ssm.Deployer {
	t.Helper()
	deployer, err := ssm.NewDeployer(ssm.DeployConfig{
		Runner:         runner,
		Agent:          agent,
		Logger:         logger,
		PollInterval:   time.Millisecond,
		ServeDeadline:  200 * time.Millisecond,
		CommandTimeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("NewDeployer: %v", err)
	}
	return deployer
}

// TestDeployActivatesTheProfileInTheOrderTheProfileNeeds is the happy path, stated
// as the property that matters: the grant comes before Serve is touched, Serve is
// enabled and restarted after the profile is activated, and the host's own resolved
// revision is what is reported.
func TestDeployActivatesTheProfileInTheOrderTheProfileNeeds(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	logger := &fakes.Logger{}
	deployer := newDeployer(t, runner, onlineAgent(), logger)

	result, err := deployer.DeployProfile(context.Background(), deployRequest())
	if err != nil {
		t.Fatalf("DeployProfile: %v", err)
	}
	if result.FlakeRevision != deployRevision {
		t.Fatalf("flake revision = %q, want the revision the host resolved %q", result.FlakeRevision, deployRevision)
	}
	if want := "https://rex-1.tail1234.ts.net"; result.RexURL != want {
		t.Fatalf("rex url = %q, want %q", result.RexURL, want)
	}

	want := []string{
		"flake-metadata",
		"recorded-deploy",
		"activate",
		"rex-path",
		"record-deploy",
		"record-deploy",
		"operator-grant",
		"serve-daemon-reload",
		"serve-enable",
		"serve-restart",
		"serve-poll",
		"serve-status",
	}
	if got := runner.steps(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("steps = %v, want %v", got, want)
	}

	// The grant precedes every Serve call: without it the Serve unit fails, which is
	// the module's own documented operator step.
	grantAt := indexOf(t, runner.steps(), "operator-grant")
	restartAt := indexOf(t, runner.steps(), "serve-restart")
	if grantAt > restartAt {
		t.Fatalf("the operator grant came after the Serve restart: %v", runner.steps())
	}

	// The activation runs as the profile's account, from a fully qualified target.
	activate := argvOf(runner.programFor(t, "activate", 0))
	if got := activate[len(activate)-2] + " " + activate[len(activate)-1]; got != "--flake "+flakeRef {
		t.Fatalf("activation argv tail = %q, want --flake %s (argv %v)", got, flakeRef, activate)
	}
	if !contains(activate, "runuser") || !contains(activate, account) {
		t.Fatalf("activation argv does not run as %s: %v", account, activate)
	}

	// The grant is the exact command the module documents.
	if got, want := strings.Join(argvOf(runner.programFor(t, "operator-grant", 0)), " "), "tailscale set --operator="+account; got != want {
		t.Fatalf("operator grant = %q, want %q", got, want)
	}
	// Every user-unit call is addressed to the account's own manager: a run-command
	// has no session, so `--user` alone would reach nothing.
	for _, step := range []string{"serve-daemon-reload", "serve-enable", "serve-restart", "serve-poll"} {
		argv := argvOf(runner.programFor(t, step, 0))
		if !contains(argv, "--user") || !contains(argv, account+"@.host") {
			t.Fatalf("%s argv does not address the account's user manager: %v", step, argv)
		}
	}

	// No program carries anything a shell could read as syntax.
	assertArgvOnly(t, runner)
}

// TestDeployRecordsTheRevisionItResolved proves the deployment record is written
// once, named by the revision, and pointing at the binary that revision installed.
func TestDeployRecordsTheRevisionItResolved(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	deployer := newDeployer(t, runner, onlineAgent(), &fakes.Logger{})
	if _, err := deployer.DeployProfile(context.Background(), deployRequest()); err != nil {
		t.Fatalf("DeployProfile: %v", err)
	}
	link := argvOf(runner.programFor(t, "record-deploy", 1))
	if got, want := strings.Join(link, " "), "ln -sfn "+rexStorePath+" "+deployedRoot+"/"+deployRevision; got != want {
		t.Fatalf("deployment record = %q, want %q", got, want)
	}
}

// TestDeployFailsClosedWithoutAnAddress says the fail-closed rule at its sharpest:
// there is no transport in this service but the control plane, so a request with no
// instance id, no host id, no profile, or a local flake target refuses before a
// single remote call and before even asking the agent.
func TestDeployFailsClosedWithoutAnAddress(t *testing.T) {
	t.Parallel()
	cases := map[string]func(*ports.DeployRequest){
		"no instance id": func(req *ports.DeployRequest) { req.InstanceID = "" },
		"bad instance id": func(req *ports.DeployRequest) {
			req.InstanceID = "rex-1.mumbai.example"
		},
		"no host id":  func(req *ports.DeployRequest) { req.HostID = "" },
		"no profile":  func(req *ports.DeployRequest) { req.Profile = "" },
		"bad name":    func(req *ports.DeployRequest) { req.Name = "REX;id" },
		"no flake":    func(req *ports.DeployRequest) { req.FlakeRef = "" },
		"local flake": func(req *ports.DeployRequest) { req.FlakeRef = ".#homeConfigurations.remote-mumbai.activationPackage" },
	}
	for name, mutate := range cases {
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			runner := healthyProfile()
			agent := onlineAgent()
			deployer := newDeployer(t, runner, agent, &fakes.Logger{})
			req := deployRequest()
			mutate(&req)
			if _, err := deployer.DeployProfile(context.Background(), req); err == nil {
				t.Fatal("the deploy accepted a request it cannot address")
			}
			if got := len(runner.steps()); got != 0 {
				t.Fatalf("the deploy ran %d remote commands before refusing: %v", got, runner.steps())
			}
			if agent.calls != 0 {
				t.Fatalf("the deploy asked the control plane about the agent %d times before refusing", agent.calls)
			}
		})
	}
}

// TestDeployRefusesARelativeFlakeTargetWithTheFix: the catalog's `.#...` target is
// written for a deploy run inside a checkout. A host has none, so the refusal has to
// say what to set instead of leaving an operator with a Nix error from a machine
// they cannot log in to.
func TestDeployRefusesARelativeFlakeTargetWithTheFix(t *testing.T) {
	t.Parallel()
	err := domain.ValidateRemoteFlakeRef(".#homeConfigurations.remote-mumbai.activationPackage")
	if err == nil {
		t.Fatal("a relative flake target was accepted for a remote deploy")
	}
	if !strings.Contains(err.Error(), "github:owner/repo") {
		t.Fatalf("the refusal does not name the fix: %v", err)
	}
}

// TestDeployFailsClosedOnAnUnregisteredAgent: no agent means no command, so the
// deploy must stop before the flake is even resolved.
func TestDeployFailsClosedOnAnUnregisteredAgent(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	agent := &fakeAgent{err: &domain.AgentNotRegisteredError{
		InstanceID: instanceID,
		Waited:     4 * time.Minute,
		PingStatus: "ConnectionLost",
	}}
	deployer := newDeployer(t, runner, agent, &fakes.Logger{})
	_, err := deployer.DeployProfile(context.Background(), deployRequest())
	if err == nil {
		t.Fatal("the deploy accepted a host whose agent never registered")
	}
	var notRegistered *domain.AgentNotRegisteredError
	if !errors.As(err, &notRegistered) {
		t.Fatalf("error = %v, want the agent-not-registered refusal so the job fails permanently", err)
	}
	if got := len(runner.steps()); got != 0 {
		t.Fatalf("the deploy ran %d remote commands with no agent: %v", got, runner.steps())
	}
}

// TestDeployFailsWhenActivationExitsNonZero: a switch that fails is the end of the
// deploy. Nothing is recorded and nothing is published.
func TestDeployFailsWhenActivationExitsNonZero(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	runner.activateExit = 100
	deployer := newDeployer(t, runner, onlineAgent(), &fakes.Logger{})
	if _, err := deployer.DeployProfile(context.Background(), deployRequest()); err == nil {
		t.Fatal("the deploy reported success after a failed activation")
	}
	if steps := runner.steps(); !strings.HasSuffix(strings.Join(steps, ","), "activate") {
		t.Fatalf("steps after a failed activation = %v, want the deploy to stop there", steps)
	}
	if got := runner.countStep("record-deploy"); got != 0 {
		t.Fatalf("the deploy recorded %d deployments after a failed activation", got)
	}
	if got := runner.countStep("serve-restart"); got != 0 {
		t.Fatalf("the deploy restarted Serve %d times after a failed activation", got)
	}
}

// TestDeployFailsWhenServeNeverConverges: the poll is bounded, and a unit that
// never reports active fails the deploy with the state it last reported instead of
// hanging until the activity times out.
func TestDeployFailsWhenServeNeverConverges(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	runner.serveStates = []string{"activating"}
	deployer := newDeployer(t, runner, onlineAgent(), &fakes.Logger{})
	_, err := deployer.DeployProfile(context.Background(), deployRequest())
	if err == nil {
		t.Fatal("the deploy reported success with rex-serve never active")
	}
	if !strings.Contains(err.Error(), "did not become active") {
		t.Fatalf("error = %v, want a bounded-deadline report", err)
	}
	if runner.countStep("serve-poll") < 2 {
		t.Fatalf("the deploy polled %d times, want a real wait", runner.countStep("serve-poll"))
	}
}

// TestDeployRetryAfterPartialActivationDoesNotRebuildTheProfile is the retry
// property. The first attempt activates the profile and then fails at the Serve
// step; the retry must adopt the deployment record instead of switching the profile
// a second time, because a second switch is another twenty-minute build and a new
// generation for no reason.
func TestDeployRetryAfterPartialActivationDoesNotRebuildTheProfile(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	logger := &fakes.Logger{}
	deployer := newDeployer(t, runner, onlineAgent(), logger)

	// First attempt: the switch succeeds, the record is written, Serve fails.
	runner.answer("serve-restart", func(ports.SSMRunRequest) (ports.SSMRunResult, error) {
		return ports.SSMRunResult{Status: "Failed", ExitCode: 1, Stderr: "Job for rex-serve.service failed"}, nil
	})
	if _, err := deployer.DeployProfile(context.Background(), deployRequest()); err == nil {
		t.Fatal("the first attempt reported success with Serve failing")
	}
	if runner.switchCalls != 1 {
		t.Fatalf("switch calls after the first attempt = %d, want 1", runner.switchCalls)
	}
	// The record the first attempt wrote is what the retry will find.
	runner.recordedRevision = deployRevision
	runner.recordedRexPath = rexStorePath
	runner.answers = nil

	result, err := deployer.DeployProfile(context.Background(), deployRequest())
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if result.FlakeRevision != deployRevision {
		t.Fatalf("retry reported revision %q", result.FlakeRevision)
	}
	if runner.switchCalls != 1 {
		t.Fatalf("switch calls after the retry = %d, want 1: the retry must adopt, not rebuild", runner.switchCalls)
	}
	if got := runner.countStep("record-deploy"); got != 2 {
		// Two calls per write: `mkdir -p` and `ln -sfn`.
		t.Fatalf("record commands = %d, want 2 (the first attempt only): the retry must not rewrite the record", got)
	}
	if !logged(logger, "host.deploy.adopted") {
		t.Fatalf("the retry did not log that it adopted the existing deployment: %v", logger.Lines())
	}
}

// TestDeployKeepsSecretsOutOfErrorsAndLogs: the deploy carries no credential, but a
// host program can print anything at all into stderr, and that text reaches a job
// record. So the error and every log line are sanitized, and a token-shaped value
// from the host never survives.
func TestDeployKeepsSecretsOutOfErrorsAndLogs(t *testing.T) {
	t.Parallel()
	const secret = "tskey-auth-k7Q2F9aZ3xLmN0pQrStU4vWxY"
	runner := healthyProfile()
	runner.answer("activate", func(ports.SSMRunRequest) (ports.SSMRunResult, error) {
		return ports.SSMRunResult{
			Status:   "Failed",
			ExitCode: 1,
			Stderr:   "error: builder failed with auth-key " + secret + " and bearer " + secret,
		}, nil
	})
	logger := &fakes.Logger{}
	deployer := newDeployer(t, runner, onlineAgent(), logger)
	_, err := deployer.DeployProfile(context.Background(), deployRequest())
	if err == nil {
		t.Fatal("the deploy reported success after a failed activation")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("the error carries the host's credential: %v", err)
	}
	for _, line := range logger.Lines() {
		if strings.Contains(line, secret) {
			t.Fatalf("a log line carries the host's credential: %s", line)
		}
	}
	// The sanitized error still names the step, so an operator knows what failed.
	if !strings.Contains(domain.SanitizeMessage(err.Error()), "activate the profile") {
		t.Fatalf("the error does not name the failing step: %v", err)
	}
}

// TestDeployRefusesARevisionThatIsNotACommit: the revision becomes a path segment
// and an argument, so anything but a commit hash is refused before it is used.
func TestDeployRefusesARevisionThatIsNotACommit(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	runner.metadataJSON = `{"revision":"../../etc/passwd"}`
	deployer := newDeployer(t, runner, onlineAgent(), &fakes.Logger{})
	if _, err := deployer.DeployProfile(context.Background(), deployRequest()); err == nil {
		t.Fatal("the deploy accepted a revision that is not a commit hash")
	}
	if runner.countStep("activate") != 0 {
		t.Fatal("the deploy activated the profile with an unusable revision")
	}
}

// TestDeployRefusesAFlakeTargetWithNoCommit: a target that resolves to nothing
// cannot be recorded as an immutable revision.
func TestDeployRefusesAFlakeTargetWithNoCommit(t *testing.T) {
	t.Parallel()
	runner := healthyProfile()
	runner.metadataJSON = `{"revision":"","locked":{}}`
	deployer := newDeployer(t, runner, onlineAgent(), &fakes.Logger{})
	if _, err := deployer.DeployProfile(context.Background(), deployRequest()); err == nil {
		t.Fatal("the deploy accepted a flake target with no revision")
	}
	if runner.countStep("activate") != 0 {
		t.Fatal("the deploy activated the profile without knowing what it was deploying")
	}
}

func indexOf(t *testing.T, values []string, want string) int {
	t.Helper()
	for i, value := range values {
		if value == want {
			return i
		}
	}
	t.Fatalf("%q is not in %v", want, values)
	return -1
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func logged(logger *fakes.Logger, msg string) bool {
	for _, line := range logger.Lines() {
		if strings.Contains(line, msg) {
			return true
		}
	}
	return false
}

// TestDeployRebuildsWhenTheRecordAndTheLiveBinaryDisagree: the record alone is not
// permission to skip the switch. A host rolled back to an older generation still has
// the newer record, so adoption needs the live binary to match it — otherwise the
// deploy would adopt a state the readback is about to refuse.
func TestDeployRebuildsWhenTheRecordAndTheLiveBinaryDisagree(t *testing.T) {
	t.Parallel()
	runner := deployedProfile()
	// The record for the requested revision exists, but the account runs something
	// else: somebody switched the profile by hand or rolled it back.
	runner.rexPath = olderRexStorePath
	deployer := newDeployer(t, runner, onlineAgent(), &fakes.Logger{})
	if _, err := deployer.DeployProfile(context.Background(), deployRequest()); err != nil {
		t.Fatalf("DeployProfile: %v", err)
	}
	if runner.switchCalls != 1 {
		t.Fatalf("switch calls = %d, want 1: a record that does not match the live binary is not an adoption", runner.switchCalls)
	}
}
