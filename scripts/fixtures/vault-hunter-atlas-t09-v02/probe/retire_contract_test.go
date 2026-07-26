//go:build t09v02

package probe

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const fixedMtime = int64(1777777777123456789)

func TestT09V02RetireIsLockedAtomicAndPreservesTheRecord(t *testing.T) {
	root := freshState(t)
	active := filepath.Join(root, "runs", "run-retire.json")
	retired := filepath.Join(root, "retired", "run-retire.json")
	if err := os.Chmod(active, 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(active, time.Unix(0, fixedMtime), time.Unix(0, fixedMtime)); err != nil {
		t.Fatal(err)
	}
	beforeBytes := mustRead(t, active)
	beforeInfo := mustStat(t, active)

	producer := mustProducer(t, root)
	reader := mustReader(t, root)
	beforeRun, err := reader.Get("run-retire")
	if err != nil {
		t.Fatal(err)
	}
	if beforeRun.Revision != 7 {
		t.Fatalf("fixture revision = %d, want 7", beforeRun.Revision)
	}

	// A shared Registry snapshot excludes an exclusive retirement. The
	// successful operation must therefore perform its rename while holding the
	// same lock as active list/create/update operations.
	lock, err := os.OpenFile(filepath.Join(root, "registry.lock"), os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_SH); err != nil {
		t.Fatal(err)
	}
	type result struct {
		run vaultregistry.Run
		err error
	}
	resultCh := make(chan result, 1)
	go func() {
		run, err := producer.Retire("run-retire", 7)
		resultCh <- result{run: run, err: err}
	}()
	select {
	case got := <-resultCh:
		t.Fatalf("Retire completed outside the Registry lock: run=%#v err=%v", got.run, got.err)
	case <-time.After(200 * time.Millisecond):
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	var got result
	select {
	case got = <-resultCh:
	case <-time.After(5 * time.Second):
		t.Fatal("Retire did not finish after the Registry lock was released")
	}
	if got.err != nil {
		t.Fatal(got.err)
	}
	if !reflect.DeepEqual(got.run, beforeRun) || got.run.Revision != 7 {
		t.Fatalf("Retire result changed the exact revision\nbefore: %#v\nafter:  %#v", beforeRun, got.run)
	}
	if _, err := os.Lstat(active); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("active path survived retirement: %v", err)
	}
	afterInfo := mustStat(t, retired)
	if !os.SameFile(beforeInfo, afterInfo) {
		t.Fatal("retirement replaced the active inode instead of atomically renaming it")
	}
	if afterInfo.Mode() != beforeInfo.Mode() {
		t.Fatalf("retired mode = %v, want preserved %v", afterInfo.Mode(), beforeInfo.Mode())
	}
	if afterInfo.ModTime().UnixNano() != beforeInfo.ModTime().UnixNano() {
		t.Fatalf("retired mtime = %d, want preserved %d", afterInfo.ModTime().UnixNano(), beforeInfo.ModTime().UnixNano())
	}
	if after := mustRead(t, retired); !bytes.Equal(after, beforeBytes) {
		t.Fatal("retirement rewrote the persisted bytes")
	}

	assertActiveAPIsDoNotFallback(t, producer, reader, beforeRun)
	fromRetired, err := reader.GetRetired("run-retire")
	if err != nil || !reflect.DeepEqual(fromRetired, beforeRun) {
		t.Fatalf("GetRetired = %#v, %v; want exact retired Run", fromRetired, err)
	}

	// Retrying the same identity and exact revision is idempotent. It neither
	// recreates an active record nor replaces/touches the retired inode.
	beforeRetry := treeManifest(t, root)
	retryInfo := mustStat(t, retired)
	retry, err := producer.Retire("run-retire", 7)
	if err != nil || !reflect.DeepEqual(retry, beforeRun) {
		t.Fatalf("idempotent Retire = %#v, %v", retry, err)
	}
	if after := treeManifest(t, root); after != beforeRetry {
		t.Fatalf("idempotent Retire changed Registry\nbefore %s\nafter  %s", beforeRetry, after)
	}
	if !os.SameFile(retryInfo, mustStat(t, retired)) {
		t.Fatal("idempotent Retire replaced the retired inode")
	}

	beforeRejected := treeManifest(t, root)
	if _, err := producer.Retire("run-retire", 6); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("retired revision mismatch error = %v, want ErrConflict", err)
	}
	reserved := beforeRun
	reserved.Revision = 0
	if _, err := producer.Create(reserved); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("Create with retired Run ID error = %v, want ErrConflict", err)
	}
	if after := treeManifest(t, root); after != beforeRejected {
		t.Fatalf("rejected reuse changed Registry\nbefore %s\nafter  %s", beforeRejected, after)
	}
}

