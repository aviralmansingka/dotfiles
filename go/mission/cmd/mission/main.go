package main

import (
	"encoding/json"
	"fmt"
	"os"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

const help = `mission — work that survives the agent

  mission --json list                     Agent interface: JSON, no prompts
  mission --json steps REPO/SLUG
  mission ui                              Optional human mission desk
      tab moves the focus, [ and ] walk the focused pane's tabs,
      j/k moves the selection, q quits. The mission list opens on ACTIVE:
      the lane tabs narrow it by state: YOURS, READY, FAILED, DONE.
  mission repo add dotfiles --checkout ~/dotfiles
  mission new dotfiles/audit-hooks --title "Audit lifecycle hooks"
      --goal "Document gaps" --step "Inspect current hooks"
      --step "Propose changes" --checkpoint "S01:Does this cover the gaps?"
  mission new                             Guided mission builder (TTY)
  mission new dotfiles/audit-hooks --from brief.md
  mission list | show REPO/SLUG | next [--repo REPO]
  mission steps REPO/SLUG                  List steps, defaults and latest checks
  mission step show REPO/SLUG S01
  mission step edit REPO/SLUG S01 --instructions TEXT --acceptance TEXT
      --checks nonempty-artifact,json-valid --output result.json
  mission checks                          List registered check presets
  mission verify [REPO/SLUG]               Run checks for the current attempt context
  mission claim REPO/SLUG --agent scout    Claim a research step; returns token
  mission pickup --repo dotfiles --agent scout   Claim ready research work
  mission run REPO/SLUG --agent worker --cwd WORKTREE -- COMMAND ARGS...
  mission workspace REPO/SLUG [--base main] [--root PATH | --cwd EXISTING_WORKTREE]
  mission attach REPO/SLUG --session-id ID --session-file PATH --cwd WORKTREE
      --workspace ID --pane ID             Private token in MISSION_TOKEN
  mission progress REPO/SLUG --status working --summary TEXT --event-id ID
      [--actor TROOPER] [--next TEXT] [--blocker TEXT]
      [--evidence artifacts/001/result.md]
                                           --actor also records one trooper
                                           report on the attempt
  mission plan REPO/SLUG [--mux rex]       Read-only launch description: army
      session and window labels, captain argv and brief, worktree, ack token
  mission deploy REPO/SLUG [--mux rex]     Seat the mission: army session, its
      captain window, and the mission-<slug> session; a repeat focuses the seat
  mission launch REPO/SLUG                 Reserve one launch; adapters only
  mission launch REPO/SLUG --ack           Record the plan's ack token: the
      seats exist. It never replaces the reserved launch intent
  mission launch REPO/SLUG --release --launch-id ID
                                           Drop a failed launch intent
  mission settle REPO/SLUG --session-id ID  Settle a reported Pi attempt after idle
  mission hook agent-start --session-id ID --event-id ID
  mission finish [REPO/SLUG] | fail [REPO/SLUG] --note TEXT
  mission show REPO/SLUG                    Record plus revision, pending_review,
      next_command                         one stable line for the owner
  mission checkpoint accept|revise REPO/SLUG [C01] --note TEXT [--actor NAME]
      Owner decision; no revision needed; --actor defaults to git user.name
  mission checkpoint REPO/SLUG --id C01 --decision accept --human --actor NAME
      --note TEXT [--revision N]           Legacy flag form, one release
  mission review reopen REPO/SLUG [C01] --note TEXT
      Rebind a review after its evidence changed
  mission retry REPO/SLUG | repair REPO/SLUG
                                           Repair replays an edit, re-admits an
      orphaned attempt, and ends one whose process is gone and whose session
      file and event stream stayed quiet for ten minutes
  mission abandon REPO/SLUG --attempt ID --note TEXT
                                           End an attempt whose process is gone;
                                           no attempt token, refuses a live one
  mission close REPO/SLUG [--note TEXT] [--force]
                                           Retire the record; refuses open work
  mission demo --vault ./demo-vault         Seed isolated, simulated records
  mission render --view overview|attempts|activity|steps
      [--filter ACTIVE|YOURS|READY|FAILED|DONE]
      [--handle REPO/SLUG] [--width 128] [--height 42] [--color]

Global: --vault PATH (default $MISSION_VAULT or ~/vault), --json
All data commands return one JSON envelope. No command specified: list missions.
--json guarantees JSON on stdout, even in a terminal, and disables prompts.
With --json, ui/render return the underlying mission records (use --handle
to select one). Human terminal rendering requires ui/render without --json.
Hook context: MISSION_HANDLE, MISSION_ATTEMPT, MISSION_TOKEN, MISSION_VAULT.
The run wrapper supplies these plus MISSION_ARTIFACT, MISSION_BRIEF, MISSION_STEP.
Every emitted context names the attempt the ledger lists now: attach returns it
as context and driver, and show renders both for each turn.
Use --kind implementation for writers; run requires an existing linked worktree.
`

func emit(v any, e error) int {
	out := map[string]any{"ok": e == nil}
	code := 0
	if e != nil {
		key := "io_error"
		if d, ok := e.(*mission.DomainError); ok {
			key = d.Code
		}
		out["error"] = map[string]string{"code": key, "message": e.Error()}
		if key == "checks_failed" && v != nil {
			out["data"] = v
		}
		code = 1
		switch key {
		case "usage", "invalid_handle", "not_found", "invalid_mission", "invalid_slug":
			code = 2
		case "busy", "checkpoint_pending", "review_pending", "step_blocked", "worktree_busy":
			code = 3
		}
	} else {
		out["data"] = v
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		return 1
	}
	return code
}

func main() { os.Exit(execute(os.Args[1:])) }

func execute(argv []string) int {
	a, e := platform.ParseArgs(argv)
	if e != nil {
		return emit(nil, e)
	}
	cmd := a.At(0)
	if cmd == "help" || a.Has("help") {
		if a.Has("json") {
			return emit(map[string]string{"usage": help, "output": "json", "default_command": "list"}, nil)
		}
		fmt.Print(help)
		return 0
	}
	// Agents get a useful read-only response by default. Charm is explicitly opt-in.
	if cmd == "" {
		cmd = "list"
	}
	if a.Has("json") && (cmd == "ui" || cmd == "render") {
		if a.Has("handle") {
			a.Pos = []string{"show", a.Get("handle")}
			cmd = "show"
		} else {
			cmd = "list"
		}
	}
	vault := platform.Fallback(a.Get("vault"), platform.Fallback(os.Getenv("MISSION_VAULT"), "~/vault"))
	writer = writeVerb(cmd, a)
	if cmd == "demo" && !a.Has("vault") {
		return emit(nil, mission.Problem("usage", "demo requires an explicit --vault pointing to an isolated directory"))
	}
	s, e := openStore(vault)
	if e != nil {
		return emit(nil, e)
	}
	// ui and render own their stdout, so they return an exit code directly.
	switch cmd {
	case "ui":
		return cmdUI(a, s)
	case "render":
		return cmdRender(a, s)
	}
	v, e := dispatch(cmd, a, s)
	return emit(v, e)
}

// dispatch maps one CLI command to its handler. Groups live in cmd_*.go.
func dispatch(cmd string, a platform.Args, s *Store) (any, error) {
	switch cmd {
	case "repo":
		return cmdRepo(a, s)
	case "new":
		return cmdNew(a, s)
	case "list":
		return s.listViews()
	case "show":
		return cmdShow(a, s)
	case "checks":
		return cmdChecks(a, s)
	case "steps":
		return cmdSteps(a, s)
	case "step":
		return cmdStep(a, s)
	case "verify":
		return cmdVerify(a, s)
	case "next", "ready":
		return s.ready(a.Get("repo"))
	case "claim":
		return cmdClaim(a, s)
	case "pickup":
		return cmdPickup(a, s)
	case "workspace":
		return cmdWorkspace(a, s)
	case "attach":
		return cmdAttach(a, s)
	case "plan":
		return cmdPlan(a, s)
	case "deploy":
		return cmdDeploy(a, s)
	case "launch":
		return cmdLaunch(a, s)
	case "progress":
		return cmdProgress(a, s)
	case "settle":
		return cmdSettle(a, s)
	case "hook":
		return cmdHook(a, s)
	case "finish", "fail":
		return cmdFinish(cmd, a, s)
	case "checkpoint":
		return cmdCheckpoint(a, s)
	case "review":
		return cmdReview(a, s)
	case "close":
		return cmdClose(a, s)
	case "retry":
		return cmdRetry(a, s)
	case "repair":
		return cmdRepair(a, s)
	case "abandon":
		return cmdAbandon(a, s)
	case "run":
		return cmdRun(a, s)
	case "demo":
		return seedDemo(s)
	}
	return nil, mission.Problem("usage", "unknown command %q; run mission help", cmd)
}
