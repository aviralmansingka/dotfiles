package checks

import (
	"bytes"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

// git runs one Git command in dir, failing the test on an error.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	b, e := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if e != nil {
		t.Fatalf("git %s: %s %v", strings.Join(args, " "), b, e)
	}
	return strings.TrimSpace(string(b))
}

// TestGoTestScopesToTheModuleRoot pins the fingerprint scope: the module is found
// under the checkout, its files are hashed, and a symlink elsewhere in the
// checkout no longer refuses the run.
func TestGoTestScopesToTheModuleRoot(t *testing.T) {
	raw := t.TempDir()
	root, e := filepath.EvalSymlinks(raw)
	must(t, e)
	module := filepath.Join(root, "go", "mission")
	must(t, os.MkdirAll(module, 0o755))
	must(t, os.WriteFile(filepath.Join(module, "go.mod"), []byte("module example.test/x\n\ngo 1.26.0\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(module, "main.go"), []byte("package main\n\nfunc main() {}\n"), 0o644))
	// a stow-style symlink outside the module, which used to block every run
	must(t, os.Symlink(module, filepath.Join(root, "linked-skill")))
	git(t, root, "init", "-b", "main")
	git(t, root, "add", "-A")

	got, e := moduleRoot(root)
	must(t, e)
	if got != module {
		t.Fatalf("moduleRoot = %q, want %q", got, module)
	}
	first, e := repositoryHash(root)
	must(t, e)
	if first == "" {
		t.Fatal("empty module fingerprint")
	}
	must(t, os.WriteFile(filepath.Join(module, "extra.go"), []byte("package main\n"), 0o644))
	git(t, root, "add", "-A")
	second, e := repositoryHash(root)
	must(t, e)
	if second == first {
		t.Fatal("a new module file must change the fingerprint")
	}
	must(t, os.WriteFile(filepath.Join(root, "README.md"), []byte("outside the module\n"), 0o644))
	git(t, root, "add", "-A")
	third, e := repositoryHash(root)
	must(t, e)
	if third != second {
		t.Fatal("a file outside the module must not change the fingerprint")
	}
}

// TestFingerprintCarriesTheArtifactAndTheCheckout pins the snapshot the core
// freezes: the artifact bytes it read are the caller's, the checkout facts are
// this adapter's, and a checkout that cannot be fingerprinted says so on the
// snapshot instead of failing the run.
func TestFingerprintCarriesTheArtifactAndTheCheckout(t *testing.T) {
	root, e := filepath.EvalSymlinks(t.TempDir())
	must(t, e)
	must(t, os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/x\n\ngo 1.26.0\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n\nfunc main() {}\n"), 0o644))
	git(t, root, "init", "-b", "main")
	git(t, root, "add", "-A")

	a := mission.Attempt{ID: "attempt-1", Cwd: root}
	st := mission.Step{Checks: []string{"go-test"}}
	snap := mission.Snapshot{Artifact: []byte("done"), ArtifactHash: mission.Digest([]byte("done"))}
	first, e := New().Fingerprint(a, st, snap)
	must(t, e)
	if first.RepoErr != nil {
		t.Fatalf("a clean checkout failed to fingerprint: %v", first.RepoErr)
	}
	if first.Hash == "" || first.ArtifactHash != snap.ArtifactHash || string(first.Artifact) != "done" {
		t.Fatalf("fingerprint dropped the caller's snapshot: %+v", first)
	}
	must(t, os.WriteFile(filepath.Join(root, "extra.go"), []byte("package main\n"), 0o644))
	git(t, root, "add", "-A")
	second, e := New().Fingerprint(a, st, snap)
	must(t, e)
	if second.Hash == first.Hash {
		t.Fatal("a changed checkout did not move the fingerprint")
	}
	// A step that declares no repository check does not read the checkout, so a
	// cwd that is not a checkout at all is still a complete fingerprint.
	plain, e := New().Fingerprint(mission.Attempt{ID: "attempt-1", Cwd: t.TempDir()}, mission.Step{}, snap)
	must(t, e)
	if plain.RepoErr != nil || plain.Hash == "" {
		t.Fatalf("a result-only step read the checkout: %+v", plain)
	}
}

func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}

// TestCappedOutputKeepsOneMiB pins the cap itself through io.Copy, the path
// os/exec uses for a pipe: an embedded bytes.Buffer would promote ReadFrom and
// copy the whole stream past the cap.
func TestCappedOutputKeepsOneMiB(t *testing.T) {
	var out cappedOutput
	n, e := io.Copy(&out, bytes.NewReader(bytes.Repeat([]byte("x"), 3<<20)))
	must(t, e)
	if n != 3<<20 || len(out.Bytes()) != 1<<20 || !out.truncated {
		t.Fatalf("copied %d, kept %d bytes, truncated %v", n, len(out.Bytes()), out.truncated)
	}
}
