/**
 * decision-queue collector — pure data reads for the captain's decision queue.
 *
 * Two sources on the firstmate host (FM_HOME):
 *   1. state/*.status logs — open keyed needs-decision/blocked records.
 *      The fold below is a TypeScript port of the authoritative rule in
 *      firstmate bin/fm-classify-lib.sh (status_open_decisions /
 *      _fm_decision_fold_line): a needs-decision/blocked line OPENS a keyed
 *      decision; only an explicit resolved/captain-held line with the same key
 *      CLOSES it. Key grammar: optional "[key=<slug>]" before the first colon,
 *      or equivalently at note head; slug charset [A-Za-z0-9._-]+; no token
 *      means key "default". Reserved "pending-reply-*" keys only transition
 *      when the note speaks that namespace's vocabulary.
 *   2. data/backlog.md — unchecked items tagged "(kind: captain)", i.e. tasks
 *      whose WORK is the captain's decision. Selection is deliberately on
 *      "kind", not "hold-kind" (captain's call 2026-08-18): a ship/scout task
 *      merely parked behind him carries "(hold-kind: captain)" too, and those
 *      linger in the backlog after his order already settled them — they showed
 *      up here as decisions he had de facto closed. "kind: captain" is the
 *      task's own identity, so it cannot go stale that way.
 *      Independently, any HELD backlog slug parks the matching lane's open
 *      decisions (rendered dim), e.g. a lane held by captain order.
 *
 * No pi imports here on purpose: this module is loadable standalone (jiti)
 * for testing against live firstmate data.
 */

import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";

export interface DecisionItem {
	source: "lane" | "backlog";
	/** task id (status log basename) or backlog slug */
	lane: string;
	/** decision key; "default" when unkeyed; backlog items use the slug */
	key: string;
	verb: "needs-decision" | "blocked" | "captain-hold";
	note: string;
	file?: string;
	line?: number;
	/** true when the owning lane/task is itself held in the backlog */
	parked: boolean;
}

const OPEN_VERBS = new Set(["needs-decision", "blocked"]);
const CLOSE_VERBS = new Set(["resolved", "captain-held"]);
const RESERVED_PREFIXES = ["pending-reply-"];
const SLUG = /^[A-Za-z0-9._-]+$/;

/** leading verb word: text before the first colon, minus any [tag] run */
export function statusLineVerb(line: string): string {
	const ci = line.indexOf(":");
	let v = ci === -1 ? line : line.slice(0, ci);
	const bi = v.indexOf("[");
	if (bi !== -1) v = v.slice(0, bi);
	return v.trim();
}

/**
 * Extract { key, note } from one status line, or null when a stated key slug
 * is malformed (the folds skip such lines rather than rewriting to "default").
 */
export function parseKeyNote(line: string): { key: string; note: string } | null {
	const ci = line.indexOf(":");
	const beforeColon = ci === -1 ? line : line.slice(0, ci);
	const beforeM = beforeColon.match(/\[key=([^\]]+)\]/);
	let key: string | null = null;
	let fromNoteHead = false;
	if (beforeM) {
		key = beforeM[1]!;
	} else if (ci !== -1) {
		const rest = line.slice(ci + 1).trim();
		const hm = rest.match(/^\[key=([^\]]+)\]/);
		if (hm) {
			key = hm[1]!;
			fromNoteHead = true;
		}
	}
	if (key === null) key = "default";
	if (!SLUG.test(key)) return null;
	let note = ci === -1 ? line.trim() : line.slice(ci + 1).trim();
	if (fromNoteHead) note = note.replace(/^\[key=[^\]]+\]\s*/, "");
	return { key, note };
}

/** reserved namespaces only open/close when the note speaks their vocabulary */
function transitionAllowed(key: string, note: string): boolean {
	for (const p of RESERVED_PREFIXES) {
		if (key.startsWith(p)) return note.startsWith(p) && note.includes(":");
	}
	return true;
}

export interface OpenRecord {
	key: string;
	verb: string;
	note: string;
	/** 1-based line number where the currently-open record was opened */
	line: number;
}

/**
 * Fold one status log's text into still-open decisions.
 * Most-recently-opened-last, matching status_open_decisions.
 */
export function foldStatusText(text: string): OpenRecord[] {
	let open: OpenRecord[] = [];
	text.split("\n").forEach((line, i) => {
		if (!line.replace(/\s/g, "")) return;
		const verb = statusLineVerb(line);
		const kn = parseKeyNote(line);
		if (!kn || !transitionAllowed(kn.key, kn.note)) return;
		if (OPEN_VERBS.has(verb)) {
			open = open.filter((r) => r.key !== kn.key);
			open.push({ key: kn.key, verb, note: kn.note, line: i + 1 });
		} else if (CLOSE_VERBS.has(verb)) {
			open = open.filter((r) => r.key !== kn.key);
		}
	});
	return open;
}

export interface BacklogHold {
	slug: string;
	title: string;
	hold: string;
	line: number;
}

/**
 * Split one backlog line's trailing "(name: value)" tag run.
 *
 * Values are free prose: they carry " - ", colons, and balanced parentheses
 * ("Branch preserved (unlanded)"). Two shapes exist in live data — "(kind:
 * captain)" and "(since 2026-08-15)" — so a value cannot be delimited by the
 * next "(name: " opener either: "since" has no colon and would be swallowed
 * into "kind". Groups are therefore split by paren DEPTH, which is exactly the
 * structure the backlog writes, and each top-level group is then read as
 * "name: value" or "name value".
 * Returns the tag map plus the index where the tag run begins (title cutoff).
 */
