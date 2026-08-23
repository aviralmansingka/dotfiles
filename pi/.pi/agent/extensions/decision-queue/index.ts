/**
 * decision-queue — /decisions interactive 2-column view of the captain's
 * open decision queue across firstmate-supervised work.
 *
 * Prototype (branch proto/pi-decision-queue, scout task pi-decision-queue-scout).
 * Requirements gathered live from the captain 2026-08-17:
 *   Q1 both sources (lane status decisions + captain-held backlog)
 *   Q2 firstmate primary pi (prototype loads wherever symlinked)
 *   Q3 slash command first, widget later
 *   Q4 fresh read on every invocation (collectDecisions re-reads files)
 *   Q5 interactive 2-column list with active element (approved ANSI mock)
 *   + captain styling order: "stylize it and make it have more colors"
 *     (v2: full gruvbox frame, per-verb colors, pink/purple accents)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { matchesKey, Key, visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import {
	collectDecisions,
	answerHint,
	editorTemplate,
	type DecisionItem,
} from "./collect.js";

const FM_HOME = process.env.FM_HOME ?? "/home/avirus/projects/firstmate";
const MAX_VISIBLE = 10;

type Theme = {
	fg: (color: string, s: string) => string;
	bg: (color: string, s: string) => string;
	bold: (s: string) => string;
	italic: (s: string) => string;
};

function padVisible(s: string, w: number): string {
	const gap = w - visibleWidth(s);
	return gap > 0 ? s + " ".repeat(gap) : s;
}

function wrapText(text: string, w: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let cur = "";
	for (const word of words) {
		if (cur && cur.length + 1 + word.length > w) {
			lines.push(cur);
			cur = word;
		} else {
			cur = cur ? `${cur} ${word}` : word;
		}
	}
	if (cur) lines.push(cur);
	return lines.length ? lines : [""];
}

/** verb → glyph + theme color (gruvbox-material: yellow / red / blue) */
function verbStyle(t: Theme, verb: DecisionItem["verb"]): { glyph: string; colored: string } {
	if (verb === "needs-decision") return { glyph: "?", colored: t.fg("warning", "?") };
	if (verb === "blocked") return { glyph: "!", colored: t.fg("error", "!") };
	return { glyph: "*", colored: t.fg("borderAccent", "*") };
}

function shortLabel(it: DecisionItem): string {
	if (it.source === "lane") return it.key === "default" ? "(unkeyed)" : it.key;
	// Backlog decision slugs are "<originating-task>-decision-<what>"; the tail is
	// the distinguishing part and the shared prefix just eats the column. The full
	// slug stays visible in the detail pane.
	return it.lane.replace(/^.*-decision-/, "");
}

class DecisionQueueView {
	private items: DecisionItem[];
	private selected = 0;
	private cachedWidth = 0;
	private cachedLines: string[] | null = null;

	constructor(
		private tui: { requestRender: () => void },
		private theme: Theme,
		private onDone: (item: DecisionItem | null) => void,
		private recollect: () => DecisionItem[],
	) {
		this.items = recollect();
	}

