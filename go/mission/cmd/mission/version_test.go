package main

import (
	"runtime/debug"
	"strings"
	"testing"
)

func TestVersionLineNamesBuildFields(t *testing.T) {
	info := &debug.BuildInfo{
		Main: debug.Module{Version: "(devel)"},
		Settings: []debug.BuildSetting{
			{Key: "vcs.revision", Value: "0123456789abcdef"},
			{Key: "vcs.time", Value: "2026-11-05T17:08:38Z"},
			{Key: "vcs.modified", Value: "false"},
		},
	}
	got := stampLine(buildStamp{}, info, true)
	want := "mission (devel) rev 0123456789abcdef time 2026-11-05T17:08:38Z"
	if got != want {
		t.Fatalf("stamp = %q, want %q", got, want)
	}
}

// TestVersionLinePrefersLinkerStamp proves the path a linked worktree needs: go
// build records no vcs.revision there, so the -X stamp alone must reach the line.
func TestVersionLinePrefersLinkerStamp(t *testing.T) {
	ld := buildStamp{revision: "fedcba9876543210", time: "2026-11-05T18:00:00+00:00"}
	got := stampLine(ld, &debug.BuildInfo{}, true)
	want := "mission unknown rev fedcba9876543210 time 2026-11-05T18:00:00+00:00"
	if got != want {
		t.Fatalf("stamp without build info = %q, want %q", got, want)
	}

	// Both sources present: the -X stamp wins, field by field.
	info := &debug.BuildInfo{
		Main:     debug.Module{Version: "(devel)"},
		Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "0123456789abcdef"}, {Key: "vcs.time", Value: "2026-11-05T17:08:38Z"}},
	}
	got = stampLine(ld, info, true)
	want = "mission (devel) rev fedcba9876543210 time 2026-11-05T18:00:00+00:00"
	if got != want {
		t.Fatalf("stamp with both sources = %q, want %q", got, want)
	}
}

// TestVersionLineFallsBackToUnknown covers the third path: neither source said
// anything, so every field reads unknown rather than a guess.
func TestVersionLineFallsBackToUnknown(t *testing.T) {
	for name, tc := range map[string]struct {
		ld   buildStamp
		info *debug.BuildInfo
	}{
		"no build info":          {},
		"empty main version":     {info: &debug.BuildInfo{}},
		"whitespace only fields": {ld: buildStamp{revision: " ", time: "\t"}, info: &debug.BuildInfo{Main: debug.Module{Version: "  "}, Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: " "}}}},
	} {
		got := stampLine(tc.ld, tc.info, tc.info != nil)
		if got != "mission unknown rev unknown time unknown" {
			t.Errorf("%s: stamp = %q, want every field unknown", name, got)
		}
	}
}

// TestVersionStampVarsAreWired proves the package vars the installer sets with
// -X are the ones versionLine prints.
func TestVersionStampVarsAreWired(t *testing.T) {
	revision, at := buildRevision, buildTime
	t.Cleanup(func() { buildRevision, buildTime = revision, at })
	buildRevision, buildTime = "deadbeefcafe", "2026-11-05T19:00:00+00:00"

	got := versionLine()
	for _, want := range []string{"rev deadbeefcafe", "time 2026-11-05T19:00:00+00:00"} {
		if !strings.Contains(got, want) {
			t.Fatalf("stamp = %q, want it to contain %q", got, want)
		}
	}
}

// TestVersionLineIsOneLine guards the acceptance line: the stamp the CLI prints
// must stay one line, whatever the build recorded.
func TestVersionLineIsOneLine(t *testing.T) {
	got := versionLine()
	if got == "" {
		t.Fatal("empty stamp")
	}
	if strings.ContainsAny(got, "\n\r") {
		t.Fatalf("stamp is not one line: %q", got)
	}
	if !strings.HasPrefix(got, "mission ") || !strings.Contains(got, " rev ") {
		t.Fatalf("stamp does not name a revision: %q", got)
	}
}
