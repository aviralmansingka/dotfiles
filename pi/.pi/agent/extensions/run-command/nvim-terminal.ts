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
// its stdout+stderr piped through `tee` so the output is BOTH shown live in the
// terminal AND captured to `outputFile`, which runViaNvimTerminal reads back
// via fs. The terminal buffer is used ONLY to spot the END marker — we do not
// scrape it for command output, because the terminal driver echoes the
// bulk-pasted wrapper before the shell executes it, corrupting scraped output.
//
// Exit-code recovery: the brief asked for `${PIPESTATUS[0]}` (bash), but the
// captain's `dm` shell is zsh-based (these dotfiles are zsh), where the
// uppercase `PIPESTATUS` array does not exist (zsh spells it lowercase
// `pipestatus`, 1-indexed) and `${PIPESTATUS[0]}` is a fatal "Bad substitution"
// in dash/POSIX `sh`. Rather than special-case every shell, we capture the
// command's real exit status portably: an `EXIT` trap inside the subshell
// writes `$?` to `statusFile` before the subshell terminates — so even `exit N`
// (which skips statements after it) still records its status. The wrapper then
// reads `statusFile` and falls back to the pipeline's `$?` (tee's status, 0)
// only if the trap somehow failed to write. This is fully POSIX and works
// under bash, zsh, dash, and the captain's `dm`.
//
// Marker hygiene: the START/END markers are `printf`'d to the wrapper shell's
// own stdout (the terminal pty) — they are NOT inside the `( … ) 2>&1 | tee`
// pipeline, so they never reach `outputFile`. Likewise the trap's `printf`
// redirects to `statusFile`, not the pipe. The captured file therefore holds
// ONLY the command's stdout+stderr, with no marker or status noise. The END
// marker still carries the exit status as a `:N` suffix for completion
// detection, and the echoed `printf` command line never contains that suffix,
// so `extractMarkedOutput` is unambiguous.
//
// No stty/PS1/PS2 tweaking: capture no longer depends on echo timing and the
// wrapper must run under any interactive shell (e.g. the captain's `dm`).
export function buildNvimTerminalScript(command: string, token: string, outputFile: string, statusFile: string): string {
	const start = `__PI_RUN_COMMAND_START_${token}__`;
	const end = `__PI_RUN_COMMAND_END_${token}__`;
	// `statusFile` is a temp path we generate (tmpdir + hex token + .txt); it
	// contains no characters that need shell quoting inside double quotes, so
	// embed it directly to keep the trap body a simple single-quoted literal.
	const statusPath = statusFile.replace(/"/g, "");
	return [
		`printf '%s\\n' ${shellQuote(start)}`,
		"(",
		`trap 'printf %s "$?" > "${statusPath}"' EXIT`,
		command,
		`) 2>&1 | tee ${shellQuote(outputFile)} >/dev/null`,
		"__pi_pipeline_status=$?",
		`__pi_status=$(cat "${statusPath}" 2>/dev/null)`,
		'[ -z "$__pi_status" ] && __pi_status=$__pi_pipeline_status',
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
