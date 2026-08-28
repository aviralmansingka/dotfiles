/**
 * /usage — global token & cost dashboard across all pi sessions.
 *
 * Aggregates usage from every session JSONL in the session dir and renders a
 * dense calendar heatmap (one gruvbox temperature-colored square per day)
 * plus a per-model cost breakdown for the current week. Renders as a widget
 * directly above the prompt so the editor stays visible. j/k scroll, q/esc
 * closes, /usage toggles.
 *
 * Prototype-grade: reads files on every invocation, no cache.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface DayBucket { in:number; out:number; cr:number; cw:number; tok:number; cost:number; turns:number }
interface ProvBucket { tok:number; cost:number; turns:number }
interface All { in:number; out:number; cr:number; cw:number; tok:number; cost:number; turns:number; sessions:number }

async function aggregate(sessionDir: string) {
  const base = dirname(sessionDir);
  const dayB = new Map<string, DayBucket>();
  const modelWk = new Map<string, Map<string, ProvBucket>>(); // model -> weekKey -> bucket
  const all: All = { in:0,out:0,cr:0,cw:0,tok:0,cost:0,turns:0,sessions:0 };

  const weekK = (d: string) => {
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  };

  const add = (u: any, ts: number | string, _provider?: string, model?: string) => {
    if (!u) return;
    const inT = u.input ?? 0, outT = u.output ?? 0, cr = u.cacheRead ?? 0, cw = u.cacheWrite ?? 0;
    const tok = u.totalTokens ?? (inT + outT + cr + cw);
    const cost = u.cost?.total ?? 0;
    const d = new Date(ts).toISOString().slice(0, 10);
    if (!dayB.has(d)) dayB.set(d, { in:0,out:0,cr:0,cw:0,tok:0,cost:0,turns:0 });
    const b = dayB.get(d)!;
    b.in+=inT; b.out+=outT; b.cr+=cr; b.cw+=cw; b.tok+=tok; b.cost+=cost; b.turns++;
    all.in+=inT; all.out+=outT; all.cr+=cr; all.cw+=cw; all.tok+=tok; all.cost+=cost; all.turns++;
    if (model) {
      const wk = weekK(d);
      if (!modelWk.has(model)) modelWk.set(model, new Map());
      const mw = modelWk.get(model)!;
      if (!mw.has(wk)) mw.set(wk, { tok:0,cost:0,turns:0 });
      const mb = mw.get(wk)!; mb.tok+=tok; mb.cost+=cost; mb.turns++;
    }
  };

  let dirs: string[];
  try {
    // Collect all per-cwd subdirs under the base session dir.
    const baseEntries = await readdir(base, { withFileTypes: true });
    dirs = baseEntries.filter((e) => e.isDirectory()).map((e) => join(base, e.name));
    // If the per-cwd sessionDir is itself a dir with files (e.g. custom session dir), include it.
    if (!dirs.includes(sessionDir)) dirs.push(sessionDir);
  } catch {
    dirs = [sessionDir];
  }
  for (const dir of dirs) {
    const p = dir;
    let files: string[];
    try { files = await readdir(p); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      all.sessions++;
      let text: string;
      try { text = await readFile(join(p, f), "utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let e: any;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "message" && e.message?.role === "assistant") {
          add(e.message.usage, e.message.timestamp ?? e.timestamp, e.message.provider, e.message.model);
        } else if ((e.type === "compaction" || e.type === "branch_summary") && e.usage) {
          add(e.usage, e.timestamp);
        } else if (e.type === "message" && e.message?.role === "toolResult" && e.message.usage) {
          add(e.message.usage, e.message.timestamp ?? e.timestamp);
        }
      }
    }
  }

  // Current week's per-model breakdown (most recent week with data if today is empty).
  const today = new Date().toISOString().slice(0, 10);
  let curWeek = weekK(today);
  const allWeeks = new Set<string>();
  for (const mw of modelWk.values()) for (const k of mw.keys()) allWeeks.add(k);
  if (!allWeeks.has(curWeek)) {
    const sorted = [...allWeeks].sort((a, b) => (a < b ? 1 : -1));
    curWeek = sorted[0] ?? curWeek;
  }
  const weekModels = [...modelWk.entries()]
    .map(([m, mw]) => ({ m, ...mw.get(curWeek) ?? { tok:0, cost:0, turns:0 } }))
    .filter((e) => e.cost > 0 || e.tok > 0)
    .sort((a, b) => b.cost - a.cost);
  const weekTotal = weekModels.reduce((s, e) => ({ tok: s.tok + e.tok, cost: s.cost + e.cost, turns: s.turns + e.turns }), { tok:0, cost:0, turns:0 });

  return { dayB, curWeek, weekModels, weekTotal, all };
}

// gruvbox temperature ramp: empty -> cool -> hot (spend = heat)
const RAMP = ["\x1b[38;5;237m", "\x1b[38;5;100m", "\x1b[38;5;142m", "\x1b[38;5;184m", "\x1b[38;5;214m", "\x1b[38;5;167m"];
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  fg: "\x1b[38;5;223m", pink: "\x1b[38;5;176m", yellow: "\x1b[38;5;214m",
  gray: "\x1b[38;5;245m", blue: "\x1b[38;5;109m", aqua: "\x1b[38;5;108m", green: "\x1b[38;5;142m",
};
const usd = (n: number) => "$" + n.toFixed(2);
const kt = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
const f = (n: number) => n.toLocaleString("en-US");
const rpad = (s: string, n: number) => (" ".repeat(n) + s).slice(-n);
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

class UsageComponent implements Component {
  private lines: string[] = [];
  scroll = 0;
  private cachedWidth = -1;
  onClose: () => void = () => {};

  constructor(
    private data: Awaited<ReturnType<typeof aggregate>>,
    private tui: TUI,
  ) {}

  private build(width: number): string[] {
    const { dayB, curWeek, weekModels, weekTotal, all } = this.data;
    // Inset by 1 char on each side to match the editor/chat paddingX=1.
    const inset = " ";
    const W = width - 2;
    const top = inset + "╭" + "─".repeat(W - 2) + "╮";
    const bot = inset + "╰" + "─".repeat(W - 2) + "╯";
    const row = (s: string) => inset + "│ " + truncateToWidth(s, W - 3, "", true) + "│";

    // quantile buckets over non-zero days
    const nz = [...dayB.values()].map((b) => b.cost).filter((c) => c > 0).sort((a, b) => a - b);
    const q = (p: number) => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : Infinity);
    const T = [0, q(0.2), q(0.4), q(0.6), q(0.8), q(1)];
    const level = (cost: number) => { if (cost <= 0) return 0; for (let i = T.length - 1; i >= 1; i--) if (cost >= T[i]) return i; return 1; };
    const cell = (lv: number) => RAMP[lv] + "█" + C.reset;

    const leftW = 4, cellW = 2;
    // Fill the full row content width (W-3): leftW + nWeeks*cellW - 1 (trimmed trailing space) = W-3.
    const nWeeks = Math.max(1, Math.floor((W - 3 - leftW + 1) / cellW));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(today.getDate() - today.getDay() - (nWeeks - 1) * 7);
    const grid: number[][] = Array.from({ length: 7 }, () => Array(nWeeks).fill(-1));
    const monthTop: string[] = Array(nWeeks).fill("");
    for (let c = 0; c < nWeeks; c++) {
      for (let r = 0; r < 7; r++) {
        const dt = new Date(start); dt.setDate(start.getDate() + c * 7 + r);
        if (dt > today) continue;
        const b = dayB.get(dt.toISOString().slice(0, 10));
        if (b) grid[r][c] = level(b.cost);
      }
      const sd = new Date(start); sd.setDate(start.getDate() + c * 7);
      if (sd.getDate() <= 7) monthTop[c] = sd.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    }

    const L: string[] = [];
    L.push(C.bold + C.fg + top + C.reset);
    L.push(row(C.bold + "  /usage" + C.reset + C.gray + "  " + C.bold + C.yellow + usd(all.cost) + C.reset + C.gray + " · " + C.reset + kt(all.tok) + " tokens" + C.gray + " · " + C.reset + f(all.turns) + " turns" + C.gray + " · " + C.reset + all.sessions + " sessions"));
    L.push(row(""));
    let mline = " ".repeat(leftW);
    for (let c = 0; c < nWeeks; c++) { const m = monthTop[c]; mline += m ? (m.slice(0, cellW) + " ".repeat(Math.max(0, cellW - m.length))) : " ".repeat(cellW); }
    L.push(row(C.gray + mline.trimEnd() + C.reset));
    const dowLbl = ["", "Mon", "", "Wed", "", "Fri", ""];
    for (let r = 0; r < 7; r++) {
      let line = (dowLbl[r] || "").padEnd(leftW);
      for (let c = 0; c < nWeeks; c++) { const lv = grid[r][c]; line += (lv < 0 ? C.dim + " " + C.reset : cell(lv)) + " "; }
      L.push(row(C.gray + line.trimEnd() + C.reset));
    }
    // Per-model cost for the current week
    L.push(row(C.pink + C.bold + " this week " + C.reset + C.gray + "  week of " + curWeek + "  ·  " + kt(weekTotal.tok) + " tokens  ·  " + usd(weekTotal.cost) + C.reset));
    for (const e of weekModels) L.push(row(C.green + pad(e.m, 24) + C.reset + "  " + rpad(kt(e.tok), 9) + "  " + rpad(usd(e.cost), 8) + "  " + f(e.turns)));

    L.push(C.bold + C.fg + bot + C.reset);
    return L;
  }

  handleInput(_data: string): void {}

  render(width: number): string[] {
    if (width !== this.cachedWidth) {
      this.lines = this.build(width);
      this.cachedWidth = width;
      const h = this.tui.terminal.rows;
      this.scroll = Math.min(this.scroll, Math.max(0, this.lines.length - h));
    }
    const h = this.tui.terminal.rows;
    const maxLines = Math.min(this.lines.length - this.scroll, h);
    return this.lines.slice(this.scroll, this.scroll + maxLines);
  }

  get lineCount(): number { return this.lines.length; }

  invalidate(): void { this.cachedWidth = -1; }
}

export default function (pi: ExtensionAPI) {
  const WIDGET_KEY = "usage-dashboard";
  let open = false;

  pi.registerCommand("usage", {
    description: "Global token & cost dashboard across all sessions",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("usage requires interactive mode", "error");
        return;
      }

      // Toggle: if already open, close it.
      if (open) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        open = false;
        return;
      }

      const sessionDir = ctx.sessionManager.getSessionDir();
      const data = await aggregate(sessionDir);
      if (data.all.sessions === 0) { ctx.ui.notify("No sessions found", "info"); return; }

      open = true;
      let component: UsageComponent | undefined;
      let tuiRef: TUI | undefined;
      let unsub: (() => void) | undefined;

      const close = () => {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        unsub?.();
        open = false;
      };

      // Capture j/k/q/esc for the dashboard; let everything else reach the editor.
      unsub = ctx.ui.onTerminalInput((raw) => {
        if (!component || !tuiRef) return;
        const h = tuiRef.terminal.rows;
        const max = Math.max(0, component.lineCount - h);
        if (matchesKey(raw, "escape") || raw === "q" || raw === "Q") { close(); return { consume: true }; }
        if (matchesKey(raw, "down") || raw === "j") { component.scroll = Math.min(max, component.scroll + 1); tuiRef.requestRender(); return { consume: true }; }
        if (matchesKey(raw, "up") || raw === "k") { component.scroll = Math.max(0, component.scroll - 1); tuiRef.requestRender(); return { consume: true }; }
        if (matchesKey(raw, "pagedown") || raw === " ") { component.scroll = Math.min(max, component.scroll + Math.max(1, h - 2)); tuiRef.requestRender(); return { consume: true }; }
        if (matchesKey(raw, "pageup")) { component.scroll = Math.max(0, component.scroll - Math.max(1, h - 2)); tuiRef.requestRender(); return { consume: true }; }
        if (raw === "g") { component.scroll = 0; tuiRef.requestRender(); return { consume: true }; }
        if (raw === "G") { component.scroll = max; tuiRef.requestRender(); return { consume: true }; }
        return undefined;
      });

      ctx.ui.setWidget(WIDGET_KEY, (tui, _theme) => {
        tuiRef = tui;
        component = new UsageComponent(data, tui);
        component.onClose = close;
        return component;
      }, { placement: "aboveEditor" });
    },
  });
}
