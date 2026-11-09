package ssm_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

func approvedPolicy() domain.AuthKeyPolicy { return domain.ApprovedAuthKeyPolicy() }

// TestEnrollmentStoresOneSecureParameterDeletesItAndJoins is the happy path: the
// agent is checked first, one key is minted, it is stored at
// <prefix>/<host>/<nonce>, one command delivers it, the node joins the approved
// tag, and the parameter is deleted again.
func TestEnrollmentStoresOneSecureParameterDeletesItAndJoins(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	result, err := f.enroller(t).Enroll(context.Background(), f.request)
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if result.DeviceID != "nABCDEF123" {
		t.Fatalf("device id = %q, want the id the host reported", result.DeviceID)
	}
	if result.TailnetTag != domain.ApprovedTailnetTag {
		t.Fatalf("tailnet tag = %q, want %q", result.TailnetTag, domain.ApprovedTailnetTag)
	}

	// One agent check, before anything else.
	if f.agent.calls != 1 {
		t.Fatalf("agent checks = %d, want 1", f.agent.calls)
	}
	// One key, minted once, with the approved policy.
	if f.minter.MintCount() != 1 {
		t.Fatalf("mints = %d, want 1", f.minter.MintCount())
	}
	if got := f.minter.Requests()[0].Tag; got != domain.ApprovedTailnetTag {
		t.Fatalf("mint tag = %q, want %q", got, domain.ApprovedTailnetTag)
	}
	// One parameter, at the path the instance role is scoped to.
	if len(f.params.puts) != 1 {
		t.Fatalf("parameter writes = %d, want 1", len(f.params.puts))
	}
	if got := f.params.puts[0].Name; got != parameterPath {
		t.Fatalf("parameter name = %q, want %q", got, parameterPath)
	}
	if got := f.params.values[0]; got != fakeAuthKey {
		t.Fatalf("parameter value is not the minted key")
	}
	// One command, delivered by instance id, carrying the path and not the key.
	if len(f.host.requests) != 1 {
		t.Fatalf("run commands = %d, want 1", len(f.host.requests))
	}
	command := f.host.requests[0]
	if command.InstanceID != instanceID {
		t.Fatalf("command instance = %q, want %q: enrollment is addressed by id, never by tag", command.InstanceID, instanceID)
	}
	if command.Comment != instanceID {
		t.Fatalf("command comment = %q, want the correlation token %q", command.Comment, instanceID)
	}
	for _, required := range []string{"set +x", "umask 077", "chmod 600", `--auth-key="file:$KEY"`, parameterPath, nonce} {
		if !strings.Contains(command.Command, required) {
			t.Fatalf("host command is missing %q", required)
		}
	}
	// And the parameter is gone again.
	if len(f.params.deletes) != 1 || f.params.deletes[0] != parameterPath {
		t.Fatalf("parameter deletions = %v, want exactly %q", f.params.deletes, parameterPath)
	}
}

// TestEnrollmentKeyNeverAppearsInParametersCommentsOrOutput is the reason the
// handoff goes through Parameter Store at all: SSM command history keeps the
// command parameters, the comment, and the invocation output, so none of them may
// contain the key.
func TestEnrollmentKeyNeverAppearsInParametersCommentsOrOutput(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err != nil {
		t.Fatalf("Enroll: %v", err)
	}

	for i, call := range f.host.requests {
		if strings.Contains(call.Command, fakeAuthKey) {
			t.Fatalf("command %d carries the enrollment key in its parameters", i)
		}
		if strings.Contains(call.Comment, fakeAuthKey) {
			t.Fatalf("command %d carries the enrollment key in its comment", i)
		}
		if !strings.Contains(call.Command, parameterPath) {
			t.Fatalf("command %d does not carry the parameter path, so history would hold nothing useful", i)
		}
	}
	// The host's own AWS CLI argv is the other place a value could leak.
	if strings.Contains(f.host.awsArgv, fakeAuthKey) {
		t.Fatalf("the host's aws argv carries the key: %q", f.host.awsArgv)
	}
	// The host prints no key: what the worker receives as output is node status.
	if strings.Contains(f.host.hostStdout, fakeAuthKey) {
		t.Fatalf("the host printed the key on stdout")
	}
	if strings.Contains(f.host.hostStderr, fakeAuthKey) {
		t.Fatalf("the host printed the key on stderr")
	}
	// Nor do the service's own logs.
	for _, line := range f.logger.Lines() {
		if strings.Contains(line, fakeAuthKey) {
			t.Fatalf("a log line carries the key: %q", line)
		}
	}
}

