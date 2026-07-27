package atlas

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"unicode"

	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const (
	sgrMuted     = "\x1b[38;2;146;131;116m"
	sgrOrdinary  = "\x1b[38;2;235;219;178m"
	sgrSelected  = "\x1b[38;2;251;241;199m"
	sgrJournal   = "\x1b[38;2;242;133;52m"
	sgrEvidence  = "\x1b[38;2;211;134;155m"
	sgrReference = "\x1b[38;2;128;170;158m"
	sgrSuccess   = "\x1b[38;2;184;187;38m"
	sgrAttention = "\x1b[38;2;233;177;67m"
	sgrFailure   = "\x1b[38;2;242;89;75m"
	sgrReset     = "\x1b[0m"
)

var journalSGR = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func TestT08V01JournalSnapshots(t *testing.T) {
	run := loadJournalRun(t)

	sourceCounts := map[string]int{}
	for _, event := range run.Lifecycle {
		sourceCounts[event.ObservationID]++
	}
	for _, event := range run.Evidence {
		sourceCounts[event.ObservationID]++
	}

	for _, size := range []struct {
		width, height int
		plainSHA256   string
	}{
		{134, 32, "dc647efd939e7f557d08c693e8c947875ced5991fcfb027d2edd9aeecf992580"},
		{80, 24, "0f528e84251af77880112abc43e5efd09984633ae3e2c90c21f46a126cee177a"},
	} {
		t.Run(fmt.Sprintf("%dx%d", size.width, size.height), func(t *testing.T) {
			model := NewJournalModel(run, size.width, size.height)
			first := model.ViewColor(true) + "\n"
			second := NewJournalModel(run, size.width, size.height).ViewColor(true) + "\n"
			if first != second {
				t.Fatal("repeated colored journal snapshots differ")
			}
			goldenPath := filepath.Join("..", "..", "scripts", "goldens", "vault-hunter-atlas",
				fmt.Sprintf("journal-%dx%d.txt", size.width, size.height))
			golden, err := os.ReadFile(goldenPath)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasSuffix(first, "\n") || strings.HasSuffix(first, "\n\n") {
				t.Fatal("journal must have exactly one final newline")
			}
			if !strings.Contains(first, "\x1b") {
				t.Fatal("colored journal contains no ANSI")
			}
			assertExpectedJournalSGR(t, first)
			assertStyled(t, first, sgrMuted, "10:00:00Z")
			assertStyled(t, first, sgrOrdinary, "life-offset")
			assertStyled(t, first, sgrSelected, ">")
			assertStyled(t, first, sgrJournal, "L")
			assertStyled(t, first, sgrEvidence, "E")
			assertStyled(t, first, sgrReference, "T08.V01")
			assertStyled(t, first, sgrSuccess, "passed")
			assertStyled(t, first, sgrAttention, "pending")
			assertStyled(t, first, sgrFailure, "failed")

			plain := stripJournalANSI(first)
			if plain != model.View()+"\n" {
				t.Fatal("ANSI stripping changed the plain journal frame")
			}
			if got := fmt.Sprintf("%x", sha256.Sum256([]byte(plain))); got != size.plainSHA256 {
				t.Fatalf("stripped journal SHA-256 = %s, want %s", got, size.plainSHA256)
			}
			if !strings.HasSuffix(plain, "\n") || strings.HasSuffix(plain, "\n\n") {
				t.Fatal("stripped journal must have exactly one final newline")
			}
			lines := strings.Split(strings.TrimSuffix(plain, "\n"), "\n")
			if len(lines) > size.height {
				t.Fatalf("journal has %d lines, want at most %d", len(lines), size.height)
			}
			for line, text := range lines {
				if width := lipgloss.Width(text); width > size.width {
					t.Fatalf("line %d is %d cells, want at most %d: %q", line+1, width, size.width, text)
				}
			}
			for observationID, want := range sourceCounts {
				if got := strings.Count(plain, observationID); got != want {
					t.Errorf("observation %q appears %d times, want %d", observationID, got, want)
				}
			}
			for _, participant := range run.Participants {
				if strings.Contains(plain, participant.ParticipantID) {
					t.Errorf("participant %q leaked into journal", participant.ParticipantID)
				}
			}
			for _, want := range []string{
				"future-kind", "future-state", "future-evidence-state",
				"scripts/verify-vault-hunter-atlas T08.V01", "tree-red", "sha-red",
			} {
				if !strings.Contains(plain, want) {
					t.Errorf("journal missing %q", want)
				}
			}
			assertOrder(t, plain,
				"life-offset",
				"duplicate-id",
				"life-tie-second",
				"duplicate-id",
				"evidence-tie-second",
				"evidence-later",
				"life-later",
			)
			assertOnlySelected(t, plain, "life-later", "life-offset")
			lifecycleCard := strings.Join([]string{
				"Selected Event Detail · Lifecycle",
				"  Recorded timestamp: 2026-07-26T10:03:00Z",
				"  Goal ID: T08.LANDING",
				"  Kind: landing",
				"  State: pending",
				"  Detail: instant-later",
			}, "\n")
			cardStart := strings.Index(plain, lifecycleCard)
			if cardStart < 0 {
				t.Fatalf("selected lifecycle detail card missing recorded fields:\n%s", plain)
			}
			if cardStart < strings.LastIndex(plain, "tree=tree-green") {
				t.Fatal("selected lifecycle detail card is not distinct from inline evidence references")
			}
			card := plain[cardStart:]
			for _, evidenceLabel := range []string{"command=", "tree=", "artifact="} {
				if strings.Contains(card, evidenceLabel) {
					t.Errorf("selected lifecycle detail card contains inline evidence label %q", evidenceLabel)
				}
			}
			if first != string(golden) {
				t.Fatalf("%dx%d journal differs from %s:\n%s", size.width, size.height, goldenPath, first)
			}
		})
	}
}

