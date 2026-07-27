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

	"github.com/aviral/dotfiles/internal/vaultregistry"
	"github.com/charmbracelet/lipgloss"
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

func TestT08V01FaithfulJournalGoldenAssets(t *testing.T) {
	for _, size := range []struct {
		width, height int
		plainSHA256   string
	}{
		{134, 32, "06bcfede2e10cc5e76059bb28679f92f2eb482471ccff6edac9fa87414c7d5aa"},
		{80, 24, "4280501260629c501ca6279be981afcead8ade542eff2a78a5bea6ac58d49d62"},
	} {
		path := filepath.Join("..", "..", "scripts", "goldens", "vault-hunter-atlas",
			fmt.Sprintf("journal-%dx%d.txt", size.width, size.height))
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasSuffix(string(raw), "\n") || strings.HasSuffix(string(raw), "\n\n") {
			t.Errorf("%s must have exactly one final newline", path)
		}
		assertExpectedJournalSGR(t, string(raw))
		plain := stripJournalANSI(string(raw))
		if got := fmt.Sprintf("%x", sha256.Sum256([]byte(plain))); got != size.plainSHA256 {
			t.Errorf("%s stripped SHA-256 = %s, want %s", path, got, size.plainSHA256)
		}
		frame := strings.TrimSuffix(plain, "\n")
		assertJournalBounds(t, frame, size.width, size.height)
		if rows := len(strings.Split(frame, "\n")); rows != size.height {
			t.Errorf("%s has %d rows, want %d", path, rows, size.height)
		}
	}
}