// TestParameterIsDeletedOnSuccessAndOnFailure covers both cleanup paths. A
// parameter that outlived a failed attempt would be a live credential sitting in
// Parameter Store with nothing left to use it.
func TestParameterIsDeletedOnSuccessAndOnFailure(t *testing.T) {
	t.Parallel()
	// A failed join: the host script exits non-zero and reports failure.
	t.Run("join failure", func(t *testing.T) {
		t.Parallel()
		f := newFixture(t)
		f.host.mutate = func(result *application.SSMRunResult) {
			result.Status = "Failed"
			result.ExitCode = 1
			result.Stderr = "tailscale up: backend error: invalid key"
		}
		if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
			t.Fatal("Enroll must fail when the join fails")
		}
		if len(f.params.deletes) != 1 || f.params.deletes[0] != parameterPath {
			t.Fatalf("parameter deletions = %v, want exactly %q on the failure path", f.params.deletes, parameterPath)
		}
	})

	// A transport failure after the parameter exists.
	t.Run("transport failure", func(t *testing.T) {
		t.Parallel()
		f := newFixture(t)
		f.host.failCommand = errors.New("ssm send-command: throttled")
		if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
			t.Fatal("Enroll must fail when the transport fails")
		}
		if len(f.params.deletes) != 1 || f.params.deletes[0] != parameterPath {
			t.Fatalf("parameter deletions = %v, want exactly %q after a transport failure", f.params.deletes, parameterPath)
		}
	})

	// A failure while interpreting the answer, after the command ran.
	t.Run("unreadable answer", func(t *testing.T) {
		t.Parallel()
		f := newFixture(t)
		f.host.mutate = func(result *application.SSMRunResult) {
			result.Stdout = "not json"
		}
		if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
			t.Fatal("Enroll must fail when the host reports no node status")
		}
		if len(f.params.deletes) != 1 || f.params.deletes[0] != parameterPath {
			t.Fatalf("parameter deletions = %v, want exactly %q after an unreadable answer", f.params.deletes, parameterPath)
		}
	})
}

// TestDeletionFailureAfterSuccessFailsTheEnrollment: a parameter that cannot be
// deleted is a live credential, so the attempt must not be reported as a success.
func TestDeletionFailureAfterSuccessFailsTheEnrollment(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	f.params.delErr = errors.New("ssm delete-parameter: access denied")
	_, err := f.enroller(t).Enroll(context.Background(), f.request)
	if err == nil {
		t.Fatal("Enroll must fail when the parameter cannot be deleted")
	}
	if !strings.Contains(err.Error(), "delete") {
		t.Fatalf("error does not name the failed deletion: %v", err)
	}
}

// TestEnrollmentAbortsBeforeMintingWhenTheAgentNeverRegisters is the fail-closed
// rule: no registered agent means no transport, so nothing is minted, nothing is
// stored, and no command is attempted.
func TestEnrollmentAbortsBeforeMintingWhenTheAgentNeverRegisters(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	f.agent.err = &domain.AgentNotRegisteredError{
		InstanceID: instanceID,
		Waited:     240 * 1e9,
		PingStatus: "ConnectionLost",
	}
	_, err := f.enroller(t).Enroll(context.Background(), f.request)
	if err == nil {
		t.Fatal("Enroll must fail when the agent never registers")
	}
	var notRegistered *domain.AgentNotRegisteredError
	if !errors.As(err, &notRegistered) {
		t.Fatalf("error does not wrap AgentNotRegisteredError: %v", err)
	}
	if f.minter.MintCount() != 0 {
		t.Fatalf("mints = %d, want 0: a key must not exist before the agent does", f.minter.MintCount())
	}
	if len(f.params.puts) != 0 {
		t.Fatalf("parameter writes = %d, want 0", len(f.params.puts))
	}
	if len(f.params.deletes) != 0 {
		t.Fatalf("parameter deletions = %d, want 0: there was nothing to delete", len(f.params.deletes))
	}
	if len(f.host.requests) != 0 {
		t.Fatalf("run commands = %d, want 0: an unregistered agent cannot run one", len(f.host.requests))
	}
	// The job layer reports it as a permanent failure, not something to retry.
	jobErr := application.SanitizeError(err)
	if jobErr.Retryable {
		t.Fatal("an unregistered agent must be a non-retryable job failure")
	}
	if jobErr.Code != application.CodeAgentUnavailable {
		t.Fatalf("job error code = %q, want %q", jobErr.Code, application.CodeAgentUnavailable)
	}
}

