package main

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"go.yaml.in/yaml/v3"

	"mission.local/prototype/internal/domain/mission"
)

type Store struct {
	Vault string
	// LockDir overrides the machine-wide lock directory. Tests use it to show
	// two actors whose locks do not meet.
	LockDir string
}

var slugRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func validSlug(s string) bool { return len(s) >= 3 && len(s) <= 64 && slugRE.MatchString(s) }
func openStore(v string) (*Store, error) {
	if strings.HasPrefix(v, "~/") {
		h, _ := os.UserHomeDir()
		v = filepath.Join(h, v[2:])
	}
	p, e := filepath.Abs(v)
	if e != nil {
		return nil, e
	}
	p = filepath.Clean(p)
	if e = os.MkdirAll(p, 0700); e != nil {
		return nil, e
	}
	p, e = filepath.EvalSymlinks(p)
	if e != nil {
		return nil, e
	}
	return &Store{Vault: p}, nil
}
func (s *Store) path(parts ...string) (string, error) {
	base := filepath.Join(s.Vault, "6_missions")
	p := filepath.Join(append([]string{base}, parts...)...)
	r, e := filepath.Rel(base, p)
	if e != nil || r == ".." || strings.HasPrefix(r, ".."+string(os.PathSeparator)) {
		return "", mission.Problem("invalid_path", "path escapes mission store")
	}
	// Reject symlink traversal, including the collection root. Reads and writes share this check.
	cur := s.Vault
	rel, _ := filepath.Rel(s.Vault, p)
	for _, c := range strings.Split(rel, string(os.PathSeparator)) {
		cur = filepath.Join(cur, c)
		st, e := os.Lstat(cur)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return "", e
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return "", mission.Problem("invalid_path", "symlink refused: %s", cur)
		}
	}
	return p, nil
}
func splitHandle(h string) (string, string, error) {
	p := strings.Split(h, "/")
	if len(p) != 2 || !validSlug(p[0]) || !validSlug(p[1]) {
		return "", "", mission.Problem("invalid_handle", "use a qualified handle such as dotfiles/vault-mission-store")
	}
	return p[0], p[1], nil
}
func (s *Store) dir(h string) (string, error) {
	r, m, e := splitHandle(h)
	if e != nil {
		return "", e
	}
	return s.path(r, m)
}
func atomicWrite(p string, b []byte) error {
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
func markdown(v any, body string) ([]byte, error) {
	b, e := yaml.Marshal(v)
	if e != nil {
		return nil, e
	}
	return []byte("---\n" + string(b) + "---\n\n" + body + "\n"), nil
}
func parseMarkdown(b []byte, v any) (string, error) {
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
func (s *Store) locked(fn func() error) error {
	// ponytail: one local lock per real vault path; Git sync is not a distributed mutex.
	d := s.LockDir
	if d == "" {
		d = filepath.Join(os.TempDir(), "mission-cli-locks")
	}
	if e := os.MkdirAll(d, 0700); e != nil {
		return e
	}
	p := filepath.Join(d, strings.TrimPrefix(mission.Digest([]byte(s.Vault)), "sha256:")+".lock")
	f, e := os.OpenFile(p, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); e != nil {
		return e
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return fn()
}
