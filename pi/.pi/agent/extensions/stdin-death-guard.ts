import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ────────────────────────────────────────────────────────────────────────
// stdin-death guard — exit cleanly when the pane's pty is severed.
//
// What this guards against (reproduced 2026-10-17, herdr 0.9.3, pi 1.2.0
// and 1.3.0): under load around heavy mid-turn redraws (observed three
// times right after a mermaid display row; a race — the same shape also
// survives), herdr silently closes and reopens a pane's pty, reusing the
// same device pair, without respawning the pane process and without any
// server-log trace. The pane's pi process then:
//   1. receives SIGHUP — pi's handler starts a graceful shutdown that
//      never completes (cause unknown, upstream pi issue), and
//   2. gets EOF on its still-open slave fd — node emits stdin 'end' and
//      auto-destroys the stream: `destroyed:true, ended:true, err:null`.
// The result is a zombie: the process lives at 0% CPU with input dead
// forever while herdr keeps routing keystrokes into the new pty that no
// one reads. The pane shows frozen pixels; "the input to the pi prompt is
// completely unresponsive" — the modal-workspace incident.
//
// A TUI whose stdin hit EOF can never receive input again, so the only
// correct move is to exit. process.exit(129) mirrors pi's own
// emergencyTerminalExit code for dead terminals; herdr then reaps the
// pane cleanly and the durable session resumes without a zombie.
//
// Arms only when stdin is a real tty (interactive TUI mode). rpc, json,
// and print modes pipe stdin, where EOF is normal completion.
// ────────────────────────────────────────────────────────────────────────

const EXIT_CODE = 129;
const ARMED_KEY = Symbol.for("pi-extensions/stdin-death-guard");

export default function stdinDeathGuard(pi: ExtensionAPI) {
	if (!process.stdin.isTTY) return;
	// Extension reloads re-run this module; arm once per process.
	if ((globalThis as Record<symbol, unknown>)[ARMED_KEY]) return;
	(globalThis as Record<symbol, unknown>)[ARMED_KEY] = true;

	let exiting = false;
	const die = (reason: string) => {
		if (exiting) return;
		exiting = true;
		try {
			pi.appendEntry?.("stdin_eof_exit", {
				reason,
				pid: process.pid,
				timestamp: new Date().toISOString(),
			});
		} catch {
			// Best-effort record; the exit below is the guarantee.
		}
		try {
			process.stderr.write(
				`\npi: stdin EOF (${reason}) — the pane's pty was closed or replaced. Exiting.\n`,
			);
		} catch {
			// The pty may already reject writes.
		}
		process.exit(EXIT_CODE);
	};

	process.stdin.once("end", () => die("end"));
	process.stdin.once("close", () => die("close"));
}
