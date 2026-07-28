package main

import (
	"reflect"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestVerifierSummaryAggregatesTypedAttemptsDeterministically(t *testing.T) {
	identity := func(id string) vaultregistry.VerifierAttemptIdentity {
		return vaultregistry.VerifierAttemptIdentity{VerifierID: id}
	}
	attempt := func(id, state, at string) vaultregistry.Observation {
		return vaultregistry.Observation{
			State:      vaultregistry.ObservationState(state),
			ObservedAt: at,
			Payload: vaultregistry.ObservationPayload{VerifierAttempt: &vaultregistry.VerifierAttemptPayload{
				Identity: identity(id),
			}},
		}
	}
	gap := func(id, at string) vaultregistry.Observation {
		return vaultregistry.Observation{
			State:      vaultregistry.StateIncomplete,
			ObservedAt: at,
			Payload: vaultregistry.ObservationPayload{VerifierAttemptGap: &vaultregistry.VerifierAttemptGapPayload{
				Identity: identity(id),
			}},
		}
	}

	tests := []struct {
		name         string
		observations []vaultregistry.Observation
		want         milestoneState
	}{
		{name: "complete", observations: []vaultregistry.Observation{attempt("v1", "passed", "2026-01-01T00:00:00Z")}, want: milestoneComplete},
		{name: "in progress", observations: []vaultregistry.Observation{attempt("v1", "active", "2026-01-01T00:00:00Z")}, want: milestoneInProgress},
		{name: "gap is intermediate evidence", observations: []vaultregistry.Observation{attempt("v1", "passed", "2026-01-01T00:00:00Z"), gap("v2", "2026-01-01T00:00:01Z")}, want: milestoneIntermediate},
		{name: "same verifier milestones coexist", observations: []vaultregistry.Observation{attempt("v1", "passed", "2026-01-01T00:00:00Z"), gap("v1", "2026-01-01T00:00:01Z")}, want: milestoneIntermediate},
		{name: "completion preserves prior gap", observations: []vaultregistry.Observation{gap("v1", "2026-01-01T00:00:00Z"), attempt("v1", "passed", "2026-01-01T00:00:01Z")}, want: milestoneIntermediate},
		{name: "failure precedes active", observations: []vaultregistry.Observation{attempt("v1", "active", "2026-01-01T00:00:00Z"), attempt("v2", "failed", "2026-01-01T00:00:01Z")}, want: milestoneFailed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := verifierSummary(vaultregistry.Run{Observations: test.observations}, nil); got != test.want {
				t.Fatalf("verifierSummary() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestIntermediateMilestoneUsesGreenAndOrangeHalves(t *testing.T) {
	mark := milestoneMark(milestoneIntermediate, true)
	if mark.plain != "◐◑" {
		t.Fatalf("milestoneMark() plain = %q, want %q", mark.plain, "◐◑")
	}
	if want := colorize(true, success, "◐") + colorize(true, active, "◑"); mark.styled != want {
		t.Fatalf("milestoneMark() styled = %q, want %q", mark.styled, want)
	}
}

func TestSummaryMetricsUseFixedPrototypeLegend(t *testing.T) {
	run := vaultregistry.Run{
		Evidence: []vaultregistry.Evidence{
			{VerifierID: "v1", State: "passed"},
			{VerifierID: "v1", State: "passed"},
		},
		Observations: []vaultregistry.Observation{{
			State: vaultregistry.StatePassed,
			Payload: vaultregistry.ObservationPayload{VerifierAttempt: &vaultregistry.VerifierAttemptPayload{
				Identity: vaultregistry.VerifierAttemptIdentity{VerifierID: "v2"},
			}},
		}},
	}
	goals := make([]journeyGoal, 9)
	got := summaryLines(run, goals, 30, false)[0].plain
	if want := " │  3 G · 5 S · 2 V  ●"; got != want {
		t.Fatalf("summaryLines() = %q, want %q", got, want)
	}
}

func TestFramesPreservePickerInteriors(t *testing.T) {
	run := vaultregistry.Run{
		Task: vaultregistry.Task{ID: "t02", Title: "T02: Build the Compact Atlas Renderer", FeaturePath: "features/vault-hunter-atlas/feature.md"},
		Observations: []vaultregistry.Observation{
			{State: vaultregistry.StatePassed, ObservedAt: "2026-01-01T00:00:00Z", Payload: vaultregistry.ObservationPayload{VerifierAttempt: &vaultregistry.VerifierAttemptPayload{Identity: vaultregistry.VerifierAttemptIdentity{VerifierID: "v1"}}}},
			{State: vaultregistry.StateIncomplete, ObservedAt: "2026-01-01T00:00:01Z", Payload: vaultregistry.ObservationPayload{VerifierAttemptGap: &vaultregistry.VerifierAttemptGapPayload{Identity: vaultregistry.VerifierAttemptIdentity{VerifierID: "v2"}}}},
		},
	}
	goals := []journeyGoal{
		{id: "refactor-gate", state: "done"},
		{id: "review-convergence", state: "done"},
		{id: "implementation-pr", state: "done"},
		{id: "landing", state: "done"},
		{id: "cleanup", state: "done"},
	}
	expected := map[int][]string{
		30: {
			"Vault Hunter Atlas",
			"T02 · Build the Compact Atlas",
			"Renderer",
			"● recorded done",
			" │  3 G · 5 S · 2 V  ◐◑",
			" ├─ ● refactor-gate · done",
			" ├─ ● review-convergence · do…",
			" ├─ ● implementation-pr · done",
			" ├─ ● landing · done",
			" └─ ● cleanup · done",
			"",
			"5 total · selected 3/5",
		},
		23: {
			"Vault Hunter Atlas",
			"T02 · Build the Compact",
			"Atlas Renderer",
			"● recorded done",
			" │  3 G · 5 S · 2 V  ◐◑",
			" ├─ ● refactor-gate · …",
			" ├─ ● review-convergen…",
			" ├─ ● implementation-p…",
			" ├─ ● landing · done",
			" └─ ● cleanup · done",
			"",
			"5 total · selected 3/5",
		},
	}
	for _, width := range []int{30, 23} {
		plain := model{run: run, goals: goals, selected: 2, width: width}.frame(false)
		colored := model{run: run, goals: goals, selected: 2, width: width, color: true}.frame(false)
		if len(plain) != 12 || len(colored) != 12 {
			t.Fatalf("width %d rendered %d plain and %d colored rows", width, len(plain), len(colored))
		}
		stripped := make([]string, len(colored))
		for i := range colored {
			stripped[i] = stripSGR(colored[i])
			if got := lipglossWidth(stripped[i]); got > width {
				t.Fatalf("width %d row %d exceeds interior: %d", width, i, got)
			}
		}
		if !reflect.DeepEqual(plain, expected[width]) {
			t.Fatalf("width %d output changed\ngot:  %q\nwant: %q", width, strings.Join(plain, "\n"), strings.Join(expected[width], "\n"))
		}
		if !reflect.DeepEqual(stripped, plain) {
			t.Fatalf("width %d ANSI-stripped output differs\ncolored: %q\nplain:   %q", width, strings.Join(stripped, "\n"), strings.Join(plain, "\n"))
		}
	}
}

func lipglossWidth(value string) int {
	return len([]rune(value))
}
