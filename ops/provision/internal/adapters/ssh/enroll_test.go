package ssh_test

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssh"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

const (
	instanceID     = "i-0123456789abcdef0"
	otherInstance  = "i-0fedcba9876543210"
	privateAddress = "10.0.1.23"
	hostName       = "rex-1"
	fakeAuthKey    = "tskey-auth-fake-0001"
	remoteKeyPath  = "/run/fleet-enroll/auth-key"
)

// pinKey builds a syntactically valid ssh-ed25519 public key line from
// deterministic filler bytes. No real key material is generated or stored.
func pinKey(seed byte, comment string) string {
	blob := make([]byte, 0, 51)
	blob = binary.BigEndian.AppendUint32(blob, uint32(len("ssh-ed25519")))
	blob = append(blob, "ssh-ed25519"...)
	blob = binary.BigEndian.AppendUint32(blob, 32)
	for i := 0; i < 32; i++ {
		blob = append(blob, seed+byte(i))
	}
	line := "ssh-ed25519 " + base64.StdEncoding.EncodeToString(blob)
	if comment != "" {
		line += " " + comment
	}
	return line
}

// fakeSSM models the SSM control plane: IAM authorizes the call, and the reply
// echoes the instance id and correlation comment of the request.
type fakeSSM struct {
	mu       sync.Mutex
	requests []application.SSMRunRequest
	stdout   string
	mutate   func(*application.SSMRunResult)
	err      error
}

var _ application.SSMRunner = (*fakeSSM)(nil)

func (f *fakeSSM) RunCommand(_ context.Context, req application.SSMRunRequest) (application.SSMRunResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, req)
	if f.err != nil {
		return application.SSMRunResult{}, f.err
	}
	result := application.SSMRunResult{
		InstanceID: req.InstanceID,
		Comment:    req.Comment,
		Status:     "Success",
		ExitCode:   0,
		Stdout:     f.stdout,
	}
	if f.mutate != nil {
		f.mutate(&result)
	}
	return result, nil
}

func (f *fakeSSM) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

// fakeRemote models the host behind sshd. It enforces the pin the adapter asked
// for: the key the host presents must equal the entry in the dedicated
// known_hosts file, exactly as StrictHostKeyChecking=yes does. A mismatch fails
// before any stdin byte is consumed.
type fakeRemote struct {
	t *testing.T
	// presented is the host key the machine actually offers.
	presented string

	mu              sync.Mutex
	files           map[string]remoteFile
	calls           []application.SSHRunRequest
	stdinBytes      int
	hostKeyRejected bool
	knownHostsMode  os.FileMode
	knownHostsEntry string
	removals        []string
	joins           int
	reportedTags    []string
	joinExit        int
	joinStderr      string
	tailnet         *fakes.Tailnet
}

type remoteFile struct {
	content []byte
	mode    os.FileMode
}

var _ application.SSHRunner = (*fakeRemote)(nil)

func newFakeRemote(t *testing.T, presented string) *fakeRemote {
	return &fakeRemote{t: t, presented: presented, files: map[string]remoteFile{}, tailnet: fakes.NewTailnet()}
}

