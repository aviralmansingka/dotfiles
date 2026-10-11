# Pi terminal integration audit

Audited 2026-08-09 against the checked-in dotfiles, the installed Pi/Herdr runtimes,
live Herdr sessions on the Mac, and the active homelab services. This was a read-only
product audit: no Pi, Sidekick, Herdr, Ghostty, or service implementation was changed.

**Implementation update — 2026-08-13.** P0.1 and P0.2 are complete in this
checkout. The raw-ANSI prompt block was removed while response-shape/activity guidance was
retained. `transcript-scroll.ts` remains available to explicit regression fixtures, but Pi's
native `-extensions/transcript-scroll.ts` force-exclude prevents ambient startup. Of the two
affected live panes, one reloaded and ran the extension's SGR shutdown cleanup; the other Pi
process and pane exited, ending its terminal modes. The original JSONL and crash records below
remain historical evidence, not descriptions of new output.

**Delivery and next-phase update — 2026-08-13.** PR #131 merged the P0 rollback to `main` as
`86a38aa`. Attachment Leases Phase 1 is now active in Herdr workspace `w5W`, on isolated
branch `agent/herdr-attachment-leases-phase1` and worktree
`/Users/aviral/.herdr/worktrees/dotfiles/herdr-attachment-leases-phase1`. This phase freezes the
contract and executable acceptance cases; it does not change Sidekick, Herdr attachment, Pi, or
Codex runtime behavior.

## Executive decision

The setup still does not have a single coherent terminal integration. The audit identified
three correctness issues; P0.1 and P0.2 are resolved while P0.3 remains open:

1. **P0.1 — implemented:** Pi now receives semantic Markdown guidance; Pi's Markdown/theme
   renderer owns presentation. Historical malformed `[38;2;…m` fragments remain in an old
   persisted response, but new turns are no longer instructed to author them.
2. **P0.2 — implemented, live cleanup 2/2:** `transcript-scroll.ts` is force-excluded from
   unconditional global loading. The source and explicit fixtures remain while its root-render
   patch and SGR mouse capture are quarantined pending redesign. One affected pane reloaded and
   ran the extension's cleanup; the other affected Pi process and pane exited.
3. **P0.3 — open:** fix or replace the custom subagent launcher before trusting its personas.
   `AgentConfig.tools` is never passed to child Pi. The read-only tool lists in
   `vault-hunter-agents.ts` are currently descriptive, not enforced. Children start with
   normal global extension/tool discovery plus `--approve`.
4. **Attachment Leases Phase 1 — active:** define the vocabulary, state-transition contract,
   profile shapes, effective-plan inspection, and cross-surface acceptance cases before changing
   Sidekick's current `native_scroll=true` or unconditional `--takeover` behavior.

Do **not** change the standalone Codex renderer to compensate. Current Codex output was clean.
The shared Codex regression is in Sidekick/Herdr scroll and attachment behavior, not message
rendering.

## Runtime snapshot

| Host/surface | Pi | Herdr | Source/deployment state |
|---|---:|---:|---|
| Mac direct/Herdr/Sidekick | 0.82.1 | 0.8.0 | Local `main` is diverged and dirty; live Pi extensions are symlinked to this checkout |
| Homelab services | 0.83.0 | 0.7.5 | Clean `main` at merge PR #127; Telegram and WhatsApp services active |
| Homelab extension profile | 0.83.0 | 0.7.5 | `~/.pi/agent/extensions` is a real directory containing only `herdr-agent-state.ts` |

The homelab is therefore not a second copy of the Mac terminal profile. That is arguably the
right direction for headless safety, but it is accidental and undocumented today. Make the
profiles explicit rather than trying to symlink every TUI extension everywhere.

### Inventory boundary

- The Mac has **12 top-level TypeScript extension sources**. As of 2026-08-13, 11 resolve
  enabled and `transcript-scroll.ts` resolves disabled through an exact global force-exclude.
  `~/.pi/agent/extensions` remains symlinked into this checkout. The neighboring
  `tool-call-renderer-thinking-prototype.html` is an inert design artifact, not a Pi extension.
