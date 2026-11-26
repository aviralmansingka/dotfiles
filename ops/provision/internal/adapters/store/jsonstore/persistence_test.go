package jsonstore_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/store/jsonstore"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// The durability test runs itself twice: the parent spawns the same test binary
// as a child process, the child writes through the real service, and the parent
// verifies the file the child left behind. Two OS processes, no shared memory.
const (
	restartModeEnv  = "PROVISION_JSONSTORE_RESTART_MODE"
	restartStoreEnv = "PROVISION_JSONSTORE_RESTART_PATH"
	restartChildRun = "^TestDurableJobSurvivesProcessRestart$"

	restartKey  = "restart-key-0001"
	restartName = "canary-01"
)

var restartRequest = domain.CreateHostRequest{
	Provider: "aws",
	Name:     restartName,
	Profile:  "rex",
	Region:   "ap-south-1",
	Size:     "standard",
}

// buildService wires the real file-backed store to the real application service,
// with the offline orchestrator/clock/IDs fakes standing in for Temporal.
func buildService(t *testing.T, store *jsonstore.Store, orchestrator *fakes.Orchestrator) *application.Service {
	t.Helper()
	service, err := application.New(application.Deps{
		Profiles: fakes.Catalog(t),
		Hosts:    store,
		Ledger:   store,
		Jobs:     orchestrator,
		Tokens:   fakes.TokenStore(t),
		Clock:    fakes.NewClock(),
		IDs:      &fakes.IDs{},
		Logger:   &fakes.Logger{},
	})
	if err != nil {
		t.Fatalf("application.New: %v", err)
	}
	return service
}

// TestDurableJobSurvivesProcessRestart covers acceptance criterion 3 with two
// real OS processes: a job accepted by process A survives A's exit, and the
// restarted process B replays the same Idempotency-Key without starting a second
// workflow or creating a second host.
func TestDurableJobSurvivesProcessRestart(t *testing.T) {
	if os.Getenv(restartModeEnv) == "child" {
		runRestartWritePhase(t, os.Getenv(restartStoreEnv))
		return
	}

	dir := t.TempDir()
	storePath := filepath.Join(dir, "store.json")

	// Phase 1: a separate process accepts the job, then exits.
	stdout, stderr, err := runRestartChild(t, storePath)
	if err != nil {
		t.Fatalf("child process failed: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
	}

	// The child printed the identifiers it accepted; the parent does not reuse
	// them from memory but checks them against what is on disk.
	wroteHostID, wroteJobID := parseWroteLine(t, stdout)
	if wroteHostID == "" || wroteJobID == "" {
		t.Fatalf("child did not report accepted identifiers:\n%s", stdout)
	}

	// The state file exists, is non-empty, and is owner-only.
	info, err := os.Stat(storePath)
	if err != nil {
		t.Fatalf("stat store: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("store file is empty after the write phase")
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("store file mode = %04o, want 0600", perm)
	}
	beforeDigest := fileDigest(t, storePath)

	// Phase 2: a fresh store instance in this process reads the same directory.
	// This is a restart: the process that wrote the state is gone.
	reopened, err := jsonstore.Open(storePath)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	ctx := context.Background()

	hosts, err := reopened.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts after restart: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("hosts after restart = %d, want 1", len(hosts))
	}
	host := hosts[0]
	if host.ID != wroteHostID || host.JobID != wroteJobID {
		t.Fatalf("persisted host = %s/%s, want %s/%s", host.ID, host.JobID, wroteHostID, wroteJobID)
	}
	if host.Name != restartName {
		t.Fatalf("persisted host name = %q, want %q", host.Name, restartName)
	}
	if host.State != domain.HostStateProvisioning {
		t.Fatalf("persisted host state = %q, want %q", host.State, domain.HostStateProvisioning)
	}
	if host.OwnerClientID != "test-client" {
		t.Fatalf("persisted owner = %q, want test-client", host.OwnerClientID)
	}

	record, found, err := reopened.Lookup(ctx, restartKey)
	if err != nil || !found {
		t.Fatalf("idempotency reservation did not survive the restart: found=%v err=%v", found, err)
	}
	if record.JobID != wroteJobID || record.ResourceID != wroteHostID {
		t.Fatalf("persisted reservation = %s/%s, want %s/%s", record.ResourceID, record.JobID, wroteHostID, wroteJobID)
	}

	// The restarted service replays the same key. A fresh orchestrator models the
	// truth that Temporal state lives outside this process: if the service started
	// the workflow again, TotalStarts would be 1.
	orchestrator := fakes.NewOrchestrator()
	restarted := buildService(t, reopened, orchestrator)
	accepted, err := restarted.CreateHost(ctx, ports.Principal{ClientID: "test-client"}, restartKey, restartRequest)
	if err != nil {
		t.Fatalf("replay after restart: %v", err)
	}
	if accepted.HostID != wroteHostID || accepted.JobID != wroteJobID {
		t.Fatalf("replay returned %s/%s, want %s/%s", accepted.HostID, accepted.JobID, wroteHostID, wroteJobID)
	}
	if starts := orchestrator.TotalStarts(); starts != 0 {
		t.Fatalf("replay started %d workflow(s) after restart, want 0", starts)
	}

	hosts, err = reopened.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts after replay: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("hosts after replay = %d, want 1", len(hosts))
	}
	if afterDigest := fileDigest(t, storePath); afterDigest != beforeDigest {
		t.Fatalf("store file changed on a replayed request: %s -> %s", beforeDigest, afterDigest)
	}

	// A brand-new Idempotency-Key after the restart still creates a new job, so
	// the replay above was a replay and not a wedged store.
	next, err := restarted.CreateHost(ctx, ports.Principal{ClientID: "test-client"}, "restart-key-0002", restartRequest)
	if err != nil {
		t.Fatalf("new key after restart: %v", err)
	}
	if next.JobID == wroteJobID || next.HostID == wroteHostID {
		t.Fatalf("a new key reused the old identifiers: %+v", next)
	}
	if starts := orchestrator.TotalStarts(); starts != 1 {
		t.Fatalf("workflows started by the new key = %d, want 1", starts)
	}
}

