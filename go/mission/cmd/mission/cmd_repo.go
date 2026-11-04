package main

import (
	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func cmdRepo(a platform.Args, s *Store) (any, error) {
	switch a.At(1) {
	case "add":
		if !a.Has("checkout") {
			return nil, mission.Problem("usage", "repo add requires --checkout")
		}
		return s.addRepo(a.At(2), a.Get("checkout"), a.Get("remote"))
	case "list":
		return s.repos()
	}
	return nil, mission.Problem("usage", "use repo add or repo list")
}