- At audit time, the live symlinked working-tree copies of `settings.json`,
  `herdr-agent-state.ts`, and `vault-hunter-crew.ts` were modified. Compatibility conclusions
  therefore describe the inspected working tree, not only the committed `main` revision.
- `settings.json` configures `pi-mcp-adapter`, an explicitly loaded `youtube-search`, and
  `amosblomqvist/pi-config` with its general extensions deliberately disabled. The npm tree
  also contains `pi-subagents@0.37.0`, but it is not active; local `subagent.ts` is active.
- `mcp.json` declares four subprocess-backed servers: Google Workspace through `uvx`,
  WhatsApp through `uv run`, and Granola and Browserbase through `npx`. They are Pi-only and
  terminal-neutral, but still depend on host paths, environment, network, and authentication.

## Confirmed findings and remediation

### 1. Semantic ANSI corrupted Pi content — remediated

The former `APPEND_SYSTEM.md:1-62` told every direct Pi response to contain U+001B SGR bytes. The
Fireworks/GLM model repeatedly emitted the visible characters `[1;38;2...m` instead. Even a
response that contained some real escapes omitted escapes at later style boundaries. A later
"fixed" confirmation immediately regressed again.

This was not a terminal-emulator bug. The bad bytes are already present in the persisted Pi
JSONL. P0.1 removed that section and retained only semantic response-shape and activity-title
guidance. Pi renders Markdown through its theme.

Blast radius:

- Direct Pi and Pi in Herdr/Sidekick show the malformed text.
- Pi's `Ctrl-X` whole-message copy copies semantic content, including these fragments.
- Sidekick previews/search see the same polluted transcript.
- `--print` callers without a prompt override, including `scripts/auto-git-sync`, can write it
  to logs or generated text.
- Telegram and WhatsApp currently override `APPEND_SYSTEM.md` with their own explicit prompt,
  so this particular defect is not injected into their new turns.

### 2. Scroll and selection had three competing owners — renderer quarantined

When loaded, `transcript-scroll.ts` enables SGR mouse modes 1000/1006, patches the root TUI
renderer, and consumes every parsed mouse report. P0.2 now force-excludes it from normal
startup. Herdr still captures mouse and maintains 10 MB of history.
Inside Neovim, Sidekick can provide a stable dump-backed scrollback buffer, but
`herdr_backend.lua` sets `native_scroll = true` for every Herdr-backed tool.

Before the P0.2 rollback, the hybrid had the liabilities of all three approaches:

- normal terminal drag selection, right click, and middle-click paste do not reach the host;
- there is no keyboard transcript scroll/copy mode;
- forced Pi redraws can clear native terminal scrollback;
- a resize or ordinary key returns the logical viewport to the live bottom;
- Sidekick's stable historical selection/copy path is disabled;
- a Pi crash can skip cleanup and leave mouse reporting enabled for the next program in the
  same pane.

After reload, the force-exclude removes the custom viewport, redraw, and mouse-capture behavior.
The remaining gaps are the lack of a keyboard transcript/copy mode and Sidekick's still-disabled
snapshot scrollback; assigning one history owner remains P1.

### 3. Custom subagent tool restrictions are not restrictions

`subagent.ts:18-32` records `tools`, but `buildPiArgs()` at lines 284-329 never emits
`--tools`. The field is consulted only to decide whether to pass the nested-agent allowlist.
The child starts with ambient extension/tool discovery and `--approve`.

Consequences:

- `scout`, `reviewer`, and other nominally read-only Vault Hunter agents can see mutation
  tools, MCP tools, and globally registered tools;
- the current verifier explicitly expects full discovery and does not assert a `--tools`
  allowlist;
- the configured persona creates a false sense of capability isolation.

The locally installed but inactive `pi-subagents@0.37.0` already has explicit tool and
extension visibility controls. Prefer adapting it and preserving only the custom connected
timeline presentation, or immediately add `--tools` plus an explicit extension profile to
the current launcher.

## Surface matrix

