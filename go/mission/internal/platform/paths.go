package platform

import (
	"os"
	"path/filepath"

	"github.com/charmbracelet/x/term"
)

// Fallback returns v, or d when v is empty.
func Fallback(v, d string) string {
	if v != "" {
		return v
	}
	return d
}

// Terminal reports whether stdin and stdout are terminals.
func Terminal() bool { return term.IsTerminal(os.Stdin.Fd()) && term.IsTerminal(os.Stdout.Fd()) }

// ArtifactPath joins a mission directory with a relative artifact path.
func ArtifactPath(dir, artifact string) string {
	return filepath.Join(dir, filepath.FromSlash(artifact))
}

// Machine returns the host name that binds records to one machine.
func Machine() string { h, _ := os.Hostname(); return h }
