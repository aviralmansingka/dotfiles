/**
 * Public-API work-step renderer experiment. Load with pi -ne -e <this file>.
 * Owns the call row and collapsed summary for every tool (built-ins ship
 * their own renderers in pi 1.0.4, so `next() ?? mine` would never apply).
 * Expanded bodies: output-style tools (bash etc.) delegate to downstream
 * renderResult when present; connected tools and file-shaped tools (read,
 * write) keep OUR expansion — numbered, theme-synced syntax-highlighted
 * content, +/− diffs, soft-wrapped rails.
 * No assistant-message grouping or native expanded output: each tool owns its
 * row, and expansion is bounded text/details (images are described, not drawn).
 */
import {
  getLanguageFromPath,
  highlightCode,
  initTheme,
  keyHint,
  truncateToVisualLines,
  type ExtensionAPI,
  type Theme,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type Result = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];
type RecordValue = Record<string, unknown>;
type Row = {
  startedAt?: number;
  completedAt?: number;
  settled?: boolean;
  failed?: boolean;
  restored?: boolean;
  invalidate?: () => void;
  timer?: ReturnType<typeof setInterval>;
};
type Background = { result: Result; done: boolean };
const rows = new Map<string, Row>();
const background = new Map<string, Background>();
const CONNECTED = new Set(["subagent", "no_mistakes_axi"]);
const FILE_TOOLS = new Set(["read", "write"]);
const RUNNING = new Set(["pending", "running", "fixing", "awaiting_approval", "fix_review"]);
const OUTPUT_LINE_CAP = 200;
const OUTPUT_WRAP_LINES = 8;