// TestHostScriptWritesAPrivateKeyFileAndRemovesIt runs the built program for real
// against fake aws and tailscale binaries: the file the join reads is 0600, holds
// exactly the minted key, and is gone when the command returns.
func TestHostScriptWritesAPrivateKeyFileAndRemovesIt(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if f.host.keyContent != fakeAuthKey {
		t.Fatalf("the join read %q, want exactly the minted key", f.host.keyContent)
	}
	if f.host.keyMode != 0o600 {
		t.Fatalf("key file mode = %04o, want 0600", f.host.keyMode)
	}
	if !f.host.keyRemoved {
		t.Fatalf("key file still present at %s after the command", f.host.keyPath)
	}
	// The join is what receives the key, as a file: reference.
	if !strings.Contains(f.host.tailscaleArgv, "--auth-key=file:") {
		t.Fatalf("the join did not get a file: reference: %q", f.host.tailscaleArgv)
	}
	if strings.Contains(f.host.tailscaleArgv, fakeAuthKey) {
		t.Fatalf("the key reached the join's argv: %q", f.host.tailscaleArgv)
	}
}

// TestHostScriptRemovesTheKeyFileWhenTheJoinFails proves the trap, not just the
// happy path: a failed join must not leave a readable key behind.
func TestHostScriptRemovesTheKeyFileWhenTheJoinFails(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	// Make the join fail by pointing the fake tailscale at a missing status file
	// is not enough: replace the binary's `up` handler with a refusal.
	writeFile(t, f.host.bin+"/tailscale", `#!/bin/sh
case "$1" in
  up) exit 1 ;;
  status) exit 1 ;;
esac
`)
	f.host.mutate = nil
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
		t.Fatal("Enroll must fail when the join fails")
	}
	if !f.host.keyRemoved {
		t.Fatalf("key file still present at %s after a failed join", f.host.keyPath)
	}
}

// TestEnrollmentRefusesAReplyFromAnotherInstance: the correlation token is the
// instance id, so an answer for a different host is never accepted.
func TestEnrollmentRefusesAReplyFromAnotherInstance(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	f.host.mutate = func(result *application.SSMRunResult) { result.InstanceID = otherInstance }
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
		t.Fatal("Enroll must refuse a reply from another instance")
	}
	if len(f.params.deletes) != 1 {
		t.Fatalf("parameter deletions = %v, want the cleanup to still run", f.params.deletes)
	}
}

// TestEnrollmentRefusesANodeThatJoinedWithAnotherTag: the tag is resolved
// server-side, so a node reporting anything else is a failed enrollment.
func TestEnrollmentRefusesANodeThatJoinedWithAnotherTag(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	writeFile(t, f.host.seen+"/status.json",
		`{"Self":{"ID":"nABCDEF123","HostName":"`+hostName+`","Tags":["tag:something-else"]}}`)
	_, err := f.enroller(t).Enroll(context.Background(), f.request)
	if err == nil {
		t.Fatal("Enroll must fail when the node did not join the approved tag")
	}
	if !strings.Contains(err.Error(), domain.ApprovedTailnetTag) {
		t.Fatalf("error does not name the approved tag: %v", err)
	}
}

// TestEnrollmentRejectsAnUnapprovedRequest covers the values interpolated into
// the host program. Each one is refused before any I/O.
func TestEnrollmentRejectsAnUnapprovedRequest(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*application.EnrollRequest)
	}{
		{"unapproved tag", func(r *application.EnrollRequest) { r.TailnetTag = "tag:other" }},
		{"malformed tag", func(r *application.EnrollRequest) { r.TailnetTag = "aws-host" }},
		{"host name with a shell word", func(r *application.EnrollRequest) { r.Name = "rex; rm -rf /" }},
		{"instance id that is not one", func(r *application.EnrollRequest) { r.InstanceID = "rex-1" }},
		{"missing host id", func(r *application.EnrollRequest) { r.HostID = "" }},
		{"weakened key policy", func(r *application.EnrollRequest) { r.KeyPolicy.Reusable = true }},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newFixture(t)
			tc.mutate(&f.request)
			_, err := f.enroller(t).Enroll(context.Background(), f.request)
			if err == nil {
				t.Fatal("Enroll must refuse the request")
			}
			var invalid *domain.ValidationError
			if !errors.As(err, &invalid) {
				t.Fatalf("error is not a validation error: %v", err)
			}
			if f.agent.calls != 0 || f.minter.MintCount() != 0 || len(f.host.requests) != 0 {
				t.Fatal("a refused request must not reach the control plane")
			}
		})
	}
}

// TestHostScriptRefusesAParameterWithoutTheNonce is the replay guard: the command
// names a parameter and a nonce, and the host refuses a path that does not carry
// that nonce.
func TestHostScriptRefusesAParameterWithoutTheNonce(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	script, err := ssm.Script(ssm.ScriptOptions{
		ParameterName: "/fleet/enroll/" + hostName + "/someothernonce",
		Nonce:         nonce,
		Region:        ssm.DefaultRegion,
		HostKeyPath:   ssm.DefaultHostKeyPath,
		HostName:      hostName,
		Tag:           domain.ApprovedTailnetTag,
	})
	if err != nil {
		t.Fatalf("Script: %v", err)
	}
	f.host.runScript(context.Background(), script)
	if f.host.hostExit == 0 {
		t.Fatal("the host must refuse a parameter path that does not carry the nonce")
	}
	if f.host.keyContent != "" {
		t.Fatal("the host wrote a key file from a parameter it should have refused")
	}
	if !strings.Contains(f.host.hostStderr, "nonce") {
		t.Fatalf("the refusal does not name the nonce: %q", f.host.hostStderr)
	}
}