// runRestartWritePhase is the child process: it accepts one job through the real
// service and exits immediately, leaving only the file behind.
func runRestartWritePhase(t *testing.T, storePath string) {
	t.Helper()
	if storePath == "" {
		t.Fatal("child process has no store path")
	}
	store, err := jsonstore.Open(storePath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	orchestrator := fakes.NewOrchestrator()
	service := buildService(t, store, orchestrator)
	accepted, err := service.CreateHost(context.Background(), ports.Principal{ClientID: "test-client"}, restartKey, restartRequest)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	if starts := orchestrator.TotalStarts(); starts != 1 {
		t.Fatalf("workflows started = %d, want 1", starts)
	}
	t.Logf("WROTE pid=%d host_id=%s job_id=%s", os.Getpid(), accepted.HostID, accepted.JobID)
}

// runRestartChild executes this test binary in child mode and returns its output.
func runRestartChild(t *testing.T, storePath string) (string, string, error) {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run="+restartChildRun, "-test.v")
	command.Env = append(os.Environ(), restartModeEnv+"=child", restartStoreEnv+"="+storePath)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	return stdout.String(), stderr.String(), err
}

// parseWroteLine extracts the identifiers the child process accepted.
func parseWroteLine(t *testing.T, stdout string) (hostID, jobID string) {
	t.Helper()
	for _, line := range strings.Split(stdout, "\n") {
		index := strings.Index(line, "WROTE ")
		if index < 0 {
			continue
		}
		for _, field := range strings.Fields(line[index:]) {
			switch {
			case strings.HasPrefix(field, "host_id="):
				hostID = strings.TrimPrefix(field, "host_id=")
			case strings.HasPrefix(field, "job_id="):
				jobID = strings.TrimPrefix(field, "job_id=")
			}
		}
	}
	return hostID, jobID
}

func fileDigest(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read store: %v", err)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// TestReopenedStoreKeepsHostsAndReservations is the in-process companion: a fresh
// store instance opened on the same directory sees the same rows. It guards the
// path a restart takes even when the durability test is skipped.
func TestReopenedStoreKeepsHostsAndReservations(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "store.json")
	ctx := context.Background()

	first, err := jsonstore.Open(path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	service := buildService(t, first, fakes.NewOrchestrator())
	accepted, err := service.CreateHost(ctx, ports.Principal{ClientID: "test-client"}, restartKey, restartRequest)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}

	second, err := jsonstore.Open(path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	host, err := second.GetHost(ctx, accepted.HostID)
	if err != nil {
		t.Fatalf("GetHost on the reopened store: %v", err)
	}
	if host.JobID != accepted.JobID {
		t.Fatalf("job = %q, want %q", host.JobID, accepted.JobID)
	}
	record, found, err := second.Lookup(ctx, restartKey)
	if err != nil || !found {
		t.Fatalf("reservation missing after reopen: found=%v err=%v", found, err)
	}
	if record.JobID != accepted.JobID {
		t.Fatalf("reservation job = %q, want %q", record.JobID, accepted.JobID)
	}
	if _, created, err := second.Reserve(ctx, ports.IdempotencyRecord{Key: restartKey, Fingerprint: "different"}); err != nil {
		t.Fatalf("Reserve: %v", err)
	} else if created {
		t.Fatal("a persisted reservation must not be reserved twice")
	}
}

// TestOpenRejectsEmptyAndCorruptDocuments keeps a restart from silently forking
// the inventory. Empty documents are empty stores; a truncated or future-schema
// document is a hard error.
func TestOpenRejectsEmptyAndCorruptDocuments(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	if _, err := jsonstore.Open(filepath.Join(dir, "missing.json")); err != nil {
		t.Fatalf("a missing file must open as an empty store: %v", err)
	}
	emptyPath := filepath.Join(dir, "empty.json")
	if err := os.WriteFile(emptyPath, nil, 0o600); err != nil {
		t.Fatalf("write empty file: %v", err)
	}
	if _, err := jsonstore.Open(emptyPath); err != nil {
		t.Fatalf("an empty file must open as an empty store: %v", err)
	}

	corruptPath := filepath.Join(dir, "corrupt.json")
	if err := os.WriteFile(corruptPath, []byte(`{"version":1,"hosts":[`), 0o600); err != nil {
		t.Fatalf("write corrupt file: %v", err)
	}
	if _, err := jsonstore.Open(corruptPath); err == nil {
		t.Fatal("a corrupt store must fail to open")
	}

	futurePath := filepath.Join(dir, "future.json")
	if err := os.WriteFile(futurePath, []byte(`{"version":99,"hosts":[]}`), 0o600); err != nil {
		t.Fatalf("write future file: %v", err)
	}
	if _, err := jsonstore.Open(futurePath); err == nil {
		t.Fatal("an unsupported schema version must fail to open")
	}
}

// TestSecondHandleUpdatesWhatTheFirstWrote is the shape of the homelab stack: the
// API process records a request and the worker process records what the provider
// did. Both handles are opened before the write, so the second one's snapshot
// predates the host — exactly the case that answered `resource not found` for a
// host the API had already created, three attempts in a row.
func TestSecondHandleUpdatesWhatTheFirstWrote(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "store.json")
	ctx := context.Background()

	api, err := jsonstore.Open(path)
	if err != nil {
		t.Fatalf("open api store: %v", err)
	}
	worker, err := jsonstore.Open(path)
	if err != nil {
		t.Fatalf("open worker store: %v", err)
	}

	service := buildService(t, api, fakes.NewOrchestrator())
	accepted, err := service.CreateHost(ctx, ports.Principal{ClientID: "test-client"}, restartKey, restartRequest)
	if err != nil {
		t.Fatalf("create host: %v", err)
	}

	updated, err := worker.UpdateHost(ctx, accepted.HostID, func(h *domain.Host) error {
		h.MarkResource("i-0123456789abcdef0", "10.99.1.10", h.CreatedAt)
		return nil
	})
	if err != nil {
		t.Fatalf("UpdateHost from the second handle: %v", err)
	}
	if updated.ResourceID != "i-0123456789abcdef0" {
		t.Fatalf("resource id = %q, want the recorded instance", updated.ResourceID)
	}
	if len(mustList(t, api)) != 1 || len(mustList(t, worker)) != 1 {
		t.Fatal("both handles must still see exactly one host; a stale full-document write would drop one")
	}
}

func mustList(t *testing.T, store *jsonstore.Store) []domain.Host {
	t.Helper()
	hosts, err := store.ListHosts(context.Background())
	if err != nil {
		t.Fatalf("ListHosts: %v", err)
	}
	return hosts
}
