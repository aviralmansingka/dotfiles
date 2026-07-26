package atlas

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/mattn/go-runewidth"
)

func TestV01SharedFixtureFeedsExpandedAndCompactLayouts(t *testing.T) {
	run := loadFixture(t)

	outputs := map[string]string{
		"expanded": RenderExpanded(run, 120, 30),
		"compact":  RenderCompact(run, 78, 17),
	}
	want := []string{
		"pi-skills-tools-t11-20260725",
		"/goal V03",
		"vault checkpoint",
		"V03 evidence",
		"RED",
		"iteration 2",
		"E01 baseline main@857bcd5",
		"Make failure evidence green",
	}
	for name, output := range outputs {
		for _, value := range want {
			if !strings.Contains(output, value) {
				t.Errorf("%s layout missing %q:\n%s", name, value, output)
			}
		}
	}
}

func TestV02LayoutsStayInsideCellsAndPreserveActiveWork(t *testing.T) {
	run := loadFixture(t)
	sizes := [][2]int{{40, 10}, {60, 16}, {78, 17}, {80, 24}, {100, 20}, {120, 30}}
	renderers := map[string]func(Run, int, int) string{
		"compact":  RenderCompact,
		"expanded": RenderExpanded,
	}
	for name, render := range renderers {
		for _, size := range sizes {
			width, height := size[0], size[1]
			output := render(run, width, height)
			lines := strings.Split(output, "\n")
			if len(lines) > height {
				t.Errorf("%s %dx%d rendered %d lines", name, width, height, len(lines))
			}
			for index, line := range lines {
				if len([]rune(line)) > width {
					t.Errorf("%s %dx%d line %d is %d cells: %q", name, width, height, index, len([]rune(line)), line)
				}
			}
			for _, value := range []string{"/goal V03", "RED", "next:"} {
				if !strings.Contains(output, value) {
					t.Errorf("%s %dx%d hid active detail %q:\n%s", name, width, height, value, output)
				}
			}
		}
	}

	compact := RenderCompact(run, 78, 17)
	firstBodyLine := strings.Split(compact, "\n")[2]
	if !strings.Contains(firstBodyLine, "GOALS") || !strings.Contains(firstBodyLine, "VERIFIER JOURNEY") {
		t.Fatalf("78x17 compact layout lost its two readable columns:\n%s", compact)
	}
}

func TestV02LayoutsUseTerminalDisplayWidth(t *testing.T) {
	for _, size := range [][2]int{{40, 10}, {78, 17}, {77, 46}} {
		t.Run(fmt.Sprintf("%dx%d", size[0], size[1]), func(t *testing.T) {
			run := loadFixture(t)
			run.NextAction = strings.Repeat("界", size[0])
			outputs := map[string]string{
				"render": RenderCompact(run, size[0], size[1]),
				"view": func() string {
					model := NewUIModel(run)
					updated, _ := model.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
					return updated.(UIModel).View()
				}(),
			}
			for name, output := range outputs {
				for index, line := range strings.Split(output, "\n") {
					if columns := runewidth.StringWidth(line); columns > size[0] {
						t.Errorf("%s row %d used %d display columns, want <= %d: %q", name, index, columns, size[0], line)
					}
				}
			}
		})
	}
}

func loadFixture(t *testing.T) Run {
	t.Helper()
	fixture := filepath.Join("..", "..", "testdata", "run.json")
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	run, err := DecodeRun(data)
	if err != nil {
		t.Fatal(err)
	}
	return run
}
