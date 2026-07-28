import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";
import { CURSOR_MARKER, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

const WIDGET = "transcript-scroll";
const STATE = Symbol.for("pi.transcript-scroll");
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1000l";
const MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;
const STATUS = "transcript-link";

type Timer = ReturnType<typeof setTimeout>;
type Adapters = {
	clipboard: { write(value: string): Promise<void> };
	neovim: { open(argv: string[]): Promise<void> };
	clock: { setTimeout(fn: () => void, delay: number): Timer; clearTimeout(timer: Timer): void };
	vaultRoot: string;
	nvimServer?: string;
};

function run(argv: string[], input?: string): Promise<void> {
	return new Promise((resolveRun, reject) => {
		const child = spawn(argv[0], argv.slice(1), { stdio: [input === undefined ? "ignore" : "pipe", "ignore", "ignore"] });
		const timer = setTimeout(() => child.kill(), 1000);
		child.once("error", reject);
		child.once("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${argv[0]} exited ${code}`)));
		child.once("close", () => clearTimeout(timer));
		if (input !== undefined) child.stdin.end(input);
	});
}

const productionAdapters: Adapters = {
	clipboard: {
		async write(value) {
			if (process.platform === "darwin") return run(["pbcopy"], value);
			if (process.stdout.isTTY) {
				process.stdout.write(`\x1b]52;c;${Buffer.from(value).toString("base64")}\x07`);
				return;
			}
			throw new Error("Clipboard unavailable");
		},
	},
	neovim: { open: (argv) => run(["nvim", ...argv]) },
	clock: { setTimeout, clearTimeout },
	vaultRoot: "/Users/aviral/vault",
	nvimServer: process.env.NVIM,
};
let adapters = productionAdapters;

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
	statusTimer?: Timer;
	clearStatus(): void;
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

export const __transcriptLinks = {
	resolveWikilink,
	configureForTest(injected: Adapters) { adapters = injected; },
};

function isTerminalReply(data: string): boolean {
	return (
		/^\x1b\[6;\d+;\d+t$/.test(data) ||
		/^\x1b\[(?:\?|>)[\d;]*[cnu]$/.test(data) ||
		/^\x1b\](?:10|11);.*(?:\x07|\x1b\\)$/.test(data)
	);
}

function install(tui: TUI, dim: (text: string) => string, setStatus: (key: string, value?: string) => void): () => void {
	const target = tui as StatefulTui;
	target[STATE]?.cleanup();

	let cleaned = false;
	const state: ScrollState = {
		follow: true,
		visibleLinks: new Map(),
		viewportEnd: 0,
		transcriptLines: 0,
		pageLines: 3,
		clearStatus: () => {},
		originalRender: tui.render,
		patchedRender: () => [],
		cleanup: () => {},
	};

	state.clearStatus = () => {
		if (state.statusTimer !== undefined) adapters.clock.clearTimeout(state.statusTimer);
		state.statusTimer = undefined;
		setStatus(STATUS, undefined);
	};
	const report = (message: string, transient = false) => {
		state.clearStatus();
		setStatus(STATUS, message);
		if (transient) state.statusTimer = adapters.clock.setTimeout(state.clearStatus, 1500);
	};

	const act = async (span: LinkSpan) => {
		try {
			const url = new URL(span.destination);
			if (url.protocol === "https:") {
				await adapters.clipboard.write(span.destination);
				report(`Copied ${url.hostname}`, true);
				return;
			}
			if (url.protocol !== "file:") return;
			const file = decodeURIComponent(url.pathname);
			const root = resolve(adapters.vaultRoot);
			if (file !== root && !file.startsWith(`${root}${sep}`)) return;
			if (!adapters.nvimServer) throw new Error("NVIM server unavailable");
			const fragment = decodeURIComponent(url.hash.slice(1));
			const location = fragment.startsWith("L") && /^L\d+$/u.test(fragment)
				? `:${fragment.slice(1)}`
				: fragment.startsWith("^") ? `:block:${fragment.slice(1)}` : fragment ? `:heading:${fragment}` : "";
			await adapters.neovim.open(["--server", adapters.nvimServer, "--remote", file, location]);
		} catch (error) {
			report(error instanceof Error && /NVIM|nvim/u.test(error.message) ? `Neovim: ${error.message}` : "Clipboard unavailable");
		}
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
		const editorRoot = rendered.findIndex((lines) => lines.some((line) => line.includes(CURSOR_MARKER)));
		if (editorRoot < 0) {
			state.visibleLinks.clear();
			return allLines;
		}

		const transcriptLength = rendered.slice(0, editorRoot).flat().length;
		const transcript = allLines.slice(0, transcriptLength);
		const fixed = allLines.slice(transcriptLength);
		state.transcriptLines = transcript.length;
		state.pageLines = Math.max(3, height - fixed.length - 1);

		let output = allLines;
		if (!state.follow && !tui.hasOverlay()) {
			if (state.viewportEnd > transcript.length || transcript.length - state.viewportEnd <= 0) {
				state.follow = true;
				state.viewportEnd = 0;
			} else {
				const start = Math.max(0, state.viewportEnd - state.pageLines);
				const indicator = truncateToWidth(dim(`↓ ${transcript.length - state.viewportEnd} lines below`), width, "");
				output = [...transcript.slice(start, state.viewportEnd), indicator, ...fixed];
			}
		}
		state.visibleLinks.clear();
		for (let row = 0; row < output.length; row++) {
			const spans: LinkSpan[] = [];
			for (const match of output[row].matchAll(OSC_LINK)) {
				const startCell = visibleWidth(output[row].slice(0, match.index));
				spans.push({ destination: match[1], row, startCell, endCell: startCell + visibleWidth(match[2]) });
			}
			if (spans.length) state.visibleLinks.set(row, spans);
		}
		return output;
	};

	const removeInputListener = tui.addInputListener((data) => {
		const mouse = data.match(MOUSE);
		if (mouse) {
			if (tui.hasOverlay()) return { consume: true };
			const button = Number(mouse[1]);
			const wheel = button & 64;
			if (!wheel) {
				if (mouse[4] === "M" && button === 0) {
					const x = Number(mouse[2]) - 1;
					const span = state.visibleLinks.get(Number(mouse[3]) - 1)?.find((item) => x >= item.startCell && x < item.endCell);
					if (span) void act(span);
				}
				return { consume: true };
			}
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
		state.clearStatus();
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
			const cleanup = install(tui, (text) => theme.fg("dim", text), (key, value) => ctx.ui.setStatus?.(key, value));
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
