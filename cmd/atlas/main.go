package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	atlaspkg "github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/atlascompanion"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const usageText = `usage: atlas
       atlas get projects|themes|features|tasks|runs|verifiers|verifierattempts|participants|usage
       atlas get <resource> [<name-or-id> | --name <name> | --id <id>] [--watch]
       atlas observe [<run-name-or-id> | --name <name> | --id <id>]
       atlas <resource> create --json < request.json

       atlas get verifierattempts --run <run> --pending
       atlas evidence get [<name-or-id> | --name <name> | --id <id>]
       atlas accept verifierattempt <attempt> --expected-revision <revision>
       atlas reject verifierattempt <attempt> --expected-revision <revision> --reason <code>

       atlas run retire [<name-or-id> | --name <name> | --id <id>] --expected-revision <revision>
       atlas admin companion revive [<name-or-id> | --name <name> | --id <id>]
       atlas capabilities --output json
`

var getResources = map[string]bool{
	"projects": true, "themes": true, "features": true, "tasks": true,
	"runs": true, "verifiers": true, "verifierattempts": true,
	"participants": true, "usage": true,
}

var agentCreateResources = []string{"run"}

type commandError struct {
	code    int
	message string
	usage   bool
}

func (e *commandError) Error() string { return e.message }

type selector struct {
	Positional string
	ID         string
	Name       string
}

func (s selector) validate() error {
	count := 0
	for _, value := range []string{s.Positional, s.ID, s.Name} {
		if value != "" {
			count++
		}
	}
	if count > 1 {
		return usageError("selector accepts exactly one of <name-or-id>, --id, or --name")
	}
	return nil
}

func (s selector) any() string {
	if s.Positional != "" {
		return s.Positional
	}
	if s.ID != "" {
		return s.ID
	}
	return s.Name
}

type observeCommand struct{ selector selector }
type getCommand struct {
	resource string
	selector selector
	watch    bool
	run      string
	pending  bool
}
type createCommand struct{ resource string }
type capabilitiesCommand struct{}
type evidenceGetCommand struct{ selector selector }
type acceptCommand struct {
	selector         selector
	expectedRevision uint64
}
type rejectCommand struct {
	selector         selector
	expectedRevision uint64
	reason           string
}
type retireCommand struct {
	selector         selector
	expectedRevision uint64
}
type reviveCommand struct{ selector selector }

func main() {
	code := execute(os.Args[1:], os.Stdout, os.Stderr)
	os.Exit(code)
}

