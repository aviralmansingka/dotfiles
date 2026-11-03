// Pure helpers for the visible no-mistakes pane.
//
// `no-mistakes axi` is split across two streams on purpose: machine-readable
// TOON goes to stdout, and human progress goes to stderr. The pane subprocess
// tees stdout to the capture file and the pane terminal, and leaves stderr on
// the pane terminal:
//
//   stdout -> capture file (agent) + pane terminal (captain)
//   stderr -> pane terminal (captain)
//
// A START/END marker pair frames the captured stdout. The END marker carries
// the exit status, so completion detection never depends on scraping the pane
// buffer (which also contains the echoed wrapper line and progress noise).
//
// These functions are split out so they run without a live Herdr or a
// no-mistakes daemon (see no-mistakes-pane.test.mjs).

/** Wall-clock budget for one `axi` call. `run` and `respond` block until the
 *  next decision point, and a review/test step can take several minutes. */
export const NM_PANE_TIMEOUT_MS = 30 * 60_000;

/** The prefix the run pane carries, so the captain can identify it. */
export const NM_PANE_LABEL = "no-mistakes";

export interface MarkedOutput {
	complete: boolean;
	output?: string;
	exitCode?: number;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Build the bash script the visible pane runs. It runs `no-mistakes axi <args>`
 * with stdout teed to `outFile` and the pane terminal, and stderr left on the
 * pane terminal. The captain therefore sees the same pipeline output live -
 * progress and gate findings - while the agent reads clean TOON from the file.
 * stdout stays a pipe (not a TTY), so axi keeps its machine-readable mode.
 * The script always exits 0: the command's own status rides the END marker, so
 * a non-zero pipeline outcome is data, not a pane error.
 */
export function buildPaneScript(
	axiArgs: string[],
	token: string,
	outFile: string,
	cwd: string,
): string {
	const start = `__NM_START_${token}__`;
	const end = `__NM_END_${token}__`;
	const cmd = ["no-mistakes", "axi", ...axiArgs].map(shellQuote).join(" ");
	return [
		`OUT=${shellQuote(outFile)}`,
		`exec 3>&1`,
		`printf '\\033[2m$ no-mistakes axi %s\\033[0m\\n' ${shellQuote(axiArgs.join(" "))} >&3`,
		// A reused pane keeps its own shell cwd, so pin each call to the
		// caller's directory. A failure is data on the END marker, not a hang.
		`if ! cd ${shellQuote(cwd)}; then`,
		`  printf 'no-mistakes: cannot enter %s\\n' ${shellQuote(cwd)} >&3`,
		`  printf '%s\\n' ${shellQuote(start)} >>"$OUT"`,
		`  printf '%s:%s\\n' ${shellQuote(end)} 127 >>"$OUT"`,
		`  exit 0`,
		`fi`,
		`printf '%s\\n' ${shellQuote(start)} >>"$OUT"`,
		// fd2 -> pane terminal, stdout -> tee -> capture file + pane. Order
		// matters. The pipe keeps stdout non-TTY, so axi never goes interactive.
		`${cmd} 2>&3 3>&- | tee -a "$OUT"`,
		`__nm_status=\${PIPESTATUS[0]}`,
		`printf '%s:%s\\n' ${shellQuote(end)} "$__nm_status" >>"$OUT"`,
		`exit 0`,
		"",
	].join("\n");
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

/**
 * Read the capture file. Returns `{complete: true, output, exitCode}` once the
 * END marker landed, else `{complete: false, output}` with whatever stdout
 * arrived so far (no `output` key before the START marker).
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
			const exitCode = Number.parseInt(line.slice(endIndex + end.length).trim(), 10);
			out.push(line.slice(0, endIndex));
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

/** Subcommands that answer fast and read state rather than own the pane. */
export const QUICK_SUBCOMMANDS = new Set([
	"status",
	"logs",
	"abort",
	"sync",
	"rounds",
	"handoff",
	// A reviewer question can arrive while `run` is still blocking. Answering
	// it must not wait for that call, so `answer` runs inline when the pane is
	// busy; once it closes the last question it blocks like `respond`.
	"answer",
]);

/**
 * Does this call belong in the visible pane? Pipeline drivers (`run`,
 * `respond`) and state views (`status`) do. Pure introspection flags such as
 * `--help` run inline: they never touch a run, so a pane would be noise.
 */
export function wantsPane(axiArgs: string[]): boolean {
	// Bare `axi` is the cheap home view; it never owns the pane.
	if (axiArgs.length === 0) return false;
	return !axiArgs.some((arg) => arg === "--help" || arg === "-h" || arg === "--version");
}

/** The subcommand word of an `axi` argument list (`run`, `respond`, ...). */
export function subcommandOf(axiArgs: string[]): string {
	return axiArgs.find((arg) => !arg.startsWith("-")) ?? "";
}

/** Label the pane with the phase so the captain can tell what is running. */
export function paneLabel(axiArgs: string[]): string {
	const sub = subcommandOf(axiArgs);
	return sub ? `${NM_PANE_LABEL}: ${sub}` : NM_PANE_LABEL;
}

/**
 * Classify a `herdr pane get` response. `false` means the pane is gone and the
 * run must be reported as cancelled. `null` means the answer is unknown (Herdr
 * failed transiently), so the caller must NOT treat a healthy run as dead.
 */
export function paneStateFromResponse(response: unknown): boolean | null {
	if (!response || typeof response !== "object") return null;
	const res = response as { error?: { code?: string }; result?: { pane?: unknown } };
	if (res.error) return res.error.code === "pane_not_found" ? false : null;
	return res.result?.pane ? true : null;
}
