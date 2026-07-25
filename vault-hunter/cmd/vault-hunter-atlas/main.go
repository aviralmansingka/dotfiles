package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/atlas"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "vault-hunter-atlas:", err)
		os.Exit(2)
	}
}

func run(args []string) error {
	if len(args) == 0 || args[0] != "render" {
		return fmt.Errorf("usage: vault-hunter-atlas render --registry FILE [--profile compact|expanded]")
	}
	flags := flag.NewFlagSet("render", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	registry := flags.String("registry", "", "Run Registry snapshot")
	profile := flags.String("profile", "compact", "compact or expanded")
	width := flags.Int("width", 78, "terminal width")
	height := flags.Int("height", 17, "terminal height")
	frame := flags.String("frame", "", "deterministic red, edit, test, or green frame")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if *registry == "" {
		return fmt.Errorf("--registry is required")
	}
	data, err := os.ReadFile(*registry)
	if err != nil {
		return err
	}
	run, err := atlas.DecodeRun(data)
	if err != nil {
		return err
	}
	if *frame != "" {
		run, err = atlas.ApplyFrame(run, atlas.Frame(*frame))
		if err != nil {
			return err
		}
	}

	var output string
	switch *profile {
	case "compact":
		output = atlas.RenderCompact(run, *width, *height)
	case "expanded":
		output = atlas.RenderExpanded(run, *width, *height)
	default:
		return fmt.Errorf("unknown profile %q", *profile)
	}
	fmt.Print(output)
	return nil
}
