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

func (m JournalModel) crewTimelineView(enabled bool) string {
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
		if id := localVerifierID(evidence.VerifierID); id != "" {
			verifiers[id] = true
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
	signals := readTaskSignals(m.run, verifierIDs)
	verifierSummary := fmt.Sprintf("%d/%d verifiers complete · %d evidence", signals.completeVerifiers, signals.totalVerifiers, len(m.run.Evidence))
	verifierStage := timelineStageFor(signals.verifiersComplete, signals.verifiersFailed, roles["Verifier Builder"] > 0, "handoff", "verifying")
	convergenceStage := timelineStageFor(signals.verifiersComplete, signals.verifiersFailed, roles["Convergence Engineer"] > 0, "handoff", "working")
	deliveryStage := timelineStageFor(signals.pullRequest != "", signals.deliveryFailed, roles["Delivery Steward"] > 0, "pushed", "preparing")
	closureStage := timelineStageFor(signals.taskDone, signals.taskFailed, false, "closed", "closure")

	lines := []journalLine{
		journalSideLine(m.width, journalLine{{text: "vault-hunter journal", style: journalHeading}, {text: "  " + journalValue(m.run.Task.ID) + " · Goal " + goalID, style: journalOrdinary}}, journalLine{{text: "Run " + journalValue(m.run.RunID) + fmt.Sprintf(" · rev %d", m.run.Revision), style: journalMuted}}),
		journalSideLine(m.width, journalLine{{text: goalDetail, style: journalOrdinary}}, journalLine{{text: goalState, style: journalAttention}}),
		{{text: strings.Repeat("─", m.width), style: journalMuted}}, nil, {{text: "CREW TIMELINE", style: journalHeading}},
	}
	lines = append(lines, timelineStageLines(false, timelineStage{"●", "invoked", journalSuccess}, "Parent", false, "Task and Goal accepted", "canonical context")...)
	lines = append(lines, timelineStageLines(false, verifierStage, "Verifier", inferred["Verifier Builder"], verifierSummary, verifierList(verifierIDs))...)
	lines = append(lines, timelineStageLines(false, convergenceStage, "Convergence", inferred["Convergence Engineer"], "candidate tree "+shortTree(latestTree), fmt.Sprintf("%d participant observations", roles["Convergence Engineer"]))...)
	lines = append(lines, timelineStageLines(false, deliveryStage, "Delivery", inferred["Delivery Steward"], deliveryDeliverable(signals.pullRequest), "review · checks · PR/CI")...)
	lines = append(lines, timelineStageLines(true, closureStage, "Parent closure", false, "accepted evidence checkpoint", "canonical decision · cleanup")...)
	lines = append(lines, nil, journalLine{{text: "  └─ ", style: journalMuted}, {text: "UNASSIGNED", style: journalMuted}, {text: fmt.Sprintf(" · %d participant observations", roles["Unassigned"]), style: journalAttention}, {text: " · outside crew custody", style: journalMuted}})
	for len(lines) < m.height-2 {
		lines = append(lines, nil)
	}
	if len(lines) > m.height-2 {
		lines = lines[:m.height-2]
	}
	lines = append(lines, journalLine{{text: strings.Repeat("─", m.width), style: journalMuted}}, journalLine{{text: "● complete · ⟳ active · ○ waiting · × failed · ≈ inferred role", style: journalMuted}})
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
	if role == "" && participant.Role != "" {
		role, source = participant.Role, "inferred/v1-role"
	}
	switch role {
	case "Verifier Builder", "Convergence Engineer", "Delivery Steward":
		return role, source
	default:
		return "Unassigned", source
	}
}

func inferredMark(inferred bool) string {
	if inferred {
		return "≈"
	}
	return ""
}

type timelineStage struct {
	mark, word string
	style      journalStyle
}

func timelineStageFor(done, failed, active bool, doneWord, activeWord string) timelineStage {
	if done {
		return timelineStage{"●", doneWord, journalSuccess}
	}
	if failed {
		return timelineStage{"×", "failed", journalFailure}
	}
	if active {
		return timelineStage{"⟳", activeWord, journalAttention}
	}
	return timelineStage{"○", "waiting", journalMuted}
}

func timelineStageLines(last bool, stage timelineStage, role string, inferred bool, deliverable, detail string) []journalLine {
	connector, rail := "├─", "│ "
	if last {
		connector, rail = "└─", "  "
	}
	return []journalLine{
		{{text: " " + connector + " ", style: journalMuted}, {text: stage.mark, style: stage.style}, {text: " " + role, style: journalOrdinary}, {text: " " + inferredMark(inferred), style: journalMuted}, {text: " · " + stage.word, style: stage.style}},
		{{text: " " + rail + " └─ ", style: journalMuted}, {text: deliverable, style: journalOrdinary}, {text: " · " + detail, style: journalMuted}},
	}
}

type taskSignals struct {
	totalVerifiers, completeVerifiers    int
	verifiersComplete, verifiersFailed   bool
	pullRequest                          string
	deliveryFailed, taskDone, taskFailed bool
}

var verifierPattern = regexp.MustCompile(`(?m)^- \[([ xX-])\] (?:\*\*)?(V[0-9]+)\b`)
var verifierIDPattern = regexp.MustCompile(`(?i)(?:^|\.)(V[0-9]+)$`)
var pullRequestPattern = regexp.MustCompile(`https://github\.com/[^[:space:]>)]+/pull/[0-9]+`)
var statusPattern = regexp.MustCompile(`(?mi)^status:\s*([^\r\n]+)\s*$`)

func localVerifierID(id string) string {
	match := verifierIDPattern.FindStringSubmatch(strings.TrimSpace(id))
	if match == nil {
		return ""
	}
	return strings.ToUpper(match[1])
}

func readTaskSignals(run vaultregistry.Run, registryVerifiers []string) taskSignals {
	path := run.Task.Path
	if !filepath.IsAbs(path) {
		root := os.Getenv("VAULT_ROOT")
		if root == "" {
			root = filepath.Join(os.Getenv("HOME"), "vault")
		}
		path = filepath.Join(root, filepath.FromSlash(path))
	}
	body, _ := os.ReadFile(path)
	signal := taskSignals{}
	for _, match := range verifierPattern.FindAllSubmatch(body, -1) {
		signal.totalVerifiers++
		if strings.EqualFold(string(match[1]), "x") {
			signal.completeVerifiers++
		}
		if string(match[1]) == "-" {
			signal.verifiersFailed = true
		}
	}
	if signal.totalVerifiers == 0 {
		latest := map[string]vaultregistry.Evidence{}
		for _, evidence := range run.Evidence {
			if id := localVerifierID(evidence.VerifierID); id != "" {
				latest[id] = evidence
			}
		}
		signal.totalVerifiers = len(registryVerifiers)
		for _, evidence := range latest {
			state := strings.ToLower(evidence.State)
			passed := evidence.ExitStatus != nil && *evidence.ExitStatus == 0 && (strings.Contains(state, "accept") || strings.Contains(state, "pass") || strings.Contains(state, "green"))
			failed := (evidence.ExitStatus != nil && *evidence.ExitStatus != 0) || strings.Contains(state, "fail") || strings.Contains(state, "reject")
			if passed {
				signal.completeVerifiers++
			}
			if failed {
				signal.verifiersFailed = true
			}
		}
	}
	signal.verifiersComplete = signal.totalVerifiers > 0 && signal.completeVerifiers == signal.totalVerifiers
	signal.pullRequest = implementationPullRequest(string(body))
	frontmatter := string(body)
	if strings.HasPrefix(frontmatter, "---") && len(frontmatter) > 3 {
		if end := strings.Index(frontmatter[3:], "---"); end >= 0 {
			frontmatter = frontmatter[:end+3]
		}
	}
	if match := statusPattern.FindStringSubmatch(frontmatter); match != nil {
		status := strings.ToLower(strings.TrimSpace(match[1]))
		signal.taskDone = status == "done" || status == "complete" || status == "completed"
		signal.taskFailed = status == "failed" || status == "rejected" || status == "blocked"
	}
	for _, evidence := range run.Evidence {
		state := strings.ToLower(evidence.State + " " + evidence.Detail)
		if strings.Contains(state, "delivery") && (strings.Contains(state, "fail") || strings.Contains(state, "reject")) {
			signal.deliveryFailed = true
		}
	}
	return signal
}

func implementationPullRequest(body string) string {
	lines := strings.Split(body, "\n")
	inEvidence := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			inEvidence = strings.EqualFold(strings.TrimSpace(strings.TrimLeft(trimmed, "#")), "Pull Request Evidence")
			continue
		}
		canonicalField := regexp.MustCompile(`(?i)^(?:[-*]\s*)?(?:pushed\s+)?implementation\s+(?:pr|pull request)(?:\s+url)?\s*:`).MatchString(trimmed)
		if inEvidence || canonicalField {
			if pr := pullRequestPattern.FindString(trimmed); pr != "" {
				return pr
			}
		}
	}
	return ""
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
