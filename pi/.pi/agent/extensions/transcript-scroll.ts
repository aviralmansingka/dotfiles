import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";

const WIDGET = "transcript-scroll";
const STATE = Symbol.for("pi.transcript-scroll");
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1000l";
const MOUSE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;

interface ScrollState {
	cleanup(): void;
	follow: boolean;
	viewportEnd: number;
	transcriptLines: number;
	pageLines: number;
	width?: number;
	height?: number;
	originalRender: TUI["render"];
	patchedRender: TUI["render"];
}

type StatefulTui = TUI & { [key: symbol]: ScrollState | undefined };

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
		const height = tui.terminal.rows;
		const resized = state.width !== undefined && (state.width !== width || state.height !== height);
		state.width = width;
		state.height = height;
		if (resized) {
			state.follow = true;
			state.viewportEnd = 0;
		}

		const rendered = tui.children.map((child) => child.render(width));
		const allLines = rendered.flat();
		const editorRoot = rendered.findIndex((lines) => lines.some((line) => line.includes(CURSOR_MARKER)));
		if (editorRoot < 0) return allLines;

		const transcript = rendered.slice(0, editorRoot).flat();
		const fixed = rendered.slice(editorRoot).flat();
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
