package platform

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"

	"go.yaml.in/yaml/v3"

	"mission.local/prototype/internal/domain/mission"
)

// AtomicWrite replaces one file with b, so a reader never sees a half-written
// record: the bytes land in a temporary file beside it first.
func AtomicWrite(p string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(p), ".mission-tmp-*")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	return os.Rename(name, p)
}

// Markdown renders one record as YAML frontmatter followed by its body.
func Markdown(v any, body string) ([]byte, error) {
	b, e := yaml.Marshal(v)
	if e != nil {
		return nil, e
	}
	return []byte("---\n" + string(b) + "---\n\n" + body + "\n"), nil
}

// ParseMarkdown reads YAML frontmatter into v and returns the body.
func ParseMarkdown(b []byte, v any) (string, error) {
	if len(b) > 16<<20 {
		return "", mission.Problem("too_large", "note exceeds 16 MiB")
	}
	if !bytes.HasPrefix(b, []byte("---\n")) {
		return "", mission.Problem("invalid_note", "missing YAML frontmatter")
	}
	p := bytes.Index(b[4:], []byte("\n---\n"))
	if p < 0 {
		return "", mission.Problem("invalid_note", "unclosed YAML frontmatter")
	}
	p += 4
	if e := yaml.Unmarshal(b[4:p], v); e != nil {
		return "", e
	}
	return strings.TrimSpace(string(b[p+5:])), nil
}
