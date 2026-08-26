export const NVIM_RUN_TIMEOUT_MS = 120_000;

interface MarkedOutput {
	complete: boolean;
	output?: string;
	exitCode?: number;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildNvimTerminalScript(command: string, token: string): string {
	const start = `__PI_RUN_COMMAND_START_${token}__`;
	const end = `__PI_RUN_COMMAND_END_${token}__`;
	return [
		"stty -echo",
		"PS1=",
		"PS2=",
		`printf '%s\\n' ${shellQuote(start)}`,
		"(",
		command,
		")",
		"__pi_status=$?",
		`printf '%s:%s\\n' ${shellQuote(end)} "$__pi_status"`,
		"stty echo",
		'exit "$__pi_status"',
		"",
	].join("\n");
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

export function extractMarkedOutput(buffer: string, token: string): MarkedOutput {
	const start = `__PI_RUN_COMMAND_START_${token}__`;
	const end = `__PI_RUN_COMMAND_END_${token}__:`;
	const lines = stripAnsi(buffer).split("\n");
	const startIndex = lines.findIndex((line) => line.includes(start));
	if (startIndex < 0) return { complete: false };
	const out: string[] = [];
	for (const line of lines.slice(startIndex + 1)) {
		const endIndex = line.indexOf(end);
		if (endIndex >= 0) {
			const rawCode = line.slice(endIndex + end.length).trim();
			const exitCode = Number.parseInt(rawCode, 10);
			return { complete: true, output: out.join("\n").trim(), exitCode: Number.isFinite(exitCode) ? exitCode : -1 };
		}
		out.push(line);
	}
	return { complete: false };
}
