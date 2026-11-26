package ssm_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// invocationJSON builds a get-command-invocation reply, so the embedded output is
// escaped the way the control plane escapes it.
func invocationJSON(status string, exitCode int, stdout, stderr string) string {
	reply := map[string]any{
		"CommandId":             "cmd-0001",
		"InstanceId":            instanceID,
		"Comment":               instanceID,
		"Status":                status,
		"ResponseCode":          exitCode,
		"StandardOutputContent": stdout,
		"StandardErrorContent":  stderr,
	}
	encoded, err := json.Marshal(reply)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func newRunner(t *testing.T, executor *fakeExecutor) *ssm.Runner {
	t.Helper()
	runner, err := ssm.NewRunner(ssm.RunnerConfig{
		Client:       ssm.ClientConfig{Executor: executor},
		PollInterval: time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewRunner: %v", err)
	}
	return runner
}

// TestRunCommandSendsByInstanceIDAndReadsTheInvocation asserts the two control
// plane calls: send-command addressed by instance id, with the script in a JSON
// input file (never as a flag), then get-command-invocation for the status.
func TestRunCommandSendsByInstanceIDAndReadsTheInvocation(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{respond: func(call int, _ ssm.Command) (ssm.Result, error) {
		if call == 0 {
			return ssm.Result{Stdout: `{"Command":{"CommandId":"cmd-0001"}}`}, nil
		}
		return ssm.Result{Stdout: invocationJSON("Success", 0, nodeStatusJSON, "")}, nil
	}}
	runner := newRunner(t, executor)
	result, err := runner.RunCommand(context.Background(), ports.SSMRunRequest{
		InstanceID: instanceID,
		Comment:    instanceID,
		Command:    "set -eu\nset +x\ntailscale status --json\n",
	})
	if err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
	if result.Status != "Success" || result.ExitCode != 0 {
		t.Fatalf("result = %+v, want Success/0", result)
	}
	if !strings.Contains(result.Stdout, "nABCDEF123") {
		t.Fatalf("stdout does not carry the node status: %q", result.Stdout)
	}
	if len(executor.calls) != 2 {
		t.Fatalf("aws calls = %d, want send + one poll", len(executor.calls))
	}

	sendArgv := executor.argv(0)
	if !strings.Contains(sendArgv, "ssm send-command") {
		t.Fatalf("first call is not send-command: %s", sendArgv)
	}
	// The script is in a JSON document, so it is one value and cannot be
	// interpreted as flags or shell words.
	if !strings.Contains(sendArgv, "--cli-input-json file://") {
		t.Fatalf("send-command does not use a JSON input file: %s", sendArgv)
	}
	if strings.Contains(sendArgv, "tailscale") {
		t.Fatalf("the script leaked into the argv: %s", sendArgv)
	}
	var input string
	for path, content := range executor.readFiles {
		if strings.Contains(path, "fleet-ssm-command-") {
			input = content
		}
	}
	if input == "" {
		t.Fatal("the send-command input file was not read")
	}
	for _, required := range []string{
		`"InstanceIds":["` + instanceID + `"]`,
		`"DocumentName":"AWS-RunShellScript"`,
		`"Comment":"` + instanceID + `"`,
		"tailscale status --json",
	} {
		if !strings.Contains(input, required) {
			t.Fatalf("send-command input is missing %s: %s", required, input)
		}
	}
	// The invocation is polled by command id and instance id, never by tag.
	pollArgv := executor.argv(1)
	for _, required := range []string{"ssm get-command-invocation", "--command-id cmd-0001", "--instance-id " + instanceID} {
		if !strings.Contains(pollArgv, required) {
			t.Fatalf("poll argv is missing %q: %s", required, pollArgv)
		}
	}
}

// TestRunCommandPollsUntilTheInvocationIsTerminal covers the pending statuses: an
// invocation that is still running is not an answer.
func TestRunCommandPollsUntilTheInvocationIsTerminal(t *testing.T) {
	t.Parallel()
	statuses := []string{"Pending", "InProgress", "Success"}
	executor := &fakeExecutor{respond: func(call int, _ ssm.Command) (ssm.Result, error) {
		if call == 0 {
			return ssm.Result{Stdout: `{"Command":{"CommandId":"cmd-0001"}}`}, nil
		}
		status := statuses[call-1]
		return ssm.Result{Stdout: invocationJSON(status, 0, "{}", "")}, nil
	}}
	runner := newRunner(t, executor)
	if _, err := runner.RunCommand(context.Background(), ports.SSMRunRequest{
		InstanceID: instanceID,
		Comment:    instanceID,
		Command:    "true",
	}); err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
	if len(executor.calls) != 4 {
		t.Fatalf("aws calls = %d, want 1 send + 3 polls", len(executor.calls))
	}
}

// TestRunCommandToleratesAnInvocationThatDoesNotExistYet: the record is created
// moments after send-command returns, so the first poll can legitimately 404.
func TestRunCommandToleratesAnInvocationThatDoesNotExistYet(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{respond: func(call int, _ ssm.Command) (ssm.Result, error) {
		switch call {
		case 0:
			return ssm.Result{Stdout: `{"Command":{"CommandId":"cmd-0001"}}`}, nil
		case 1:
			return ssm.Result{Stderr: "An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation"}, errors.New("exit status 254")
		default:
			return ssm.Result{Stdout: invocationJSON("Success", 0, "", "")}, nil
		}
	}}
	runner := newRunner(t, executor)
	if _, err := runner.RunCommand(context.Background(), ports.SSMRunRequest{
		InstanceID: instanceID,
		Comment:    instanceID,
		Command:    "true",
	}); err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
}

// TestRunCommandRefusesAReplyForAnotherCommandOrInstance keeps a mismatched answer
// from becoming a success.
func TestRunCommandRefusesAReplyForAnotherCommandOrInstance(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"another command":  fmt.Sprintf(`{"CommandId":"cmd-9999","InstanceId":%q,"Comment":%q,"Status":"Success"}`, instanceID, instanceID),
		"another instance": fmt.Sprintf(`{"CommandId":"cmd-0001","InstanceId":%q,"Comment":%q,"Status":"Success"}`, otherInstance, instanceID),
		"another comment":  fmt.Sprintf(`{"CommandId":"cmd-0001","InstanceId":%q,"Comment":"something-else","Status":"Success"}`, instanceID),
	}
	for name, reply := range cases {
		reply := reply
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			executor := &fakeExecutor{respond: func(call int, _ ssm.Command) (ssm.Result, error) {
				if call == 0 {
					return ssm.Result{Stdout: `{"Command":{"CommandId":"cmd-0001"}}`}, nil
				}
				return ssm.Result{Stdout: reply}, nil
			}}
			runner := newRunner(t, executor)
			_, err := runner.RunCommand(context.Background(), ports.SSMRunRequest{
				InstanceID: instanceID,
				Comment:    instanceID,
				Command:    "true",
			})
			if err == nil {
				t.Fatal("RunCommand must refuse the mismatched reply")
			}
		})
	}
}