// TestScriptRefusesValuesThatWouldNotStayOneShellWord covers the builder's own
// validation, which runs even when a caller skips the enroller.
func TestScriptRefusesValuesThatWouldNotStayOneShellWord(t *testing.T) {
	t.Parallel()
	base := ssm.ScriptOptions{
		ParameterName: parameterPath,
		Nonce:         nonce,
		Region:        ssm.DefaultRegion,
		HostKeyPath:   ssm.DefaultHostKeyPath,
		HostName:      hostName,
		Tag:           domain.ApprovedTailnetTag,
	}
	cases := []struct {
		name   string
		mutate func(*ssm.ScriptOptions)
	}{
		{"parameter name with a quote", func(o *ssm.ScriptOptions) { o.ParameterName = "/fleet/enroll/rex'1/" + nonce }},
		{"nonce with a quote", func(o *ssm.ScriptOptions) { o.Nonce = "abc'def" }},
		{"host name with a space", func(o *ssm.ScriptOptions) { o.HostName = "rex 1" }},
		{"unapproved tag", func(o *ssm.ScriptOptions) { o.Tag = "tag:other" }},
		{"key path off tmpfs", func(o *ssm.ScriptOptions) { o.HostKeyPath = "/tmp/fleet-enroll.key" }},
		{"key path with a semicolon", func(o *ssm.ScriptOptions) { o.HostKeyPath = "/run/fleet-enroll.key;touch /tmp/pwned" }},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			opts := base
			tc.mutate(&opts)
			if _, err := ssm.Script(opts); err == nil {
				t.Fatal("Script must refuse the option")
			}
		})
	}
}

// TestNewEnrollerRequiresEveryCollaborator keeps a half-wired chain from starting.
func TestNewEnrollerRequiresEveryCollaborator(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	full := ssm.EnrollConfig{
		Runner:     f.host,
		Parameters: f.params,
		Agent:      f.agent,
		Minter:     f.minter,
		Logger:     f.logger,
	}
	cases := map[string]func(*ssm.EnrollConfig){
		"no transport":   func(c *ssm.EnrollConfig) { c.Runner = nil },
		"no parameters":  func(c *ssm.EnrollConfig) { c.Parameters = nil },
		"no agent probe": func(c *ssm.EnrollConfig) { c.Agent = nil },
		"no minter":      func(c *ssm.EnrollConfig) { c.Minter = nil },
		"no logger":      func(c *ssm.EnrollConfig) { c.Logger = nil },
		"key off tmpfs":  func(c *ssm.EnrollConfig) { c.HostKeyPath = "/tmp/fleet-enroll.key" },
		"bad prefix":     func(c *ssm.EnrollConfig) { c.ParameterPrefix = "fleet/enroll" },
		"bad region":     func(c *ssm.EnrollConfig) { c.Region = "mars-north-1" },
	}
	for name, mutate := range cases {
		cfg := full
		mutate(&cfg)
		if _, err := ssm.NewEnroller(cfg); err == nil {
			t.Fatalf("%s: NewEnroller must refuse the configuration", name)
		}
	}
	if _, err := ssm.NewEnroller(full); err != nil {
		t.Fatalf("NewEnroller refused a complete configuration: %v", err)
	}
}

// TestStubRefusesEnrollmentAndTheAgentCheck keeps the not-configured fallback
// honest: it refuses, and it never reports a host as enrolled.
func TestStubRefusesEnrollmentAndTheAgentCheck(t *testing.T) {
	t.Parallel()
	stub := ssm.NewStub()
	if _, err := stub.Enroll(context.Background(), application.EnrollRequest{}); err == nil {
		t.Fatal("the stub must refuse enrollment")
	}
	if _, err := stub.AwaitRegistration(context.Background(), instanceID); err == nil {
		t.Fatal("the stub must refuse the agent check")
	}
	var notImplemented *domain.NotImplementedError
	if _, err := stub.Enroll(context.Background(), application.EnrollRequest{}); !errors.As(err, &notImplemented) {
		t.Fatalf("the refusal is not a NotImplementedError: %v", err)
	}
	if jobErr := application.SanitizeError(&domain.NotImplementedError{Component: "ssm enrollment"}); jobErr.Retryable {
		t.Fatal("a missing enrollment must be a non-retryable job failure")
	}
}