func TestT08V01FaithfulJournalSnapshots(t *testing.T) {
	run := loadJournalRun(t)
	wantOrder := []string{
		"life-offset",
		"duplicate-id",
		"life-tie-second",
		"duplicate-id",
		"evidence-tie-second",
		"life-visible-later",
		"evidence-later",
		"life-later",
	}

	for _, size := range []struct {
		width, height int
		plainSHA256   string
		omission      string
		shownLater    string
		visible       []string
		hidden        []string
	}{
		{
			134, 32, "06bcfede2e10cc5e76059bb28679f92f2eb482471ccff6edac9fa87414c7d5aa",
			"8 recorded journal events omitted (3 earlier, 0 later)",
			"shown later: T08.HIDDEN → T08.LANDING",
			[]string{"tie-evidence-first", "tie-evidence-second", "visible-hidden", "instant-middle", "instant-later"},
			[]string{"instant-earlier", "tie-life-first", "tie-life-second"},
		},
		{
			80, 24, "4280501260629c501ca6279be981afcead8ade542eff2a78a5bea6ac58d49d62",
			"8 recorded journal events omitted (6 earlier, 0 later)",
			"shown later: T08.LANDING",
			[]string{"instant-middle", "instant-later"},
			[]string{"instant-earlier", "tie-life-first", "tie-life-second", "tie-evidence-first", "tie-evidence-second", "visible-hidden"},
		},
	} {
		t.Run(fmt.Sprintf("%dx%d", size.width, size.height), func(t *testing.T) {
			model := NewJournalModel(run, size.width, size.height)
			assertJournalEventOrder(t, model, wantOrder...)
			if model.selected != len(model.events)-1 {
				t.Fatalf("initial selection = %d, want final event %d", model.selected, len(model.events)-1)
			}

			first := model.ViewColor(true) + "\n"
			second := NewJournalModel(run, size.width, size.height).ViewColor(true) + "\n"
			if first != second {
				t.Fatal("repeated colored D snapshots differ")
			}
			if !strings.HasSuffix(first, "\n") || strings.HasSuffix(first, "\n\n") {
				t.Fatal("D snapshot must have exactly one final newline")
			}
			assertExpectedJournalSGR(t, first)

			plain := stripJournalANSI(first)
			if plain != model.View()+"\n" {
				t.Fatal("ANSI stripping changed D plain semantic bytes")
			}
			assertJournalBounds(t, strings.TrimSuffix(plain, "\n"), size.width, size.height)
			if lines := strings.Split(strings.TrimSuffix(plain, "\n"), "\n"); len(lines) != size.height {
				t.Fatalf("D frame has %d rows, want exactly %d", len(lines), size.height)
			}

			for _, want := range []string{
				"vault-hunter journal", "T08 Build",
				"Run atlas-journal-run · rev 8",
				"selected recorded journey",
				"5 lifecycle · 3 evidence · 8 total",
				"/goal T08.REVIEW · active", "review · tie-life-second",
				size.shownLater, "Feature ", "updated_at 2026-07-26T10:04:00Z",
				size.omission,
				"●", "│  ├─", "│  └─ detail ·", "· selected",
				"│  ┌─ selected recorded observation · lifecycle",
				"timestamp · 2026-07-26T10:03:00Z",
				"observation ID · life-later", "Goal ID · T08.LANDING",
				"kind · landing", "state · pending", "detail · instant-later",
			} {
				if !strings.Contains(plain, want) {
					t.Errorf("D snapshot missing %q", want)
				}
			}
			if size.width == 134 {
				for _, want := range []string{
					"T08 Build the Execution Journal",
					"selected recorded journey · projection, not authority",
					"timestamp gaps, not durations",
					"+0s since prior", "+30s since prior", "+1m since prior",
				} {
					if !strings.Contains(plain, want) {
						t.Errorf("wide D snapshot missing %q", want)
					}
				}
			} else {
				for _, want := range []string{
					"T08 Build the Ex…",
					"selected recorded journey · projection…",
					"updated_at 2026-07-26T10:04:00Z · times…",
					"+30s since prior", "+1m since prior",
				} {
					if !strings.Contains(plain, want) {
						t.Errorf("narrow D truncation missing %q", want)
					}
				}
			}
			assertVisibleJournalDetails(t, plain, size.visible, size.hidden)
			assertCenteredJournalRail(t, plain, size.width)
			for _, participant := range run.Participants {
				if strings.Contains(plain, participant.ParticipantID) {
					t.Errorf("participant %q leaked into D journal", participant.ParticipantID)
				}
			}
			if size.width == 134 {
				assertStyled(t, first, sgrFailure, "●")
			}
			assertStyled(t, first, sgrSuccess, "●")
			assertStyled(t, first, sgrAttention, "●")
			assertStyled(t, first, sgrSelected, "selected")
			assertStyled(t, first, sgrReference, "T08.V01")
			assertNodeStyle(t, first, "landing · pending", sgrAttention)
			if got := fmt.Sprintf("%x", sha256.Sum256([]byte(plain))); got != size.plainSHA256 {
				t.Fatalf("stripped D SHA-256 = %s, want %s", got, size.plainSHA256)
			}

			goldenPath := filepath.Join("..", "..", "scripts", "goldens", "vault-hunter-atlas",
				fmt.Sprintf("journal-%dx%d.txt", size.width, size.height))
			golden, err := os.ReadFile(goldenPath)
			if err != nil {
				t.Fatal(err)
			}
			if first != string(golden) {
				t.Fatalf("%dx%d D journal differs from %s", size.width, size.height, goldenPath)
			}
		})
	}
}

