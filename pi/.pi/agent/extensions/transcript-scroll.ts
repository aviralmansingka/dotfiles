import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";
import { CURSOR_MARKER, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

const WIDGET = "transcript-scroll";
const STATE = Symbol.for("pi.transcript-scroll");
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1000l";
const MOUSE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;

interface LinkSpan {
	destination: string;
	row: number;
	startCell: number;
	endCell: number;
}

interface ScrollState {
	cleanup(): void;
	follow: boolean;
	visibleLinks: Map<number, LinkSpan[]>;
	viewportEnd: number;
	transcriptLines: number;
	pageLines: number;
	width?: number;
	height?: number;
	originalRender: TUI["render"];
	patchedRender: TUI["render"];
}

type StatefulTui = TUI & { [key: symbol]: ScrollState | undefined };

const OSC_LINK = /\x1b\]8;;([^\x1b]*)\x1b\\([\s\S]*?)\x1b\]8;;\x1b\\/gu;
const ANSI = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/gu;

function destinationParts(destination: string): string[] {
	try {
		const url = new URL(destination);
		return decodeURIComponent(url.pathname).split("/").filter(Boolean);
	} catch {
		return [];
	}
}

function compactRenderedLinks(lines: string[]): string[] {
	const occurrences: Array<{ destination: string; label: string; row: number; start: number; end: number; body: string }> = [];
	for (let row = 0; row < lines.length; row++) {
		for (const match of lines[row].matchAll(OSC_LINK)) {
			occurrences.push({ destination: match[1], label: match[2].replace(ANSI, ""), row, start: match.index, end: match.index + match[0].length, body: match[2] });
		}
	}
	const groups: typeof occurrences[] = [];
	for (const occurrence of occurrences) {
		const group = groups.at(-1);
		if (group?.[0]?.destination === occurrence.destination) group.push(occurrence);
		else groups.push([occurrence]);
	}
	const candidates = groups.filter((group) => {
		const label = group.map((item) => item.label).join("");
		const parts = destinationParts(group[0].destination);
		return label === group[0].destination || label === parts.at(-1);
	});
	const replacements = new Map<(typeof occurrences)[number], string>();
	for (const group of candidates) {
		const destination = group[0].destination;
		const url = new URL(destination);
		const parts = destinationParts(destination);
		let label = url.protocol === "https:" && !parts.length ? url.hostname : parts.at(-1) ?? destination;
		const peers = candidates.filter((peer) => peer[0].destination !== destination && destinationParts(peer[0].destination).at(-1) === parts.at(-1));
		let depth = 1;
		while (peers.some((peer) => destinationParts(peer[0].destination).slice(-depth).join("/") === parts.slice(-depth).join("/"))) depth++;
		if (parts.length) label = parts.slice(-depth).join("/");
		group.forEach((item, index) => replacements.set(item, index === 0 ? label : ""));
	}
	const output = [...lines];
	for (const row of new Set(occurrences.map((item) => item.row))) {
		let line = output[row];
		for (const item of occurrences.filter((value) => value.row === row).reverse()) {
			const replacement = replacements.get(item);
			if (replacement === undefined) continue;
			const prefix = item.body.match(/^(?:\x1b\[[0-?]*[ -/]*[@-~])*/u)?.[0] ?? "";
			const suffix = item.body.match(/(?:\x1b\[[0-?]*[ -/]*[@-~])*$/u)?.[0] ?? "";
			const body = `${prefix}${replacement}${suffix}`;
			const full = `\x1b]8;;${item.destination}\x1b\\${body}\x1b]8;;\x1b\\`;
			line = line.slice(0, item.start) + full + line.slice(item.end);
		}
		output[row] = line;
	}
	return output;
}

async function resolveWikilink({ text, vaultRoot, sourceFile }: { text: string; vaultRoot: string; sourceFile?: string }) {
	const match = /^\[\[([^\]|]*?)(?:\|([^\]]+))?\]\]$/u.exec(text);
	if (!match) return { status: "unsupported" };
	const [note, target] = (match[1] ?? "").split("#", 2);
	if (!note) return sourceFile && target ? { status: "resolved", target } : { status: "missing" };
	if (isAbsolute(note) || note.split(/[\\/]/u).includes("..")) return { status: "rejected" };

	const root = await realpath(vaultRoot);
	const requested = note.includes("/") ? resolve(root, extname(note) ? note : `${note}.md`) : undefined;
	let file: string | undefined;
	if (requested) {
		try {
			const canonical = await realpath(requested);
			if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) return { status: "rejected" };
			file = canonical;
		} catch {
			return { status: "missing" };
		}
	} else {
		const matches: string[] = [];
		const walk = async (directory: string): Promise<void> => {
			for (const entry of await readdir(directory, { withFileTypes: true })) {
				const path = resolve(directory, entry.name);
				if (entry.isSymbolicLink()) continue;
				if (entry.isDirectory()) await walk(path);
				else if (entry.isFile() && extname(entry.name) === ".md" && basename(entry.name, ".md") === note) matches.push(path);
			}
		};
		await walk(root);
		if (matches.length > 1) return { status: "ambiguous" };
		if (!matches.length) return { status: "missing" };
		file = matches[0];
	}
	return target
		? { status: "resolved", target }
		: { status: "resolved", file, ...(match[2] ? { display: match[2] } : {}) };
}

export const __transcriptLinks = { resolveWikilink };

