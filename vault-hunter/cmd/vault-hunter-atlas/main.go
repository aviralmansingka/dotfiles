package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/atlas"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/herdrsocket"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "vault-hunter-atlas:", err)
		os.Exit(2)
	}
}

func run(args []string, stdin io.Reader, stdout io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: vault-hunter-atlas --run RUN_ID | render [options]")
	}
	if args[0] == "render" {
		return runRender(args[1:], stdout)
	}
	return runInteractive(args, stdin, stdout)
}

func runRender(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("render", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	registry := flags.String("registry", "", "Run Registry snapshot")
	stateDir := flags.String("state-dir", defaultStateDir(), "Vault Hunter state directory")
	socket := flags.String("socket", defaultHerdrSocket(), "Herdr Unix socket")
	terminalID := flags.String("terminal-id", "", "selected Herdr terminal ID")
	sessionSource := flags.String("agent-session-source", "", "selected agent session source")
	sessionKind := flags.String("agent-session-kind", "", "selected agent session kind")
	sessionValue := flags.String("agent-session-value", "", "selected agent session value")
	profile := flags.String("profile", "compact", "compact or expanded")
	width := flags.Int("width", 78, "terminal width")
	height := flags.Int("height", 17, "terminal height")
	frame := flags.String("frame", "", "deterministic red, edit, test, or green frame")
	if err := flags.Parse(args); err != nil {
		return err
	}
	var selectedRun atlas.Run
	var selectedParticipant *atlas.Participant
	var live *atlas.LiveState
	var err error
	if *registry != "" {
		data, readErr := os.ReadFile(*registry)
		if readErr != nil {
			return readErr
		}
		selectedRun, err = atlas.DecodeRun(data)
		if err != nil {
			return err
		}
	} else {
		var participant runregistry.Participant
		selectedRun, participant, err = runregistry.FindParticipant(
			*stateDir,
			*terminalID,
			runregistry.AgentSession{
				Source: *sessionSource,
				Kind:   *sessionKind,
				Value:  *sessionValue,
			},
		)
		if err != nil {
			return err
		}
		selectedParticipant = &participant
		live = atlas.NewLiveState(selectedRun.Participants)
		client := herdrsocket.Client{SocketPath: *socket}
		for _, participant := range selectedRun.Participants {
			snapshot, err := client.Snapshot(context.Background(), participant.PaneID)
			if err != nil {
				return err
			}
			live.Refresh(snapshot)
		}
	}
	if *frame != "" {
		selectedRun, err = atlas.ApplyFrame(selectedRun, atlas.Frame(*frame))
		if err != nil {
			return err
		}
	}

	var output string
	switch *profile {
	case "compact":
		if selectedParticipant == nil {
			output = atlas.RenderCompact(selectedRun, *width, *height)
		} else {
			output = atlas.RenderCompactParticipant(
				selectedRun,
				*selectedParticipant,
				live,
				*width,
				*height,
			)
		}
	case "expanded":
		output = atlas.RenderExpandedLive(selectedRun, live, *width, *height)
	default:
		return fmt.Errorf("unknown profile %q", *profile)
	}
	_, err = io.WriteString(stdout, output)
	return err
}

func runInteractive(args []string, stdin io.Reader, stdout io.Writer) error {
	flags := flag.NewFlagSet("interactive", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	runID := flags.String("run", "", "Task Run ID")
	stateDir := flags.String("state-dir", defaultStateDir(), "Vault Hunter state directory")
	socket := flags.String("socket", defaultHerdrSocket(), "Herdr Unix socket")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *runID == "" || flags.NArg() != 0 {
		return fmt.Errorf("--run RUN_ID is required")
	}
	run, err := waitForRun(*stateDir, *runID)
	if err != nil {
		return err
	}
	if run.Task.Kind != "task" {
		return fmt.Errorf("run %s is not a Task Run", run.RunID)
	}
	if len(run.Participants) == 0 {
		return fmt.Errorf("run %s has no registered participants", run.RunID)
	}
	if *socket == "" {
		return fmt.Errorf("Herdr socket path is required")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	live := atlas.NewLiveState(run.Participants)
	reconciler := atlas.NewReconciler(
		herdrsocket.Client{SocketPath: *socket},
		live,
		run.Participants,
	)
	program := tea.NewProgram(
		atlas.NewLiveUIModel(run, live),
		tea.WithContext(ctx),
		tea.WithInput(stdin),
		tea.WithOutput(stdout),
		tea.WithAltScreen(),
	)
	liveErrors := make(chan error, 1)
	go func() {
		err := reconciler.Run(ctx, func() {
			program.Send(struct{}{})
		})
		liveErrors <- err
		if err != nil {
			program.Quit()
		}
	}()

	_, programErr := program.Run()
	cancel()
	if programErr != nil && !errors.Is(programErr, tea.ErrProgramKilled) {
		return programErr
	}
	select {
	case liveErr := <-liveErrors:
		if liveErr != nil && !errors.Is(liveErr, context.Canceled) {
			return liveErr
		}
	default:
	}
	return nil
}

func waitForRun(stateDir, runID string) (runregistry.Run, error) {
	store := runregistry.NewStore(stateDir, nil)
	deadline := time.Now().Add(3 * time.Second)
	for {
		run, err := store.Read(runID)
		if err == nil {
			return run, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return runregistry.Run{}, err
		}
		if time.Now().After(deadline) {
			return runregistry.Run{}, fmt.Errorf("Task Run %s was not committed within 3s", runID)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func defaultStateDir() string {
	if stateHome := os.Getenv("XDG_STATE_HOME"); stateHome != "" {
		return filepath.Join(stateHome, "vault-hunter")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "state", "vault-hunter")
}

func defaultHerdrSocket() string {
	if socket := os.Getenv("HERDR_SOCKET_PATH"); socket != "" {
		return socket
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "herdr", "herdr.sock")
}
