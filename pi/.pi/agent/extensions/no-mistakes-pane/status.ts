export type NoMistakesPhaseStatus =
	| "pending"
	| "running"
	| "fixing"
	| "awaiting"
	| "completed"
	| "passed"
	| "checks-passed"
	| "failed"
	| "cancelled"
	| "skipped"
	| string;

export interface NoMistakesPhase {
	name: string;
	status: NoMistakesPhaseStatus;
	findings?: number;
	durationMs?: number;
	activeFor?: string;
	lastActivity?: string;
	round?: string;
}

export interface NoMistakesSnapshot {
	id?: string;
	branch?: string;
	head?: string;
	status: string;
	gate?: string;
	awaitingAgent?: string;
	phases: NoMistakesPhase[];
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed) as string;
		} catch {}
	}
	return trimmed;
}

function splitRow(row: string): string[] {
	const values: string[] = [];
	let value = "";
	let quoted = false;
	for (let index = 0; index < row.length; index++) {
		const character = row[index]!;
		if (character === '"') {
			if (quoted && row[index + 1] === '"') {
				value += '"';
				index++;
			} else {
				quoted = !quoted;
			}
		} else if (character === "," && !quoted) {
			values.push(value.trim());
			value = "";
		} else {
			value += character;
		}
	}
	values.push(value.trim());
	return values.map(unquote);
}

function scalar(output: string, key: string): string | undefined {
	const match = output.match(new RegExp(`^\\s{0,4}${key}:\\s*(.+)$`, "m"));
	return match ? unquote(match[1]!) : undefined;
}

function table(output: string, name: string): Array<Record<string, string>> {
	const lines = output.split("\n");
	const headerIndex = lines.findIndex((line) =>
		new RegExp(`^${name}\\[\\d+\\]\\{([^}]+)\\}:$`).test(line.trim()),
	);
	if (headerIndex < 0) return [];
	const indentation = lines[headerIndex]!.match(/^\s*/)?.[0].length ?? 0;
	const header = lines[headerIndex]!.trim().match(/\{([^}]+)\}/)?.[1]?.split(",") ?? [];
	const rows: Array<Record<string, string>> = [];
	for (const line of lines.slice(headerIndex + 1)) {
		if (!line.trim()) break;
		const rowIndentation = line.match(/^\s*/)?.[0].length ?? 0;
		if (rowIndentation <= indentation) break;
		const values = splitRow(line.trim());
		if (values.length !== header.length) continue;
		rows.push(Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""])));
	}
	return rows;
}

export function parseNoMistakesStatus(output: string): NoMistakesSnapshot | undefined {
	const phases = table(output, "steps");
	if (phases.length === 0) return undefined;
	const active = new Map(table(output, "active_steps").map((row) => [row.step, row]));
	return {
		id: scalar(output, "id"),
		branch: scalar(output, "branch"),
		head: scalar(output, "head"),
		status: scalar(output, "outcome") ?? scalar(output, "status") ?? "running",
		gate: scalar(output, "gate"),
		awaitingAgent: scalar(output, "awaiting_agent"),
		phases: phases.map((row) => {
			const live = active.get(row.step);
			const findings = Number(row.findings);
			const durationMs = Number(row.duration_ms);
			return {
				name: row.step || "step",
				status: row.status || "pending",
				findings: Number.isFinite(findings) ? findings : undefined,
				durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
				activeFor: live?.active_for || undefined,
				lastActivity: live?.last_activity || undefined,
				round: live?.round || undefined,
			};
		}),
	};
}

const TERMINAL_STATUSES = new Set(["passed", "failed", "cancelled", "completed"]);

export function isObservableNoMistakesRun(snapshot: NoMistakesSnapshot | undefined): snapshot is NoMistakesSnapshot {
	return !!snapshot && !TERMINAL_STATUSES.has(snapshot.status);
}

export function summarizeNoMistakesSnapshot(snapshot: NoMistakesSnapshot): string {
	if (snapshot.gate) return `waiting · ${snapshot.gate} gate`;
	const active = snapshot.phases.find((phase) => ["running", "fixing", "awaiting"].includes(phase.status));
	if (active) {
		return ["active", active.name, active.round, active.lastActivity].filter(Boolean).join(" · ");
	}
	if (snapshot.status === "checks-passed") return "waiting · merge";
	return snapshot.status;
}

export function phaseProgress(snapshot: NoMistakesSnapshot) {
	return snapshot.phases.map((phase) => ({
		name: phase.name,
		status: phase.status,
		preview: [
			phase.activeFor,
			phase.round,
			phase.findings ? `${phase.findings} finding${phase.findings === 1 ? "" : "s"}` : undefined,
			phase.lastActivity,
		].filter(Boolean).join(" · ") || undefined,
	}));
}
