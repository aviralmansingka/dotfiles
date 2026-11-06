/**
 * Rounded input bar + single-line footer.
 *
 * - Editor: replaces the flat top/bottom `─` borders of the input bar with
 *   rounded corners (`╭╮` top, `╰╯` bottom) so the bar no longer terminates
 *   bluntly at the edges.
 * - Footer: collapses the default three-line footer (pwd / stats / MCP
 *   statuses) into one line:
 *     `folder  $cost  cache hit%/cacheRead  ctx%/ctxWindow` ... `model • thinking`
 *   The MCP/extension-status line is dropped, and the folder is merged into the
 *   stats line instead of occupying its own line.
 */

import { relative, resolve, sep, isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fastModeSlot, onFastModeChange } from "./fast-mode-slot.mjs";

// --- small format helpers (mirrors pi's footer so the units match) ---------

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const rel = relative(resolvedHome, resolvedCwd);
	const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

// --- rounded editor --------------------------------------------------------

/**
 * Wrap already-sized content lines in the prompt bubble: `╭─⚡ …─╮`, walls, `╰─╯`.
 * Shared with the embedded nvim editor so both render the same chrome.
 */
export function roundedBarFrame(
	content: string[],
	width: number,
	borderColor: (str: string) => string,
): string[] {
	const target = width - 2;
	const padInner = (line: string): string => {
		const w = visibleWidth(line);
		if (w < target) return line + " ".repeat(target - w);
		return truncateToWidth(line, target, "");
	};

	const label = ` ${tokenSpeedLabel()} `;
	const top =
		visibleWidth(label) >= target
			? borderColor("─".repeat(target))
			: borderColor("─".repeat(target - visibleWidth(label)) + label);

	return [
		borderColor("╭") + top + borderColor("╮"),
		...content.map((line) => borderColor("│") + padInner(line) + borderColor("│")),
		borderColor("╰") + borderColor("─".repeat(target)) + borderColor("╯"),
	];
}

class RoundedEditor extends CustomEditor {
	render(width: number): string[] {
		// Too narrow to frame with walls — fall back to the default render.
		if (width < 4) return super.render(width);

		// Render the editor into a channel that is 2 cells narrower, then wrap
		// every line with vertical walls (`│`) and round the top/bottom border
		// corners (`╭╮` / `╰╯`). This turns the flat `─` bar into a full bubble.
		const inner = super.render(width - 2);
		if (inner.length === 0) return inner;

		const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		const isBorder = (s: string) => {
			const bare = stripAnsi(s);
			// Plain border: all `─`. Scroll border: `─── ↑/↓ N more ──...`.
			return /^─+$/.test(bare) || /^─── [↑↓] \d+ more /.test(bare);
		};

		// Locate the bottom border: the second border line (first is the top).
		let bottomIdx = inner.length - 1;
		let borderSeen = 0;
		for (let i = 0; i < inner.length; i++) {
			if (isBorder(inner[i])) {
				borderSeen++;
				if (borderSeen === 2) { bottomIdx = i; break; }
			}
		}
		// If only one border line exists (edge case), treat the last line as it.
		if (borderSeen < 2) bottomIdx = inner.length - 1;

		// Content sits between the borders; autocomplete lines stay outside the bubble.
		const framed = roundedBarFrame(inner.slice(1, bottomIdx), width, (s) => this.borderColor(s));
		return [...framed, ...inner.slice(bottomIdx + 1)];
	}
}

// --- single-line footer ----------------------------------------------------

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

interface TokenSpeed {
	startedAt: number;
	rate?: number;
	exact: boolean;
}

const tokenSpeed: TokenSpeed = { startedAt: 0, exact: false };
let requestPromptRender: (() => void) | undefined;

function outputTokenEstimate(message: any): { tokens: number; exact: boolean } {
	const output = message.usage?.output;
	if (Number.isFinite(output) && output > 0) return { tokens: output, exact: true };

	const chars = (message.content ?? []).reduce((total: number, block: any) => {
		if (block.type === "text") return total + (block.text?.length ?? 0);
		if (block.type === "thinking") return total + (block.thinking?.length ?? 0);
		if (block.type === "toolCall") return total + JSON.stringify(block.arguments ?? {}).length;
		return total;
	}, 0);
	return { tokens: Math.ceil(chars / 4), exact: false };
}

function updateTokenSpeed(message: any): void {
	const estimate = outputTokenEstimate(message);
	if (estimate.tokens <= 0) return;
	const elapsed = Math.max(0.25, (Date.now() - tokenSpeed.startedAt) / 1000);
	tokenSpeed.rate = estimate.tokens / elapsed;
	tokenSpeed.exact = estimate.exact;
}

/** Prompt-bubble label text: the token rate, prefixed with a bolt while fast
 *  mode is on. Pure so the bolt prefix is testable without a TUI — the caller
 *  measures its width with `visibleWidth`, so the bolt (1–2 cells) stays inside
 *  the border math either way. */
export function formatSpeedLabel(rate: number | null | undefined, exact: boolean, fast: boolean): string {
	const speed = rate == null ? "-- tok/s" : `${exact ? "" : "~"}${Math.max(1, Math.round(rate))} tok/s`;
	return fast ? `⚡ ${speed}` : speed;
}

function tokenSpeedLabel(): string {
	return formatSpeedLabel(tokenSpeed.rate, tokenSpeed.exact, fastModeSlot().getEnabled());
}

