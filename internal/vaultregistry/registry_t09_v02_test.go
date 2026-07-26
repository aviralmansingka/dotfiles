package vaultregistry_test

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"syscall"
	"testing"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT09V02RetirePreservesAndSeparatesExactRun(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	created, err := producer.Create(baseRun("retire-me"))
	if err != nil {
		t.Fatal(err)
	}
	active := filepath.Join(root, "runs", "retire-me.json")
	retired := filepath.Join(root, "retired", "retire-me.json")
	mtime := time.Unix(1777777777, 123456789)
	if err := os.Chmod(active, 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(active, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	beforeBytes, err := os.ReadFile(active)
	if err != nil {
		t.Fatal(err)
	}
	beforeInfo, err := os.Stat(active)
	if err != nil {
		t.Fatal(err)
	}

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
	done := make(chan result, 1)
	go func() {
		run, err := producer.Retire("retire-me", 1)
		done <- result{run, err}
	}()
	select {
	case got := <-done:
		t.Fatalf("Retire escaped Registry lock: %#v, %v", got.run, got.err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	got := <-done
	if got.err != nil || !reflect.DeepEqual(got.run, created) {
		t.Fatalf("Retire = %#v, %v; want %#v", got.run, got.err, created)
	}

	afterInfo, err := os.Stat(retired)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(beforeInfo, afterInfo) || beforeInfo.Mode() != afterInfo.Mode() ||
		beforeInfo.ModTime() != afterInfo.ModTime() {
		t.Fatalf("retired metadata changed: before=%v after=%v", beforeInfo, afterInfo)
	}
	if afterBytes, err := os.ReadFile(retired); err != nil || !bytes.Equal(afterBytes, beforeBytes) {
		t.Fatalf("retired bytes changed: %v", err)
	}
	if info, err := os.Stat(filepath.Join(root, "retired")); err != nil || info.Mode().Perm() != 0700 {
		t.Fatalf("retired namespace mode = %v, %v", info, err)
	}

	reader := mustReader(t, root)
	for name, get := range map[string]func() (vaultregistry.Run, error){
		"Producer.Get": func() (vaultregistry.Run, error) { return producer.Get("retire-me") },
		"Reader.Get":   func() (vaultregistry.Run, error) { return reader.Get("retire-me") },
	} {
		if _, err := get(); !errors.Is(err, vaultregistry.ErrNotFound) {
			t.Fatalf("%s error = %v, want ErrNotFound", name, err)
		}
	}
	mutated := false
	if _, err := producer.Update("retire-me", 1, func(*vaultregistry.Run) error {
		mutated = true
		return nil
	}); !errors.Is(err, vaultregistry.ErrNotFound) || mutated {
		t.Fatalf("Update retired Run = mutated %t, %v; want untouched ErrNotFound", mutated, err)
	}
	if runs, err := reader.List(); err != nil || len(runs) != 0 {
		t.Fatalf("List = %#v, %v", runs, err)
	}
	if runs, err := reader.ListSummaries(vaultregistry.ListFilter{}); err != nil || len(runs) != 0 {
		t.Fatalf("ListSummaries = %#v, %v", runs, err)
	}
	if got, err := reader.GetRetired("retire-me"); err != nil || !reflect.DeepEqual(got, created) {
		t.Fatalf("GetRetired = %#v, %v", got, err)
	}

	retryInfo, err := os.Stat(retired)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := producer.Retire("retire-me", 1); err != nil || !reflect.DeepEqual(got, created) {
		t.Fatalf("idempotent Retire = %#v, %v", got, err)
	}
	if !os.SameFile(retryInfo, mustFileInfo(t, retired)) {
		t.Fatal("idempotent Retire replaced retired inode")
	}
	if _, err := producer.Retire("retire-me", 2); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("revision mismatch error = %v, want ErrConflict", err)
	}
	created.Revision = 0
	if _, err := producer.Create(created); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("retired ID reuse error = %v, want ErrConflict", err)
	}
}

func TestT09V02RetireFailuresAreNonDestructive(t *testing.T) {
	for _, tc := range []struct {
		name     string
		expected uint64
		setup    func(*testing.T, string)
		want     error
	}{
		{name: "zero revision", want: vaultregistry.ErrMalformed},
		{name: "revision mismatch", expected: 2, want: vaultregistry.ErrConflict},
		{name: "malformed active", expected: 1, want: vaultregistry.ErrMalformed, setup: func(t *testing.T, root string) {
			if err := os.WriteFile(filepath.Join(root, "runs", "run.json"), []byte("{bad\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "duplicate destination", expected: 1, want: vaultregistry.ErrConflict, setup: func(t *testing.T, root string) {
			if err := os.Mkdir(filepath.Join(root, "retired"), 0700); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(filepath.Join(root, "runs", "run.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "retired", "run.json"), data, 0600); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			producer := mustProducer(t, root)
			if _, err := producer.Create(baseRun("run")); err != nil {
				t.Fatal(err)
			}
			if tc.setup != nil {
				tc.setup(t, root)
			}
			before := registrySnapshot(t, root)
			if _, err := producer.Retire("run", tc.expected); !errors.Is(err, tc.want) {
				t.Fatalf("Retire error = %v, want %v", err, tc.want)
			}
			if after := registrySnapshot(t, root); !reflect.DeepEqual(after, before) {
				t.Fatalf("failed Retire changed Registry\nbefore=%#v\nafter=%#v", before, after)
			}
		})
	}
}

func mustFileInfo(t *testing.T, path string) os.FileInfo {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func registrySnapshot(t *testing.T, root string) map[string]string {
	t.Helper()
	got := map[string]string{}
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
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
		got[rel] = info.Mode().String()
		if info.Mode().IsRegular() {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			got[rel] += string(data)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return got
}