func (r *fakeRemote) Run(_ context.Context, req application.SSHRunRequest) (application.SSHRunResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, req)

	// 1. StrictHostKeyChecking=yes: the presented key must be the pinned one.
	knownHostsPath := argValue(req.Args, "UserKnownHostsFile=")
	if knownHostsPath == "" {
		r.t.Errorf("ssh argv has no UserKnownHostsFile: %v", req.Args)
		return application.SSHRunResult{ExitCode: 255, Stderr: "no known_hosts configured"}, nil
	}
	content, err := os.ReadFile(knownHostsPath)
	if err != nil {
		r.hostKeyRejected = true
		return application.SSHRunResult{ExitCode: 255, Stderr: "Host key verification failed: no known_hosts"}, nil
	}
	info, err := os.Stat(knownHostsPath)
	if err != nil {
		r.t.Errorf("stat known_hosts: %v", err)
	} else {
		r.knownHostsMode = info.Mode().Perm()
	}
	r.knownHostsEntry = strings.TrimSpace(string(content))
	if !sameKeyMaterial(r.knownHostsEntry, r.presented) {
		// Forged or changed host key: fail exactly as OpenSSH does, before reading
		// a single byte of stdin.
		r.hostKeyRejected = true
		return application.SSHRunResult{ExitCode: 255, Stderr: "Host key verification failed."}, nil
	}

	// 2. Only now does stdin travel.
	r.stdinBytes += len(req.Stdin)

	command := req.Args[len(req.Args)-1]
	switch {
	case strings.HasPrefix(command, "set +x; cat "):
		return application.SSHRunResult{Stdout: r.presented + "\n"}, nil
	case strings.HasPrefix(command, "set +x; umask 077"):
		remotePath := between(command, "cat > ", "; rc=")
		if remotePath == "" {
			return application.SSHRunResult{ExitCode: 1, Stderr: "malformed write command"}, nil
		}
		// The mode is derived from the command the adapter wrote, not assumed: a
		// command without umask 077 and chmod 600 would leave the file readable.
		mode := os.FileMode(0o666)
		if strings.Contains(command, "umask 077") {
			mode = 0o600
		}
		if idx := strings.Index(command, "chmod "); idx >= 0 {
			rest := command[idx+len("chmod "):]
			digits := rest[:strings.IndexByte(rest, ' ')]
			var parsed uint32
			if _, err := fmt.Sscanf(digits, "%o", &parsed); err == nil {
				mode = os.FileMode(parsed)
			}
		}
		r.files[remotePath] = remoteFile{content: append([]byte(nil), req.Stdin...), mode: mode}
		return application.SSHRunResult{}, nil
	case strings.Contains(command, "--auth-key=file:"):
		keyPath := between(command, "--auth-key=file:", " ")
		tag := between(command, "--advertise-tags=", " ")
		file, ok := r.files[keyPath]
		if !ok {
			return application.SSHRunResult{ExitCode: 1, Stderr: "auth key file is missing"}, nil
		}
		if file.mode != 0o600 {
			r.t.Errorf("key file mode = %04o, want 0600", file.mode)
		}
		if r.joinExit != 0 {
			return application.SSHRunResult{ExitCode: r.joinExit, Stderr: r.joinStderr}, nil
		}
		r.joins++
		tags := r.reportedTags
		if tags == nil {
			tags = []string{tag}
		}
		deviceID, err := r.tailnet.Join(hostName, tag, string(file.content))
		if err != nil {
			return application.SSHRunResult{ExitCode: 1, Stderr: err.Error()}, nil
		}
		status := map[string]any{"Self": map[string]any{
			"ID":       deviceID,
			"HostName": hostName,
			"Tags":     tags,
		}}
		encoded, _ := json.Marshal(status)
		return application.SSHRunResult{Stdout: string(encoded)}, nil
	case strings.HasPrefix(command, "set +x; rm -f"):
		remotePath := strings.TrimSpace(strings.TrimPrefix(command, "set +x; rm -f"))
		if _, ok := r.files[remotePath]; ok {
			delete(r.files, remotePath)
			r.removals = append(r.removals, req.Label+":"+remotePath)
		}
		return application.SSHRunResult{}, nil
	default:
		r.t.Errorf("unexpected remote command: %q", command)
		return application.SSHRunResult{ExitCode: 1, Stderr: "unexpected command"}, nil
	}
}

// sameKeyMaterial compares the type and body of two public key lines, ignoring
// address and comment, exactly as OpenSSH does when it checks known_hosts.
func sameKeyMaterial(knownHostsLine, presented string) bool {
	entry := strings.Fields(knownHostsLine)
	offered := strings.Fields(presented)
	if len(entry) < 3 || len(offered) < 2 {
		return false
	}
	return entry[1] == offered[0] && entry[2] == offered[1]
}

func argValue(args []string, prefix string) string {
	for _, arg := range args {
		if strings.HasPrefix(arg, prefix) {
			return strings.TrimPrefix(arg, prefix)
		}
	}
	return ""
}

func between(value, after, before string) string {
	start := strings.Index(value, after)
	if start < 0 {
		return ""
	}
	rest := value[start+len(after):]
	end := strings.Index(rest, before)
	if end < 0 {
		return ""
	}
	return rest[:end]
}