func assertActiveAPIsDoNotFallback(t *testing.T, producer *vaultregistry.Producer, reader *vaultregistry.Reader, retired vaultregistry.Run) {
	t.Helper()
	for name, get := range map[string]func() (vaultregistry.Run, error){
		"Producer.Get": func() (vaultregistry.Run, error) { return producer.Get(retired.RunID) },
		"Reader.Get":   func() (vaultregistry.Run, error) { return reader.Get(retired.RunID) },
	} {
		if _, err := get(); !errors.Is(err, vaultregistry.ErrNotFound) {
			t.Fatalf("%s retired lookup error = %v, want ErrNotFound", name, err)
		}
	}
	mutated := false
	if _, err := producer.Update(retired.RunID, retired.Revision, func(*vaultregistry.Run) error {
		mutated = true
		return nil
	}); !errors.Is(err, vaultregistry.ErrNotFound) {
		t.Fatalf("Update retired Run error = %v, want ErrNotFound", err)
	}
	if mutated {
		t.Fatal("Update callback ran against a retired Run")
	}
	runs, err := reader.List()
	if err != nil || !reflect.DeepEqual(runIDs(runs), []string{"run-stable"}) {
		t.Fatalf("active List IDs = %v, err=%v", runIDs(runs), err)
	}
	summaries, err := reader.ListSummaries(vaultregistry.ListFilter{})
	if err != nil || !reflect.DeepEqual(summaryIDs(summaries), []string{"run-stable"}) {
		t.Fatalf("active ListSummaries IDs = %v, err=%v", summaryIDs(summaries), err)
	}
}

