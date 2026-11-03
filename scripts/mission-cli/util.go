package main

import (
	"os"
	"path/filepath"

	"github.com/charmbracelet/x/term"
)

func fallback(v, d string) string {
	if v != "" {
		return v
	}
	return d
}

func terminal() bool { return term.IsTerminal(os.Stdin.Fd()) && term.IsTerminal(os.Stdout.Fd()) }

func artifactPath(s *Store, c Claim) string {
	d, _ := s.dir(c.Handle)
	return filepath.Join(d, filepath.FromSlash(c.Attempt.Artifact))
}
