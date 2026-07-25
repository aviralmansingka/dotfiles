package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/atlas"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/herdrsocket"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "vault-hunter-atlas:", err)
		os.Exit(2)
	}
}

func run(args []string, stdout io.Writer) error {
	if len(args) == 0 || args[0] != "render" {
		return fmt.Errorf("usage: vault-hunter-atlas render [--registry FILE | selected-agent flags]")
	}
	flags := flag.NewFlagSet("render", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	registry := flags.String("registry", "", "Run Registry snapshot")
	stateDir := flags.String("state-dir", defaultStateDir(), "Vault Hunter state directory")
	socket := flags.String("socket", os.Getenv("HERDR_SOCKET_PATH"), "Herdr Unix socket")
	terminalID := flags.String("terminal-id", "", "selected Herdr terminal ID")
	sessionSource := flags.String("agent-session-source", "", "selected agent session source")
	sessionKind := flags.String("agent-session-kind", "", "selected agent session kind")
	sessionValue := flags.String("agent-session-value", "", "selected agent session value")
	profile := flags.String("profile", "compact", "compact or expanded")
	width := flags.Int("width", 78, "terminal width")
	height := flags.Int("height", 17, "terminal height")
	frame := flags.String("frame", "", "deterministic red, edit, test, or green frame")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	var selectedRun atlas.Run
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
		selectedRun, _, err = runregistry.FindParticipant(
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
		client := herdrsocket.Client{SocketPath: *socket}
		for _, participant := range selectedRun.Participants {
			if _, err := client.Snapshot(context.Background(), participant.PaneID); err != nil {
				return err
			}
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
		output = atlas.RenderCompact(selectedRun, *width, *height)
	case "expanded":
		output = atlas.RenderExpanded(selectedRun, *width, *height)
	default:
		return fmt.Errorf("unknown profile %q", *profile)
	}
	_, err = io.WriteString(stdout, output)
	return err
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
