package atlas

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

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
	}{{134, 32}, {80, 24}} {
		t.Run(fmt.Sprintf("%dx%d", size.width, size.height), func(t *testing.T) {
			first := NewJournalModel(run, size.width, size.height).View() + "\n"
			second := NewJournalModel(run, size.width, size.height).View() + "\n"
			if first != second {
				t.Fatal("repeated journal snapshots differ")
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
			if strings.Contains(first, "\x1b") {
				t.Fatal("journal contains ANSI")
			}
			lines := strings.Split(strings.TrimSuffix(first, "\n"), "\n")
			if len(lines) > size.height {
				t.Fatalf("journal has %d lines, want at most %d", len(lines), size.height)
			}
			for line, text := range lines {
				if width := lipgloss.Width(text); width > size.width {
					t.Fatalf("line %d is %d cells, want at most %d: %q", line+1, width, size.width, text)
				}
			}
			for observationID, want := range sourceCounts {
				if got := strings.Count(first, observationID); got != want {
					t.Errorf("observation %q appears %d times, want %d", observationID, got, want)
				}
			}
			for _, participant := range run.Participants {
				if strings.Contains(first, participant.ParticipantID) {
					t.Errorf("participant %q leaked into journal", participant.ParticipantID)
				}
			}
			for _, want := range []string{
				"future-kind", "future-state", "future-evidence-state",
				"scripts/verify-vault-hunter-atlas T08.V01", "tree-red", "sha-red",
			} {
				if !strings.Contains(first, want) {
					t.Errorf("journal missing %q", want)
				}
			}
			assertOrder(t, first,
				"life-offset",
				"duplicate-id",
				"life-tie-second",
				"duplicate-id",
				"evidence-tie-second",
				"evidence-later",
				"life-later",
			)
			assertOnlySelected(t, first, "life-later", "life-offset")
			lifecycleCard := strings.Join([]string{
				"Selected Event Detail · Lifecycle",
				"  Recorded timestamp: 2026-07-26T10:03:00Z",
				"  Goal ID: T08.LANDING",
				"  Kind: landing",
				"  State: pending",
				"  Detail: instant-later",
			}, "\n")
			cardStart := strings.Index(first, lifecycleCard)
			if cardStart < 0 {
				t.Fatalf("selected lifecycle detail card missing recorded fields:\n%s", first)
			}
			if cardStart < strings.LastIndex(first, "tree=tree-green") {
				t.Fatal("selected lifecycle detail card is not distinct from inline evidence references")
			}
			card := first[cardStart:]
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
	view := NewJournalModel(run, 134, 32).View()
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
