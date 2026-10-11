import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ────────────────────────────────────────────────────────────────────────
// `mermaid` v2 — deterministic emit, local validation, zero nested calls.
//
// The agent passes nodes and edges as data, filled from full conversation
// context. The tool emits canonical Mermaid syntax (the emitter only
// produces what the validators accept, so the default path cannot fail to
// parse), then enforces three local gates, ~0.5 s total:
//   1. mmdflux strict parse (a parse failure from the emitter is a bug,
//      never retried; from `freeform` it is returned for one model retry).
//   2. structure diff: MMDS JSON nodes/edges/labels must equal the params
//      exactly — replaces the old nested checker against the real truth.
//   3. grok-mermaid render — the chat's own renderer: must not crash, art
//      width must fit the pane, and warnings must be empty (the chat blocks
//      rendering on warnings). Width overrun re-emits TD once, locally.
// This replaces both inline fence generation (which shipped diagrams that
// did not parse, warned, or overflowed the pane) and the v1 nested
// gpt-6.1-sol writer/checker loop (8.5 min mean per call, 67% failure).
// Budget: params cost about one inline fence; all gates are local.
// ────────────────────────────────────────────────────────────────────────

const MMDFLUX_TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 512 * 1024;
const DEFAULT_PANE_WIDTH = 100;
const PANE_CHROME_COLS = 4;

export const SUPPORTED_DIAGRAM_TYPES = ["flowchart", "sequenceDiagram", "stateDiagram-v2", "classDiagram"] as const;
export type DiagramType = (typeof SUPPORTED_DIAGRAM_TYPES)[number];
export type Direction = "TD" | "LR";

export interface NodeParam { id: string; label?: string }
export interface EdgeParam { from: string; to: string; label?: string }
export interface GroupParam { id: string; title: string; members: string[] }
export interface ActorParam { id: string; label?: string }
export interface MessageParam { from: string; to: string; text: string; dashed?: boolean }
export interface StateParam { id: string; label?: string }
export interface TransitionParam { from: string; to: string; label?: string }
export interface ClassParam { id: string; name: string; members?: string[] }
export interface RelationParam {
	from: string;
	to: string;
	kind?: "extends" | "implements" | "composition" | "aggregation" | "association" | "dependency";
	label?: string;
}

export interface MermaidParams {
	type?: DiagramType;
	direction?: Direction;
	nodes?: NodeParam[];
	edges?: EdgeParam[];
	groups?: GroupParam[];
	actors?: ActorParam[];
	messages?: MessageParam[];
	states?: StateParam[];
	transitions?: TransitionParam[];
	classes?: ClassParam[];
	relations?: RelationParam[];
	freeform?: string;
}

interface ValidatedParams {
	kind: "structured";
	type: DiagramType;
	direction: Direction;
	params: MermaidParams;
	/** param id → emitted id (ids are sanitized; collisions suffixed). */
	ids: Map<string, string>;
	/** param id → expected rendered label (label ?? id). */
	labels: Map<string, string>;
}

// ── id and label handling ───────────────────────────────────────────────

/** Sanitize a param id into a safe Mermaid identifier. */
export function sanitizeId(raw: string, index: number): string {
	const cleaned = String(raw).replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 40);
	return cleaned || `n${index + 1}`;
}

