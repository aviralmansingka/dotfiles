package ssm_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

const (
	instanceID    = "i-0123456789abcdef0"
	otherInstance = "i-0fedcba9876543210"
	hostName      = "rex-1"
	fakeAuthKey   = "tskey-auth-fake-0001"
	nonce         = "9f3c1d2b7a4e50618c9d3e2f1a0b7c4d"
	parameterPath = "/fleet/enroll/" + hostName + "/" + nonce
)

// nodeStatusJSON is the document `tailscale status --json` prints for a node that
// joined the approved tag.
const nodeStatusJSON = `{"Self":{"ID":"nABCDEF123","HostName":"` + hostName + `","Tags":["tag:aws-host"]}}`

// fakeParameters models the SSM Parameter Store side of the handoff. It records
// every value it was handed, so a test can prove the key arrived exactly once and
// that the same path was deleted again.
type fakeParameters struct {
	puts    []ports.SecureParameterRequest
	deletes []string
	// values is what each write actually carried, copied at call time. The Secret
	// the enroller passes is destroyed when the attempt ends, which erases the
	// buffer a stored Secret would still point at.
	values []string
	putErr error
	delErr error
}

var _ ports.SSMParameterStore = (*fakeParameters)(nil)

func (f *fakeParameters) PutSecureParameter(_ context.Context, req ports.SecureParameterRequest) error {
	if f.putErr != nil {
		return f.putErr
	}
	f.puts = append(f.puts, req)
	f.values = append(f.values, string(req.Value.Bytes()))
	return nil
}

func (f *fakeParameters) DeleteParameter(_ context.Context, name string) error {
	if f.delErr != nil {
		return f.delErr
	}
	f.deletes = append(f.deletes, name)
	return nil
}

// fakeAgent models the control plane's answer about a host's SSM agent.
type fakeAgent struct {
	status ports.SSMAgentStatus
	err    error
	calls  int
}

var _ ports.SSMAgentProbe = (*fakeAgent)(nil)

func onlineAgent() *fakeAgent {
	return &fakeAgent{status: ports.SSMAgentStatus{
		InstanceID: instanceID,
		PingStatus: "Online",
		Online:     true,
	}}
}

func (f *fakeAgent) AwaitRegistration(_ context.Context, _ string) (ports.SSMAgentStatus, error) {
	f.calls++
	if f.err != nil {
		return ports.SSMAgentStatus{}, f.err
	}
	return f.status, nil
}

// fakeHost models SSM Run Command together with the host behind it: it runs the
// script the adapter built, with fake `aws` and `tailscale` binaries on PATH, and
// records what those binaries observed. Nothing here reaches AWS.
//
// Two lines of the script necessarily differ from production, and only these two:
// the key path (the test cannot write /run) and the PATH assignment (the fakes
// live in a temporary directory). Everything the security tests care about —
// umask, chmod, the trap, the nonce check, the single redirect — runs verbatim.
type fakeHost struct {
	t       *testing.T
	bin     string
	seen    string
	keyPath string

	requests []ports.SSMRunRequest
	// mutate rewrites the result the control plane reports.
	mutate func(*ports.SSMRunResult)
	// failCommand makes the transport fail before the host runs anything.
	failCommand error

	// Observations from the last run.
	hostStdout    string
	hostStderr    string
	hostExit      int
	awsArgv       string
	tailscaleArgv string
	keyMode       os.FileMode
	keyContent    string
	keyRemoved    bool
}

var _ ports.SSMRunner = (*fakeHost)(nil)

func newFakeHost(t *testing.T) *fakeHost {
	t.Helper()
	bin := t.TempDir()
	seen := t.TempDir()
	if err := os.WriteFile(filepath.Join(seen, "status.json"), []byte(nodeStatusJSON), 0o600); err != nil {
		t.Fatalf("write status fixture: %v", err)
	}
	// The fake AWS CLI answers `get-parameter` with the enrollment key on stdout,
	// exactly as `aws ssm get-parameter --with-decryption --query Parameter.Value
	// --output text` does, and records its argv so a test can prove the value never
	// became an argument.
	writeFile(t, filepath.Join(bin, "aws"), `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_SEEN/aws-argv"
case "$*" in
  *"get-parameter"*) printf '%s\n' "$FAKE_KEY" ;;
  *) echo "fake aws: unexpected arguments: $*" >&2; exit 1 ;;
esac
`)
	// The fake Tailscale client copies the key file it was pointed at, so the test
	// can assert the mode and content the host really had a moment before the
	// script deleted it.
	writeFile(t, filepath.Join(bin, "tailscale"), `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_SEEN/tailscale-argv"
case "$1" in
  up)
    file=${2#--auth-key=file:}
    ls -l "$file" > "$FAKE_SEEN/key-ls" 2>&1
    cp -p "$file" "$FAKE_SEEN/key-copy" 2>/dev/null || true
    ;;
  status) cat "$FAKE_SEEN/status.json" ;;
  *) echo "fake tailscale: unexpected arguments: $*" >&2; exit 1 ;;
esac
`)
	return &fakeHost{t: t, bin: bin, seen: seen, keyPath: filepath.Join(t.TempDir(), "fleet-enroll.key")}
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o700); err != nil {
		t.Fatalf("write fake binary %s: %v", path, err)
	}
}

