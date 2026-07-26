// Package atlascompanion owns the Herdr tab used to display one Atlas Run.
package atlascompanion

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const (
	labelPrefix  = "Vault Hunter Atlas · "
	markerPrefix = "vault-hunter-atlas-companion:v1:"
	wrapper      = `"$@"; while :; do sleep 2147483647; done`
)

// Tuple is the complete identity callers must retain for cleanup.
type Tuple struct {
	RunID       string `json:"run_id"`
	WorkspaceID string `json:"workspace_id"`
	TabID       string `json:"tab_id"`
	PaneID      string `json:"pane_id"`
	TerminalID  string `json:"terminal_id"`
}

// Agent is the live Herdr identity used for exact participant correlation.
type Agent struct {
	Name         string                      `json:"name"`
	Agent        string                      `json:"agent"`
	AgentStatus  string                      `json:"agent_status"`
	WorkspaceID  string                      `json:"workspace_id"`
	TabID        string                      `json:"tab_id"`
	PaneID       string                      `json:"pane_id"`
	TerminalID   string                      `json:"terminal_id"`
	AgentSession *vaultregistry.AgentSession `json:"agent_session,omitempty"`
}

// Correlation keeps recorded and live identities separately observable.
type Correlation struct {
	State    string                    `json:"state"`
	Recorded vaultregistry.Participant `json:"recorded"`
	Live     *Agent                    `json:"live,omitempty"`
}

// Attachment is the owned companion tuple and the read-only participant view used by it.
type Attachment struct {
	Tuple
	Participants []Correlation `json:"participants"`
	LiveOnly     []Agent       `json:"live_only"`
}

// Client invokes a Herdr 0.7.1-compatible CLI.
type Client struct {
	Herdr      string
	Executable string
}

type tab struct {
	WorkspaceID string `json:"workspace_id"`
	TabID       string `json:"tab_id"`
	Label       string `json:"label"`
	PaneCount   int    `json:"pane_count"`
}

type pane struct {
	WorkspaceID string `json:"workspace_id"`
	TabID       string `json:"tab_id"`
	PaneID      string `json:"pane_id"`
	TerminalID  string `json:"terminal_id"`
}

type process struct {
	Argv []string `json:"argv"`
}

type processInfo struct {
	PaneID    string    `json:"pane_id"`
	Processes []process `json:"foreground_processes"`
}

type snapshot struct {
	tabs       []tab
	panes      []pane
	processes  map[string][]process
	candidates map[string]bool
}

// AttachRun validates the Reader-produced Run before creating a companion.
func (c Client) AttachRun(run vaultregistry.Run, workspaceID, stateDir string) (Attachment, error) {
	participants, liveOnly, err := c.correlate(run, workspaceID)
	if err != nil {
		return Attachment{}, err
	}
	tuple, err := c.Attach(run.RunID, workspaceID, stateDir)
	if err != nil {
		return Attachment{}, err
	}
	return Attachment{Tuple: tuple, Participants: participants, LiveOnly: liveOnly}, nil
}

func (c Client) correlate(run vaultregistry.Run, workspaceID string) ([]Correlation, []Agent, error) {
	if run.Task.Kind != "task" {
		return nil, nil, errors.New("only Task Runs can have an Atlas companion")
	}
	registered := false
	for _, participant := range run.Participants {
		if participant.Herdr != nil && completeHerdr(*participant.Herdr) && participant.Herdr.WorkspaceID == workspaceID {
			registered = true
			break
		}
	}
	if !registered {
		return nil, nil, errors.New("workspace is not registered by a complete participant identity")
	}

	var listed struct {
		Type   string  `json:"type"`
		Agents []Agent `json:"agents"`
	}
	if err := c.call(&listed, "agent", "list"); err != nil {
		return nil, nil, err
	}
	if listed.Type != "agent_list" || listed.Agents == nil {
		return nil, nil, errors.New("invalid Herdr agent list result")
	}
	for _, agent := range listed.Agents {
		if agent.WorkspaceID == "" || agent.TabID == "" || agent.PaneID == "" || agent.TerminalID == "" {
			return nil, nil, errors.New("invalid Herdr agent list result")
		}
	}
	correlations, liveOnly := correlate(run.Participants, listed.Agents)
	return correlations, liveOnly, nil
}

