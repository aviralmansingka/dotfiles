package main

import (
	"fmt"
	"runtime/debug"
	"strings"
)

// versionUnknown fills every field this build cannot prove about itself.
const versionUnknown = "unknown"

// buildRevision and buildTime are the -X stamps scripts/install-missions passes
// from this worktree's own git HEAD. They win over build info: a linked worktree
// holds .git as a file, so go build records no vcs.revision at all and the stamp
// has to be spelled out explicitly.
var (
	buildRevision string
	buildTime     string
)

// versionLine stamps this binary in one line: module version, revision, time.
// A field no source recorded reads unknown; the line never guesses, so a record
// that quotes it can be checked against the binary that ran.
func versionLine() string {
	info, ok := debug.ReadBuildInfo()
	return stampLine(buildStamp{buildRevision, buildTime}, info, ok)
}

// stamp is what -X spelled out; a blank field defers to what the build recorded.
type buildStamp struct {
	revision string
	time     string
}

// stampLine renders one build stamp and stays pure, so the test hands it a
// synthesized BuildInfo instead of building a binary.
func stampLine(ld buildStamp, info *debug.BuildInfo, ok bool) string {
	version, revision, at := versionUnknown, versionUnknown, versionUnknown
	if ok && info != nil {
		if v := strings.TrimSpace(info.Main.Version); v != "" {
			version = v
		}
		revision = buildSetting(info, "vcs.revision")
		at = buildSetting(info, "vcs.time")
	}
	// An -X stamp wins over what the build recorded; blank means it was not passed.
	if v := strings.TrimSpace(ld.revision); v != "" {
		revision = v
	}
	if v := strings.TrimSpace(ld.time); v != "" {
		at = v
	}
	if revision == "" {
		revision = versionUnknown
	}
	if at == "" {
		at = versionUnknown
	}
	return fmt.Sprintf("mission %s rev %s time %s", version, revision, at)
}

// versionSummary is what a version event carries: this build's stamp and the
// Herdr it launched on, so one line ties a run to both binaries. A Herdr no
// source recorded reads unknown like every other field.
func versionSummary(herdr string) string {
	if herdr = strings.TrimSpace(herdr); herdr == "" {
		herdr = versionUnknown
	}
	return versionLine() + " on herdr " + herdr
}

// buildSetting reads one key out of the build's settings list.
func buildSetting(info *debug.BuildInfo, key string) string {
	for _, s := range info.Settings {
		if s.Key == key {
			return strings.TrimSpace(s.Value)
		}
	}
	return ""
}