func TestT09V02RetireRejectsEveryNonCanonicalSourceOrDestination(t *testing.T) {
	tests := []struct {
		name     string
		expected uint64
		setup    func(*testing.T, string)
		want     error
	}{
		{name: "zero expected revision", expected: 0, want: vaultregistry.ErrMalformed},
		{name: "stale expected revision", expected: 6, want: vaultregistry.ErrConflict},
		{name: "future expected revision", expected: 8, want: vaultregistry.ErrConflict},
		{name: "malformed active record", expected: 7, want: vaultregistry.ErrMalformed, setup: func(t *testing.T, root string) {
			mustWrite(t, filepath.Join(root, "runs", "run-retire.json"), []byte("{not-json\n"), 0610)
		}},
		{name: "active identity mismatch", expected: 7, want: vaultregistry.ErrMalformed, setup: func(t *testing.T, root string) {
			path := filepath.Join(root, "runs", "run-retire.json")
			value := decodeObject(t, mustRead(t, path))
			value["run_id"] = "different-id"
			mustWriteJSON(t, path, value, 0620)
		}},
		{name: "matching active and retired both exist", expected: 7, want: vaultregistry.ErrConflict, setup: func(t *testing.T, root string) {
			mustWrite(t, filepath.Join(root, "retired", "run-retire.json"), mustRead(t, filepath.Join(root, "runs", "run-retire.json")), 0630)
		}},
		{name: "different retired destination collision", expected: 7, want: vaultregistry.ErrConflict, setup: func(t *testing.T, root string) {
			path := filepath.Join(root, "retired", "run-retire.json")
			value := decodeObject(t, mustRead(t, filepath.Join(root, "runs", "run-retire.json")))
			value["revision"] = float64(9)
			value["updated_at"] = "2026-07-26T12:09:00Z"
			mustWriteJSON(t, path, value, 0640)
		}},
		{name: "retired destination directory collision", expected: 7, want: vaultregistry.ErrConflict, setup: func(t *testing.T, root string) {
			if err := os.Mkdir(filepath.Join(root, "retired", "run-retire.json"), 0750); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "retired destination symlink collision", expected: 7, want: vaultregistry.ErrConflict, setup: func(t *testing.T, root string) {
			if err := os.Symlink("run-reserved.json", filepath.Join(root, "retired", "run-retire.json")); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := freshState(t)
			producer := mustProducer(t, root)
			if tc.setup != nil {
				tc.setup(t, root)
			}
			before := treeManifest(t, root)
			if _, err := producer.Retire("run-retire", tc.expected); !errors.Is(err, tc.want) {
				t.Fatalf("Retire error = %v, want %v", err, tc.want)
			}
			if after := treeManifest(t, root); after != before {
				t.Fatalf("failed Retire replaced state\nbefore %s\nafter  %s", before, after)
			}
		})
	}

	t.Run("malformed retired retry", func(t *testing.T) {
		root := freshState(t)
		producer := mustProducer(t, root)
		active := filepath.Join(root, "runs", "run-retire.json")
		if err := os.Remove(active); err != nil {
			t.Fatal(err)
		}
		retired := filepath.Join(root, "retired", "run-retire.json")
		mustWrite(t, retired, []byte("{not-json\n"), 0640)
		before := treeManifest(t, root)
		if _, err := producer.Retire("run-retire", 7); !errors.Is(err, vaultregistry.ErrMalformed) {
			t.Fatalf("Retire malformed retired error = %v, want ErrMalformed", err)
		}
		if after := treeManifest(t, root); after != before {
			t.Fatalf("malformed retired retry changed state\nbefore %s\nafter  %s", before, after)
		}
	})
}

func TestT09V02RetiredNamespaceIsExplicitAndInitiallyAbsent(t *testing.T) {
	absent := filepath.Join(t.TempDir(), "absent")
	reader := mustReader(t, absent)
	if _, err := reader.GetRetired("missing"); !errors.Is(err, vaultregistry.ErrNotFound) {
		t.Fatalf("GetRetired absent Registry error = %v, want ErrNotFound", err)
	}
	if _, err := os.Lstat(absent); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("GetRetired created absent Registry: %v", err)
	}

	root := t.TempDir()
	producer := mustProducer(t, root)
	reader = mustReader(t, root)
	retiredDir := filepath.Join(root, "retired")
	if _, err := os.Lstat(retiredDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("OpenProducer eagerly created retired namespace: %v", err)
	}
	if _, err := reader.GetRetired("missing"); !errors.Is(err, vaultregistry.ErrNotFound) {
		t.Fatalf("GetRetired missing namespace error = %v, want ErrNotFound", err)
	}
	if runs, err := reader.List(); err != nil || len(runs) != 0 {
		t.Fatalf("List without retired namespace = %#v, %v", runs, err)
	}
	if _, err := os.Lstat(retiredDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retired read/list created namespace: %v", err)
	}

	run := newRun("first-retired", "2026-07-26T13:00:00Z")
	created, err := producer.Create(run)
	if err != nil || created.Revision != 1 {
		t.Fatalf("Create = revision %d, %v", created.Revision, err)
	}
	if _, err := producer.Retire(run.RunID, 1); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(retiredDir); err != nil || !info.IsDir() {
		t.Fatalf("first Retire did not create retired namespace: %v, %v", info, err)
	}
}