func TestT08V01SelectedEvidenceDetail(t *testing.T) {
	run := loadJournalRun(t)
	exit := 0
	run.Evidence = append(run.Evidence, vaultregistry.Evidence{
		ObservationID:      "evidence-final",
		ObservedAt:         "2026-07-26T10:04:00Z",
		VerifierID:         "T08.V03",
		State:              "passed",
		Command:            "verify-final",
		ExitStatus:         &exit,
		ImplementationTree: "tree-final",
		ArtifactSHA256:     "sha-final",
		Detail:             "evidence-final-detail",
	})
	colored := NewJournalModel(run, 134, 32).ViewColor(true)
	assertExpectedJournalSGR(t, colored)
	assertStyled(t, colored, sgrEvidence, "Verifier ID:")
	assertStyled(t, colored, sgrReference, "T08.V03")
	assertStyled(t, colored, sgrSuccess, "passed")
	assertStyled(t, colored, sgrReference, "verify-final")
	assertStyled(t, colored, sgrReference, "tree-final")
	assertStyled(t, colored, sgrReference, "sha-final")
	view := stripJournalANSI(colored)
	assertOnlySelected(t, view, "evidence-final", "life-offset")
	want := strings.Join([]string{
		"Selected Event Detail · Evidence",
		"  Recorded timestamp: 2026-07-26T10:04:00Z",
		"  Verifier ID: T08.V03",
		"  State: passed",
		"  Command: verify-final",
		"  Exit status: 0",
		"  Implementation tree: tree-final",
		"  Artifact SHA-256: sha-final",
		"  Detail: evidence-final-detail",
	}, "\n")
	if !strings.Contains(view, want) {
		t.Fatalf("selected evidence detail card missing recorded fields:\n%s", view)
	}
}

