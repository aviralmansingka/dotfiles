package vaultregistry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRetireV2FaultBoundariesRollbackOrReplay(t *testing.T) {
	fault := errors.New("injected retirement failure")
	cases := []struct {
		name string
		set  func() func()
	}{
		{"write", func() func() {
			prior := retireWriteTemp
			retireWriteTemp = func(string, []byte) (string, error) { return "", fault }
			return func() { retireWriteTemp = prior }
		}},
		{"rename", func() func() {
			prior := retireRename
			retireRename = func(string, string) error { return fault }
			return func() { retireRename = prior }
		}},
		{"retired directory sync", func() func() {
			prior := retireSyncDirectory
			retireSyncDirectory = func(string) error { return fault }
			return func() { retireSyncDirectory = prior }
		}},
		{"active remove", func() func() {
			prior := retireRemove
			retireRemove = func(string) error { return fault }
			return func() { retireRemove = prior }
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			producer, err := OpenProducer(root)
			if err != nil {
				t.Fatal(err)
			}
			created, err := producer.CreateRun(t20InternalRequest(t))
			if err != nil {
				t.Fatal(err)
			}
			activePath := producer.path(created.RunID)
			before, err := os.ReadFile(activePath)
			if err != nil {
				t.Fatal(err)
			}
			restore := tc.set()
			_, retireErr := producer.Retire(created.RunID, created.Revision)
			restore()
			if retireErr == nil {
				t.Fatal("faulted retirement succeeded")
			}
			after, err := os.ReadFile(activePath)
			if err != nil || string(after) != string(before) {
				t.Fatalf("active record changed: %v", err)
			}
			if _, err := os.Stat(producer.retiredPath(created.RunID)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("failed retirement left retired record: %v", err)
			}
			if got, err := producer.Retire(created.RunID, created.Revision); err != nil || got.State != RunStateRetired {
				t.Fatalf("retry = %#v, %v", got, err)
			}
		})
	}

	t.Run("active directory sync is replayable", func(t *testing.T) {
		root := t.TempDir()
		producer, err := OpenProducer(root)
		if err != nil {
			t.Fatal(err)
		}
		created, err := producer.CreateRun(t20InternalRequest(t))
		if err != nil {
			t.Fatal(err)
		}
		prior := retireSyncDirectory
		calls := 0
		retireSyncDirectory = func(path string) error {
			calls++
			if calls == 2 {
				return fault
			}
			return prior(path)
		}
		_, retireErr := producer.Retire(created.RunID, created.Revision)
		retireSyncDirectory = prior
		if retireErr == nil {
			t.Fatal("active directory sync fault succeeded")
		}
		if _, err := os.Stat(producer.path(created.RunID)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("active record remains: %v", err)
		}
		if got, err := producer.Retire(created.RunID, created.Revision); err != nil || got.State != RunStateRetired {
			t.Fatalf("post-sync replay = %#v, %v", got, err)
		}
	})
}

func TestRetireV2RecoversExactCrashIntermediate(t *testing.T) {
	root := t.TempDir()
	producer, err := OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	active, err := producer.CreateRun(t20InternalRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	retired := active
	retired.Revision++
	retired.State = RunStateRetired
	retired.UpdatedAt = "2026-07-30T05:00:00Z"
	retired.RetiredAt = &retired.UpdatedAt
	if err := os.Mkdir(filepath.Join(root, "retired"), 0700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(retired)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(producer.retiredPath(active.RunID), append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := producer.Retire(active.RunID, active.Revision)
	if err != nil || !equalJSON(got, retired) {
		t.Fatalf("crash recovery = %#v, %v", got, err)
	}
	if _, err := os.Stat(producer.path(active.RunID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("recovery retained active record: %v", err)
	}
}

func TestReaderExactReadsShareRetirementLock(t *testing.T) {
	for _, retiredRead := range []bool{false, true} {
		name := "active"
		if retiredRead {
			name = "retired"
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			producer, err := OpenProducer(root)
			if err != nil {
				t.Fatal(err)
			}
			created, err := producer.CreateRun(t20InternalRequest(t))
			if err != nil {
				t.Fatal(err)
			}
			reader, _ := OpenReader(root)
			prior := retireRename
			entered, release := make(chan struct{}), make(chan struct{})
			retireRename = func(oldPath, newPath string) error {
				close(entered)
				<-release
				return prior(oldPath, newPath)
			}
			retiredDone := make(chan error, 1)
			go func() {
				_, err := producer.Retire(created.RunID, created.Revision)
				retiredDone <- err
			}()
			<-entered
			readDone := make(chan error, 1)
			go func() {
				var readErr error
				if retiredRead {
					_, readErr = reader.GetRetired(created.RunID)
				} else {
					_, readErr = reader.Get(created.RunID)
				}
				readDone <- readErr
			}()
			select {
			case err := <-readDone:
				t.Fatalf("exact read escaped retirement lock: %v", err)
			case <-time.After(50 * time.Millisecond):
			}
			close(release)
			if err := <-retiredDone; err != nil {
				t.Fatal(err)
			}
			retireRename = prior
			readErr := <-readDone
			if retiredRead && readErr != nil {
				t.Fatalf("retired read = %v", readErr)
			}
			if !retiredRead && !errors.Is(readErr, ErrNotFound) {
				t.Fatalf("active read = %v, want ErrNotFound", readErr)
			}
		})
	}
}

func TestRuntimeNeutralSummaryOmitsLegacyTask(t *testing.T) {
	root := t.TempDir()
	producer, err := OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := producer.CreateRun(t20InternalRequest(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := producer.Create(Run{SchemaVersion: 1, RunID: "summary-v1", InvokedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z", Task: Task{ID: "T1", Title: "one", Path: "one.md", FeaturePath: "feature.md", Kind: "task"}}); err != nil {
		t.Fatal(err)
	}
	legacyData, err := os.ReadFile("../../scripts/fixtures/vault-hunter-registry-v2/t20-v02-legacy-version-2.json")
	if err != nil {
		t.Fatal(err)
	}
	var legacy Run
	if err := json.Unmarshal(legacyData, &legacy); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(producer.path(legacy.RunID), legacyData, 0600); err != nil {
		t.Fatal(err)
	}
	reader, _ := OpenReader(root)
	summaries, err := reader.ListSummaries(ListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(summaries)
	if err != nil {
		t.Fatal(err)
	}
	var wire []map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	for _, summary := range wire {
		var id string
		_ = json.Unmarshal(summary["run_id"], &id)
		_, hasTask := summary["task"]
		if id == "run-hunter-043" && hasTask {
			t.Fatal("runtime-neutral summary emitted legacy task")
		}
		if (id == "summary-v1" || id == legacy.RunID) && !hasTask {
			t.Fatalf("legacy summary %s omitted task", id)
		}
	}
}