func execute(args []string, stdout, stderr io.Writer) int {
	if handled, code := executeInternal(stdout, stderr); handled {
		return code
	}
	command, err := parse(args)
	if err != nil {
		var usage *commandError
		if errors.As(err, &usage) {
			if usage.message != "" {
				_, _ = fmt.Fprintln(stderr, usage.message)
			}
			if usage.usage {
				_, _ = io.WriteString(stderr, usageText)
			}
			return usage.code
		}
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	if err := run(command, stdout); err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func executeInternal(stdout, stderr io.Writer) (bool, int) {
	mode := strings.TrimSpace(os.Getenv("ATLAS_INTERNAL_MODE"))
	if mode == "" {
		return false, 0
	}
	if err := runInternal(mode, stdout); err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return true, 1
	}
	return true, 0
}

func parse(args []string) (any, error) {
	if len(args) == 0 {
		return observeCommand{}, nil
	}
	if len(args) == 1 && (args[0] == "help" || args[0] == "--help" || args[0] == "-h") {
		return usageHelp{}, nil
	}
	if strings.HasPrefix(args[0], "-") {
		return nil, usageError("unexpected option " + args[0])
	}
	if len(args) >= 2 && args[1] == "create" {
		return parseCreate(args[0], args[2:])
	}

	switch args[0] {
	case "observe":
		return parseObserve(args[1:])
	case "get":
		return parseGet(args[1:])
	case "evidence":
		return parseEvidence(args[1:])
	case "accept":
		return parseAccept(args[1:])
	case "reject":
		return parseReject(args[1:])
	case "run":
		return parseRun(args[1:])
	case "admin":
		return parseAdmin(args[1:])
	case "capabilities":
		return parseCapabilities(args[1:])
	case "status", "describe":
		return nil, usageError("unknown command " + quote(args[0]))
	default:
		return nil, usageError("unknown command " + quote(args[0]))
	}
}

type usageHelp struct{}

func run(command any, stdout io.Writer) error {
	switch command := command.(type) {
	case usageHelp:
		_, err := io.WriteString(stdout, usageText)
		return err
	case observeCommand:
		return runObserve(command, stdout)
	case getCommand:
		return runGet(command, stdout)
	case createCommand:
		return runCreate(command, os.Stdin, stdout)
	case capabilitiesCommand:
		return writeJSON(stdout, envelope{
			APIVersion: "atlas/v1",
			Kind:       "Capabilities",
			Data: map[string]any{
				"agent_tools": []string{
					"agent_run_preflight",
					"atlas_get",
					"atlas_create",
					"atlas_evidence_get",
					"atlas_accept_verifier_attempt",
					"atlas_reject_verifier_attempt",
					"atlas_retire_run",
					"atlas_capabilities",
				},
				"create_resources": agentCreateResources,
				"get_resources":    sortedKeys(getResources),
			},
			Meta: map[string]any{},
		})
	case evidenceGetCommand:
		return runEvidenceGet(command, stdout)
	case acceptCommand:
		return runAccept(command, stdout)
	case rejectCommand:
		return runReject(command, stdout)
	case retireCommand:
		return runRetire(command, stdout)
	case reviveCommand:
		return runRevive(command, stdout)
	default:
		return errors.New("atlas: unreachable command")
	}
}

func parseObserve(args []string) (observeCommand, error) {
	selector, rest, err := parseSelector(args)
	if err != nil {
		return observeCommand{}, err
	}
	if len(rest) != 0 {
		return observeCommand{}, usageError("unexpected observe argument " + quote(rest[0]))
	}
	return observeCommand{selector: selector}, selector.validate()
}

func parseGet(args []string) (getCommand, error) {
	if len(args) == 0 {
		return getCommand{}, usageError("get requires a resource")
	}
	resource := args[0]
	if !getResources[resource] {
		return getCommand{}, usageError("unknown get resource " + quote(resource))
	}
	args = args[1:]
	selector, rest, err := parseSelector(args)
	if err != nil {
		return getCommand{}, err
	}
	command := getCommand{resource: resource, selector: selector}
	for len(rest) > 0 {
		switch rest[0] {
		case "--watch":
			command.watch = true
			rest = rest[1:]
		case "--pending":
			command.pending = true
			rest = rest[1:]
		case "--run":
			if len(rest) < 2 || strings.HasPrefix(rest[1], "-") {
				return getCommand{}, usageError("--run requires a value")
			}
			command.run = rest[1]
			rest = rest[2:]
		default:
			return getCommand{}, usageError("unexpected get argument " + quote(rest[0]))
		}
	}
	if err := command.selector.validate(); err != nil {
		return getCommand{}, err
	}
	if command.resource != "verifierattempts" && (command.run != "" || command.pending) {
		return getCommand{}, usageError("only verifierattempts accepts --run or --pending")
	}
	if command.resource == "verifierattempts" && command.pending && command.run == "" {
		return getCommand{}, usageError("verifierattempts --pending requires --run")
	}
	return command, nil
}

func parseCreate(resource string, args []string) (createCommand, error) {
	if len(args) != 1 || args[0] != "--json" {
		return createCommand{}, usageError(resource + " create requires exactly --json")
	}
	return createCommand{resource: resource}, nil
}

func parseEvidence(args []string) (evidenceGetCommand, error) {
	if len(args) == 0 || args[0] != "get" {
		return evidenceGetCommand{}, usageError("evidence requires get")
	}
	selector, rest, err := parseSelector(args[1:])
	if err != nil {
		return evidenceGetCommand{}, err
	}
	if len(rest) != 0 {
		return evidenceGetCommand{}, usageError("unexpected evidence argument " + quote(rest[0]))
	}
	if err := selector.validate(); err != nil {
		return evidenceGetCommand{}, err
	}
	return evidenceGetCommand{selector: selector}, nil
}

func parseAccept(args []string) (acceptCommand, error) {
	if len(args) == 0 || args[0] != "verifierattempt" {
		return acceptCommand{}, usageError("accept requires verifierattempt")
	}
	selector, rest, err := parseSelector(args[1:])
	if err != nil {
		return acceptCommand{}, err
	}
	if len(rest) != 2 || rest[0] != "--expected-revision" || rest[1] == "" {
		return acceptCommand{}, usageError("accept verifierattempt requires --expected-revision <revision>")
	}
	expectedRevision, err := parseExpectedRevision(rest[1])
	if err != nil {
		return acceptCommand{}, err
	}
	if err := selector.validate(); err != nil {
		return acceptCommand{}, err
	}
	return acceptCommand{selector: selector, expectedRevision: expectedRevision}, nil
}

func parseReject(args []string) (rejectCommand, error) {
	if len(args) == 0 || args[0] != "verifierattempt" {
		return rejectCommand{}, usageError("reject requires verifierattempt")
	}
	selector, rest, err := parseSelector(args[1:])
	if err != nil {
		return rejectCommand{}, err
	}
	if len(rest) != 4 || rest[0] != "--expected-revision" || rest[2] != "--reason" || rest[1] == "" || rest[3] == "" {
		return rejectCommand{}, usageError("reject verifierattempt requires --expected-revision <revision> --reason <code>")
	}
	expectedRevision, err := parseExpectedRevision(rest[1])
	if err != nil {
		return rejectCommand{}, err
	}
	if err := selector.validate(); err != nil {
		return rejectCommand{}, err
	}
	return rejectCommand{selector: selector, expectedRevision: expectedRevision, reason: rest[3]}, nil
}

func parseRun(args []string) (retireCommand, error) {
	if len(args) == 0 || args[0] != "retire" {
		return retireCommand{}, usageError("run requires retire")
	}
	selector, rest, err := parseSelector(args[1:])
	if err != nil {
		return retireCommand{}, err
	}
	if len(rest) != 2 || rest[0] != "--expected-revision" || rest[1] == "" {
		return retireCommand{}, usageError("run retire requires --expected-revision <revision>")
	}
	expectedRevision, err := parseExpectedRevision(rest[1])
	if err != nil {
		return retireCommand{}, err
	}
	if err := selector.validate(); err != nil {
		return retireCommand{}, err
	}
	return retireCommand{selector: selector, expectedRevision: expectedRevision}, nil
}

func parseAdmin(args []string) (reviveCommand, error) {
	if len(args) < 2 || args[0] != "companion" || args[1] != "revive" {
		return reviveCommand{}, usageError("admin requires companion revive")
	}
	selector, rest, err := parseSelector(args[2:])
	if err != nil {
		return reviveCommand{}, err
	}
	if len(rest) != 0 {
		return reviveCommand{}, usageError("unexpected admin argument " + quote(rest[0]))
	}
	if err := selector.validate(); err != nil {
		return reviveCommand{}, err
	}
	return reviveCommand{selector: selector}, nil
}

func parseCapabilities(args []string) (capabilitiesCommand, error) {
	if len(args) != 2 || args[0] != "--output" || args[1] != "json" {
		return capabilitiesCommand{}, usageError("capabilities requires --output json")
	}
	return capabilitiesCommand{}, nil
}

func parseSelector(args []string) (selector, []string, error) {
	var parsed selector
	remaining := args
	if len(remaining) > 0 && !strings.HasPrefix(remaining[0], "-") {
		parsed.Positional = remaining[0]
		remaining = remaining[1:]
	}
	for len(remaining) > 0 {
		switch remaining[0] {
		case "--id":
			if len(remaining) < 2 || strings.HasPrefix(remaining[1], "-") {
				return selector{}, nil, usageError("--id requires a value")
			}
			parsed.ID = remaining[1]
			remaining = remaining[2:]
		case "--name":
			if len(remaining) < 2 || strings.HasPrefix(remaining[1], "-") {
				return selector{}, nil, usageError("--name requires a value")
			}
			parsed.Name = remaining[1]
			remaining = remaining[2:]
		default:
			return parsed, remaining, nil
		}
	}
	return parsed, remaining, nil
}

func runInternal(mode string, stdout io.Writer) error {
	switch mode {
	case "preview":
		return runInternalPreview(stdout)
	case "render-run":
		return runInternalRender(stdout)
	default:
		return fmt.Errorf("atlas: unknown internal mode %q", mode)
	}
}

func runInternalPreview(stdout io.Writer) error {
	reader, err := vaultregistry.OpenReader(strings.TrimSpace(os.Getenv("ATLAS_INTERNAL_STATE_DIR")))
	if err != nil {
		return err
	}
	width, err := internalPositiveInt("ATLAS_INTERNAL_WIDTH")
	if err != nil {
		return err
	}
	height, err := internalPositiveInt("ATLAS_INTERNAL_HEIGHT")
	if err != nil {
		return err
	}
	selected := atlascompanion.Agent{
		WorkspaceID: internalString("ATLAS_INTERNAL_WORKSPACE_ID"),
		TabID:       internalString("ATLAS_INTERNAL_TAB_ID"),
		PaneID:      internalString("ATLAS_INTERNAL_PANE_ID"),
		TerminalID:  internalString("ATLAS_INTERNAL_TERMINAL_ID"),
		AgentSession: &vaultregistry.AgentSession{
			Source: internalString("ATLAS_INTERNAL_AGENT_SESSION_SOURCE"),
			Kind:   internalString("ATLAS_INTERNAL_AGENT_SESSION_KIND"),
			Value:  internalString("ATLAS_INTERNAL_AGENT_SESSION_VALUE"),
		},
	}
	result, err := (atlascompanion.Client{Herdr: "herdr"}).Preview(reader, selected, width, height)
	if err != nil {
		return err
	}
	return json.NewEncoder(stdout).Encode(result)
}

func runInternalRender(stdout io.Writer) error {
	reader, err := vaultregistry.OpenReader(strings.TrimSpace(os.Getenv("ATLAS_INTERNAL_STATE_DIR")))
	if err != nil {
		return err
	}
	selector := selector{ID: internalString("ATLAS_INTERNAL_RUN_ID"), Name: internalString("ATLAS_INTERNAL_RUN_NAME")}
	if err := selector.validate(); err != nil {
		return err
	}
	if selector.any() == "" {
		return errors.New("atlas: internal render requires a run selector")
	}
	run, err := readRunAny(reader, selector)
	if err != nil {
		return err
	}
	width, height := 80, 24
	if raw := strings.TrimSpace(os.Getenv("ATLAS_INTERNAL_WIDTH")); raw != "" {
		width, err = strconv.Atoi(raw)
		if err != nil || width <= 0 {
			return fmt.Errorf("atlas: ATLAS_INTERNAL_WIDTH must be a positive integer")
		}
	}
	if raw := strings.TrimSpace(os.Getenv("ATLAS_INTERNAL_HEIGHT")); raw != "" {
		height, err = strconv.Atoi(raw)
		if err != nil || height <= 0 {
			return fmt.Errorf("atlas: ATLAS_INTERNAL_HEIGHT must be a positive integer")
		}
	}
	static := os.Getenv("ATLAS_INTERNAL_SNAPSHOT") == "1" || os.Getenv("TERM") == "dumb" || !characterDevice(os.Stdin) || !characterDevice(os.Stdout)
	model := atlaspkg.NewModel(run, width, height)
	if static {
		_, err = fmt.Fprintln(stdout, model.View())
		return err
	}
	_, err = tea.NewProgram(model, tea.WithAltScreen()).Run()
	return err
}

func internalString(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

func internalPositiveInt(name string) (int, error) {
	value := internalString(name)
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("atlas: %s must be a positive integer", name)
	}
	return parsed, nil
}

func runObserve(command observeCommand, stdout io.Writer) error {
	reader, err := vaultregistry.OpenReader("")
	if err != nil {
		return err
	}
	if command.selector.any() == "" {
		if characterDevice(os.Stdin) && characterDevice(os.Stdout) {
			return runBrowser(stdout, reader)
		}
		summaries, err := reader.ListSummaries(vaultregistry.ListFilter{})
		if err != nil {
			return err
		}
		_, err = io.WriteString(stdout, renderRunList(summaries))
		return err
	}
	run, err := readActiveRun(reader, command.selector)
	if err != nil {
		return err
	}
	if characterDevice(os.Stdin) && characterDevice(os.Stdout) {
		model := atlaspkg.NewJournalModel(run, 80, 24).WithCrewTimeline().WithColor(interactiveColorEnabled()).WithReload(func() (vaultregistry.Run, error) { return readActiveRun(reader, command.selector) })
		_, err := tea.NewProgram(model, tea.WithAltScreen()).Run()
		return err
	}
	_, err = io.WriteString(stdout, renderRun(run))
	return err
}

func runGet(command getCommand, stdout io.Writer) error {
	if command.watch {
		return runWatch(command, stdout)
	}
	envelope, err := atlaspkg.BuildEnvelope("", "", command.resource, atlaspkg.MachineSelector(command.selector), atlaspkg.MachineGetOptions{
		Run:     command.run,
		Pending: command.pending,
	})
	if err != nil {
		return err
	}
	return writeJSON(stdout, envelope)
}

func runCreate(command createCommand, input io.Reader, stdout io.Writer) error {
	if command.resource != "run" {
		return fmt.Errorf("atlas: %s create is not implemented yet", command.resource)
	}
	data, err := io.ReadAll(input)
	if err != nil {
		return err
	}
	envelope, err := atlaspkg.CreateRunEnvelope("", data)
	if err != nil {
		return err
	}
	return writeJSON(stdout, envelope)
}

func runEvidenceGet(command evidenceGetCommand, stdout io.Writer) error {
	envelope, err := atlaspkg.BuildEvidenceEnvelope("", "", atlaspkg.MachineSelector(command.selector))
	if err != nil {
		return err
	}
	return writeJSON(stdout, envelope)
}

func runAccept(command acceptCommand, stdout io.Writer) error {
	envelope, err := atlaspkg.AcceptVerifierAttemptEnvelope("", atlaspkg.MachineSelector(command.selector), command.expectedRevision)
	if err != nil {
		return err
	}
	return writeJSON(stdout, envelope)
}

func runReject(command rejectCommand, stdout io.Writer) error {
	envelope, err := atlaspkg.RejectVerifierAttemptEnvelope("", atlaspkg.MachineSelector(command.selector), command.expectedRevision, command.reason)
	if err != nil {
		return err
	}
	return writeJSON(stdout, envelope)
}

func runRetire(command retireCommand, stdout io.Writer) error {
	envelope, err := atlaspkg.RetireRunEnvelope("", atlaspkg.MachineSelector(command.selector), command.expectedRevision)
	if err != nil {
		return err
	}
	return writeJSON(stdout, envelope)
}

func runRevive(command reviveCommand, stdout io.Writer) error {
	stateRoot, err := vaultregistry.ResolveRoot()
	if err != nil {
		return err
	}
	reader, err := vaultregistry.OpenReader(stateRoot)
	if err != nil {
		return err
	}
	run, err := readRunAny(reader, command.selector)
	if err != nil {
		return err
	}
	workspaceID, err := companionWorkspace(run)
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if _, err := (atlascompanion.Client{Herdr: "herdr", Executable: executable}).AttachRun(run, workspaceID, stateRoot); err != nil {
		return err
	}
	envelope := envelope{
		APIVersion: "atlas/v1",
		Kind:       "Companion",
		Data: map[string]any{
			"run":        map[string]any{"id": run.RunID, "name": runName(run)},
			"state":      "active",
			"revived_at": time.Now().UTC().Format(time.RFC3339),
		},
		Meta: map[string]any{"operation": "revive"},
	}
	return writeJSON(stdout, envelope)
}

func readRunAny(reader *vaultregistry.Reader, selector selector) (vaultregistry.Run, error) {
	active, retired, err := reader.Snapshot()
	if err != nil {
		return vaultregistry.Run{}, err
	}
	return resolveRun(selector, append(active, retired...))
}

func companionWorkspace(run vaultregistry.Run) (string, error) {
	participants := recordedParticipants(run)
	workspace := ""
	for _, participant := range participants {
		if participant.Herdr == nil || !completeHerdr(*participant.Herdr) {
			continue
		}
		if workspace == "" {
			workspace = participant.Herdr.WorkspaceID
			continue
		}
		if participant.Herdr.WorkspaceID != workspace {
			return "", fmt.Errorf("%w: run %s has multiple registered workspaces", vaultregistry.ErrAmbiguous, run.RunID)
		}
	}
	if workspace == "" {
		return "", fmt.Errorf("%w: run %s has no complete registered workspace", vaultregistry.ErrMalformed, run.RunID)
	}
	return workspace, nil
}

func recordedParticipants(run vaultregistry.Run) []vaultregistry.Participant {
	if run.SchemaVersion != 2 {
		return append([]vaultregistry.Participant(nil), run.Participants...)
	}
	builders := map[string]vaultregistry.Participant{}
	order := make([]string, 0)
	for _, observation := range run.Observations {
		if observation.Kind != vaultregistry.KindRegisteredParticipant || observation.Payload.RegisteredParticipant == nil {
			continue
		}
		payload := observation.Payload.RegisteredParticipant
		current, ok := builders[payload.ParticipantID]
		if !ok {
			order = append(order, payload.ParticipantID)
		}
		current.ParticipantID = payload.ParticipantID
		current.ObservedAt = observation.ObservedAt
		current.Role = payload.Role
		current.GoalID = observation.GoalID
		current.Herdr = payload.Herdr
		session := payload.AgentSession
		current.AgentSession = &session
		builders[payload.ParticipantID] = current
	}
	participants := make([]vaultregistry.Participant, 0, len(order))
	for _, id := range order {
		participants = append(participants, builders[id])
	}
	return participants
}

func completeHerdr(identity vaultregistry.HerdrIdentity) bool {
	return identity.WorkspaceID != "" && identity.TabID != "" && identity.PaneID != "" && identity.TerminalID != ""
}

func runBrowser(stdout io.Writer, reader *vaultregistry.Reader) error {
	vaultRoot, err := atlaspkg.ResolveVaultRoot()
	if err != nil {
		return err
	}
	stateRoot, err := vaultregistry.ResolveRoot()
	if err != nil {
		return err
	}
	entries, err := buildBrowserEntries(vaultRoot, stateRoot, reader, os.Stderr)
	if err != nil {
		return err
	}
	reload := func() ([]browserEntry, error) { return buildBrowserEntries(vaultRoot, stateRoot, reader, io.Discard) }
	model := newBrowserModel(entries).withReload(reload).withColor(interactiveColorEnabled())
	_, err = tea.NewProgram(model, tea.WithAltScreen()).Run()
	return err
}

func runWatch(command getCommand, stdout io.Writer) error {
	options := atlaspkg.MachineGetOptions{Run: command.run, Pending: command.pending}
	if times := strings.TrimSpace(os.Getenv("ATLAS_WATCH_FAKE_TIMES")); times != "" {
		for _, raw := range strings.Split(times, ",") {
			observedAt := strings.TrimSpace(raw)
			envelope, err := atlaspkg.BuildEnvelope("", "", command.resource, atlaspkg.MachineSelector(command.selector), options)
			if err != nil {
				return err
			}
			envelope.Meta["observed_at"] = observedAt
			if err := writeJSON(stdout, envelope); err != nil {
				return err
			}
		}
		return nil
	}
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupts)
	for {
		envelope, err := atlaspkg.BuildEnvelope("", "", command.resource, atlaspkg.MachineSelector(command.selector), options)
		if err != nil {
			return err
		}
		envelope.Meta["observed_at"] = time.Now().UTC().Format(time.RFC3339)
		if err := writeJSON(stdout, envelope); err != nil {
			return err
		}
		select {
		case <-interrupts:
			return nil
		case <-time.After(time.Second):
		}
	}
}