// RunCommand implements ports.SSMRunner.
func (h *fakeHost) RunCommand(ctx context.Context, req ports.SSMRunRequest) (ports.SSMRunResult, error) {
	h.requests = append(h.requests, req)
	if h.failCommand != nil {
		return ports.SSMRunResult{}, h.failCommand
	}

	result := ports.SSMRunResult{
		InstanceID: req.InstanceID,
		Comment:    req.Comment,
		Status:     "Success",
	}
	h.runScript(ctx, req.Command)

	result.ExitCode = h.hostExit
	result.Stdout = h.hostStdout
	result.Stderr = h.hostStderr
	if h.hostExit != 0 {
		result.Status = "Failed"
	}
	if h.mutate != nil {
		h.mutate(&result)
	}
	return result, nil
}

// runScript executes the built program against the fakes and records what the
// host observed while it ran.
func (h *fakeHost) runScript(ctx context.Context, script string) {
	script = strings.ReplaceAll(script, ssm.DefaultHostKeyPath, h.keyPath)
	script = replacePathLine(script, h.bin)

	command := exec.CommandContext(ctx, "/bin/sh", "-c", script)
	command.Env = append(os.Environ(),
		"FAKE_SEEN="+h.seen,
		"FAKE_KEY="+fakeAuthKey,
	)
	var stdout, stderr strings.Builder
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()

	h.hostStdout = stdout.String()
	h.hostStderr = stderr.String()
	h.hostExit = 0
	if exitErr, ok := err.(*exec.ExitError); ok {
		h.hostExit = exitErr.ExitCode()
	} else if err != nil {
		h.t.Fatalf("run host script: %v", err)
	}
	if data, readErr := os.ReadFile(filepath.Join(h.seen, "key-copy")); readErr == nil {
		h.keyContent = string(data)
		if info, statErr := os.Stat(filepath.Join(h.seen, "key-copy")); statErr == nil {
			h.keyMode = info.Mode().Perm()
		}
	}
	if data, readErr := os.ReadFile(filepath.Join(h.seen, "aws-argv")); readErr == nil {
		h.awsArgv = string(data)
	}
	if data, readErr := os.ReadFile(filepath.Join(h.seen, "tailscale-argv")); readErr == nil {
		h.tailscaleArgv = string(data)
	}
	_, statErr := os.Stat(h.keyPath)
	h.keyRemoved = os.IsNotExist(statErr)
}

// replacePathLine points the script's own PATH assignment at the fake binaries,
// keeping the system directories the fakes themselves need. This is the second of
// the two lines the offline simulation must rewrite; the rest of the program —
// `set +x`, `umask 077`, the trap, the nonce check, the single redirect, `chmod
// 600`, the removal and the absence check — runs exactly as it ships.
func replacePathLine(script, bin string) string {
	lines := strings.Split(script, "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "PATH='") {
			lines[i] = "PATH='" + bin + ":/usr/bin:/bin:/usr/sbin:/sbin'"
			break
		}
	}
	return strings.Join(lines, "\n")
}

// fixture is one enrollment's collaborators.
type fixture struct {
	params  *fakeParameters
	agent   *fakeAgent
	host    *fakeHost
	minter  *fakes.Minter
	logger  *fakes.Logger
	request ports.EnrollRequest
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	return &fixture{
		params: &fakeParameters{},
		agent:  onlineAgent(),
		host:   newFakeHost(t),
		minter: fakes.NewMinter(fakeAuthKey),
		logger: &fakes.Logger{},
		request: ports.EnrollRequest{
			HostID:         "host-0001",
			Name:           hostName,
			InstanceID:     instanceID,
			PrivateAddress: "10.0.1.23",
			Profile:        "rex",
			TailnetTag:     "tag:aws-host",
			KeyPolicy:      approvedPolicy(),
		},
	}
}

func (f *fixture) enroller(t *testing.T) *ssm.Enroller {
	t.Helper()
	enroller, err := ssm.NewEnroller(ssm.EnrollConfig{
		Runner:     f.host,
		Parameters: f.params,
		Agent:      f.agent,
		Minter:     f.minter,
		// A fixed nonce makes the parameter path assertable; production mints 128
		// random bits.
		Nonce:  func() (string, error) { return nonce, nil },
		Logger: f.logger,
	})
	if err != nil {
		t.Fatalf("NewEnroller: %v", err)
	}
	return enroller
}

// fakeExecutor records every AWS CLI invocation and answers from respond, so the
// adapter's exact argument arrays are asserted without a process or an account.
type fakeExecutor struct {
	calls []ssm.Command
	// respond answers one call; an error short-circuits.
	respond func(call int, cmd ssm.Command) (ssm.Result, error)
	// readFiles captures the content of every file:// argument before the adapter
	// deletes it.
	readFiles map[string]string
}

var _ ssm.Executor = (*fakeExecutor)(nil)

func (f *fakeExecutor) Exec(_ context.Context, cmd ssm.Command) (ssm.Result, error) {
	index := len(f.calls)
	f.calls = append(f.calls, cmd)
	if f.readFiles == nil {
		f.readFiles = map[string]string{}
	}
	for _, arg := range cmd.Args {
		if path, ok := strings.CutPrefix(arg, "file://"); ok {
			if data, err := os.ReadFile(path); err == nil {
				f.readFiles[path] = string(data)
			}
		}
	}
	if f.respond == nil {
		return ssm.Result{Stdout: "{}"}, nil
	}
	return f.respond(index, cmd)
}

// argv renders one recorded invocation's arguments for substring assertions.
func (f *fakeExecutor) argv(i int) string {
	return strings.Join(f.calls[i].Args, " ")
}
