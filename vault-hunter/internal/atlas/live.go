package atlas

import (
	"fmt"
	"sync"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/herdrsocket"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

type AgentSnapshot = herdrsocket.Snapshot

type liveParticipant struct {
	snapshot AgentSnapshot
	stale    bool
}

type LiveState struct {
	mu           sync.RWMutex
	participants map[string]liveParticipant
}

func NewLiveState(participants []runregistry.Participant) *LiveState {
	live := &LiveState{participants: make(map[string]liveParticipant, len(participants))}
	for _, participant := range participants {
		live.participants[participant.PaneID] = liveParticipant{
			snapshot: AgentSnapshot{PaneID: participant.PaneID, Status: "unknown"},
		}
	}
	return live
}

func CurrentParticipants(participants []runregistry.Participant) []runregistry.Participant {
	seen := make(map[string]struct{}, len(participants))
	current := make([]runregistry.Participant, 0, len(participants))
	for index := len(participants) - 1; index >= 0; index-- {
		participant := participants[index]
		key := participant.Role + "\x00" + participant.GoalID
		if _, replaced := seen[key]; replaced {
			continue
		}
		seen[key] = struct{}{}
		current = append(current, participant)
	}
	for left, right := 0, len(current)-1; left < right; left, right = left+1, right-1 {
		current[left], current[right] = current[right], current[left]
	}
	return current
}

func (l *LiveState) ReconcileParticipants(participants []runregistry.Participant) {
	l.mu.Lock()
	defer l.mu.Unlock()
	next := make(map[string]liveParticipant, len(participants))
	for _, participant := range participants {
		if current, ok := l.participants[participant.PaneID]; ok {
			next[participant.PaneID] = current
		} else {
			next[participant.PaneID] = liveParticipant{
				snapshot: AgentSnapshot{PaneID: participant.PaneID, Status: "unknown"},
			}
		}
	}
	l.participants = next
}

func (l *LiveState) MarkParticipantStale(paneID string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	participant, ok := l.participants[paneID]
	if !ok {
		return
	}
	participant.stale = true
	l.participants[paneID] = participant
}

func (l *LiveState) Refresh(snapshot AgentSnapshot) {
	l.mu.Lock()
	defer l.mu.Unlock()
	current, ok := l.participants[snapshot.PaneID]
	if !ok {
		return
	}
	if snapshot.Revision != 0 && current.snapshot.Revision > snapshot.Revision {
		return
	}
	snapshot.Status = normalizeAgentStatus(snapshot.Status)
	current.snapshot = snapshot
	current.stale = false
	l.participants[snapshot.PaneID] = current
}

func (l *LiveState) MarkStale() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for paneID, participant := range l.participants {
		participant.stale = true
		l.participants[paneID] = participant
	}
}

func (l *LiveState) RenderParticipant(paneID string, spinnerFrame int) string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	participant, ok := l.participants[paneID]
	if !ok {
		return ""
	}
	status := participant.snapshot.Status
	var output string
	switch status {
	case "working":
		spinner := []string{"◐", "◓", "◑", "◒"}
		output = fmt.Sprintf("› working %s", spinner[spinnerFrame%len(spinner)])
	case "blocked":
		output = "! blocked"
	case "done":
		output = "● done"
	case "idle":
		output = "· idle"
	default:
		output = "? unknown"
	}
	if participant.stale {
		output += " · stale"
	}
	return output
}

func normalizeAgentStatus(status string) string {
	switch status {
	case "working", "blocked", "done", "idle", "unknown":
		return status
	default:
		return "unknown"
	}
}