func correlate(participants []vaultregistry.Participant, agents []Agent) ([]Correlation, []Agent) {
	used := make([]bool, len(agents))
	correlations := make([]Correlation, 0, len(participants))
	for _, recorded := range participants {
		correlation := Correlation{State: "recorded-only", Recorded: recorded}
		if recorded.Herdr != nil && completeHerdr(*recorded.Herdr) {
			correlation.State = "stale"
			match := -1
			for i := range agents {
				if sameHerdr(*recorded.Herdr, agents[i]) {
					if match != -1 {
						match = -2
						break
					}
					match = i
				}
			}
			if match >= 0 {
				live := agents[match]
				correlation.Live = &live
				used[match] = true
				if recorded.AgentSession != nil && live.AgentSession != nil && !sameSession(*recorded.AgentSession, *live.AgentSession) {
					correlation.State = "contradictory"
				} else {
					correlation.State = "matched"
				}
			}
		}
		correlations = append(correlations, correlation)
	}
	var liveOnly []Agent
	for i, agent := range agents {
		if !used[i] {
			liveOnly = append(liveOnly, agent)
		}
	}
	return correlations, liveOnly
}

func sameHerdr(recorded vaultregistry.HerdrIdentity, live Agent) bool {
	return completeHerdr(recorded) && live.WorkspaceID != "" && live.TabID != "" && live.PaneID != "" && live.TerminalID != "" &&
		recorded.WorkspaceID == live.WorkspaceID && recorded.TabID == live.TabID &&
		recorded.PaneID == live.PaneID && recorded.TerminalID == live.TerminalID
}

func completeHerdr(identity vaultregistry.HerdrIdentity) bool {
	return identity.WorkspaceID != "" && identity.TabID != "" && identity.PaneID != "" && identity.TerminalID != ""
}

func sameSession(recorded, live vaultregistry.AgentSession) bool {
	return recorded.Source == live.Source && recorded.Kind == live.Kind && recorded.Value == live.Value
}

func (c Client) Attach(runID, workspaceID, stateDir string) (Tuple, error) {
	if err := c.validate(runID, workspaceID); err != nil {
		return Tuple{}, err
	}
	s, err := c.inspect(runID, workspaceID)
	if err != nil {
		return Tuple{}, err
	}
	owned, err := c.exactOwned(s, runID, workspaceID, stateDir)
	if err != nil {
		return Tuple{}, err
	}
	if len(owned) == 1 && healthy(s.processes[owned[0].PaneID], c.atlasArgv(runID, stateDir)) {
		return owned[0], nil
	}
	if len(owned) == 1 {
		if err := c.call(nil, "tab", "close", owned[0].TabID); err != nil {
			return Tuple{}, err
		}
	}

	var created struct {
		Type     string `json:"type"`
		Tab      *tab   `json:"tab"`
		RootPane *pane  `json:"root_pane"`
	}
	if err := c.call(&created, "tab", "create", "--workspace", workspaceID, "--label", label(runID, workspaceID), "--no-focus"); err != nil {
		return Tuple{}, err
	}
	rollback := func() {
		if created.Tab != nil && created.Tab.WorkspaceID == workspaceID && created.Tab.Label == label(runID, workspaceID) && created.Tab.TabID != "" {
			c.call(nil, "tab", "close", created.Tab.TabID) // best-effort rollback of only the tab just created
		}
	}
	if created.Type != "tab_created" || created.Tab == nil || created.RootPane == nil {
		rollback()
		return Tuple{}, errors.New("Herdr returned an incomplete companion tuple")
	}
	tuple := Tuple{RunID: runID, WorkspaceID: workspaceID, TabID: created.Tab.TabID, PaneID: created.RootPane.PaneID, TerminalID: created.RootPane.TerminalID}
	if created.Tab.WorkspaceID != workspaceID || created.Tab.Label != label(runID, workspaceID) || created.Tab.PaneCount != 1 || created.RootPane.WorkspaceID != workspaceID || created.RootPane.TabID != created.Tab.TabID || !complete(tuple) {
		rollback()
		return Tuple{}, errors.New("Herdr returned an incomplete companion tuple")
	}
	command := shellCommand(tuple, c.atlasArgv(runID, stateDir))
	if err := c.call(nil, "pane", "run", tuple.PaneID, command); err != nil {
		c.call(nil, "tab", "close", tuple.TabID)
		return Tuple{}, err
	}
	var info struct {
		Type        string       `json:"type"`
		ProcessInfo *processInfo `json:"process_info"`
	}
	atlas := c.atlasArgv(runID, stateDir)
	if err := c.call(&info, "pane", "process-info", "--pane", tuple.PaneID); err != nil {
		c.call(nil, "tab", "close", tuple.TabID)
		return Tuple{}, err
	}
	if err := validProcessInfo(info.Type, info.ProcessInfo, tuple.PaneID); err != nil || !ownedProcess(info.ProcessInfo.Processes, tuple, atlas) || ambiguousAtlas(info.ProcessInfo.Processes, atlas) || !healthy(info.ProcessInfo.Processes, atlas) {
		c.call(nil, "tab", "close", tuple.TabID)
		return Tuple{}, errors.New("companion process did not start with exact ownership")
	}
	return tuple, nil
}

