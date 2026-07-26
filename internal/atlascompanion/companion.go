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

type snapshot struct {
	tabs       []tab
	panes      []pane
	processes  map[string][]process
	candidates map[string]bool
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
		Tab      tab  `json:"tab"`
		RootPane pane `json:"root_pane"`
	}
	if err := c.call(&created, "tab", "create", "--workspace", workspaceID, "--label", label(runID, workspaceID), "--no-focus"); err != nil {
		return Tuple{}, err
	}
	tuple := Tuple{RunID: runID, WorkspaceID: workspaceID, TabID: created.Tab.TabID, PaneID: created.RootPane.PaneID, TerminalID: created.RootPane.TerminalID}
	if created.Tab.WorkspaceID != workspaceID || created.RootPane.WorkspaceID != workspaceID || created.RootPane.TabID != created.Tab.TabID || !complete(tuple) {
		c.call(nil, "tab", "close", created.Tab.TabID) // best-effort rollback of only the tab just created
		return Tuple{}, errors.New("Herdr returned an incomplete companion tuple")
	}
	command := shellCommand(tuple, c.atlasArgv(runID, stateDir))
	if err := c.call(nil, "pane", "run", tuple.PaneID, command); err != nil {
		c.call(nil, "tab", "close", tuple.TabID)
		return Tuple{}, err
	}
	var info struct {
		ProcessInfo struct {
			Processes []process `json:"foreground_processes"`
		} `json:"process_info"`
	}
	atlas := c.atlasArgv(runID, stateDir)
	if err := c.call(&info, "pane", "process-info", "--pane", tuple.PaneID); err != nil || !ownedProcess(info.ProcessInfo.Processes, tuple, atlas) || ambiguousAtlas(info.ProcessInfo.Processes, atlas) || !healthy(info.ProcessInfo.Processes, atlas) {
		c.call(nil, "tab", "close", tuple.TabID)
		if err != nil {
			return Tuple{}, err
		}
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
		Tabs []tab `json:"tabs"`
	}
	if err := c.call(&listedTabs, "tab", "list", "--workspace", workspaceID); err != nil {
		return snapshot{}, err
	}
	var listedPanes struct {
		Panes []pane `json:"panes"`
	}
	if err := c.call(&listedPanes, "pane", "list", "--workspace", workspaceID); err != nil {
		return snapshot{}, err
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
			ProcessInfo struct {
				Processes []process `json:"foreground_processes"`
			} `json:"process_info"`
		}
		if err := c.call(&info, "pane", "process-info", "--pane", p.PaneID); err != nil {
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
	if err := json.Unmarshal(output, &envelope); err != nil || envelope.Error != nil || len(envelope.Result) == 0 {
		if envelope.Error != nil {
			return errors.New(envelope.Error.Message)
		}
		return errors.New("invalid Herdr JSON response")
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
