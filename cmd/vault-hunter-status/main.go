package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
	"unicode"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const (
	authorityFooter = "Observation authority: Run Registry observations are not canonical status; the canonical vault note and active parent remain authoritative.\n"
	usageText       = `usage: vault-hunter-status [list] [--json] [--color=auto|always|never]
       vault-hunter-status run RUN_ID [--json] [--color=auto|always|never]
       vault-hunter-status record RUN_ID
       vault-hunter-status registry RUN_ID
       vault-hunter-status journey RUN_ID
       vault-hunter-status evidence RUN_ID
       vault-hunter-status atlas RUN_ID
       vault-hunter-status watch RUN_ID [--interval=DURATION]
`
)

type options struct {
	command  string
	runID    string
	json     bool
	color    string
	interval time.Duration
}

type commandError struct {
	code    int
	message string
	usage   bool
}

func (e commandError) Error() string { return e.message }

func main() {
	code, err := execute(os.Args[1:], os.Stdout)
	if err != nil {
		if err.Error() != "" {
			fmt.Fprintln(os.Stderr, err)
		}
		var commandErr *commandError
		if errors.As(err, &commandErr) && commandErr.usage {
			fmt.Fprint(os.Stderr, usageText)
		}
		os.Exit(code)
	}
}

func execute(args []string, output *os.File) (int, error) {
	opts, err := parseArgs(args)
	if err != nil {
		return err.code, err
	}
	if opts.command == "help" {
		fmt.Fprint(output, usageText)
		return 0, nil
	}

	reader, openErr := vaultregistry.OpenReader("")
	if openErr != nil {
		return 1, openErr
	}
	if opts.command == "watch" {
		if !terminal(output) {
			return 2, commandError{code: 2, message: "vault-hunter-status: watch requires a terminal (TTY)"}
		}
		return watch(reader, opts, output)
	}

	switch opts.command {
	case "list":
		runs, listErr := reader.ListSummaries(vaultregistry.ListFilter{})
		if listErr != nil {
			return 1, listErr
		}
		if opts.json {
			return encodeJSON(output, runs)
		}
		return writeHuman(output, renderList(runs), colorEnabled(opts.color, output))
	case "run":
		run, getErr := reader.Get(opts.runID)
		if getErr != nil {
			return 1, getErr
		}
		if opts.json {
			record, recordErr := observationRecord(run)
			if recordErr != nil {
				return 1, recordErr
			}
			return encodeJSON(output, record)
		}
		return writeHuman(output, renderRun(run), colorEnabled(opts.color, output))
	case "record", "registry":
		run, getErr := reader.Get(opts.runID)
		if getErr != nil {
			return 1, getErr
		}
		record, recordErr := observationRecord(run)
		if recordErr != nil {
			return 1, recordErr
		}
		return writeProjection(output, record)
	case "journey":
		run, getErr := reader.Get(opts.runID)
		if getErr != nil {
			return 1, getErr
		}
		return writeSelectedProjection(output, run.RunID, "journey", journey(run))
	case "evidence":
		run, getErr := reader.Get(opts.runID)
		if getErr != nil {
			return 1, getErr
		}
		return writeSelectedProjection(output, run.RunID, "evidence", run.Evidence)
	case "atlas":
		run, getErr := reader.Get(opts.runID)
		if getErr != nil {
			return 1, getErr
		}
		view, renderErr := renderAtlas(run)
		if renderErr != nil {
			return 1, renderErr
		}
		return writeHuman(output, "TASK RUN ATLAS\n"+view, false)
	default:
		return 2, commandError{code: 2, message: "vault-hunter-status: unsupported command", usage: true}
	}
}

