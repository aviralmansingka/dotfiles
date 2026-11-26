package ssm_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// The profile-side fixtures. Nothing here reaches AWS: profileRunner is a scripted
// control plane that records every program it was asked to run, so a test asserts
// the exact sequence of steps, the exact argument array of each one, and the effect
// of a single wrong answer.

const (
	// deployRevision is the commit the fake host resolves the approved flake target
	// to. A deploy records this value; the readback reports it.
	deployRevision = "9f3c1d2b7a4e50618c9d3e2f1a0b7c4d9e8f7a6b"
	// otherRevision is a second commit: the one a host that was left on an older
	// generation reports.
	otherRevision = "0a1b2c3d4e5f60718293a4b5c6d7e8f900112233"
	// flakeRef is a fully qualified, deployable target. A relative reference is
	// refused before any remote call, because a host has no checkout to resolve it
	// against.
	flakeRef = "github:aviralmansingka/dotfiles/" + deployRevision + "#homeConfigurations.remote-mumbai.activationPackage"
	// rexStorePath is where the fake profile put the rex binary.
	rexStorePath = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-home-manager-generation/home-path/bin/rex"
	// olderRexStorePath is the binary of an older generation.
	olderRexStorePath = "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-home-manager-generation/home-path/bin/rex"
	// deployedRoot mirrors ssm.DefaultDeployedRoot.
	deployedRoot = ssm.DefaultDeployedRoot
	// account mirrors ssm.DefaultDeployAccount.
	account = ssm.DefaultDeployAccount
	// home is the account's home directory.
	home = "/home/" + account
)

// serveStatusOK is what a healthy host prints: the tailnet address Serve publishes
// and the loopback listener behind it.
const serveStatusOK = "https://rex-1.tail1234.ts.net (tailnet only)\n|-- / proxy http://127.0.0.1:7297\n"

// configLinks are the three profile files the module links.
func configLinks() []string {
	return []string{
		home + "/.config/rex/init.lua",
		home + "/.config/rex/missions.lua",
		home + "/.config/rex/notify-ntfy.lua",
	}
}

// profileRunner is a scripted SSM Run Command transport for the profile steps.
//
// It answers by step, which is what the correlation comment names, so a test can
// model one wrong answer without reimplementing the adapter. Every request is
// recorded before it is answered, so a test also asserts what was NOT asked.
type profileRunner struct {
	mu       sync.Mutex
	requests []ports.SSMRunRequest
	// answers overrides the default reply for one step.
	answers map[string]func(req ports.SSMRunRequest) (ports.SSMRunResult, error)

	// resolvedRevision is what `nix flake metadata` reports.
	resolvedRevision string
	// recordedRevision is the revision the host records as deployed; empty means it
	// records none.
	recordedRevision string
	// recordedRexPath is what the record for recordedRevision points at.
	recordedRexPath string
	// rexPath is what the account's rex link resolves to.
	rexPath string
	// activateExit is the exit code of the switch command.
	activateExit int
	// serveStates is the sequence `is-active rex-serve` reports; the last value
	// repeats.
	serveStates []string
	// serveStatus is what `tailscale serve status` prints.
	serveStatus string
	// unitState is what `is-active rex` prints in the readback.
	unitState string
	// linger is what `loginctl show-user --property=Linger` prints.
	linger string
	// missingLink makes one config link absent from `ls -l`.
	missingLink string
	// linkExit is the exit code of the `ls -l` link check.
	linkExit int
	// switchCalls counts activate calls across every deploy on this host.
	switchCalls int
	// metadataJSON replaces the resolved revision answer entirely.
	metadataJSON string
}

var _ ports.SSMRunner = (*profileRunner)(nil)

// healthyProfile is a host that has never been deployed and is ready to be: the
// flake resolves, nothing is recorded yet, and Serve converges on the first poll.
func healthyProfile() *profileRunner {
	return &profileRunner{
		resolvedRevision: deployRevision,
		rexPath:          rexStorePath,
		serveStates:      []string{"active"},
		serveStatus:      serveStatusOK,
		unitState:        "active",
		linger:           "Linger=yes",
	}
}

// deployedProfile is that host after a successful deploy: the record exists for
// deployRevision and points at the binary rex resolves to. Every readback fact holds.
func deployedProfile() *profileRunner {
	runner := healthyProfile()
	runner.recordedRevision = deployRevision
	runner.recordedRexPath = rexStorePath
	return runner
}