function isTerminalReply(data: string): boolean {
	return (
		/^\x1b\[6;\d+;\d+t$/.test(data) ||
		/^\x1b\[(?:\?|>)[\d;]*[cnu]$/.test(data) ||
		/^\x1b\](?:10|11);.*(?:\x07|\x1b\\)$/.test(data)
	);
}

function install(tui: TUI, dim: (text: string) => string): () => void {
	const target = tui as StatefulTui;
	target[STATE]?.cleanup();

	let cleaned = false;
	const state: ScrollState = {
		follow: true,
		visibleLinks: new Map(),
		viewportEnd: 0,
		transcriptLines: 0,
		pageLines: 3,
		originalRender: tui.render,
		patchedRender: () => [],
		cleanup: () => {},
	};

	const resumeFollow = (force: boolean) => {
		if (state.follow) return;
		state.follow = true;
		state.viewportEnd = 0;
		tui.requestRender(force);
	};

	state.patchedRender = (width: number): string[] => {
		if (!Array.isArray(tui.children)) {
			state.visibleLinks.clear();
			return state.originalRender.call(tui, width);
		}
		const height = tui.terminal.rows;
		const resized = state.width !== undefined && (state.width !== width || state.height !== height);
		state.width = width;
		state.height = height;
		if (resized) {
			state.follow = true;
			state.viewportEnd = 0;
		}

		const rendered = tui.children.map((child) => child.render(width));
		const allLines = compactRenderedLinks(rendered.flat());
		state.visibleLinks.clear();
		for (let row = 0; row < allLines.length; row++) {
			const spans: LinkSpan[] = [];
			for (const match of allLines[row].matchAll(OSC_LINK)) {
				const before = allLines[row].slice(0, match.index).replace(ANSI, "");
				const label = match[2].replace(ANSI, "");
				spans.push({ destination: match[1], row, startCell: visibleWidth(before), endCell: visibleWidth(before) + visibleWidth(label) });
			}
			if (spans.length) state.visibleLinks.set(row, spans);
		}
		const editorRoot = rendered.findIndex((lines) => lines.some((line) => line.includes(CURSOR_MARKER)));
		if (editorRoot < 0) return allLines;

		const transcriptLength = rendered.slice(0, editorRoot).flat().length;
		const transcript = allLines.slice(0, transcriptLength);
		const fixed = allLines.slice(transcriptLength);
		state.transcriptLines = transcript.length;
		state.pageLines = Math.max(3, height - fixed.length - 1);

		if (state.follow || tui.hasOverlay()) return allLines;
		if (state.viewportEnd > transcript.length) {
			state.follow = true;
			state.viewportEnd = 0;
			return allLines;
		}

		const below = transcript.length - state.viewportEnd;
		if (below <= 0) {
			state.follow = true;
			state.viewportEnd = 0;
			return allLines;
		}

		const start = Math.max(0, state.viewportEnd - state.pageLines);
		const indicator = truncateToWidth(dim(`↓ ${below} lines below`), width, "");
		return [...transcript.slice(start, state.viewportEnd), indicator, ...fixed];
	};

	const removeInputListener = tui.addInputListener((data) => {
		const mouse = data.match(MOUSE);
		if (mouse) {
			if (tui.hasOverlay()) return { consume: true };
			const button = Number(mouse[1]);
			const wheel = button & 64;
			if (!wheel) return { consume: true };
			const amount = button & 4 ? state.pageLines : 3;
			const direction = button & 3;

			if (direction === 0 && state.transcriptLines > 0) {
				if (state.follow) {
					state.follow = false;
					state.viewportEnd = Math.max(0, state.transcriptLines - amount);
					tui.requestRender(true);
				} else {
					state.viewportEnd = Math.max(0, state.viewportEnd - amount);
					tui.requestRender();
				}
			} else if (direction === 1 && !state.follow) {
				state.viewportEnd = Math.min(state.transcriptLines, state.viewportEnd + amount);
				if (state.viewportEnd === state.transcriptLines) resumeFollow(true);
				else tui.requestRender();
			}
			return { consume: true };
		}

		if (!tui.hasOverlay() && !state.follow && data.length > 0 && !isTerminalReply(data)) {
			resumeFollow(true);
		}
		return undefined;
	});

	state.cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		removeInputListener();
		state.visibleLinks.clear();
		tui.terminal.write(DISABLE_MOUSE);
		if (tui.render === state.patchedRender) tui.render = state.originalRender;
		if (target[STATE] === state) delete target[STATE];
		state.follow = true;
		state.viewportEnd = 0;
		state.transcriptLines = 0;
	};

	target[STATE] = state;
	tui.render = state.patchedRender;
	tui.terminal.write(ENABLE_MOUSE);
	tui.requestRender(true);
	return state.cleanup;
}

class CaptureWidget implements Component {
	constructor(private readonly disposeCapture: () => void) {}
	render(): string[] {
		return [];
	}
	invalidate(): void {}
	dispose(): void {
		this.disposeCapture();
	}
}

export default function transcriptScroll(pi: ExtensionAPI): void {
	let activeTui: TUI | undefined;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(WIDGET, (tui, theme) => {
			activeTui = tui;
			const cleanup = install(tui, (text) => theme.fg("dim", text));
			return new CaptureWidget(() => {
				cleanup();
				if (activeTui === tui) activeTui = undefined;
			});
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const tui = activeTui;
		activeTui = undefined;
		(tui as StatefulTui | undefined)?.[STATE]?.cleanup();
		ctx.ui.setWidget(WIDGET, undefined);
	});
}
