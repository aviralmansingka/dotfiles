package main

import (
	"charm.land/huh/v2"
	"fmt"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func (m *desk) stepsDetail(r mission.Record, w int) string {
	m.selectedStep = max(0, min(m.selectedStep, len(r.Mission.Steps)-1))
	out := paint(muted, "Create with titles. Customize each step when you need details.") + "\n\n"
	for i, st := range r.Mission.Steps {
		prefix := "  "
		if i == m.selectedStep {
			prefix = marker()
		}
		out += prefix + paint(aqua, st.ID) + "  " + heading(clip(st.Title, w-20)) + "  " + status(r.State.Steps[st.ID].Status) + "\n" + paint(muted, "     "+strings.Join(mission.StepChecks(st), " + ")) + "\n"
	}
	st := r.Mission.Steps[m.selectedStep]
	out += "\n" + heading(st.ID+" · step definition") + "\n" + paint(muted, "Agent   ") + st.Agent + "\n" + paint(muted, "Output  ") + st.Output + "\n\n" + paint(muted, "Instructions") + "\n" + clip(platform.Fallback(st.Instructions, "Use the step title and mission goal."), w) + "\n\n" + paint(muted, "Acceptance") + "\n" + clip(platform.Fallback(st.Acceptance, "A useful result that satisfies the step and mission goal."), w) + "\n\n" + paint(aqua, "e customize this step")
	return out
}
func (m *desk) startStepEdit() {
	if len(m.records) == 0 {
		return
	}
	r := m.records[m.selected]
	if r.State.Active != "" {
		m.err = mission.Problem("busy", "Finish the active attempt before customizing steps.")
		return
	}
	m.selectedStep = max(0, min(m.selectedStep, len(r.Mission.Steps)-1))
	m.editing = r
	m.stepDraft = r.Mission.Steps[m.selectedStep]
	m.resetStep = false
	m.optionalChecks = nil
	for _, name := range mission.StepChecks(m.stepDraft) {
		if name != "nonempty-artifact" {
			m.optionalChecks = append(m.optionalChecks, name)
		}
	}
	m.formKind = "step"
	m.err = nil
	required := func(s string) error {
		if strings.TrimSpace(s) == "" {
			return fmt.Errorf("Required")
		}
		return nil
	}
	m.form = huh.NewForm(huh.NewGroup(
		huh.NewInput().Title("Step title").Value(&m.stepDraft.Title).Validate(required),
		huh.NewInput().Title("Agent").Description("any lets an agent pick up the work.").Value(&m.stepDraft.Agent).Validate(required),
		huh.NewInput().Title("Result filename").Value(&m.stepDraft.Output).Validate(required),
		huh.NewMultiSelect[string]().Title("Additional checks").Description("A nonempty result is always required.").Height(6).Options(huh.NewOption("Valid JSON result", "json-valid"), huh.NewOption("Go tests pass in the Go module", "go-test")).Value(&m.optionalChecks),
	), huh.NewGroup(
		huh.NewText().Title("Instructions").Description("Optional. The title and mission goal are enough to start.").Value(&m.stepDraft.Instructions).CharLimit(8000),
		huh.NewText().Title("Acceptance criteria").Value(&m.stepDraft.Acceptance).CharLimit(8000),
		huh.NewConfirm().Title("Reset this step and later progress?").Description("Required to change a step that already has attempts. Old evidence stays.").Value(&m.resetStep),
	)).WithWidth(m.formWidth()).WithTheme(formTheme())
}