func TestT08V01EvidenceCardAndStatusPrecedence(t *testing.T) {
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
	colored := NewJournalModel(run, 134, 40).ViewColor(true)
	plain := stripJournalANSI(colored)
	for _, want := range []string{
		"│  ┌─ selected recorded observation · evidence",
		"timestamp · 2026-07-26T10:04:00Z",
		"observation ID · evidence-final",
		"verifier ID · T08.V03",
		"state · passed",
		"command · verify-final",
		"exit status · 0",
		"implementation tree · tree-final",
		"artifact SHA-256 · sha-final",
		"detail · evidence-final-detail",
	} {
		if !strings.Contains(plain, want) {
			t.Errorf("selected evidence card missing %q", want)
		}
	}
	assertStyled(t, colored, sgrSuccess, "●")
	assertStyled(t, colored, sgrReference, "T08.V03")

	nonzero := 7
	zero := 0
	statusRun := vaultregistry.Run{
		Lifecycle: []vaultregistry.Lifecycle{
			{ObservationID: "neutral", ObservedAt: "2026-07-26T10:00:00Z", Kind: "future-kind", State: "future-state"},
			{ObservationID: "attention", ObservedAt: "2026-07-26T10:01:00Z", Kind: "checkpoint", State: "active"},
		},
		Evidence: []vaultregistry.Evidence{
			{ObservationID: "success", ObservedAt: "2026-07-26T10:02:00Z", VerifierID: "success-verifier", State: "recorded", ExitStatus: &zero},
			{ObservationID: "failure", ObservedAt: "2026-07-26T10:03:00Z", VerifierID: "failure-verifier", State: "passed", ExitStatus: &nonzero},
		},
	}
	statusView := NewJournalModel(statusRun, 134, 40).ViewColor(true)
	assertNodeStyle(t, statusView, "future-kind", sgrMuted)
	assertNodeStyle(t, statusView, "checkpoint", sgrAttention)
	assertNodeStyle(t, statusView, "success-verifier", sgrSuccess)
	assertNodeStyle(t, statusView, "failure-verifier", sgrFailure)
}

func TestT08V01ViewportFormulaAndEmptyFallback(t *testing.T) {
	var lifecycle []vaultregistry.Lifecycle
	for i := 0; i < 10; i++ {
		lifecycle = append(lifecycle, vaultregistry.Lifecycle{
			ObservationID: fmt.Sprintf("life-%02d", i),
			ObservedAt:    fmt.Sprintf("2026-07-26T10:%02d:00Z", i),
			GoalID:        fmt.Sprintf("goal-%02d", i),
			Kind:          "checkpoint",
			State:         "done",
			Detail:        fmt.Sprintf("detail-%02d", i),
		})
	}
	model := NewJournalModel(vaultregistry.Run{Lifecycle: lifecycle}, 100, 32)
	for _, tc := range []struct {
		selected int
		visible  []string
		omission string
	}{
		{0, []string{"detail-00", "detail-01", "detail-02", "detail-03", "detail-04"}, "(0 earlier, 5 later)"},
		{5, []string{"detail-03", "detail-04", "detail-05", "detail-06", "detail-07"}, "(3 earlier, 2 later)"},
		{9, []string{"detail-05", "detail-06", "detail-07", "detail-08", "detail-09"}, "(5 earlier, 0 later)"},
	} {
		model.selected = tc.selected
		view := model.View()
		assertVisibleJournalDetails(t, view, tc.visible, nil)
		if !strings.Contains(view, tc.omission) {
			t.Errorf("selected %d missing omission %q", tc.selected, tc.omission)
		}
		if tc.selected == 0 && !strings.Contains(view, "journey start") {
			t.Error("first canonical event does not say journey start")
		}
		if tc.selected != 0 && strings.Contains(view, "journey start") {
			t.Errorf("selected %d viewport falsely restarts the journey", tc.selected)
		}
	}
	model.width, model.height, model.selected, model.detailVisible = 80, 24, 9, false
	collapsed := model.View()
	assertVisibleJournalDetails(t, collapsed, []string{"detail-06", "detail-07", "detail-08", "detail-09"},
		[]string{"detail-05"})
	if !strings.Contains(collapsed, "(6 earlier, 0 later)") ||
		strings.Contains(collapsed, "selected recorded observation") {
		t.Fatal("collapsed 80x24 viewport does not use four-event formula")
	}

	activeRun := vaultregistry.Run{Lifecycle: []vaultregistry.Lifecycle{
		{ObservationID: "active", ObservedAt: "2026-07-26T10:00:00Z", GoalID: "candidate-active", Kind: "checkpoint", State: "active"},
		{ObservationID: "feedback", ObservedAt: "2026-07-26T10:01:00Z", GoalID: "candidate-feedback", Kind: "feedback", State: "done", Detail: "feedback-detail"},
		{ObservationID: "later-a", ObservedAt: "2026-07-26T10:02:00Z", GoalID: "goal-a", Kind: "checkpoint", State: "pending"},
		{ObservationID: "later-a-again", ObservedAt: "2026-07-26T10:03:00Z", GoalID: "goal-a", Kind: "checkpoint", State: "pending"},
		{ObservationID: "later-empty", ObservedAt: "2026-07-26T10:04:00Z", Kind: "checkpoint", State: "pending"},
		{ObservationID: "later-b", ObservedAt: "2026-07-26T10:05:00Z", GoalID: "goal-b", Kind: "checkpoint", State: "pending"},
	}}
	activeView := NewJournalModel(activeRun, 134, 40).View()
	for _, want := range []string{
		"/goal candidate-feedback · done",
		"feedback · feedback-detail",
		"shown later: goal-a → goal-b",
	} {
		if !strings.Contains(activeView, want) {
			t.Errorf("active-goal derivation missing %q", want)
		}
	}
	if strings.Contains(activeView, "goal-a → goal-a") ||
		strings.Contains(activeView, "shown later: candidate-feedback") {
		t.Error("shown-later derivation did not deduplicate or exclude the candidate")
	}

	empty := NewJournalModel(vaultregistry.Run{}, 80, 24).View()
	for _, want := range []string{
		"vault-hunter journal", "0 lifecycle · 0 evidence · 0 total",
		"/goal ? · no recorded active or feedback lifecycle",
		"none recorded", "no recorded journal events",
		"g/G ends · j/k move · v/V verifier · e/E evidence · enter detail · q quit",
	} {
		if !strings.Contains(empty, want) {
			t.Errorf("empty D journal missing %q", want)
		}
	}
	if strings.Contains(empty, "omitted (") || strings.Contains(empty, "selected recorded observation") {
		t.Error("empty D journal rendered omission or selected card")
	}
	assertJournalBounds(t, empty, 80, 24)
}