function asRecord(value: unknown): RecordValue {
  return value !== null && typeof value === "object" ? value as RecordValue : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeLine(value: unknown): string {
  return asString(value)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\t/g, "  ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

function clean(value: unknown): string {
  return safeLine(value).replace(/\s+/g, " ").trim();
}

function firstLine(value: unknown): string {
  return clean(asString(value).split("\n").find((line) => line.trim()));
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1000) return "";
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60000)}m${Math.floor((milliseconds % 60000) / 1000)}s`;
}

function preview(tool: string, args: RecordValue): string {
  const path = clean(args.path || args.file);
  switch (tool) {
    case "bash": case "powershell": return `$ ${firstLine(args.command)}`;
    case "read": return [path, ...["offset", "limit"].flatMap((key) =>
      finiteNumber(args[key]) ? [`${key}=${args[key]}`] : [])].join(" · ");
    case "edit": return `${path} · ${plural(Array.isArray(args.edits) ? args.edits.length : 1, "edit")}`;
    case "write": return `${path} · ${plural(asString(args.content).split("\n").length, "line")}`;
    case "grep": case "find": return [clean(args.pattern), path || ".", clean(args.glob)].filter(Boolean).join(" · ");
    case "ls": return path || ".";
    case "subagent": return clean(args.name || args.agent);
    case "no_mistakes_axi": return clean(args.phase || args.task);
    case "mcp": return clean(args.server || args.connect || args.tool);
    default: return firstLine(args.query || args.url || args.path || args.name || args.command || args.task);
  }
}

function textContent(result: Result): string {
  return (Array.isArray(result.content) ? result.content : [])
    .filter((item) => item.type === "text").map((item) => asString(asRecord(item).text)).join("\n");
}

function roots(result: Result): RecordValue[] {
  const details = asRecord(result.details);
  return Array.isArray(details.results) ? details.results.map(asRecord) : [details];
}

function rootFailed(root: RecordValue): boolean {
  const progress = asRecord(root.progress);
  return ["failed", "cancelled"].includes(asString(progress.status)) || Boolean(progress.error)
    || (finiteNumber(root.exitCode) && root.exitCode !== 0);
}

function exitCode(result: Result): number | undefined {
  const code = asRecord(result.details).exitCode;
  if (finiteNumber(code)) return code;
  const match = textContent(result).match(/(?:exit(?:ed with)? code[: ]+)(-?\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function failed(result: Result, context: RenderContext): boolean {
  return context.isError || asRecord(result).isError === true || roots(result).some(rootFailed)
    || (exitCode(result) ?? 0) !== 0;
}

function summary(tool: string, result: Result, isError: boolean): string {
  const text = textContent(result);
  const details = asRecord(result.details);
  const count = text ? text.replace(/\n$/, "").split("\n").length : 0;
  if (isError) return firstLine(text) || "failed";
  const truncated = asRecord(details.truncation).truncated ? " · truncated" : "";
  switch (tool) {
    case "bash": case "powershell": return `${exitCode(result) === undefined ? "done" : `exit ${exitCode(result)}`} · ${plural(count, "line")}${truncated}`;
    case "read": return result.content?.some((item) => item.type === "image") ? "image loaded" : `${plural(count, "line")} loaded${truncated}`;
    case "edit": {
      const diff = asString(details.diff).split("\n");
      const additions = diff.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const removals = diff.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      return details.diff ? `+${additions} −${removals} · updated` : "updated";
    }
    case "write": return firstLine(text) || "written";
    case "grep": case "find": case "ls": return `${plural(count, "result")}${truncated}`;
    default: return firstLine(text) || "completed";
  }
}

function formatStatsSegments(stats: RecordValue): string[] {
  const segments: string[] = [];
  for (const [key, prefix] of [["inputTokens", "↑"], ["outputTokens", "↓"], ["cacheReadTokens", "R"], ["cacheWriteTokens", "W"]]) {
    const value = stats[key];
    if (finiteNumber(value) && value) segments.push(`${prefix}${value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}`);
  }
  if (finiteNumber(stats.cost) && stats.cost) segments.push(`$${stats.cost.toFixed(3)}`);
  return segments;
}

function renderRecentToolTree(theme: Theme, rail: string, progress: RecordValue): string[] {
  const tools = Array.isArray(progress.recentTools) ? progress.recentTools : [];
  return tools.map((item, index) => {
    const tool = asRecord(item);
    const status = asString(tool.status);
    const glyph = status === "pending" ? theme.fg("dim", "○")
      : RUNNING.has(status) ? theme.fg("accent", "◇")
      : ["failed", "cancelled"].includes(status) ? theme.fg("error", "×")
      : status === "skipped" ? theme.fg("dim", "–") : theme.fg("success", "◆");
    const connector = index === tools.length - 1 ? "└─" : "├─";
    return ` ${theme.fg("borderMuted", rail + connector)} ${glyph} ${theme.fg("text", clean(tool.name) || "(tool)")}${tool.preview ? theme.fg("dim", ` · ${clean(tool.preview)}`) : ""}`;
  });
}

function renderConnectedChips(tool: string, args: RecordValue, result: Result, expanded: boolean, partial: boolean, row: Row, theme: Theme, outerFailed: boolean): string[] {
  const entries = roots(result);
  return entries.flatMap((root, index) => {
    const progress = asRecord(root.progress);
    const stats = asRecord(root.stats);
    const last = index === entries.length - 1;
    const name = tool === "no_mistakes_axi" ? "no-mistakes" : clean(root.name || root.agent || args.name || args.agent) || "(subagent)";
    const isError = outerFailed || rootFailed(root);
    const running = !isError && (RUNNING.has(asString(progress.status)) || partial);
    const start = finiteNumber(progress.startedAt) ? progress.startedAt : row.startedAt;
    const end = finiteNumber(progress.completedAt) ? progress.completedAt : running ? Date.now() : row.completedAt;
    const elapsedValue = !row.restored && finiteNumber(start) && finiteNumber(end) ? formatElapsed(Math.max(0, end - start)) : "";
    const elapsed = elapsedValue ? ` ${elapsedValue}` : "";
    const head = ` ${theme.fg("borderMuted", last ? "└─" : "├─")} `;
    const label = theme.fg("text", theme.bold(name));
    let line: string;
    if (isError) {
      line = `${head}${theme.fg("error", "×")} ${label}${theme.fg("error", ` · ${clean(progress.error) || "failed"}`)}${theme.fg("dim", elapsed)}`;
    } else if (running) {
      const status = firstLine(progress.output || root.output) || "running";
      line = `${head}${theme.fg("accent", "▹")} ${label}${theme.fg("dim", `${elapsed} · `)}${theme.fg(status.toLowerCase().startsWith("stalled") ? "warning" : "muted", status)}`;
    } else {
      const count = finiteNumber(stats.toolCount) ? stats.toolCount : Array.isArray(progress.recentTools) ? progress.recentTools.length : 0;
      line = `${head}${theme.fg("muted", "▸")} ${label} ${theme.fg("success", "◆")} ${theme.fg("dim", plural(count, progress.kind === "pipeline" ? "phase" : "tool") + elapsed)}`;
    }
    if (expanded) {
      const segments = formatStatsSegments(stats);
      if (segments.length) line += theme.fg("dim", ` · ${segments.join(" ")}`);
      return [line, ...renderRecentToolTree(theme, last ? "   " : "│  ", progress)];
    }
    return [line + theme.fg("muted", `  ${keyHint("app.tools.expand", "to expand")}`)];
  });
}

/**
 * highlightCode colors through its OWN module instance's theme singleton. The
 * running pi initializes a different instance of that module (bundled
 * chunks), so our import starts uninitialized and would silently return
 * plain lines. Sync our instance from the Theme pi hands to renderers, once
 * per theme name (renders fire every frame; keep this a string compare).
 */
let syncedThemeName: string | undefined;
function ensureHighlightTheme(theme: Theme): void {
  const name = theme.name ?? "";
  if (syncedThemeName === name) return;
  syncedThemeName = name;
  try {
    initTheme(theme.name);
  } catch {
    // Stay uninitialized; plain lines still render.
  }
}

/** Map a fenced-block info string (```ts, ~~~python) to a highlight language. */
function resolveInfoLanguage(info: string): string | undefined {
  const name = clean(info).split(/\s+/)[0].toLowerCase();
  if (!name || !/^[a-z0-9+#.-]+$/.test(name)) return undefined;
  return getLanguageFromPath(`x.${name}`) ?? name;
}

/** Inline markdown styling: code spans, bold, emphasis, links. */
function styleMarkdownInline(theme: Theme, text: string): string {
  return text.replace(/(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g, (match, code, bold, italic, link) => {
    if (code) return theme.fg("success", code);
    if (bold) return theme.bold(bold);
    if (italic) return theme.italic(italic);
    if (link) {
      const label = /\[([^\]]+)\]/.exec(link)?.[1] ?? link;
      const url = /\]\(([^)]+)\)/.exec(link)?.[1] ?? "";
      return theme.fg("accent", label) + theme.fg("dim", `(${url})`);
    }
    return match;
  });
}

