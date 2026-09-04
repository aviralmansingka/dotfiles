export type NoMistakesPhaseStatus =
	| "pending"
	| "running"
	| "fixing"
	| "awaiting_approval"
	| "fix_review"
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
	id: string;
	branch?: string;
	head?: string;
	status: string;
	outcome?: string;
	gate?: string;
	awaitingAgent?: string;
	phases: NoMistakesPhase[];
	currentPhase?: string;
	phaseElapsedMs?: number;
	totalDurationMs: number;
	observedAt?: number;
	phaseStartedAt?: number;
	pipelineStartedAt?: number;
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
		if (quoted && character === "\\" && index + 1 < row.length) {
			value += character + row[++index]!;
		} else if (character === '"') {
			quoted = !quoted;
			value += character;
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

function objectScalar(output: string, object: string, key: string): string | undefined {
	const lines = output.split("\n");
	const objectIndex = lines.findIndex((line) => new RegExp(`^\\s*${object}:\\s*$`).test(line));
	if (objectIndex < 0) return undefined;
	const indentation = lines[objectIndex]!.match(/^\s*/)?.[0].length ?? 0;
	for (const line of lines.slice(objectIndex + 1)) {
		if (!line.trim()) continue;
		const rowIndentation = line.match(/^\s*/)?.[0].length ?? 0;
		if (rowIndentation <= indentation) break;
		const match = line.match(new RegExp(`^\\s*${key}:\\s*(.+)$`));
		if (match) return unquote(match[1]!);
	}
	return undefined;
}

function runStartedAt(id: string | undefined): number | undefined {
	if (!id || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(id)) return undefined;
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let timestamp = 0;
	for (const character of id.slice(0, 10).toUpperCase()) {
		timestamp = timestamp * 32 + alphabet.indexOf(character);
	}
	return timestamp;
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
	for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|d|h|m|s)/g)) {
		matched = true;
		const amount = Number(match[1]);
		const unit = match[2];
		total += amount * (
			unit === "d" ? 86_400_000
				: unit === "h" ? 3_600_000
					: unit === "m" ? 60_000
						: unit === "s" ? 1000
							: 1
		);
	}
	return matched ? total : undefined;
}

export function parseNoMistakesStatus(output: string, observedAt = Date.now()): NoMistakesSnapshot | undefined {
	const id = scalar(output, "id");
	const pipelineStartedAt = runStartedAt(id);
	const phaseRows = table(output, "steps");
	if (!id || pipelineStartedAt == null || phaseRows.length === 0) return undefined;
	const gate = objectScalar(output, "gate", "step");
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
	const status = scalar(output, "status") ?? "running";
	const outcome = scalar(output, "outcome");
	const awaitingAgent = scalar(output, "awaiting_agent");
	const current = phases.find((phase) => [
		"running",
		"fixing",
		"awaiting_approval",
		"fix_review",
	].includes(phase.status)) ?? (gate ? phases.find((phase) => phase.name === gate) : undefined);
	const parkedMs = parseDurationMs(awaitingAgent?.match(/^parked\s+(.+)$/)?.[1]);
	const phaseElapsedMs = parseDurationMs(current?.activeFor) ?? (current?.durationMs ?? 0) + (parkedMs ?? 0);
	const totalDurationMs = Math.max(0, observedAt - pipelineStartedAt);
	const reviewFindings = gate === "review"
		? table(output, "findings").map((row): NoMistakesFinding => ({
			id: row.id || undefined,
			severity: row.severity,
			file: row.file || undefined,
			description: row.description || "Review finding",
		}))
		: [];
	return {
		id,
		branch: scalar(output, "branch"),
		head: scalar(output, "head"),
		status,
		outcome,
		gate,
		awaitingAgent,
		phases,
		currentPhase: current?.name ?? (outcome === "checks-passed" ? "merge" : "starting"),
		phaseElapsedMs,
		totalDurationMs,
		observedAt,
		phaseStartedAt: observedAt - phaseElapsedMs,
		pipelineStartedAt,
		reviewFindings,
	};
}

export function observeNoMistakesTiming(
	snapshot: NoMistakesSnapshot,
	previous: NoMistakesSnapshot | undefined,
): NoMistakesSnapshot {
	const observedAt = snapshot.observedAt ?? Date.now();
	const sameRun = snapshot.id === previous?.id;
	const pipelineStartedAt = sameRun
		? previous.pipelineStartedAt ?? (previous.observedAt ?? observedAt) - previous.totalDurationMs
		: snapshot.pipelineStartedAt ?? observedAt - snapshot.totalDurationMs;
	const samePhase = sameRun && snapshot.currentPhase === previous.currentPhase;
	const phaseStartedAt = samePhase
		? previous.phaseStartedAt ?? (previous.observedAt ?? observedAt) - (previous.phaseElapsedMs ?? 0)
		: snapshot.phaseStartedAt ?? observedAt - (snapshot.phaseElapsedMs ?? 0);
	return {
		...snapshot,
		observedAt,
		phaseStartedAt,
		pipelineStartedAt,
		phaseElapsedMs: Math.max(snapshot.phaseElapsedMs ?? 0, observedAt - phaseStartedAt),
		totalDurationMs: Math.max(snapshot.totalDurationMs, observedAt - pipelineStartedAt),
	};
}

const TERMINAL_STATUSES = new Set(["failed", "cancelled", "completed"]);

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
	const phase = snapshot.currentPhase ?? (snapshot.outcome === "checks-passed" ? "merge" : "starting");
	return `${phase} · ${duration(snapshot.phaseElapsedMs)} · ${duration(snapshot.totalDurationMs)} total`;
}

function findingSummary(snapshot: NoMistakesSnapshot, phase: NoMistakesPhase): string | undefined {
	if (phase.name !== "review") return undefined;
	const errors = snapshot.reviewFindings.filter((finding) => finding.severity === "error").length;
	const warnings = snapshot.reviewFindings.filter((finding) => finding.severity === "warning").length;
	const info = snapshot.reviewFindings.filter((finding) => finding.severity === "info").length;
	return [
		errors ? `❌ ${errors}` : undefined,
		warnings ? `⚠️ ${warnings}` : undefined,
		info ? `ℹ️ ${info}` : undefined,
	]
		.filter(Boolean)
		.join(" · ") || undefined;
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