function computeUsage(entries: Iterable<{ type: string; message?: any; usage?: any }>): UsageTotals {
	const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of entries) {
		if (entry.type === "message" && entry.message?.role === "assistant") {
			const u = entry.message.usage;
			totals.input += u.input ?? 0;
			totals.output += u.output ?? 0;
			totals.cacheRead += u.cacheRead ?? 0;
			totals.cacheWrite += u.cacheWrite ?? 0;
			totals.cost += u.cost?.total ?? 0;
		} else if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.usage) {
			const u = entry.message.usage;
			totals.input += u.input ?? 0;
			totals.output += u.output ?? 0;
			totals.cacheRead += u.cacheRead ?? 0;
			totals.cacheWrite += u.cacheWrite ?? 0;
			totals.cost += u.cost?.total ?? 0;
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			const u = entry.usage;
			totals.input += u.input ?? 0;
			totals.output += u.output ?? 0;
			totals.cacheRead += u.cacheRead ?? 0;
			totals.cacheWrite += u.cacheWrite ?? 0;
			totals.cost += u.cost?.total ?? 0;
		}
	}
	return totals;
}

export default function (pi: ExtensionAPI) {

	pi.on("message_start", (event) => {
		if (event.message.role !== "assistant") return;
		tokenSpeed.startedAt = Date.now();
		tokenSpeed.rate = undefined;
		tokenSpeed.exact = false;
		requestPromptRender?.();
	});
	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		if (!tokenSpeed.startedAt) tokenSpeed.startedAt = Date.now();
		updateTokenSpeed(event.message);
		requestPromptRender?.();
	});
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		updateTokenSpeed(event.message);
		requestPromptRender?.();
	});

	pi.on("session_start", (_event, ctx) => {
		tokenSpeed.startedAt = 0;
		tokenSpeed.rate = undefined;
		tokenSpeed.exact = false;

		// Rounded input bar. Use paddingX=1 so text breathes inside the walls.
		ctx.ui.setEditorComponent((tui, _theme, keybindings) => {
			const ed = new RoundedEditor(tui, _theme, keybindings);
			ed.setPaddingX(1);
			return ed;
		});

		// Single-line footer.
		ctx.ui.setFooter((_tui, theme, footerData) => {
			requestPromptRender = () => _tui.requestRender();
			const unsub = footerData.onBranchChange(() => _tui.requestRender());
			// A mid-session /fast toggle repaints the prompt bubble's bolt now.
			const unsubFastMode = onFastModeChange(() => requestPromptRender?.());
			return {
				dispose: () => {
					unsub();
					unsubFastMode();
				},
				invalidate() {},
				render(width: number): string[] {
					const sm = ctx.sessionManager;
					const entries = [...sm.getEntries()];
					const totals = computeUsage(entries);

					// Latest cache hit rate (matches pi's own footer logic).
					let latestHitRate: number | undefined;
					for (const entry of entries) {
						if (entry.type === "message" && entry.message?.role === "assistant") {
							const u = (entry.message as any).usage;
							const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
							latestHitRate = prompt > 0 ? ((u.cacheRead ?? 0) / prompt) * 100 : undefined;
						}
					}

					// Folder: cwd + branch (no session name — keep it to one line).
					let folder = formatCwd(sm.getCwd(), process.env.HOME || process.env.USERPROFILE);
					const branch = footerData.getGitBranch();
					if (branch) folder += ` (${branch})`;

					// Compaction: context % / context window.
					const ctxUsage = ctx.getContextUsage();
					const ctxWindow = ctxUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const ctxPercent = ctxUsage?.percent;
					const ctxDisplay =
						ctxPercent == null
							? `?/${formatTokens(ctxWindow)}`
							: `${ctxPercent.toFixed(1)}%/${formatTokens(ctxWindow)}`;

					// Left: folder • cost • cache • compaction
					const leftParts: string[] = [theme.fg("dim", folder)];

					if (totals.cost) leftParts.push(theme.fg("dim", `$${totals.cost.toFixed(3)}`));

					if (totals.cacheRead > 0 || totals.cacheWrite > 0) {
						const cacheStr =
							latestHitRate != null
								? `${latestHitRate.toFixed(1)}%/${formatTokens(totals.cacheRead)}`
								: `${formatTokens(totals.cacheRead)}`;
						leftParts.push(theme.fg("dim", cacheStr));
					}

					let compactionStr: string;
					if (ctxPercent != null && ctxPercent > 90) compactionStr = theme.fg("error", ctxDisplay);
					else if (ctxPercent != null && ctxPercent > 70) compactionStr = theme.fg("warning", ctxDisplay);
					else compactionStr = ctxDisplay;
					leftParts.push(theme.fg("dim", compactionStr));

					const left = leftParts.join("  ");

					// Right: model • thinking (prepend provider only if multiple).
					const modelName = ctx.model?.id || "no-model";
					let right = modelName;
					if (ctx.model?.reasoning) {
						const level = ctx.thinkingLevel || "off";
						right = level === "off" ? `${modelName} • thinking off` : `${modelName} • ${level}`;
					}
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						const withProvider = `(${ctx.model.provider}) ${right}`;
						if (visibleWidth(left) + 2 + visibleWidth(withProvider) <= width) right = withProvider;
					}

					// Pad left/right onto one line.
					const leftW = visibleWidth(left);
					const rightW = visibleWidth(right);
					let line: string;
					if (leftW + 2 + rightW <= width) {
						const pad = " ".repeat(width - leftW - rightW);
						line = left + pad + theme.fg("dim", right);
					} else {
						const avail = width - leftW - 2;
						if (avail > 0) {
							const truncated = truncateToWidth(right, avail, "");
							const pad = " ".repeat(Math.max(0, width - leftW - visibleWidth(truncated)));
							line = left + pad + theme.fg("dim", truncated);
						} else {
							line = truncateToWidth(left, width, "");
						}
					}
					return [truncateToWidth(line, width, "")];
				},
			};
		});
	});
}
