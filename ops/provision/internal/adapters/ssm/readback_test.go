package ssm_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// readbackRequest is one readback: addressed by instance id, checking the revision
// the deploy resolved.
func readbackRequest() ports.ReadbackRequest {
	return ports.ReadbackRequest{
		HostID:        "host-0001",
		Name:          hostName,
		InstanceID:    instanceID,
		FlakeRevision: deployRevision,
	}
}

func newReader(t *testing.T, runner *profileRunner) *ssm.Reader {
	t.Helper()
	reader, err := ssm.NewReader(ssm.ReadbackConfig{Runner: runner, Logger: &fakes.Logger{}})
	if err != nil {
		t.Fatalf("NewReader: %v", err)
	}
	return reader
}

// TestReadbackProvesEveryFact is the only path to a ready host: all five facts hold,
// and the result carries the address and the revision the host reported.
func TestReadbackProvesEveryFact(t *testing.T) {
	t.Parallel()
	runner := deployedProfile()
	logger := &fakes.Logger{}
	reader, err := ssm.NewReader(ssm.ReadbackConfig{Runner: runner, Logger: logger})
	if err != nil {
		t.Fatalf("NewReader: %v", err)
	}
	result, err := reader.ReadBackProfile(context.Background(), readbackRequest())
	if err != nil {
		t.Fatalf("ReadBackProfile: %v", err)
	}
	if result.FlakeRevision != deployRevision {
		t.Fatalf("flake revision = %q, want the revision the host records %q", result.FlakeRevision, deployRevision)
	}
	if result.RexPath != rexStorePath {
		t.Fatalf("rex path = %q, want %q", result.RexPath, rexStorePath)
	}
	if want := "https://rex-1.tail1234.ts.net"; result.RexURL != want {
		t.Fatalf("rex url = %q, want %q", result.RexURL, want)
	}
	want := []string{
		ssm.FactRexInStore,
		ssm.FactUserUnitActive,
		ssm.FactServeMapping,
		ssm.FactProfileLinks,
		ssm.FactLinger,
	}
	if strings.Join(result.Facts, ",") != strings.Join(want, ",") {
		t.Fatalf("facts = %v, want %v", result.Facts, want)
	}
	if !logged(logger, "host.profile.verified") {
		t.Fatal("the readback recorded nothing")
	}
	assertArgvOnly(t, runner)
}

// The five negative cases, one test each: every fact has to be load-bearing, so a
// host that fails exactly one of them fails the job — and the failure names that
// fact rather than saying only that the host was not ready.

// TestReadbackRefusesRexOutsideNixStore: fact 1. A rex that came from a distro
// package, a wrapper, or a different generation is not the deployed profile.
func TestReadbackRefusesRexOutsideNixStore(t *testing.T) {
	t.Parallel()
	cases := map[string]func(*profileRunner){
		"distro package": func(r *profileRunner) { r.rexPath = "/usr/bin/rex" },
		"another generation": func(r *profileRunner) {
			r.rexPath = olderRexStorePath
			r.recordedRexPath = rexStorePath
		},
	}
	for name, mutate := range cases {
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			runner := deployedProfile()
			mutate(runner)
			assertRefused(t, runner, ssm.FactRexInStore)
		})
	}
}

// TestReadbackRefusesAUnitThatIsNotActive: fact 2.
func TestReadbackRefusesAUnitThatIsNotActive(t *testing.T) {
	t.Parallel()
	for _, state := range []string{"failed", "inactive", "activating", ""} {
		state := state
		t.Run(state, func(t *testing.T) {
			t.Parallel()
			runner := deployedProfile()
			runner.unitState = state
			assertRefused(t, runner, ssm.FactUserUnitActive)
		})
	}
}

// TestReadbackRefusesAWrongServeMapping: fact 3. A mapping to another port is a
// different service on the same tailnet name, and a mapping that is missing means
// the private address does not exist.
func TestReadbackRefusesAWrongServeMapping(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"wrong loopback port": "https://rex-1.tail1234.ts.net\n|-- / proxy http://127.0.0.1:8080\n",
		"proxies the tailnet": "https://rex-1.tail1234.ts.net\n|-- / proxy http://100.64.0.1:7297\n",
		"nothing published":   "# Tailscale Serve is not running\n",
	}
	for name, status := range cases {
		status := status
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			runner := deployedProfile()
			runner.serveStatus = status
			assertRefused(t, runner, ssm.FactServeMapping)
		})
	}
}

// TestReadbackRefusesAMissingConfigLink: fact 4. Each of the three links is checked
// on its own, because the profile delivers three separate files.
func TestReadbackRefusesAMissingConfigLink(t *testing.T) {
	t.Parallel()
	for _, link := range configLinks() {
		link := link
		t.Run(link, func(t *testing.T) {
			t.Parallel()
			runner := deployedProfile()
			runner.missingLink = link
			runner.linkExit = 2
			assertRefused(t, runner, ssm.FactProfileLinks)
		})
	}
	// A link that exists but is not listed is just as missing: `ls -l` succeeding is
	// not the whole answer.
	t.Run("not listed", func(t *testing.T) {
		t.Parallel()
		runner := deployedProfile()
		runner.missingLink = configLinks()[1]
		assertRefused(t, runner, ssm.FactProfileLinks)
	})
}

