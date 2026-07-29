// PROTOTYPE: throwaway Handoff Rail B projection for evaluation against real Runs.
package atlas

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func crewRailPrototypeEnabled() bool { return os.Getenv("ATLAS_CREW_RAIL_PROTOTYPE") == "1" }

func (m JournalModel) crewRailPrototypeView(enabled bool) string {
	goalID, goalDetail, goalState := "?", "No active Goal recorded", "UNKNOWN"
	if goal := m.activeGoal(); goal.index >= 0 {
		goalID, goalDetail, goalState = journalValue(goal.lifecycle.GoalID), journalRecorded(goal.lifecycle.Detail), strings.ToUpper(journalValue(goal.lifecycle.State))
	}
	roles := map[string]int{}
	inferred := map[string]bool{}
	for _, participant := range m.run.Participants {
		role, source := participantCrewRole(participant)
		roles[role]++
		inferred[role] = inferred[role] || strings.HasPrefix(source, "inferred/")
	}
	verifiers := map[string]bool{}
	latestTree := "not recorded"
	for _, evidence := range m.run.Evidence {
		if evidence.VerifierID != "" {
			verifiers[evidence.VerifierID] = true
		}
		if evidence.ImplementationTree != "" {
			latestTree = evidence.ImplementationTree
		}
	}
	verifierIDs := make([]string, 0, len(verifiers))
	for verifier := range verifiers {
		verifierIDs = append(verifierIDs, verifier)
	}
	sort.Strings(verifierIDs)
	signals := readPrototypeTaskSignals(m.run, verifierIDs)
	verifierSummary := fmt.Sprintf("%d/%d verifiers complete · %d evidence", signals.completeVerifiers, signals.totalVerifiers, len(m.run.Evidence))
	verifierStage := prototypeStageFor(signals.verifiersComplete, roles["Verifier Builder"] > 0, "handoff", "verifying")
	convergenceStage := prototypeStageFor(signals.verifiersComplete, roles["Convergence Engineer"] > 0, "handoff", "working")
	deliveryStage := prototypeStageFor(signals.pullRequest != "", roles["Delivery Steward"] > 0, "pushed", "preparing")
	closureStage := prototypeStageFor(signals.taskDone, false, "closed", "closure")

	lines := []journalLine{
		journalSideLine(m.width, journalLine{{text: "vault-hunter journal", style: journalHeading}, {text: "  " + journalValue(m.run.Task.ID) + " · Goal " + goalID, style: journalOrdinary}}, journalLine{{text: "Run " + journalValue(m.run.RunID) + fmt.Sprintf(" · rev %d", m.run.Revision), style: journalMuted}}),
		journalSideLine(m.width, journalLine{{text: goalDetail, style: journalOrdinary}}, journalLine{{text: goalState, style: journalAttention}}),
		{{text: strings.Repeat("─", m.width), style: journalMuted}},
		nil,
		{{text: "CREW TIMELINE", style: journalHeading}},
	}
	lines = append(lines, prototypeTimelineStage(false, prototypeStage{"●", "invoked", journalSuccess}, "Parent", false, "Task and Goal accepted", "canonical context")...)
	lines = append(lines, prototypeTimelineStage(false, verifierStage, "Verifier", inferred["Verifier Builder"], verifierSummary, verifierList(verifierIDs))...)
	lines = append(lines, prototypeTimelineStage(false, convergenceStage, "Convergence", inferred["Convergence Engineer"], "candidate tree "+shortTree(latestTree), fmt.Sprintf("%d participant observations", roles["Convergence Engineer"]))...)
	lines = append(lines, prototypeTimelineStage(false, deliveryStage, "Delivery", inferred["Delivery Steward"], deliveryDeliverable(signals.pullRequest), "review · checks · PR/CI")...)
	lines = append(lines, prototypeTimelineStage(true, closureStage, "Parent closure", false, "accepted evidence checkpoint", "canonical decision · cleanup")...)
	lines = append(lines,
		nil,
		journalLine{{text: "  └─ ", style: journalMuted}, {text: "UNASSIGNED", style: journalMuted}, {text: fmt.Sprintf(" · %d participant observations", roles["Unassigned"]), style: journalAttention}, {text: " · outside crew custody", style: journalMuted}},
	)
	for len(lines) < m.height-2 {
		lines = append(lines, nil)
	}
	if len(lines) > m.height-2 {
		lines = lines[:m.height-2]
	}
	lines = append(lines,
		journalLine{{text: strings.Repeat("─", m.width), style: journalMuted}},
		journalLine{{text: "● complete · ⟳ active · ○ waiting · ≈ inferred role", style: journalMuted}},
	)
	var styles journalStyles
	if enabled {
		styles = newJournalStyles()
	}
	rendered := make([]string, len(lines))
	for i, line := range lines {
		rendered[i] = renderJournalLine(line, m.width, enabled, styles)
	}
	return strings.Join(rendered, "\n")
}

