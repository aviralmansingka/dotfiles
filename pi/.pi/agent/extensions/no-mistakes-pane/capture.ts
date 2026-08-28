// Pure helpers for running a `no-mistakes axi` command and capturing its
// structured TOON stdout back to the agent, with two pane modes:
//
//  - TEXT pane (status/logs/sync/abort, and fallback): `buildPaneScript` runs
//    `no-mistakes axi <args>` IN the visible Herdr pane. stdout (the TOON) is
//    teed to a temp file between START/END markers while stderr (progress)
//    streams live to the terminal. The captain watches the raw axi text.
//
//  - TUI pane (run/respond): `buildBackgroundScript` runs `no-mistakes axi
//    <args>` detached in the BACKGROUND, capturing the TOON to the same marked
//    temp file (stderr → a separate log file). `buildAttachScript` runs
//    `no-mistakes attach` in the visible pane, retrying until the background
//    run is active, so the captain watches the rich no-mistakes TUI of that
//    same daemon run. The agent still reads the marked TOON to drive the gate.
//
// `no-mistakes axi run` and `no-mistakes attach` are two views of one daemon
// run: axi drives it (and streams TOON), attach renders its interactive TUI.
// attach is read-only with respect to the daemon, so retrying it during the
// startup race is daemon-safe.
//
// These functions are split out so they can be unit-tested without a live
// Herdr or no-mistakes daemon (see no-mistakes-pane.test.mjs).

/** Default wall-clock budget for a single axi call (run/respond can block
 *  for several minutes at a review/test/CI step). */
export const NM_PANE_TIMEOUT_MS = 30 * 60_000;

