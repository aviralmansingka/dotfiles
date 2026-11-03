package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepoRegistryRoundTrip(t *testing.T) {
	s, _ := fixture(t)
	repos, e := s.repos()
	must(t, e)
	if len(repos) != 1 || repos[0].Slug != "dotfiles" {
		t.Fatalf("unexpected registry: %+v", repos)
	}
	r, e := s.repo("dotfiles")
	must(t, e)
	if r.Bindings[machine()] == "" || r.ID != "repo-dotfiles" {
		t.Fatalf("missing machine binding: %+v", r)
	}
	// A second add for the same slug refreshes the binding instead of failing.
	checkout := t.TempDir()
	r, e = s.addRepo("dotfiles", checkout, "git@example.com:dotfiles.git")
	must(t, e)
	if r.Remote != "git@example.com:dotfiles.git" {
		t.Fatalf("remote not stored: %+v", r)
	}
}

func TestRepoRegistrationRejectsUnsafeInput(t *testing.T) {
	s, _ := fixture(t)
	_, e := s.addRepo("No Spaces", t.TempDir(), "")
	wantCode(t, e, "invalid_slug")
	if _, e = s.addRepo("missing", filepath.Join(t.TempDir(), "absent"), ""); e == nil {
		t.Fatal("missing checkout accepted")
	}
	_, e = s.repo("absent")
	wantCode(t, e, "repo_not_registered")
}

func TestVaultRefusesPathTraversal(t *testing.T) {
	s, _ := fixture(t)
	if _, _, e := splitHandle("../escape"); e == nil {
		t.Fatal("traversal handle accepted")
	}
	if _, e := s.dir("../../etc/passwd"); e == nil {
		t.Fatal("traversal path accepted")
	}
	if _, e := s.path(".."); e == nil {
		t.Fatal("traversal component accepted")
	}
	entries, e := os.ReadDir(s.Vault)
	must(t, e)
	for _, v := range entries {
		if strings.HasSuffix(v.Name(), ".tmp") {
			t.Fatalf("temporary file left behind: %s", v.Name())
		}
	}
}