| Surface | Rendering | Scroll/history | Copy/paste | Session/lifecycle | Verdict |
|---|---|---|---|---|---|
| Direct Pi in Ghostty | Semantic Markdown + Pi theme | Native PTY history; custom logical viewport disabled | Bracketed paste and whole-message copy; host mouse handling restored | Direct process lifecycle is simple | P0 safe; keyboard copy mode remains P1 |
| Pi in Herdr UI | Same semantic Pi rendering | Custom Pi viewport off; Herdr retains history | Herdr copy mode; Pi no longer consumes every mouse report | Reattach works | P0 safe; ownership E2E remains |
| Pi via Sidekick/Neovim | Same Pi rendering; picker scrubber is stale | Sidekick snapshot scrollback is disabled | Neovim wraps bracketed paste; stable historical selection is missing | Hidden `--takeover` attach jobs can retain ownership | Refactor shared adapter |
| Codex via Sidekick/Neovim | Current output clean | Inherits the same global `native_scroll=true` choice | Inherits global Neovim paste behavior | Inherits persistent `--takeover` attachment | Shared regression, not renderer regression |
| SSH/tmux | Truecolor/OSC52 foundations are present | tmux has 50k history; custom Pi mouse capture is off | OSC52 and tmux-yank are present; image reverse-SCP is fragile | Works when the environment is correct | Needs real E2E coverage |
| Telegram RPC | Transport-specific prompt avoids raw ANSI | N/A | Markdown-to-HTML text only; no image input | Stops at `agent_end`, no timeout abort, one synchronous session | Lifecycle/delivery refactor |
| WhatsApp RPC | Plain text | N/A | Text only | Same premature settle/abort/durability gaps; no switch/resume | Behind Telegram |
| `--json` / `--print` | Semantic Markdown guidance | N/A | Pipe/log output | Transcript renderer excluded | Other TUI extensions need an explicit headless profile |

## Extension decisions

### Local extensions

| Extension | Decision | Why | Better shape |
|---|---|---|---|
| `atlas-evidence-rail-prototype.ts` | **Remove from auto-load** | A named prototype globally registers widgets/status in every Pi startup | Move under `prototypes/` and load explicitly with `-e` |
| `codex-fast-mode.ts` | **Keep** | Provider-request-only and transport-neutral | Rename/document its provider scope; keep out of terminal concerns |
| `herdr-agent-state.ts` | **Keep** | Correctly gates on TUI plus real Herdr environment and publishes lifecycle state | Treat as the reference gating pattern |
| `image-drop.ts` | **Keep, refactor input adapter** | Resize/transform logic and verifier are good; 100 ms raw `/` interception affects normal typing and reverse-SCP guesses host/user | Separate bracketed/file-drop ingestion from image transformation; explicit SSH config; accept RPC attachments |
| `plaid.ts` | **Keep tools, adapt command** | Tool capability is transport-neutral; `/plaid-status` assumes interactive notifications | Return plain status outside TUI or expose RPC UI intentionally |
| `subagent.ts` | **Replace/refactor urgently** | Ignores `AgentConfig.tools`, ambient-loads all extensions/tools, and uses `process.stdout.columns` instead of component width | Adapt `pi-subagents`, enforce `--tools`, explicit extension profiles, preserve connected renderer separately |
| `tool-call-renderer-thinking-prototype.html` | **Relocate prototype** | It is inert today, but a design prototype lives beside globally discovered runtime extensions | Move under `prototypes/` so inventory and deployment intent are unambiguous |
| `tool-call-renderer.ts` | **Refactor behind TUI mode** | Imports Pi installation internals and monkey-patches private component prototypes before mode is known; suppresses native tool rows/results | Delay loading until TUI `session_start`; use a public renderer seam or upstream API; version-contract test |
| `transcript-scroll.ts` | **Disabled from auto-load 2026-08-13; redesign** | Exact Pi force-exclude quarantines the root renderer patch, global mouse capture, selection loss, stale `$NVIM`, hardcoded vault, and recorded width crash | Retain explicit fixture coverage; build transcript model + per-host adapter, keyboard mode, one history owner, and public viewport API |
| `vault-hunter-agents.ts` | **Keep definitions, fix enforcement** | Personas are useful, but their tool lists are currently decorative | Feed definitions into an enforcing subagent runtime |
| `vault-hunter-crew-child.ts` | **Keep, tighten profile** | Child lifecycle/telemetry is useful | Load only for a crew-child environment; explicit headless behavior |
| `vault-hunter-crew.ts` | **Keep** | Already gates on TUI and Herdr | Keep it out of generic/headless profiles |
| `vault-hunter-run.ts` | **Keep, adapt UI policy** | Run tools are useful, but `ctx.hasUI` also means RPC, where current bridges auto-cancel dialogs | Use `ctx.mode === "tui"` for terminal-only confirmation or implement remote approval |

