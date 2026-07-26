package vaultregistry

import (
	"os"
	"path/filepath"
	"testing"
)

func TestT06V01ReaderListIsSortedAndReadOnly(t *testing.T) {
	root := t.TempDir()
	producer, err := OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"z-run", "a-run"} {
		_, err := producer.Create(Run{SchemaVersion: 1, RunID: id, InvokedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z", Task: Task{ID: "T01", Title: "task", Path: "tasks/one.md", FeaturePath: "feature.md", Kind: "task"}})
		if err != nil {
			t.Fatal(err)
		}
	}
	before, err := directoryManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	runs, err := reader.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 || runs[0].RunID != "a-run" || runs[1].RunID != "z-run" {
		t.Fatalf("unexpected order: %#v", runs)
	}
	after, err := directoryManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("Reader.List changed Registry: before %q after %q", before, after)
	}
}

func directoryManifest(root string) (string, error) {
	var result string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		result += rel + ":" + string(data)
		return nil
	})
	return result, err
}