type fixture struct {
	ssm     *fakeSSM
	remote  *fakeRemote
	minter  *fakes.Minter
	logger  *fakes.Logger
	dir     string
	request application.EnrollRequest
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	key := pinKey(7, "root@ip-10-0-1-23")
	f := &fixture{
		ssm:    &fakeSSM{stdout: key},
		remote: newFakeRemote(t, key),
		minter: fakes.NewMinter(fakeAuthKey),
		logger: &fakes.Logger{},
		dir:    t.TempDir(),
	}
	f.request = application.EnrollRequest{
		HostID:         "host-0001",
		Name:           hostName,
		InstanceID:     instanceID,
		PrivateAddress: privateAddress,
		Profile:        "rex",
		TailnetTag:     domain.ApprovedTailnetTag,
		KeyPolicy:      domain.ApprovedAuthKeyPolicy(),
	}
	return f
}

func (f *fixture) enroller(t *testing.T) *ssh.Enroller {
	t.Helper()
	enroller, err := ssh.NewEnroller(ssh.EnrollConfig{
		Runner:        f.ssm,
		SSH:           f.remote,
		Minter:        f.minter,
		IdentityFile:  filepath.Join(f.dir, "bootstrap_ed25519"),
		KnownHostsDir: f.dir,
		RemoteKeyPath: remoteKeyPath,
		Logger:        f.logger,
		Clock:         fakes.NewClock(),
	})
	if err != nil {
		t.Fatalf("NewEnroller: %v", err)
	}
	return enroller
}

// TestEnrollmentPinsKeyDeliversOverStdinAndJoinsApprovedTag is the happy path:
// the pinned key is the one the host presents, the key travels over stdin into a
// 0600 file, the node joins under the approved tag, and the file is removed.
func TestEnrollmentPinsKeyDeliversOverStdinAndJoinsApprovedTag(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	result, err := f.enroller(t).Enroll(context.Background(), f.request)
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if result.DeviceID == "" {
		t.Fatal("enrollment reported no device id")
	}
	if !strings.HasPrefix(result.HostKey, "SHA256:") {
		t.Fatalf("host key = %q, want a SHA256 fingerprint", result.HostKey)
	}
	if result.TailnetTag != domain.ApprovedTailnetTag {
		t.Fatalf("tailnet tag = %q, want %q", result.TailnetTag, domain.ApprovedTailnetTag)
	}

	// The host key was fetched with the documented command.
	if f.ssm.callCount() != 1 {
		t.Fatalf("SSM calls = %d, want 1", f.ssm.callCount())
	}
	if got := f.ssm.requests[0].Command; !strings.Contains(got, "cat /etc/ssh/ssh_host_ed25519_key.pub") {
		t.Fatalf("SSM command = %q, want the host public key cat", got)
	}
	if got := f.ssm.requests[0].Command; !strings.Contains(got, "set +x") {
		t.Fatalf("SSM command = %q, want shell tracing disabled", got)
	}

	// The dedicated known_hosts file is private and pinned to the fetched key.
	if f.remote.knownHostsMode != 0o600 {
		t.Fatalf("known_hosts mode = %04o, want 0600", f.remote.knownHostsMode)
	}
	if !strings.HasPrefix(f.remote.knownHostsEntry, privateAddress+" ssh-ed25519 ") {
		t.Fatalf("known_hosts entry = %q, want the pinned key for %s", f.remote.knownHostsEntry, privateAddress)
	}

	// Every invocation pins the host key: no accept-new, no keyscan-only trust.
	for _, call := range f.remote.calls {
		if argValue(call.Args, "StrictHostKeyChecking=") != "yes" {
			t.Fatalf("%s: StrictHostKeyChecking = %q, want yes", call.Label, argValue(call.Args, "StrictHostKeyChecking="))
		}
		for _, arg := range call.Args {
			if strings.Contains(arg, "accept-new") {
				t.Fatalf("%s: argv contains accept-new: %v", call.Label, call.Args)
			}
		}
	}

	// The write command asks for a private file before a byte is written.
	var writeCommand string
	for _, call := range f.remote.calls {
		if call.Label == "deliver-enrollment-key" {
			writeCommand = call.Args[len(call.Args)-1]
		}
	}
	if !strings.Contains(writeCommand, "umask 077") || !strings.Contains(writeCommand, "chmod 600") {
		t.Fatalf("write command does not set a private mode: %q", writeCommand)
	}
	if strings.Contains(writeCommand, "set -x") {
		t.Fatalf("write command must disable shell tracing, not enable it: %q", writeCommand)
	}

	// The key reached the remote exactly once, over stdin, into a 0600 file.
	if f.remote.stdinBytes != len(fakeAuthKey) {
		t.Fatalf("stdin bytes = %d, want exactly the %d-byte key", f.remote.stdinBytes, len(fakeAuthKey))
	}
	if len(f.remote.files) != 0 {
		t.Fatalf("key file still present after enrollment: %v", f.remote.files)
	}
	if len(f.remote.removals) != 1 || !strings.HasPrefix(f.remote.removals[0], "remove-enrollment-key:") {
		t.Fatalf("removals = %v, want one removal by the cleanup step", f.remote.removals)
	}
	if f.remote.joins != 1 {
		t.Fatalf("joins = %d, want 1", f.remote.joins)
	}

	// The device joined under the approved tag, once.
	devices := f.remote.tailnet.Devices()
	if len(devices) != 1 {
		t.Fatalf("devices = %d, want 1", len(devices))
	}
	if devices[0].Name != hostName {
		t.Fatalf("device name = %q, want %q", devices[0].Name, hostName)
	}
	if !devices[0].HasTag(domain.ApprovedTailnetTag) {
		t.Fatalf("device tags = %v, want %q", devices[0].Tags, domain.ApprovedTailnetTag)
	}

	// Nothing key-shaped reached a log line.
	for _, line := range f.logger.Lines() {
		if strings.Contains(line, fakeAuthKey) {
			t.Fatalf("log line leaked the enrollment key: %s", line)
		}
	}
}