func TestT09V02CLIRequiresExactRevisionAndSeparatesRetiredReads(t *testing.T) {
	binary := requiredEnv(t, "T09_V02_BINARY")
	root := freshState(t)
	mustProducer(t, root) // Normalize producer-owned directory modes before no-op manifests.

	for name, request := range map[string]map[string]any{
		"missing": {"action": "retire", "root": root, "run_id": "run-retire"},
		"zero":    {"action": "retire", "root": root, "run_id": "run-retire", "expected_revision": 0},
		"stale":   {"action": "retire", "root": root, "run_id": "run-retire", "expected_revision": 6},
	} {
		before := treeManifest(t, root)
		stdout, stderr, status := invoke(t, binary, request)
		if status != 1 || len(stdout) != 0 {
			t.Fatalf("%s retire = status %d stdout %q stderr %q", name, status, stdout, stderr)
		}
		classification := "malformed run"
		if name == "stale" {
			classification = "revision conflict"
		}
		if !strings.Contains(string(stderr), classification) {
			t.Fatalf("%s retire stderr = %q, want %q", name, stderr, classification)
		}
		if after := treeManifest(t, root); after != before {
			t.Fatalf("%s retire changed Registry", name)
		}
	}

	request := map[string]any{"action": "retire", "root": root, "run_id": "run-retire", "expected_revision": 7}
	stdout, stderr, status := invoke(t, binary, request)
	if status != 0 || len(stderr) != 0 {
		t.Fatalf("exact retire = status %d stdout %q stderr %q", status, stdout, stderr)
	}
	retired := decodeRun(t, stdout)
	if retired.RunID != "run-retire" || retired.Revision != 7 {
		t.Fatalf("exact retire response = %#v", retired)
	}
	firstManifest := treeManifest(t, root)
	stdout2, stderr, status := invoke(t, binary, request)
	if status != 0 || len(stderr) != 0 || !reflect.DeepEqual(decodeRun(t, stdout2), retired) {
		t.Fatalf("idempotent CLI retire = status %d stdout %q stderr %q", status, stdout2, stderr)
	}
	if treeManifest(t, root) != firstManifest {
		t.Fatal("idempotent CLI retire changed Registry")
	}

	stdout, stderr, status = invoke(t, binary, map[string]any{"action": "get-retired", "root": root, "run_id": "run-retire"})
	if status != 0 || len(stderr) != 0 || !reflect.DeepEqual(decodeRun(t, stdout), retired) {
		t.Fatalf("get-retired = status %d stdout %q stderr %q", status, stdout, stderr)
	}
	for _, activeRequest := range []map[string]any{
		{"action": "get", "root": root, "run_id": "run-retire"},
		{"action": "append", "root": root, "run_id": "run-retire", "updated_at": "2026-07-26T12:08:00Z", "lifecycle": map[string]any{"observation_id": "must-not-append", "observed_at": "2026-07-26T12:08:00Z", "kind": "test"}},
	} {
		stdout, stderr, status = invoke(t, binary, activeRequest)
		if status != 1 || len(stdout) != 0 || !strings.Contains(string(stderr), "run not found") {
			t.Fatalf("active action fell back: request=%v status=%d stdout=%q stderr=%q", activeRequest, status, stdout, stderr)
		}
	}
	stdout, stderr, status = invoke(t, binary, map[string]any{"action": "list", "root": root})
	if status != 0 || len(stderr) != 0 {
		t.Fatalf("list = status %d stderr %q", status, stderr)
	}
	var summaries []vaultregistry.RunSummary
	if err := json.Unmarshal(stdout, &summaries); err != nil {
		t.Fatal(err)
	}
	if ids := summaryIDs(summaries); !reflect.DeepEqual(ids, []string{"run-stable"}) {
		t.Fatalf("CLI active list IDs = %v", ids)
	}

	create := retired
	create.Revision = 0
	stdout, stderr, status = invoke(t, binary, map[string]any{"action": "create", "root": root, "run": create})
	if status != 1 || len(stdout) != 0 || !strings.Contains(string(stderr), "revision conflict") {
		t.Fatalf("CLI reused retired ID: status=%d stdout=%q stderr=%q", status, stdout, stderr)
	}
	if treeManifest(t, root) != firstManifest {
		t.Fatal("rejected CLI ID reuse changed Registry")
	}

	missingRoot := filepath.Join(t.TempDir(), "absent")
	stdout, stderr, status = invoke(t, binary, map[string]any{"action": "get-retired", "root": missingRoot, "run_id": "missing"})
	if status != 1 || len(stdout) != 0 || !strings.Contains(string(stderr), "run not found") {
		t.Fatalf("absent get-retired = status %d stdout %q stderr %q", status, stdout, stderr)
	}
	if _, err := os.Lstat(missingRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("CLI get-retired created absent Registry: %v", err)
	}
}

