package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const help = `mission — work that survives the agent

  mission --json list                     Agent interface: JSON, no prompts
  mission --json steps REPO/SLUG
  mission ui                              Optional human mission desk
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
      [--next TEXT] [--blocker TEXT] [--evidence artifacts/001/result.md]
  mission launch REPO/SLUG                 Reserve one launch; adapters only
  mission settle REPO/SLUG --session-id ID  Settle a reported Pi attempt after idle
  mission hook agent-start --session-id ID --event-id ID
  mission finish [REPO/SLUG] | fail [REPO/SLUG] --note TEXT
  mission checkpoint REPO/SLUG --id C01 --decision accept --human
      --actor aviral --note "Reviewed the evidence" --revision 5
  mission retry REPO/SLUG | repair REPO/SLUG
  mission demo --vault ./demo-vault         Seed isolated, simulated records
  mission render --view dashboard --width 128 --color

Global: --vault PATH (default $MISSION_VAULT or ~/vault), --json
All data commands return one JSON envelope. No command specified: list missions.
--json guarantees JSON on stdout, even in a terminal, and disables prompts.
With --json, ui/render return the underlying mission records (use --handle
to select one). Human terminal rendering requires ui/render without --json.
Hook context: MISSION_HANDLE, MISSION_ATTEMPT, MISSION_TOKEN, MISSION_VAULT.
The run wrapper supplies these plus MISSION_ARTIFACT, MISSION_BRIEF, MISSION_STEP.
Use --kind implementation for writers; run requires an existing linked worktree.
`

type args struct {
	pos, command []string
	flags        map[string][]string
}

func parseArgs(argv []string) (args, error) {
	a := args{flags: map[string][]string{}}
	booleans := map[string]bool{"json": true, "human": true, "stdin": true, "color": true, "no-color": true, "help": true, "reset": true}
	booleans["quiescent"] = true
	values := map[string]bool{"vault": true, "checkout": true, "remote": true, "title": true, "goal": true, "step": true, "checkpoint": true, "kind": true, "from": true, "repo": true, "agent": true, "session-id": true, "session-file": true, "cwd": true, "attempt": true, "token": true, "event-id": true, "tool": true, "message": true, "note": true, "id": true, "decision": true, "actor": true, "revision": true, "view": true, "width": true, "model": true, "pane": true, "workspace": true}
	values["handle"] = true
	for _, k := range []string{"instructions", "acceptance", "checks", "output"} {
		values[k] = true
	}
	for _, k := range []string{"base", "root", "status", "summary", "next", "blocker", "evidence", "launch-id"} {
		values[k] = true
	}
	for i := 0; i < len(argv); i++ {
		v := argv[i]
		if v == "--" {
			a.command = argv[i+1:]
			break
		}
		if !strings.HasPrefix(v, "--") {
			a.pos = append(a.pos, v)
			continue
		}
		k, val, eq := strings.Cut(strings.TrimPrefix(v, "--"), "=")
		if booleans[k] {
			if eq && val != "true" {
				return a, problem("usage", "--%s is a switch", k)
			}
			a.flags[k] = []string{"true"}
			continue
		}
		if !values[k] {
			return a, problem("usage", "unknown option --%s", k)
		}
		if !eq {
			if i+1 >= len(argv) {
				return a, problem("usage", "--%s needs a value", k)
			}
			i++
			val = argv[i]
		}
		a.flags[k] = append(a.flags[k], val)
	}
	return a, nil
}
func (a args) get(k string) string {
	v := a.flags[k]
	if len(v) == 0 {
		return ""
	}
	return v[len(v)-1]
}
func (a args) has(k string) bool { return a.get(k) != "" }
func (a args) at(i int) string {
	if i >= len(a.pos) {
		return ""
	}
	return a.pos[i]
}
func emit(v any, e error) int {
	out := map[string]any{"ok": e == nil}
	code := 0
	if e != nil {
		key := "io_error"
		if d, ok := e.(*DomainError); ok {
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
		case "busy", "checkpoint_pending", "step_blocked", "worktree_busy":
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
	a, e := parseArgs(argv)
	if e != nil {
		return emit(nil, e)
	}
	cmd := a.at(0)
	if cmd == "help" || a.has("help") {
		if a.has("json") {
			return emit(map[string]string{"usage": help, "output": "json", "default_command": "list"}, nil)
		}
		fmt.Print(help)
		return 0
	}
	// Agents get a useful read-only response by default. Charm is explicitly opt-in.
	if cmd == "" {
		cmd = "list"
	}
	if a.has("json") && (cmd == "ui" || cmd == "render") {
		if a.has("handle") {
			a.pos = []string{"show", a.get("handle")}
			cmd = "show"
		} else {
			cmd = "list"
		}
	}
	vault := fallback(a.get("vault"), fallback(os.Getenv("MISSION_VAULT"), "~/vault"))
	if cmd == "demo" && !a.has("vault") {
		return emit(nil, problem("usage", "demo requires an explicit --vault pointing to an isolated directory"))
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
func dispatch(cmd string, a args, s *Store) (any, error) {
	switch cmd {
	case "repo":
		return cmdRepo(a, s)
	case "new":
		return cmdNew(a, s)
	case "list":
		return s.list()
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
		return s.ready(a.get("repo"))
	case "claim":
		return cmdClaim(a, s)
	case "pickup":
		return cmdPickup(a, s)
	case "workspace":
		return cmdWorkspace(a, s)
	case "attach":
		return cmdAttach(a, s)
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
	case "retry":
		return cmdRetry(a, s)
	case "repair":
		return cmdRepair(a, s)
	case "run":
		return cmdRun(a, s)
	case "demo":
		return seedDemo(s)
	}
	return nil, problem("usage", "unknown command %q; run mission help", cmd)
}