/** Newlines become <br/>; backticks and control characters are stripped. */
export function escapeLabel(label: string): string {
	return String(label)
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f`]/g, "")
		.replace(/\r?\n/g, "<br/>")
		.trim();
}

function checkLabel(where: string, label: string | undefined): string | null {
	if (label === undefined) return null;
	if (label.includes('"')) return `${where}: labels cannot contain double quotes; rephrase the label`;
	if (!escapeLabel(label)) return `${where}: label is empty after cleanup`;
	return null;
}

// ── param validation ────────────────────────────────────────────────────

export function validateParams(input: MermaidParams): { ok: true; value: ValidatedParams } | { ok: false; error: string } {
	const type = input.type;
	if (!type || !SUPPORTED_DIAGRAM_TYPES.includes(type)) {
		return { ok: false, error: `type must be one of: ${SUPPORTED_DIAGRAM_TYPES.join(", ")} (or pass freeform source)` };
	}
	const direction: Direction = input.direction === "LR" ? "LR" : "TD";
	const ids = new Map<string, string>();
	const labels = new Map<string, string>();
	const problems: string[] = [];

	const register = (list: { id: string; label?: string }[] | undefined, what: string) => {
		for (const [i, item] of (list ?? []).entries()) {
			const rawId = String(item.id ?? "").trim();
			if (!rawId) { problems.push(`${what}[${i}]: id is required`); continue; }
			let emitted = sanitizeId(rawId, i);
			let suffix = 2;
			const taken = new Set(ids.values());
			while (taken.has(emitted) && suffix < 99) emitted = `${emitted}_${suffix++}`;
			ids.set(rawId, emitted);
			const labelProblem = checkLabel(`${what} "${rawId}"`, item.label);
			if (labelProblem) problems.push(labelProblem);
			labels.set(rawId, escapeLabel(item.label ?? rawId));
		}
	};

	const known = (...extra: string[]) => {
		const set = new Set([...ids.keys(), ...extra]);
		return (ref: string) => set.has(ref);
	};

	if (type === "flowchart") {
		register(input.nodes, "node");
		register(input.groups?.map((g) => ({ id: g.id, label: g.title })), "group");
		if (!input.nodes?.length && !input.groups?.length) problems.push("flowchart needs at least one node");
		for (const [i, g] of (input.groups ?? []).entries()) {
			for (const m of g.members) if (!ids.has(m)) problems.push(`group "${g.id}" member "${m}" is not a declared node`);
			const titleProblem = checkLabel(`group "${g.id}"`, g.title);
			if (titleProblem) problems.push(titleProblem);
		}
		const isKnown = known();
		for (const [i, e] of (input.edges ?? []).entries()) {
			if (!isKnown(e.from)) problems.push(`edge ${e.from}->${e.to}: "${e.from}" is not a declared node or group`);
			if (!isKnown(e.to)) problems.push(`edge ${e.from}->${e.to}: "${e.to}" is not a declared node or group`);
			const lp = checkLabel(`edge ${e.from}->${e.to}`, e.label);
			if (lp) problems.push(lp);
		}
	} else if (type === "sequenceDiagram") {
		register(input.actors, "actor");
		if (!input.actors?.length) problems.push("sequenceDiagram needs at least one actor");
		for (const [i, m] of (input.messages ?? []).entries()) {
			if (!ids.has(m.from)) problems.push(`message[${i}]: "${m.from}" is not a declared actor`);
			if (!ids.has(m.to)) problems.push(`message[${i}]: "${m.to}" is not a declared actor`);
			if (!String(m.text ?? "").trim()) problems.push(`message[${i}]: text is required`);
			const lp = checkLabel(`message[${i}]`, m.text);
			if (lp) problems.push(lp);
		}
		if (!input.messages?.length) problems.push("sequenceDiagram needs at least one message");
	} else if (type === "stateDiagram-v2") {
		register(input.states, "state");
		if (!input.states?.length) problems.push("stateDiagram-v2 needs at least one state");
		const isKnown = known("[*]");
		for (const [i, t] of (input.transitions ?? []).entries()) {
			if (!isKnown(t.from)) problems.push(`transition ${t.from}->${t.to}: "${t.from}" is not a declared state or [*]`);
			if (!isKnown(t.to)) problems.push(`transition ${t.from}->${t.to}: "${t.to}" is not a declared state or [*]`);
			const lp = checkLabel(`transition ${t.from}->${t.to}`, t.label);
			if (lp) problems.push(lp);
		}
	} else {
		register(input.classes?.map((c) => ({ id: c.id, label: c.name })), "class");
		if (!input.classes?.length) problems.push("classDiagram needs at least one class");
		// classDiagram: the emitted identifier is the class NAME, not the param id.
		const taken = new Set<string>();
		for (const c of input.classes ?? []) {
			let em = sanitizeId(String(c.name ?? c.id), 0);
			let suffix = 2;
			while (taken.has(em) && suffix < 99) em = `${em}_${suffix++}`;
			taken.add(em);
			ids.set(c.id, em);
		}
		for (const [i, c] of (input.classes ?? []).entries()) {
			for (const m of c.members ?? []) {
				if (/[{}\n\r]/.test(m)) problems.push(`class "${c.id}" member "${m}": no braces or newlines in members`);
			}
		}
		const isKnown = known();
		for (const [i, r] of (input.relations ?? []).entries()) {
			if (!isKnown(r.from)) problems.push(`relation ${r.from}->${r.to}: "${r.from}" is not a declared class`);
			if (!isKnown(r.to)) problems.push(`relation ${r.from}->${r.to}: "${r.to}" is not a declared class`);
			const lp = checkLabel(`relation ${r.from}->${r.to}`, r.label);
			if (lp) problems.push(lp);
		}
	}

	if (problems.length) return { ok: false, error: problems.join("; ") };
	return { ok: true, value: { kind: "structured", type, direction, params: input, ids, labels } };
}

// ── emitter ─────────────────────────────────────────────────────────────

/** Emit canonical Mermaid source from validated params. Never invents or drops content. */
export function emitMermaid(valid: ValidatedParams, directionOverride?: Direction): string {
	const { type, params, ids, labels } = valid;
	const direction = directionOverride ?? valid.direction;
	const L = (raw: string) => escapeLabel(labels.get(raw) ?? raw);
	const ID = (raw: string) => (raw === "[*]" ? "[*]" : (ids.get(raw) ?? sanitizeId(raw, 0)));

	if (type === "flowchart") {
		const lines = [`flowchart ${direction}`];
		const grouped = new Set((params.groups ?? []).flatMap((g) => g.members));
		for (const n of params.nodes ?? []) if (!grouped.has(n.id)) lines.push(`  ${ID(n.id)}["${L(n.id)}"]`);
		for (const g of params.groups ?? []) {
			lines.push(`  subgraph ${ID(g.id)}["${L(g.id)}"]`);
			for (const mem of g.members) lines.push(`    ${ID(mem)}["${L(mem)}"]`);
			lines.push("  end");
		}
		for (const e of params.edges ?? []) {
			const label = e.label ? `|"${escapeLabel(e.label)}"|` : "";
			lines.push(`  ${ID(e.from)} -->${label} ${ID(e.to)}`);
		}
		return lines.join("\n");
	}

	if (type === "sequenceDiagram") {
		const lines = ["sequenceDiagram"];
		for (const a of params.actors ?? []) lines.push(`  participant ${ID(a.id)} as ${L(a.id).replace(/<br\/>/g, " ")}`);
		for (const m of params.messages ?? []) {
			const arrow = m.dashed ? "-->>" : "->>";
			lines.push(`  ${ID(m.from)}${arrow}${ID(m.to)}: ${escapeLabel(m.text).replace(/<br\/>/g, " ")}`);
		}
		return lines.join("\n");
	}

	if (type === "stateDiagram-v2") {
		const lines = ["stateDiagram-v2", `  direction ${direction}`];
		for (const s of params.states ?? []) {
			if (s.label && escapeLabel(s.label) !== s.id) lines.push(`  state "${escapeLabel(s.label)}" as ${ID(s.id)}`);
		}
		for (const t of params.transitions ?? []) {
			const label = t.label ? ` : ${escapeLabel(t.label)}` : "";
			lines.push(`  ${ID(t.from)} --> ${ID(t.to)}${label}`);
		}
		return lines.join("\n");
	}

	// classDiagram
	const lines = ["classDiagram"];
	for (const c of params.classes ?? []) {
		lines.push(`  class ${ID(c.id)} {`);
		for (const m of c.members ?? []) lines.push(`    ${String(m).replace(/[{}\n\r]/g, " ").trim()}`);
		lines.push("  }");
	}
	const ARROWS: Record<string, string> = {
		extends: "<|--",
		implements: "<|..",
		composition: "*--",
		aggregation: "o--",
		association: "-->",
		dependency: "..>",
	};
	for (const r of params.relations ?? []) {
		const arrow = ARROWS[r.kind ?? "association"];
		const label = r.label ? ` : ${escapeLabel(r.label)}` : "";
		lines.push(`  ${ID(r.from)} ${arrow} ${ID(r.to)}${label}`);
	}
	return lines.join("\n");
}

/** Pull the mermaid source out of a model reply that wrapped it in a fence. */
export function extractMermaidSource(raw: string): string | null {
	const body = /```mermaid\s*\n([\s\S]*?)```/.exec(raw)?.[1]?.trim();
	return body || null;
}

// ── gate 1 + 2: mmdflux (strict parse, MMDS structure) ─────────────────

export type MmdfluxResult =
	| { ok: true; format: "text"; art: string }
	| { ok: true; format: "mmds"; mmds: any }
	| { ok: false; kind: "environment" | "parse"; error: string };

function mmdfluxCandidates(): string[] {
	const list: string[] = [];
	if (process.env.PI_MERMAID_MMDFLUX) list.push(process.env.PI_MERMAID_MMDFLUX);
	const local = join(homedir(), ".local", "bin", "mmdflux");
	if (existsSync(local)) list.push(local);
	list.push("mmdflux");
	return list;
}

function spawnMmdflux(bin: string, source: string, format: "text" | "mmds", signal?: AbortSignal): Promise<MmdfluxResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, ["-f", format], { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let err = "";
		let settled = false;
		const onAbort = () => { if (!settled) child.kill("SIGKILL"); };
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => child.kill("SIGKILL"), MMDFLUX_TIMEOUT_MS);
		const finish = () => {
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		child.stdout.on("data", (d: Buffer) => { if (out.length < OUTPUT_CAP) out += d.toString("utf8"); });
		child.stderr.on("data", (d: Buffer) => { if (err.length < OUTPUT_CAP) err += d.toString("utf8"); });
		child.on("error", (e: NodeJS.ErrnoException) => { finish(); reject(e); });
		child.on("close", (code: number | null, killSignal: NodeJS.Signals | null) => {
			finish();
			if (signal?.aborted) { reject(new Error("aborted")); return; }
			const art = out.trimEnd();
			if (code === 0 && art) {
				if (format === "mmds") {
					try { resolve({ ok: true, format: "mmds", mmds: JSON.parse(art) }); return; } catch { /* fall through */ }
				} else {
					resolve({ ok: true, format: "text", art }); return;
				}
			}
			if (code === null) {
				resolve({ ok: false, kind: "environment", error: `mmdflux killed by ${killSignal ?? "unknown signal"} before exiting` });
				return;
			}
			resolve({ ok: false, kind: "parse", error: (err || out || `mmdflux exited with code ${code}`).trim() });
		});
		child.stdin.on("error", () => { /* EPIPE when the binary is missing */ });
		child.stdin.end(source);
	});
}

/** Validate (and optionally render) a mermaid source with mmdflux. Never throws except on abort. */
export async function runMmdflux(source: string, format: "text" | "mmds" = "text", signal?: AbortSignal): Promise<MmdfluxResult> {
	for (const bin of mmdfluxCandidates()) {
		try {
			return await spawnMmdflux(bin, source, format, signal);
		} catch (err: any) {
			if (signal?.aborted) throw new Error("aborted");
			if (err?.code === "ENOENT") continue;
			return { ok: false, kind: "environment", error: `mmdflux failed to start (${bin}): ${err?.message ?? String(err)}` };
		}
	}
	return { ok: false, kind: "environment", error: "mmdflux binary not found; set PI_MERMAID_MMDFLUX to its path" };
}

/** Diff the MMDS structure against the params. Returns a list of problems (empty = exact match). */
export function diffStructure(mmds: any, valid: ValidatedParams): string[] {
	const { type, params, ids, labels } = valid;
	const problems: string[] = [];
	const mNodes: any[] = Array.isArray(mmds?.nodes) ? mmds.nodes : [];
	const mEdges: any[] = Array.isArray(mmds?.edges) ? mmds.edges : [];
	const mLabel = (n: any) => String(n?.label ?? n?.id ?? "");
	// mmds renders <br/> as a real newline; compare in that form.
	const mmdsLabel = (label: string) => escapeLabel(label).replace(/<br\/>/g, "\n");
	const groupIds = new Set((params.groups ?? []).map((g) => ids.get(g.id) ?? g.id));

	if (type === "flowchart" || type === "classDiagram") {
		const expectedNodes = (type === "flowchart" ? params.nodes ?? [] : params.classes?.map((c) => ({ id: c.id, label: c.name })) ?? []);
		for (const n of expectedNodes) {
			const eid = ids.get(n.id) ?? n.id;
			const node = mNodes.find((x) => x?.id === eid);
			if (!node) { problems.push(`node "${n.id}" missing from rendered structure`); continue; }
			const want = type === "classDiagram" ? String(n.label ?? n.id) : mmdsLabel(labels.get(n.id) ?? n.id);
			if (type === "flowchart" && mLabel(node) !== want) problems.push(`node "${n.id}" rendered as "${mLabel(node)}" instead of "${want}"`);
			if (type === "classDiagram" && !mLabel(node).startsWith(String(n.label ?? n.id))) problems.push(`class "${n.id}" rendered as "${mLabel(node).split("\n")[0]}"`);
		}
		const expectedEdges = type === "flowchart" ? params.edges ?? [] : params.relations ?? [];
		for (const e of expectedEdges) {
			const from = ids.get(e.from) ?? e.from;
			const to = ids.get(e.to) ?? e.to;
			// Flowchart edges are directed truth: A->B is not B->A. Class
			// relations may come back in either orientation (`W <|-- B`), so
			// only they may fall back to a reversed match.
			const exact = (x: any) => x?.source === from && x?.target === to;
			const reversed = (x: any) => x?.source === to && x?.target === from;
			const hit = type === "flowchart" ? mEdges.find(exact) : (mEdges.find(exact) ?? mEdges.find(reversed));
			if (!hit) problems.push(`edge ${e.from}->${e.to} missing from rendered structure`);
			else if (e.label && String(hit.label ?? "") !== mmdsLabel(e.label)) problems.push(`edge ${e.from}->${e.to} label rendered as "${hit.label}" instead of "${escapeLabel(e.label)}"`);
		}
		for (const n of mNodes) {
			const declared = [...ids.values()].includes(n?.id);
			if (!declared && !groupIds.has(n?.id)) problems.push(`rendered structure invented node "${n?.id}"`);
		}
	} else if (type === "stateDiagram-v2") {
		const mapState = (raw: string) => (raw === "[*]" ? undefined : ids.get(raw) ?? raw);
		for (const s of params.states ?? []) {
			const sid = mapState(s.id) ?? "[*]";
			if (!mNodes.some((x) => x?.id === sid)) problems.push(`state "${s.id}" missing from rendered structure`);
		}
		for (const t of params.transitions ?? []) {
			const from = t.from === "[*]" ? "__root_start" : ids.get(t.from) ?? t.from;
			const to = t.to === "[*]" ? "__root_end" : ids.get(t.to) ?? t.to;
			const hit = mEdges.find((x) => x?.source === from && x?.target === to);
			if (!hit) problems.push(`transition ${t.from}->${t.to} missing from rendered structure`);
			else if (t.label && String(hit.label ?? "") !== mmdsLabel(t.label)) problems.push(`transition ${t.from}->${t.to} label rendered as "${hit.label}" instead of "${escapeLabel(t.label)}"`);
		}
	} else {
		// sequenceDiagram: MMDS exposes nothing; the art-containment check in
		// the execute path covers it against the rendered text.
	}
	return problems;
}

/** Every actor label and message text must appear in the rendered art. */
export function diffArtContainment(art: string, valid: ValidatedParams): string[] {
	const { params, labels } = valid;
	const problems: string[] = [];
	const flat = art.replace(/\s+/g, " ");
	for (const a of params.actors ?? []) {
		const want = escapeLabel(labels.get(a.id) ?? a.id).replace(/<br\/>/g, " ");
		if (!flat.includes(want)) problems.push(`actor "${a.id}" (label "${want}") not visible in rendered art`);
	}
	for (const [i, m] of (params.messages ?? []).entries()) {
		const want = escapeLabel(m.text).replace(/<br\/>/g, " ");
		if (!flat.includes(want)) problems.push(`message[${i}] text "${want}" not visible in rendered art`);
	}
	return problems;
}

// ── gate 3: grok-mermaid (the chat's own renderer) ──────────────────────

export type GrokRender =
	| { ok: true; width: number; warnings: string[]; art: string }
	| { ok: false; kind: "unavailable" | "crash"; error: string };

let grokRender: ((src: string) => any) | null | undefined;

async function loadGrok(): Promise<((src: string) => any) | null> {
	if (grokRender !== undefined) return grokRender;
	try {
		const mod: any = await import("grok-mermaid");
		grokRender = typeof mod?.render === "function" ? mod.render : null;
	} catch {
		grokRender = null;
	}
	return grokRender;
}

/** Render with the chat's own renderer. Width and warnings mirror the chat's display rules. */
export async function renderWithGrok(source: string): Promise<GrokRender> {
	const render = await loadGrok();
	if (!render) return { ok: false, kind: "unavailable", error: "grok-mermaid is not importable in this process" };
	try {
		const art = render(source);
		if (!art || typeof art.width !== "number") return { ok: false, kind: "crash", error: "grok-mermaid returned no art" };
		return {
			ok: true,
			width: art.width,
			warnings: (art.warnings ?? []).map(String),
			art: (art.plain ?? []).join("\n"),
		};
	} catch (err: any) {
		return { ok: false, kind: "crash", error: `grok-mermaid render crashed: ${err?.message ?? String(err)}` };
	}
}

/** The pane width the chat will render into: env override, else stdout columns minus chrome. */
export function paneWidth(): number {
	const env = Number(process.env.PI_MERMAID_WIDTH);
	if (Number.isFinite(env) && env >= 40) return Math.floor(env);
	const cols = (process.stdout as any)?.columns;
	if (typeof cols === "number" && cols >= 40) return Math.floor(cols - PANE_CHROME_COLS);
	return DEFAULT_PANE_WIDTH;
}

// ── tool ────────────────────────────────────────────────────────────────

interface MermaidDetails {
	source?: string;
	art?: string;
	width?: number;
	paneWidth?: number;
	ms?: number;
	path?: "structured" | "freeform";
	problems?: string[];
	error?: string;
}

const textContent = (text: string): { type: "text"; text: string }[] => [{ type: "text" as const, text }];

const NodeSchema = Type.Object({
	id: Type.String({ description: "Node id. Referenced by edges and group members." }),
	label: Type.Optional(Type.String({ description: "Label shown in the box. Copied verbatim. No double quotes. Omit to show the id." })),
});
const EdgeSchema = Type.Object({
	from: Type.String({ description: "Source node or group id." }),
	to: Type.String({ description: "Target node or group id." }),
	label: Type.Optional(Type.String({ description: "Edge label. No double quotes." })),
});

const MermaidParams = Type.Object({
	type: Type.Optional(Type.Union(SUPPORTED_DIAGRAM_TYPES.map((t) => Type.Literal(t)), { description: `Diagram type: ${SUPPORTED_DIAGRAM_TYPES.join(", ")}.` })),
	direction: Type.Optional(Type.Union([Type.Literal("TD"), Type.Literal("LR")], { description: "Layout direction. Prefer TD: the chat pane is narrow, height is free." })),
	nodes: Type.Optional(Type.Array(NodeSchema, { description: "flowchart nodes. Keep to ~7; cut before you crowd." })),
	edges: Type.Optional(Type.Array(EdgeSchema, { description: "flowchart edges, as data. Never invent one." })),
	groups: Type.Optional(Type.Array(Type.Object({
		id: Type.String({ description: "Group id; edges may target it." }),
		title: Type.String({ description: "Subgraph title shown on the box." }),
		members: Type.Array(Type.String(), { description: "Node ids inside this group." }),
	}), { description: "Optional zones/subgraphs." })),
	actors: Type.Optional(Type.Array(NodeSchema, { description: "sequenceDiagram actors." })),
	messages: Type.Optional(Type.Array(Type.Object({
		from: Type.String({ description: "Actor id." }),
		to: Type.String({ description: "Actor id." }),
		text: Type.String({ description: "Message text. No double quotes." }),
		dashed: Type.Optional(Type.Boolean({ description: "True for a dashed reply arrow." })),
	}), { description: "sequenceDiagram messages, in order." })),
	states: Type.Optional(Type.Array(NodeSchema, { description: "stateDiagram-v2 states." })),
	transitions: Type.Optional(Type.Array(EdgeSchema, { description: "stateDiagram-v2 transitions. [*] is the start/end pseudo-state." })),
	classes: Type.Optional(Type.Array(Type.Object({
		id: Type.String({ description: "Class id." }),
		name: Type.String({ description: "Class name shown in the box." }),
		members: Type.Optional(Type.Array(Type.String(), { description: "Member lines, e.g. \"+draw()\". No braces." })),
	}), { description: "classDiagram classes." })),
	relations: Type.Optional(Type.Array(Type.Object({
		from: Type.String({ description: "Class id." }),
		to: Type.String({ description: "Class id." }),
		kind: Type.Optional(Type.Union([Type.Literal("extends"), Type.Literal("implements"), Type.Literal("composition"), Type.Literal("aggregation"), Type.Literal("association"), Type.Literal("dependency")], { description: "Relation kind. Default association." })),
		label: Type.Optional(Type.String({ description: "Relation label." })),
	}), { description: "classDiagram relations." })),
	freeform: Type.Optional(Type.String({ description: "Escape hatch: hand-written Mermaid source, validated by the same gates. Use only when the structured params cannot express the diagram." })),
});

/** The custom message type that displays a validated diagram as a transcript row. */
export const MERMAID_DISPLAY_TYPE = "mermaid_diagram";

export default function (pi: ExtensionAPI) {
	// The diagram the user sees: a transcript row rendered from the persisted
	// custom message, never locked inside the tool-result row. Registered at
	// load so resumed sessions re-render their diagram rows too.
	pi.registerMessageRenderer(MERMAID_DISPLAY_TYPE, (message, options, theme) => {
		const details = message.details as MermaidDetails | undefined;
		if (!details?.art) return undefined;
		const header = theme.fg(
			"muted",
			`mermaid (validated: parse + structure + pane fit, ${details.ms} ms, ${details.width}/${details.paneWidth} cols)`,
		);
		const body = options.expanded
			? `${details.art}\n\n${theme.fg("dim", "```mermaid\n" + (details.source ?? "") + "\n```")}`
			: details.art;
		return new Text(header + "\n" + body, 0, 0);
	});

	pi.registerTool({
		name: "mermaid",
		description:
			"Generate a Mermaid diagram that is guaranteed to render in the chat. Pass nodes and edges as structured data; the tool emits canonical Mermaid syntax and enforces three local gates before returning: strict parse (mmdflux), exact structure match against your params, and pane fit with zero warnings on the chat's own renderer (grok-mermaid). The validated diagram is displayed to the user automatically as a transcript row — never write the fence in your reply. All checks are local: the call returns in under a second.",
		promptGuidelines: [
			"Call this tool instead of writing a mermaid fence inline.",
			"Pass the diagram as data: type, direction, nodes, edges. Labels are copied verbatim; the tool never shortens them.",
			"Keep diagrams small: about 7 nodes or fewer, short labels, prefer TD. The pane is narrow; height is free.",
			"On isError, fix exactly what the error names and call once more. Cut nodes or edges rather than shorten labels.",
			"The tool displays the validated diagram in the transcript automatically; do not write the fence in your reply.",
		],
		parameters: MermaidParams,

		async execute(_toolCallId, rawParams, signal) {
			const started = Date.now();
			const params = rawParams as MermaidParams;
			const pane = paneWidth();
			const fail = (error: string, extra?: Partial<MermaidDetails>) => ({
				isError: true as const,
				content: textContent(error),
				details: {
					error,
					ms: Date.now() - started,
					paneWidth: pane,
					path: freeformSource ? "freeform" : "structured",
					...extra,
				} satisfies MermaidDetails,
			});

			const freeformSource = params.freeform ? (extractMermaidSource(params.freeform) ?? params.freeform.trim()) : null;

			const validated = freeformSource ? null : validateParams(params);
			if (!freeformSource && !validated?.ok) return fail(`mermaid tool: invalid params: ${validated?.error ?? "nothing to draw"}`);
			const valid = validated?.ok ? validated.value : null;

			const runGates = async (source: string, directionForVariant?: Direction): Promise<
				{ ok: false; error: string; problems?: string[] } | { ok: true; width: number; warnings: string[]; art: string; mmdsArt: string }
			> => {
				// Gate 1: strict parse via mmdflux (MMDS output parses only on success).
				const mmds = await runMmdflux(source, "mmds", signal);
				if (!mmds.ok) {
					if (mmds.kind === "environment") return { ok: false, error: `environment failure, not retried: ${mmds.error}` };
					return {
						ok: false,
						error: freeformSource
							? `the source does not parse strictly (mmdflux): ${mmds.error}. Fix it and call once more.`
							: `internal emitter bug — validated params produced source that does not parse: ${mmds.error}. File an issue; do not retry.`,
					};
				}
				// mmdflux text art for the tool-result row (also a second parse confirmation).
				const textRun = await runMmdflux(source, "text", signal);
				if (!textRun.ok) return { ok: false, error: `environment failure in text render, not retried: ${textRun.ok === false ? textRun.error : ""}` };

				// Gate 2: exact structure match against the params.
				let problems: string[] = [];
				if (valid) {
					problems = valid.type === "sequenceDiagram"
						? diffArtContainment(textRun.ok ? textRun.art : "", valid)
						: diffStructure(mmds.mmds, valid);
					if (problems.length) {
						return { ok: false, error: `the rendered diagram does not match your params: ${problems.join("; ")}. Fix the params and call once more.`, problems };
					}
				}

				// Gate 3: the chat's own renderer — no crash, zero warnings, pane fit.
				const grok = await renderWithGrok(source);
				if (!grok.ok) {
					if (grok.kind === "unavailable") {
						// Cannot guarantee chat rendering without the chat renderer; fall back
						// to the mmdflux art width as the best local proxy and say so.
						const w = Math.max(...textRun.art.split("\n").map((l) => l.length), 0);
						if (w > pane) return { ok: false, error: `art is ${w} cols, pane is ${pane}. Cut nodes or shorten labels and call once more.` };
						return { ok: true, width: w, warnings: [], art: textRun.art, mmdsArt: textRun.art };
					}
					return { ok: false, error: `the chat renderer crashed on this source, so the chat would show raw text: ${grok.error}. Simplify the diagram and call once more.` };
				}
				if (grok.warnings.length > 0) {
					return { ok: false, error: `the chat renderer warns, so the chat would not draw it: ${grok.warnings.join("; ")}. Fix the named issue and call once more.` };
				}
				if (grok.width > pane) {
					if (directionForVariant === "LR") return { ok: false, error: `WIDTH_OVERRUN:${grok.width}` };
					return { ok: false, error: `art is ${grok.width} cols, pane is ${pane}. Cut nodes or shorten labels and call once more.` };
				}
				return { ok: true, width: grok.width, warnings: grok.warnings, art: grok.art, mmdsArt: textRun.art };
			};

			try {
				// Emit (or take freeform) and run the gates; one local TD variant on LR width overrun.
				let source = freeformSource ?? emitMermaid(valid!);
				const directionForVariant = valid?.direction ?? "TD";
				let gates = await runGates(source, directionForVariant);
				let reEmittedTD = false;
				if (!gates.ok && gates.error.startsWith("WIDTH_OVERRUN:")) {
					source = emitMermaid(valid!, "TD");
					gates = await runGates(source, "TD");
					reEmittedTD = true;
				}
				if (signal?.aborted) return fail("mermaid tool: aborted.");
				if (!gates.ok) return fail(`mermaid tool: ${gates.error.replace(/^WIDTH_OVERRUN:\d+/, "")}`, { problems: (gates as any).problems, source });
				const ms = Date.now() - started;
				// Display guarantee: a transcript row the user sees without expanding
				// anything. Mid-turn sendMessage with triggerTurn:false is deferred by
				// pi to a sanctioned boundary (turn_end), so it never lands between a
				// tool call and its result. Best-effort: the fence stays in the result.
				try {
					pi.sendMessage(
						{
							customType: MERMAID_DISPLAY_TYPE,
							content:
								"mermaid: the validated diagram is displayed to the user as a transcript row in this turn. " +
								"Do not write the fence in your reply. The source stays in the tool result for reference.",
							display: true,
							details: {
								source, art: gates.art, width: gates.width, paneWidth: pane, ms,
								path: freeformSource ? "freeform" : "structured",
							} satisfies MermaidDetails,
						},
						{ triggerTurn: false },
					);
				} catch {
					// Display is best-effort; the validated fence remains in the tool result.
				}
				return {
					content: textContent(
						`Mermaid diagram validated: strict parse, exact structure match, ${gates.width}/${pane} cols, zero renderer warnings (${ms} ms).` +
						(reEmittedTD ? " Re-emitted as TD to fit the pane; the fence below is TD." : "") + "\n\n" +
						"```mermaid\n" + source + "\n```\n\n" +
						"The diagram is displayed to the user automatically as a transcript row. Do not write the fence in your reply.",
					),
					details: {
						source, art: gates.art, width: gates.width, paneWidth: pane, ms,
						path: freeformSource ? "freeform" : "structured",
					} satisfies MermaidDetails,
				};
			} catch (err: any) {
				if (signal?.aborted) return fail("mermaid tool: aborted.");
				return fail(`mermaid tool: ${err?.message ?? String(err)}`);
			}
		},

		renderResult(result, _options, theme) {
			const details = result.details as MermaidDetails | undefined;
			if (details?.art) {
				const header = `mermaid (validated: parse + structure + pane fit, ${details.ms} ms, ${details.width}/${details.paneWidth} cols)`;
				return new Text(theme.fg("muted", header) + "\n" + details.art, 0, 0);
			}
			if (details?.error) {
				const problems = details.problems?.length ? `\n${details.problems.map((p) => `- ${p}`).join("\n")}` : "";
				return new Text(theme.fg("error", `mermaid rejected: ${details.error.slice(0, 300)}`) + problems, 0, 0);
			}
			const text = result.content?.[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});
}
