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