// TestForgedHostKeyAbortsBeforeAnySecretByte is the acceptance criterion: every
// way a host key can be forged or mismatched must abort before a secret exists.
func TestForgedHostKeyAbortsBeforeAnySecretByte(t *testing.T) {
	t.Parallel()
	cases := map[string]func(*fakeSSM){
		"reply names another instance": func(s *fakeSSM) {
			s.mutate = func(r *application.SSMRunResult) { r.InstanceID = otherInstance }
		},
		"reply comment does not match": func(s *fakeSSM) {
			s.mutate = func(r *application.SSMRunResult) { r.Comment = otherInstance }
		},
		"command status is not success": func(s *fakeSSM) {
			s.mutate = func(r *application.SSMRunResult) { r.Status = "Failed" }
		},
		"non-zero exit code": func(s *fakeSSM) {
			s.mutate = func(r *application.SSMRunResult) { r.ExitCode = 1 }
		},
		"missing key": func(s *fakeSSM) {
			s.mutate = func(r *application.SSMRunResult) { r.Stdout = "\n" }
		},
		"key belongs to another instance": func(s *fakeSSM) {
			s.mutate = func(r *application.SSMRunResult) {
				r.Stdout = pinKey(9, "root@"+otherInstance) + "\n"
			}
		},
		"private key instead of public": func(s *fakeSSM) {
			s.mutate = func(r *application.SSMRunResult) {
				r.Stdout = "-----BEGIN OPENSSH PRIVATE KEY-----\n"
			}
		},
	}
	for name, mutate := range cases {
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newFixture(t)
			mutate(f.ssm)
			if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
				t.Fatal("forged host key must abort enrollment")
			}
			if f.minter.MintCount() != 0 {
				t.Fatalf("mints = %d, want 0: no key may be minted before the host key is trusted", f.minter.MintCount())
			}
			if len(f.remote.calls) != 0 {
				t.Fatalf("ssh calls = %d, want 0", len(f.remote.calls))
			}
			if f.remote.stdinBytes != 0 {
				t.Fatalf("stdin bytes = %d, want 0", f.remote.stdinBytes)
			}
			if len(f.remote.files) != 0 {
				t.Fatalf("remote files = %v, want none", f.remote.files)
			}
		})
	}
}