// TestReadbackRefusesLingerOff: fact 5. Without linger the user unit stops with the
// last session and never starts at boot, so Rex would be gone after a reboot.
func TestReadbackRefusesLingerOff(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"Linger=no", "Linger=", ""} {
		value := value
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			runner := deployedProfile()
			runner.linger = value
			assertRefused(t, runner, ssm.FactLinger)
		})
	}
}

// TestReadbackRefusesAHostRecordingNoDeployment: the readback reports what the host
// records, so a host that records nothing cannot be reported ready even if rex
// happens to resolve.
func TestReadbackRefusesAHostRecordingNoDeployment(t *testing.T) {
	t.Parallel()
	runner := deployedProfile()
	runner.recordedRevision = ""
	assertRefused(t, runner, ssm.FactRexInStore)
}

// TestReadbackRefusesAHostRunningAnotherRevision: the record exists, rex resolves,
// and both are consistent — but they belong to an older revision than the one that
// was asked for. A host left on the previous generation is not ready.
func TestReadbackRefusesAHostRunningAnotherRevision(t *testing.T) {
	t.Parallel()
	runner := deployedProfile()
	runner.recordedRevision = otherRevision
	runner.recordedRexPath = olderRexStorePath
	runner.rexPath = olderRexStorePath
	err := readbackError(t, runner)
	if err == nil {
		t.Fatal("the readback accepted a host running another revision")
	}
	var notReady *domain.ProfileNotReadyError
	if !errors.As(err, &notReady) || notReady.Fact != ssm.FactRexInStore {
		t.Fatalf("error = %v, want a %s refusal", err, ssm.FactRexInStore)
	}
	// A message names commits by their conventional abbreviation: the scrubber every
	// error passes through redacts a 40-character hex run as a credential shape.
	want := []string{otherRevision[:12], deployRevision[:12]}
	for _, revision := range want {
		if !strings.Contains(err.Error(), revision) {
			t.Fatalf("the refusal does not name revision %s: %v", revision, err)
		}
	}
}

// TestReadbackFailsClosedWithoutAnAddress: the readback is addressed the same way
// the deploy is, and refuses before any command when it is not.
func TestReadbackFailsClosedWithoutAnAddress(t *testing.T) {
	t.Parallel()
	cases := map[string]func(*ports.ReadbackRequest){
		"no instance id": func(req *ports.ReadbackRequest) { req.InstanceID = "" },
		"bad instance id": func(req *ports.ReadbackRequest) {
			req.InstanceID = "rex-1"
		},
		"no host id":         func(req *ports.ReadbackRequest) { req.HostID = "" },
		"no revision claim":  func(req *ports.ReadbackRequest) { req.FlakeRevision = "" },
		"revision not a sha": func(req *ports.ReadbackRequest) { req.FlakeRevision = "../../etc" },
	}
	for name, mutate := range cases {
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			runner := deployedProfile()
			reader := newReader(t, runner)
			req := readbackRequest()
			mutate(&req)
			if _, err := reader.ReadBackProfile(context.Background(), req); err == nil {
				t.Fatal("the readback accepted a request it cannot address")
			}
			if got := len(runner.steps()); got != 0 {
				t.Fatalf("the readback ran %d remote commands before refusing: %v", got, runner.steps())
			}
		})
	}
}

// TestReadbackKeepsSecretsOutOfErrors: a fact failure quotes the host's own output,
// so that output is sanitized before it can reach a job record.
func TestReadbackKeepsSecretsOutOfErrors(t *testing.T) {
	t.Parallel()
	const secret = "tskey-auth-k7Q2F9aZ3xLmN0pQrStU4vWxY"
	runner := deployedProfile()
	runner.answer("readback-serve", func(ports.SSMRunRequest) (ports.SSMRunResult, error) {
		return ports.SSMRunResult{Status: "Success", Stdout: "error: token " + secret + " rejected\n"}, nil
	})
	err := readbackError(t, runner)
	if err == nil {
		t.Fatal("the readback accepted a host with no Serve mapping")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("the error carries the host's credential: %v", err)
	}
}

// assertRefused proves one fact is load-bearing: the readback fails, the error is a
// profile-not-ready report naming that fact, and it is permanent, because a fact
// that does not hold does not start holding on a third attempt.
func assertRefused(t *testing.T, runner *profileRunner, fact string) {
	t.Helper()
	err := readbackError(t, runner)
	if err == nil {
		t.Fatalf("the readback accepted a host that fails %s", fact)
	}
	var notReady *domain.ProfileNotReadyError
	if !errors.As(err, &notReady) {
		t.Fatalf("error = %v, want a profile-not-ready report", err)
	}
	if notReady.Fact != fact {
		t.Fatalf("failed fact = %q, want %q", notReady.Fact, fact)
	}
	if notReady.HostID != "host-0001" {
		t.Fatalf("host id = %q", notReady.HostID)
	}
}

func readbackError(t *testing.T, runner *profileRunner) error {
	t.Helper()
	reader := newReader(t, runner)
	_, err := reader.ReadBackProfile(context.Background(), readbackRequest())
	return err
}