func TestT09V02ConcurrentListCreateAppendAndRetireYieldCompleteSnapshots(t *testing.T) {
	binary := requiredEnv(t, "T09_V02_BINARY")
	for round := 0; round < 8; round++ {
		t.Run(fmt.Sprintf("round-%02d", round), func(t *testing.T) {
			root := t.TempDir()
			producer := mustProducer(t, root)
			for _, run := range []vaultregistry.Run{
				newRun("stable", "2026-07-26T14:00:00Z"),
				newRun("append-target", "2026-07-26T14:01:00Z"),
				newRun("retire-target", "2026-07-26T14:02:00Z"),
			} {
				if _, err := producer.Create(run); err != nil {
					t.Fatal(err)
				}
			}

			lock, err := os.OpenFile(filepath.Join(root, "registry.lock"), os.O_RDWR, 0600)
			if err != nil {
				t.Fatal(err)
			}
			if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
				t.Fatal(err)
			}
			requests := []map[string]any{
				{"action": "list", "root": root},
				{"action": "create", "root": root, "run": newRun("create-target", "2026-07-26T14:03:00Z")},
				{"action": "append", "root": root, "run_id": "append-target", "updated_at": "2026-07-26T14:04:00Z", "evidence": map[string]any{"observation_id": "concurrent-evidence", "observed_at": "2026-07-26T14:04:00Z", "verifier_id": "T09.V02", "state": "passed"}},
				{"action": "retire", "root": root, "run_id": "retire-target", "expected_revision": 1},
			}
			pending := make([]*pendingCommand, 0, len(requests))
			for _, request := range requests {
				pending = append(pending, startInvoke(t, binary, request))
			}
			time.Sleep(200 * time.Millisecond)
			for i, process := range pending {
				select {
				case result := <-process.done:
					t.Fatalf("request %d escaped Registry lock: status=%d stdout=%q stderr=%q", i, result.status, result.stdout, result.stderr)
				default:
				}
			}
			if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); err != nil {
				t.Fatal(err)
			}
			if err := lock.Close(); err != nil {
				t.Fatal(err)
			}

			results := make([]commandResult, len(pending))
			for i, process := range pending {
				select {
				case results[i] = <-process.done:
				case <-time.After(10 * time.Second):
					t.Fatalf("request %d did not finish", i)
				}
				if results[i].status != 0 || len(results[i].stderr) != 0 {
					t.Fatalf("request %d = status %d stdout=%q stderr=%q", i, results[i].status, results[i].stdout, results[i].stderr)
				}
			}
			assertConcurrentListSnapshot(t, results[0].stdout)
			if run := decodeRun(t, results[1].stdout); run.RunID != "create-target" || run.Revision != 1 {
				t.Fatalf("create result = %#v", run)
			}
			if run := decodeRun(t, results[2].stdout); run.RunID != "append-target" || run.Revision != 2 || len(run.Evidence) != 1 {
				t.Fatalf("append result = %#v", run)
			}
			if run := decodeRun(t, results[3].stdout); run.RunID != "retire-target" || run.Revision != 1 {
				t.Fatalf("retire result = %#v", run)
			}

			reader := mustReader(t, root)
			active, err := reader.List()
			if err != nil {
				t.Fatal(err)
			}
			if ids := runIDs(active); !reflect.DeepEqual(ids, []string{"append-target", "create-target", "stable"}) {
				t.Fatalf("final active IDs = %v", ids)
			}
			if active[0].Revision != 2 || len(active[0].Evidence) != 1 || active[1].Revision != 1 || active[2].Revision != 1 {
				t.Fatalf("final active snapshot is incomplete: %#v", active)
			}
			if retired, err := reader.GetRetired("retire-target"); err != nil || retired.Revision != 1 {
				t.Fatalf("final retired Run = %#v, %v", retired, err)
			}
		})
	}
}

func assertConcurrentListSnapshot(t *testing.T, data []byte) {
	t.Helper()
	var summaries []vaultregistry.RunSummary
	if err := json.Unmarshal(data, &summaries); err != nil {
		t.Fatalf("decode concurrent list: %v: %s", err, data)
	}
	ids := summaryIDs(summaries)
	if !sort.StringsAreSorted(ids) {
		t.Fatalf("concurrent list is not sorted: %v", ids)
	}
	seen := make(map[string]uint64, len(summaries))
	for _, summary := range summaries {
		seen[summary.RunID] = summary.Revision
		switch summary.RunID {
		case "stable", "retire-target", "create-target":
			if summary.Revision != 1 {
				t.Fatalf("concurrent list observed partial %s revision %d", summary.RunID, summary.Revision)
			}
		case "append-target":
			if summary.Revision != 1 && summary.Revision != 2 {
				t.Fatalf("concurrent list observed partial append revision %d", summary.Revision)
			}
		default:
			t.Fatalf("concurrent list observed unknown Run %q", summary.RunID)
		}
	}
	if seen["stable"] != 1 || seen["append-target"] == 0 {
		t.Fatalf("concurrent list omitted stable preexisting Runs: %v", seen)
	}
}

