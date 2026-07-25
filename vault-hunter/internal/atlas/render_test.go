package atlas

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestV01SharedFixtureFeedsExpandedAndCompactLayouts(t *testing.T) {
	fixture := filepath.Join("..", "..", "testdata", "run.json")
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	run, err := DecodeRun(data)
	if err != nil {
		t.Fatal(err)
	}

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
