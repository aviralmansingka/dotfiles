package vaultfs

import (
	"os"
	"path/filepath"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// AddRepo registers one checkout binding for a repository slug, refreshing the
// binding this machine already had.
func (s *Store) AddRepo(slug, checkout, remote string) (mission.Repo, error) {
	var r mission.Repo
	if !mission.ValidSlug(slug) {
		return r, mission.Problem("invalid_slug", "repository slug must be 3–64 lowercase letters/digits/hyphens")
	}
	c, e := filepath.Abs(checkout)
	if e != nil {
		return r, e
	}
	c, e = filepath.EvalSymlinks(c)
	if e != nil {
		return r, e
	}
	st, e := os.Stat(c)
	if e != nil || !st.IsDir() {
		return r, mission.Problem("invalid_checkout", "checkout must be an existing directory")
	}
	err := s.locked(func() error {
		p, e := s.Path(slug, "repository.md")
		if e != nil {
			return e
		}
		if b, e := os.ReadFile(p); e == nil {
			if _, e = platform.ParseMarkdown(b, &r); e != nil {
				return e
			}
			if r.Bindings == nil {
				r.Bindings = map[string]string{}
			}
		} else if !os.IsNotExist(e) {
			return e
		} else {
			r = mission.Repo{ID: "repo-" + slug, Slug: slug, Bindings: map[string]string{}}
		}
		r.Bindings[platform.Machine()] = c
		if remote != "" {
			r.Remote = remote
		}
		b, e := platform.Markdown(r, "# "+slug+"\n\nRepository registration for local mission execution. Checkout bindings are machine-specific.")
		if e != nil {
			return e
		}
		return platform.AtomicWrite(p, b)
	})
	return r, err
}

// Repos is every registered repository, by slug.
func (s *Store) Repos() ([]mission.Repo, error) {
	p, e := s.Path()
	if e != nil {
		return nil, e
	}
	entries, e := os.ReadDir(p)
	if os.IsNotExist(e) {
		return []mission.Repo{}, nil
	}
	if e != nil {
		return nil, e
	}
	var out []mission.Repo
	for _, v := range entries {
		if !v.IsDir() || !mission.ValidSlug(v.Name()) {
			continue
		}
		r, e := s.Repo(v.Name())
		if e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, nil
}

// Repo is one registered repository.
func (s *Store) Repo(slug string) (mission.Repo, error) {
	var r mission.Repo
	p, e := s.Path(slug, "repository.md")
	if e != nil {
		return r, e
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return r, mission.Problem("repo_not_registered", "register %s with mission repo add first", slug)
	}
	_, e = platform.ParseMarkdown(b, &r)
	return r, e
}