type commandResult struct {
	stdout, stderr []byte
	status         int
}

type pendingCommand struct{ done <-chan commandResult }

func startInvoke(t *testing.T, binary string, request any) *pendingCommand {
	t.Helper()
	data, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	cmd := exec.Command(binary)
	cmd.Stdin = bytes.NewReader(data)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan commandResult, 1)
	go func() {
		err := cmd.Wait()
		status := 0
		if err != nil {
			var exit *exec.ExitError
			if errors.As(err, &exit) {
				status = exit.ExitCode()
			} else {
				status = -1
			}
		}
		done <- commandResult{stdout: stdout.Bytes(), stderr: stderr.Bytes(), status: status}
	}()
	return &pendingCommand{done: done}
}

func invoke(t *testing.T, binary string, request any) ([]byte, []byte, int) {
	t.Helper()
	pending := startInvoke(t, binary, request)
	select {
	case result := <-pending.done:
		return result.stdout, result.stderr, result.status
	case <-time.After(10 * time.Second):
		t.Fatal("Registry command timed out")
		return nil, nil, -1
	}
}

func freshState(t *testing.T) string {
	t.Helper()
	fixture := filepath.Join(requiredEnv(t, "T09_V02_FIXTURE"), "state")
	root := filepath.Join(t.TempDir(), "state")
	copyTree(t, fixture, root)
	if err := os.Chmod(filepath.Join(root, "registry.lock"), 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func copyTree(t *testing.T, source, destination string) {
	t.Helper()
	if err := filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if info.Mode()&os.ModeSymlink != 0 {
			value, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(value, target)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode().Perm())
	}); err != nil {
		t.Fatal(err)
	}
}

func treeManifest(t *testing.T, root string) string {
	t.Helper()
	hash := sha256.New()
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		fmt.Fprintf(hash, "%s\x00%v\x00%o\x00%d\x00", rel, info.Mode().Type(), info.Mode().Perm(), info.ModTime().UnixNano())
		if info.Mode()&os.ModeSymlink != 0 {
			value, err := os.Readlink(path)
			if err != nil {
				return err
			}
			hash.Write([]byte(value))
		} else if info.Mode().IsRegular() {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			hash.Write(data)
		}
		hash.Write([]byte{0})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func newRun(id, timestamp string) vaultregistry.Run {
	return vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         id,
		InvokedAt:     timestamp,
		UpdatedAt:     timestamp,
		Task: vaultregistry.Task{
			ID: "T09", Title: "Concurrent retirement snapshot", Path: "tasks/09.md",
			FeaturePath: "features/vault-hunter-atlas/feature.md", Kind: "task",
		},
	}
}

func runIDs(runs []vaultregistry.Run) []string {
	ids := make([]string, len(runs))
	for i := range runs {
		ids[i] = runs[i].RunID
	}
	return ids
}

func summaryIDs(summaries []vaultregistry.RunSummary) []string {
	ids := make([]string, len(summaries))
	for i := range summaries {
		ids[i] = summaries[i].RunID
	}
	return ids
}

func mustProducer(t *testing.T, root string) *vaultregistry.Producer {
	t.Helper()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	return producer
}

func mustReader(t *testing.T, root string) *vaultregistry.Reader {
	t.Helper()
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	return reader
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func mustWrite(t *testing.T, path string, data []byte, mode fs.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, data, mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
}

func mustWriteJSON(t *testing.T, path string, value any, mode fs.FileMode) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, path, append(data, '\n'), mode)
}

func mustStat(t *testing.T, path string) os.FileInfo {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func decodeObject(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func decodeRun(t *testing.T, data []byte) vaultregistry.Run {
	t.Helper()
	var run vaultregistry.Run
	if err := json.Unmarshal(data, &run); err != nil {
		t.Fatalf("decode Run: %v: %s", err, data)
	}
	return run
}

func requiredEnv(t *testing.T, name string) string {
	t.Helper()
	value := os.Getenv(name)
	if value == "" {
		t.Fatalf("%s is required", name)
	}
	return value
}