export function parseTags(line: string): { tags: Map<string, string>; tagStart: number } {
	const tags = new Map<string, string>();
	let tagStart = line.length;
	let depth = 0;
	let open = -1;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "(") {
			if (depth === 0) open = i;
			depth++;
			continue;
		}
		if (ch !== ")" || depth === 0) continue;
		depth--;
		if (depth !== 0 || open === -1) continue;
		const group = line.slice(open + 1, i);
		const m = group.match(/^([A-Za-z][A-Za-z-]*):?\s+([\s\S]*)$/);
		if (m) {
			if (!tags.has(m[1]!)) tags.set(m[1]!, m[2]!.trim());
			if (open < tagStart) tagStart = open;
		}
		open = -1;
	}
	return { tags, tagStart };
}

export function parseBacklog(text: string): {
	captainHolds: BacklogHold[];
	parkedSlugs: Set<string>;
} {
	const captainHolds: BacklogHold[] = [];
	const parkedSlugs = new Set<string>();
	text.split("\n").forEach((raw, i) => {
		const m = raw.match(/^- \[ \] (\S+) - (.*)$/);
		if (!m) return;
		const slug = m[1]!;
		const { tags, tagStart } = parseTags(raw);
		const hold = tags.get("hold") ?? "";
		// Any held task parks its lane's decisions, whatever the task's kind.
		if (hold) parkedSlugs.add(slug);
		// The queue itself lists only tasks that ARE a captain decision.
		if (tags.get("kind") !== "captain") return;
		const title = raw.slice(raw.indexOf(" - ") + 3, tagStart).trim();
		captainHolds.push({ slug, title, hold, line: i + 1 });
	});
	return { captainHolds, parkedSlugs };
}

/** Fresh full read of both sources. Cheap: a few small text files. */
export function collectDecisions(fmHome: string): DecisionItem[] {
	const items: DecisionItem[] = [];
	const stateDir = join(fmHome, "state");
	const backlogPath = join(fmHome, "data", "backlog.md");

	let parkedSlugs = new Set<string>();
	let captainHolds: BacklogHold[] = [];
	try {
		const parsed = parseBacklog(readFileSync(backlogPath, "utf8"));
		parkedSlugs = parsed.parkedSlugs;
		captainHolds = parsed.captainHolds;
	} catch {
		/* backlog unreadable — lane scan still works */
	}

	let files: string[] = [];
	try {
		files = readdirSync(stateDir)
			.filter((f) => f.endsWith(".status"))
			.sort();
	} catch {
		/* state dir unreadable */
	}
	for (const f of files) {
		const full = join(stateDir, f);
		try {
			if (lstatSync(full).isSymbolicLink()) continue; // mirrors the lib's [ -L ] rejection
		} catch {
			continue;
		}
		const task = f.slice(0, -".status".length);
		let text: string;
		try {
			text = readFileSync(full, "utf8");
		} catch {
			continue;
		}
		for (const rec of foldStatusText(text)) {
			items.push({
				source: "lane",
				lane: task,
				key: rec.key,
				verb: rec.verb as "needs-decision" | "blocked",
				note: rec.note,
				file: full,
				line: rec.line,
				parked: parkedSlugs.has(task),
			});
		}
	}
	for (const h of captainHolds) {
		items.push({
			source: "backlog",
			lane: h.slug,
			key: h.slug,
			verb: "captain-hold",
			note: h.hold ? `${h.title} — hold: ${h.hold}` : h.title,
			file: backlogPath,
			line: h.line,
			parked: false,
		});
	}
	return items;
}

/**
 * Canonical closing line for a keyed lane decision.
 *
 * The key token MUST sit in the documented before-colon position (or, as an
 * accepted equivalent, at the very head of the note). A token further inside
 * the note is prose: fm-classify-lib.sh states that a summary merely MENTIONING
 * "[key=x]" can neither open nor close that decision. So a trailing
 * "resolved: <choice> [key=x]" silently closes "default" and leaves the real
 * decision open forever — it keeps resurfacing in /decisions after the captain
 * already answered it. This helper is the one place that shape is written, and
 * it matches what fm-send.sh --resolve-key appends ("resolved [key=<k>]: ...").
 */
export function resolvedLine(key: string, note = ""): string {
	const head = key === "default" ? "resolved:" : `resolved [key=${key}]:`;
	return note ? `${head} ${note}` : `${head} `;
}

/** Where the captain acts on this item, in one line. */
export function answerHint(it: DecisionItem): string {
	if (it.source === "lane") {
		const keyPart = it.key === "default" ? "" : ` --resolve-key ${it.key}`;
		return `fm-send.sh ${it.lane}${keyPart} <answer>   ·   or append: ${resolvedLine(it.key, "<how>")}`;
	}
	return `captain's call — resolve hold "${it.lane}" via firstmate bin/fm-decision-hold.sh resolve`;
}

/** Prefill for the pi editor when the captain picks an item. */
export function editorTemplate(it: DecisionItem): string {
	if (it.source === "lane") return resolvedLine(it.key);
	return `decision on ${it.lane}: `;
}
