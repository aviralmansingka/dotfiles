package ssm_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

func newParameterStore(t *testing.T, executor *fakeExecutor) *ssm.ParameterStore {
	t.Helper()
	store, err := ssm.NewParameterStore(ssm.ParameterStoreConfig{
		Client:   ssm.ClientConfig{Executor: executor},
		KMSKeyID: ssm.DefaultKMSKeyID,
		TempDir:  t.TempDir(),
	})
	if err != nil {
		t.Fatalf("NewParameterStore: %v", err)
	}
	return store
}

// TestPutSecureParameterKeepsTheValueOutOfArgv is the handoff rule at the CLI
// boundary: the key reaches Parameter Store as a SecureString under the fleet key,
// and it never becomes an argument, a description, or a hint.
func TestPutSecureParameterKeepsTheValueOutOfArgv(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{}
	store := newParameterStore(t, executor)
	if err := store.PutSecureParameter(context.Background(), application.SecureParameterRequest{
		Name:  parameterPath,
		Value: application.NewSecret("tailscale:authkey", []byte(fakeAuthKey)),
	}); err != nil {
		t.Fatalf("PutSecureParameter: %v", err)
	}
	if len(executor.calls) != 1 {
		t.Fatalf("aws calls = %d, want 1", len(executor.calls))
	}
	call := executor.calls[0]
	if call.Name != ssm.DefaultBinary {
		t.Fatalf("binary = %q, want %q", call.Name, ssm.DefaultBinary)
	}
	argv := executor.argv(0)
	for _, required := range []string{
		"ssm put-parameter",
		"--name " + parameterPath,
		"--type SecureString",
		"--key-id " + ssm.DefaultKMSKeyID,
	} {
		if !strings.Contains(argv, required) {
			t.Fatalf("argv is missing %q: %s", required, argv)
		}
	}
	if strings.Contains(argv, fakeAuthKey) {
		t.Fatalf("the key reached the CLI argv: %s", argv)
	}
	// The value travelled as a private file, and that file held exactly the key.
	var valueFile string
	for _, arg := range call.Args {
		if path, ok := strings.CutPrefix(arg, "file://"); ok {
			valueFile = path
		}
	}
	if valueFile == "" {
		t.Fatalf("argv carries no file:// value: %s", argv)
	}
	if got := executor.readFiles[valueFile]; got != fakeAuthKey {
		t.Fatalf("the handoff file did not hold the key")
	}
	// And it is gone before the call returns: the value does not outlive the store.
	if _, err := os.Stat(valueFile); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the handoff file still exists at %s", valueFile)
	}
	// The region is pinned on the environment, not left to the box.
	if !containsLine(call.Env, "AWS_DEFAULT_REGION="+ssm.DefaultRegion) {
		t.Fatalf("the CLI call does not pin the region: %v", call.Env)
	}
	// No description field: parameter metadata is no place for a credential or a
	// hint about one.
	if strings.Contains(argv, "--description") {
		t.Fatalf("put-parameter carries a description: %s", argv)
	}
}

// TestPutSecureParameterRefusesAnEmptyKey: an empty value would create a
// parameter that silently fails the join later.
func TestPutSecureParameterRefusesAnEmptyKey(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{}
	store := newParameterStore(t, executor)
	err := store.PutSecureParameter(context.Background(), application.SecureParameterRequest{
		Name:  parameterPath,
		Value: application.NewSecret("tailscale:authkey", nil),
	})
	if err == nil {
		t.Fatal("PutSecureParameter must refuse an empty key")
	}
	if len(executor.calls) != 0 {
		t.Fatal("an empty key must not reach the CLI")
	}
}