func TestT08V01RegistryControlsAreVisiblyEscaped(t *testing.T) {
	const (
		source  = "A\n\r\t\x1b\x00\x7f\u0080\u009fZ"
		escaped = `A\n\r\t\x1b\x00\x7f\u0080\u009fZ`
	)
	cases := []struct {
		name     string
		evidence bool
		set      func(*vaultregistry.Run)
	}{
		{"task ID", false, func(run *vaultregistry.Run) { run.Task.ID = source }},
		{"task title", false, func(run *vaultregistry.Run) { run.Task.Title = source }},
		{"lifecycle observation ID", false, func(run *vaultregistry.Run) { run.Lifecycle[0].ObservationID = source }},
		{"lifecycle goal ID", false, func(run *vaultregistry.Run) { run.Lifecycle[0].GoalID = source }},
		{"lifecycle kind", false, func(run *vaultregistry.Run) { run.Lifecycle[0].Kind = source }},
		{"lifecycle state", false, func(run *vaultregistry.Run) { run.Lifecycle[0].State = source }},
		{"lifecycle detail", false, func(run *vaultregistry.Run) { run.Lifecycle[0].Detail = source }},
		{"evidence observation ID", true, func(run *vaultregistry.Run) { run.Evidence[0].ObservationID = source }},
		{"evidence verifier ID", true, func(run *vaultregistry.Run) { run.Evidence[0].VerifierID = source }},
		{"evidence state", true, func(run *vaultregistry.Run) { run.Evidence[0].State = source }},
		{"evidence command", true, func(run *vaultregistry.Run) { run.Evidence[0].Command = source }},
		{"evidence implementation tree", true, func(run *vaultregistry.Run) { run.Evidence[0].ImplementationTree = source }},
		{"evidence artifact SHA-256", true, func(run *vaultregistry.Run) { run.Evidence[0].ArtifactSHA256 = source }},
		{"evidence detail", true, func(run *vaultregistry.Run) { run.Evidence[0].Detail = source }},
	}

	// Run IDs and timestamps have syntax validation; these are every displayed
	// free-form Registry field that can contain controls in a valid Run.
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			run := controlCharacterRun(tc.evidence)
			tc.set(&run)
			plain := NewJournalModel(run, 80, 24).ViewColor(false)
			colored := NewJournalModel(run, 80, 24).ViewColor(true)
			if plain != NewJournalModel(run, 80, 24).ViewColor(false) ||
				colored != NewJournalModel(run, 80, 24).ViewColor(true) {
				t.Fatal("control escaping is not deterministic")
			}
			assertExpectedJournalSGR(t, colored)
			if stripped := stripJournalANSI(colored); stripped != plain {
				t.Fatal("stripped colored frame differs from plain frame")
			}
			if !strings.Contains(plain, escaped) {
				t.Fatalf("frame does not visibly escape %s as %q:\n%s", tc.name, escaped, plain)
			}
			assertNoJournalControls(t, plain)
			assertJournalBounds(t, plain, 80, 24)
			lines := strings.Split(plain, "\n")
			if got := lines[len(lines)-1]; got != "j/down k/up navigate · q quit · read-only · 80x24" {
				t.Fatalf("footer = %q", got)
			}
		})
	}
}

func TestT08V01MissingAndUnknownMarkers(t *testing.T) {
	t.Run("missing lifecycle identity kind and state are question marks", func(t *testing.T) {
		run := controlCharacterRun(false)
		run.Lifecycle[0].GoalID = ""
		run.Lifecycle[0].Kind = ""
		run.Lifecycle[0].State = ""
		view := NewJournalModel(run, 80, 24).View()
		for _, want := range []string{"  Goal ID: ?", "  Kind: ?", "  State: ?"} {
			if !strings.Contains(view, want) {
				t.Errorf("missing exact marker %q:\n%s", want, view)
			}
		}
	})

	t.Run("missing evidence identity state and exit are explicit", func(t *testing.T) {
		run := controlCharacterRun(true)
		run.Evidence[0].VerifierID = ""
		run.Evidence[0].State = ""
		view := NewJournalModel(run, 80, 24).View()
		for _, want := range []string{
			"exit=none recorded",
			"  Verifier ID: ?",
			"  State: ?",
			"  Exit status: none recorded",
		} {
			if !strings.Contains(view, want) {
				t.Errorf("missing exact marker %q:\n%s", want, view)
			}
		}
	})

	t.Run("unknown kind and states have neutral visible markers", func(t *testing.T) {
		lifecycle := controlCharacterRun(false)
		lifecycle.Lifecycle[0].Kind = "future-kind"
		lifecycle.Lifecycle[0].State = "future-state"
		assertUnknownJournalMarker(t, NewJournalModel(lifecycle, 80, 24).View(), "future-kind")
		assertUnknownJournalMarker(t, NewJournalModel(lifecycle, 80, 24).View(), "future-state")

		evidence := controlCharacterRun(true)
		evidence.Evidence[0].State = "future-evidence-state"
		assertUnknownJournalMarker(t, NewJournalModel(evidence, 80, 24).View(), "future-evidence-state")
	})
}

