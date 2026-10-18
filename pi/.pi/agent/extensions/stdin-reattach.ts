import { closeSync, constants as fsConstants, fstatSync, openSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import tty from "node:tty";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ────────────────────────────────────────────────────────────────────────
// stdin-reattach — survive a Herdr pane pty swap instead of dying.
//
// Herdr 0.9.3 (still unfixed in 0.9.4/0.9.5) can silently close and reopen
// a pane's pty around heavy mid-turn redraws: the device pair is reused,
// the pane process is not respawned, and nothing is logged. The pane's pi
// then gets SIGHUP plus stdin EOF and would otherwise become an input-dead
// zombie while Herdr keeps routing keystrokes into the new pty that no one
// reads (see BUGS.md, "mermaid stuck input" incident).
//
// This extension watches for that moment and re-attaches in place:
//   1. re-open the pane's tty path — after the swap it is the NEW pty's
//      slave (verified: keystrokes routed by Herdr are readable from it);
//   2. read it with a fresh tty.ReadStream and feed the bytes into the
//      ProcessTerminal's StdinBuffer — pi's full parsing pipeline, so
//      negotiation replies, paste, and key handling all keep working;
//   3. redirect process.stdout/stderr writes to the new tty and forward
//      resize events, so renders reach the pane again;
//   4. re-send the terminal mode queries (bracketed paste, kitty keyboard,
//      DA1) — the replies flow back through the new reader and re-run
//      pi's own negotiation handlers;
//   5. force a full repaint so diff-rendering resyncs to the new surface.
// SIGHUP is neutralized during recovery (the pane is not really gone); if
// no new pty appears — a real pane close — pi exits 129 as a last resort,
// because a TUI can never receive input again. Arms only when stdin is a
// real tty; rpc/json/print modes pipe stdin and are untouched.
// ────────────────────────────────────────────────────────────────────────

const ARMED = Symbol.for("pi-extensions/stdin-reattach");
const EXIT_CODE = 129;
const OPEN_RETRY_MS = 50;
const OPEN_RETRY_TOTAL_MS = 3000;

export default function stdinReattach(pi: ExtensionAPI) {
	if (!process.stdin.isTTY) return;
	if ((globalThis as Record<symbol, unknown>)[ARMED]) return;
	(globalThis as Record<symbol, unknown>)[ARMED] = true;

	// The pane's tty path is stable across severs: the device keeps its name.
	// Captured while the original tty is alive. Linux resolves /dev/fd/0 via
	// procfs symlinks. macOS /dev/fd is a synthetic fdesc mount (readlink:
	// EINVAL), so derive the name from fstat(0): a tty slave has major 16 and
	// minor N mapped to /dev/ttysNNN. Last resort: the `tty` command with
	// inherited stdin. Note: node:fs no longer exports execFileSync (node 26);
	// it lives on node:child_process.
	const ttyName = (): string | undefined => {
		try {
			const link = readlinkSync("/dev/fd/0");
			if (link.startsWith("/dev/")) return link;
		} catch {
			// macOS fdesc: EINVAL — try the next method.
		}
		try {
			const st = fstatSync(0);
			if (st.isCharacterDevice?.()) {
				const rdev = (st as unknown as { rdev: number }).rdev >>> 0;
				const major = rdev >>> 24;
				const minor = rdev & 0xffffff;
				if (major === 16) return `/dev/ttys${String(minor).padStart(3, "0")}`;
			}
		} catch {
			// fstat unavailable — try the command below.
		}
		try {
			const out = execFileSync("tty", [], { stdio: ["inherit", "pipe", "pipe"] })
				.toString()
				.trim();
			if (out.startsWith("/dev/")) return out;
		} catch {
			// No tty name available; recovery falls back to a clean exit.
		}
		return undefined;
	};
	let ttyPath: string | undefined = ttyName();

	let tuiRef: { requestRender: (force?: boolean) => void; terminal?: any } | undefined;
	let recovering = false;
	let generation = 0;

	const note = (detail: Record<string, unknown>) => {
		try {
			pi.appendEntry?.("stdin_reattach", {
				pid: process.pid,
				timestamp: new Date().toISOString(),
				ttyPath,
				...detail,
			});
		} catch {
			// Best-effort record.
		}
	};

	const sleepMs = (ms: number) => {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	};

	/** Open the pane tty path, retrying briefly until the pty accepts opens. */
	let lastOpenError: string | undefined;
	const openNewSlave = (flags: number): number | undefined => {
		if (!ttyPath) return undefined;
		const deadline = Date.now() + OPEN_RETRY_TOTAL_MS;
		for (;;) {
			try {
				const fd = openSync(ttyPath, flags);
				if (tty.isatty(fd)) return fd;
				closeSync(fd);
				lastOpenError = "opened path is not a tty";
				return undefined;
			} catch (err: any) {
				lastOpenError = String(err?.code ?? err?.message ?? err);
				// ENXIO until a replacement master is open; keep retrying.
			}
			if (Date.now() >= deadline) return undefined;
			sleepMs(OPEN_RETRY_MS);
		}
	};

	const patchOutputStream = (stream: NodeJS.WriteStream, newFd: number) => {
		const target = new tty.WriteStream(newFd);
		const wrapped = stream as unknown as Record<string, unknown>;
		wrapped.write = (...args: unknown[]) =>
			(target as unknown as { write: (...a: unknown[]) => boolean }).write(...args);
		for (const dim of ["columns", "rows"] as const) {
			try {
				Object.defineProperty(stream, dim, {
					get: () => (target as unknown as Record<string, number>)[dim],
					configurable: true,
				});
			} catch {
				// Getter already configurable elsewhere; sizes may go stale.
			}
		}
		// The TUI's resize handler listens on the original stdout object.
		target.on("resize", () => stream.emit("resize"));
		return target;
	};

	const attachReader = (gen: number) => {
		const fd = openNewSlave(fs_O_RDONLY | fs_O_NONBLOCK);
		if (fd === undefined) return undefined;
		const stream = new tty.ReadStream(fd);
		stream.setRawMode(true);
		stream.resume();
		stream.on("data", (data: Buffer) => {
			if (gen !== generation) return;
			const stdinBuffer = tuiRef?.terminal?.stdinBuffer;
			if (stdinBuffer) {
				// pi's own parser: StdinBuffer → negotiation → input handler.
				stdinBuffer.process(data);
			} else {
				trace(`no stdinBuffer; ${data.length}B dropped`);
			}
		});
		stream.once("end", () => {
			if (gen === generation) recover("sever-again");
		});
		stream.once("close", () => {
			if (gen === generation) recover("sever-again");
		});
		return stream;
	};

	const recover = (trigger: string) => {
		if (recovering) return;
		recovering = true;
		const trace = (msg: string) => {
			try {
				process.stderr.write(`stdin-reattach: ${msg}\n`);
			} catch {
				// The pty may already reject writes.
			}
		};
		try {
			trace(`trigger=${trigger} ttyPath=${ttyPath ?? "none"}`);
			// Whatever fired first, drop every SIGHUP listener — pi's graceful
			// shutdown must not run: the pane is not really gone.
			try {
				process.removeAllListeners("SIGHUP");
			} catch {
				// Listener removal is best-effort.
			}
			generation += 1;
			const gen = generation;

			const writeFd = openNewSlave(fs_O_WRONLY | fs_O_NONBLOCK);
			trace(`writeFd=${writeFd ?? "none"} err=${lastOpenError ?? "-"}`);
			const reader = writeFd !== undefined ? attachReader(gen) : undefined;
			trace(`reader=${reader ? "ok" : "none"}`);
			if (writeFd === undefined || reader === undefined) {
				note({ trigger, outcome: "no-replacement-pty", lastOpenError });
				trace(`giving up: no replacement pty (${lastOpenError ?? "no path"})`);
				// A real close: no new pty ever appears. A TUI without a tty
				// can never take input again; exit cleanly as the last resort.
				process.exit(EXIT_CODE);
			}
			patchOutputStream(process.stdout, writeFd);
			try {
				const errFd = openNewSlave(fs_O_WRONLY | fs_O_NONBLOCK);
				if (errFd !== undefined) patchOutputStream(process.stderr, errFd);
			} catch {
				// stderr redirection is best-effort.
			}
			// Re-arm SIGHUP in case Herdr swaps the pty again.
			try {
				process.prependListener("SIGHUP", onSighup);
			} catch {
				// Signal handling from here on is the reader's 'end' path.
			}

			// Terminal modes on the fresh emulator: bracketed paste on, and
			// pi's startup queries so the negotiation handlers re-run through
			// the new reader (kitty flags, DA1, program status).
			try {
				process.stdout.write("\x1b[?2004h");
				process.stdout.write("\x1b[>7u\x1b[?u\x1b[c");
			} catch {
				// The fresh pty accepts writes; ignore transient failures.
			}

			// Full repaint: resets the diff-render state for the new surface.
			try {
				tuiRef?.requestRender?.(true);
			} catch {
				// Repaint happens on the next input or resize anyway.
			}
			note({ trigger, outcome: "reattached" });
			trace("reattached");
		} catch (err: any) {
			trace(`recovery error: ${String(err?.stack ?? err)}`);
			note({ trigger, outcome: "recovery-error", error: String(err?.message ?? err) });
			process.exit(EXIT_CODE);
		} finally {
			recovering = false;
		}
	};

	const onSighup = () => recover("sighup");
	try {
		process.prependListener("SIGHUP", onSighup);
	} catch {
		// Without signal access the stdin 'end' path still recovers.
	}
	process.stdin.once("end", () => recover("stdin-end"));
	process.stdin.once("close", () => recover("stdin-close"));

	// Capture the TUI reference (and with it the ProcessTerminal) through a
	// zero-height widget factory; the first render runs it. An empty Text
	// renders zero rows, so nothing visible changes.
	const captureUi = (ctx: { ui?: { setWidget?: (key: string, content: unknown) => void } }) => {
		try {
			ctx.ui?.setWidget?.("stdin-reattach", (_tui: unknown, _theme: unknown) => {
				tuiRef = _tui as typeof tuiRef;
				return new Text("", 0, 0);
			});
		} catch {
			// Without the tui reference, output is redirected and the exit
			// fallback still applies; input forwarding is the loss.
		}
	};
	pi.on("session_start", (_event: unknown, ctx: unknown) => captureUi(ctx as Parameters<typeof captureUi>[0]));
	pi.on("agent_start", (_event: unknown, ctx: unknown) => captureUi(ctx as Parameters<typeof captureUi>[0]));
}

// POSIX open flags via fs.constants (O_RDONLY/O_WRONLY/O_NONBLOCK).
const fs_O_RDONLY = fsConstants.O_RDONLY;
const fs_O_WRONLY = fsConstants.O_WRONLY;
const fs_O_NONBLOCK = fsConstants.O_NONBLOCK;
