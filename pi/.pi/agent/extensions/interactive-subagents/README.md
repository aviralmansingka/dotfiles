# pi-interactive-subagents

Async subagents for [pi](https://github.com/badlogic/pi-mono), running in dedicated Herdr tabs or tmux panes. Spawn a sub-agent, keep working in the main session, and get the result steered back when it finishes. Fully non-blocking.

**Herdr/tmux fork.** See [Acknowledgements](#acknowledgements) for the upstream project, which also supports cmux, zellij, and WezTerm.

## How it works

`subagent()` returns immediately. In Herdr, the sub-agent runs in a new unfocused tab in the parent's workspace, labeled `subagent: <name>`; under tmux it runs in a right split off the parent pi pane. A live widget above the input tracks every running sub-agent, and when one finishes, its result is steered into the main session as a notification that triggers a new turn.

```
╭─ Subagents ──────────────────────────── 2 running ─╮
│ 00:23  scout      active · bash 7m                 │
│ 00:45  scout-2    waiting 2m                       │
╰────────────────────────────────────────────────────╯
```

Spawn several in parallel — they run concurrently and steer results back independently as each finishes.

Tmux panes are kept evenly sized: the extension re-applies an `even-horizontal` layout after every spawn and exit (debounced). The layout is a single constant, `SUBAGENT_TMUX_LAYOUT` in `pi-extension/subagents/tmux.ts` — change it to any named tmux layout (`main-vertical`, `tiled`, …).

If your shell startup is slow and launch commands get dropped before the prompt is ready, raise the delay:

```bash
export PI_SUBAGENT_SHELL_READY_DELAY_MS=2500   # default: 500
```

## Tools

| Tool | Description |
| --- | --- |
| `subagent` | Spawn a sub-agent in a dedicated Herdr tab or tmux pane (async) |
| `subagent_message` | Message a sub-agent by name — steers it if running, resumes its session if finished |
| `subagents_list` | List available agent definitions |
| `ask_question` | *(sub-agent sessions only)* Ask the orchestrator a question and wait for the reply |

There is also a `/subagent <agent> <task>` command for spawning through the
normal model tool-call path. `/hunk-review [focus]` bypasses that extra model
turn and directly starts the bundled `hunk-review` agent asynchronously; it
does not open Hunk.

### Spawning

```typescript
subagent({ agent: "scout", task: "Analyze the auth module" });
subagent({ agent: "worker", name: "dark-mode", task: "Implement the dark mode toggle" });
```

| Parameter | Type | Default | Description |
| --------- | ---- | ------- | ----------- |
| `agent` | string | required | Which agent to spawn (must be known and permitted) |
| `task` | string | required | Task prompt |
| `name` | string | agent name | Display name for the tab/pane and widget. Must be unique — duplicates are auto-suffixed (`scout`, `scout-2`, …) |
| `model` | string | agent's model | Override the model for this spawn |
| `cwd` | string | agent's `cwd` | Working directory (see [Role folders](#role-folders)) |

### Messaging

`subagent_message` is addressed **by name only**. Names are unique per session and persist after a sub-agent finishes, so the same name works either way:

```typescript
subagent_message({ name: "scout", message: "Also check the auth middleware" });
```

- **Running** — the message is typed into the live tab or pane (newlines flattened) and picked up at the next turn boundary. The call returns immediately; the eventual completion still arrives as a steer message.
- **Finished** — the session is resumed with the message as the follow-up task, like a fresh spawn: fire-and-forget, always autonomous, result steered back later. The resumed run reclaims its original name.

Every spawn records name → session file in `artifacts/<sessionId>/subagent-registry.json`, so names stay addressable across pi restarts. A nested sub-agent that spawns children gets its own registry keyed by its own session id. Resume is refused with a clear error (listing known names) if the name isn't registered, the session file is gone, or the session predates sandboxed resume.

**Resume replays the original sandbox.** At spawn time the fully-resolved loadout — tool allowlist, model, thinking level, system prompt, spawn whitelist, cwd — is snapshotted to `<session>.loadout.json`. Resume rebuilds the same tool-restricted process from that snapshot while keeping normal extension discovery enabled.

### ask_question

A sub-agent can ask its orchestrator a single freeform question when requirements are ambiguous or a decision materially affects the work. The session **stays open** (parked as `waiting`) instead of exiting; the parent is notified with the sub-agent's name, replies via `subagent_message({ name, message })`, and the reply arrives as the sub-agent's next turn. Parallel questions are supported — each waiting sub-agent has its own name.

If the reply arrives while the sub-agent is still mid-turn, it is absorbed into the current turn — either way the question is marked answered and the session exits normally when the work is done. If the parent never replies, the tab or pane stays open until a human closes it. Only available inside sub-agent sessions.

## Bundled agents

| Agent | Model | Tools | Role |
| ----- | ----- | ----- | ---- |
| **scout** | `fireworks/accounts/fireworks/routers/glm-5p2-fast` | `read`, `grep`, `find`, `ls` | Fast read-only codebase recon |
| **researcher** | `fireworks/accounts/fireworks/routers/glm-5p2-fast` | `web_search`, `web_fetch`, `safe_bash` | Web research, synthesized into a sourced brief |
| **worker** | `fireworks/accounts/fireworks/routers/glm-5p2-fast` | `read`, `write`, `edit`, `bash`, `web_search`, `web_fetch` + spawning | General implementer; may spawn `scout` and `researcher` |
| **professor** | `fireworks/accounts/fireworks/routers/glm-5p2-fast` | lesson tools, Hunk canvas + restricted spawning | Interactive teacher; may start Hunk review only on the learner's explicit request |
| **hunk-review** | `fireworks/accounts/fireworks/routers/glm-5p2-fast` | read-only repository tools, dedicated Hunk review tool | Autonomous reviewer; anchors detailed findings in the active Hunk session |

`scout`, `researcher`, `worker`, and `hunk-review` are autonomous
(`auto-exit: true`). `professor` is a long-lived, user-driven tab or pane
(`auto-exit: false`) that auto-loads the `professor` skill and remains open
until the learner exits it. All five carry their identity in the system prompt
(`system-prompt: append`).

Hunk pane ownership is deliberately separate from review. `/hunk` and
`hunk_open` only open or focus the visual diff canvas. Start review explicitly
with `/hunk-review [focus]` or `/subagent hunk-review <task>` after Hunk is open.
The reviewer cannot edit files or apply code; its detailed findings stay in Hunk
and only a terse completion count returns to the parent. Professor can honor an
explicit learner request to start this workflow, but never starts it merely
because Hunk was opened.

## Custom agents

Place a `.md` file in `.pi/agents/` (project) or
`~/.pi/agent/agents/` (global). Discovery priority is **project > global >
package-bundled**. The bundled `hunk-review` profile is the sole exception: it
is always selected and launched without other extensions so a repository cannot
widen the reviewer's read-only tool boundary.

```markdown
---
name: my-agent
description: Does something specific
model: fireworks/accounts/fireworks/routers/glm-5p2-fast
thinking: medium
tools: read, edit, write, safe_bash, web_search
session-mode: lineage-only
auto-exit: true
---

You are a specialized agent that does X...
```

### Frontmatter reference

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Agent name (used in `agent: "my-agent"`) |
| `description` | string | Shown in `subagents_list` |
| `model` | string | Default model |
| `thinking` | string | `minimal`, `low`, `medium`, or `high` |
| `tools` | string | Strict callable-tool allowlist. Built-ins: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`. Extension-backed examples: `web_search`, `web_fetch`, `safe_bash`, `video_extract`, `youtube_search`, `google_image_search`. Normal extension discovery stays enabled, but only listed tools are callable |
| `subagent_agents` | string | Comma-separated agent names this agent may spawn. **Presence of this field grants the spawning toolset** (`subagent`, `subagent_message`, `subagents_list`) and restricts spawn targets to the list. Omit it and the agent cannot spawn at all |
| `skills` | string | Comma-separated skill names to auto-load |
| `session-mode` | string | `standalone` (default), `lineage-only`, or `fork` — see below |
| `system-prompt` | string | `append` or `replace`: pass the body as the child's `--append-system-prompt` / `--system-prompt`. Omit and the body is prepended to the task prompt instead |
| `auto-exit` | boolean | Auto-shutdown when the agent finishes (see below) |
| `interactive` | boolean | Whether stall/recovery transitions wake the parent (see below) |
| `cwd` | string | Default working directory |
| `disable-model-invocation` | boolean | Hide from `subagents_list`; still spawnable by explicit name |
| `cli` | string | `claude` runs the agent via the Claude Code CLI instead of pi |

### session-mode

- `standalone` — fresh session, no lineage link to the caller (default)
- `lineage-only` — fresh session with `parentSession` linkage for discovery/fork UX, but no copied turns
- `fork` — child session seeded with the caller's conversation context

### auto-exit

With `auto-exit: true`, the session shuts down when the agent's turn ends — the agent just writes its final message and stops (there is no "done" tool). The last assistant message becomes the summary returned to the parent. Recommended for all autonomous agents.

Notes:

- **Manual input does not strand an auto-exit sub-agent.** If a human types into the tab or pane, the session still closes once that turn completes normally — only an escape/abort leaves it open.
- **Auto-exit is suppressed while work is in flight:** the session parks as `waiting` instead of exiting when an `ask_question` is still unanswered, or when the agent's own child sub-agents are still running (a worker can stop after dispatching children and stays open until the last result returns).

### interactive

Controls whether `stalled`/`recovered` status transitions send a steer message to the parent session. Defaults to the inverse of `auto-exit`: autonomous agents get stall pings; user-driven agents stay quiet (the user is already working in that tab or pane — the widget still updates). Set explicitly to override.

## Tool access control

Tool access is **whitelist-only**. Sub-agent processes keep normal extension discovery enabled, so they load the same configured global/project/package extensions as their cwd. Callable tools are still restricted with `--tools <allowlist>` plus explicit helper extensions for tools outside normal discovery. There is no deny-list — an agent can call exactly what its frontmatter lists. The restriction survives resume via the loadout snapshot.

Spawns must name a known agent at **every** depth. A top-level session may spawn anything discoverable; a sub-agent may only spawn the agents in its `subagent_agents` list (enforced via `PI_SUBAGENT_ALLOWED`). There is no agentless spawn route, so a child can never escalate to a full-toolset profile by omitting its agent.

Extensions can register additional tools for sub-agents at runtime via `registerToolExtension(name, path)` on the `__pi_interactive_subagents` process global.

## Role folders

`cwd` starts a sub-agent in a directory with its own config, so role-specific setups (CLAUDE.md, skills, extensions) apply:

```
project/
└── agents/
    ├── game-designer/   ← CLAUDE.md, .pi/…
    └── sre/             ← CLAUDE.md, .pi/…
```

```typescript
subagent({ agent: "worker", cwd: "agents/sre", task: "Review the deployment pipeline" });
```

Set a per-agent default with `cwd:` in frontmatter.

## Status widget & configuration

The widget tracks each sub-agent from a runtime activity snapshot written by the child: `starting`, `active` (turn/provider/tool work), `waiting` (open for input or another stage), `stalled` (no valid snapshot for too long), or `running` (fallback). Sub-agent sessions also show their own tools widget — toggle it with `Ctrl+Alt+O`. Completion messages expand with `Ctrl+O`.

If a Herdr tab or tmux pane is closed before its completion sentinel appears, the run is marked failed instead of stalling forever. The parent receives a steer prompt asking whether to resume the saved session, launch a fresh sub-agent, or ignore it.

The same widget shows an active No Mistakes pipeline when the sibling `no-mistakes-pane.ts` extension is
loaded. Its compact row omits the branch and shows the current (or synthetic `starting`/`merge`) phase,
phase wall-clock time, and total wall-clock time. Below it, every explicit `error`, `warning`, or `info`
review finding appears with `❌`, `⚠️`, or `ℹ️`; unknown severities and count-only findings are omitted.
The widget is hidden when status reports no run or a terminal run.

For `no_mistakes_axi run` and `respond` calls whose cwd matches the Pi session cwd, a read-only observer
polls `no-mistakes axi status`; No Mistakes still owns execution and gates, with `no-mistakes attach` in
the adjacent Herdr pane and the existing pane/inline fallbacks. A valid AXI run ID matching the invocation
is required before phase progress is attached. With matched phase data, `Ctrl+O` expands all phases; failed
calls also retain their raw error output. Without matched phase data, or for calls targeting another cwd,
the native tool output remains and that call does not trigger status polling or activity publication.

Status display is configured via `config.json` in the extension directory (copy `config.json.example`; it's gitignored):

```json
{
  "status": { "enabled": true }
}
```

## Requirements

- [pi](https://github.com/badlogic/pi-mono)
- A session running inside Herdr or [tmux](https://github.com/tmux/tmux)

For the tmux fallback:

```bash
tmux new -A -s pi 'pi'
```

## Acknowledgements

Forked from [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents), which originated the subagent architecture, the multi-multiplexer surface layer, and the status widget; its supervision features were inspired by [RepoPrompt](https://repoprompt.com/).

## License

MIT
