package main

import (
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func main() {
	runID := flag.String("run-id", "", "Run ID to display")
	stateDir := flag.String("state-dir", "", "Vault Hunter state directory")
	snapshot := flag.Bool("snapshot", false, "print one deterministic frame")
	width := flag.Int("width", 0, "frame width")
	height := flag.Int("height", 0, "frame height")
	flag.Parse()
	if *runID == "" {
		flag.Usage()
		os.Exit(2)
	}
	if (*width == 0) != (*height == 0) {
		fmt.Fprintln(os.Stderr, "width and height must be supplied together")
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
		if *width == 0 {
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