func characterDevice(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func interactiveColorEnabled() bool {
	_, noColor := os.LookupEnv("NO_COLOR")
	return atlaspkg.ColorEnabled("auto", false, true, strings.EqualFold(os.Getenv("TERM"), "dumb"), noColor)
}

func readActiveRun(reader *vaultregistry.Reader, selector selector) (vaultregistry.Run, error) {
	runs, err := reader.List()
	if err != nil {
		return vaultregistry.Run{}, err
	}
	return resolveRun(selector, runs)
}

func resolveRun(selector selector, runs []vaultregistry.Run) (vaultregistry.Run, error) {
	var zero vaultregistry.Run
	if selector.ID != "" {
		matches := filterRuns(runs, func(run vaultregistry.Run) bool { return run.RunID == selector.ID })
		if len(matches) == 0 {
			return zero, fmt.Errorf("%w: %s", vaultregistry.ErrNotFound, selector.ID)
		}
		if len(matches) != 1 {
			return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.ID)
		}
		return matches[0], nil
	}
	if selector.Name != "" {
		matches := filterRuns(runs, func(run vaultregistry.Run) bool { return run.Name == selector.Name })
		if len(matches) == 0 {
			return zero, fmt.Errorf("%w: %s", vaultregistry.ErrNotFound, selector.Name)
		}
		if len(matches) != 1 {
			return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.Name)
		}
		return matches[0], nil
	}
	if selector.Positional == "" {
		return zero, fmt.Errorf("%w: selector is required", vaultregistry.ErrNotFound)
	}
	idMatches := filterRuns(runs, func(run vaultregistry.Run) bool { return run.RunID == selector.Positional })
	nameMatches := filterRuns(runs, func(run vaultregistry.Run) bool { return run.Name == selector.Positional })
	if len(idMatches) == 0 && len(nameMatches) == 0 {
		return zero, fmt.Errorf("%w: %s", vaultregistry.ErrNotFound, selector.Positional)
	}
	if len(idMatches) > 1 || len(nameMatches) > 1 {
		return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.Positional)
	}
	if len(idMatches) == 1 && len(nameMatches) == 1 && idMatches[0].RunID != nameMatches[0].RunID {
		return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.Positional)
	}
	if len(idMatches) == 1 {
		return idMatches[0], nil
	}
	return nameMatches[0], nil
}