func parseArgs(args []string) (options, *commandError) {
	opts := options{command: "list", color: "auto", interval: time.Second}
	if len(args) == 0 {
		return opts, nil
	}
	if args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		if len(args) != 1 {
			return options{}, usageError("help does not accept arguments")
		}
		opts.command = "help"
		return opts, nil
	}
	if !strings.HasPrefix(args[0], "-") {
		opts.command = args[0]
		args = args[1:]
	}

	switch opts.command {
	case "list":
		return parseDisplayOptions(opts, args)
	case "run":
		if len(args) == 0 || strings.HasPrefix(args[0], "-") {
			return options{}, usageError("run requires RUN_ID")
		}
		opts.runID, args = args[0], args[1:]
		return parseDisplayOptions(opts, args)
	case "record", "registry", "journey", "evidence", "atlas":
		if len(args) != 1 || strings.HasPrefix(args[0], "-") {
			return options{}, usageError(opts.command + " requires exactly one RUN_ID")
		}
		opts.runID = args[0]
		return opts, nil
	case "watch":
		if len(args) == 0 || strings.HasPrefix(args[0], "-") {
			return options{}, usageError("watch requires RUN_ID")
		}
		opts.runID, args = args[0], args[1:]
		for _, arg := range args {
			if !strings.HasPrefix(arg, "--interval=") {
				return options{}, usageError("invalid watch option " + arg)
			}
			value := strings.TrimPrefix(arg, "--interval=")
			interval, durationErr := time.ParseDuration(value)
			if durationErr != nil || interval <= 0 {
				return options{}, usageError("invalid watch interval")
			}
			opts.interval = interval
		}
		return opts, nil
	default:
		return options{}, usageError("unknown command " + opts.command)
	}
}

func parseDisplayOptions(opts options, args []string) (options, *commandError) {
	for _, arg := range args {
		switch {
		case arg == "--json":
			opts.json = true
		case strings.HasPrefix(arg, "--color="):
			opts.color = strings.TrimPrefix(arg, "--color=")
			if opts.color != "auto" && opts.color != "always" && opts.color != "never" {
				return options{}, usageError("invalid color mode")
			}
		default:
			return options{}, usageError("invalid option " + arg)
		}
	}
	return opts, nil
}

func usageError(message string) *commandError {
	return &commandError{code: 2, message: "vault-hunter-status: " + message, usage: true}
}

func renderAtlas(run vaultregistry.Run) (string, error) {
	command := exec.Command("vault-hunter-atlas", "--run-id", run.RunID, "--snapshot", "--width", "100", "--height", "30")
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("vault-hunter-status: atlas: %s", message)
	}
	view := sanitizeAtlasRegistryStrings(stdout.String(), run)
	// Keep the frame's geometry byte-bounded for logs while retaining the
	// renderer's rows and any styling it generates.
	view = strings.NewReplacer("─", "-", "│", "|", "┼", "+").Replace(view)
	return view, nil
}

func renderList(runs []vaultregistry.RunSummary) string {
	var result strings.Builder
	result.WriteString("VAULT HUNTER STATUS\n")
	result.WriteString("RUN\tTASK\tREVISION\tUPDATED\n")
	for _, run := range runs {
		fmt.Fprintf(&result, "%s\t%s\t%d\t%s\n",
			escapeControls(run.RunID), escapeControls(run.Task.Title), run.Revision, escapeControls(run.UpdatedAt))
	}
	return result.String()
}

func renderRun(run vaultregistry.Run) string {
	stage, state, goal := "unknown", "unknown", "-"
	if len(run.Lifecycle) != 0 {
		latest := run.Lifecycle[len(run.Lifecycle)-1]
		stage, state, goal = latest.Kind, latest.State, latest.GoalID
	}
	return fmt.Sprintf("VAULT HUNTER STATUS\nRUN\tTASK\tSTATE\tSTAGE\tGOAL\tREVISION\tUPDATED\n%s\t%s\t%s\t%s\t%s\t%d\t%s\n",
		escapeControls(run.RunID), escapeControls(run.Task.Title), escapeControls(state),
		escapeControls(stage), escapeControls(goal), run.Revision, escapeControls(run.UpdatedAt))
}

func escapeControls(value string) string {
	var result strings.Builder
	for _, character := range value {
		if !unicode.IsControl(character) {
			result.WriteRune(character)
			continue
		}
		switch character {
		case '\b':
			result.WriteString(`\b`)
		case '\t':
			result.WriteString(`\t`)
		case '\n':
			result.WriteString(`\n`)
		case '\f':
			result.WriteString(`\f`)
		case '\r':
			result.WriteString(`\r`)
		default:
			if character <= 0xffff {
				fmt.Fprintf(&result, "\\u%04x", character)
			} else {
				fmt.Fprintf(&result, "\\U%08x", character)
			}
		}
	}
	return result.String()
}

