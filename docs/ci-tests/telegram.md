# telegram — CI test doc

## Purpose

This suite guards `pi/bin/pi-telegram-daemon.py`. The daemon sends Telegram
messages to a pi RPC session and sends the replies back. The tests are
offline and deterministic. They mock the Telegram API and inject clocks for
timers.

## What the suite covers

- Mention gating. `fetch_bot_identity` reads the bot id and name from a
  mocked `getMe`. `message_mentions_bot` matches a mention entity, a text
  mention, and a command with a bot name. `is_reply_to_bot` matches a reply
  to the bot id. `should_handle` gates group chats: a group message without
  a mention or reply gets no answer. A bot sender never gets an answer. This
  stops two bots in one group from answering in a loop. Mention offsets use
  UTF-16, including after emoji. DMs have no gate. `strip_bot_mention` removes
  the mention. A message with only a mention becomes `status`.
- Image download. The size check runs three times: message metadata,
  `getFile`, and downloaded bytes. A lying or absent size cannot pass a too
  large image. An unsafe suffix falls back to a safe one from `mimetypes`.
- Image file life cycle. The main loop keeps the temp image file until
  `pi.ask` returns, then deletes it. This holds on success and on error.
  The tests drive the real main loop with mocked inputs.
- `scan_session`. The label drops the daemon bridge header for a command, a
  voice note, and an image. The tests check the cwd, the session name, the
  stem fallback, and the 400-line limit.
- Env key parity. Every `PI_TELEGRAM_*` key the daemon reads appears in
  `pi/.config/pi-telegram.env.example`. A commented key with a literal value
  must match the daemon default. The test parses both files and fails on
  drift.
- Supervisor loops. The typing ticker keeps ticking when every Telegram
  call fails. `StatusMessenger` holds a change while the edit throttle is
  hot, then sends one edit with all held changes when the throttle cools. A
  failed edit does not stop the messenger. The main loop restarts after an
  error in one tick, and it records the backoff sleep on a fake clock.
  Earlier tests for `TraceBuilder`, `StatusMessenger`, and `PiRPC.ask` stay.
- Temporary tool titles. The tests check title order, status marks, and the
  RPC title channel. Untitled calls never show a tool name. A connector joins
  each available result summary to its title. A result line is at most 28
  UTF-16 units, including `└─ `. Long summaries are omitted, not cut. The
  tests check early and late titles, stale events, and title priority. The
  last status mark shows before the message is deleted. Polling also receives
  callbacks from old buttons.
- Shortcut relay. When a Telethon listener is passed to the endpoint, a
  shortcut note is transcoded to OGG/Opus (when `ffmpeg` is present) and
  uploaded into the relay chat as a voice bubble, and the direct answer path is
  skipped. `voice_note_path` keeps an already-OGG note, returns None without
  `ffmpeg` or on a failed transcode, and always removes its temp copy. A
  rejected voice bubble is retried once as a plain file. The relay chat is
  `PI_TELEGRAM_TELETHON_RELAY_CHAT` (empty: follow `PI_TELEGRAM_TELETHON_CHAT`).
  `PI_TELEGRAM_TELETHON_RELAY_ANSWER=bot` skips the inline answer, because the
  bot path answers the note in the chat that received it; `inline` keeps the
  relay answering. A failed upload falls back to the direct answer, so the
  Action Button still works while the session is unauthorised.
- Reply rendering. The reply filter removes suggested follow-up sections.
  It keeps later sections, code fences, and needed questions. Rich Messages
  use Markdown and keep the reply target. The daemon escapes raw HTML and
  Markdown media. If code may contain these, it uses standard HTML instead.
  This keeps literal code unchanged. A 400 or 404 response also uses standard
  HTML. A rejected HTML message uses plain text. Long replies use standard
  chunks. The chunk limit counts UTF-16 units. Network, rate-limit, and server
  errors do not trigger a retry. The main loop and shortcut path do not send
  an error message after an uncertain delivery.
- Session switch. `handle_switch` picks a session by number or by name. It
  reports an error, an out-of-range number, and an ambiguous name.
- Voice guards. The provider matrix resolves `auto`, `command`, `openai`,
  and `none`. A voice note without a provider fails with a clear error. The
  command provider substitutes the file and mime placeholders. A shortcut
  reply needs exactly one numeric private chat in the allowlist.
- Shortcut dictation. A `text` form field skips the audio path and the
  transcription hook. Control bytes are stripped and a blank field is `400`.
  With `PI_TELEGRAM_SHORTCUT_REX_SESSION` set, the note is collapsed to one
  line, typed into the rex pane with `rex send`, and submitted with
  `rex send-key enter`; the block comes from the pinned value or the session's
  first block. A non-zero rex exit surfaces as a Telegram error. The endpoint
  retries a failed bind, because a pinned Tailscale address can be absent when
  the unit starts. The endpoint takes a multipart body and an
  `application/x-www-form-urlencoded` body, because Shortcuts sends the
  urlencoded one when every field is plain text. Any other Content-Type, such
  as `application/json`, is `400` and runs nothing. A post with no usable field
  logs each field name and size, never a value.
- Telethon listener. Settings are off without credentials, and a half pair or a
  non-numeric api_id is an operator error; an unknown relay answer mode is too.
  The listener registers exactly one `NewMessage` handler restricted to the
  configured chat (default `me`, Saved Messages). Messages the session sent
  itself (`event.out`) are ignored, so the relay never answers its own upload. An
  unauthorised session logs the `--telethon-login` hint and does
  not retry; a failed connect retries until the listener is stopped. A voice
  note is downloaded to a temp file, answered through `answer_voice_note`, and
  the temp file is removed. Text notes (our own replies) are ignored. Failures
  answer in the same chat. Long replies are chunked, and each chunk is sent as
  Telegram HTML. The ready line prints `chat`, `relay_chat` and `relay_answer`.
  The login helper authorises the session file and reports
  missing credentials without touching the network. The main loop starts the
  listener next to the shortcut endpoint.
- Pi 1.5 RPC. A handled extension command does not wait for `agent_settled`
  or return an earlier assistant reply.

## How to run

Run the suite from the repo root. It needs no bot token and no network:

```sh
uv run --with coverage coverage run -m unittest discover -s pi/bin \
  -p 'test_pi_telegram_daemon.py'
uv run --with coverage coverage report \
  --include='pi/bin/pi-telegram-daemon.py'
```

## Runtime and SLA

The suite runs about 200 tests in 3 s on a laptop. One timeout test waits
1 s. The full run stays under 30 s. CI may run it in the scripts job.

## Coverage result

Coverage of `pi-telegram-daemon.py` is 78 percent. It was 57 percent before
this work. The new tests cover the mention gate, the image path, the main
loop, `scan_session`, the status life cycle, reply rendering, the shortcut
relay, and the Telethon listener.

## Known gaps

- The tests mock `urllib`; they do not test a live Telegram API or client.
- `PiRPC` subprocess plumbing stays untested. It starts a real pi process.
- The OpenAI voice upload path stays untested. It needs a live API key.
- The main loop branches for `reset`, `chats`, and `switch` commands have
  no direct test.
- The Telethon listener runs against a fake client. A real user-session login
  and a live shortcut note are provisioning checks, not unit tests. The live
  check is one Action Button press followed by
  `journalctl --user -u pi-telegram.service | grep "Voice note relayed"`, which
  prints the chat, the message id, and `voice=yes`.
