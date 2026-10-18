# Known Bugs

## Herdr pane pty sever makes pi an input-dead zombie (closed 2026-10-17)

Symptom: after a heavy mid-turn render (observed three times immediately
after a mermaid display row; the user reported it as "after mermaid renders,
the input to the pi prompt is completely unresponsive"), a pi pane in Herdr
stops accepting input while the pane keeps showing frozen pixels and the pi
process stays alive at 0% CPU.

Root cause (reproduced on herdr 0.9.3 with pi 1.2.0 and 1.3.0): under a
race around heavy pane redraws, herdr silently closes and reopens the pane's
pty — the device pair is reused, the pane process is not respawned, and the
server log records nothing. The pane's pi process then receives SIGHUP
(caught by pi's handler; its graceful shutdown never completes — upstream
pi defect) and EOF on its still-open slave fd. Node emits stdin `end` and
auto-destroys the stream (`destroyed:true, ended:true, err:null`), so
input is dead forever while herdr keeps routing keystrokes into the new pty
that nothing reads. Measured: a raw `^D` in raw mode is data, not EOF; a
full master close alone kills via SIGHUP; master close with the signal
handled yields exactly the observed silent-EOF zombie.

Mermaid is exonerated: the identical display row in a plain pty never
reproduces (five runs), and one same-shape Herdr run survived — the trigger
is the herdr race, with the diagram merely the last visible artifact of the
turns where it fired.

Fix shipped: `pi/.pi/agent/extensions/stdin-death-guard.ts` — a TUI cannot
receive input after stdin EOF, so the guard exits pi with code 129 (mirroring
pi's own emergency terminal exit) and records a `stdin_eof_exit` session
entry. Without the guard pi zombies indefinitely (verified 6 s+); with it,
pi exits in 0.11 s and herdr reaps the pane cleanly.

Still worth reporting upstream: herdr's silent pty close/reopen race, and
pi's SIGHUP graceful shutdown hanging on a dead pty.

No other open issues currently.

Neovide's two open issues (background-color inconsistency, intermittent
OSC52 clipboard errors) were closed by removing Neovide entirely — the
cask, the `nvim/.config/nvim/lua/plugins/neovide.lua` spec, and its BUGS
entries — in the dead-code cleanup. The fixed signature-help duplicate
(noice handler disabled; blink.cmp is the sole provider) lives on in
`nvim/.config/nvim/lua/plugins/noice.lua` and in git history.
