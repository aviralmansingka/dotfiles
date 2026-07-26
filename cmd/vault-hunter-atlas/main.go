package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/atlascompanion"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "companion":
			if err := companion(os.Args[2:]); err != nil {
				fail(err)
			}
			return
		case "preview":
			if err := preview(os.Args[2:]); err != nil {
				fail(err)
			}
			return
		}
	}
	render(os.Args[1:])
}

func companion(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: vault-hunter-atlas companion attach|cleanup")
	}
	flags := flag.NewFlagSet("companion "+args[0], flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	runID := flags.String("run-id", "", "Run ID")
	workspaceID := flags.String("workspace-id", "", "Herdr workspace ID")
	stateDir := flags.String("state-dir", "", "Vault Hunter state directory")
	tabID := flags.String("tab-id", "", "owned Herdr tab ID")
	paneID := flags.String("pane-id", "", "owned Herdr pane ID")
	terminalID := flags.String("terminal-id", "", "owned Herdr terminal ID")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected companion arguments")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	client := atlascompanion.Client{Herdr: "herdr", Executable: executable}
	var result any
	switch args[0] {
	case "attach":
		if *tabID != "" || *paneID != "" || *terminalID != "" {
			return errors.New("attach does not accept cleanup tuple flags")
		}
		reader, openErr := vaultregistry.OpenReader(*stateDir)
		if openErr != nil {
			return openErr
		}
		run, getErr := reader.Get(*runID)
		if getErr != nil {
			return getErr
		}
		result, err = client.AttachRun(run, *workspaceID, *stateDir)
	case "cleanup":
		tuple := atlascompanion.Tuple{RunID: *runID, WorkspaceID: *workspaceID, TabID: *tabID, PaneID: *paneID, TerminalID: *terminalID}
		result, err = tuple, client.Cleanup(tuple, *stateDir)
	default:
		return fmt.Errorf("unknown companion command %q", args[0])
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

func preview(args []string) error {
	flags := flag.NewFlagSet("preview", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	workspaceID := flags.String("workspace-id", "", "Herdr workspace ID")
	tabID := flags.String("tab-id", "", "Herdr tab ID")
	paneID := flags.String("pane-id", "", "Herdr pane ID")
	terminalID := flags.String("terminal-id", "", "Herdr terminal ID")
	sessionSource := flags.String("agent-session-source", "", "agent-session source")
	sessionKind := flags.String("agent-session-kind", "", "agent-session kind")
	sessionValue := flags.String("agent-session-value", "", "agent-session value")
	width := flags.Int("width", 0, "preview width")
	height := flags.Int("height", 0, "preview height")
	stateDir := flags.String("state-dir", "", "Vault Hunter state directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected preview arguments")
	}
	reader, err := vaultregistry.OpenReader(*stateDir)
	if err != nil {
		return err
	}
	selected := atlascompanion.Agent{
		WorkspaceID: *workspaceID,
		TabID:       *tabID,
		PaneID:      *paneID,
		TerminalID:  *terminalID,
		AgentSession: &vaultregistry.AgentSession{
			Source: *sessionSource,
			Kind:   *sessionKind,
			Value:  *sessionValue,
		},
	}
	result, err := (atlascompanion.Client{Herdr: "herdr"}).Preview(reader, selected, *width, *height)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

func render(args []string) {
	flags := flag.NewFlagSet("vault-hunter-atlas", flag.ExitOnError)
	runID := flags.String("run-id", "", "Run ID to display")
	stateDir := flags.String("state-dir", "", "Vault Hunter state directory")
	vaultDir := flags.String("vault-dir", "", "canonical vault root")
	featurePath := flags.String("feature", "", "vault-relative canonical feature.md target")
	projectPath := flags.String("project", "", "vault-relative canonical project target")
	selectedTaskPath := flags.String("select-task", "", "vault-relative Task path to open from an aggregate")
	colorMode := flags.String("color", "auto", "aggregate color mode: auto, always, or never")
	expanded := flags.Bool("expanded", false, "print the expanded Operations Board")
	snapshot := flags.Bool("snapshot", false, "print one deterministic frame")
	width := flags.Int("width", 0, "frame width")
	height := flags.Int("height", 0, "frame height")
	flags.Parse(args)
	if *colorMode != "auto" && *colorMode != "always" && *colorMode != "never" {
		flags.Usage()
		os.Exit(2)
	}
	aggregateMode := *featurePath != "" || *projectPath != ""
	if flags.NArg() != 0 || (*featurePath != "" && *projectPath != "") || (aggregateMode && (*expanded || *runID != "" || *vaultDir == "" || *stateDir == "")) || (!aggregateMode && (*runID == "" || *selectedTaskPath != "" || *vaultDir != "")) {
		flags.Usage()
		os.Exit(2)
	}
	widthSet, heightSet := false, false
	flags.Visit(func(f *flag.Flag) {
		widthSet = widthSet || f.Name == "width"
		heightSet = heightSet || f.Name == "height"
	})
	if widthSet != heightSet {
		fmt.Fprintln(os.Stderr, "width and height must be supplied together")
		os.Exit(2)
	}
	if widthSet && (*width <= 0 || *height <= 0) {
		fmt.Fprintln(os.Stderr, "width and height must be positive")
		os.Exit(2)
	}

	reader, err := vaultregistry.OpenReader(*stateDir)
	if err != nil {
		fail(err)
	}
	if aggregateMode {
		runs, err := reader.List()
		if err != nil {
			fail(err)
		}
		var projection atlas.Aggregate
		if *featurePath != "" {
			projection, err = atlas.DiscoverFeature(*vaultDir, *featurePath, runs)
		} else {
			projection, err = atlas.DiscoverProject(*vaultDir, *projectPath, runs)
		}
		if err != nil {
			fail(err)
		}
		if *selectedTaskPath == "" {
			_, noColor := os.LookupEnv("NO_COLOR")
			color := atlas.ColorEnabled(*colorMode, *snapshot, characterDevice(os.Stdout), os.Getenv("TERM") == "dumb", noColor)
			fmt.Println(projection.RenderColor(color))
			return
		}
		task, ok := projection.Task(*selectedTaskPath)
		if !ok {
			fail(fmt.Errorf("selected Task not found: %s", *selectedTaskPath))
		}
		fmt.Printf("Selected Task %s · %s\n", task.ID, task.Path)
		if task.RunID == "" {
			fmt.Println("No registered Task Run")
			return
		}
		*runID = task.RunID
	}
	run, err := reader.Get(*runID)
	if err != nil {
		fail(err)
	}
	if *expanded {
		if !widthSet {
			*width, *height = 160, 48
		}
		fmt.Println(atlas.NewModel(run, *width, *height).ExpandedView())
		return
	}

	static := *snapshot || os.Getenv("TERM") == "dumb" || !characterDevice(os.Stdin) || !characterDevice(os.Stdout)
	if static {
		if !widthSet {
			*width, *height = 80, 24
		}
		fmt.Println(atlas.NewModel(run, *width, *height).View())
		return
	}
	if _, err := tea.NewProgram(atlas.NewModel(run, *width, *height), tea.WithAltScreen()).Run(); err != nil {
		fail(err)
	}
}

func characterDevice(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