### Configured and installed packages

| Package/resource | Decision | Notes |
|---|---|---|
| `pi-mcp-adapter` | **Keep, define headless policy** | Pre-authenticated tools work; OAuth/elicitation/sampling dialogs currently have no useful Telegram/WhatsApp flow |
| `youtube-search` | **Keep** | Transport-neutral tool; explicit package path loaded successfully under Pi 0.82.1 |
| `amosblomqvist/pi-config` with `extensions: []` | **Keep as a resource source** | Its general extensions are intentionally disabled; do not conflate it with the local production extension set |
| `pi-subagents@0.37.0` | **Promote after compatibility test** | Installed as an npm dependency but not configured as the active Pi extension; best candidate to replace custom orchestration safely |

## Shared Sidekick/terminal gaps

These changes can affect Codex and other terminal programs even though the Pi renderer hacks do
not patch Codex code:

1. `herdr_backend.lua:46-50` sets `native_scroll=true` for all tools. Make the policy
   surface/tool-specific, and use Sidekick's snapshot scrollback inside Neovim.
2. `herdr_backend.lua:96-98` always attaches with `--takeover`. Hiding a Sidekick window does
   not stop its terminal job, so hidden clients can retain exclusive ownership. Release the
   attach client on hide and recreate it on show.
3. `options.lua:42-70` has one global phased-paste buffer. Key it by terminal channel/buffer
   so two Sidekick terminals cannot interleave paste fragments.
4. Ghostty maps Shift-Enter to `ESC CR`. Through Ghostty → Neovim → Herdr → Pi, Herdr's lone
   Escape timeout can turn that into cancel plus Enter. Use Pi's documented terminal sequence
   and test the full nested route.
5. Global `TERM=xterm-256color` masks Ghostty terminfo/capabilities. Set compatibility TERM
   only at the boundary that actually needs it.
6. `cwd_picker.lua` looks for an old `MCP:` footer and old context shape. Pi now renders
   `🔌 MCP: 4 servers enabled` and `7.7%/1.0M`. Its Working-status scrubber also removes useful
   activity feedback from both Pi and Codex, contrary to the prior product intent.

## External service gaps

The two RPC bridges need a shared run reducer rather than bespoke loops:

- wait for authoritative `agent_settled`, not the first `agent_end` (which may retry);
- send RPC `abort` on timeout and drain only the corresponding run's events;
- persist/resume a real session path/ID—`--name` labels a new session, it does not resume one;
- isolate session state per chat or explicitly document the shared-session model;
- acknowledge inbound offsets only after durable processing/delivery, with idempotency/outbox;
- sanitize control bytes defensively at the transport boundary;
- support images, progress, steering, approvals, and background completion delivery through
  explicit transport capabilities rather than silently cancelling all UI requests.

What already works should be preserved while that reducer is extracted:

- **Telegram:** text/captions, allowlisting, mention gating, typing activity, voice/audio
  transcription, session listing/switching, concise transport-specific prompting, and safe
  Markdown-like HTML rendering.
- **WhatsApp:** allowlisted prefixed text, status/reset, and reply delivery through the local
  bridge.

Additional transport-specific gaps:

- Telegram shares one synchronous Pi session across chats, cannot steer an active run, has no
  photo/image ingestion, silently cancels extension dialogs, and persists its update offset
  before durable processing/delivery.
- WhatsApp has the same settle/abort/shared-session/dialog/acknowledgement gaps, plus no real
  session switch/resume, Markdown, media, typing/progress, or origin/message-ID deduplication;
  the queried `is_from_me` field is not used as a filter.

