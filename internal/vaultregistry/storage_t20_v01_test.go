package vaultregistry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func t20InternalRequest(t *testing.T) CreateRequest {
	t.Helper()
	data, err := os.ReadFile("../../scripts/fixtures/vault-hunter-registry-v2/t20-v01-hunter-create.json")
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Run           Run         `json:"run"`
		InitialDriver Observation `json:"initial_driver"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	return CreateRequest{Run: wire.Run, InitialDriver: wire.InitialDriver}
}

func TestT20V01PersistenceFailuresRollbackEveryByte(t *testing.T) {
	for _, tc := range []struct {
		name         string
		evidenceCase string
		fault        func() func()
	}{
		{"interrupted rename", "persistence-interrupted-rename", func() func() {
			prior := createRename
			createRename = func(string, string) error { return errors.New("interrupted create") }
			return func() { createRename = prior }
		}},
		{"directory fsync", "persistence-directory-fsync", func() func() {
			prior := syncCreateDirectory
			syncCreateDirectory = func(string) error { return errors.New("directory fsync failed") }
			return func() { syncCreateDirectory = prior }
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			producer, err := OpenProducer(root)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "registry.lock"), nil, 0600); err != nil {
				t.Fatal(err)
			}
			before, err := directoryManifest(root)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("T20.V01_REGISTRY_MANIFEST case=%s phase=before data=%q", tc.evidenceCase, before)
			restore := tc.fault()
			defer restore()
			if _, err := producer.CreateRun(t20InternalRequest(t)); err == nil {
				t.Fatal("faulted create unexpectedly succeeded")
			}
			after, err := directoryManifest(root)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("T20.V01_REGISTRY_MANIFEST case=%s phase=after data=%q", tc.evidenceCase, after)
			if after != before {
				t.Fatalf("failed create changed Registry\nbefore=%q\nafter=%q", before, after)
			}
			entries, err := os.ReadDir(filepath.Join(root, "runs"))
			if err != nil || len(entries) != 0 {
				t.Fatalf("failed create left run or temporary bytes: %v, %v", entries, err)
			}
		})
	}

	t.Run("lock failure", func(t *testing.T) {
		root := t.TempDir()
		producer, err := OpenProducer(root)
		if err != nil {
			t.Fatal(err)
		}
		lock := filepath.Join(root, "registry.lock")
		if err := os.WriteFile(lock, nil, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(lock); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(lock, 0700); err != nil {
			t.Fatal(err)
		}
		before, err := directoryManifest(root)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := producer.CreateRun(t20InternalRequest(t)); err == nil {
			t.Fatal("lock failure unexpectedly succeeded")
		}
		after, err := directoryManifest(root)
		if err != nil || after != before {
			t.Fatalf("lock failure changed Registry: before=%q after=%q err=%v", before, after, err)
		}
	})
}
