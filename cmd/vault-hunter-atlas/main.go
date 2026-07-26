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
	vaultDir := flag.String("vault-dir", "", "canonical vault root")
	featurePath := flag.String("feature", "", "vault-relative canonical feature.md target")
	projectPath := flag.String("project", "", "vault-relative canonical project target")
	selectedTaskPath := flag.String("select-task", "", "vault-relative Task path to open from an aggregate")
	snapshot := flag.Bool("snapshot", false, "print one deterministic frame")
	width := flag.Int("width", 0, "frame width")
	height := flag.Int("height", 0, "frame height")
	flag.Parse()
	aggregateMode := *featurePath != "" || *projectPath != ""
	if flag.NArg() != 0 || (*featurePath != "" && *projectPath != "") || (aggregateMode && (*runID != "" || *vaultDir == "" || *stateDir == "")) || (!aggregateMode && (*runID == "" || *selectedTaskPath != "" || *vaultDir != "")) {
		flag.Usage()
		os.Exit(2)
	}
	widthSet, heightSet := false, false
	flag.Visit(func(f *flag.Flag) {
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
			fmt.Println(projection.Render())
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
