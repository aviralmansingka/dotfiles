# ccgram prototype — observe-only Telegram fleet mirror (scoped evaluation)

A **scoped, deletable prototype** for evaluating [ccgram](https://github.com/alexei-led/ccgram)
as a Telegram mirror of Herdr-managed Pi agent sessions (Firstmate workers). It gives the
captain one Telegram topic per live agent session so the fleet is visible from a phone.

This is **not production**. Everything tracked lives in this one directory
(`ccgram-prototype/`) and everything local lives under two paths, so removal is a few
commands (see [Rollback](#rollback--deleting-the-prototype)).

Basis: `ccgram-firstmate-integration-scout` report (2026-08-15). Homelab has Herdr 0.7.5
(protocol 17, supported by ccgram) and the Pi Herdr integration v6, so Firstmate workers
already publish agent sessions that ccgram discovers with zero code changes.

## Safety rules (read first)

1. **Observe-only.** Do not use ccgram to launch, kill, steer, or recover Firstmate
   workers. ccgram has no read-only mode; its Kill button and recovery flows act on *any*
   bound window and would fight Firstmate's supervision. Don't tap Kill/Close/recovery
   buttons, and don't use `/new`. Watching topics, screenshots, and `/last` is fine.
2. **Firstmate remains the source of truth** for task identity, dispatch, supervision, and
   cleanup. ccgram topics are a display layer only.
3. **Separate bot, separate group.** The prototype uses its own BotFather bot and its own
   topics-enabled test group. Never point it at the pi-telegram/Firstmate frontdoor bot
   token or the live Telegram group.
4. **Secrets stay local.** The filled-in env file is untracked, `chmod 600`, and never
   committed. Only the `.example` template is in git.
5. **Emoji may disagree with Firstmate.** ccgram derives status from Herdr native state and
   transcripts; Firstmate has its own busy records. Occasional "ready" while Firstmate says
   busy is cosmetic — trust Firstmate.

## Files in this package

| Path | Purpose |
| ---- | ------- |
| `.config/systemd/user/ccgram-prototype.service` | User unit running ccgram against Herdr. Deployed by `stow ccgram-prototype`. |
| `.config/systemd/user/ccgram-thinking-sidecar.service` | User unit for the **deprecated** thinking sidecar (see below). Deployed by stow; **not enabled by default**; do not enable alongside the renderer patch. |
| `.local/bin/ccgram-thinking-sidecar` | Stdlib-only Python sidecar (deprecated fallback). Deployed by stow to `~/.local/bin`. |
| `.config/ccgram-prototype.env.example` | Env template (multiplexer, status mode, autoclose, low-noise notification knobs, placeholders for secrets, optional sidecar fallback tuning). |
| `patches/ccgram-4.5.2-pi-renderer-parity.patch` | Tracked unified diff, layer 1: patches the installed ccgram 4.5.2 Pi renderer (thinking + tool-call + final-answer flow). Not deployed by stow. |
| `patches/ccgram-4.5.2-low-noise-notifications.patch` | Tracked unified diff, layer 2 (applies on top of layer 1): final-answer-only notifications (silent thinking trace, quiet-progress mode). Not deployed by stow. |
| `patches/ccgram-4.5.2-pi-transcript-binding.patch` | Tracked unified diff, layer 3 (disjoint files): fixes the SessionStart transcript-binding race for reused session directories (exact-match-only binding, deferred pending resolution, offset reset on path change). Not deployed by stow. |
| `patches/ccgram-4.5.2-pi-thinking-tree-live.patch` | Tracked unified diff, layer 4 (edits layer-1 files): thinking-tree liveness — live elapsed timer + ticker, `CCGRAM_PI_TRACE_*` cadence/idle/wrap knobs, mid-turn text folded into the tree as the goal line, same-message goal/thinking paraphrase dedupe, idle-timeout bubble deletion. Not deployed by stow. |
| `.local/bin/ccgram-pi-hook` | Pi hook shim: waits (self-bounded) for the session's OWN transcript file at SessionStart, injects the exact `transcript_path`, delegates to `ccgram hook --provider pi`. Deployed by stow. |
| `.pi/agent/extensions/hooks.json` | cc-thingz hook-runner wiring (SessionStart/Stop/SessionEnd → shim, async; SessionStart timeout raised to 20s to cover slow transcript creation). Deployed by stow. |
| `pi-renderer-patch.sh` | Idempotent `status`/`check`/`apply`/`rollback` for the whole patch stack, with file-level backups. Not deployed by stow. |
| `pi-renderer/` | Patch-stack fixture tests (JSONL turn with thinking + tool calls + final text; low-noise notification behavior). Not deployed by stow. |
| `transcript-binding/` | Transcript-binding race fixture tests (reused-directory/off-by-one reproduction; shim behavior). Not deployed by stow. |
| `thinking-sidecar/` | Sidecar unit tests + JSONL/state fixtures (deprecated fallback). Not deployed by stow. |
| `validate.sh` | Offline checks: systemd unit syntax + sidecar unit tests + renderer patch state and fixture tests + no committed secrets. Not deployed by stow. |
| `README.md` | This guide. Not deployed by stow. |

Local (untracked) state the prototype creates:

| Path | Purpose |
| ---- | ------- |
| `~/.config/ccgram-prototype.env` | Your filled-in env file (secrets). A real file, not a symlink — the filled-in secrets never live inside the repo tree. |
| `~/.ccgram-prototype/` | ccgram state dir (`CCGRAM_DIR`): state.json, session_map.json, events.jsonl. Safe to wipe; topics rebind by discovery/name on restart. Also holds `thinking-sidecar-state.json` (temp message ids for orphan cleanup). |

## Onboarding

### 1. Create a separate bot with BotFather

In Telegram, open `@BotFather`:

1. `/newbot` — pick a distinct name/username, e.g. `ccgram-prototype-bot`. This bot is
   **only** for this prototype; do not reuse the Firstmate frontdoor bot.
2. Copy the token it gives you — goes into `TELEGRAM_BOT_TOKEN` later.
3. Optional hardening: `/setjoingroups` → select the bot → **Disable**, so nobody can add
   it to other groups.

### 2. Create a topics-enabled test group

1. In Telegram: New Group, e.g. `ccgram-prototype-test`. Add only yourself.
2. Group settings → **Topics** → enable (group becomes a forum).
3. Add your new bot to the group and promote it to **admin** (admin rights let it read and
   create topics; this group is throwaway, so full admin is fine).

### 3. Collect IDs

- **Your user ID** (`ALLOWED_USERS`): message `@userinfobot`, note the numeric `Id`.
- **Group ID** (`CCGRAM_GROUP_ID`): with the bot in the group, post any message in the
  group, then from a shell (this is the only Telegram API call in the whole setup):

  ```sh
  curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates" | jq .
  ```

  Find `message.chat.id` — a negative number like `-100xxxxxxxxxx`. (If the result is
  empty, make sure the bot is a group member and privacy mode isn't blocking reads —
  admin status covers this.)

### 4. Install ccgram (skip if already installed)

```sh
uv tool install ccgram
# or straight from source: uv tool install git+https://github.com/alexei-led/ccgram
command -v ccgram   # expect ~/.local/bin/ccgram
```

### 5. Deploy config and fill in secrets

```sh
cd ~/dotfiles
stow ccgram-prototype

cp ~/.config/ccgram-prototype.env.example ~/.config/ccgram-prototype.env
chmod 600 ~/.config/ccgram-prototype.env
$EDITOR ~/.config/ccgram-prototype.env
```

Fill in `TELEGRAM_BOT_TOKEN`, `ALLOWED_USERS`, `CCGRAM_GROUP_ID` from steps 1–3. The
remaining defaults (`CCGRAM_MULTIPLEXER=herdr`, `CCGRAM_STATUS_MODE=user`,
`AUTOCLOSE_*=0`) are the intended evaluation posture — leave them.

### 6. Start and check the service

```sh
systemctl --user daemon-reload
systemctl --user enable --now ccgram-prototype.service
systemctl --user status ccgram-prototype.service
journalctl --user -u ccgram-prototype.service -f
```

Healthy signs: no `Conflict` errors (would mean a shared token), no Herdr protocol
errors, no restart loop.

### 7. First smoke test

1. **Topic adoption**: within a minute, the test group should show one topic per live
   Herdr agent session in the default session — Firstmate workers appear as
   `firstmate ▸ fm-<task-id>`. Unrelated agent sessions may also get topics (ccgram
   adopts everything; known limitation, cosmetic).
2. **Read-only peek**: open a topic, try `/last` and a screenshot. Confirm you're only
   reading — never press Kill/recovery buttons.
3. **Frontdoor untouched**: `systemctl --user status pi-telegram.service` is still
   healthy, and nothing appeared in the live Firstmate group.
4. **Lifecycle follow** (optional): when a Firstmate task spawns/tears down, its topic
   appears/goes dead; with `AUTOCLOSE_*=0` topics persist so you can watch raw behavior.
   Verify ccgram never creates a replacement tab itself.
5. Done evaluating? Follow the rollback below.

## Pi renderer parity patch — one pipeline owns the Pi transcript

ccgram 4.5.2's Pi formatter (`ccgram/providers/pi_format.py` in the installed uv
tool) parses `text` and `toolCall` blocks but silently drops `thinking` blocks,
so Pi reasoning never reaches the topics. The previous iteration worked around
this with a companion sidecar; this prototype now prefers **patching ccgram's
own Pi rendering path** so a single pipeline owns thinking, tool-call display,
and final-answer rendering — no sidecar layering, no duplicate thinking output.

What the patch does (all inside ccgram, against the installed uv tool):

1. **`providers/pi_format.py`** — `thinking` blocks are emitted as
   `content_type="thinking"` messages stamped `phase="pi-live"`. Assistant text
   with a terminal `stopReason` (anything but `toolUse`, including errors) is
   stamped `phase="pi-final"`. Tool calls/results are untouched.
2. **`handlers/messaging_pipeline/pi_live_transcript.py`** (new) — owns the
   temporary thinking trace: one message per topic, rendered as a compact
   tree (`├─` node per thinking step, first line only, overflow folded into
   `… (N earlier steps)`, `└─ ⏳ still thinking…` spinner), edited in place
   with a 2s rate limit, and **deleted** when the final answer (or terminal
   error) arrives — the same temporary-render semantics as Pi's tree-style
   live transcript.
3. **`handlers/messaging_pipeline/message_routing.py`** — routes `pi-live`
   thinking into the trace (never to permanent "Thinking" messages) and
   retires the trace before delivering `pi-final` answers.

Patch layer 4 (`patches/ccgram-4.5.2-pi-thinking-tree-live.patch`) extends
the same three files — see "Thinking-tree liveness" below.

Tool calls need no patch: ccgram's default `batch_mode=ephemeral` already
collapses each run of tool calls into one compact bubble that is edited in
place as results land and **deleted** when the turn's final content flushes —
consistent with Pi's collapsed tool display. Leave the batch mode at its
default (or set it per window with `/verbose`) for the Pi-like presentation.

### Apply / validate / roll back

```sh
cd ~/dotfiles/ccgram-prototype
./pi-renderer-patch.sh status     # per-patch: applied | not-applied | unknown
./pi-renderer-patch.sh check      # verifies the missing layers apply cleanly

# If the deprecated sidecar fallback is running, stop it FIRST — running
# both would double the thinking output.
systemctl --user disable --now ccgram-thinking-sidecar.service 2>/dev/null || true

./pi-renderer-patch.sh apply      # backs up originals, applies missing layers in order (idempotent)
systemctl --user restart ccgram-prototype.service
```

Rollback (exact reverse of apply, whole stack in reverse order):

```sh
./pi-renderer-patch.sh rollback   # reverse-patches (idempotent)
systemctl --user restart ccgram-prototype.service
```

## Pi transcript-binding race — exact-match-or-defer (patch layer 3 + shim)

The bug: Pi's SessionStart hook fires **before** Pi creates the session
JSONL (observed ~4.2s on reused Firstmate/treehouse leases). Stock ccgram
then fell back to the **newest existing transcript in the reused session
directory** — the previous worker's file — so a new worker's topic watched
its predecessor's transcript until a later hook event self-healed the
binding (minutes late, with "Corrupted offset"/"File truncated" warnings
and replay risk). A prior audit measured the off-by-one on 5/5 consecutive
workers sharing one lease.

Layer 3 (`patches/ccgram-4.5.2-pi-transcript-binding.patch`) plus the
tracked hook shim close the race at every binding vector, without any
launch/kill/recovery behavior (observe-only posture unchanged):

| Vector | Fix |
| ------ | --- |
| `hook.py` SessionStart resolution | **Exact match only**: a Pi transcript is eligible only when its filename contains the session id. No newest-file fallback; a mismatched payload path is refused. When the file doesn't exist yet, the session_map entry records the session with an **empty transcript_path (pending)**. |
| `session_monitor.py` poll loop | Pending Pi sessions are re-resolved **every poll** by exact session-id match; the session binds its own file as soon as Pi creates it (seconds, not minutes). |
| `transcript_reader.py` offsets | Whenever a session's transcript **path changes**, the tracked byte offset is dropped and the session rebinds fresh — no mid-file corruption, no full stale replay. |
| `session_map.py` primary preservation | The nested-session "preserve existing primary" guard (tmux/claude observer pattern) no longer pins **Pi** windows: a new Pi SessionStart is always the window's new primary. Claude behavior unchanged. Stale transcript paths are cleared from window state when the session changes without a replacement. |
| `session_resolver.py` history reads | A persisted transcript path whose filename doesn't name the session is treated as absent for Pi, so `/last`/summary reads can't bind the prior tenant's file. |
| `~/.local/bin/ccgram-pi-hook` (shim) | Waits for the session's OWN `*_<session_id>.jsonl` to exist **and be non-empty** before injecting `transcript_path` — fastest correct binding in the common case. The wait self-bounds to the hook runner's `PI_HOOK_TIMEOUT_SEC` (minus margin; `CCGRAM_PI_HOOK_WAIT_SECS` overrides; hard cap 30s) and **never** injects a prior tenant's file. |
| `hooks.json` | SessionStart hook timeout raised 5s → 20s (still `async: true`, so Pi never blocks) to cover slow transcript creation; the shim exits well before the runner's SIGTERM. |

Defense in depth: if the shim times out, ccgram defers (pending) instead
of binding wrong, and the poll loop binds the exact file when it appears.
If a later hook event re-resolves first, the offset reset keeps the handoff
clean.

### Deploy / redeploy the shim (tracked since this PR)

The shim and `hooks.json` were previously untracked live files. stow will
not overwrite real files, so redeploy once by hand:

```sh
rm -f ~/.local/bin/ccgram-pi-hook ~/.pi/agent/extensions/hooks.json
cd ~/dotfiles && stow ccgram-prototype
```

### Live smoke plan for the race fix (only when explicitly authorized)

Offline tests reproduce the race fully. To smoke live after applying layer
3, redeploying the shim, and restarting the service:

1. Let Firstmate dispatch two consecutive small worker tasks into the SAME
   treehouse lease (the reused-directory case).
2. `jq -r '.[] | [.session_id, .transcript_path] | @tsv' ~/.ccgram-prototype/session_map.json`
   — the second worker's entry must name its OWN transcript from spawn
   (filename contains its session id), or sit pending (`""`) for at most a
   few seconds.
3. `jq '.tracked_sessions' ~/.ccgram-prototype/monitor_state.json` — no
   session id mapped to a file naming a different session id (the old
   off-by-one pattern).
4. `journalctl --user -u ccgram-prototype.service` shows zero "Corrupted
   offset" / "File truncated" lines for the new worker; "Transcript path
   changed … resetting read offset" may appear if a pending binding
   hand-off happened (benign, one line).
5. The second worker's topic shows thinking/final text from its own turn
   within seconds of spawn — no multi-minute dead window.

### Offline tests for the race

```sh
~/.local/share/uv/tools/ccgram/bin/python \
    -m unittest discover -s ccgram-prototype/transcript-binding -v
```

The tests copy the installed package to a temp dir, apply the tracked
patch stack there, redirect HOME to a fixture reused session directory
containing only transcript A, and assert: SessionStart for B does not bind
A (hook + monitor level), B binds its own file once it appears with a
clean offset, a pre-seeded stale A→B binding resets without corruption or
replay, primary preservation is skipped for pi but intact for claude, and
the shim waits for the exact non-empty file and never returns a prior
tenant's transcript.

`apply` copies each pre-existing modified file to
`~/.ccgram-prototype/renderer-patch-backup/4.5.2/` before patching; if
`rollback` ever fails, restore those paths by hand. The script refuses to
touch any ccgram version other than 4.5.2 (set `CCGRAM_PATCH_FORCE=1` to
override after regenerating the patch) and refuses to patch a dirty tree.

Offline tests (no Telegram, no live state):

```sh
~/.local/share/uv/tools/ccgram/bin/python \
    -m unittest discover -s ccgram-prototype/pi-renderer -v
```

The tests copy the installed package to a temp dir, apply the tracked patch
stack there, and drive a synthetic JSONL turn (thinking + tool calls + final
text + error) through the real parser and the trace state machine with a fake
Telegram client. They also assert the low-noise behavior: the trace bubble is
sent with `disable_notification=True`, silent user-echo tasks send without
notification while the final answer still notifies, and silent/notifying
tasks never merge. Layer 4 adds liveness coverage: the header elapsed timer,
the `CCGRAM_PI_TRACE_*` knobs, mid-turn text folding into the bold goal line
(no separate message, no notification), ticker timer refresh with no new
steps, edit-throttle respect, idle-timeout bubble deletion, same-message
goal/thinking paraphrase dedupe (a line-14-style thinking+text paraphrase
renders once, as the goal; a divergent thinking+text pair keeps both), and
mobile wrap-aware rendering (long goal/step lines word-wrap with a hanging
indent that preserves the tree shape at the 36-char phone-safe width;
wrapping disabled at width 0).

### Live smoke plan (only when explicitly authorized)

Offline validation never touches Telegram. To smoke the low-noise behavior
live after applying the stack and restarting the service:

1. Confirm env: `grep -E 'HIDE_TOOL_CALLS|QUIET_PROGRESS|HIDE_THINKING|EPHEMERAL|PI_TRACE' ~/.config/ccgram-prototype.env`.
2. Let Firstmate dispatch one small worker task (or wait for the next one).
3. Expected in the worker's topic: the 👤 brief echo appears **without a
   notification**; the 🧠 thinking tree appears/updates **without a
   notification**; its header timer (`· 0:42`) visibly advances at ~1s
   cadence even while no new step arrives; mid-turn narration text shows up
   as the tree's bold `▸` goal line instead of a separate message; long
   goal/step lines wrap with a hanging indent that keeps the tree shape
   intact on a phone; no tool-call messages at all; the status bubble (if
   it appears) is silent; when the turn ends, the trace bubble is deleted
   and **exactly one final-answer message notifies**.
4. Kill a worker mid-turn (`herdr` pane kill or `kill -9` its pi process):
   the orphaned trace bubble is deleted within `CCGRAM_PI_TRACE_IDLE_SECS`
   (default 10 min) without a new turn.
5. `journalctl --user -u ccgram-prototype.service -f` shows no patch-related
   tracebacks and no `RetryAfter` over a soak turn.

### Low-noise notifications — final-answer-only (patch layer 2)

Captain preference: **while a Firstmate worker runs, nothing in its topic
notifies; when the turn completes, one normal final-answer message
notifies.** `patches/ccgram-4.5.2-low-noise-notifications.patch` (applied
by the same `pi-renderer-patch.sh`, on top of the renderer-parity layer)
plus env config implement that:

| Transcript element during a run | Behavior | Mechanism |
| ------------------------------- | -------- | --------- |
| Tool calls / results | **No message at all** | `CCGRAM_HIDE_TOOL_CALLS=true` (upstream config, no patch; `message_queue` drops `tool_use`/`tool_result` tasks before batching) |
| Thinking trace (tree bubble) | Visible, **silent on first send**, edited in place, deleted on final | Patch: `disable_notification=True` in `pi_live_transcript` |
| Mid-turn assistant text (`stopReason=toolUse`) | Folded into the tree as the bold goal line — **no separate message, no notification** | Layer 4 patch: `phase="pi-live-goal"` in `pi_format`, routed to `handle_pi_goal` |
| Status bubble ("working…") | Visible, **silent on first send**, edited in place, cleared on done | Patch + `CCGRAM_QUIET_PROGRESS=true`: `disable_notification` in `status_bubble.send_status_text` |
| User transcript echoes (Firstmate launch brief) | Visible (👤), **silent** | Patch + `CCGRAM_QUIET_PROGRESS=true`: `ContentTask.silent` flag, set in `message_routing` for `role="user"` |
| Final assistant answer | **Normal message — notifies** | Unchanged normal path |

Notes:

- Edits and deletes never notify in Telegram, so only first sends need
  the flag.
- The thinking trace is silent unconditionally (it is ephemeral by design);
  the status bubble and user echoes are gated on `CCGRAM_QUIET_PROGRESS`
  (default off upstream-style, set `true` in the prototype env).
- Silent and notifying content tasks never merge (`_can_merge_tasks`
  guard), so a silent user echo can never fold into — and mute — the
  final answer.
- Tool calls need no patch: `CCGRAM_HIDE_TOOL_CALLS=true` suppresses them
  in stock ccgram. Caveat: a per-window `/verbose` override
  (`shown`/`hidden`) beats the global default — don't set per-window
  overrides on worker topics.

### Thinking-tree liveness — closer to the frontdoor on mobile (patch layer 4)

`patches/ccgram-4.5.2-pi-thinking-tree-live.patch` closes the cheap
presentation gaps vs the `avirus` Firstmate Telegram frontdoor identified in
the tree-rendering audit (the token-streaming gap is structural — JSONL only
ever contains complete messages — and stays out of scope):

- **Live elapsed timer.** The trace header is `🧠 Thinking… · 0:42` and a
  per-trace background ticker re-renders the bubble at the edit cadence even
  when no new completed JSONL message has arrived, so the bubble always
  looks alive. The ticker stops when no traces remain; edits never notify.
- **1s edit cadence knob.** `CCGRAM_PI_TRACE_EDIT_SECS` (default `2.0`)
  controls the minimum gap between trace edits; the prototype env sets
  `1.0`, matching the frontdoor's coalescing interval.
- **Mid-turn text folds into the tree.** Assistant text blocks from Pi
  messages with `stopReason="toolUse"` are stamped `phase="pi-live-goal"`
  and update the tree's bold goal/top line (`▸ **…**`, markdown-stripped)
  instead of becoming separate — and notifying — progress messages. This
  also removes the last interim-notification gap: during a worker turn,
  only the final answer notifies.
- **Idle-timeout deletion.** If a turn dies mid-thinking (kill -9, network
  drop) and no final answer arrives, the stale bubble is deleted after
  `CCGRAM_PI_TRACE_IDLE_SECS` (default `600` = 10 minutes).
- **Same-message goal/thinking dedupe.** Some models emit a mid-turn
  visible text block that paraphrases their own thinking block in the same
  assistant message. `pi_format` compares the two blocks of each message
  and drops a thinking block whose first line near-duplicates the goal
  text (shared opening of 3+ words plus a shared 20+ char phrase), so the
  tree shows the statement once — as the bold goal line — instead of as
  adjacent goal + `├─` step twins. Thinking-only messages and genuinely
  distinct thinking+text messages keep both entries.
- **Mobile wrap-aware tree.** Goal and step lines are word-wrapped at
  `CCGRAM_PI_TRACE_WRAP_CHARS` columns (default `36`; Telegram mobile
  wraps by pixels in a proportional font and a phone bubble fits roughly
  35–44 Latin chars, so 36 keeps intentional breaks ahead of Telegram's
  own re-wrap — 48 was wider than a phone bubble and shattered the tree)
  with a hanging indent under the node prefix: a wrapped step continues aligned
  under its `├─` text column and a wrapped goal under its `▸` text column
  (bold per segment), so the tree shape survives Telegram's own line
  wrapping instead of breaking into ragged full-width lines. `0` disables
  intentional wrapping. The 120-char per-node caps still apply as the hard
  truncation ceiling above this soft wrap.

| Env knob | Default | Prototype setting | Meaning |
| -------- | ------- | ----------------- | ------- |
| `CCGRAM_PI_TRACE_EDIT_SECS` | `2.0` | `1.0` | Minimum seconds between trace-bubble edits (applies to step/goal updates and the timer ticker). |
| `CCGRAM_PI_TRACE_TICK_SECS` | `1.0` | unset | Liveness ticker period (timer refresh + idle sweep granularity). |
| `CCGRAM_PI_TRACE_IDLE_SECS` | `600` | unset | Delete a trace bubble with no thinking/goal activity for this long (killed-turn cleanup). |
| `CCGRAM_PI_TRACE_WRAP_CHARS` | `36` | unset | Soft word-wrap width (in characters) for goal/step lines, with hanging indent under the node prefix; `0` disables. |

### Remaining parity gaps (vs the Pi TUI)

- **No token streaming.** The JSONL only contains complete messages, so a
  long thinking block appears only when its assistant message completes;
  the timer ticker keeps the bubble visibly alive during those windows but
  cannot show new content. Closing this needs an upstream streaming event
  source (Pi-side partial entries or an attachable event subscription).
- **Step-granularity trace.** Pi writes an assistant message to the JSONL
  when that step finishes, so tree nodes appear per completed step, not
  token-by-token (same limitation the sidecar had; it matches the
  temporary-render goal).
- **Tool calls vanish rather than collapse.** In the Pi TUI, finished tool
  calls stay in scrollback as collapsed lines; ccgram's ephemeral batch
  deletes the bubble entirely on flush. Switch a window to `batched` mode
  (`/verbose`) if you prefer the collapsed-but-kept variant.

## Thinking sidecar (deprecated fallback)

> **Deprecated.** With the renderer-parity patch applied, the sidecar
> duplicates thinking output — **never run both**. It remains tracked (and
> its service remains unshipped-by-default) purely as a fallback for running
> an unpatched ccgram. New work should extend the patch, not the sidecar.

Rather than hot-patching the installed
uv tool (untracked, non-repeatable), the prototype ships a **tracked companion
sidecar** that needs no ccgram modification at all.

**Semantics** (what the captain asked for):

1. It reads ccgram's `state.json` (`chat_thread_bindings` + `window_states`) to
   map each bound Pi session transcript to its Telegram forum topic.
2. It tails each Pi session JSONL for `thinking` blocks. While the model is
   thinking, it keeps **one temporary message per topic** showing the trace as a
   compact tree — one `├─` node per thinking block (first line only, most recent
   steps last, overflow folded into `… (N earlier steps)`), ending in a
   `└─ ⏳ still thinking…` spinner.
3. New thinking steps **edit that same message in place**, rate-limited
   (`THINKING_SIDECAR_EDIT_MIN_SECS`, default 3s) — never a message per step.
4. When the **final assistant text response** lands (a text block with a
   terminal `stopReason` — not `toolUse`), the temporary message is **deleted**,
   leaving ccgram's own final answer in the topic. The same deletion happens on
   `stopReason: error` and after `THINKING_SIDECAR_IDLE_DELETE_SECS` (default
   600s) of transcript silence, so aborted turns never leave clutter behind.

Safety posture (unchanged, still observe-only):

- The sidecar never sends input to any session and never touches Herdr/Firstmate.
- It only calls `sendMessage` / `editMessageText` / `deleteMessage` — **never
  `getUpdates`** — so it does not conflict with ccgram's long poll on the shared
  prototype bot token.
- Posting is restricted to `CCGRAM_GROUP_ID` (the throwaway test group).
- It is stdlib-only Python; no new dependencies, no ccgram patch.

### Activate the fallback (only when the renderer patch is NOT applied)

```sh
cd ~/dotfiles && stow ccgram-prototype   # deploys ~/.local/bin/ccgram-thinking-sidecar + unit
systemctl --user daemon-reload
systemctl --user enable --now ccgram-thinking-sidecar.service
journalctl --user -u ccgram-thinking-sidecar.service -f
```

The sidecar reuses `~/.config/ccgram-prototype.env` (`TELEGRAM_BOT_TOKEN`,
`CCGRAM_GROUP_ID`); no new secrets. Optional tuning vars
(`THINKING_SIDECAR_POLL_SECS`, `THINKING_SIDECAR_EDIT_MIN_SECS`,
`THINKING_SIDECAR_IDLE_DELETE_SECS`, `THINKING_SIDECAR_MAX_STEPS`) can be added
to that env file; see the `.example`.

### Validate without Telegram

```sh
# Unit tests (offline fixtures only):
python3 -m unittest discover -s ccgram-prototype/thinking-sidecar -v

# Dry-run harness — prints the send/edit/delete calls it WOULD make against the
# live ccgram state dir, without calling the Bot API or writing any state:
~/.local/bin/ccgram-thinking-sidecar --dry-run --once --replay --edit-min-secs 0
```

### Deactivate / rollback (sidecar only)

```sh
systemctl --user disable --now ccgram-thinking-sidecar.service
rm -f ~/.ccgram-prototype/thinking-sidecar-state.json
cd ~/dotfiles && stow -D ccgram-prototype && stow ccgram-prototype  # or leave deployed, disabled
```

Known limitation: Pi writes an assistant message to the JSONL when that step
finishes, so a thinking node appears when its step completes rather than
letter-by-letter while the model generates it. The tree is therefore a
step-granularity live trace, which matches the temporary-render goal.

## Rollback — deleting the prototype

Everything is scoped to one stow package plus two local paths:

```sh
# 1. Stop and remove the service
systemctl --user disable --now ccgram-prototype.service
systemctl --user daemon-reload

# 1b. If the renderer patch was applied, reverse it first
./ccgram-prototype/pi-renderer-patch.sh rollback

# 2. Unstow (removes the unit + env example symlinks from ~)
cd ~/dotfiles && stow -D ccgram-prototype

# 3. Remove local state and secrets
systemctl --user disable --now ccgram-thinking-sidecar.service 2>/dev/null || true
rm -rf ~/.ccgram-prototype
rm -f ~/.config/ccgram-prototype.env

# 4. Remove tracked material
git rm -r ccgram-prototype && git commit -m "Remove ccgram prototype"

# 5. Optional: Telegram cleanup — @BotFather /deletebot, delete the test group
# 6. Optional: uv tool uninstall ccgram
```

## Validation

Offline checks only (no live services touched):

```sh
./ccgram-prototype/validate.sh
```

Verifies the systemd units parse (`systemd-analyze verify`), the thinking
sidecar compiles and its unit tests pass, the patch stack is in a consistent
state (`pi-renderer-patch.sh check`) and its offline fixture tests pass
against a patched temp copy of the installed tool, and that no real
tokens/chat IDs are committed in this package.

## Known limitations (from the scout report)

- ccgram has no observe-only mode — safety is policy (rule 1), not enforcement.
- ccgram auto-adopts every Herdr agent in the session; unrelated sessions get topics too.
- Pi session rotation (`/new`, resume) can make a worker look like a "new window" and
  spawn a duplicate topic; the old one goes dead. Cosmetic for observe-only.
- If homelab Herdr is upgraded past protocol 17/19, re-check ccgram compatibility before
  restarting the service.
