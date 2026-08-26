// Pure helpers for running a `no-mistakes axi` command in a visible Herdr
// pane and capturing its structured TOON stdout back to the agent.
//
// The pane shows the run live (stdout via `tee` + stderr directly to the
// terminal) while a clean copy of stdout — the TOON the agent drives on — is
// written to a temp file between START/END markers that also carry the exit
// code. `extractMarkedOutput` pulls that structured result back out.
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
 * Build the bash script that runs `no-mistakes axi <args>` in a Herdr pane.
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

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
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
