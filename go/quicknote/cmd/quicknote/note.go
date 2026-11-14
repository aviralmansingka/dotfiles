// Package main records fleeting notes into the vault.
//
// One binary, two audiences: a plain capture for agents and pipes, and a small
// Charm UI for the human capture box.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

// Entry is one capture, before it becomes a note. The title names the file; the
// body is the optional detail the second input collects.
type Entry struct {
	Title string
	Body  string
}

// Result is what a capture reports, in both plain and JSON form.
type Result struct {
	OK        bool   `json:"ok"`
	Path      string `json:"path"`
	Title     string `json:"title"`
	Created   bool   `json:"created"`
	Duplicate bool   `json:"duplicate,omitempty"`
	Appended  bool   `json:"appended,omitempty"`
	DryRun    bool   `json:"dry_run,omitempty"`
}

// fleetingTag is the note type. The system keeps four tags and no folders, so a
// capture only ever claims this one.
const fleetingTag = "fleeting"

// noteBody is the note: the type tag in frontmatter, then a callout holding the
// thought in the words it was captured with, so the original survives any later
// rewrite into an atomic note.
func noteBody(slug, title, detail string, captured time.Time) string {
	var quoted strings.Builder
	fmt.Fprintf(&quoted, "> [!FLEETING] %s", strings.TrimSpace(title))
	for _, line := range quoteLines(detail) {
		quoted.WriteString("\n> " + line)
	}
	return "---\nid: " + slug + "\naliases: []\ntags: [" + fleetingTag +
		"]\ncaptured: " + captured.Format(time.RFC3339) + "\n---\n\n" + quoted.String() + "\n"
}

// quoteLines splits detail into the lines a callout can hold.
func quoteLines(detail string) []string {
	var out []string
	for _, line := range strings.Split(strings.ReplaceAll(detail, "\r\n", "\n"), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

// slug turns the thought into its filename. The name is identity here, so it
// stays human readable: the first words of the thought, kebab-cased.
func slug(text string) string {
	var words []string
	var word strings.Builder
	flush := func() {
		if word.Len() > 0 {
			words = append(words, strings.ToLower(word.String()))
			word.Reset()
		}
	}
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			word.WriteRune(r)
			continue
		}
		if unicode.Is(unicode.Mn, r) || r == '\'' || r == '\u2019' {
			continue
		}
		flush()
	}
	flush()
	name := strings.Join(words, "-")
	// Long thoughts keep the words up to the last whole one that fits, so the
	// name stays a readable summary instead of a cut-off phrase.
	if len(name) > 60 {
		name = strings.Trim(name[:60], "-")
		if i := strings.LastIndex(name, "-"); i > 0 {
			name = name[:i]
		}
	}
	if name == "" {
		name = "untitled-thought"
	}
	return name
}

// vaultDir resolves the vault root: the flag wins, then the environment, then
// the usual ~/vault.
func vaultDir(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	for _, key := range []string{"QUICKNOTE_VAULT", "VAULT_DIR"} {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "vault"
	}
	return filepath.Join(home, "vault")
}

// relPath shortens a path under the home directory for display.
func relPath(path string) string {
	home, err := os.UserHomeDir()
	if err == nil && strings.HasPrefix(path, home+string(os.PathSeparator)) {
		return "~" + strings.TrimPrefix(path, home)
	}
	return path
}

// noteFile is where a capture lands: one note per thought, named after it.
func noteFile(vault string, e Entry) string {
	return filepath.Join(vault, "0_inbox", fleetingTag, slug(e.Title)+".md")
}

// Append writes one note and reports where it went. Capturing the same thought
// twice returns the first note instead of a second copy; a different thought
// that slugs the same way gets a numbered sibling.
func Append(vault string, e Entry, dry bool) (Result, error) {
	title := strings.TrimSpace(e.Title)
	if title == "" {
		return Result{}, errors.New("empty note")
	}
	path := noteFile(vault, e)
	res := Result{OK: true, Path: path, Title: title, Created: true, DryRun: dry}

	// The capture time is the note's own, so a later snooze rewrite cannot make
	// an old thought look new.
	body := noteBody(slug(title), title, e.Body, time.Now())
	for i := 2; ; i++ {
		existing, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			break
		}
		if err != nil {
			return res, err
		}
		// The same callout means the same thought. New detail still belongs in
		// that note, so it is appended rather than dropped.
		if strings.Contains(string(existing), "> [!FLEETING] "+title) {
			res.Created = false
			res.Duplicate = true
			extra := quoteLines(e.Body)
			if len(extra) > 0 && !strings.Contains(string(existing), "> "+extra[0]) {
				res.Appended = true
				if dry {
					return res, nil
				}
				appendErr := appendLines(path, extra)
				return res, appendErr
			}
			return res, nil
		}
		base := strings.TrimSuffix(noteFile(vault, e), ".md")
		path = fmt.Sprintf("%s-%d.md", base, i)
		res.Path = path
	}
	if dry {
		return res, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return res, err
	}
	// O_EXCL keeps a race from overwriting a note that appeared meanwhile.
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return res, err
	}
	defer f.Close()
	if _, err := f.WriteString(body); err != nil {
		return res, err
	}
	return res, nil
}

// appendLines adds detail lines to an existing note's callout.
func appendLines(path string, lines []string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	for _, line := range lines {
		if _, err := f.WriteString("> " + line + "\n"); err != nil {
			return err
		}
	}
	return nil
}

func report(res Result, jsonOut bool) {
	if jsonOut {
		fmt.Println(jsonText(res))
		return
	}
	if res.Appended {
		fmt.Println("+ " + relPath(res.Path) + " (detail added)")
		return
	}
	if res.Duplicate {
		fmt.Println("= " + relPath(res.Path) + " (already captured)")
		return
	}
	fmt.Println("→ " + relPath(res.Path))
}

func check(err error) int {
	if err == nil {
		return 0
	}
	fmt.Fprintln(os.Stderr, "quicknote: "+err.Error())
	return 1
}