/**
 * Line-anchored markdown styling on the live Theme. pi's cli-highlight theme
 * maps no markdown scopes — the grammar renders everything in flat fg — so
 * prose is styled here instead: accent-bold headings, accent list markers,
 * muted quotes, dim rules, inline spans via styleMarkdownInline.
 */
function styleMarkdownLine(theme: Theme, line: string): string {
  const heading = /^(#{1,6}\s+.*)$/.exec(line);
  if (heading) return theme.fg("accent", theme.bold(heading[1]));
  const list = /^(\s*(?:[-*+]|\d+\.)\s)/.exec(line);
  if (list) return theme.fg("accent", list[1]) + styleMarkdownInline(theme, line.slice(list[1].length));
  const quote = /^(\s*>+\s?)/.exec(line);
  if (quote) return theme.fg("muted", quote[1]) + styleMarkdownInline(theme, line.slice(quote[1].length));
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return theme.fg("dim", line);
  return styleMarkdownInline(theme, line);
}

/**
 * Markdown with treesitter-style injection: fenced code blocks highlight
 * with their info-string language through the engine; prose is styled by
 * styleMarkdownLine on the live Theme — the closest public-API approximation
 * of Neovim's markdown highlighting.
 */
function highlightMarkdown(theme: Theme, text: string): string[] {
  const out: string[] = [];
  let prose: string[] = [];
  let code: string[] = [];
  let marker = "";
  let info = "";
  const flushProse = (): void => {
    if (prose.length) {
      out.push(...prose.map((line) => styleMarkdownLine(theme, line)));
      prose = [];
    }
  };
  const flushCode = (): void => {
    if (code.length) {
      out.push(...highlightCode(code.join("\n"), resolveInfoLanguage(info)));
      code = [];
    }
  };
  for (const line of text.split("\n")) {
    const fence = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (marker) {
      if (fence && fence[1][0] === marker[0]) {
        flushCode();
        out.push(theme.fg("dim", line));
        marker = "";
      } else {
        code.push(line);
      }
    } else if (fence) {
      flushProse();
      out.push(theme.fg("dim", line));
      marker = fence[1][0].repeat(3);
      info = fence[2] ?? "";
    } else {
      prose.push(line);
    }
  }
  flushProse();
  flushCode();
  return out;
}

type CommandRow = { text: string; command: boolean; op: string };

/**
 * Split a bash command into rows, tracking quote, heredoc, backslash, and
 * paren (subshell/$(…)) state across lines. Command lines are further split
 * into executable segments at top-level `&&`, `||`, and `|`: each segment
 * after the first starts with the operator that joins it to the previous
 * step, so every leaf reads as an executable line. Quoted multi-line
 * strings and heredoc bodies are continuations, not commands. `;` is not
 * split mid-line (it would break for/if headers) but a leading `;` is
 * stripped as the joining operator; an operator ending a line carries to
 * the next command line.
 */
function commandRows(command: string): CommandRow[] {
  const rows: CommandRow[] = [];
  let inSingle = false;
  let inDouble = false;
  let heredoc: string | undefined;
  let continued = false;
  let carriedOp: string | undefined;
  for (const raw of command.split("\n")) {
    const line = safeLine(raw);
    // A line that merely completes a backslash-continued segment after an
    // operator (a line ending in `&& \` whose next line holds the operand)
    // is executable: it takes the carried operator instead of rendering as
    // a dim continuation.
    const completesCarried = continued && Boolean(carriedOp) && !inSingle && !inDouble && !heredoc;
    const isContinuation = (inSingle || inDouble || Boolean(heredoc) || continued) && !completesCarried;
    if (!isContinuation && !line.trim()) continue;
    if (heredoc) {
      rows.push({ text: line, command: false, op: "" });
      if (line.trim() === heredoc) heredoc = undefined;
      continue;
    }
    let parenDepth = 0;
    let start = 0;
    let pendingOp: string | undefined;
    if (!isContinuation) {
      const lead = /^(&&|\|\||\||;)\s*/.exec(line);
      if (lead) {
        pendingOp = lead[1];
        start = lead[0].length;
      } else if (carriedOp) {
        pendingOp = carriedOp;
      }
    }
    carriedOp = undefined;
    continued = false;
    for (let i = start; i < line.length; i++) {
      const ch = line[i];
      if (inSingle) {
        if (ch === "'") inSingle = false;
      } else if (inDouble) {
        if (ch === "\\") i++;
        else if (ch === '"') inDouble = false;
      } else if (ch === "\\") {
        if (i === line.length - 1) continued = true;
        else i++;
      } else if (ch === "'") {
        inSingle = true;
      } else if (ch === '"') {
        inDouble = true;
      } else if (parenDepth > 0) {
        if (ch === ")") parenDepth--;
        else if (ch === "(") parenDepth++;
      } else if (ch === "(") {
        parenDepth++;
      } else if (!isContinuation && (ch === "|" || (ch === "&" && line[i + 1] === "&"))) {
        const op = ch === "|" ? (line[i + 1] === "|" ? "||" : "|") : "&&";
        const text = line.slice(start, i).trim();
        if (text) rows.push({ text, command: true, op: pendingOp ?? "$" });
        pendingOp = op;
        i += op.length - 1;
        start = i + 1;
      } else if (ch === "<" && line[i + 1] === "<") {
        const tag = /^<<-?\s*("?)([A-Za-z_][A-Za-z0-9_-]*)\1/.exec(line.slice(i));
        if (tag) {
          heredoc = tag[2];
          i += tag[0].length - 1;
        }
      }
    }
    if (isContinuation) {
      rows.push({ text: line, command: false, op: "" });
      continue;
    }
    const tailText = line.slice(start).trim();
    if (tailText && tailText !== "\\") rows.push({ text: tailText, command: true, op: pendingOp ?? "$" });
    else if (pendingOp) carriedOp = pendingOp;
  }
  return rows;
}

/**
 * Bash/powershell call rows render each executable segment separately:
 * commands behind a dim operator marker (`$` for the first, then the
 * `&&`/`||`/`|` that joins them) with bash-grammar highlighting;
 * continuation lines between command leaves carry the connecting `│` rail
 * (bare indent after the last command) with dim, unhighlighted text —
 * highlighting prose as bash would be a lie. Cached per toolCallId and
 * theme: renders fire every frame, and only a changed command (streaming
 * args) or theme switch recomputes.
 */
const highlightedCommands = new Map<string, { source: string; theme: string; rows: { body: string; command: boolean; op: string }[] }>();
function commandBodies(theme: Theme, toolCallId: string, tool: string, command: string): { body: string; command: boolean; op: string }[] {
  const themeName = theme.name ?? "";
  const cached = highlightedCommands.get(toolCallId);
  if (cached && cached.source === command && cached.theme === themeName) return cached.rows;
  ensureHighlightTheme(theme);
  const lang = tool === "powershell" ? "powershell" : "bash";
  const rows = commandRows(command).map((part) => {
    let body = part.text;
    if (part.command) {
      try {
        body = highlightCode(part.text, lang)[0] ?? part.text;
      } catch {
        // Highlighting needs pi's theme runtime; the plain line still renders.
      }
    } else {
      body = theme.fg("dim", part.text);
    }
    return { body, command: part.command, op: part.op };
  });
  highlightedCommands.set(toolCallId, { source: command, theme: themeName, rows });
  return rows;
}

function wrapLine(line: string, avail: number): { chunks: string[]; skipped: number } {
  try {
    const { visualLines, skippedCount } = truncateToVisualLines(line, OUTPUT_WRAP_LINES, Math.max(8, avail));
    // The real truncateToVisualLines returns [] for blank lines; keep the
    // row so its number prefix renders and numbering stays file-aligned.
    return { chunks: visualLines.length ? visualLines : [""], skipped: skippedCount };
  } catch {
    return { chunks: [truncateToWidth(line, Math.max(8, avail))], skipped: 0 };
  }
}

/**
 * Expanded body for tools without downstream renderers. File-shaped tools
 * (read/write) get dim line numbers and pi's public syntax highlighting
 * (`highlightCode` + `getLanguageFromPath` — cli-highlight under the hood,
 * same engine as pi's native read renderer); edit gets +/− colored diffs;
 * other output is plain railed text. Long lines soft-wrap behind the rail
 * instead of hard-truncating; one pathological line folds after
 * OUTPUT_WRAP_LINES visual lines.
 */
function expandedOutput(tool: string, result: Result, theme: Theme, context: RenderContext, width = 200): string[] {
  const details = asRecord(result.details);
  const text = textContent(result);
  let lines: string[] = text ? text.split("\n") : [];
  let color: ((line: string) => string) | undefined;
  if (tool === "edit" && details.diff) {
    lines = asString(details.diff).split("\n");
    color = (line) => theme.fg(/^[+-]/.test(line) ? (line.startsWith("+") ? "success" : "error") : "toolOutput", safeLine(line));
  } else if (tool === "read" || tool === "write") {
    const path = clean(asRecord(context.args).path || asRecord(context.args).file);
    ensureHighlightTheme(theme);
    try {
      const lang = getLanguageFromPath(path);
      lines = lang === "markdown" ? highlightMarkdown(theme, text) : highlightCode(text, lang);
    } catch {
      // Highlighting needs pi's theme runtime; plain lines still render.
    }
  } else {
    color = (line) => theme.fg("toolOutput", safeLine(line));
  }
  const capped = lines.slice(0, OUTPUT_LINE_CAP);
  const numbered = tool === "read" || tool === "write";
  const gutter = String(capped.length).length;
  const rail = theme.fg("borderMuted", "│");
  const lead = numbered ? (index: number) => `${theme.fg("dim", String(index + 1).padStart(gutter))} ${rail} ` : () => ` ${rail}  `;
  const rest = numbered ? `${" ".repeat(gutter)} ${rail} ` : ` ${rail}  `;
  const prefixWidth = numbered ? gutter + 3 : 4;
  const shown: string[] = [];
  for (const [index, line] of capped.entries()) {
    const body = color ? color(line) : line;
    const { chunks, skipped } = wrapLine(body, width - prefixWidth);
    chunks.forEach((chunk, chunkIndex) => shown.push((chunkIndex === 0 ? lead(index) : rest) + chunk));
    if (skipped) shown.push(`${rest}${theme.fg("dim", `… ${skipped} wrapped lines hidden`)}`);
  }
  const extras: string[] = [];
  if (details.fullOutputPath) extras.push(`Full output: ${clean(details.fullOutputPath)}`);
  if (asRecord(details.truncation).truncated) extras.push("Output was truncated by the tool.");
  for (const item of result.content ?? []) {
    if (item.type === "image") extras.push(`[image: ${clean(asRecord(item).mimeType)}]`);
  }
  shown.push(...extras.map((line) => ` ${rail}  ${theme.fg("dim", line)}`));
  if (lines.length > OUTPUT_LINE_CAP) shown.push(theme.fg("dim", ` … ${lines.length - OUTPUT_LINE_CAP} more lines`));
  return shown;
}

function stop(row: Row): void {
  if (row.timer) clearInterval(row.timer);
  row.timer = undefined;
}

function arm(row: Row): void {
  if (row.restored || row.timer || !row.invalidate) return;
  row.startedAt ??= Date.now();
  row.timer = setInterval(() => row.invalidate?.(), 1000);
  row.timer.unref?.();
}

function capture(context: RenderContext): Row {
  let row = rows.get(context.toolCallId);
  if (!row) {
    row = {};
    rows.set(context.toolCallId, row);
  }
  row.invalidate = context.invalidate;
  return row;
}

function disposeState(): void {
  for (const row of rows.values()) stop(row);
  rows.clear();
  background.clear();
  highlightedCommands.clear();
}

function component(draw: (width?: number) => string[]): Component {
  // Recompute on render, not just on renderer invocation: public invalidation
  // can redraw an already-returned component after a background bus update.
  return {
    render: (width) => draw(width).map((line) => truncateToWidth(line, Math.max(0, width))),
    invalidate() {},
  };
}

export default function (pi: ExtensionAPI) {
  let sessionId: string | undefined;
  pi.on("session_start", (_event, ctx) => {
    const nextId = ctx.sessionManager.getSessionId();
    if (sessionId === nextId) return;
    disposeState();
    sessionId = nextId;
    // Stored calls do not own clocks. Their stored results still flow through
    // the same renderer; no transcript reconstruction or component lookup.
    for (const entry of ctx.sessionManager.getEntries()) {
      const message = asRecord(asRecord(entry).message);
      if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const item of message.content) {
        const block = asRecord(item);
        if (block.type === "toolCall" && typeof block.id === "string") rows.set(block.id, { restored: true });
      }
    }
  });
  pi.on("tool_execution_start", (event) => {
    const row = rows.get(event.toolCallId) ?? {};
    row.startedAt ??= Date.now();
    row.settled = false;
    rows.set(event.toolCallId, row);
    arm(row);
  });
  pi.on("tool_execution_end", (event) => {
    const row = rows.get(event.toolCallId);
    if (!row) return;
    row.settled = true;
    row.failed = event.isError;
    row.completedAt = Date.now();
    stop(row);
    row.invalidate?.();
  });
  const unsubscribe = pi.events.on("subagent:background-update", (payload: unknown) => {
    const event = asRecord(payload);
    if (typeof event.toolCallId !== "string" || !event.result || typeof event.result !== "object") return;
    // Ignore late notifications belonging to the session we just left.
    const row = rows.get(event.toolCallId);
    if (!row) return;
    const root = asRecord(event.result);
    // The producer sends a root {progress, output, stats}, NOT AgentToolResult.
    const result = Array.isArray(root.content) ? root as unknown as Result : {
      content: [{ type: "text" as const, text: asString(root.output) }],
      details: { results: [root] },
    };
    const done = event.done === true;
    background.set(event.toolCallId, { result, done });
    row.settled = done;
    row.failed = asRecord(result).isError === true || roots(result).some(rootFailed);
    if (done) {
      row.completedAt = Date.now();
      stop(row);
    } else {
      row.completedAt = undefined;
      arm(row);
    }
    row.invalidate?.();
  });
  pi.on("session_shutdown", () => {
    disposeState();
    unsubscribe();
  });

  pi.registerToolRenderer((toolName, next) => {
    const mine: ToolRenderers = {
      renderShell: "self",
      renderCall(args, theme, context) {
        const row = capture(context);
        if (!row.settled && context.executionStarted) arm(row);
        return component(() => {
          const glyph = row.failed ? theme.fg("error", "×") : row.settled ? theme.fg("success", "◆") : theme.fg("accent", "◇");
          const elapsedValue = !row.restored && finiteNumber(row.startedAt)
            ? formatElapsed(Math.max(0, (row.completedAt ?? Date.now()) - row.startedAt)) : "";
          const elapsed = elapsedValue ? ` · ${elapsedValue}` : "";
          const name = theme.fg("text", theme.bold(clean(toolName)));
          if (toolName === "bash" || toolName === "powershell") {
            const commands = commandBodies(theme, context.toolCallId, toolName, asString(asRecord(args).command));
            if (commands.length === 1 && commands[0].command) {
              return [` ${glyph} ${name} ${theme.fg("dim", "$")} ${commands[0].body}${theme.fg("dim", elapsed)}`];
            }
            if (commands.length > 0) {
              const rail = theme.fg("borderMuted", "├─");
              const tail = theme.fg("borderMuted", "└─");
              return [
                ` ${glyph} ${name}${theme.fg("dim", elapsed)}`,
                ...commands.map((row, index) => {
                  // A leaf (├─/└─) only where a `$` command starts; every
                  // other row — operator-joined segments and quoted/heredoc
                  // continuations — rides a bare `│` spine with no
                  // horizontal arm, all text aligned in one column.
                  const followed = index < commands.length - 1;
                  if (!row.command) {
                    return ` ${theme.fg("borderMuted", "│")}     ${row.body}`;
                  }
                  if (row.op === "$") {
                    return ` ${followed ? rail : tail} ${theme.fg("dim", "$ ")} ${row.body}`;
                  }
                  return ` ${theme.fg("borderMuted", "│")}  ${theme.fg("dim", row.op.padEnd(2))} ${row.body}`;
                }),
              ];
            }
          }
          const arg = preview(toolName, asRecord(args));
          return [` ${glyph} ${name}${theme.fg("dim", `${arg ? ` ${arg}` : ""}${elapsed}`)}`];
        });
      },
      renderResult(result, { expanded, isPartial }, theme, context) {
        const row = capture(context);
        const draw = (width = 200) => {
          const live = background.get(context.toolCallId);
          // Retain the last done update too: the parent's stored return value
          // only says "started" and must not replace the final chip on redraw.
          const effective = live?.result ?? result;
          const partial = live ? !live.done : isPartial;
          const running = partial || (CONNECTED.has(toolName) && !live?.done
            && roots(effective).some((root) => RUNNING.has(asString(asRecord(root.progress).status))));
          row.failed = failed(effective, context);
          row.settled = !running || row.failed;
          if (row.settled) {
            if (!row.restored) row.completedAt ??= Date.now();
            stop(row);
          } else {
            row.completedAt = undefined;
            arm(row);
          }
          const lines = CONNECTED.has(toolName)
            ? renderConnectedChips(toolName, asRecord(context.args), effective, expanded, partial, row, theme, context.isError || asRecord(effective).isError === true)
            : [` ${theme.fg("borderMuted", "└─")} ${theme.fg(row.failed ? "error" : running ? "muted" : "success", running ? "running" : summary(toolName, effective, Boolean(row.failed)))}`];
          if (expanded) lines.push(...expandedOutput(toolName, effective, theme, context, width));
          return lines;
        };
        // Settle clocks immediately even if pi hasn't rendered the component yet.
        draw();
        return component(draw);
      },
    };
    // Connected tools never delegate: our chips and recentTools tree are
    // richer than the subagent extension's own result render, which would
    // otherwise show a stale "⟳ name — started" line on expand. File tools
    // keep their expansion ours too: the native render proved near-uncolored
    // in practice, while our theme-synced highlightCode carries full syntax
    // colors plus line numbers.
    const other = CONNECTED.has(toolName) || FILE_TOOLS.has(toolName) ? undefined : next();
    if (!other?.renderResult) return mine;
    return {
      renderShell: "self",
      renderCall: mine.renderCall,
      renderResult: (result, options, theme, context) =>
        options.expanded
          ? other.renderResult!(result, options, theme, context)
          : mine.renderResult!(result, options, theme, context),
    };
  });
}
