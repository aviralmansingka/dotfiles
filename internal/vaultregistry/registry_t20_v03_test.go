package vaultregistry_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT20V03ExactRevisionRetirementReplayAndWriteRejection(t *testing.T) {
	sandbox := t.TempDir()
	root := filepath.Join(sandbox, "registry")
	producer := mustProducer(t, root)
	request := t20CreateFixture(t, "hunter")
	request.Run.Unknown = unknown("future_run_field", `{"preserved":true}`)
	request.Run.WorkReference.Unknown = unknown("future_work_field", `"preserved"`)
	request.InitialDriver.Unknown = unknown("future_observation_field", `17`)
	created, err := producer.CreateRun(request)
	if err != nil {
		t.Fatal(err)
	}
	active, err := producer.Update(created.RunID, created.Revision, func(run *vaultregistry.Run) error {
		run.Stage = "implementation"
		run.UpdatedAt = "2026-07-30T00:01:00Z"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"herdr", "git", "vault"} {
		if err := os.WriteFile(filepath.Join(sandbox, name+".sentinel"), []byte(name+"-stable\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	unrelated := filepath.Join(root, "registry.sentinel")
	if err := os.WriteFile(unrelated, []byte("registry-stable\n"), 0600); err != nil {
		t.Fatal(err)
	}
	isolationBefore := t20V03IsolationManifest(t, sandbox)
	registryBefore := t20Manifest(t, root)
	t.Logf("T20.V03_TRANSITION_REQUEST run_id=%s expected_revision=%d", active.RunID, active.Revision)
	t.Logf("T20.V03_REGISTRY_MANIFEST phase=before data=%s", registryBefore)
	t.Logf("T20.V03_ISOLATION_MANIFEST phase=before data=%s", isolationBefore)

	observationsBefore := t20V03Hash(t, active.Observations)
	unknownBefore := t20V03Hash(t, []string{
		t20V03Hash(t, active.Unknown),
		t20V03Hash(t, active.WorkReference.Unknown),
		t20V03Hash(t, active.Observations[0].Unknown),
	})
	retired, err := producer.Retire(active.RunID, active.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if retired.Revision != active.Revision+1 || retired.State != vaultregistry.RunStateRetired || retired.RetiredAt == nil || retired.UpdatedAt != *retired.RetiredAt {
		t.Fatalf("retired transition = %#v", retired)
	}
	if retired.Stage != active.Stage || retired.RunID != active.RunID || retired.Name != active.Name || retired.RunKind != active.RunKind ||
		retired.InvokedAt != active.InvokedAt || !reflect.DeepEqual(retired.WorkReference, active.WorkReference) ||
		!reflect.DeepEqual(retired.Observations, active.Observations) || !reflect.DeepEqual(retired.Unknown, active.Unknown) {
		t.Fatal("retirement changed immutable identity, stage, history, or unknown fields")
	}
	observationsAfter := t20V03Hash(t, retired.Observations)
	unknownAfter := t20V03Hash(t, []string{
		t20V03Hash(t, retired.Unknown),
		t20V03Hash(t, retired.WorkReference.Unknown),
		t20V03Hash(t, retired.Observations[0].Unknown),
	})
	if observationsAfter != observationsBefore || unknownAfter != unknownBefore {
		t.Fatal("retirement changed history or unknown-field evidence hashes")
	}
	t.Logf("T20.V03_TRANSITION_RESPONSE run_id=%s revision=%d state=%s stage=%s retired_at=%s", retired.RunID, retired.Revision, retired.State, retired.Stage, *retired.RetiredAt)
	t.Logf("T20.V03_RETIREMENT_PRESERVATION run_id=%s revision=%d observations_before_sha256=%s observations_after_sha256=%s observations_equal=true unknown_before_sha256=%s unknown_after_sha256=%s unknown_equal=true", retired.RunID, retired.Revision, observationsBefore, observationsAfter, unknownBefore, unknownAfter)

	reader := mustReader(t, root)
	if _, err := reader.Get(active.RunID); !errors.Is(err, vaultregistry.ErrNotFound) {
		t.Fatalf("active exact read error = %v, want ErrNotFound", err)
	}
	if listed, err := reader.ListSummaries(vaultregistry.ListFilter{}); err != nil || len(listed) != 0 {
		t.Fatalf("default active list = %#v, %v", listed, err)
	}
	exact, err := reader.GetRetired(active.Name)
	if err != nil || !reflect.DeepEqual(exact, retired) {
		t.Fatalf("exact retired read = %#v, %v", exact, err)
	}
	t.Logf("T20.V03_RETIRED_EXACT_READ lookup=%s run_id=%s revision=%d state=%s result_sha256=%s", active.Name, exact.RunID, exact.Revision, exact.State, t20V03Hash(t, exact))

	retiredPath := filepath.Join(root, "retired", active.RunID+".json")
	beforeReplay, beforeInfo := t20V03BytesAndInfo(t, retiredPath)
	replayed, err := producer.Retire(active.RunID, active.Revision)
	if err != nil || !reflect.DeepEqual(replayed, retired) {
		t.Fatalf("exact replay = %#v, %v", replayed, err)
	}
	afterReplay, afterInfo := t20V03BytesAndInfo(t, retiredPath)
	if !bytes.Equal(beforeReplay, afterReplay) || !os.SameFile(beforeInfo, afterInfo) {
		t.Fatal("exact retirement replay wrote the retired record")
	}
	digest := sha256.Sum256(beforeReplay)
	t.Logf("T20.V03_REPLAY_IDENTITY run_id=%s expected_revision=%d revision=%d sha256=%s inode_same=true bytes_unchanged=true", active.RunID, active.Revision, replayed.Revision, hex.EncodeToString(digest[:]))

	for _, tc := range []struct {
		name     string
		expected uint64
	}{
		{"stale", active.Revision - 1},
		{"repeated-current", retired.Revision},
		{"future", retired.Revision + 1},
	} {
		stable := t20Manifest(t, root)
		if _, err := producer.Retire(active.RunID, tc.expected); !errors.Is(err, vaultregistry.ErrConflict) {
			t.Fatalf("%s retirement error = %v, want ErrConflict", tc.name, err)
		}
		if after := t20Manifest(t, root); after != stable {
			t.Fatalf("%s retirement changed Registry", tc.name)
		}
		t.Logf("T20.V03_CONFLICT case=%s classification=revision_conflict expected_revision=%d bytes_unchanged=true", tc.name, tc.expected)
	}

	writeCases := []struct {
		name string
		call func() error
	}{
		{"append", func() error {
			_, err := producer.AppendObservation(active.RunID, active.Revision, "2099-01-01T00:00:00Z", active.Observations[0])
			return err
		}},
		{"update", func() error {
			_, err := producer.Update(active.RunID, retired.Revision, func(*vaultregistry.Run) error {
				t.Fatal("retired update invoked mutation callback")
				return nil
			})
			return err
		}},
		{"create-replay", func() error {
			_, err := producer.CreateRun(request)
			return err
		}},
	}
	for _, tc := range writeCases {
		stable := t20Manifest(t, root)
		if err := tc.call(); !errors.Is(err, vaultregistry.ErrConflict) {
			t.Fatalf("%s after retirement error = %v, want ErrConflict", tc.name, err)
		}
		if after := t20Manifest(t, root); after != stable {
			t.Fatalf("%s after retirement changed Registry", tc.name)
		}
		t.Logf("T20.V03_WRITE_REJECTION producer=%s classification=revision_conflict bytes_unchanged=true", tc.name)
	}

	registryAfter := t20Manifest(t, root)
	isolationAfter := t20V03IsolationManifest(t, sandbox)
	t.Logf("T20.V03_REGISTRY_MANIFEST phase=after data=%s", registryAfter)
	t.Logf("T20.V03_ISOLATION_MANIFEST phase=after data=%s", isolationAfter)
	if isolationAfter != isolationBefore {
		t.Fatal("retirement changed Herdr, Git, vault, or Registry sentinel")
	}
	if got, err := os.ReadFile(unrelated); err != nil || string(got) != "registry-stable\n" {
		t.Fatalf("Registry sentinel changed: %q, %v", got, err)
	}
}

func TestT20V03SchemaV1RetirementPreservesT09BytesAndRevision(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	created, err := producer.Create(baseRun("t20-v03-v1"))
	if err != nil {
		t.Fatal(err)
	}
	activePath := filepath.Join(root, "runs", created.RunID+".json")
	before, beforeInfo := t20V03BytesAndInfo(t, activePath)
	retired, err := producer.Retire(created.RunID, created.Revision)
	if err != nil {
		t.Fatal(err)
	}
	retiredPath := filepath.Join(root, "retired", created.RunID+".json")
	after, afterInfo := t20V03BytesAndInfo(t, retiredPath)
	if retired.Revision != created.Revision || !bytes.Equal(after, before) || !os.SameFile(beforeInfo, afterInfo) {
		t.Fatal("schema-v1 retirement no longer preserves T09 bytes, inode, and revision")
	}
	t.Logf("T20.V03_V1_COMPAT run_id=%s revision=%d bytes_unchanged=true inode_same=true", retired.RunID, retired.Revision)
}

func t20V03Hash(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func t20V03BytesAndInfo(t *testing.T, path string) ([]byte, os.FileInfo) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return data, info
}

func t20V03IsolationManifest(t *testing.T, root string) string {
	t.Helper()
	var rows []byte
	for _, name := range []string{"herdr", "git", "vault"} {
		data, err := os.ReadFile(filepath.Join(root, name+".sentinel"))
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		rows = append(rows, []byte(name+"="+hex.EncodeToString(digest[:])+"\n")...)
	}
	data, err := os.ReadFile(filepath.Join(root, "registry", "registry.sentinel"))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	rows = append(rows, []byte("registry="+hex.EncodeToString(digest[:])+"\n")...)
	return string(rows)
}
