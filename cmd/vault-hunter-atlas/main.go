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
	if len(os.Args) > 1 && os.Args[1] == "companion" {
		if err := companion(os.Args[2:]); err != nil {
			fail(err)
		}
		return
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
	var tuple atlascompanion.Tuple
	switch args[0] {
	case "attach":
		if *tabID != "" || *paneID != "" || *terminalID != "" {
			return errors.New("attach does not accept cleanup tuple flags")
		}
		tuple, err = client.Attach(*runID, *workspaceID, *stateDir)
	case "cleanup":
		tuple = atlascompanion.Tuple{RunID: *runID, WorkspaceID: *workspaceID, TabID: *tabID, PaneID: *paneID, TerminalID: *terminalID}
		err = client.Cleanup(tuple, *stateDir)
	default:
		return fmt.Errorf("unknown companion command %q", args[0])
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(tuple)
}

func render(args []string) {
	flags := flag.NewFlagSet("vault-hunter-atlas", flag.ExitOnError)
	runID := flags.String("run-id", "", "Run ID to display")
	stateDir := flags.String("state-dir", "", "Vault Hunter state directory")
	snapshot := flags.Bool("snapshot", false, "print one deterministic frame")
	width := flags.Int("width", 0, "frame width")
	height := flags.Int("height", 0, "frame height")
	flags.Parse(args)
	if *runID == "" {
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
	run, err := reader.Get(*runID)
	if err != nil {
		fail(err)
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
