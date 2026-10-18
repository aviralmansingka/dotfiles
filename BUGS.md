# Known Bugs

## Herdr pane tty sever makes pi an input-dead zombie (closed 2026-10-17)

Symptom: after a heavy mid-turn render (observed three times immediately
after a mermaid display row; the user reported it as "after mermaid renders,
the input to the pi prompt is completely unresponsive"), a pi pane in Herdr
stops accepting input while the pane keeps showing content and the pi
process stays alive at 0% CPU.

Root cause (reproduced on herdr 0.9.3 with pi 1.2.0 and 1.3.0; still
unfixed in herdr 0.9.4/0.9.5): something in Herdr resets the pane's tty to
cooked mode (a `stty sane`-shaped flip: icanon isig iexten echo on) and a
Ctrl+D byte then hits the pane program as VEOF — stdin read returns EOF.
The pty master stays open and the pane stays connected, so nothing else
dies: pi receives SIGHUP (caught by pi's handler; its graceful shutdown
never completes — upstream pi defect) and stdin 'end' (node auto-destroys
the stream: `destroyed:true, ended:true, err:null`). The result is a
zombie: alive, deaf forever, and keystrokes now kernel-echo (the reset
turned echo on) without reaching any reader. `herdr pane send-keys ctrl+d`
on a raw tty is a different, clean exit path (verified) — not this bug.

Mermaid is exonerated: the identical display row in a plain pty never
reproduces (five runs), and one same-shape Herdr run survived — the trigger
is the Herdr-side race, with the diagram merely the last visible artifact
of the turns where it fired.

Fix shipped: `pi/.pi/agent/extensions/stdin-reattach.ts` — on tty stdin
EOF it re-opens the pane's tty path, restores raw mode (defusing further
Ctrl+D EOFs), feeds the bytes into pi's own StdinBuffer pipeline, patches
process.stdout/stderr onto the fresh fds, re-negotiates terminal modes,
and forces a full repaint. End-to-end against the reproduced zombie: pi
stays alive, the pane repaints, and a message typed after the sever is
submitted to the model — the session continues with no manual resume. Only
when no tty can be re-opened (a real pane close) does it exit 129 as a last
resort. The old exit-only guard (`stdin-death-guard.ts`) was superseded
and removed.

Still worth reporting upstream: Herdr's mid-session tty reset + Ctrl+D
severance race, and pi's SIGHUP graceful shutdown hanging on a dead tty.

No other open issues currently.

Neovide's two open issues (background-color inconsistency, intermittent
OSC52 clipboard errors) were closed by removing Neovide entirely — the
cask, the `nvim/.config/nvim/lua/plugins/neovide.lua` spec, and its BUGS
entries — in the dead-code cleanup. The fixed signature-help duplicate
(noice handler disabled; blink.cmp is the sole provider) lives on in
`nvim/.config/nvim/lua/plugins/noice.lua` and in git history.