export interface MarkedOutput {
	complete: boolean;
	output?: string;
	exitCode?: number;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Build the bash script that runs `no-mistakes axi <args>` IN a Herdr pane
 * (text-pane mode).
 *
 * stdout (the START/END markers plus the command's TOON stdout) is piped
 * through `tee` so the captain sees it live AND a clean copy lands in
 * `outFile`. stderr (progress) flows straight to the terminal via fd 3, so it
 * is visible live but stays out of the captured file — keeping the TOON the
 * agent parses free of interleaved progress noise.
 *
 * The END marker carries the command's exit status so the caller can detect
 * completion by polling `outFile` without racing the process exit.
 */
export function buildPaneScript(args: string[], token: string, outFile: string): string {
	const start = `__NM_START_${token}__`;
	const end = `__NM_END_${token}__`;
	const cmd = ["no-mistakes", "axi", ...args].map(shellQuote).join(" ");
	return [
		`OUT=${shellQuote(outFile)}`,
		`TOKEN=${shellQuote(token)}`,
		`{`,
		`  {`,
		`    printf '%s\\n' ${shellQuote(start)}`,
		`    ${cmd}`,
		`    __nm_status=$?`,
		`    printf '%s:%s\\n' ${shellQuote(end)} "$__nm_status"`,
		`  } 2>&3 | tee "$OUT"`,
		`} 3>&1`,
		"",
	].join("\n");
}

/**
 * Build the bash script that runs `no-mistakes axi <args>` DETACHED in the
 * background (TUI-pane mode). stdout (START/END markers + TOON) is teed to
 * `outFile`; stderr (progress) is redirected to `errFile` (there is no
 * visible terminal for it here — the visible pane shows `no-mistakes attach`
 * instead). After the command exits and the END marker lands, a `doneFile`
 * sentinel is touched so the attach wrapper knows it can stop retrying.
 *
 * The caller spawns this with `detached: true` and `stdio: 'ignore'`, then
 * polls `outFile` for the END marker exactly as in text-pane mode.
 */
export function buildBackgroundScript(
	args: string[],
	token: string,
	outFile: string,
	errFile: string,
	doneFile: string,
): string {
	const start = `__NM_START_${token}__`;
	const end = `__NM_END_${token}__`;
	const cmd = ["no-mistakes", "axi", ...args].map(shellQuote).join(" ");
	return [
		`OUT=${shellQuote(outFile)}`,
		`ERR=${shellQuote(errFile)}`,
		`DONE=${shellQuote(doneFile)}`,
		`{`,
		`  printf '%s\\n' ${shellQuote(start)}`,
		`  ${cmd} 2>"$ERR"`,
		`  __nm_status=$?`,
		`  printf '%s:%s\\n' ${shellQuote(end)} "$__nm_status"`,
		`} | tee "$OUT" >/dev/null`,
		`touch "$DONE"`,
		"",
	].join("\n");
}

/**
 * Build the bash script that runs `no-mistakes attach` in the visible Herdr
 * pane (TUI-pane mode). attach renders the interactive TUI of the active
 * daemon run — the same run the background `axi <args>` is driving.
 *
 * attach needs an active run to attach to, and there is a startup race: the
 * background axi run may not have registered with the daemon yet when attach
 * first runs. attach is read-only w.r.t. the daemon, so this wrapper simply
 * retries it until either it attaches (then it blocks for the whole run and
 * exits when the run ends) or the background run completes (sentinel
 * `doneFile` appears, meaning the run — successful or failed — is over and
 * there is nothing left to watch). Bounded by `maxTries` × `intervalSec` so a
 * permanently-unattachable run does not spin forever.
 */
export function buildAttachScript(doneFile: string, maxTries: number, intervalSec: string): string {
	return [
		`DONE=${shellQuote(doneFile)}`,
		`i=0`,
		`while [ "$i" -lt ${maxTries} ]; do`,
		`  [ -f "$DONE" ] && break`,
		`  no-mistakes attach 2>/dev/null`,
		`  [ -f "$DONE" ] && break`,
		`  i=$((i+1))`,
		`  sleep ${intervalSec}`,
		`done`,
		"",
	].join("\n");
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

/** True once the START marker has landed in the captured buffer (the
 *  background axi run has begun and is writing to `outFile`). */
export function hasStartMarker(buffer: string, token: string): boolean {
	const start = `__NM_START_${token}__`;
	return stripAnsi(buffer).includes(start);
}

/**
 * Parse the captured stdout file contents for the marked region.
 * Returns `{ complete: true, output, exitCode }` once the END marker has
 * landed, or `{ complete: false }` while the command is still running.
 */
export function extractMarkedOutput(buffer: string, token: string): MarkedOutput {
	const start = `__NM_START_${token}__`;
	const end = `__NM_END_${token}__:`;
	const lines = stripAnsi(buffer).split("\n");
	const startIndex = lines.findIndex((line) => line.includes(start));
	if (startIndex < 0) return { complete: false };
	const out: string[] = [];
	for (const line of lines.slice(startIndex + 1)) {
		const endIndex = line.indexOf(end);
		if (endIndex >= 0) {
			const rawCode = line.slice(endIndex + end.length).trim();
			const exitCode = Number.parseInt(rawCode, 10);
			return {
				complete: true,
				output: out.join("\n").trim(),
				exitCode: Number.isFinite(exitCode) ? exitCode : -1,
			};
		}
		out.push(line);
	}
	return { complete: false, output: out.join("\n").trim() };
}

// ---------------------------------------------------------------------------
// TUI-pane decision logic
// ---------------------------------------------------------------------------

/**
 * axi subcommands that drive a long pipeline run the captain wants to watch
 * in the rich `no-mistakes attach` TUI. Quick inspections (status/logs/sync/
 * abort) keep the text-pane behavior — attaching a TUI to a status query does
 * not make sense.
 */
export const TUI_SUBCOMMANDS = new Set(["run", "respond"]);

/**
 * Should this `axi <args>` call get the TUI pane (run/respond, unless the user
 * is just asking for `--help`)? `--help`/`-h` are quick introspections that
 * never start a pipeline run, so they stay on the text-pane path.
 */
export function wantsTuiPane(args: string[], subcommand: string): boolean {
	if (!TUI_SUBCOMMANDS.has(subcommand)) return false;
	return !args.some((a) => a === "--help" || a === "-h");
}
