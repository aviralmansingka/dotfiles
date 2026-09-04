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

export interface NoMistakesFinding {
	id?: string;
	severity: string;
	file?: string;
	description: string;
}

export interface NoMistakesSnapshot {
	id?: string;
	branch?: string;
	head?: string;
	status: string;
	gate?: string;
	awaitingAgent?: string;
	phases: NoMistakesPhase[];
	currentPhase?: string;
	phaseElapsedMs?: number;
	totalDurationMs: number;
	reviewFindings: NoMistakesFinding[];
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

export function parseDurationMs(value: string | undefined): number | undefined {
	if (!value) return undefined;
	let total = 0;
	let matched = false;
	for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)\b/g)) {
		matched = true;
		const amount = Number(match[1]);
		const unit = match[2];
		total += amount * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1);
	}
	return matched ? total : undefined;
}

export function parseNoMistakesStatus(output: string): NoMistakesSnapshot | undefined {
	const phaseRows = table(output, "steps");
	if (phaseRows.length === 0) return undefined;
	const gate = scalar(output, "gate");
	const active = new Map(table(output, "active_steps").map((row) => [row.step, row]));
	const phases = phaseRows.map((row): NoMistakesPhase => {
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
	});
	const status = scalar(output, "outcome") ?? scalar(output, "status") ?? "running";
	const current = phases.find((phase) => ["running", "fixing", "awaiting"].includes(phase.status)) ??
		(gate ? phases.find((phase) => phase.name === gate) : undefined);
	const phaseElapsedMs = parseDurationMs(current?.activeFor) ?? current?.durationMs;
	const totalDurationMs = phases.reduce((total, phase) => {
		const elapsed = phase === current
			? Math.max(phase.durationMs ?? 0, phaseElapsedMs ?? 0)
			: phase.durationMs ?? 0;
		return total + elapsed;
	}, 0);
	const reviewFindings = gate === "review"
		? table(output, "findings").map((row): NoMistakesFinding => ({
			id: row.id || undefined,
			severity: row.severity,
			file: row.file || undefined,
			description: row.description || "Review finding",
		}))
		: [];
	return {
		id: scalar(output, "id"),
		branch: scalar(output, "branch"),
		head: scalar(output, "head"),
		status,
		gate,
		awaitingAgent: scalar(output, "awaiting_agent"),
		phases,
		currentPhase: current?.name ?? (status === "checks-passed" ? "merge" : "starting"),
		phaseElapsedMs,
		totalDurationMs,
		reviewFindings,
	};
}

const TERMINAL_STATUSES = new Set(["passed", "failed", "cancelled", "completed"]);

export function isObservableNoMistakesRun(snapshot: NoMistakesSnapshot | undefined): snapshot is NoMistakesSnapshot {
	return !!snapshot && !TERMINAL_STATUSES.has(snapshot.status);
}

function duration(milliseconds: number | undefined): string {
	if (milliseconds == null) return "—";
	if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
	const seconds = Math.floor(milliseconds / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function summarizeNoMistakesSnapshot(snapshot: NoMistakesSnapshot): string {
	const phase = snapshot.currentPhase ?? (snapshot.status === "checks-passed" ? "merge" : "starting");
	return `${phase} · ${duration(snapshot.phaseElapsedMs)} · ${duration(snapshot.totalDurationMs)} total`;
}

function findingSummary(snapshot: NoMistakesSnapshot, phase: NoMistakesPhase): string | undefined {
	if (!phase.findings) return undefined;
	if (phase.name !== "review" || snapshot.reviewFindings.length === 0) {
		return `🔎 ${phase.findings} finding${phase.findings === 1 ? "" : "s"}`;
	}
	const errors = snapshot.reviewFindings.filter((finding) => finding.severity === "error").length;
	const warnings = snapshot.reviewFindings.filter((finding) => finding.severity === "warning").length;
	const info = snapshot.reviewFindings.filter((finding) => finding.severity === "info").length;
	const unknown = Math.max(
		snapshot.reviewFindings.length - errors - warnings - info,
		phase.findings - errors - warnings - info,
	);
	return [
		errors ? `❌ ${errors}` : undefined,
		warnings ? `⚠️ ${warnings}` : undefined,
		info ? `ℹ️ ${info}` : undefined,
		unknown ? `🔎 ${unknown}` : undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

export function phaseProgress(snapshot: NoMistakesSnapshot) {
	return snapshot.phases.map((phase) => ({
		name: phase.name,
		status: phase.status,
		preview: [
			phase.activeFor,
			phase.round,
			findingSummary(snapshot, phase),
			phase.lastActivity,
		].filter(Boolean).join(" · ") || undefined,
	}));
}