func TestT08V01RegistryNormalizationAndMarkers(t *testing.T) {
	const (
		source  = "A\n\r\t\x1b\x00\x1f\x7f\u0080\u009fZ"
		escaped = `A\n\r\t\x1b\x00\x1f\x7f\u0080\u009fZ`
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
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			run := journalFieldRun(tc.evidence)
			tc.set(&run)
			plain := NewJournalModel(run, 134, 40).ViewColor(false)
			colored := NewJournalModel(run, 134, 40).ViewColor(true)
			if plain != NewJournalModel(run, 134, 40).ViewColor(false) ||
				colored != NewJournalModel(run, 134, 40).ViewColor(true) {
				t.Fatal("Registry normalization is not deterministic")
			}
			assertExpectedJournalSGR(t, colored)
			if stripJournalANSI(colored) != plain {
				t.Fatal("normalized colored frame differs from plain")
			}
			if !strings.Contains(plain, escaped) {
				t.Fatalf("%s is not visibly normalized as %q", tc.name, escaped)
			}
			assertNoJournalControls(t, plain)
			assertJournalBounds(t, plain, 134, 40)
		})
	}

	invalid := journalFieldRun(false)
	invalid.Task.Title = string([]byte{'A', 0xff, 'Z'})
	if view := NewJournalModel(invalid, 80, 24).View(); !strings.Contains(view, "A�Z") {
		t.Error("invalid UTF-8 is not normalized to replacement characters")
	}

	missingLife := journalFieldRun(false)
	missingLife.Lifecycle[0].GoalID, missingLife.Lifecycle[0].Kind, missingLife.Lifecycle[0].State = "", "", ""
	for _, want := range []string{"Goal ID · ?", "kind · ?", "state · ?"} {
		if view := NewJournalModel(missingLife, 80, 24).View(); !strings.Contains(view, want) {
			t.Errorf("missing lifecycle marker %q", want)
		}
	}
	missingEvidence := journalFieldRun(true)
	missingEvidence.Evidence[0].VerifierID, missingEvidence.Evidence[0].State = "", ""
	for _, want := range []string{"verifier ID · ?", "state · ?", "exit status · none recorded"} {
		if view := NewJournalModel(missingEvidence, 80, 24).View(); !strings.Contains(view, want) {
			t.Errorf("missing evidence marker %q", want)
		}
	}

	unknown := journalFieldRun(false)
	unknown.Lifecycle[0].Kind, unknown.Lifecycle[0].State = "future-kind", "future-state"
	assertUnknownJournalMarker(t, NewJournalModel(unknown, 80, 24).View(), "future-kind")
	assertUnknownJournalMarker(t, NewJournalModel(unknown, 80, 24).View(), "future-state")
}

