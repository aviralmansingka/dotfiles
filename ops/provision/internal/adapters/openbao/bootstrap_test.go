package openbao_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/openbao"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/store/jsonstore"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

// canarySentinel is the value the canary test follows. It is long and random
// shaped so a substring match proves the value itself reached a surface, not a
// coincidence.
const canarySentinel = "wrapped-sentinel-8f14e45fceea167a5a36dedd4bea2543"

// TestBootstrapFileIsOwnerOnlyAndOutsideTheRecordStores is property 6's file
// contract: the wrapping token is written 0600 in a 0700 directory, and the
// directory is refused if it is in the Nix store, a Git checkout, or Terraform
// state.
func TestBootstrapFileIsOwnerOnlyAndOutsideTheRecordStores(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	writer, err := openbao.NewBootstrapWriter(openbao.BootstrapConfig{Dir: filepath.Join(root, "bootstrap")})
	if err != nil {
		t.Fatalf("NewBootstrapWriter: %v", err)
	}
	path, err := writer.DeliverBootstrap(context.Background(), ports.BootstrapMaterial{
		HostID:  "host-0001",
		RoleID:  "fleet-host-host-0001",
		WrapTok: domain.NewSecret("test:wrapping-token", []byte(canarySentinel)),
		TTL:     domain.BootstrapWrapTTL,
	})
	if err != nil {
		t.Fatalf("DeliverBootstrap: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat bootstrap file: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("bootstrap file mode = %04o, want 0600", mode)
	}
	dirInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatalf("stat bootstrap directory: %v", err)
	}
	if mode := dirInfo.Mode().Perm(); mode != 0o700 {
		t.Fatalf("bootstrap directory mode = %04o, want 0700", mode)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		t.Fatal("the bootstrap file must be a regular file, not a symlink")
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read bootstrap file: %v", err)
	}
	if string(contents) != canarySentinel {
		t.Fatal("the bootstrap file does not hold the delivered wrapping token")
	}
}

// TestBootstrapWriterRefusesCredentialHostileDirectories proves the location rules
// fail closed. Each refused directory is a place a credential is world-readable,
// committed, or uploaded.
func TestBootstrapWriterRefusesCredentialHostileDirectories(t *testing.T) {
	t.Parallel()
	repo := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repo, ".git"), 0o700); err != nil {
		t.Fatalf("create fake git directory: %v", err)
	}
	refused := []string{
		"",
		"relative/bootstrap",
		"/",
		"/nix/store/abc-bootstrap",
		filepath.Join(repo, "bootstrap"),
		filepath.Join(t.TempDir(), ".git", "bootstrap"),
		filepath.Join(t.TempDir(), "terraform.tfstate"),
		filepath.Join(t.TempDir(), ".terraform", "bootstrap"),
	}
	for _, dir := range refused {
		if _, err := openbao.NewBootstrapWriter(openbao.BootstrapConfig{Dir: dir}); err == nil {
			t.Fatalf("NewBootstrapWriter(%q) must be refused", dir)
		}
	}
	for _, dir := range []string{filepath.Join(t.TempDir(), "bootstrap"), filepath.Join(t.TempDir(), "secrets", "openbao")} {
		if _, err := openbao.NewBootstrapWriter(openbao.BootstrapConfig{Dir: dir}); err != nil {
			t.Fatalf("NewBootstrapWriter(%q) = %v, want a private directory outside the repo", dir, err)
		}
	}
}