	private move(delta: number): void {
		const next = this.selected + delta;
		if (next < 0 || next >= this.items.length) return;
		this.selected = next;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up) || data === "k") this.move(-1);
		else if (matchesKey(data, Key.down) || data === "j") this.move(1);
		else if (matchesKey(data, Key.escape) || data === "q") return this.onDone(null);
		else if (matchesKey(data, Key.enter)) {
			return this.onDone(this.items[this.selected] ?? null);
		} else if (data === "r") {
			this.items = this.recollect();
			if (this.selected >= this.items.length) {
				this.selected = Math.max(0, this.items.length - 1);
			}
		} else return;
		this.invalidate();
		this.tui.requestRender();
	}

	/** left queue cell; selected row = per-segment selectedBg so inner colors survive */
	private leftCell(it: DecisionItem, isSelected: boolean, leftW: number): string {
		const t = this.theme;
		const { glyph, colored } = verbStyle(t, it.verb);
		const lane = (it.source === "lane" ? it.lane.slice(0, 8) : "backlog").padEnd(8);
		const label = truncateToWidth(shortLabel(it), leftW - 13, "");

		if (isSelected) {
			const seg = (s: string) => t.bg("selectedBg", s);
			const row =
				seg(t.fg("accent", t.bold(">"))) +
				seg(" ") +
				seg(colored) +
				seg(" ") +
				seg(t.fg("muted", lane)) +
				seg(" ") +
				seg(t.bold(label));
			const pad = leftW - (1 + 1 + 1 + 1 + 8 + 1 + visibleWidth(label));
			return row + seg(" ".repeat(Math.max(0, pad)));
		}
		if (it.parked) {
			const plain = truncateToWidth(`  ${glyph} ${lane} ${label}`, leftW, "");
			return t.fg("dim", padVisible(plain, leftW));
		}
		const row = `  ${colored} ${t.fg("muted", lane)} ${t.fg("text", label)}`;
		return padVisible(row, leftW);
	}

	private detail(it: DecisionItem | undefined, rightW: number): string[] {
		const t = this.theme;
		if (!it) return [t.fg("dim", "queue is clear")];
		const pink = (s: string) => t.fg("customMessageLabel", s);
		const out: string[] = [];
		const push = (s: string) => out.push(padVisible(truncateToWidth(s, rightW), rightW));
		const label = (k: string, v: string) => push(" " + pink(k.padEnd(7)) + v);
		const { colored } = verbStyle(t, it.verb);
		label("lane", t.fg("text", it.lane));
		label(
			"kind",
			it.source === "lane"
				? `${colored} ${it.verb} ${t.fg("dim", "·")} ${t.fg("syntaxNumber", `key=${it.key}`)}`
				: `${colored} captain decision ${t.fg("dim", "·")} ${t.fg("dim", "backlog")}`,
		);
		if (it.file) {
			const rel = it.file.replace(/^\/home\/[^/]+\/projects\//, "~/");
			label("src", t.fg("mdLink", `${rel}${it.line ? `:${it.line}` : ""}`));
		}
		if (it.parked) push(t.fg("dim", t.italic(" (lane parked — backlog hold on this task)")));
		push("");
		for (const wl of wrapText(it.note, rightW - 2)) push(t.fg("text", ` ${wl}`));
		push("");
		push(" " + t.fg("success", t.bold("answer ")) + t.fg("borderAccent", answerHint(it)));
		return out;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const t = this.theme;
		const dim = (s: string) => t.fg("dim", s);
		const frame = (s: string) => t.fg("borderMuted", s);
		const W = Math.max(width, 60);
		const leftW = Math.min(48, Math.max(30, Math.floor(W * 0.4)));
		const rightW = W - leftW - 3;

		const lines: string[] = [];

		// header
		const live = this.items.filter((i) => !i.parked).length;
		const parkedN = this.items.length - live;
		const header =
			" " +
			t.fg("accent", t.bold("captain's decision queue")) +
			"  " +
			t.fg("warning", t.bold(`${this.items.length} open`)) +
			dim(` (${live} live · ${parkedN} parked)`) +
			dim("  ·  state/*.status + backlog.md");
		lines.push(padVisible(truncateToWidth(header, W), W));

		// top border with section titles
		const active = this.items[this.selected];
		const qTitle = "─ " + t.fg("accent", "queue") + " ";
		const qFill = leftW - visibleWidth(qTitle);
		const dLabel = active ? shortLabel(active) : "-";
		const dTitle =
			"─ " +
			t.fg("customMessageLabel", "detail") +
			dim(`: ${truncateToWidth(dLabel, Math.max(0, rightW - 11), "")}`) +
			" ";
		const dFill = rightW - visibleWidth(dTitle);
		lines.push(
			frame("╭") +
				qTitle +
				frame("─".repeat(Math.max(0, qFill))) +
				frame("┬") +
				dTitle +
				frame("─".repeat(Math.max(0, dFill))) +
				frame("╮"),
		);

		// body
		let start = 0;
		if (this.items.length > MAX_VISIBLE) {
			start = Math.min(
				Math.max(0, this.selected - Math.floor(MAX_VISIBLE / 2)),
				this.items.length - MAX_VISIBLE,
			);
		}
		const window = this.items.slice(start, start + MAX_VISIBLE);
		const leftCells: string[] = [];
		if (start > 0) leftCells.push(dim(padVisible(`  ↑ +${start}`, leftW)));
		window.forEach((it, i) => leftCells.push(this.leftCell(it, start + i === this.selected, leftW)));
		const below = this.items.length - start - window.length;
		if (below > 0) leftCells.push(dim(padVisible(`  ↓ +${below}`, leftW)));

		const right = this.detail(active, rightW);
		const rows = Math.max(leftCells.length, right.length);
		for (let r = 0; r < rows; r++) {
			const l = r < leftCells.length ? leftCells[r]! : " ".repeat(leftW);
			const rr = r < right.length ? right[r]! : " ".repeat(rightW);
			lines.push(frame("│") + l + frame("│") + rr + frame("│"));
		}

		// bottom border
		lines.push(frame("╰" + "─".repeat(leftW) + "┴" + "─".repeat(rightW) + "╯"));

		// footer: keys + position. Both footer lines must be clamped to W like the
		// header is — an unclamped footer wraps and tears the frame open on narrow
		// terminals (it overflowed by 13 columns at width 60). Narrow widths get
		// compact labels first, so the clamp trims padding rather than meaning.
		const narrow = W < 84;
		const key = (k: string, what: string) => t.fg("accent", k) + dim(` ${what}`);
		const keyBar = [
			key("j/k", narrow ? "nav" : "navigate"),
			key("enter", narrow ? "answer" : "answer template"),
			key("r", "refresh"),
			key("q", "close"),
		].join(dim(" · "));
		lines.push(
			truncateToWidth(
				" " +
					keyBar +
					"  " +
					t.fg("customMessageLabel", t.bold(`${this.selected + 1}/${this.items.length}`)),
				W,
				"",
			),
		);
		const gap = narrow ? " " : "  ";
		const legend =
			" " +
			t.fg("warning", "?") +
			dim((narrow ? " decision" : " needs-decision") + gap) +
			t.fg("error", "!") +
			dim(" blocked" + gap) +
			t.fg("borderAccent", "*") +
			dim(narrow ? " captain" : " captain decision");
		lines.push(
			truncateToWidth(narrow ? legend : legend + dim(t.italic("  · dim row = lane parked")), W, ""),
		);

		this.cachedLines = lines;
		this.cachedWidth = width;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = 0;
		this.cachedLines = null;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("decisions", {
		description: "Captain's decision queue — open items waiting on his answer (firstmate)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("decisions: interactive TUI only", "warning");
				return;
			}
			const recollect = () => collectDecisions(FM_HOME);
			if (recollect().length === 0) {
				ctx.ui.notify("decision queue is clear — nothing waiting on the captain", "info");
				return;
			}
			const picked = await ctx.ui.custom<DecisionItem | null>((tui, theme, _kb, done) => {
				const view = new DecisionQueueView(
					tui,
					theme as unknown as Theme,
					(item) => done(item),
					recollect,
				);
				return {
					render: (w: number) => view.render(w),
					invalidate: () => view.invalidate(),
					handleInput: (data: string) => {
						view.handleInput(data);
						tui.requestRender();
					},
				};
			});
			if (picked) {
				ctx.ui.setEditorText(editorTemplate(picked));
				ctx.ui.notify(answerHint(picked), "info");
			}
		},
	});
}