// TestPutSecureParameterRefusesAnUnsafePath keeps a name that could end a shell
// word out of the host script.
func TestPutSecureParameterRefusesAnUnsafePath(t *testing.T) {
	t.Parallel()
	executor := &fakeExecutor{}
	store := newParameterStore(t, executor)
	for _, name := range []string{"", "/fleet/enroll/rex-1/../x", "/fleet/enroll/rex'1/abc", "fleet/enroll"} {
		err := store.PutSecureParameter(context.Background(), application.SecureParameterRequest{
			Name:  name,
			Value: application.NewSecret("tailscale:authkey", []byte(fakeAuthKey)),
		})
		if err == nil {
			t.Fatalf("PutSecureParameter accepted %q", name)
		}
	}
	if len(executor.calls) != 0 {
		t.Fatal("an unsafe name must not reach the CLI")
	}
}

// TestDeleteParameterNamesThePathAndToleratesMissing covers both cleanup paths'
// needs: delete by exact path, and treat "already gone" as success so a retry is
// not an error.
func TestDeleteParameterNamesThePathAndToleratesMissing(t *testing.T) {
	t.Parallel()
	t.Run("deleted", func(t *testing.T) {
		t.Parallel()
		executor := &fakeExecutor{}
		store := newParameterStore(t, executor)
		if err := store.DeleteParameter(context.Background(), parameterPath); err != nil {
			t.Fatalf("DeleteParameter: %v", err)
		}
		if argv := executor.argv(0); !strings.Contains(argv, "ssm delete-parameter --name "+parameterPath) {
			t.Fatalf("argv does not name the path: %s", argv)
		}
	})
	t.Run("already gone", func(t *testing.T) {
		t.Parallel()
		executor := &fakeExecutor{respond: func(int, ssm.Command) (ssm.Result, error) {
			return ssm.Result{Stderr: "An error occurred (ParameterNotFound) when calling the DeleteParameter operation"}, errors.New("exit status 254")
		}}
		store := newParameterStore(t, executor)
		if err := store.DeleteParameter(context.Background(), parameterPath); err != nil {
			t.Fatalf("a missing parameter must not be an error: %v", err)
		}
	})
	t.Run("other failure", func(t *testing.T) {
		t.Parallel()
		executor := &fakeExecutor{respond: func(int, ssm.Command) (ssm.Result, error) {
			return ssm.Result{Stderr: "An error occurred (AccessDenied) when calling the DeleteParameter operation"}, errors.New("exit status 254")
		}}
		store := newParameterStore(t, executor)
		if err := store.DeleteParameter(context.Background(), parameterPath); err == nil {
			t.Fatal("a real deletion failure must be reported")
		}
	})
}

// TestNewParameterStoreValidatesTheKeyReference keeps a key reference that could
// be a flag or a shell word out of the CLI.
func TestNewParameterStoreValidatesTheKeyReference(t *testing.T) {
	t.Parallel()
	// An empty value is not on this list: it means "use the approved fleet key",
	// which is the default the configuration fills in anyway.
	for _, keyID := range []string{"alias/", "--smuggled", "alias/x --value y", "arn:aws:kms"} {
		if _, err := ssm.NewParameterStore(ssm.ParameterStoreConfig{
			Client:   ssm.ClientConfig{Executor: &fakeExecutor{}},
			KMSKeyID: keyID,
		}); err == nil {
			t.Fatalf("NewParameterStore accepted kms key id %q", keyID)
		}
	}
	for _, keyID := range []string{"alias/fleet-enroll", "1234abcd-12ab-34cd-56ef-1234567890ab", "arn:aws:kms:ap-south-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab"} {
		if _, err := ssm.NewParameterStore(ssm.ParameterStoreConfig{
			Client:   ssm.ClientConfig{Executor: &fakeExecutor{}},
			KMSKeyID: keyID,
		}); err != nil {
			t.Fatalf("NewParameterStore refused a valid key id %q: %v", keyID, err)
		}
	}
}

func containsLine(lines []string, want string) bool {
	for _, line := range lines {
		if line == want {
			return true
		}
	}
	return false
}