// answer makes one step's reply a function of the request.
func (r *profileRunner) answer(step string, reply func(req ports.SSMRunRequest) (ports.SSMRunResult, error)) {
	if r.answers == nil {
		r.answers = map[string]func(ports.SSMRunRequest) (ports.SSMRunResult, error){}
	}
	r.answers[step] = reply
}

// RunCommand implements ports.SSMRunner.
func (r *profileRunner) RunCommand(_ context.Context, req ports.SSMRunRequest) (ports.SSMRunResult, error) {
	r.mu.Lock()
	r.requests = append(r.requests, req)
	r.mu.Unlock()

	step := stepOf(req.Comment)
	if reply, ok := r.answers[step]; ok {
		result, err := reply(req)
		if err != nil {
			return ports.SSMRunResult{}, err
		}
		return echo(req, result), nil
	}
	result, err := r.reply(step, req)
	if err != nil {
		return ports.SSMRunResult{}, err
	}
	return echo(req, result), nil
}

// echo stamps the correlation values onto the reply, exactly as the control plane
// does.
func echo(req ports.SSMRunRequest, result ports.SSMRunResult) ports.SSMRunResult {
	result.InstanceID = req.InstanceID
	result.Comment = req.Comment
	return result
}

// reply is the default answer for a step.
func (r *profileRunner) reply(step string, req ports.SSMRunRequest) (ports.SSMRunResult, error) {
	argv := argvOf(req.Command)
	switch step {
	case "flake-metadata":
		if r.metadataJSON != "" {
			return ports.SSMRunResult{Status: "Success", Stdout: r.metadataJSON}, nil
		}
		return ports.SSMRunResult{Status: "Success",
			Stdout: `{"revision":"` + r.resolvedRevision + `","locked":{"rev":"` + r.resolvedRevision + `"}}`}, nil
	case "recorded-deploy", "readback-rex":
		// Both steps ask `readlink -f` for one of two paths: the account's rex link,
		// or the deployment record for a revision. The record only resolves when the
		// host has one for that revision.
		target := argv[len(argv)-1]
		if strings.HasSuffix(target, "/bin/rex") {
			return ports.SSMRunResult{Status: "Success", Stdout: r.rexPath + "\n"}, nil
		}
		if r.recordedRevision == "" || !strings.HasSuffix(target, "/"+r.recordedRevision) {
			// readlink -f on a path that does not exist prints nothing and exits 1.
			return ports.SSMRunResult{Status: "Failed", ExitCode: 1, Stderr: "readlink: no such file or directory"}, nil
		}
		return ports.SSMRunResult{Status: "Success", Stdout: r.recordedRexPath + "\n"}, nil
	case "activate":
		r.mu.Lock()
		r.switchCalls++
		r.mu.Unlock()
		if r.activateExit != 0 {
			return ports.SSMRunResult{Status: "Failed", ExitCode: r.activateExit}, nil
		}
		return ports.SSMRunResult{Status: "Success"}, nil
	case "rex-path":
		return ports.SSMRunResult{Status: "Success", Stdout: r.rexPath + "\n"}, nil
	case "record-deploy":
		return ports.SSMRunResult{Status: "Success"}, nil
	case "operator-grant":
		return ports.SSMRunResult{Status: "Success"}, nil
	case "serve-daemon-reload", "serve-enable", "serve-restart":
		return ports.SSMRunResult{Status: "Success"}, nil
	case "serve-poll":
		return ports.SSMRunResult{Status: "Success", Stdout: r.nextServeState() + "\n"}, nil
	case "serve-status":
		return ports.SSMRunResult{Status: "Success", Stdout: r.serveStatus}, nil
	case "readback-records":
		if r.recordedRevision == "" {
			return ports.SSMRunResult{Status: "Failed", ExitCode: 2, Stderr: "ls: cannot access"}, nil
		}
		return ports.SSMRunResult{Status: "Success", Stdout: r.recordedRevision + "\n"}, nil
	case "readback-unit":
		result := ports.SSMRunResult{Status: "Success", Stdout: r.unitState + "\n"}
		if r.unitState != "active" {
			result.Status, result.ExitCode = "Failed", 3
		}
		return result, nil
	case "readback-serve":
		return ports.SSMRunResult{Status: "Success", Stdout: r.serveStatus}, nil
	case "readback-links":
		if r.linkExit != 0 {
			return ports.SSMRunResult{Status: "Failed", ExitCode: r.linkExit, Stderr: "ls: cannot access '" + r.missingLink + "': No such file or directory"}, nil
		}
		var out strings.Builder
		for _, link := range configLinks() {
			if link == r.missingLink {
				continue
			}
			out.WriteString("lrwxrwxrwx 1 " + account + " " + account + " 64 Nov 26 12:00 " + link + " -> /nix/store/x\n")
		}
		return ports.SSMRunResult{Status: "Success", Stdout: out.String()}, nil
	case "readback-linger":
		return ports.SSMRunResult{Status: "Success", Stdout: r.linger + "\n"}, nil
	default:
		return ports.SSMRunResult{Status: "Success"}, nil
	}
}