func controlCharacterRun(evidence bool) vaultregistry.Run {
	run := vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "control-run",
		Revision:      1,
		InvokedAt:     "2026-07-26T09:59:00Z",
		UpdatedAt:     "2026-07-26T10:00:00Z",
		Task: vaultregistry.Task{
			ID: "T08", Title: "control normalization", Path: "task.md",
			FeaturePath: "feature.md", Kind: "task",
		},
	}
	if evidence {
		run.Evidence = []vaultregistry.Evidence{{
			ObservationID: "evidence-control",
			ObservedAt:    "2026-07-26T10:00:00Z",
			VerifierID:    "T08.V01",
			State:         "recorded",
		}}
	} else {
		run.Lifecycle = []vaultregistry.Lifecycle{{
			ObservationID: "lifecycle-control",
			ObservedAt:    "2026-07-26T10:00:00Z",
			GoalID:        "T08.V01",
			Kind:          "verifier",
			State:         "done",
		}}
	}
	return run
}

func assertNoJournalControls(t *testing.T, text string) {
	t.Helper()
	for _, r := range text {
		if r != '\n' && unicode.IsControl(r) {
			t.Fatalf("journal contains source control rune U+%04X", r)
		}
	}
}

func assertUnknownJournalMarker(t *testing.T, view, value string) {
	t.Helper()
	found := false
	for _, line := range strings.Split(view, "\n") {
		if strings.Contains(line, value) {
			found = true
			if !strings.Contains(line, "?") {
				t.Errorf("unknown value %q has no neutral visible marker in %q", value, line)
			}
		}
	}
	if !found {
		t.Errorf("unknown value %q is not visible", value)
	}
}

func stripJournalANSI(text string) string {
	return journalSGR.ReplaceAllString(text, "")
}

func assertExpectedJournalSGR(t *testing.T, text string) {
	t.Helper()
	allowed := map[string]bool{
		sgrMuted: true, sgrOrdinary: true, sgrSelected: true,
		sgrJournal: true, sgrEvidence: true, sgrReference: true,
		sgrSuccess: true, sgrAttention: true, sgrFailure: true, sgrReset: true,
	}
	sequences := journalSGR.FindAllString(text, -1)
	if len(sequences) == 0 {
		t.Fatal("journal contains no SGR sequences")
	}
	for _, sequence := range sequences {
		if !allowed[sequence] {
			t.Errorf("unexpected journal SGR sequence %q", sequence)
		}
	}
	if strings.Contains(journalSGR.ReplaceAllString(text, ""), "\x1b") {
		t.Error("journal contains non-SGR escape bytes")
	}
}

func assertStyled(t *testing.T, text, sgr, token string) {
	t.Helper()
	if !strings.Contains(text, sgr+token+sgrReset) {
		t.Errorf("journal missing styled token %q", token)
	}
}

func loadJournalRun(t *testing.T) vaultregistry.Run {
	t.Helper()
	fixture := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas", "runs", "atlas-journal-run.json")
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	var run vaultregistry.Run
	if err := json.Unmarshal(data, &run); err != nil {
		t.Fatal(err)
	}
	return run
}

func assertOnlySelected(t *testing.T, text, selected, notSelected string) {
	t.Helper()
	var marked []string
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "> ") {
			marked = append(marked, line)
		}
	}
	if len(marked) != 1 || !strings.Contains(marked[0], selected) || strings.Contains(marked[0], notSelected) {
		t.Errorf("selected marker = %q, want only %q and not %q", marked, selected, notSelected)
	}
}

func assertOrder(t *testing.T, text string, markers ...string) {
	t.Helper()
	at := -1
	for _, marker := range markers {
		next := strings.Index(text[at+1:], marker)
		if next < 0 {
			t.Fatalf("journal missing ordered marker %q", marker)
		}
		at += next + 1
	}
}