func (c Client) Cleanup(want Tuple, stateDir string) error {
	if err := c.validate(want.RunID, want.WorkspaceID); err != nil || !complete(want) {
		if err != nil {
			return err
		}
		return errors.New("cleanup requires the complete companion tuple")
	}
	s, err := c.inspect(want.RunID, want.WorkspaceID)
	if err != nil {
		return err
	}
	owned, err := c.exactOwned(s, want.RunID, want.WorkspaceID, stateDir)
	if err != nil {
		return err
	}
	if len(owned) == 0 {
		return nil
	}
	if owned[0] != want {
		return errors.New("companion ownership tuple does not match")
	}
	return c.call(nil, "tab", "close", want.TabID)
}

func (c Client) validate(runID, workspaceID string) error {
	if runID == "" || workspaceID == "" || c.Executable == "" {
		return errors.New("run ID, workspace ID, and executable are required")
	}
	return nil
}

func (c Client) inspect(runID, workspaceID string) (snapshot, error) {
	var listedTabs struct {
		Type string `json:"type"`
		Tabs []tab  `json:"tabs"`
	}
	if err := c.call(&listedTabs, "tab", "list", "--workspace", workspaceID); err != nil {
		return snapshot{}, err
	}
	if listedTabs.Type != "tab_list" || listedTabs.Tabs == nil {
		return snapshot{}, errors.New("invalid Herdr tab list result")
	}
	for _, tab := range listedTabs.Tabs {
		if tab.WorkspaceID != workspaceID || tab.TabID == "" || tab.Label == "" || tab.PaneCount < 1 {
			return snapshot{}, errors.New("invalid Herdr tab list result")
		}
	}
	var listedPanes struct {
		Type  string `json:"type"`
		Panes []pane `json:"panes"`
	}
	if err := c.call(&listedPanes, "pane", "list", "--workspace", workspaceID); err != nil {
		return snapshot{}, err
	}
	if listedPanes.Type != "pane_list" || listedPanes.Panes == nil {
		return snapshot{}, errors.New("invalid Herdr pane list result")
	}
	for _, pane := range listedPanes.Panes {
		if pane.WorkspaceID != workspaceID || pane.TabID == "" || pane.PaneID == "" || pane.TerminalID == "" {
			return snapshot{}, errors.New("invalid Herdr pane list result")
		}
	}
	s := snapshot{tabs: listedTabs.Tabs, panes: listedPanes.Panes, processes: map[string][]process{}, candidates: map[string]bool{}}
	expected := label(runID, workspaceID)
	for _, t := range s.tabs {
		if t.Label == expected {
			s.candidates[t.TabID] = true
			continue
		}
		if suffix, ok := strings.CutPrefix(t.Label, labelPrefix); ok {
			decoded, err := hex.DecodeString(suffix)
			if err != nil || len(decoded) != sha256.Size {
				s.candidates[t.TabID] = true
			}
		}
	}
	for _, p := range s.panes {
		var info struct {
			Type        string       `json:"type"`
			ProcessInfo *processInfo `json:"process_info"`
		}
		if err := c.call(&info, "pane", "process-info", "--pane", p.PaneID); err != nil {
			return snapshot{}, err
		}
		if err := validProcessInfo(info.Type, info.ProcessInfo, p.PaneID); err != nil {
			return snapshot{}, err
		}
		s.processes[p.PaneID] = info.ProcessInfo.Processes
		for _, proc := range info.ProcessInfo.Processes {
			for _, arg := range proc.Argv {
				tuple, ok := decodeMarker(arg)
				if strings.HasPrefix(arg, markerPrefix) && (!ok || tuple.RunID == runID && tuple.WorkspaceID == workspaceID) {
					s.candidates[p.TabID] = true
				}
			}
		}
	}
	return s, nil
}

func validProcessInfo(resultType string, info *processInfo, paneID string) error {
	if resultType != "pane_process_info" || info == nil || info.PaneID != paneID || info.Processes == nil {
		return errors.New("invalid Herdr process-info result")
	}
	for _, process := range info.Processes {
		if len(process.Argv) == 0 {
			return errors.New("invalid Herdr process-info result")
		}
	}
	return nil
}