## Prior verified behavior carried into this audit

- `image-drop.ts` previously fixed real Ghostty-over-SSH path fragmentation with a 100 ms
  debounce and a delayed-character verifier. That transform/transfer capability is worth
  keeping; the audit recommendation is to move raw-path ingestion behind a surface adapter,
  not to discard image support.
- The compact work-step renderer was previously proven against Pi 0.81.1 with deterministic
  persisted sessions, reload/restoration checks, custom-tool suppression, ANSI foreground
  assertions, and an optional live-model smoke. The current risk is its private Pi component
  monkey-patch and global/headless initialization, so every Pi upgrade still needs a contract
  test.

## Target architecture

Keep the agent domain independent from its host:

1. **Semantic core** — messages, tool events, sessions, link targets, images, approvals. No ANSI,
   terminal widths, clipboard commands, `$NVIM`, or mouse sequences.
2. **Pi presentation** — Markdown/theme and tool activity components. TUI-only code receives
   the render width and never imports/patches private installation paths in headless modes.
3. **Surface capability adapters** — direct TTY, Herdr UI, Sidekick/Neovim, and RPC services.
   Each adapter owns history/selection, clipboard, paste/file ingestion, opener behavior, and
   attachment lifecycle for that surface.
4. **Explicit profiles** — `terminal`, `herdr-child`, `sidekick`, `headless-rpc`, and
   `unattended`. A profile selects extensions; ambient global discovery is not a capability
   boundary.

The architecture diagram uses color as an explicit role encoding: blue marks neutral semantic,
runtime, and terminal boundaries; green marks Pi-native or intended ownership; red marks the
private custom-renderer risk; and yellow marks shared integration layers whose ownership remains
open. Solid gray arrows are ordinary flow, dashed red is the risky private-renderer branch, solid
yellow is a shared handoff, and the dashed green enclosure is Pi presentation's ownership scope.
Dark fills provide contrast only; they do not add another status dimension.

### One scroll/copy owner per surface

- **Direct Ghostty Pi:** Pi logical transcript view plus keyboard PageUp/PageDown and an
  explicit copy/selection mode; provide a documented mouse-selection bypass.
- **Herdr UI:** Herdr owns historical scroll/copy. Pi receives mouse only at the live bottom.
- **Sidekick/Neovim:** live PTY at the bottom; on scroll, materialize `herdr agent read` into a
  normal Neovim buffer for search, selection, and yank; return to live terminal for input.
- **RPC/print:** no terminal scrolling or ANSI at all; transport-native rendering only.

## Recommended sequence

### P0 — safe rollback and capability correctness

1. [x] Remove raw-ANSI generation from `APPEND_SYSTEM.md`; retain response-shape/activity rules.
2. [x] Stop global-loading `transcript-scroll.ts`. One affected pane reloaded so its shutdown
   hook reset SGR mouse modes; the other affected Pi process and pane exited. Normal startup
   resolves the retained source disabled.
3. [ ] Enforce child tool/extension profiles or replace custom `subagent.ts` with `pi-subagents`.
4. [ ] Add a six-column/narrow-width renderer test and a clean-copy assertion.

### P1 — terminal integration

1. [active] Attachment Leases Phase 1: freeze vocabulary, state transitions, profile shapes,
   effective-plan inspection, and executable scenarios in isolated workspace `w5W`.
2. After the contract is executable, make Sidekick own scrollback inside Neovim and release
   hidden takeover attachments.
3. Split transcript/link logic from host adapters; add keyboard scroll/copy and opener fallback.
4. Make phased paste state buffer-local; correct Shift-Enter and TERM capability handling.
5. Update picker parsing while preserving Working/activity feedback.

### P1 — headless integration

1. Consolidate Telegram/WhatsApp around `agent_settled`, timeout abort, session resume, and
   durable delivery.
2. Add transport adapters for Markdown/control-byte sanitization, images, approvals, progress,
   steering, and background completions.

### P2 — compatibility gate

Run the same acceptance matrix on Mac Pi 0.82.1 and homelab Pi 0.83.0, then either pin one Pi
version or keep an explicit two-version contract. Test Herdr 0.8 and 0.7.5 separately.

