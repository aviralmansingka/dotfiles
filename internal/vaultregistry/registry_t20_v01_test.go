package vaultregistry_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const t20V01FixtureRoot = "../../scripts/fixtures/vault-hunter-registry-v2"
const t20V01GoldenRoot = "../../scripts/goldens/vault-hunter-registry-v2"

func t20CreateFixture(t *testing.T, kind string) vaultregistry.CreateRequest {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(t20V01FixtureRoot, "t20-v01-"+kind+"-create.json"))
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Run           vaultregistry.Run         `json:"run"`
		InitialDriver vaultregistry.Observation `json:"initial_driver"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	return vaultregistry.CreateRequest{Run: wire.Run, InitialDriver: wire.InitialDriver}
}

func t20CloneRequest(t *testing.T, request vaultregistry.CreateRequest) vaultregistry.CreateRequest {
	t.Helper()
	data, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var cloned vaultregistry.CreateRequest
	if err := json.Unmarshal(data, &cloned); err != nil {
		t.Fatal(err)
	}
	return cloned
}

func t20Manifest(t *testing.T, root string) string {
	t.Helper()
	var rows []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			rows = append(rows, fmt.Sprintf("d %04o %s", info.Mode().Perm(), rel))
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(data)
		rows = append(rows, fmt.Sprintf("f %04o %s %s", info.Mode().Perm(), rel, hex.EncodeToString(digest[:])))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(rows)
	data, _ := json.Marshal(rows)
	return string(data)
}

func TestT20V01ScoutAndHunterCreateRoundTripAndReplay(t *testing.T) {
	for _, kind := range []string{"scout", "hunter"} {
		t.Run(kind, func(t *testing.T) {
			request := t20CreateFixture(t, kind)
			root := t.TempDir()
			producer := mustProducer(t, root)
			created, err := producer.CreateRun(request)
			if err != nil {
				t.Fatal(err)
			}
			if created.Revision != 1 || created.State != vaultregistry.RunStateActive || string(created.RunKind) != kind ||
				created.WorkReference == nil || len(created.Observations) != 1 || created.Observations[0].Payload.RegisteredParticipant == nil ||
				created.Observations[0].Payload.RegisteredParticipant.Role != "driver" {
				t.Fatalf("incomplete atomic create: %#v", created)
			}
			persisted, err := mustReader(t, root).Get(created.RunID)
			if err != nil || !equalRunJSON(created, persisted) {
				t.Fatalf("round trip = %#v, %v", persisted, err)
			}
			golden, err := os.ReadFile(filepath.Join(t20V01GoldenRoot, "t20-v01-"+kind+"-response.json"))
			if err != nil {
				t.Fatal(err)
			}
			actual, _ := json.Marshal(created)
			actual = append(actual, '\n')
			if !bytes.Equal(actual, golden) {
				t.Fatalf("response differs from golden\nactual: %s\ngolden: %s", actual, golden)
			}

			before := t20Manifest(t, root)
			replayed, err := producer.CreateRun(request)
			if err != nil || !equalRunJSON(created, replayed) {
				t.Fatalf("replay = %#v, %v", replayed, err)
			}
			if after := t20Manifest(t, root); after != before {
				t.Fatalf("replay wrote Registry\nbefore=%s\nafter=%s", before, after)
			}

			conflict := t20CloneRequest(t, request)
			conflict.InitialDriver.Payload.RegisteredParticipant.ParticipantID += "-different"
			if _, err := producer.CreateRun(conflict); !errors.Is(err, vaultregistry.ErrConflict) {
				t.Fatalf("conflicting replay error = %v, want ErrConflict", err)
			}
			if after := t20Manifest(t, root); after != before {
				t.Fatalf("conflicting replay wrote Registry\nbefore=%s\nafter=%s", before, after)
			}
		})
	}
}

func TestT20V01RejectsInvalidRunAndDriverWithoutAnyWrite(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*vaultregistry.CreateRequest)
	}{
		{"schema", func(r *vaultregistry.CreateRequest) { r.Run.SchemaVersion = 1 }},
		{"run id", func(r *vaultregistry.CreateRequest) { r.Run.RunID = "" }},
		{"name", func(r *vaultregistry.CreateRequest) { r.Run.Name = "" }},
		{"unknown run kind", func(r *vaultregistry.CreateRequest) { r.Run.RunKind = "other" }},
		{"work id", func(r *vaultregistry.CreateRequest) { r.Run.WorkReference.ID = "" }},
		{"work title", func(r *vaultregistry.CreateRequest) { r.Run.WorkReference.Title = "" }},
		{"work path", func(r *vaultregistry.CreateRequest) { r.Run.WorkReference.Path = "" }},
		{"work feature path", func(r *vaultregistry.CreateRequest) { r.Run.WorkReference.FeaturePath = "" }},
		{"unknown work kind", func(r *vaultregistry.CreateRequest) { r.Run.WorkReference.Kind = "feature" }},
		{"state", func(r *vaultregistry.CreateRequest) { r.Run.State = "retired" }},
		{"stage", func(r *vaultregistry.CreateRequest) { r.Run.Stage = "" }},
		{"invoked at", func(r *vaultregistry.CreateRequest) { r.Run.InvokedAt = "bad" }},
		{"updated at", func(r *vaultregistry.CreateRequest) { r.Run.UpdatedAt = "bad" }},
		{"nonzero revision", func(r *vaultregistry.CreateRequest) { r.Run.Revision = 2 }},
		{"embedded task", func(r *vaultregistry.CreateRequest) { r.Run.Task.ID = "T18" }},
		{"preexisting observation", func(r *vaultregistry.CreateRequest) {
			r.Run.Observations = []vaultregistry.Observation{r.InitialDriver}
		}},
		{"driver kind", func(r *vaultregistry.CreateRequest) { r.InitialDriver.Kind = vaultregistry.KindWorker }},
		{"driver state", func(r *vaultregistry.CreateRequest) { r.InitialDriver.State = vaultregistry.StateSucceeded }},
		{"driver role", func(r *vaultregistry.CreateRequest) { r.InitialDriver.Payload.RegisteredParticipant.Role = "parent" }},
		{"driver participant id", func(r *vaultregistry.CreateRequest) { r.InitialDriver.Payload.RegisteredParticipant.ParticipantID = "" }},
		{"driver session source", func(r *vaultregistry.CreateRequest) {
			r.InitialDriver.Payload.RegisteredParticipant.AgentSession.Source = ""
		}},
		{"driver session kind", func(r *vaultregistry.CreateRequest) {
			r.InitialDriver.Payload.RegisteredParticipant.AgentSession.Kind = ""
		}},
		{"driver session value", func(r *vaultregistry.CreateRequest) {
			r.InitialDriver.Payload.RegisteredParticipant.AgentSession.Value = ""
		}},
		{"driver partial herdr", func(r *vaultregistry.CreateRequest) {
			r.InitialDriver.Payload.RegisteredParticipant.Herdr = &vaultregistry.HerdrIdentity{WorkspaceID: "ws"}
		}},
		{"driver interval", func(r *vaultregistry.CreateRequest) { r.InitialDriver.StartedAt = nil }},
		{"missing driver", func(r *vaultregistry.CreateRequest) { r.InitialDriver = vaultregistry.Observation{} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := t20CreateFixture(t, "hunter")
			tc.mutate(&request)
			root := t.TempDir()
			producer := mustProducer(t, root)
			if err := os.WriteFile(filepath.Join(root, "sentinel"), []byte("unchanged\n"), 0600); err != nil {
				t.Fatal(err)
			}
			before := t20Manifest(t, root)
			if _, err := producer.CreateRun(request); !errors.Is(err, vaultregistry.ErrMalformed) && !errors.Is(err, vaultregistry.ErrInvalidID) {
				t.Fatalf("CreateRun error = %v, want classified malformed input", err)
			}
			if after := t20Manifest(t, root); after != before {
				t.Fatalf("failed create wrote Registry\nbefore=%s\nafter=%s", before, after)
			}
		})
	}
}

func TestT20V01RunIDAndNameUniquenessPreserveBytes(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	original := t20CreateFixture(t, "hunter")
	if _, err := producer.CreateRun(original); err != nil {
		t.Fatal(err)
	}
	stable := t20Manifest(t, root)

	idCollision := t20CloneRequest(t, original)
	idCollision.Run.Name = "different-name"
	if _, err := producer.CreateRun(idCollision); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("ID collision error = %v, want ErrConflict", err)
	}
	if got := t20Manifest(t, root); got != stable {
		t.Fatal("ID collision changed Registry")
	}

	nameCollision := t20CloneRequest(t, original)
	nameCollision.Run.RunID = "different-id"
	nameCollision.InitialDriver.ObservationID = "different-driver-observation"
	if _, err := producer.CreateRun(nameCollision); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("name collision error = %v, want ErrConflict", err)
	}
	if got := t20Manifest(t, root); got != stable {
		t.Fatal("name collision changed Registry")
	}
}
