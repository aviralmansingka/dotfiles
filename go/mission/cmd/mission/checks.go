package main

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"mission.local/prototype/internal/domain/mission"
)

func attemptDefinition(r mission.Record, a mission.Attempt) mission.Step {
	if a.Definition != nil {
		return *a.Definition
	}
	i, _ := stepIndex(r.Mission, a.Step)
	if i >= 0 {
		return r.Mission.Steps[i]
	}
	return mission.Step{}
}

type subjectSnapshot struct {
	Hash         string
	Artifact     []byte
	ArtifactHash string
	ArtifactErr  error
	RepoErr      error
}

func boundedFile(p string, limit int64) ([]byte, error) {
	st, e := os.Lstat(p)
	if e != nil {
		return nil, e
	}
	if !st.Mode().IsRegular() {
		return nil, fmt.Errorf("not a regular file: %s", p)
	}
	if st.Size() > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	f, e := os.Open(p)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, limit+1))
	if len(b) > int(limit) {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	return b, e
}
func (s *App) subject(r mission.Record, a mission.Attempt, st mission.Step) subjectSnapshot {
	var snap subjectSnapshot
	p, e := s.Repo.Path(r.Mission.Repo, r.Mission.Slug, a.Artifact)
	if e == nil {
		snap.Artifact, e = boundedFile(p, 16<<20)
	}
	snap.ArtifactErr = e
	value := "missing"
	if e == nil {
		snap.ArtifactHash = mission.Digest(snap.Artifact)
		value = snap.ArtifactHash
	} else {
		value = "unavailable:" + e.Error()
	}
	values := []string{a.ID, definitionHash(st), value}
	goTestDeclared, cmdDeclared := false, false
	for _, name := range mission.StepChecks(st) {
		if name == "go-test" {
			goTestDeclared = true
		}
		if strings.HasPrefix(name, mission.CmdCheckPrefix) {
			cmdDeclared = true
		}
	}
	if goTestDeclared || cmdDeclared {
		// A cmd: check binds to the same repository fingerprint as go-test, so a
		// change to the checkout invalidates its evidence too. Only go-test owns
		// RepoErr; a cmd: check runs in any checkout it is given.
		h, e := repositoryHash(a.Cwd)
		if goTestDeclared {
			snap.RepoErr = e
		}
		if e != nil {
			h = "unavailable:" + e.Error()
		}
		values = append(values, h)
	}
	snap.Hash = mission.Digest([]byte(strings.Join(values, "\n")))
	return snap
}

// moduleRoot finds the one Go module inside an attempt checkout. The go-test
// fingerprint and the test run both scope to it: a file outside the module, such
// as a stow symlink elsewhere in the checkout, cannot block the check.
func moduleRoot(cwd string) (string, error) {
	var found []string
	e := filepath.WalkDir(cwd, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "node_modules", "vendor":
				return fs.SkipDir
			}
			return nil
		}
		if d.Name() == "go.mod" {
			found = append(found, filepath.Dir(p))
		}
		return nil
	})
	if e != nil {
		return "", e
	}
	switch len(found) {
	case 0:
		return "", fmt.Errorf("go-test requires a go.mod inside the checkout")
	case 1:
		return found[0], nil
	}
	sort.Strings(found)
	return "", fmt.Errorf("go-test found %d Go modules in the checkout; keep one", len(found))
}

func repositoryHash(cwd string) (string, error) {
	top, e := exec.Command("git", "-C", cwd, "rev-parse", "--show-toplevel").Output()
	if e != nil {
		return "", fmt.Errorf("go-test evidence requires a Git checkout")
	}
	root, e := filepath.EvalSymlinks(strings.TrimSpace(string(top)))
	if e != nil || root != cwd {
		return "", fmt.Errorf("go-test requires the Git checkout root as the attempt cwd")
	}
	module, e := moduleRoot(cwd)
	if e != nil {
		return "", e
	}
	rel, e := filepath.Rel(cwd, module)
	if e != nil {
		return "", e
	}
	args := []string{"ls-files", "-z", "--cached", "--others", "--exclude-standard"}
	if rel != "." {
		args = append(args, "--", filepath.ToSlash(rel))
	}
	c := exec.Command("git", append([]string{"-C", cwd}, args...)...)
	b, e := c.Output()
	if e != nil {
		return "", fmt.Errorf("go-test evidence requires a Git checkout")
	}
	files := strings.Split(strings.TrimSuffix(string(b), "\x00"), "\x00")
	sort.Strings(files)
	if len(files) > 10000 {
		return "", fmt.Errorf("source snapshot exceeds 10000 files")
	}
	var tree bytes.Buffer
	var total int64
	for _, name := range files {
		if name == "" {
			continue
		}
		p := filepath.Join(cwd, filepath.FromSlash(name))
		inside, e := filepath.Rel(module, p)
		if e != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(os.PathSeparator)) {
			return "", fmt.Errorf("source path escapes the Go module")
		}
		name = filepath.ToSlash(inside)
		st, e := os.Lstat(p)
		if os.IsNotExist(e) {
			fmt.Fprintf(&tree, "%s\x00deleted\n", name)
			continue
		}
		if e != nil {
			return "", e
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("source snapshot contains symlink %s; cannot establish a complete input fingerprint", name)
		}
		if !st.Mode().IsRegular() {
			return "", fmt.Errorf("cannot snapshot %s", name)
		}
		total += st.Size()
		if total > 64<<20 {
			return "", fmt.Errorf("source snapshot exceeds 64 MiB")
		}
		b, e := boundedFile(p, 16<<20)
		if e != nil {
			return "", e
		}
		fmt.Fprintf(&tree, "%s\x00%s\x00%s\n", name, st.Mode(), mission.Digest(b))
	}
	return mission.Digest(tree.Bytes()), nil
}
func allPassed(v mission.Verification, st mission.Step) bool {
	if v.Ended == "" || v.DefinitionHash != definitionHash(st) || len(v.Results) != len(mission.StepChecks(st)) {
		return false
	}
	for i, c := range mission.StepChecks(st) {
		if v.Results[i].Check != c || v.Results[i].Verdict != "passed" {
			return false
		}
	}
	return true
}
func (s *App) verified(r mission.Record, a mission.Attempt) bool {
	if len(a.Verifications) == 0 {
		return false
	}
	st := attemptDefinition(r, a)
	v := a.Verifications[len(a.Verifications)-1]
	if !allPassed(v, st) || s.subject(r, a, st).Hash != v.SubjectHash {
		return false
	}
	for _, c := range v.Results {
		if c.Version != "1" || len(c.Evidence) == 0 {
			return false
		}
		for _, ev := range c.Evidence {
			p, e := s.Repo.Path(r.Mission.Repo, r.Mission.Slug, ev.Path)
			if e != nil {
				return false
			}
			b, e := boundedFile(p, 16<<20)
			if e != nil || mission.Digest(b) != ev.Hash {
				return false
			}
		}
	}
	return true
}