## Acceptance matrix to add

For each of direct Ghostty, Herdr UI, Sidekick/Neovim, SSH/tmux, Telegram RPC, WhatsApp RPC,
and `--print`:

- render at widths 6, 20, 80, and after resize;
- scroll while output is streaming, then continue without jumping unexpectedly;
- select and copy old transcript text; copied bytes contain no ANSI/control fragments;
- paste single-line and multiline text while live and while viewing history;
- prove simultaneous phased pastes in two terminal buffers cannot interleave;
- route image/file input only on supported surfaces;
- open/copy HTTP and file links with a safe fallback outside Neovim;
- prove keyboard transcript scrolling/copy and intentional host mouse selection both work;
- crash/restart an affected TUI and prove SGR mouse reporting is reset;
- hide/show/reattach without leaving an exclusive takeover client;
- retry, timeout/abort, restart/resume, and background completion for RPC;
- prove RPC acknowledgement happens after durable processing/delivery and deduplicates retries;
- prove read-only subagents cannot see or invoke mutation tools.

## Evidence and verification ledger

- Live Herdr agent/pane/workspace state was inspected on the Mac; two Pi and several Codex
  sessions were available. Codex rendering was clean.
- A persisted live Pi JSONL proved malformed SGR was authored into message content.
- The exact transcript was
  `~/.pi/agent/sessions/--Users-aviral-dotfiles--/2026-08-09T13-34-15-264Z_019fe6bb-30e0-7d5e-90e9-066a07ad4aa3.jsonl`.
- `~/.pi/agent/pi-crash.log` preserves a historical transcript-renderer width violation.
- `scripts/verify-pi-transcript-links V02` passed.
- P0.1 static checks prove the current append prompt contains no escape byte or ANSI-generation
  directive and still contains `# Response shape` plus `# Tool-call activity titles`.
- Pi 0.82.1's installed resource resolver reports the retained `transcript-scroll.ts` source as
  `enabled: false`; an offline model-free TUI smoke emitted none of mouse modes 1000/1002/1003/1006.
- Both affected live surfaces were neutralized: one pane reloaded and ran the extension's SGR
  cleanup, while the other Pi process and pane exited before reload and no longer owns a terminal.
- PR #131 merged the reviewed P0 scope to `main` as `86a38aa`; Attachment Leases Phase 1 was
  launched from that baseline in Herdr workspace `w5W` with a dedicated branch and worktree.
- The dormant implementation's V02 verifier still passes when the source is loaded explicitly,
  including balanced mouse modes, shutdown cleanup, reload cleanup, and renderer restoration.
- The explicit Neovim V03 fixture reached real Pi but currently fails three assertions: one
  hardcodes the former `gpt-5.6-sol` footer while live settings use Fireworks/Kimi, and two
  expect a wikilink target buffer to open behind Pi. This separate dormant-fixture drift does
  not contradict the resolver or normal-startup P0.2 checks and was not hidden as a pass.
- `scripts/verify-pi-image-drop` passed when allowed to acquire Pi's settings/trust locks.
- `V01` behavior checks passed except its baseline-ancestry assertion on the currently
  diverged branch.
- The work-step golden verifier refused to run because the parent Git source is not clean;
  that is a custody/precondition failure, not a product pass.
- No live Neovim RPC socket was discoverable, so Neovim runtime behavior was established from
  the checked-in adapter, installed Sidekick source, live Herdr state, and prior verified
  contracts—not by driving the current editor UI.
- Homelab `main` is clean at `1e75d8a` (merged Herdr 0.8 compatibility), both Pi messaging
  services are active, Pi is 0.83.0, and Herdr remains 0.7.5.

Research provenance: root Codex rollout `019fe6ba-a82e-7d72-8fa5-b97b0fd68733`, plus the
extension inventory `019fe6f0-66a1-7c91-aedf-0b4383bba6a1`, terminal integration map
`019fe6f0-8284-77c1-9841-570f33444be9`, and outside-Neovim surface audit
`019fe6f0-99d0-7492-b316-6439b5e750c0`.
