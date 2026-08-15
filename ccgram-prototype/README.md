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
| `.config/systemd/user/ccgram-thinking-sidecar.service` | User unit for the thinking sidecar (see below). Deployed by stow; **not enabled by default**. |
| `.local/bin/ccgram-thinking-sidecar` | Stdlib-only Python sidecar: temporary tree-style Pi thinking traces in topics. Deployed by stow to `~/.local/bin`. |
| `.config/ccgram-prototype.env.example` | Env template (multiplexer, status mode, autoclose, placeholders for secrets, optional sidecar tuning). |
| `thinking-sidecar/` | Sidecar unit tests + JSONL/state fixtures. Not deployed by stow. |
| `validate.sh` | Offline checks: systemd unit syntax + sidecar unit tests + no committed secrets. Not deployed by stow. |
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

## Thinking sidecar — temporary Pi thinking traces

ccgram 4.5.2's Pi formatter (`ccgram/providers/pi_format.py` in the installed uv
tool) parses `text` and `toolCall` blocks but silently drops `thinking` blocks,
so Pi reasoning never reaches the topics. Rather than hot-patching the installed
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

### Activate (after the base prototype from steps 1–6 is running)

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
sidecar compiles and its unit tests pass, and that no real tokens/chat IDs are
committed in this package.

## Known limitations (from the scout report)

- ccgram has no observe-only mode — safety is policy (rule 1), not enforcement.
- ccgram auto-adopts every Herdr agent in the session; unrelated sessions get topics too.
- Pi session rotation (`/new`, resume) can make a worker look like a "new window" and
  spawn a duplicate topic; the old one goes dead. Cosmetic for observe-only.
- If homelab Herdr is upgraded past protocol 17/19, re-check ccgram compatibility before
  restarting the service.