// TestChangedHostKeyBetweenFetchAndDeliveryFailsClosed models a host that swaps
// its key after the SSM read. StrictHostKeyChecking=yes refuses the connection,
// and the key file is never written.
func TestChangedHostKeyBetweenFetchAndDeliveryFailsClosed(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	// The machine now presents a different key than the one SSM returned.
	f.remote.presented = pinKey(11, "root@ip-10-0-1-23")
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
		t.Fatal("a changed host key must abort enrollment")
	}
	if !f.remote.hostKeyRejected {
		t.Fatal("the fake host never rejected the connection; known_hosts was not enforced")
	}
	if f.remote.stdinBytes != 0 {
		t.Fatalf("stdin bytes = %d, want 0: no secret byte may be written to an unverified host", f.remote.stdinBytes)
	}
	if len(f.remote.files) != 0 {
		t.Fatalf("remote files = %v, want none", f.remote.files)
	}
	if f.remote.joins != 0 {
		t.Fatalf("joins = %d, want 0", f.remote.joins)
	}
}

// TestEnrollmentKeyFileIsRemovedOnTheErrorPath proves the cleanup step deletes the
// key file when the join fails.
func TestEnrollmentKeyFileIsRemovedOnTheErrorPath(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	f.remote.joinExit = 1
	f.remote.joinStderr = "backend error: key already used"
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
		t.Fatal("a failed join must fail enrollment")
	}
	if len(f.remote.files) != 0 {
		t.Fatalf("key file still present after a failed join: %v", f.remote.files)
	}
	if len(f.remote.removals) != 1 || !strings.HasPrefix(f.remote.removals[0], "remove-enrollment-key:") {
		t.Fatalf("removals = %v, want one removal by the cleanup step", f.remote.removals)
	}
}

// TestJoinReportsTheApprovedTagOrFails proves the node's own report is checked:
// a node that comes up under another tag fails the enrollment.
func TestJoinReportsTheApprovedTagOrFails(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	f.remote.reportedTags = []string{"tag:some-other-fleet"}
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err == nil {
		t.Fatal("a node reporting a tag other than the approved one must fail enrollment")
	}
}

// TestNoKeyMaterialInArgvOrLogs proves the delivery channel is stdin only: no
// argv word and no log line carries the key.
func TestNoKeyMaterialInArgvOrLogs(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	if _, err := f.enroller(t).Enroll(context.Background(), f.request); err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	for _, call := range f.remote.calls {
		for _, arg := range call.Args {
			if strings.Contains(arg, fakeAuthKey) {
				t.Fatalf("%s: argv contains key material: %v", call.Label, call.Args)
			}
		}
		if strings.Contains(call.Label, fakeAuthKey) {
			t.Fatalf("label contains key material: %q", call.Label)
		}
	}
	// The one place a key may appear is the stdin of the write step, and the
	// join step references the file, not the value.
	var joinArgv []string
	for _, call := range f.remote.calls {
		if call.Label == "join-tailnet" {
			joinArgv = call.Args
		}
	}
	if joinArgv == nil {
		t.Fatal("join step did not run")
	}
	if !strings.Contains(strings.Join(joinArgv, " "), "--auth-key=file:"+remoteKeyPath) {
		t.Fatalf("join argv = %v, want --auth-key=file:%s", joinArgv, remoteKeyPath)
	}
	// The join step also removes the key before the cleanup step runs, so a lost
	// session cannot leave it behind.
	if !strings.Contains(strings.Join(joinArgv, " "), "rm -f "+remoteKeyPath) {
		t.Fatalf("join argv = %v, want an inline removal of %s", joinArgv, remoteKeyPath)
	}
	for _, line := range f.logger.Lines() {
		if strings.Contains(line, fakeAuthKey) {
			t.Fatalf("log line leaked the enrollment key: %s", line)
		}
	}
}

