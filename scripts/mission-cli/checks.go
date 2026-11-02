package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

func attemptDefinition(r Record, a Attempt) Step {
	if a.Definition != nil {
		return *a.Definition
	}
	i, _ := stepIndex(r.Mission, a.Step)
	if i >= 0 {
		return r.Mission.Steps[i]
	}
	return Step{}
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
func (s *Store) subject(r Record, a Attempt, st Step) subjectSnapshot {
	var snap subjectSnapshot
	p, e := s.path(r.Mission.Repo, r.Mission.Slug, a.Artifact)
	if e == nil {
		snap.Artifact, e = boundedFile(p, 16<<20)
	}
	snap.ArtifactErr = e
	value := "missing"
	if e == nil {
		snap.ArtifactHash = digest(snap.Artifact)
		value = snap.ArtifactHash
	} else {
		value = "unavailable:" + e.Error()
	}
	values := []string{a.ID, definitionHash(st), value}
	for _, name := range stepChecks(st) {
		if name == "go-test" {
			h, e := repositoryHash(a.Cwd)
			snap.RepoErr = e
			if e != nil {
				h = "unavailable:" + e.Error()
			}
			values = append(values, h)
		}
	}
	snap.Hash = digest([]byte(strings.Join(values, "\n")))
	return snap
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
	c := exec.Command("git", "-C", cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
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
		rel, e := filepath.Rel(cwd, p)
		if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return "", fmt.Errorf("source path escapes checkout")
		}
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
		fmt.Fprintf(&tree, "%s\x00%s\x00%s\n", name, st.Mode(), digest(b))
	}
	return digest(tree.Bytes()), nil
}
func allPassed(v Verification, st Step) bool {
	if v.Ended == "" || v.DefinitionHash != definitionHash(st) || len(v.Results) != len(stepChecks(st)) {
		return false
	}
	for i, c := range stepChecks(st) {
		if v.Results[i].Check != c || v.Results[i].Verdict != "passed" {
			return false
		}
	}
	return true
}
func (s *Store) verified(r Record, a Attempt) bool {
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
			p, e := s.path(r.Mission.Repo, r.Mission.Slug, ev.Path)
			if e != nil {
				return false
			}
			b, e := boundedFile(p, 16<<20)
			if e != nil || digest(b) != ev.Hash {
				return false
			}
		}
	}
	return true
}
