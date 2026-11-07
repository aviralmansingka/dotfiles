# iPhone walkie-talkie shortcut (voice → agent)

A tap-free voice note path. Press the Action Button, speak, pause, and the
transcript reaches the existing Telegram pipeline. No app, no TestFlight, and no
audio upload, because speech becomes text on the phone.

## Why dictation and not recording

`Record Audio` stops on a screen tap, so it can never be tap-free. `Dictate
Text` has a `Stop Listening` option of **After Pause**, so speech ends on
silence.

Apple gives no press/release edge to Shortcuts or to third-party apps, and
`AVCaptureEventInteraction` is camera-only. A custom app cannot recover the hold
gesture, so an app buys nothing here.

## Wire contract

The shortcut posts a multipart form to the endpoint the daemon already serves.
One field is new: `text`. It skips the audio path, so no transcription runs.

```
POST http://avirals-macbook-pro.tail1b3b66.ts.net:8766/shortcut-audio
Content-Type: multipart/form-data

token = <PI_TELEGRAM_SHORTCUT_TOKEN>
text  = <dictated speech>
```

Reply arrives at once as `200 {"ok": true, "chars": N}`. The agent's answer
goes to Telegram, as a voice note does today.

The daemon side: `ShortcutHandler.do_POST` reads `text` first, strips C0/C1
control bytes, and hands the words to `handle_shortcut_text`, which asks the
agent and replies over Telegram. An empty or whitespace-only dictation gets
`400` and never reaches the agent.

## Build the shortcut on the phone

Name it `Walkie`. Four actions.

1. **Dictate Text**
   - Language: English.
   - Stop Listening: **After Pause**. This is the tap-free setting.
2. **If** `Dictated Text` **has any value** — otherwise `Stop This Shortcut`.
3. **Get Contents of URL**
   - URL: `http://avirals-macbook-pro.tail1b3b66.ts.net:8766/shortcut-audio`
   - Method: **POST**
   - Request Body: **Form**
     - `token` (Text) = the shortcut token from `~/.config/pi-telegram.env`
     - `text` (Text) = the `Dictated Text` variable
4. **Show Notification** only when the request failed, so a good note stays
   silent. Set its body to `Contents of URL`.

Then bind the hardware button: Settings → Action Button → **Shortcut** →
`Walkie`. No confirmation dialog follows. The trigger is a press-and-hold of
about one second, and it fires from the lock screen.

## Verify before you trust it

1. **Locked, screen off.** Lock the phone, hold the Action Button, say one
   sentence, pause. The reply must appear in Telegram. This is the load-bearing
   test: iOS 18 restricts some shortcut actions while locked, and network
   requests can be refused in that state.
2. **Pause length.** Speak with a natural mid-sentence pause and confirm the
   text is not cut in two. If it is, dictate in shorter bursts.
3. **Daemon is live.** `journalctl --user -u pi-telegram.service -f` shows
   `shortcut http: ... "POST /shortcut-audio"` for each note.

If check 1 fails, fall back to a Siri phrase: "Hey Siri, run Walkie". Siri runs
non-privileged actions while locked.

## Where the note lands

Both halves run on the homelab, so a note never crosses to the Mac:

- `pi-telegram.service` serves the endpoint at `100.113.153.49:8766`.
- `rex.service` owns the `walkie` session, whose pane runs `pi`.
- `PI_TELEGRAM_SHORTCUT_REX_SESSION=walkie` turns the Telegram answer into a
  pane write: the note is collapsed to one line, typed with `rex send`, and
  submitted with `rex send-key enter`.

Unset that variable and the note goes back to the bot answer in Telegram. The
phone needs no change either way; both paths use the same URL and token.

```sh
ssh homelab 'rex capture -s walkie --trim | tail -20'   # read the answer
```

Two open items: `just deploy remote homelab` fails with `cannot connect to
socket at /nix/var/nix/daemon-socket/socket: Permission denied`, so the key is
live through the `pi-telegram.service.d/10-walkie.conf` drop-in rather than the
sops env. The sops ciphertext already carries it; remove the drop-in once the
deploy works. And confirm the `walkie` session survives a rex restart, or
recreate it:

```sh
ssh homelab 'rex new walkie -- pi'
```
