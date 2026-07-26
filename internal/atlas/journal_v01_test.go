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
	fixture := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas", "runs", "atlas-journal-run.json")
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	var run vaultregistry.Run
	if err := json.Unmarshal(data, &run); err != nil {
		t.Fatal(err)
	}

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
			if first != string(golden) {
				t.Fatalf("%dx%d journal differs from %s:\n%s", size.width, size.height, goldenPath, first)
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
		})
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
