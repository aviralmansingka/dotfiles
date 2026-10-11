# Herdr attachment leases

Phase 1 launch update · 2026-08-13 · contract and verifier work is active; runtime behavior is
unchanged.

## Launch status

Phase 1 is running in a dedicated Herdr workspace and isolated Git worktree:

| Field | Active value |
| --- | --- |
| Herdr workspace | `w5W` · `Attachment Leases · Phase 1` |
| Agent | `codex-attachment-leases` · idle and ready for iteration |
| Branch | `agent/herdr-attachment-leases-phase1` |
| Worktree | `/Users/aviral/.herdr/worktrees/dotfiles/herdr-attachment-leases-phase1` |
| Baseline | `origin/main` at merge commit `86a38aa` (PR #131) |
| Phase guardrail | Contract, profiles, state transitions, and executable acceptance only; no Sidekick behavior change |

## Decision in one sentence

Keep one durable Herdr Agent Session and negotiate a short-lived Attachment Lease whenever a
surface opens it. Neovim and terminal mode become adapters over that same session rather than
different kinds of session.

The objective is outcome parity: the same conversation, transcript, ability to scroll, search,
copy, open links, paste, steer, and resume. The mechanics remain native to each surface.

## Why the current seam is too shallow

The current Sidekick adapter already has most of the raw ingredients, but policy is scattered:

- `herdr_backend.lua` sets `native_scroll = true`, disabling Sidekick's dump-backed history view.
- Every Neovim attach launches `herdr agent attach ... --takeover`.
- Hiding a Sidekick window hides the window but does not express an ownership release to Herdr.
- `dump()` already reads Herdr history, and installed Sidekick already knows how to materialize
  that history when native scrolling is disabled.
- Herdr 0.8 exposes attach plus an unconditional `--takeover`, but no declared surface, lease,
  heartbeat, observer role, or capability plan.

This makes each caller understand takeover, scrolling, and lifecycle details. The proposed module
earns its place by making that complexity disappear from every surface adapter.

## Proposed vocabulary

These terms are the Phase 1 working vocabulary. They become canonical only after their
invariants and observable behavior survive the versioned contract iterations:

- **Agent Session** — the durable Herdr-managed process, identity, PTY, and transcript. It is not
  a Neovim session or terminal session.
- **Surface Attachment** — one client view of an Agent Session, such as Sidekick or Herdr's
  terminal UI.
- **Attachment Lease** — Herdr's time-bounded grant allowing one Surface Attachment to send live
  input and own interactive mouse routing.
- **Lease Holder** — the one Surface Attachment currently allowed to mutate the live TUI.
- **Observer** — a Surface Attachment that may display snapshots and status but cannot send input.
- **Capability Plan** — the resolved owner for history view, selection, clipboard, opener, paste,
  attachment input, live input, and mouse behavior for one surface.

## Ideal seam

Herdr owns session truth and arbitration:

- Agent Session identity and lifecycle.
- Canonical PTY transcript/history.
- Attachment registry and liveness.
- Exactly one live-input Attachment Lease.
- Capability-profile resolution and an inspectable Capability Plan.
- Explicit release, bounded expiry, and deliberate transfer.

The adapters own surface-native experience:

- **Sidekick/Neovim:** windows, buffers, search, visual selection, registers, `vim.ui.open`, paste,
  file navigation, and releasing the lease when hidden.
- **Herdr terminal UI/Ghostty:** copy mode, scrollback presentation, OSC52/host selection, terminal
  opener, and releasing the lease when detached or unfocused by policy.
- **Pi/Codex:** live semantic presentation and conversation/model state. They do not decide which
  host owns scrollback, clipboard, or attachment lifecycle.

## Small external interface

The interface should stay narrow. Names below are illustrative, not a frozen CLI contract:

1. `launch(profile)` returns an Agent Session reference. Existing session start semantics remain.
2. `open(session, surface)` returns a Surface Attachment, Capability Plan, and either a live lease
   or observer status.
3. `release(attachment)` relinquishes the lease and unregisters the attachment.

Existing `agent read` remains the transcript/snapshot interface. Lease renewal should normally be
internal to `open`; callers should not have to manually choreograph heartbeats.

## Capability ownership matrix

| Capability | Canonical authority | Neovim adapter | Terminal adapter |
| --- | --- | --- | --- |
| Session identity/lifecycle | Herdr Agent Session | Requests/reopens | Requests/reopens |
| Conversation/model state | Pi or Codex | Same live process | Same live process |
| Live rendering | Agent TUI | Displays PTY | Displays PTY |
| Transcript storage | Herdr | Reads snapshots | Reads native history |
| Historical view | Capability Plan | Sidekick buffer | Herdr copy mode |
| Search/selection/copy | Surface adapter | Neovim search, visual mode, registers | Herdr/Ghostty, OSC52 |
| Live input | Attachment Lease | Holder while visible/focused | Holder while focused |
| Mouse routing | Attachment Lease + adapter | Neovim/Sidekick | Herdr/terminal |
| Link/file opener | Surface adapter | `vim.ui.open` and Neovim navigation | Host opener |
| Paste/file ingestion | Surface adapter | Neovim normalization | Terminal normalization |
| Seen/unseen state | Herdr agent state | Focus only completed `done` | Focus only completed `done` |

## Lease invariants

1. At most one Surface Attachment holds live-input ownership for an Agent Session.
2. Zero holders is valid; the agent continues running and producing output.
3. Any number of Observers may read snapshots without taking ownership.
4. Opening a second surface never silently steals a healthy lease.
5. Hide, close, detach, or explicit switch releases immediately.
6. Process loss or missed heartbeat expires the lease after a bounded interval.
7. A stale holder may be replaced; an active holder requires deliberate transfer or force.
8. Switching surfaces never restarts the Agent Session or changes its conversation identity.
9. Every open reports the effective Capability Plan; no ambient discovery silently changes it.
10. History is stored once by Herdr; surface buffers are projections, never competing authorities.

## Main user scenarios

### Launch from Neovim

1. The Workspace Tab chooses the `interactive` session profile and launches an Agent Session.
2. Sidekick opens it as surface `nvim`.
3. Herdr resolves the Neovim Capability Plan and grants the live lease.
4. Terminal mode displays the live TUI; entering history mode materializes a Sidekick buffer from
   Herdr's snapshot.
5. Hiding Sidekick releases the lease but leaves the Agent Session running.

### Continue in terminal mode

1. The user opens the same Agent Session in Herdr's terminal UI.
2. If no healthy holder exists, the terminal attachment receives the lease.
3. The same PTY and transcript appear; Herdr copy mode owns scroll/search/copy for this surface.
4. Detaching releases the lease. Reopening in Neovim resumes the same session.

### Open both surfaces

The current holder remains interactive. The second surface opens as an Observer and may follow
output or inspect history. It can request transfer, but it never gets surprise takeover.

### Neovim crashes

The heartbeat stops, the lease expires, and terminal mode can acquire it. The Agent Session,
transcript, and conversation survive because they live in Herdr/the agent process, not Neovim.

### Background completion with no holder

The agent may finish while no surface owns input. Herdr records `done`; opening either surface
shows the completed transcript and applies the existing seen/unseen rule.

## Profile model

The profile has two layers:

- **Session policy:** agent kind, workspace placement, extension/tool profile, lifetime, and
  canonical history store. It is selected at launch and remains stable.
- **Surface policy:** history view, selection, clipboard, opener, paste, attachment input,
  live-input lease behavior, and mouse routing. It is resolved every time the session is opened.

Recommended initial profile:

| Setting | Interactive session | Neovim surface | Terminal surface |
| --- | --- | --- | --- |
| History store | Herdr | — | — |
| Historical view | — | Sidekick snapshot | Herdr copy mode |
| Selection/copy | — | Neovim | Herdr/Ghostty + OSC52 |
| Opener | — | Neovim | Host terminal |
| Input | — | Lease while visible/focused | Lease while focused |
| Mouse | — | Neovim surface | Herdr surface |
| On hide/detach | — | Release | Release |

Precedence should be explicit request, then named profile, then a documented default. The resolved
plan—not raw configuration merging—should be displayed by an inspect command.

## Transfer policy

Recommended default: no implicit takeover.

When an active lease exists, another surface receives three clear outcomes:

- **Observe:** open read-only immediately.
- **Request transfer:** notify the current holder and transfer after it releases or accepts.
- **Force:** allowed only with explicit user intent or when the holder is stale.

This preserves safety without blocking recovery. The present `--takeover` behavior remains a
compatibility path during migration, but it should stop being Sidekick's default.

## Delivery plan

### Phase 1 — contract and verifier

- **Active in Herdr workspace `w5W`.**
- Settle vocabulary and write the capability/lease invariants as executable acceptance cases.
- Define session and surface profile shapes plus effective-plan inspection.
- Freeze scenarios: Neovim launch, terminal continuation, observer, transfer, hide, crash, expiry,
  and background completion.
- No Sidekick behavior change yet.

Phase 1 will iterate in deliberately small versions:

1. **V0 — vocabulary and boundary:** freeze the six domain terms, authorities, and non-goals.
2. **V1 — state contract:** express grant, observe, renew, release, transfer, force, and expiry as
   executable state-transition cases.
3. **V2 — capability plans:** define session/surface profile shapes, precedence, and inspectable
   effective-plan output.
4. **V3 — scenario matrix:** bind Neovim, terminal, simultaneous observer, crash, expiry, and
   background completion to the contract for both Pi and Codex.

Phase 1 exits only when those cases can fail against current unconditional takeover behavior and
describe the intended contract without requiring a Sidekick runtime change.

### Phase 2 — Herdr lease controller

- Add the attachment registry, single-holder enforcement, liveness, expiry, release, and transfer.
- Add surface declaration and observer behavior to the attach/open interface.
- Keep `agent read` as the canonical snapshot interface.
- Preserve legacy attach behavior behind an explicit compatibility mode.

### Phase 3 — Sidekick adapter

- Open with surface `nvim` and consume the returned Capability Plan.
- Stop unconditional `--takeover`.
- Release on hide/close and recover safely after Neovim restart.
- Enable dump-backed Sidekick history for the Neovim plan instead of globally forcing
  `native_scroll = true`.

### Phase 4 — terminal parity

- Declare terminal attachments as surface `terminal`.
- Confirm Herdr history/copy mode, OSC52, opener, paste, mouse, and focus behavior.
- Verify surface switching never restarts the agent or changes its session identity.

### Phase 5 — migration and gates

- Run the same capability matrix for Pi and Codex.
- Verify direct terminal, Sidekick/Neovim, simultaneous observer, crash recovery, and resize.
- Remove the unconditional takeover path only after existing sessions and old clients have a
  documented migration behavior.

## What this does not require

- Rewriting Pi or Codex rendering.
- A structured semantic transcript protocol.
- Duplicating transcript storage in Neovim.
- Making Sidekick a session authority.
- Forcing terminal and Neovim to use identical keymaps or UI mechanics.

## Risks and discussion points

1. **Where Herdr source work lands:** the installed Herdr 0.8 CLI does not expose lease semantics;
   implementation requires the owning Herdr source repository and compatibility strategy. This
   is a Phase 2 dependency, not a blocker for the active Phase 1 contract/verifier work.
2. **Transfer UX:** should a healthy holder be able to reject a transfer indefinitely, or should
   an explicit user force always win?
3. **Lease timeout:** it must be fast enough for crash recovery but tolerant of temporary client
   stalls. The exact interval should be tested, not guessed into the interface.
4. **Mouse ownership:** live TUI mouse input and host text selection need an explicit bypass on
   both surfaces.
5. **History fidelity:** Sidekick should prove resize, ANSI replay, links, copy-without-controls,
   and transition back to live mode against real Pi and Codex sessions.

## Acceptance headline

Launch once. Open anywhere. One live owner. Many safe observers. Same session and transcript on
every surface. No hidden takeover survives its view.