func participantCrewRole(participant vaultregistry.Participant) (string, string) {
	var role, source string
	if raw := participant.Unknown["crew_role"]; raw != nil {
		_ = json.Unmarshal(raw, &role)
	}
	if raw := participant.Unknown["crew_role_source"]; raw != nil {
		_ = json.Unmarshal(raw, &source)
	}
	if role == "" {
		role = "Unassigned"
	}
	return role, source
}

func inferredMark(inferred bool) string {
	if inferred {
		return "≈"
	}
	return ""
}

type prototypeStage struct {
	mark, word string
	style      journalStyle
}

func prototypeStageFor(done, active bool, doneWord, activeWord string) prototypeStage {
	if done {
		return prototypeStage{"●", doneWord, journalSuccess}
	}
	if active {
		return prototypeStage{"⟳", activeWord, journalAttention}
	}
	return prototypeStage{"○", "waiting", journalMuted}
}

func prototypeTimelineStage(last bool, stage prototypeStage, role string, inferred bool, deliverable, detail string) []journalLine {
	connector, rail := "├─", "│ "
	if last {
		connector, rail = "└─", "  "
	}
	return []journalLine{
		{{text: " " + connector + " ", style: journalMuted}, {text: stage.mark, style: stage.style}, {text: " " + role, style: journalOrdinary}, {text: " " + inferredMark(inferred), style: journalMuted}, {text: " · " + stage.word, style: stage.style}},
		{{text: " " + rail + " └─ ", style: journalMuted}, {text: deliverable, style: journalOrdinary}, {text: " · " + detail, style: journalMuted}},
	}
}

type prototypeTaskSignals struct {
	totalVerifiers, completeVerifiers int
	verifiersComplete, taskDone       bool
	pullRequest                       string
}

var prototypeVerifierPattern = regexp.MustCompile(`(?m)^- \[([ xX-])\] (?:\*\*)?(V[0-9]+)\b`)
var prototypePRPattern = regexp.MustCompile(`https://github\.com/[^[:space:]>)]+/pull/[0-9]+`)

func readPrototypeTaskSignals(run vaultregistry.Run, registryVerifiers []string) prototypeTaskSignals {
	path := run.Task.Path
	if !filepath.IsAbs(path) {
		root := os.Getenv("VAULT_ROOT")
		if root == "" {
			root = filepath.Join(os.Getenv("HOME"), "vault")
		}
		path = filepath.Join(root, filepath.FromSlash(path))
	}
	body, _ := os.ReadFile(path)
	signal := prototypeTaskSignals{}
	matches := prototypeVerifierPattern.FindAllSubmatch(body, -1)
	for _, match := range matches {
		signal.totalVerifiers++
		if strings.EqualFold(string(match[1]), "x") {
			signal.completeVerifiers++
		}
	}
	if signal.totalVerifiers == 0 {
		signal.totalVerifiers = len(registryVerifiers)
		latest := map[string]vaultregistry.Evidence{}
		for _, evidence := range run.Evidence {
			if !regexp.MustCompile(`^V[0-9]+$`).MatchString(evidence.VerifierID) {
				continue
			}
			latest[evidence.VerifierID] = evidence
		}
		for _, evidence := range latest {
			state := strings.ToLower(evidence.State)
			if evidence.ExitStatus != nil && *evidence.ExitStatus == 0 && (strings.Contains(state, "accept") || strings.Contains(state, "pass") || strings.Contains(state, "green")) {
				signal.completeVerifiers++
			}
		}
	}
	signal.verifiersComplete = signal.totalVerifiers > 0 && signal.completeVerifiers == signal.totalVerifiers
	if pr := prototypePRPattern.Find(body); pr != nil {
		signal.pullRequest = string(pr)
	}
	frontmatter := string(body)
	if end := strings.Index(frontmatter[3:], "---"); strings.HasPrefix(frontmatter, "---") && end >= 0 {
		frontmatter = frontmatter[:end+3]
	}
	signal.taskDone = regexp.MustCompile(`(?mi)^status:\s*(done|complete|completed)\s*$`).MatchString(frontmatter)
	return signal
}

func deliveryDeliverable(pr string) string {
	if pr == "" {
		return "implementation PR not pushed"
	}
	parts := strings.Split(strings.TrimSuffix(pr, "/"), "/")
	return "implementation PR #" + parts[len(parts)-1] + " pushed"
}

func shortTree(tree string) string {
	if len(tree) > 8 {
		return tree[:8]
	}
	return tree
}
func verifierList(ids []string) string {
	if len(ids) == 0 {
		return "commands · red evidence"
	}
	if len(ids) > 3 {
		return strings.Join(ids[:3], ", ") + "…"
	}
	return strings.Join(ids, ", ")
}

func crewDeliverable(mark string, style journalStyle, role string, inferred bool, deliverable, detail string) journalLine {
	return journalLine{{text: mark, style: style}, {text: " " + role, style: style}, {text: " " + inferredMark(inferred), style: journalMuted}, {text: "  " + deliverable, style: journalOrdinary}, {text: "  " + detail, style: journalMuted}}
}