func filterRuns(runs []vaultregistry.Run, include func(vaultregistry.Run) bool) []vaultregistry.Run {
	matches := make([]vaultregistry.Run, 0, 2)
	for _, run := range runs {
		if include(run) {
			matches = append(matches, run)
		}
	}
	return matches
}

func renderRunList(runs []vaultregistry.RunSummary) string {
	var builder strings.Builder
	builder.WriteString("ATLAS OBSERVE\n")
	builder.WriteString("RUN\tTASK\tREVISION\tUPDATED\n")
	for _, run := range runs {
		title := ""
		if run.Task != nil {
			title = run.Task.Title
		} else if run.WorkReference != nil {
			title = run.WorkReference.Title
		}
		fmt.Fprintf(&builder, "%s\t%s\t%d\t%s\n", run.RunID, title, run.Revision, run.UpdatedAt)
	}
	return builder.String()
}

func renderRun(run vaultregistry.Run) string {
	stage, state := run.Stage, ""
	if stage == "" && len(run.Lifecycle) != 0 {
		latest := run.Lifecycle[len(run.Lifecycle)-1]
		stage, state = latest.Kind, latest.State
	}
	title := run.Task.Title
	if title == "" && run.WorkReference != nil {
		title = run.WorkReference.Title
	}
	var builder strings.Builder
	builder.WriteString("ATLAS OBSERVE\n")
	builder.WriteString("RUN\tTASK\tSTATE\tSTAGE\tREVISION\tUPDATED\n")
	fmt.Fprintf(&builder, "%s\t%s\t%s\t%s\t%d\t%s\n", run.RunID, title, state, stage, run.Revision, run.UpdatedAt)
	return builder.String()
}

func runName(run vaultregistry.Run) string {
	if run.Name != "" {
		return run.Name
	}
	return run.RunID
}

type envelope struct {
	APIVersion string         `json:"api_version"`
	Kind       string         `json:"kind"`
	Data       any            `json:"data"`
	Meta       map[string]any `json:"meta"`
}

func writeJSON(output io.Writer, value any) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func sortedKeys(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func parseExpectedRevision(raw string) (uint64, error) {
	revision, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || revision == 0 {
		return 0, usageError("expected revision must be a positive integer")
	}
	return revision, nil
}

func usageError(message string) error {
	return &commandError{code: 2, message: "atlas: " + message, usage: true}
}

func quote(value string) string { return fmt.Sprintf("%q", value) }
