export const NVIM_RUN_TIMEOUT_MS = 120_000;

interface MarkedOutput {
	complete: boolean;
	exitCode?: number;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

// Build the wrapper pasted into the Neovim `:term` pane. The displayed command
// runs in a subshell (so `exit N` builtins return control to the wrapper) with
// its stdout+stderr redirected to `outputFile`, which runViaNvimTerminal reads
// back via fs. The terminal buffer is used ONLY to spot the END marker — we do
// not scrape it for command output, because the terminal driver echoes the
// bulk-pasted wrapper before the shell executes it, corrupting scraped output.
// The END marker carries the exit status as a `:N` suffix, which the echoed
// printf command line never contains, so completion detection is unambiguous.
// No stty/PS1/PS2 tweaking: capture no longer depends on echo timing and the
// wrapper must run under any interactive shell (e.g. the captain's `dm`).
export function buildNvimTerminalScript(command: string, token: string, outputFile: string): string {
	const start = `__PI_RUN_COMMAND_START_${token}__`;
	const end = `__PI_RUN_COMMAND_END_${token}__`;
	return [
		`printf '%s\\n' ${shellQuote(start)}`,
		"(",
		command,
		`) >${shellQuote(outputFile)} 2>&1`,
		"__pi_status=$?",
		`printf '%s:%s\\n' ${shellQuote(end)} "$__pi_status"`,
		'exit "$__pi_status"',
		"",
	].join("\n");
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

// Detect completion + exit status from the END marker line only. Output is NOT
// scraped from the buffer — runViaNvimTerminal reads it from the temp file.
export function extractMarkedOutput(buffer: string, token: string): MarkedOutput {
	const end = `__PI_RUN_COMMAND_END_${token}__:`;
	const lines = stripAnsi(buffer).split("\n");
	for (const line of lines) {
		const endIndex = line.indexOf(end);
		if (endIndex >= 0) {
			const rawCode = line.slice(endIndex + end.length).trim();
			const exitCode = Number.parseInt(rawCode, 10);
			return { complete: true, exitCode: Number.isFinite(exitCode) ? exitCode : -1 };
		}
	}
	return { complete: false };
}
