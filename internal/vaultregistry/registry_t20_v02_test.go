package vaultregistry_test

import (
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

var t20V02Fixtures = []string{
	"t20-v02-version-1.json",
	"t20-v02-legacy-version-2.json",
	"t20-v02-reconciled-version-2.json",
	"t20-v02-retired-version-2.json",
}

func t20V02Install(t *testing.T, active, retired []string) string {
	t.Helper()
	root := t.TempDir()
	for namespace, names := range map[string][]string{"runs": active, "retired": retired} {
		if len(names) == 0 {
			continue
		}
		if err := os.Mkdir(filepath.Join(root, namespace), 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range names {
			data, err := os.ReadFile(filepath.Join(t20V01FixtureRoot, name))
			if err != nil {
				t.Fatal(err)
			}
			var identity struct {
				RunID string `json:"run_id"`
			}
			if err := json.Unmarshal(data, &identity); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, namespace, identity.RunID+".json"), data, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := os.WriteFile(filepath.Join(root, "registry.lock"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func t20V02LogFixtures(t *testing.T) {
	t.Helper()
	for _, name := range t20V02Fixtures {
		data, err := os.ReadFile(filepath.Join(t20V01FixtureRoot, name))
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		t.Logf("T20.V02_FIXTURE_RECORD name=%s bytes=%d sha256=%s", name, len(data), hex.EncodeToString(digest[:]))
	}
}

func TestT20V02LiteralReaderCompatibilityAndProducerBoundary(t *testing.T) {
	t20V02LogFixtures(t)
	cases := []struct {
		fixture string
		id      string
		shape   string
	}{
		{"t20-v02-version-1.json", "t20-v02-version-1", "schema-v1"},
		{"t20-v02-legacy-version-2.json", "t20-v02-legacy-version-2", "legacy-v2"},
		{"t20-v02-reconciled-version-2.json", "t20-v02-reconciled-version-2", "reconciled-v2"},
	}
	for _, tc := range cases {
		t.Run(tc.shape, func(t *testing.T) {
			root := t20V02Install(t, []string{tc.fixture}, nil)
			before := t20Manifest(t, root)
			t.Logf("T20.V02_BYTE_MANIFEST case=%s phase=before data=%s", tc.shape, before)
			run, err := mustReader(t, root).Get(tc.id)
			if err != nil || run.RunID != tc.id {
				t.Fatalf("Get = %#v, %v", run, err)
			}
			if tc.shape == "legacy-v2" && run.WorkReference != nil || tc.shape == "reconciled-v2" && run.WorkReference == nil {
				t.Fatalf("identity shape changed: %#v", run)
			}
			after := t20Manifest(t, root)
			t.Logf("T20.V02_BYTE_MANIFEST case=%s phase=after data=%s", tc.shape, after)
			if after != before {
				t.Fatal("read rewrote Registry")
			}
		})
	}

	root := t20V02Install(t, []string{"t20-v02-legacy-version-2.json"}, nil)
	path := filepath.Join(root, "runs", "t20-v02-legacy-version-2.json")
	stable, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mustProducer(t, root).Get("t20-v02-legacy-version-2"); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("producer legacy Get error = %v, want ErrMalformed", err)
	}
	if got, _ := os.ReadFile(path); !reflect.DeepEqual(got, stable) {
		t.Fatal("producer rejection rewrote legacy bytes")
	}

	var legacy vaultregistry.Run
	if err := json.Unmarshal(stable, &legacy); err != nil {
		t.Fatal(err)
	}
	legacy.Revision = 0
	fresh := t.TempDir()
	producer := mustProducer(t, fresh)
	before := t20Manifest(t, fresh)
	if _, err := producer.Create(legacy); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("legacy create error = %v, want ErrMalformed", err)
	}
	if after := t20Manifest(t, fresh); after != before {
		t.Fatal("legacy create rejection wrote Registry")
	}
}

func TestT20V02SelectorsActiveOrderingAndExplicitRetiredRead(t *testing.T) {
	reconciledOnly := t20V02Install(t, []string{"t20-v02-reconciled-version-2.json"}, nil)
	if run, err := mustReader(t, reconciledOnly).Get("shared-selector"); err != nil || run.RunID != "t20-v02-reconciled-version-2" {
		t.Fatalf("name selector = %#v, %v", run, err)
	}
	t.Log("T20.V02_SELECTOR selector=shared-selector outcome=t20-v02-reconciled-version-2 namespace=active")

	root := t20V02Install(t, t20V02Fixtures[:3], t20V02Fixtures[3:])
	reader := mustReader(t, root)
	if run, err := reader.Get("t20-v02-version-1"); err != nil || run.RunID != "t20-v02-version-1" {
		t.Fatalf("ID selector = %#v, %v", run, err)
	}
	if _, err := reader.Get("retired-reader"); !errors.Is(err, vaultregistry.ErrNotFound) {
		t.Fatalf("default active exact read error = %v, want ErrNotFound", err)
	}
	retired, err := reader.GetRetired("retired-reader")
	if err != nil || retired.State != vaultregistry.RunStateRetired {
		t.Fatalf("explicit retired name read = %#v, %v", retired, err)
	}
	t.Log("T20.V02_SELECTOR selector=retired-reader outcome=t20-v02-retired-version-2 namespace=retired")

	summaries, err := reader.ListSummaries(vaultregistry.ListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"t20-v02-legacy-version-2", "t20-v02-reconciled-version-2", "t20-v02-version-1"}
	if got := summaryIDs(summaries); !reflect.DeepEqual(got, want) {
		t.Fatalf("active summary order = %v, want %v", got, want)
	}
	if summaries[1].Name != "shared-selector" || summaries[1].WorkReference == nil || summaries[1].RunKind != vaultregistry.RunKindHunter {
		t.Fatalf("runtime-neutral summary missing identity: %#v", summaries[1])
	}
	t.Logf("T20.V02_ACTIVE_COLLECTION ids=%v bounded_summaries=%d retired_omitted=true", want, len(summaries))

	ambiguousRoot := t20V02Install(t, []string{"t20-v02-version-1.json", "t20-v02-reconciled-version-2.json"}, nil)
	v1Path := filepath.Join(ambiguousRoot, "runs", "t20-v02-version-1.json")
	data, err := os.ReadFile(v1Path)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	fields["run_id"] = "shared-selector"
	data, _ = json.Marshal(fields)
	if err := os.Remove(v1Path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ambiguousRoot, "runs", "shared-selector.json"), append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	stable := t20Manifest(t, ambiguousRoot)
	if _, err := mustReader(t, ambiguousRoot).Get("shared-selector"); !errors.Is(err, vaultregistry.ErrAmbiguous) {
		t.Fatalf("ambiguous selector error = %v, want ErrAmbiguous", err)
	}
	if after := t20Manifest(t, ambiguousRoot); after != stable {
		t.Fatal("ambiguous read changed Registry")
	}
	t.Log("T20.V02_SELECTOR selector=shared-selector outcome=ambiguous id=shared-selector name=t20-v02-reconciled-version-2")
}

func TestT20V02ParticipantAndSessionFiltersAreTypedAndConjunctive(t *testing.T) {
	root := t20V02Install(t, t20V02Fixtures[:3], nil)
	reader := mustReader(t, root)
	session := func(value string) *vaultregistry.AgentSession {
		return &vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: value}
	}
	cases := []struct {
		name   string
		filter vaultregistry.ListFilter
		want   []string
	}{
		{"v1 participant", vaultregistry.ListFilter{ParticipantID: "v1-driver"}, []string{"t20-v02-version-1"}},
		{"legacy session", vaultregistry.ListFilter{AgentSession: session("legacy-session")}, []string{"t20-v02-legacy-version-2"}},
		{"reconciled conjunction", vaultregistry.ListFilter{ParticipantID: "v2-driver", AgentSession: session("v2-session")}, []string{"t20-v02-reconciled-version-2"}},
		{"different participants do not join", vaultregistry.ListFilter{ParticipantID: "v2-driver", AgentSession: session("reviewer-session")}, []string{}},
		{"worker representation ignored", vaultregistry.ListFilter{AgentSession: session("worker-session")}, []string{}},
		{"detail prose ignored", vaultregistry.ListFilter{ParticipantID: "detail-decoy"}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := reader.ListSummaries(tc.filter)
			if err != nil {
				t.Fatal(err)
			}
			ids := summaryIDs(got)
			if !reflect.DeepEqual(ids, tc.want) {
				t.Fatalf("filter IDs = %v, want %v", ids, tc.want)
			}
			t.Logf("T20.V02_FILTER case=%q results=%v", tc.name, ids)
		})
	}
}

func TestT20V02MalformedDualIdentityAndReadFailuresPreserveBytes(t *testing.T) {
	root := t20V02Install(t, []string{"t20-v02-reconciled-version-2.json"}, nil)
	path := filepath.Join(root, "runs", "t20-v02-reconciled-version-2.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	fields["task"] = map[string]string{"id": "T20", "title": "dual", "path": "tasks/20.md", "feature_path": "feature.md", "kind": "task"}
	data, _ = json.MarshalIndent(fields, "", "  ")
	if err := os.WriteFile(path, append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	before := t20Manifest(t, root)
	t.Logf("T20.V02_BYTE_MANIFEST case=dual-identity phase=before data=%s", before)
	if _, err := mustReader(t, root).Get("t20-v02-reconciled-version-2"); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("dual identity error = %v, want ErrMalformed", err)
	}
	if _, err := mustReader(t, root).ListSummaries(vaultregistry.ListFilter{}); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("dual identity list error = %v, want ErrMalformed", err)
	}
	after := t20Manifest(t, root)
	t.Logf("T20.V02_BYTE_MANIFEST case=dual-identity phase=after data=%s", after)
	if after != before {
		t.Fatalf("failed reads changed bytes\nbefore=%s\nafter=%s", before, after)
	}
	if _, err := mustReader(t, root).Get("missing"); err == nil {
		t.Fatal("malformed namespace unexpectedly returned not found")
	}
}
