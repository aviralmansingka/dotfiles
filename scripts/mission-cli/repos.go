package main

import (
	"os"
	"path/filepath"
)

func (s *Store) addRepo(slug, checkout, remote string) (Repo, error) {
	var r Repo
	if !validSlug(slug) {
		return r, problem("invalid_slug", "repository slug must be 3–64 lowercase letters/digits/hyphens")
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
		return r, problem("invalid_checkout", "checkout must be an existing directory")
	}
	err := s.locked(func() error {
		p, e := s.path(slug, "repository.md")
		if e != nil {
			return e
		}
		if b, e := os.ReadFile(p); e == nil {
			if _, e = parseMarkdown(b, &r); e != nil {
				return e
			}
			if r.Bindings == nil {
				r.Bindings = map[string]string{}
			}
		} else if !os.IsNotExist(e) {
			return e
		} else {
			r = Repo{ID: "repo-" + slug, Slug: slug, Bindings: map[string]string{}}
		}
		r.Bindings[machine()] = c
		if remote != "" {
			r.Remote = remote
		}
		b, e := markdown(r, "# "+slug+"\n\nRepository registration for local mission execution. Checkout bindings are machine-specific.")
		if e != nil {
			return e
		}
		return atomicWrite(p, b)
	})
	return r, err
}
func (s *Store) repos() ([]Repo, error) {
	p, e := s.path()
	if e != nil {
		return nil, e
	}
	entries, e := os.ReadDir(p)
	if os.IsNotExist(e) {
		return []Repo{}, nil
	}
	if e != nil {
		return nil, e
	}
	var out []Repo
	for _, v := range entries {
		if !v.IsDir() || !validSlug(v.Name()) {
			continue
		}
		r, e := s.repo(v.Name())
		if e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, nil
}
func (s *Store) repo(slug string) (Repo, error) {
	var r Repo
	p, e := s.path(slug, "repository.md")
	if e != nil {
		return r, e
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return r, problem("repo_not_registered", "register %s with mission repo add first", slug)
	}
	_, e = parseMarkdown(b, &r)
	return r, e
}
