package atlas

import (
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT02V03SelectedActiveKindsRetainDistinctGlyphs(t *testing.T) {
	for _, test := range []struct {
		goalID, kind, glyph string
	}{
		{"active-verifier", "verifier", "V"},
		{"active-refactor", "refactor", "F"},
		{"active-review", "review", "R"},
		{"active-pr", "pull-request", "P"},
		{"active-landing", "landing", "L"},
		{"active-cleanup", "cleanup", "C"},
	} {
		t.Run(test.kind, func(t *testing.T) {
			view := NewModel(vaultregistry.Run{
				Lifecycle: []vaultregistry.Lifecycle{{
					GoalID:     test.goalID,
					Kind:       test.kind,
					State:      "active",
					ObservedAt: "2026-07-26T13:00:00Z",
				}},
			}, 100, 30).View()
			for _, want := range []string{
				"▶ " + test.glyph + " " + test.goalID + " · " + test.kind + " · active",
				" " + test.glyph + " 13:00 " + test.kind + " · active",
			} {
				if !strings.Contains(view, want) {
					t.Errorf("selected active %s projection missing %q:\n%s", test.kind, want, view)
				}
			}
		})
	}
}