func (c Client) exactOwned(s snapshot, runID, workspaceID, stateDir string) ([]Tuple, error) {
	var owned []Tuple
	for tabID := range s.candidates {
		var found *tab
		for i := range s.tabs {
			if s.tabs[i].TabID == tabID {
				found = &s.tabs[i]
				break
			}
		}
		matching := make([]pane, 0, 1)
		for _, p := range s.panes {
			if p.TabID == tabID {
				matching = append(matching, p)
			}
		}
		if found == nil || found.WorkspaceID != workspaceID || found.Label != label(runID, workspaceID) || found.PaneCount != 1 || len(matching) != 1 {
			return nil, errors.New("ambiguous or forged companion candidate")
		}
		tuple := Tuple{RunID: runID, WorkspaceID: workspaceID, TabID: tabID, PaneID: matching[0].PaneID, TerminalID: matching[0].TerminalID}
		atlas := c.atlasArgv(runID, stateDir)
		if matching[0].WorkspaceID != workspaceID || !complete(tuple) || !ownedProcess(s.processes[tuple.PaneID], tuple, atlas) || ambiguousAtlas(s.processes[tuple.PaneID], atlas) {
			return nil, errors.New("ambiguous or forged companion candidate")
		}
		owned = append(owned, tuple)
	}
	if len(owned) > 1 {
		return nil, errors.New("multiple owned companion candidates")
	}
	return owned, nil
}

func (c Client) atlasArgv(runID, stateDir string) []string {
	return []string{c.Executable, "--run-id", runID, "--state-dir", stateDir}
}

func (c Client) call(result any, args ...string) error {
	name := c.Herdr
	if name == "" {
		name = "herdr"
	}
	command := exec.Command(name, args...)
	output, err := command.Output()
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok && len(exit.Stderr) != 0 {
			return fmt.Errorf("herdr %s: %s", strings.Join(args, " "), strings.TrimSpace(string(exit.Stderr)))
		}
		return fmt.Errorf("herdr %s: %w", strings.Join(args, " "), err)
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(output, &envelope); err != nil || envelope.Error != nil || len(envelope.Result) == 0 || string(envelope.Result) == "null" {
		if envelope.Error != nil {
			return errors.New(envelope.Error.Message)
		}
		return errors.New("invalid Herdr JSON response")
	}
	var shape struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(envelope.Result, &shape); err != nil || shape.Type == "" {
		return errors.New("invalid Herdr result shape")
	}
	if result != nil {
		if err := json.Unmarshal(envelope.Result, result); err != nil {
			return fmt.Errorf("invalid Herdr result: %w", err)
		}
	}
	return nil
}

func label(runID, workspaceID string) string {
	hash := sha256.Sum256([]byte(runID + "\x00" + workspaceID))
	return labelPrefix + hex.EncodeToString(hash[:])
}

func marker(tuple Tuple) string {
	data, _ := json.Marshal(tuple)
	return markerPrefix + base64.RawURLEncoding.EncodeToString(data)
}

func decodeMarker(value string) (Tuple, bool) {
	if !strings.HasPrefix(value, markerPrefix) {
		return Tuple{}, false
	}
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, markerPrefix))
	var tuple Tuple
	if err != nil || json.Unmarshal(data, &tuple) != nil || !complete(tuple) {
		return Tuple{}, false
	}
	return tuple, true
}

func shellCommand(tuple Tuple, atlas []string) string {
	args := append([]string{"/bin/sh", "-c", wrapper, marker(tuple)}, atlas...)
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = "'" + strings.ReplaceAll(arg, "'", `'\''`) + "'"
	}
	return strings.Join(quoted, " ")
}

func ownedProcess(processes []process, tuple Tuple, atlas []string) bool {
	want := append([]string{"/bin/sh", "-c", wrapper, marker(tuple)}, atlas...)
	count := 0
	for _, process := range processes {
		if equalArgv(process.Argv, want) {
			count++
		}
	}
	return count == 1
}

func healthy(processes []process, atlas []string) bool {
	count := 0
	for _, process := range processes {
		if equalArgv(process.Argv, atlas) {
			count++
		}
	}
	return count == 1
}

func ambiguousAtlas(processes []process, atlas []string) bool {
	count := 0
	for _, process := range processes {
		if equalArgv(process.Argv, atlas) {
			count++
		} else if len(process.Argv) != 0 && process.Argv[0] == atlas[0] {
			return true
		}
	}
	return count > 1
}

func equalArgv(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func complete(tuple Tuple) bool {
	return tuple.RunID != "" && tuple.WorkspaceID != "" && tuple.TabID != "" && tuple.PaneID != "" && tuple.TerminalID != ""
}
