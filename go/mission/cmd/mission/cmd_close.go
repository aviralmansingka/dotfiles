package main

import (
	"mission.local/prototype/internal/platform"
)

// cmdClose retires a mission record. /cleanup calls it once the worktree ships:
// a closed mission stops offering work, and `workspace` no longer revives its
// deleted checkout.
func cmdClose(a platform.Args, s *App) (any, error) {
	return s.close(a.At(1), a.Get("note"), a.Has("force"))
}