func sanitizeAtlasRegistryStrings(view string, run vaultregistry.Run) string {
	values := []string{
		run.RunID, run.InvokedAt, run.UpdatedAt,
		run.Task.ID, run.Task.Title, run.Task.Path, run.Task.FeaturePath, run.Task.Kind,
	}
	for _, participant := range run.Participants {
		values = append(values, participant.ParticipantID, participant.ObservedAt, participant.Role, participant.GoalID)
		if participant.Herdr != nil {
			values = append(values, participant.Herdr.WorkspaceID, participant.Herdr.TabID, participant.Herdr.PaneID, participant.Herdr.TerminalID)
		}
		if participant.AgentSession != nil {
			values = append(values, participant.AgentSession.Source, participant.AgentSession.Kind, participant.AgentSession.Value)
		}
	}
	for _, observation := range run.Lifecycle {
		values = append(values, observation.ObservationID, observation.ObservedAt, observation.Kind,
			observation.GoalID, observation.State, observation.Detail)
	}
	for _, observation := range run.Evidence {
		values = append(values, observation.ObservationID, observation.ObservedAt, observation.VerifierID,
			observation.State, observation.Command, observation.ImplementationTree,
			observation.ArtifactSHA256, observation.Detail)
	}
	for _, value := range values {
		if escaped := escapeControls(value); escaped != value {
			view = strings.ReplaceAll(view, value, escaped)
		}
	}
	return view
}

func writeHuman(output io.Writer, body string, color bool) (int, error) {
	if color {
		const style = "\x1b[1;38;2;242;133;52m"
		const reset = "\x1b[0m"
		body = style + strings.ReplaceAll(body, "\n", reset+"\n"+style)
		body = strings.TrimSuffix(body, style)
	}
	_, err := io.WriteString(output, body+authorityFooter)
	if err != nil {
		return 1, err
	}
	return 0, nil
}

func encodeJSON(output io.Writer, value any) (int, error) {
	if err := json.NewEncoder(output).Encode(value); err != nil {
		return 1, err
	}
	return 0, nil
}

// observationRecord keeps Registry extensions while omitting absent optional
// participant identities from the observer's full-record projection.
func observationRecord(run vaultregistry.Run) (map[string]any, error) {
	data, err := json.Marshal(run)
	if err != nil {
		return nil, err
	}
	var record map[string]any
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	participants, _ := record["participants"].([]any)
	for _, value := range participants {
		participant, _ := value.(map[string]any)
		for _, field := range []string{"herdr", "agent_session"} {
			if participant[field] == nil {
				delete(participant, field)
			}
		}
	}
	return record, nil
}

func writeProjection(output io.Writer, value any) (int, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return 1, err
	}
	return writeHuman(output, string(data)+"\n", false)
}

func writeSelectedProjection(output io.Writer, runID, name string, value any) (int, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return 1, err
	}
	body := fmt.Sprintf("Run %s %s\n%s\n", runID, name, data)
	return writeHuman(output, body, false)
}

type journeyEntry struct {
	ObservationID string `json:"observation_id"`
	At            string `json:"at"`
	Stage         string `json:"stage"`
	State         string `json:"state"`
	Goal          string `json:"goal"`
	Detail        string `json:"detail"`
}

func journey(run vaultregistry.Run) []journeyEntry {
	entries := make([]journeyEntry, 0, len(run.Lifecycle))
	for _, observation := range run.Lifecycle {
		if strings.HasPrefix(observation.Kind, "subagent/") || observation.Kind == "parent/usage" {
			continue
		}
		entries = append(entries, journeyEntry{
			ObservationID: observation.ObservationID, At: observation.ObservedAt,
			Stage: observation.Kind, State: observation.State,
			Goal: observation.GoalID, Detail: observation.Detail,
		})
	}
	return entries
}

func colorEnabled(mode string, output *os.File) bool {
	if mode == "always" {
		return true
	}
	if mode == "never" || os.Getenv("TERM") == "dumb" || os.Getenv("NO_COLOR") != "" {
		return false
	}
	return terminal(output)
}

func watch(reader *vaultregistry.Reader, opts options, output *os.File) (int, error) {
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupts)

	if _, err := io.WriteString(output, "\x1b[?25l"); err != nil {
		return 1, err
	}
	defer func() { _, _ = io.WriteString(output, "\x1b[?25h\n") }()

	ticker := time.NewTicker(opts.interval)
	defer ticker.Stop()
	for {
		run, err := reader.Get(opts.runID)
		if err != nil {
			return 1, err
		}
		if _, err := io.WriteString(output, "\x1b[H\x1b[2J"); err != nil {
			return 1, err
		}
		if code, err := writeHuman(output, renderRun(run), colorEnabled("auto", output)); err != nil {
			return code, err
		}
		select {
		case <-interrupts:
			return 0, nil
		case <-ticker.C:
		}
	}
}
