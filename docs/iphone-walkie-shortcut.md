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

## Later: send to rex instead

The same shortcut can reach a rex session later. Swap the URL for a second
target and replace the Telegram reply with a pane write:

```sh
printf '%s' "$text" | rex send -b "$BLOCK" && rex send-key -b "$BLOCK" enter
```

The sanitising and token rules stay the same. One shortcut, two destinations.