// TestEnrollmentRejectsAnUnapprovedTagOrAddress proves the enroller refuses input
// that would be interpolated into a remote command.
func TestEnrollmentRejectsAnUnapprovedTagOrAddress(t *testing.T) {
	t.Parallel()
	cases := map[string]func(*application.EnrollRequest){
		"unapproved tag":       func(r *application.EnrollRequest) { r.TailnetTag = "tag:some-other-fleet" },
		"empty tag":            func(r *application.EnrollRequest) { r.TailnetTag = "" },
		"loopback address":     func(r *application.EnrollRequest) { r.PrivateAddress = "127.0.0.1" },
		"public address":       func(r *application.EnrollRequest) { r.PrivateAddress = "203.0.113.9" },
		"malformed instance":   func(r *application.EnrollRequest) { r.InstanceID = "i-0123;id" },
		"host name with slash": func(r *application.EnrollRequest) { r.Name = "rex/1" },
	}
	for name, mutate := range cases {
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newFixture(t)
			request := f.request
			mutate(&request)
			if _, err := f.enroller(t).Enroll(context.Background(), request); err == nil {
				t.Fatal("invalid input must be refused")
			}
			if f.ssm.callCount() != 0 || len(f.remote.calls) != 0 {
				t.Fatal("invalid input must be refused before any I/O")
			}
		})
	}
}

// TestKnownHostsFileIsPerEnrollmentAndPrivate proves the pinned file is fresh for
// each enrollment and never reused, so trust cannot be inherited.
func TestKnownHostsFileIsPerEnrollmentAndPrivate(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	enroller := f.enroller(t)
	if _, err := enroller.Enroll(context.Background(), f.request); err != nil {
		t.Fatalf("first Enroll: %v", err)
	}
	first := f.remote.knownHostsEntry
	firstPath := argValue(f.remote.calls[0].Args, "UserKnownHostsFile=")
	if _, err := os.Stat(filepath.Dir(firstPath)); !os.IsNotExist(err) {
		t.Fatalf("known_hosts directory %s survived the enrollment: %v", filepath.Dir(firstPath), err)
	}
	if first == "" {
		t.Fatal("no known_hosts entry was read")
	}
	// Every enrollment writes its own file: nothing from the first run is reused.
	paths := map[string]bool{}
	for _, call := range f.remote.calls {
		paths[argValue(call.Args, "UserKnownHostsFile=")] = true
	}
	if len(paths) != 1 {
		t.Fatalf("known_hosts paths = %v, want one per enrollment", paths)
	}
}

// TestEnrollmentCredentialNeverReachesAResultOrPayload covers the "credentials
// never enter Terraform state or logs" half of the criterion for everything the
// enrollment step produces: the result, the workflow payload that is persisted in
// execution state, the pinned known_hosts entry, and every log line.
//
// Terraform never sees the enrollment key at all: the provider adapter builds its
// variables from application.ProviderCreateRequest, which has no credential field,
// and the enrollment runs after the apply with an instance id as its only input.
func TestEnrollmentCredentialNeverReachesAResultOrPayload(t *testing.T) {
	t.Parallel()
	f := newFixture(t)
	result, err := f.enroller(t).Enroll(context.Background(), f.request)
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if strings.Contains(string(resultJSON), fakeAuthKey) {
		t.Fatalf("enrollment result carries key material: %s", resultJSON)
	}

	payload := workflows.EnrollHostOutput{
		DeviceID:           result.DeviceID,
		HostKeyFingerprint: result.HostKey,
		TailnetTag:         result.TailnetTag,
		Resumed:            result.Resumed,
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal workflow payload: %v", err)
	}
	if strings.Contains(string(payloadJSON), fakeAuthKey) {
		t.Fatalf("workflow payload carries key material: %s", payloadJSON)
	}
	if !strings.Contains(string(payloadJSON), "SHA256:") {
		t.Fatalf("workflow payload = %s, want the host key fingerprint", payloadJSON)
	}
	if strings.Contains(f.remote.knownHostsEntry, fakeAuthKey) {
		t.Fatal("the known_hosts entry carries key material")
	}
	for _, line := range f.logger.Lines() {
		if strings.Contains(line, fakeAuthKey) {
			t.Fatalf("log line carries key material: %s", line)
		}
	}
}