// nextServeState walks the scripted is-active sequence and repeats its last value.
func (r *profileRunner) nextServeState() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.serveStates) == 0 {
		return "inactive"
	}
	state := r.serveStates[0]
	if len(r.serveStates) > 1 {
		r.serveStates = r.serveStates[1:]
	}
	return state
}

// steps returns the step name of every request, in order.
func (r *profileRunner) steps() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.requests))
	for _, req := range r.requests {
		out = append(out, stepOf(req.Comment))
	}
	return out
}

// programs returns every program the adapter asked the host to run.
func (r *profileRunner) programs() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.requests))
	for _, req := range r.requests {
		out = append(out, req.Command)
	}
	return out
}

// programFor returns the program of the nth request whose step matches.
func (r *profileRunner) programFor(t *testing.T, step string, nth int) string {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	seen := 0
	for _, req := range r.requests {
		if stepOf(req.Comment) != step {
			continue
		}
		if seen == nth {
			return req.Command
		}
		seen++
	}
	t.Fatalf("no request for step %q at index %d (steps: %v)", step, nth, stepOfAll(r.requests))
	return ""
}

// countStep reports how many requests used a step.
func (r *profileRunner) countStep(step string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, req := range r.requests {
		if stepOf(req.Comment) == step {
			count++
		}
	}
	return count
}

func stepOfAll(requests []ports.SSMRunRequest) []string {
	out := make([]string, 0, len(requests))
	for _, req := range requests {
		out = append(out, stepOf(req.Comment))
	}
	return out
}

// stepOf reads the step name out of the correlation comment, which the adapter
// writes as <instance>:<step>.
func stepOf(comment string) string {
	if index := strings.LastIndex(comment, ":"); index >= 0 {
		return comment[index+1:]
	}
	return comment
}

// argvOf recovers the argument array a rendered program passes to its program.
// Every argument is single-quoted and no argument may contain a quote, so the scan
// is exact: if the renderer ever stopped quoting a word, this would return fewer
// arguments and the assertions built on it would fail.
func argvOf(program string) []string {
	index := strings.Index(program, "exec ")
	if index < 0 {
		return nil
	}
	line := strings.TrimSuffix(program[index+len("exec "):], "\n")
	var argv []string
	for {
		open := strings.Index(line, "'")
		if open < 0 {
			return argv
		}
		rest := line[open+1:]
		close := strings.Index(rest, "'")
		if close < 0 {
			return argv
		}
		argv = append(argv, rest[:close])
		line = rest[close+1:]
	}
}

// shellMetacharacters are the bytes no argument may carry. `#` is absent on
// purpose: a flake attribute path needs it and it is inert inside a quoted word.
const shellMetacharacters = " \t\r\n;|&$`'\"\\<>()*?!~{}[]"

// assertArgvOnly fails a test if any program the adapter sent carries shell syntax.
func assertArgvOnly(t *testing.T, runner *profileRunner) {
	t.Helper()
	for _, program := range runner.programs() {
		argv := argvOf(program)
		if len(argv) == 0 {
			t.Fatalf("a program carried no argument array: %q", program)
		}
		for _, arg := range argv {
			if strings.ContainsAny(arg, shellMetacharacters) {
				t.Fatalf("argument %q carries shell syntax in program %q", arg, program)
			}
		}
		// Nothing may survive outside the quoted words except the fixed prologue
		// and the `exec` keyword.
		stripped := program
		for _, arg := range argv {
			stripped = strings.Replace(stripped, "'"+arg+"'", "", 1)
		}
		for _, banned := range []string{";", "|", "$", "`", ">", "<", "&&"} {
			if strings.Contains(stripped, banned) {
				t.Fatalf("program %q carries %q outside its arguments", program, banned)
			}
		}
	}
}
