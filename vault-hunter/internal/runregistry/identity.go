package runregistry

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var taskNumber = regexp.MustCompile(`(?i)(?:^t|task-)?([0-9]+)(?:$|-)`)

func validateOrchestrator(task Task, participant Participant) error {
	expected := participantName(task, "orchestrator")
	if expected == "" {
		return nil
	}
	if participant.Role != "orchestrator" ||
		participant.Name != expected ||
		participant.WorkspaceID == "" ||
		participant.TabID == "" ||
		participant.PaneID == "" ||
		participant.TerminalID == "" ||
		!completeSession(participant.AgentSession) {
		return fmt.Errorf("complete canonical orchestrator identity %s is required", expected)
	}
	return nil
}

func participantName(task Task, role string) string {
	parts := strings.Split(filepath.Clean(task.Path), string(filepath.Separator))
	tasks := -1
	for index, part := range parts {
		if part == "tasks" {
			tasks = index
		}
	}
	if tasks < 2 {
		return ""
	}
	feature := parts[tasks-1]
	project := ""
	for index, part := range parts[:tasks] {
		if part == "1_projects" && index+1 < tasks {
			project = parts[index+1]
			break
		}
	}
	if project == "" {
		for index, part := range parts[:tasks] {
			if part == "vault" && index+1 < tasks-1 {
				project = parts[index+1]
				break
			}
		}
	}
	match := taskNumber.FindStringSubmatch(strings.ToLower(task.ID))
	if project == "" || feature == "" || len(match) != 2 {
		return ""
	}
	return "codex-" + slug(project) + "-" + slug(feature) + "-t" + match[1] + "-" + slug(role)
}

func slug(value string) string {
	value = strings.ToLower(value)
	var result strings.Builder
	dash := false
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
			result.WriteRune(character)
			dash = false
		} else if result.Len() != 0 && !dash {
			result.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(result.String(), "-")
}