// TestRunCommandReportsATerminalFailure is the failure the caller must be able to
// distinguish: the command ran and exited non-zero.
func TestRunCommandReportsATerminalFailure(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{respond: func(call int, _ ssm.Command) (ssm.Result, error) {
		if call == 0 {
			return ssm.Result{Stdout: `{"Command":{"CommandId":"cmd-0001"}}`}, nil
		}
		return ssm.Result{Stdout: invocationJSON("Failed", 1, "", "tailscale: boom")}, nil
	}}
	runner := newRunner(t, executor)
	result, err := runner.RunCommand(context.Background(), ports.SSMRunRequest{
		InstanceID: instanceID,
		Comment:    instanceID,
		Command:    "true",
	})
	if err != nil {
		t.Fatalf("a failed command is reported in the result, not as a transport error: %v", err)
	}
	if result.Status != "Failed" || result.ExitCode != 1 {
		t.Fatalf("result = %+v, want Failed/1", result)
	}
	if !strings.Contains(result.Stderr, "boom") {
		t.Fatalf("stderr was not carried: %q", result.Stderr)
	}
}

// TestRunCommandRefusesAnEmptyCommandOrABadInstanceID keeps a malformed request
// from reaching the control plane.
func TestRunCommandRefusesAnEmptyCommandOrABadInstanceID(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{}
	runner := newRunner(t, executor)
	if _, err := runner.RunCommand(context.Background(), ports.SSMRunRequest{InstanceID: instanceID}); err == nil {
		t.Fatal("RunCommand must refuse an empty command")
	}
	if _, err := runner.RunCommand(context.Background(), ports.SSMRunRequest{InstanceID: "rex-1", Command: "true"}); err == nil {
		t.Fatal("RunCommand must refuse a non-instance-id target")
	}
	if len(executor.calls) != 0 {
		t.Fatal("a refused request must not reach the CLI")
	}
}
