/**
 * Public-API work-step renderer experiment. Load with pi -ne -e <this file>.
 * Owns the call row and collapsed summary for every tool (built-ins ship
 * their own renderers in pi 1.0.4, so `next() ?? mine` would never apply).
 * Expanded bodies: connected tools, file-shaped tools (read, write), and
 * bash/powershell keep OUR expansion — chips and recentTools trees,
 * numbered syntax-highlighted content, and status-framed command output
 * (✓/✗ exit banner + railed head-and-tail fold). Inspection tools own
 * their query/results too; pedagogy tools own question leaves and verdicts.
 * Other tools delegate to
 * downstream renderResult when present.
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
  leafResult?: boolean;
  invalidate?: () => void;
  timer?: ReturnType<typeof setInterval>;
};
type Background = { result: Result; done: boolean };
const rows = new Map<string, Row>();
const background = new Map<string, Background>();
const CONNECTED = new Set(["subagent", "no_mistakes_axi"]);
// Receipts are not live background agents: never route them through chips.
const RECEIPT_TOOLS = new Set(["subagent_message"]);
const FILE_TOOLS = new Set(["read", "write"]);
const OUTPUT_TOOLS = new Set(["bash", "powershell"]);
const INSPECT_TOOLS = new Set(["grep", "find", "ls"]);
const PEDAGOGY_TOOLS = new Set(["ask_user_question", "quiz", "explain"]);
const OUTPUT_HEAD = 30;
const OUTPUT_TAIL = 30;
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
    case "grep": case "find": return `${JSON.stringify(clean(args.pattern))} in ${path || "."}${args.glob ? ` · ${clean(args.glob)}` : ""}`;
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
    case "grep": {
      const hits = grepLines(text).filter((hit) => hit.match);
      const notice = truncated || (details.matchLimitReached || details.linesTruncated ? " · truncated" : "");
      return `${matchCount(hits.length)} · ${plural(new Set(hits.map((hit) => hit.path)).size, "file")}${notice}`;
    }
    case "find": return `${plural(inspectionPaths(result, "No files found matching pattern").length, "path")}${truncated || (details.resultLimitReached ? " · truncated" : "")}`;
    case "ls": {
      const paths = inspectionPaths(result, "(empty directory)");
      const dirs = paths.filter((path) => path.endsWith("/")).length;
      const counts = dirs || !paths.length
        ? `${plural(dirs, "dir")} · ${plural(paths.length - dirs, "file")}`
        : plural(paths.length, "result");
      return counts + (truncated || (details.entryLimitReached ? " · truncated" : ""));
    }
    default: return firstLine(text) || "completed";
  }
}

type GrepLine = { path: string; line: string; content: string; match: boolean };

function grepLines(text: string): GrepLine[] {
  return text.split("\n").flatMap((raw) => {
    const line = safeLine(raw);
    // Prefer pi's native separator (it adds a space before content), so
    // numeric colon groups in content do not become part of the filename.
    // The raw-rg fallback is greedy to tolerate colons in paths.
    const native = /^(.*?)(:|-)(\d+)\2( .*)$/.exec(line);
    if (native) return [{ path: native[1], line: native[3], content: native[4], match: native[2] === ":" }];
    const hit = /^(.*):(\d+):(.*)$/.exec(line);
    return hit ? [{ path: hit[1], line: hit[2], content: hit[3], match: true }] : [];
  });
}

function matchCount(count: number): string {
  return count === 1 ? "1 match" : `${count} matches`;
}

type GrepBody = { body: string; match: boolean };
const highlightedGrep = new Map<string, { source: string; pattern: string; ignoreCase: boolean; theme: Theme; rows: GrepBody[] }>();
function grepBodies(theme: Theme, id: string, args: RecordValue, text: string): GrepBody[] {
  const pattern = safeLine(args.pattern);
  const ignoreCase = args.ignoreCase === true;
  const cached = highlightedGrep.get(id);
  if (cached && cached.source === text && cached.pattern === pattern && cached.ignoreCase === ignoreCase && cached.theme === theme) return cached.rows;
  // Highlight literal occurrences, not a JS reinterpretation of ripgrep's regex dialect.
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  const bodies = grepLines(text).map((hit) => {
    if (!hit.match) return { body: theme.fg("dim", `${hit.path}-${hit.line}-${hit.content}`), match: false };
    let body = "";
    let start = 0;
    const haystack = ignoreCase ? hit.content.toLowerCase() : hit.content;
    let index: number;
    while (needle && (index = haystack.indexOf(needle, start)) !== -1) {
      body += hit.content.slice(start, index) + theme.bold(hit.content.slice(index, index + pattern.length));
      start = index + pattern.length;
    }
    body += hit.content.slice(start);
    return { body: theme.fg("dim", `${hit.path}:${hit.line}:`) + theme.fg("toolOutput", body), match: true };
  });
  highlightedGrep.set(id, { source: text, pattern, ignoreCase, theme, rows: bodies });
  return bodies;
}

function foldInspection(lines: string[], theme: Theme, unit = ""): string[] {
  return lines.length <= OUTPUT_HEAD + OUTPUT_TAIL ? lines : [
    ...lines.slice(0, OUTPUT_HEAD),
    theme.fg("dim", `… ${lines.length - OUTPUT_HEAD - OUTPUT_TAIL}${unit} hidden …`),
    ...lines.slice(-OUTPUT_TAIL),
  ];
}

function renderGrep(result: Result, expanded: boolean, row: Row, theme: Theme, context: RenderContext, width: number): string[] {
  const bodies = grepBodies(theme, context.toolCallId, asRecord(context.args), textContent(result));
  const rail = ` ${theme.fg("borderMuted", "│")}  `;
  const hits = bodies.filter((body) => body.match);
  const shown = expanded ? foldInspection(bodies.map((body) => body.body), theme, " lines") : hits.slice(0, 1).map((hit) => hit.body);
  const lines = shown.flatMap((body) => {
    const { chunks, skipped } = wrapLine(body, width - 4, "start");
    return [...chunks.map((chunk) => rail + chunk), ...(skipped ? [rail + theme.fg("dim", `… ${skipped} wrapped lines hidden`)] : [])];
  });
  const label = row.settled ? summary("grep", result, Boolean(row.failed)) : "running";
  let status = theme.fg(row.failed ? "error" : row.settled ? "success" : "muted", label);
  if (expanded && row.settled) {
    if (row.failed || !hits.length) status = theme.fg("error", theme.bold(`✗ ${row.failed ? label : "0 matches"}`));
    else {
      const [count, ...detail] = label.split(" · ");
      status = theme.fg("success", theme.bold(`✓ ${count}`)) + theme.fg("dim", ` · ${detail.join(" · ")}`);
    }
  }
  lines.push(` ${theme.fg("borderMuted", "└─")} ${status}`);
  return lines;
}

function inspectionPaths(result: Result, empty: string): string[] {
  const details = asRecord(result.details);
  const truncation = asRecord(details.truncation);
  let text = textContent(result);
  if (truncation.truncated && typeof truncation.content === "string") text = truncation.content;
  else if (details.resultLimitReached || details.entryLimitReached || truncation.truncated) {
    // Native tools append a notice after a blank line; it is not a path.
    text = text.replace(/\n\n\[[^\n]*\]$/, "");
  }
  if (text === empty) return [];
  const paths = text.replace(/\n$/, "").split("\n");
  if (truncation.lastLinePartial) paths.pop();
  return paths.filter(Boolean).map(safeLine);
}

type PathTree = Map<string, { directory: boolean; children: PathTree }>;
const inspectionTrees = new Map<string, { source: string; theme: Theme; rows: string[] }>();
function findTree(theme: Theme, id: string, paths: string[]): string[] {
  const source = JSON.stringify(paths);
  const cached = inspectionTrees.get(id);
  if (cached && cached.source === source && cached.theme === theme) return cached.rows;
  const root: PathTree = new Map();
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    if (path.startsWith("/")) parts.unshift("/");
    let tree = root;
    parts.forEach((part, index) => {
      let node = tree.get(part);
      if (!node) {
        node = { directory: false, children: new Map() };
        tree.set(part, node);
      }
      node.directory ||= index < parts.length - 1 || path.endsWith("/");
      tree = node.children;
    });
  }
  const drawTree = (tree: PathTree, indent: string): string[] => {
    const lines = [...tree].flatMap(([name, node], index) => {
      const last = index === tree.size - 1;
      const label = node.directory ? theme.fg("accent", theme.bold(name.endsWith("/") ? name : `${name}/`)) : theme.fg("toolOutput", name);
      return [
        theme.fg("borderMuted", indent + (last ? "└── " : "├── ")) + label,
        ...drawTree(node.children, indent + (last ? "    " : "│   ")),
      ];
    });
    return lines;
  };
  // Fold the complete result subtree once, keeping hidden line counts exact.
  const rendered = foldInspection(drawTree(root, ""), theme).map((line) => `    ${line}`);
  inspectionTrees.set(id, { source, theme, rows: rendered });
  return rendered;
}

function lsListing(theme: Theme, id: string, paths: string[]): string[] {
  const source = JSON.stringify(paths);
  const cached = inspectionTrees.get(id);
  if (cached && cached.source === source && cached.theme === theme) return cached.rows;
  // Native ls exposes only names and trailing /, not lstat metadata. Do not
  // invent sizes, symlink targets, or directory child counts from those names.
  const rendered = paths.map((path, index) => {
    const label = path.endsWith("/") ? theme.fg("accent", theme.bold(path)) : theme.fg("toolOutput", path);
    return `    ${theme.fg("borderMuted", index === paths.length - 1 ? "└── " : "├── ")}${label}`;
  });
  inspectionTrees.set(id, { source, theme, rows: rendered });
  return rendered;
}

function inspectionBanner(tool: string, result: Result, row: Row, theme: Theme): string {
  const label = row.settled ? summary(tool, result, Boolean(row.failed)) : "running";
  const [count, ...detail] = label.split(" · ");
  const color = row.failed ? "error" : row.settled ? "success" : "muted";
  const mark = row.settled ? theme.bold(`${row.failed ? "✗" : "✓"} ${count}`) : count;
  return ` ${theme.fg("borderMuted", "└─")} ${theme.fg(color, mark)}${detail.length ? theme.fg("dim", ` · ${detail.join(" · ")}`) : ""}`;
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
 * paren (subshell/$(…)) state across lines. Each line is scanned in two
 * phases: a continuation prefix (quoted string, heredoc body, backslash
 * wrap) renders dim, and a construct that CLOSES mid-line hands the rest of
 * the line to command context — so `…message." && git log` yields a dim
 * message row plus an executable `&& git log` row. Command context splits
 * into executable segments at top-level `&&`, `||`, and `|`; each segment
 * after the first starts with the operator that joins it to the previous
 * step. `;` is not split mid-line (it would break for/if headers) but a
 * leading `;` is stripped as the joining operator; an operator ending a
 * line carries to the next command line.
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
    if (heredoc) {
      rows.push({ text: line, command: false, op: "" });
      if (line.trim() === heredoc) heredoc = undefined;
      continue;
    }
    // A line that merely completes a backslash-continued segment after an
    // operator (a line ending in `&& \` whose next line holds the operand)
    // is executable: it takes the carried operator instead of rendering as
    // a dim continuation.
    const completesCarried = continued && Boolean(carriedOp) && !inSingle && !inDouble;
    const startsContinued = (inSingle || inDouble || continued) && !completesCarried;
    if (!startsContinued && !completesCarried && !line.trim()) continue;

    // Phase 1 — continuation prefix: everything up to where the continued
    // construct closes renders dim.
    let i = 0;
    if (startsContinued) {
      if (inSingle || inDouble) {
        while (i < line.length) {
          const ch = line[i];
          if (inSingle) {
            if (ch === "'") {
              inSingle = false;
              i++;
              break;
            }
            i++;
          } else if (ch === "\\") {
            i += 2;
          } else if (ch === '"') {
            inDouble = false;
            i++;
            break;
          } else {
            i++;
          }
        }
      } else {
        // Backslash wrap: the whole line continues its segment. Re-scan it
        // for constructs that outlive it (opened quotes, another wrap).
        i = line.length;
        continued = false;
        for (let j = 0; j < line.length; j++) {
          const ch = line[j];
          if (inSingle) {
            if (ch === "'") inSingle = false;
          } else if (inDouble) {
            if (ch === "\\") j++;
            else if (ch === '"') inDouble = false;
          } else if (ch === "\\") {
            if (j === line.length - 1) continued = true;
            else j++;
          } else if (ch === "'") {
            inSingle = true;
          } else if (ch === '"') {
            inDouble = true;
          }
        }
      }
      rows.push({ text: line.slice(0, i), command: false, op: "" });
    }

    // Phase 2 — command context for the remainder: split into executable
    // segments at top-level operators; state persists across lines.
    const rest = startsContinued ? line.slice(i) : line;
    let pendingOp: string | undefined = carriedOp;
    carriedOp = undefined;
    let start = 0;
    if (rest.trim() && !pendingOp) {
      const lead = /^(&&|\|\||\||;)\s*/.exec(rest);
      if (lead) {
        pendingOp = lead[1];
        start = lead[0].length;
      }
    }
    if (rest.length) continued = false;
    let parenDepth = 0;
    for (let j = start; j < rest.length; j++) {
      const ch = rest[j];
      if (inSingle) {
        if (ch === "'") inSingle = false;
      } else if (inDouble) {
        if (ch === "\\") j++;
        else if (ch === '"') inDouble = false;
      } else if (ch === "\\") {
        if (j === rest.length - 1) continued = true;
        else j++;
      } else if (ch === "'") {
        inSingle = true;
      } else if (ch === '"') {
        inDouble = true;
      } else if (parenDepth > 0) {
        if (ch === ")") parenDepth--;
        else if (ch === "(") parenDepth++;
      } else if (ch === "(") {
        parenDepth++;
      } else if (ch === "|" || (ch === "&" && rest[j + 1] === "&")) {
        const op = ch === "|" ? (rest[j + 1] === "|" ? "||" : "|") : "&&";
        const text = rest.slice(start, j).trim();
        if (text) rows.push({ text, command: true, op: pendingOp ?? "$" });
        pendingOp = op;
        j += op.length - 1;
        start = j + 1;
      } else if (ch === "<" && rest[j + 1] === "<") {
        const tag = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1/.exec(rest.slice(j));
        if (tag) {
          heredoc = tag[2];
          j += tag[0].length - 1;
        }
      }
    }
    const tailText = rest.slice(start).trim();
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