func TestT08V01ReviewRailHeaderAndTruncatedMarkers(t *testing.T) {
	unknownKind := strings.Repeat("future-kind界", 12)
	unknownState := strings.Repeat("future-state界", 12)
	lifecycle := make([]vaultregistry.Lifecycle, 8)
	for i := range lifecycle {
		lifecycle[i] = vaultregistry.Lifecycle{
			ObservationID: fmt.Sprintf("review-%d", i),
			ObservedAt:    fmt.Sprintf("2026-07-26T10:%02d:00Z", i),
			GoalID:        strings.Repeat("wide界", 20),
			Kind:          "checkpoint",
			State:         "pending",
			Detail:        strings.Repeat("detail界", 20),
		}
	}
	lifecycle[0].GoalID, lifecycle[0].State, lifecycle[0].Detail = "active-goal", "active", ""
	lifecycle[len(lifecycle)-1].Kind = unknownKind
	lifecycle[len(lifecycle)-1].State = unknownState

	view := NewJournalModel(vaultregistry.Run{Lifecycle: lifecycle}, 134, 32).View()
	assertCenteredJournalRailBounds(t, view, 134)

	lines := strings.Split(view, "\n")
	foundActive := false
	for i, line := range lines {
		if strings.Contains(line, "/goal active-goal · active") {
			foundActive = true
			got := ""
			if i+1 < len(lines) {
				got = strings.TrimSpace(lines[i+1])
			}
			if got != "checkpoint · none recorded" {
				t.Errorf("empty active-goal detail line = %q, want exact no-node header", got)
			}
			break
		}
	}
	if !foundActive {
		t.Fatal("active-goal header is missing")
	}
	assertTruncatedUnknownJournalMarker(t, view, "kind")
	assertTruncatedUnknownJournalMarker(t, view, "state")
}

func journalFieldRun(evidence bool) vaultregistry.Run {
	run := vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "field-run",
		Revision:      1,
		InvokedAt:     "2026-07-26T09:59:00Z",
		UpdatedAt:     "2026-07-26T10:00:00Z",
		Task: vaultregistry.Task{
			ID: "T08", Title: "field normalization", Path: "task.md",
			FeaturePath: "feature.md", Kind: "task",
		},
	}
	if evidence {
		run.Evidence = []vaultregistry.Evidence{{
			ObservationID: "evidence-field",
			ObservedAt:    "2026-07-26T10:00:00Z",
			VerifierID:    "T08.V01",
			State:         "recorded",
		}}
	} else {
		run.Lifecycle = []vaultregistry.Lifecycle{{
			ObservationID: "lifecycle-field",
			ObservedAt:    "2026-07-26T10:00:00Z",
			GoalID:        "T08.V01",
			Kind:          "verifier",
			State:         "done",
		}}
	}
	return run
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
		t.Fatal("D journal contains no SGR sequences")
	}
	for _, sequence := range sequences {
		if !allowed[sequence] {
			t.Errorf("unexpected D journal SGR sequence %q", sequence)
		}
	}
	if strings.Contains(journalSGR.ReplaceAllString(text, ""), "\x1b") {
		t.Error("D journal contains non-SGR escape bytes")
	}
}