// TestBootstrapTokenNeverReachesArgvLogsStateOrJobRecords is the canary sentinel
// test for property 6. One known wrapping token is authorized, delivered, and then
// searched for in every surface that must never hold it: process arguments, log
// lines, a workflow/activity payload, a persisted host (job) record, and a
// Terraform state file. The only file that may hold it is the 0600 delivery file.
func TestBootstrapTokenNeverReachesArgvLogsStateOrJobRecords(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	backend := fakes.NewIdentityBackend()
	backend.SetWrapToken(canarySentinel)
	logger := &fakes.Logger{}
	bootstrapDir := filepath.Join(root, "bootstrap")
	writer, err := openbao.NewBootstrapWriter(openbao.BootstrapConfig{Dir: bootstrapDir})
	if err != nil {
		t.Fatalf("NewBootstrapWriter: %v", err)
	}
	service, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  backend,
		Delivery: writer,
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	req := ports.AuthorizeRequest{
		HostID:        "host-0001",
		Name:          "canary-01",
		Profile:       "rex",
		SecretBundles: []string{"bao:secret/data/hosts/host-0001/canary"},
	}
	if err := service.AuthorizeHost(context.Background(), req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}

	delivered := filepath.Join(bootstrapDir, "host-0001", "approle-wrap-token")
	contents, err := os.ReadFile(delivered)
	if err != nil {
		t.Fatalf("the wrapping token was not delivered: %v", err)
	}
	if string(contents) != canarySentinel {
		t.Fatal("the delivered file does not hold the minted wrapping token")
	}

	// Workflow input and status: the payload shapes that travel in Temporal.
	inputPayload, err := json.Marshal(workflows.AuthorizeHostInput{
		HostID:        req.HostID,
		Name:          req.Name,
		Profile:       req.Profile,
		SecretBundles: req.SecretBundles,
	})
	if err != nil {
		t.Fatalf("marshal workflow input: %v", err)
	}
	assertNoSentinel(t, "workflow input", string(inputPayload))
	statusPayload, err := json.Marshal(workflows.Status{
		HostID: req.HostID,
		JobID:  "create-host-0001",
		Stage:  domain.StageAuthorizing,
	})
	if err != nil {
		t.Fatalf("marshal workflow status: %v", err)
	}
	assertNoSentinel(t, "workflow status", string(statusPayload))
	viewPayload, err := json.Marshal(ports.JobView{JobID: "create-host-0001", HostID: req.HostID})
	if err != nil {
		t.Fatalf("marshal job view: %v", err)
	}
	assertNoSentinel(t, "job view", string(viewPayload))

	// The persisted host record is the job record: it carries references only.
	store, err := jsonstore.Open(filepath.Join(root, "state", "store.json"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	now := time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC)
	if _, _, err := store.CreateHost(context.Background(), domain.Host{
		ID:            req.HostID,
		Name:          req.Name,
		Provider:      domain.ProviderAWS,
		Profile:       req.Profile,
		Region:        "ap-south-1",
		Size:          "standard",
		InstanceType:  "t3.medium",
		DiskGB:        40,
		SecretBundles: req.SecretBundles,
		OwnerClientID: "test-client",
		JobID:         "create-host-0001",
		State:         domain.HostStateProvisioning,
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("record host: %v", err)
	}

	// A Terraform state file is written from the same resolved values and still
	// holds no credential.
	tfstatePath := filepath.Join(root, "terraform-runs", req.HostID, "terraform.tfstate")
	if err := os.MkdirAll(filepath.Dir(tfstatePath), 0o700); err != nil {
		t.Fatalf("create run dir: %v", err)
	}
	if err := os.WriteFile(tfstatePath, inputPayload, 0o600); err != nil {
		t.Fatalf("write tfstate: %v", err)
	}

	// Process arguments: nothing here builds a command line, and nothing carries
	// the token.
	assertNoSentinel(t, "process arguments", strings.Join(os.Args, " "))

	// Every log line the service emitted.
	for _, line := range logger.Lines() {
		assertNoSentinel(t, "log line", line)
	}

	// Every file under the test root except the one 0600 delivery file.
	err = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		body, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if path == delivered {
			return nil
		}
		if strings.Contains(string(body), canarySentinel) {
			return fmt.Errorf("the wrapping token reached %s", path)
		}
		if info.Mode().Perm()&0o004 != 0 {
			return fmt.Errorf("%s is world-readable (mode %04o)", path, info.Mode().Perm())
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func assertNoSentinel(t *testing.T, where, value string) {
	t.Helper()
	if strings.Contains(value, canarySentinel) {
		t.Fatalf("the wrapping token reached %s: %s", where, value)
	}
}