function wrapLine(line: string, avail: number, keep: "start" | "end" = "end", maxLines = OUTPUT_WRAP_LINES): { chunks: string[]; skipped: number } {
  try {
    const { visualLines, skippedCount } = truncateToVisualLines(line, maxLines, Math.max(8, avail), 0, keep);
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
/**
 * Status banner replacing the collapsed summary when a bash/powershell row
 * is expanded: bold ✓/✗ exit mark in success/error color, dim line count
 * and elapsed. Collapsed rows keep the plain `exit N · M lines` summary.
 */
function statusBanner(theme: Theme, result: Result, row: Row): string {
  const code = exitCode(result);
  const text = textContent(result);
  const count = text ? text.replace(/\n$/, "").split("\n").length : 0;
  const elapsedValue = !row.restored && finiteNumber(row.startedAt) && finiteNumber(row.completedAt)
    ? formatElapsed(Math.max(0, row.completedAt - row.startedAt)) : "";
  const elapsed = elapsedValue ? ` · ${elapsedValue}` : "";
  const mark = row.failed
    ? theme.fg("error", theme.bold(`✗ exit ${code ?? "?"}`))
    : theme.fg("success", theme.bold(`✓ exit ${code ?? 0}`));
  return ` ${theme.fg("borderMuted", "└─")} ${mark}${theme.fg("dim", ` · ${plural(count, "line")}${elapsed}`)}`;
}

function expandedOutput(tool: string, result: Result, theme: Theme, context: RenderContext, width = 200): string[] {
  const details = asRecord(result.details);
  const text = textContent(result);
  if (OUTPUT_TOOLS.has(tool)) {
    // Command output behind a bare rail, head-and-tail folded so both the
    // opening context and the trailing errors stay visible.
    if (!text) return [];
    // Plain indentation, no rail glyph: rail characters pollute terminal
    // selections and make the output hard to copy out.
    const prefix = "    ";
    const out: string[] = [];
    const emit = (line: string): void => {
      const body = theme.fg("toolOutput", safeLine(line));
      for (const chunk of wrapLine(body, Math.max(8, width - 4)).chunks) out.push(prefix + chunk);
    };
    const all = text.replace(/\n$/, "").split("\n");
    if (all.length <= OUTPUT_HEAD + OUTPUT_TAIL + 2) {
      for (const line of all) emit(line);
    } else {
      for (const line of all.slice(0, OUTPUT_HEAD)) emit(line);
      out.push(`${prefix}${theme.fg("dim", `… ${all.length - OUTPUT_HEAD - OUTPUT_TAIL} lines hidden …`)}`);
      for (const line of all.slice(-OUTPUT_TAIL)) emit(line);
    }
    if (asRecord(details.truncation).truncated) out.push(`${prefix}${theme.fg("dim", "Output was truncated by the tool.")}`);
    if (details.fullOutputPath) out.push(`${prefix}${theme.fg("dim", `Full output: ${clean(details.fullOutputPath)}`)}`);
    return out;
  }
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

// Pedagogy leaves share the command gutter: a two-column marker, then text.
function shortPedagogy(value: unknown, width: number): string {
  const text = firstLine(value);
  const more = asString(value).trim().split("\n").length > 1;
  const clipped = truncateToWidth(text, Math.max(0, width), "");
  return clipped !== text || more ? truncateToWidth(text, Math.max(0, width - 1), "") + "…" : text;
}

function pedagogyText(theme: Theme, value: unknown, marker: string, width: number, color: "dim" | "text" | "success" | "error" = "dim", markdown = false): string[] {
  const rail = ` ${theme.fg("borderMuted", "│")}  `;
  const lines = asString(value).split("\n").flatMap((line) => {
    const body = safeLine(line);
    return wrapLine(markdown ? styleMarkdownInline(theme, body) : theme.fg(color, body), width - 7, "start", Number.MAX_SAFE_INTEGER).chunks;
  });
  return lines.map((line, index) => rail + (index === 0 ? theme.fg("dim", marker.padEnd(2)) : "  ") + " " + line);
}

function questionLeaf(theme: Theme, question: unknown, expanded: boolean, width: number): string[] {
  if (!expanded) return [` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "? ")} ${theme.fg("text", shortPedagogy(question, width - 7))}`];
  const lines = pedagogyText(theme, question, "?", width, "text");
  lines[0] = lines[0].replace(` ${theme.fg("borderMuted", "│")}  `, ` ${theme.fg("borderMuted", "├─")} `);
  return lines;
}

type PedagogyVerdict = { label: string; color: "success" | "error" | "mdLink" | "dim"; body: string[] };

// Option indices in both interactive tools are one-based display positions.
function optionRefs(text: string): RecordValue[] {
  return [...text.matchAll(/(?:^|\n|,\s*)(?:-\s*)?(\d+)\.\s*([^\n]*?)(?=,\s*\d+\.\s|\n|$)/g)]
    .map((match) => ({ index: Number(match[1]), label: match[2] }));
}

function pedagogyOptions(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(asRecord).filter((option) => clean(option.label))
    .map((option, index) => ({ index: index + 1, ...option })) : [];
}

function askVerdict(args: RecordValue, details: RecordValue, text: string, expanded: boolean, theme: Theme, width: number): PedagogyVerdict {
  const choices = pedagogyOptions(args.options);
  const selected = /^User selected:\s*([\s\S]*)/.exec(text)?.[1] ?? "";
  const answers = Array.isArray(details.answers) ? details.answers.map(asRecord) : optionRefs(selected);
  if (!Array.isArray(details.answers)) {
    for (const match of selected.matchAll(/(?:^|\n)(?:-\s*)?Other:\s*(.*)/g)) answers.push({ label: match[1] });
  }
  // Older transcripts can contain labels without numbered references.
  if (!Array.isArray(details.answers) && !answers.length && selected) {
    const choice = choices.find((option) => clean(option.label) === clean(selected));
    answers.push(choice ?? { label: selected.replace(/^Other:\s*/, "") });
  }
  if (!Array.isArray(details.answers) && !answers.length && text.startsWith("User answered: ")) answers.push({ label: text.slice(15) });
  const indices = answers.map((answer) => answer.index).filter(finiteNumber);
  const body = expanded ? choices.flatMap((option) => {
    const picked = indices.includes(option.index as number);
    return pedagogyText(theme, `${picked ? "✓ " : ""}${safeLine(option.label)}`, String(option.index), width, picked ? "text" : "dim");
  }) : [];
  let label = "✗ unavailable";
  if (answers.length) {
    const pointers = indices.length > 1 ? `options ${indices.join(" + ")}` : indices.length ? `option ${indices[0]}` : "";
    const other = answers.filter((answer) => !finiteNumber(answer.index)).map((answer) => asString(answer.label || answer.value)).join(" + ");
    const answer = shortPedagogy(other || answers[0].label || answers[0].value, 40) || "(empty answer)";
    label = `✓ ${pointers}${pointers && (indices.length === 1 || other) ? " — " : ""}${indices.length > 1 && !other ? "" : answer}`;
  } else if (text === "User submitted an empty response") label = "✓ (empty answer)";
  return { label, color: label.startsWith("✓") ? "success" : "dim", body };
}

// Quiz shuffles before its partial update. Retain that displayed order for
// Ctrl+P/cancel results, whose final details omit options. Never mistake input
// positions for shuffled indices when restoring older text-only transcripts.
const quizDisplayOptions = new Map<string, RecordValue[]>();
function quizVerdict(args: RecordValue, details: RecordValue, text: string, expanded: boolean, theme: Theme, width: number, id: string): PedagogyVerdict {
  const selectedRefs = optionRefs(/^Selected:\s*(.*)$/m.exec(text)?.[1] ?? "");
  const correctRefs = optionRefs(/^Correct:\s*(.*)$/m.exec(text)?.[1] ?? "");
  const answers = Array.isArray(details.answers) ? details.answers.map(asRecord) : selectedRefs;
  const picked = answers.map((answer) => answer.index).filter(finiteNumber).filter((index) => index > 0);
  const correct = Array.isArray(details.correctIndices) ? details.correctIndices.filter(finiteNumber) : correctRefs.map((ref) => ref.index as number);
  const dontKnow = details.dontKnow === true || details.status === "too-hard" || /genuine knowledge gap|passed with Ctrl\+P/i.test(text);
  const isCorrect = typeof details.correct === "boolean" ? details.correct : /User answered correctly\./.test(text);
  const graded = dontKnow || typeof details.correct === "boolean" || /User answered (?:in)?correctly\./.test(text);
  let choices = quizDisplayOptions.get(id);
  if (!choices) {
    if (args.shuffle === false) choices = pedagogyOptions(args.options);
    else {
      const refs = [...answers, ...correctRefs];
      const known = new Map(refs.filter((ref) => finiteNumber(ref.index) && ref.index > 0).map((ref) => [ref.index as number, ref]));
      const count = Math.max(Array.isArray(args.options) ? args.options.length : 0, ...picked, ...correct);
      choices = Array.from({ length: count }, (_, index) => known.get(index + 1) ?? { index: index + 1, label: "(label unavailable)" });
    }
  }
  const body = expanded ? choices.flatMap((option) => {
    const index = option.index as number;
    const selected = !dontKnow && picked.includes(index);
    const right = correct.includes(index);
    const mark = selected ? (isCorrect || right ? "✓ " : "✗ ") : right && graded ? "✓ " : "";
    const color = selected ? (isCorrect ? "text" : right ? "success" : "error") : right && graded ? "success" : "dim";
    return pedagogyText(theme, `${mark}${safeLine(option.label)}`, String(index), width, color);
  }) : [];
  if (expanded) {
    const explanation = details.explanation ?? /^Explanation:\s*([\s\S]*)$/m.exec(text)?.[1] ?? args.explanation;
    if (explanation) body.push(...pedagogyText(theme, explanation, "✎", width, "text", true));
    if (Array.isArray(args.contextFiles) && args.contextFiles.length) body.push(...pedagogyText(theme, `context: ${args.contextFiles.map(safeLine).join(", ")}`, "", width));
  }
  const label = dontKnow ? "● don't know — a genuine gap"
    : !graded ? "✗ unavailable"
    : isCorrect ? `✓ correct${picked.length ? ` · option${picked.length === 1 ? "" : "s"} ${picked.join(" + ")}` : ""}`
    : `✗ incorrect · picked ${picked.join(" + ") || "?"} · correct ${correct.join(" + ") || "?"}`;
  return { label, color: dontKnow ? "mdLink" : !graded ? "dim" : isCorrect ? "success" : "error", body };
}

function expectedClaims(value: unknown): string[] {
  return asString(value).split(/\n|;\s*/).map((claim) => clean(claim).replace(/^(?:[-*•]|\d+[.)])\s+/, "")).filter(Boolean);
}

function claimKey(value: unknown): string {
  return clean(value).toLowerCase().replace(/[.!?]+$/, "");
}

function explainVerdict(args: RecordValue, details: RecordValue, text: string, expanded: boolean, theme: Theme, width: number): PedagogyVerdict {
  const parsed = /Grader verdict: (CORRECT|PARTIALLY_CORRECT|INCORRECT) \(grade: ([ABCDF])\)(?:\n([^\n]*))?/.exec(text);
  const grading = asRecord(details.grading);
  const verdict = asString(grading.verdict) || parsed?.[1].toLowerCase() || "";
  const grade = clean(grading.grade) || parsed?.[2] || "";
  const summary = grading.summary ?? parsed?.[3];
  const answer = asString(details.answer ?? /User's answer \(their own words\):\n([\s\S]*?)(?=\n\n(?:Grader verdict:|\(Grader fork unavailable:)|$)/.exec(text)?.[1]);
  const dontKnow = details.dontKnow === true || /User submitted an EMPTY answer/i.test(text)
    || (details.status === "answered" && !answer.trim() && !verdict);
  const refinements = Array.isArray(grading.refinements) ? grading.refinements.map(asRecord)
    : [...text.matchAll(/^- "(.*)" — (.*?)(?: → (.*))?$/gm)].map((match) => ({ quote: match[1], issue: match[2], correction: match[3] }));
  const body: string[] = [];
  if (expanded) {
    const claims = expectedClaims(args.expected);
    const keys = claims.map(claimKey);
    const answerClaims = expectedClaims(answer).map(claimKey);
    // Refinements have no claim IDs or per-claim verdicts. Only exact,
    // unique clause matches with a real answer quote justify a mapping;
    // do not turn lexical similarity (or a global grade) into claim scores.
    const mapped = refinements.map((refinement) => {
      const correction = claimKey(refinement.correction);
      const quote = claimKey(refinement.quote);
      if (!asString(refinement.quote) || !answer.includes(asString(refinement.quote))) return [];
      return keys.flatMap((key, index) => key === correction || key === quote ? [index] : []);
    });
    claims.forEach((claim, index) => {
      const hits = mapped.flatMap((indices, refinement) => indices.length === 1 && indices[0] === index ? [refinement] : []);
      const ambiguous = mapped.some((indices) => indices.length > 1 && indices.includes(index)) || keys.indexOf(keys[index]) !== keys.lastIndexOf(keys[index]);
      let mark = "";
      if (!ambiguous && hits.length === 1 && verdict) mark = verdict === "incorrect" ? theme.fg("error", "✗ ") : theme.fg("mdLink", "● ");
      else if (!ambiguous && !hits.length && verdict && answerClaims.includes(keys[index])
        && !refinements.some((refinement) => claimKey(refinement.quote) === keys[index])) mark = theme.fg("success", "✓ ");
      const styled = theme.fg("dim", "expected: ") + mark + theme.fg("dim", claim);
      body.push(...wrapLine(styled, width - 7, "start", Number.MAX_SAFE_INTEGER).chunks.map((chunk) => ` ${theme.fg("borderMuted", "│")}     ${chunk}`));
    });
    if (answer) body.push(...pedagogyText(theme, answer, "A", width, "text"));
    if (summary) body.push(...pedagogyText(theme, summary, "✎", width));
    for (const refinement of refinements) {
      const quote = safeLine(refinement.quote);
      const issue = safeLine(refinement.issue);
      const correction = safeLine(refinement.correction);
      body.push(...pedagogyText(theme, `“${quote}”${issue ? ` — ${issue}` : ""}${correction ? ` → ${correction}` : ""}`, "·", width));
    }
  }
  const label = dontKnow ? "● don't know — a genuine gap"
    : verdict === "correct" ? `✓ correct${grade ? ` · grade ${grade}` : ""}`
    : verdict === "partially_correct" ? `● partially correct${grade ? ` · grade ${grade}` : ""}`
    : verdict === "incorrect" ? `✗ incorrect${grade ? ` · grade ${grade}` : ""}` : "✗ unavailable";
  return { label, color: dontKnow || verdict === "partially_correct" ? "mdLink" : verdict === "correct" ? "success" : verdict === "incorrect" ? "error" : "dim", body };
}

const pedagogyRows = new Map<string, { source: string; theme: Theme; rows: string[] }>();
function renderPedagogy(tool: string, result: Result, expanded: boolean, row: Row, theme: Theme, context: RenderContext, width: number): string[] {
  const args = asRecord(context.args);
  const details = asRecord(result.details);
  const text = textContent(result);
  if (tool === "quiz" && Array.isArray(details.options)) quizDisplayOptions.set(context.toolCallId, pedagogyOptions(details.options));
  const source = JSON.stringify([tool, args, details, text, expanded, row.settled, row.failed, width]);
  const cached = pedagogyRows.get(context.toolCallId);
  if (cached?.source === source && cached.theme === theme) return cached.rows;
  const lines = questionLeaf(theme, details.question ?? args.question, expanded, width);
  const justification = details.context ?? args.details;
  if (expanded && justification) lines.push(...pedagogyText(theme, justification, "", width));
  const status = asString(details.status);
  let verdict: PedagogyVerdict;
  if (!row.settled) verdict = { label: "running", color: "dim", body: [] };
  else if (["cancelled", "unavailable", "follow-up"].includes(status) || /User cancelled/i.test(text) || row.failed) {
    const ghost = ["cancelled", "unavailable", "follow-up"].includes(status) ? status : /User cancelled/i.test(text) ? "cancelled" : "unavailable";
    verdict = { label: `✗ ${ghost}`, color: "dim", body: [] };
  } else verdict = tool === "quiz"
    ? quizVerdict(args, details, text, expanded, theme, width, context.toolCallId)
    : tool === "explain" ? explainVerdict(args, details, text, expanded, theme, width)
    : askVerdict(args, details, text, expanded, theme, width);
  lines.push(...verdict.body, ` ${theme.fg("borderMuted", "└─")} ${theme.fg(verdict.color, verdict.label)}`);
  pedagogyRows.set(context.toolCallId, { source, theme, rows: lines });
  return lines;
}

function spineText(theme: Theme, text: unknown, width: number): string[] {
  return asString(text).split("\n").flatMap((line) =>
    wrapLine(theme.fg("dim", safeLine(line)), width - 4, "start", Number.MAX_SAFE_INTEGER).chunks
      .map((chunk) => ` ${theme.fg("borderMuted", "│")}  ${chunk}`));
}

function messageLeaf(theme: Theme, args: RecordValue, expanded: boolean, width: number): string[] {
  const name = clean(args.name) || "(unknown)";
  const preview = !expanded && args.message ? ` — ${shortPedagogy(args.message, width - 10 - [...name].length)}` : "";
  return [` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "» ")} ${theme.fg("text", name)}${theme.fg("dim", preview)}`];
}

const receiptRows = new Map<string, { source: string; theme: Theme; rows: string[] }>();
function renderMessage(result: Result, expanded: boolean, row: Row, theme: Theme, context: RenderContext, width: number): string[] {
  const args = asRecord(context.args);
  const details = asRecord(result.details);
  const text = textContent(result);
  const source = JSON.stringify([args, details, text, expanded, row.settled, row.failed, width]);
  const cached = receiptRows.get(context.toolCallId);
  if (cached?.source === source && cached.theme === theme) return cached.rows;
  const steered = /^Message delivered to running subagent "([^"]+)"\./.exec(text);
  const resumed = /^Session "([^"]+)" resumed\./.exec(text);
  const status = asString(details.status) || (steered ? "steered" : resumed ? "started" : "");
  const lines = messageLeaf(theme, { ...args, name: details.name || args.name || steered?.[1] || resumed?.[1] }, expanded, width);
  if (expanded && args.message) lines.push(...spineText(theme, args.message, width));
  const cancelled = status === "cancelled" || /^cancelled\b/i.test(text);
  const error = row.failed || Boolean(details.error) || status === "failed";
  const label = cancelled ? "✗ cancelled" : error ? `✗ ${firstLine(details.error || text) || "failed"}`
    : !row.settled ? "running" : status === "steered" ? "✓ steered · delivered live"
    : status === "started" ? "⟳ resumed · follow-up dispatched" : firstLine(text) || "✗ unavailable";
  const color = cancelled ? "dim" : error ? "error" : !row.settled ? "dim"
    : status === "steered" ? "success" : status === "started" ? "accent" : "dim";
  lines.push(` ${theme.fg("borderMuted", "└─")} ${theme.fg(color, label)}`);
  if (expanded && row.settled && !error && !cancelled) {
    const semantics = status === "steered" ? "the child keeps running; its result arrives as a steer message"
      : status === "started" ? "waits for readiness on Herdr, dispatch on tmux" : "";
    if (semantics) lines.push(...wrapLine(theme.fg("dim", semantics), width - 4, "start", Number.MAX_SAFE_INTEGER).chunks.map((chunk) => `    ${chunk}`));
  }
  receiptRows.set(context.toolCallId, { source, theme, rows: lines });
  return lines;
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
  highlightedGrep.clear();
  inspectionTrees.clear();
  pedagogyRows.clear();
  receiptRows.clear();
  quizDisplayOptions.clear();
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
    row.leafResult = false;
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
        return component((width = 200) => {
          const glyph = row.failed ? theme.fg("error", "×") : row.settled ? theme.fg("success", "◆") : theme.fg("accent", "◇");
          const elapsedValue = !row.restored && finiteNumber(row.startedAt)
            ? formatElapsed(Math.max(0, (row.completedAt ?? Date.now()) - row.startedAt)) : "";
          const elapsed = elapsedValue ? ` · ${elapsedValue}` : "";
          const name = theme.fg("text", theme.bold(clean(toolName)));
          if (PEDAGOGY_TOOLS.has(toolName)) return [
            ` ${glyph} ${name}${theme.fg("dim", elapsed)}`,
            ...(!row.leafResult ? questionLeaf(theme, asRecord(args).question, false, width) : []),
          ];
          if (toolName === "subagent_message") return [
            ` ${glyph} ${name}${theme.fg("dim", elapsed)}`,
            ...(!row.leafResult ? messageLeaf(theme, asRecord(args), false, width) : []),
          ];
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
          if (toolName === "grep") {
            const query = asRecord(args);
            const scope = ` in ${clean(query.path) || "."}${query.glob ? ` · ${clean(query.glob)}` : ""}`;
            const flags = `${query.ignoreCase ? " · -i" : ""}${query.literal ? " · -F" : ""}${finiteNumber(query.context) ? ` · ctx ${query.context}` : ""}`;
            return [
              ` ${glyph} ${name}${theme.fg("dim", elapsed)}`,
              ` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "$ ")} ${theme.fg("text", theme.bold(JSON.stringify(clean(query.pattern))))}${theme.fg("dim", scope + flags)}`,
            ];
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
          row.failed = INSPECT_TOOLS.has(toolName)
            ? context.isError || asRecord(effective).isError === true
            : failed(effective, context);
          if (RECEIPT_TOOLS.has(toolName)) row.failed ||= Boolean(asRecord(effective.details).error) || asRecord(effective.details).status === "failed";
          row.settled = !running || row.failed;
          if (row.settled) {
            if (!row.restored) row.completedAt ??= Date.now();
            stop(row);
          } else {
            row.completedAt = undefined;
            arm(row);
          }
          if (PEDAGOGY_TOOLS.has(toolName)) {
            row.leafResult = true;
            return renderPedagogy(toolName, effective, expanded, row, theme, context, width);
          }
          if (toolName === "subagent_message") {
            row.leafResult = true;
            return renderMessage(effective, expanded, row, theme, context, width);
          }
          if (toolName === "grep") return renderGrep(effective, expanded, row, theme, context, width);
          if ((toolName === "find" || toolName === "ls") && expanded) return [
            inspectionBanner(toolName, effective, row, theme),
            ...(!row.failed ? (toolName === "find" ? findTree : lsListing)(theme, context.toolCallId,
              inspectionPaths(effective, toolName === "find" ? "No files found matching pattern" : "(empty directory)")) : []),
          ];
          const lines = CONNECTED.has(toolName)
            ? renderConnectedChips(toolName, asRecord(context.args), effective, expanded, partial, row, theme, context.isError || asRecord(effective).isError === true)
            : [expanded && row.settled && OUTPUT_TOOLS.has(toolName)
              ? statusBanner(theme, effective, row)
              : ` ${theme.fg("borderMuted", "└─")} ${theme.fg(row.failed ? "error" : running ? "muted" : "success", running ? "running" : summary(toolName, effective, Boolean(row.failed)))}`];
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
    // and bash/powershell keep their expansion ours too: the native file
    // render proved near-uncolored, and the native bash output view has no
    // framing — ours adds the exit banner plus the railed head-and-tail fold.
    // Inspection and pedagogy tools keep their question/query spines too.
    const other = CONNECTED.has(toolName) || FILE_TOOLS.has(toolName) || OUTPUT_TOOLS.has(toolName) || INSPECT_TOOLS.has(toolName) || PEDAGOGY_TOOLS.has(toolName) || RECEIPT_TOOLS.has(toolName) ? undefined : next();
    if (!other?.renderResult) return mine;
    // Reply receipts own both rows: their leading line and tuicr target are
    // more useful than the generic tool summary, even while collapsed.
    if (toolName === "tuicr_reply" && other.renderCall) return other;
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