func assertStyled(t *testing.T, text, sgr, token string) {
	t.Helper()
	if !strings.Contains(text, sgr+token+sgrReset) {
		t.Errorf("D journal missing %q with expected style", token)
	}
}

func assertNodeStyle(t *testing.T, colored, marker, sgr string) {
	t.Helper()
	for _, line := range strings.Split(colored, "\n") {
		if strings.Contains(stripJournalANSI(line), marker) {
			if !strings.Contains(line, sgr+"●"+sgrReset) {
				t.Errorf("node %q does not use expected status color", marker)
			}
			return
		}
	}
	t.Errorf("missing node %q", marker)
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

func assertJournalEventOrder(t *testing.T, model JournalModel, want ...string) {
	t.Helper()
	if len(model.events) != len(want) {
		t.Fatalf("journal has %d source events, want %d", len(model.events), len(want))
	}
	for i, event := range model.events {
		got := ""
		if event.lifecycle != nil {
			got = event.lifecycle.ObservationID
		} else {
			got = event.evidence.ObservationID
		}
		if got != want[i] {
			t.Fatalf("canonical event %d = %q, want %q", i, got, want[i])
		}
	}
}

func assertVisibleJournalDetails(t *testing.T, view string, visible, hidden []string) {
	t.Helper()
	at := -1
	for _, detail := range visible {
		next := strings.Index(view[at+1:], "detail · "+detail)
		if next < 0 {
			t.Fatalf("visible viewport missing ordered detail %q", detail)
		}
		at += next + 1
	}
	for _, detail := range hidden {
		if strings.Contains(view, "detail · "+detail) {
			t.Errorf("viewport unexpectedly contains %q", detail)
		}
	}
}

func assertCenteredJournalRail(t *testing.T, view string, width int) {
	t.Helper()
	wantMargin := (width - min(82, width-2)) / 2
	for _, line := range strings.Split(view, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if (strings.HasPrefix(trimmed, "●") && strings.Contains(trimmed, " UTC · ")) ||
			strings.HasPrefix(trimmed, "│  ") ||
			strings.HasPrefix(trimmed, "└─ …") {
			if got := len(line) - len(trimmed); got != wantMargin {
				t.Errorf("rail margin = %d, want %d for %q", got, wantMargin, line)
			}
		}
	}
}

func assertCenteredJournalRailBounds(t *testing.T, view string, width int) {
	t.Helper()
	railWidth := min(82, width-2)
	margin := (width - railWidth) / 2
	prefix := strings.Repeat(" ", margin)
	for _, line := range strings.Split(view, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if (strings.HasPrefix(trimmed, "●") && strings.Contains(trimmed, " UTC · ")) ||
			strings.HasPrefix(trimmed, "│  ") ||
			strings.HasPrefix(trimmed, "└─ …") {
			if !strings.HasPrefix(line, prefix) {
				t.Errorf("rail line is not centered with %d-cell margin: %q", margin, line)
			}
			if got := lipgloss.Width(line); got > margin+railWidth {
				t.Errorf("rail line reaches cell %d, want at most %d: %q", got, margin+railWidth, line)
			}
		}
	}
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
				t.Errorf("unknown value %q has no neutral marker in %q", value, line)
			}
		}
	}
	if !found {
		t.Errorf("unknown value %q is not visible", value)
	}
}

func assertTruncatedUnknownJournalMarker(t *testing.T, view, label string) {
	t.Helper()
	needle := "├─ " + label + " · "
	for _, line := range strings.Split(view, "\n") {
		if strings.Contains(line, needle) {
			if !strings.Contains(line, "?") {
				t.Errorf("truncated unknown %s has no visible neutral marker in %q", label, line)
			}
			return
		}
	}
	t.Errorf("selected card has no %s field", label)
}
