/**
 * Public-API work-step renderer experiment. Load with pi -ne -e <this file>.
 * Owns the call row and collapsed summary for every tool (built-ins ship
 * their own renderers in pi 1.0.4, so `next() ?? mine` would never apply).
 * Expanded bodies: connected tools, file-shaped tools (read, write), and
 * bash/powershell/python keep OUR expansion — chips and recentTools trees,
 * numbered syntax-highlighted content, and status-framed command output
 * (✓/✗ exit banner + railed head-and-tail fold). Inspection tools own
 * their query/results too; pedagogy tools own question leaves and verdicts.
 * Message, review, and tuicr receipts own leaves, never agent chips.
 * MCP tools own neutral server badges and read/send/default result bodies.
 * No-mistakes expands its chip into TOON pipeline framing.
 * Other tools delegate to
 * downstream renderResult when present.
 * Ctrl+Q toggles command visibility for bash/powershell/python: hidden
 * (the launch default), the intent title is the row; visible, the numbered
 * body returns.
 * No assistant-message grouping or native expanded output: each tool owns its
 * row, and expansion is bounded text/details (images are described, not drawn).
 */
import { execSync } from "node:child_process";
import {
  getLanguageFromPath,
  highlightCode,
  initTheme,
  keyHint,
  truncateToVisualLines,
  type ExtensionAPI,
  type ExtensionContext,
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
// Intent titles the harness requested from the session model for title-less
// output-tool calls, keyed by toolCallId. tool_result persists them into the
// stored details as intentTitle, so reloaded sessions restore them without
// another request.
const generatedTitles = new Map<string, string>();
const pendingTitles = new Set<string>();
// Ctrl+Q state: every pi launch starts with command bodies minimized. The
// toggle is process state, not row state, so session switches keep it.
let commandsHidden = true;
const CONNECTED = new Set(["subagent", "no_mistakes_axi"]);
// Launch/message/review receipts are not agent runs: never route them through chips.
const RECEIPT_TOOLS = new Set(["subagent_message", "hunk_review", "tuicr"]);
const FILE_TOOLS = new Set(["read", "write"]);
const OUTPUT_TOOLS = new Set(["bash", "powershell", "python"]);
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

// Repository roots for path display, cached per session cwd. An absolute
// path under the repo root renders relative to that root, so edit rows stay
// short and stable no matter which worktree the session runs in.
const repoRoots = new Map<string, string | null>();
function repoRoot(cwd: string): string | undefined {
  if (!repoRoots.has(cwd)) {
    try {
      repoRoots.set(cwd, execSync("git rev-parse --show-toplevel", {
        cwd, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null);
    } catch {
      repoRoots.set(cwd, null);
    }
  }
  return repoRoots.get(cwd) ?? undefined;
}

function displayPath(path: string, cwd: string): string {
  const root = repoRoot(cwd);
  if (!root || !path.startsWith(`${root}/`)) return path;
  return path.slice(root.length + 1) || ".";
}

function preview(tool: string, args: RecordValue, cwd = ""): string {
  const path = clean(args.path || args.file);
  switch (tool) {
    case "edit": return `${displayPath(path, cwd)} · ${plural(Array.isArray(args.edits) ? args.edits.length : 1, "edit")}`;
    case "bash": case "powershell": return `$ ${firstLine(args.command)}`;
    case "python": return `$ ${firstLine(args.code)}`;
    case "read": return [path, ...["offset", "limit"].flatMap((key) =>
      finiteNumber(args[key]) ? [`${key}=${args[key]}`] : [])].join(" · ");
    case "write": return `${path} · ${plural(asString(args.content).split("\n").length, "line")}`;
    case "grep": case "find": return `${JSON.stringify(clean(args.pattern))} in ${path || "."}${args.glob ? ` · ${clean(args.glob)}` : ""}`;
    case "ls": return path || ".";
    case "subagent": return clean(args.name || args.agent);
    case "no_mistakes_axi": return clean(args.args) || clean(args.phase) || clean(args.task);
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
    case "bash": case "powershell": case "python": return `${exitCode(result) === undefined ? "done" : `exit ${exitCode(result)}`} · ${plural(count, "line")}${truncated}`;
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

// Only decode the scalar/record/table subset emitted by axi, not arbitrary YAML.
// Unknown sections remain unused; malformed rows never become guessed findings.
function toonScalar(value: string): string | undefined {
  const text = value.trim();
  if (text.startsWith('"')) {
    try { return asString(JSON.parse(text)); } catch { return undefined; }
  }
  if (text.includes('"')) return undefined;
  return text === "null" ? "" : text;
}

function toonCells(line: string): string[] | undefined {
  const cells: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (quoted && line[i] === "\\") { i++; continue; }
    if (line[i] === '"') quoted = !quoted;
    else if (!quoted && line[i] === ",") {
      const cell = toonScalar(line.slice(start, i));
      if (cell === undefined) return undefined;
      cells.push(cell);
      start = i + 1;
    }
  }
  if (quoted) return undefined;
  const last = toonScalar(line.slice(start));
  return last === undefined ? undefined : [...cells, last];
}

const pipelineData = new Map<string, { source: string; data?: RecordValue }>();

// Live no-mistakes review state from the pane extension's activity events:
// the tracked run plus the finding ids still unresolved at its review gate.
// A finding a later fix round resolved no longer appears in the current
// gate listing; chips of that same run drop it so resolved findings do not
// linger in the transcript. Findings without an id cannot be tracked and
// always render; chips of other runs are history and render unfiltered.
const noMistakesLive: { runId?: string; unresolved?: Set<string> } = {};
function parsePipeline(id: string, source: string): RecordValue | undefined {
  const cached = pipelineData.get(id);
  if (cached?.source === source) return cached.data;
  const data: RecordValue = {};
  const stack = [{ indent: -2, data }];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    // Axi emits two-space nesting. Do not let children of an unsupported
    // header (e.g. help[6]:) leak status fields into the enclosing record.
    if (indent !== stack[stack.length - 1].indent + 2) continue;
    const parent = stack[stack.length - 1].data;
    const table = /^\s*(steps|findings)\[\d+\]\{([^}]+)\}:\s*$/.exec(line);
    if (table) {
      const keys = table[2].split(",").map((key) => key.trim());
      const records: RecordValue[] = [];
      while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].search(/\S/) > indent) {
        const cells = toonCells(lines[++i].trim());
        if (cells?.length === keys.length) records.push(Object.fromEntries(keys.map((key, index) => [key, cells[index]])));
      }
      parent[table[1]] = records;
      continue;
    }
    const field = /^\s*([a-z_]+):(?:\s+(.*))?\s*$/.exec(line);
    if (!field) continue;
    if (field[2]?.trim()) {
      const value = toonScalar(field[2]);
      if (value !== undefined) parent[field[1]] = value;
    } else {
      const child: RecordValue = {};
      parent[field[1]] = child;
      stack.push({ indent, data: child });
    }
  }
  const shaped = ["run", "gate", "branch_sync"].some((key) => Object.keys(asRecord(data[key])).length > 0);
  const parsed = shaped ? data : undefined;
  pipelineData.set(id, { source, data: parsed });
  return parsed;
}

function pipelineFindingCount(data: RecordValue | undefined): number | undefined {
  const value = clean(asRecord(data?.run).findings);
  if (value === "none") return 0;
  // Compound categories may overlap (awaiting vs auto-fix); do not guess a total.
  const count = /^(\d+)(?:\s+[\w-]+)?$/.exec(value);
  const total = count ? Number(count[1]) : undefined;
  return finiteNumber(total) ? total : undefined;
}

/** Live unresolved-finding ids for the run this parsed pipeline belongs to,
 *  when the pane extension is tracking that run. Undefined means no live
 *  state applies and history renders unfiltered. */
function liveUnresolvedFor(data: RecordValue | undefined): Set<string> | undefined {
  const runId = clean(asRecord(data?.run).id);
  return runId && noMistakesLive.runId === runId ? noMistakesLive.unresolved : undefined;
}

/** Count findings still unresolved at the live review gate: rows without an
 *  id cannot be tracked and always count; rows whose id the current gate no
 *  longer lists were resolved by a fix round and do not count. */
function countLiveFindings(data: RecordValue | undefined, unresolved: Set<string>): number | undefined {
  const rows = [
    ...(Array.isArray(asRecord(data?.gate).findings) ? asRecord(data?.gate).findings : []),
    ...(Array.isArray(asRecord(data).findings) ? asRecord(data).findings : []),
  ].map(asRecord);
  if (rows.length === 0) return pipelineFindingCount(data);
  let visible = 0;
  for (const row of rows) {
    const id = clean(row.id);
    if (!id || unresolved.has(id)) visible++;
  }
  return visible;
}

function renderPipeline(result: Result, row: Row, theme: Theme, context: RenderContext, width: number): string[] {
  const details = asRecord(result.details);
  const output = asString(details.output) || textContent(result);
  const data = parsePipeline(context.toolCallId, output);
  if (!data) return [
    ` ${theme.fg("borderMuted", "└─")} ${theme.fg(row.failed ? "error" : "dim", row.failed ? `✗ ${firstLine(asRecord(details.progress).error || output) || "failed"}` : row.settled ? "✓ completed" : "● running")}`,
    ...expandedOutput("bash", { ...result, content: [{ type: "text", text: output }] }, theme, context, width),
  ];
  const run = asRecord(data.run);
  const gate = asRecord(data.gate);
  const sync = asRecord(data.branch_sync);
  const steps = Array.isArray(run.steps) ? run.steps.map(asRecord) : [];
  const branch = clean(run.branch);
  const pr = clean(run.pr);
  const prNumber = /\/pull\/(\d+)(?:\D|$)/.exec(pr)?.[1];
  const scope = prNumber ? `pr #${prNumber}` : pr;
  const lines: string[] = [];
  if (branch || scope) lines.push(` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "▣ ")} ${theme.fg("text", branch)}${scope ? theme.fg("dim", `${branch ? " · " : ""}${scope}`) : ""}`);
  const outcome = clean(data.outcome);
  const statuses = [clean(run.status), clean(gate.status), outcome];
  const blocked = row.failed || statuses.some((status) => ["failed", "blocked", "cancelled"].includes(status));
  const awaiting = statuses.includes("awaiting_approval") || steps.some((step) => step.status === "awaiting_approval");
  const passed = statuses.some((status) => ["passed", "merged", "completed"].includes(status));
  const findings: RecordValue[] = [...(Array.isArray(gate.findings) ? gate.findings.map((item) => ({ ...asRecord(item), step: asRecord(item).step || gate.step })) : []),
    ...(Array.isArray(data.findings) ? data.findings.map(asRecord) : [])];
  // Live resolution state: when this chip belongs to the run the pane
  // extension tracks, drop findings the current review gate no longer
  // lists — a fix round resolved them and they must not linger here.
  const unresolved = liveUnresolvedFor(data);
  let resolvedHidden = 0;
  const visibleFindings = unresolved
    ? findings.filter((finding) => {
      const id = clean(finding.id);
      if (!id || unresolved.has(id)) return true;
      resolvedHidden++;
      return false;
    })
    : findings;
  const count = unresolved ? visibleFindings.length : pipelineFindingCount(data);
  const label = blocked ? "✗ gate blocked" : awaiting ? "● gate awaiting approval" : passed ? "✓ gate passed"
    : run.status === "running" ? "● gate running" : "";
  if (label) lines.push(` ${theme.fg("borderMuted", "└─")} ${theme.fg(blocked ? "error" : awaiting || !passed ? "mdLink" : "success", label + (count === undefined ? "" : ` · ${plural(count, "finding")}`) + (passed && !blocked && !awaiting && outcome ? ` · outcome ${outcome}` : ""))}${awaiting && gate.step ? theme.fg("dim", ` · ${clean(gate.step)}`) : ""}`);
  for (const finding of visibleFindings) {
    const id = clean(finding.id).replace(/^R(\d+)$/, "r$1");
    const identity = [id, clean(finding.step)].filter(Boolean).join(" · ");
    const summary = clean(finding.summary || finding.description);
    const body = [identity, summary].filter(Boolean).join(" — ");
    if (!body) continue;
    const wrapped = wrapLine(theme.fg("dim", body), width - 7, "start").chunks;
    lines.push(...wrapped.map((chunk, index) => index === 0
      ? ` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "✎ ")} ${chunk}`
      : ` ${theme.fg("borderMuted", "│")}     ${chunk}`));
  }
  if (resolvedHidden > 0) lines.push(...spineText(theme, `${plural(resolvedHidden, "resolved finding")} hidden`, width));
  if (count === undefined && clean(run.findings)) lines.push(...spineText(theme, `findings: ${clean(run.findings)}`, width));
  if (gate.summary) lines.push(...spineText(theme, gate.summary, width));
  const stepLine = steps.filter((step) => clean(step.step) && clean(step.status)).map((step) => {
    const status = clean(step.status);
    const mark = ["completed", "passed", "merged"].includes(status) ? theme.fg("success", "✓")
      : ["failed", "blocked", "cancelled"].includes(status) ? theme.fg("error", "✗")
      : status !== "pending" && RUNNING.has(status) ? theme.fg("mdLink", "●") : theme.fg("dim", status);
    const duration = /^\d+$/.test(asString(step.duration_ms)) ? formatElapsed(Number(step.duration_ms)) : "";
    return theme.fg("dim", `${clean(step.step)} `) + mark + (duration ? theme.fg("dim", ` ${duration}`) : "");
  }).join(theme.fg("dim", " · "));
  if (stepLine) lines.push(...wrapLine(stepLine, width - 4, "start").chunks.map((chunk) => `    ${chunk}`));
  const syncLine = [clean(sync.state), clean(sync.note)].filter(Boolean).join(" · ");
  const next = clean(asRecord(sync.next_action).command || asRecord(data.next_action).command);
  for (const detail of [...(syncLine ? [`branch_sync: ${syncLine}`] : []), ...(next ? [`next: ${next}`] : [])]) {
    lines.push(...wrapLine(theme.fg("dim", detail), width - 4, "start").chunks.map((chunk) => `    ${chunk}`));
  }
  return lines;
}

function renderConnectedChips(tool: string, args: RecordValue, result: Result, expanded: boolean, partial: boolean, row: Row, theme: Theme, outerFailed: boolean, id: string): string[] {
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
    const pipeline = tool === "no_mistakes_axi" ? parsePipeline(id, asString(root.output)) : undefined;
    const chipUnresolved = pipeline ? liveUnresolvedFor(pipeline) : undefined;
    const findings = chipUnresolved ? countLiveFindings(pipeline, chipUnresolved) : pipelineFindingCount(pipeline);
    const subcommand = tool === "no_mistakes_axi" && ["run", "respond", "status", "sync"].includes(asString(root.subcommand)) ? clean(root.subcommand) : "";
    const label = theme.fg("text", theme.bold(name)) + (subcommand ? theme.fg("dim", ` · ${subcommand}`) : "")
      + (findings !== undefined && findings > 0 ? theme.fg("mdLink", ` · findings ${findings}`) : "");
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
const TITLE_CAP = 60;
type CommandBody = { body: string; command: boolean; op: string };
type CommandRender = { rows: CommandBody[]; title?: string };
const highlightedCommands = new Map<string, { source: string; theme: string; rows: CommandBody[]; title?: string }>();

function capTitle(title: string): string {
  const chars = [...title];
  return chars.length <= TITLE_CAP ? title : `${chars.slice(0, TITLE_CAP - 1).join("")}…`;
}

/**
 * Intent-title lift for bash and python rows: the model opens each call
 * with one `# <intent>` comment line (the APPEND_SYSTEM.md rule) and the
 * row header carries it as `— <title>` beside the tool name. Only a
 * comment block that starts the source lifts — a `#` after any code stays
 * body text, and a heredoc body cannot start a script, so no heredoc scan
 * is needed. The title is the first comment line's text; the body starts
 * at the first line that is neither comment nor blank.
 */
function liftLeadingComment(source: string): { title: string; rest: string } | undefined {
  const lines = source.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;
  if (index === lines.length || !lines[index].trimStart().startsWith("#")) return undefined;
  const title = clean(lines[index].trimStart().replace(/^#+\s*/, ""));
  if (!title) return undefined;
  while (index < lines.length && (!lines[index].trim() || lines[index].trimStart().startsWith("#"))) index++;
  return { title, rest: lines.slice(index).join("\n") };
}

/**
 * Intent-title lift for mcpScript rows: the model opens each script with
 * one `// <intent>` comment line (the APPEND_SYSTEM.md rule) and the row
 * header carries it as `— <title>` beside the tool name, mirroring the
 * bash/python lift. A `// @options:` directive line is skipped, never
 * lifted, so both the rule-following title-first order and the legacy
 * @options-first order title correctly. The title is the first other `//`
 * comment line before any code; the body starts at the first line that is
 * neither comment nor blank.
 */
function liftLeadingJsComment(source: string): { title: string; rest: string } | undefined {
  const lines = source.split("\n");
  let index = 0;
  let title = "";
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (!line.trimStart().startsWith("//")) break;
    const text = clean(line.trimStart().replace(/^\/\/\s*/, ""));
    if (text && !text.startsWith("@options") && !title) title = text;
    index++;
  }
  if (!title) return undefined;
  return { title, rest: lines.slice(index).join("\n") };
}

/**
 * mcpScript call rows borrow the python leaf semantics: the first
 * non-blank code line is the executable `$` leaf, every other line rides
 * the `│` spine. The whole script highlights through the javascript
 * grammar in ONE call (the same grammar pi's own codemode renderer uses),
 * so template literals and blocks keep their context line to line. A
 * leading `//` comment block lifts into the row title exactly like bash
 * and python. Cached beside the bash and python rows: same per-frame
 * render pressure, same changed-source-or-theme rule.
 */
function jsBodies(theme: Theme, toolCallId: string, code: string): CommandRender {
  const themeName = theme.name ?? "";
  const cached = highlightedCommands.get(toolCallId);
  if (cached && cached.source === code && cached.theme === themeName) return { rows: cached.rows, title: cached.title };
  ensureHighlightTheme(theme);
  const lift = liftLeadingJsComment(code);
  const lines = (lift ? lift.rest : code).replace(/\n+$/, "").split("\n");
  const leaf = lines.findIndex((line) => line.trim());
  if (leaf === -1) {
    highlightedCommands.set(toolCallId, { source: code, theme: themeName, rows: [], title: lift?.title });
    return { rows: [], title: lift?.title };
  }
  let highlighted = lines;
  try {
    const styled = highlightCode(lines.join("\n"), "javascript");
    if (styled.length === lines.length) highlighted = styled;
  } catch {
    // Highlighting needs pi's theme runtime; plain lines still render.
  }
  const rows = lines.map((line, index) => ({
    body: highlighted[index] ?? line,
    command: index === leaf,
    op: index === leaf ? "$" : "",
  }));
  highlightedCommands.set(toolCallId, { source: code, theme: themeName, rows, title: lift?.title });
  return { rows, title: lift?.title };
}

function commandBodies(theme: Theme, toolCallId: string, tool: string, command: string): CommandRender {
  const themeName = theme.name ?? "";
  const cached = highlightedCommands.get(toolCallId);
  if (cached && cached.source === command && cached.theme === themeName) return { rows: cached.rows, title: cached.title };
  ensureHighlightTheme(theme);
  const lift = tool === "bash" ? liftLeadingComment(command) : undefined;
  const lang = tool === "powershell" ? "powershell" : "bash";
  const rows = commandRows(lift ? lift.rest : command).map((part) => {
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
  highlightedCommands.set(toolCallId, { source: command, theme: themeName, rows, title: lift?.title });
  return { rows, title: lift?.title };
}

/**
 * Python call rows borrow the bash leaf semantics: the first non-blank code
 * line is the executable `$` leaf, every other line rides the `│` spine the
 * way quoted/heredoc continuations do. The whole script highlights through
 * the python grammar in ONE call, so multi-line strings and blocks keep
 * their context line to line — the structured `code` arg is what makes this
 * deterministic where bash heredoc bodies cannot be. A leading `#` comment
 * block lifts into the row title exactly like bash. Cached beside the bash
 * rows: same per-frame render pressure, same changed-source-or-theme rule.
 */
function pythonBodies(theme: Theme, toolCallId: string, code: string): CommandRender {
  const themeName = theme.name ?? "";
  const cached = highlightedCommands.get(toolCallId);
  if (cached && cached.source === code && cached.theme === themeName) return { rows: cached.rows, title: cached.title };
  ensureHighlightTheme(theme);
  const lift = liftLeadingComment(code);
  const lines = (lift ? lift.rest : code).replace(/\n+$/, "").split("\n");
  const leaf = lines.findIndex((line) => line.trim());
  if (leaf === -1) {
    highlightedCommands.set(toolCallId, { source: code, theme: themeName, rows: [], title: lift?.title });
    return { rows: [], title: lift?.title };
  }
  let highlighted = lines;
  try {
    const styled = highlightCode(lines.join("\n"), "python");
    if (styled.length === lines.length) highlighted = styled;
  } catch {
    // Highlighting needs pi's theme runtime; plain lines still render.
  }
  const rows = lines.map((line, index) => ({
    body: highlighted[index] ?? line,
    command: index === leaf,
    op: index === leaf ? "$" : "",
  }));
  highlightedCommands.set(toolCallId, { source: code, theme: themeName, rows, title: lift?.title });
  return { rows, title: lift?.title };
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

function tuicrData(args: RecordValue, cwd: string, result?: Result) {
  const details = asRecord(result?.details);
  const text = asString(details.message) || (result ? textContent(result) : "");
  const attached = /^Attached to active tuicr review session (\S+) \((.*?)\)\./.exec(text);
  const launched = /^tuicr launched in a background pane for (.*?) —/.exec(text);
  const repo = clean(details.repo || attached?.[2] || launched?.[1] || args.repo || cwd);
  const slug = clean(details.slug || attached?.[1] || /Session (\S+) is active in the new pane\./.exec(text)?.[1]);
  const pane = finiteNumber(details.paneId) ? String(details.paneId)
    : clean(details.paneId) || /\bpane (?:id[: ]+)([\w.:%-]+)/i.exec(text)?.[1] || "";
  const scope = args.sessionSlug || details.attached === true || attached
    ? `attached${clean(args.sessionSlug) || slug ? ` · session ${clean(args.sessionSlug) || slug}` : ""}`
    : args.scope === "revset" ? `revset${clean(args.revset) ? ` ${clean(args.revset)}` : ""}` : "working-tree";
  return { repo: repo.replace(/\/+$/, "").split("/").pop() || repo, scope, slug, pane };
}

function tuicrLeaf(theme: Theme, data: ReturnType<typeof tuicrData>): string[] {
  return [` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "▣ ")} ${theme.fg("text", data.repo)}${theme.fg("dim", ` · ${data.scope}`)}`];
}

function renderTuicr(result: Result, expanded: boolean, row: Row, theme: Theme, context: RenderContext, width: number): string[] {
  const source = JSON.stringify([context.args, context.cwd, result.details, textContent(result), expanded, row.settled, row.failed, width]);
  const cached = receiptRows.get(context.toolCallId);
  if (cached?.source === source && cached.theme === theme) return cached.rows;
  const data = tuicrData(asRecord(context.args), context.cwd, result);
  const lines = tuicrLeaf(theme, data);
  const label = row.failed ? `✗ ${firstLine(asRecord(result.details).error || textContent(result)) || "failed"}`
    : !row.settled ? "running" : `✓ watching${data.slug ? ` · session ${data.slug}` : ""}${data.pane ? ` · pane ${data.pane}` : ""}`;
  lines.push(` ${theme.fg("borderMuted", "└─")} ${theme.fg(row.failed ? "error" : row.settled ? "success" : "dim", label)}`);
  if (expanded) {
    for (const detail of [`scope: ${data.scope}`, ...(data.slug ? [`slug: ${data.slug}`] : []),
      ...(!row.failed && row.settled ? ["comments arrive as steer messages; the final batch lands when the TUI exits"] : [])]) {
      lines.push(...wrapLine(theme.fg("dim", detail), width - 4, "start", Number.MAX_SAFE_INTEGER).chunks.map((chunk) => `    ${chunk}`));
    }
  }
  receiptRows.set(context.toolCallId, { source, theme, rows: lines });
  return lines;
}

function commentLeaves(theme: Theme, comments: unknown, expanded: boolean, width: number): string[] {
  if (!Array.isArray(comments)) return [];
  return comments.map(asRecord).flatMap((comment) => {
    const file = clean(comment.filePath) || "(file)";
    const line = finiteNumber(comment.newLine) ? comment.newLine : comment.oldLine ?? comment.line;
    const hunk = comment.hunk ?? comment.hunkNumber;
    const location = file + (finiteNumber(line) ? `:${line}` : finiteNumber(hunk) ? ` · hunk ${hunk}` : "");
    const lines = [` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "✎ ")} ${theme.fg("dim", location + (comment.summary ? " — " : ""))}${theme.fg("text", shortPedagogy(comment.summary, width - 10 - [...location].length))}`];
    if (expanded && comment.rationale) lines.push(...spineText(theme, comment.rationale, width));
    return lines;
  });
}

// Hunk returns CLI JSON as text, not details. Head truncation may cut that
// JSON mid-string; salvage only complete identity fields before its arrays.
function hunkData(result: Result): { data: RecordValue; parsed: boolean } {
  const text = textContent(result);
  let data: RecordValue = {};
  let parsed = false;
  try {
    data = asRecord(JSON.parse(text));
    parsed = Object.keys(data).length > 0;
  } catch {
    const prefix = text.split(/"(?:files|reviewNotes|applied)"\s*:/, 1)[0];
    for (const key of ["sessionId", "repoRoot", "sourceLabel"]) {
      const match = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(prefix);
      if (match) {
        try { data[key] = JSON.parse(match[1]); } catch { /* Incomplete strings stay unknown. */ }
      }
    }
  }
  return { data: { ...data, ...asRecord(result.details) }, parsed };
}

function reviewState(review: RecordValue, theme: Theme): string[] {
  // Keep all returned status/notes metadata, but show patches as actual lines
  // rather than escaped JSON strings. No inferred session status or counts.
  const metadata = JSON.stringify(review, (key, value) => key === "patch" ? undefined : value, 2);
  const lines = metadata.split("\n").map((line) => theme.fg("toolOutput", safeLine(line)));
  const files = Array.isArray(review.files) ? review.files.map(asRecord) : [];
  const patches = [...files, ...(review.patch ? [review] : [])];
  for (const file of patches) {
    if (typeof file.patch !== "string") continue;
    if (file.path) lines.push(theme.fg("dim", clean(file.path)));
    lines.push(...file.patch.replace(/\n$/, "").split("\n").map((line) => theme.fg("dim", safeLine(line))));
  }
  return lines;
}

function renderReview(result: Result, expanded: boolean, row: Row, theme: Theme, context: RenderContext, width: number): string[] {
  const args = asRecord(context.args);
  const text = textContent(result);
  const source = JSON.stringify([args, result.details, text, expanded, row.settled, row.failed, width]);
  const cached = receiptRows.get(context.toolCallId);
  if (cached?.source === source && cached.theme === theme) return cached.rows;
  const { data, parsed } = hunkData(result);
  const review = data.review ? asRecord(data.review) : data;
  const applied = asRecord(data.result).applied ?? data.applied;
  const session = clean(review.sessionId || data.sessionId || asRecord(data.result).sessionId);
  const returned = Array.isArray(data.comments) ? data.comments : Array.isArray(applied) ? applied : [];
  // CLI batch results preserve request order; keep requested anchors/summaries
  // and fill any returned rationale without treating requested count as applied.
  const comments = Array.isArray(args.comments) ? args.comments.map((comment, index) => ({ ...asRecord(returned[index]), ...asRecord(comment) })) : returned;
  const applying = args.operation === "comment_apply";
  const identity = clean(review.repoRoot || review.sourceLabel) || session;
  const lines = applying ? commentLeaves(theme, comments, expanded, width)
    : [` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "▣ ")} ${theme.fg("text", "hunk")}${identity ? theme.fg("dim", ` · ${identity}`) : ""}`];
  const cancelled = data.status === "cancelled";
  const error = row.failed || Boolean(data.error);
  const count = Array.isArray(applied) ? applied.length : undefined;
  const label = cancelled ? "✗ cancelled" : error ? `✗ ${firstLine(data.error || text) || "failed"}`
    : !row.settled ? "running" : applying && count !== undefined ? `✓ applied · ${plural(count, "comment")}${session ? ` · session ${session}` : ""}`
    : !applying && session ? `✓ session ${session}` : "✓ completed";
  lines.push(` ${theme.fg("borderMuted", "└─")} ${theme.fg(cancelled ? "dim" : error ? "error" : row.settled ? "success" : "dim", label)}`);
  if (expanded && !applying) {
    const state = parsed || Object.keys(asRecord(result.details)).length ? reviewState(review, theme)
      : text ? text.replace(/\n$/, "").split("\n").map((line) => theme.fg("toolOutput", safeLine(line))) : [];
    for (const line of foldInspection(state, theme, " lines")) {
      lines.push(...wrapLine(line, width - 4).chunks.map((chunk) => `    ${chunk}`));
    }
  }
  receiptRows.set(context.toolCallId, { source, theme, rows: lines });
  return lines;
}

function mcpIdentity(tool: string) {
  const parts = tool.split("__");
  const name = parts[parts.length - 1];
  const kind = /^(?:list_|get_|search_|fetch_|read_|query_|whoami|download_)/.test(name) ? "read"
    : /^(?:send_|post_|create_|modify_|update_|add_|draft_|append_|move_|rename_|invite_|join_|manage_)/.test(name) ? "send" : "default";
  return { server: clean(parts[1]), name: clean(name), kind };
}

function mcpArg(args: RecordValue, keys = ["query", "message", "text", "path", "channel", "file", "url", "name"]): string {
  for (const key of keys) if (firstLine(args[key])) return asString(args[key]);
  return asString(Object.values(args).find((value) => firstLine(value)));
}

function renderMcp(tool: string, result: Result, expanded: boolean, row: Row, theme: Theme, context: RenderContext, width: number): string[] {
  const { kind } = mcpIdentity(tool);
  const text = textContent(result);
  const details = asRecord(result.details);
  const source = JSON.stringify([tool, context.args, details, text, expanded, row.settled, row.failed, width]);
  const cached = receiptRows.get(context.toolCallId);
  if (cached?.source === source && cached.theme === theme) return cached.rows;
  const output = text.trim() ? text.replace(/\n$/, "").split("\n").map(safeLine) : [];
  const count = output.filter((line) => line.trim()).length;
  const truncated = details.truncation === true || asRecord(details.truncation).truncated === true
    || asRecord(details.outputGuard).truncated === true || /\btruncated\b/i.test(text);
  const label = row.failed ? `✗ ${firstLine(text) || firstLine(details.error) || "failed"}` : !row.settled ? "● running"
    : kind === "read" ? count ? `✓ ${plural(count, "item")}` : "✓ no results"
    : kind === "send" ? "✓ sent" : "✓ done";
  const color = row.failed ? "error" : !row.settled || (kind === "read" && !count) ? "dim" : "success";
  const lines: string[] = [];
  if (kind === "send") {
    const payload = mcpArg(asRecord(context.args), ["message", "text", "body", "content", "comment_content", "media_path", "summary", "title", "name", "path", "file", "url"]);
    if (expanded) {
      lines.push(...pedagogyText(theme, payload, "»", width, "text"));
      lines[0] = lines[0].replace(` ${theme.fg("borderMuted", "│")}  `, ` ${theme.fg("borderMuted", "├─")} `);
    } else lines.push(` ${theme.fg("borderMuted", "├─")} ${theme.fg("dim", "» ")} ${theme.fg("text", shortPedagogy(payload, width - 7))}`);
  }
  lines.push(` ${theme.fg("borderMuted", "└─")} ${theme.fg(color, label)}${kind === "read" && truncated ? theme.fg("dim", " · truncated") : ""}`);
  if (expanded && kind !== "send") {
    for (const line of foldInspection(output.map((line) => theme.fg("toolOutput", line)), theme, " lines")) {
      lines.push(...wrapLine(line, width - 4).chunks.map((chunk) => `    ${chunk}`));
    }
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
  extensionCtx = undefined;
  for (const row of rows.values()) stop(row);
  rows.clear();
  background.clear();
  repoRoots.clear();
  generatedTitles.clear();
  pendingTitles.clear();
  highlightedCommands.clear();
  highlightedGrep.clear();
  inspectionTrees.clear();
  pedagogyRows.clear();
  receiptRows.clear();
  pipelineData.clear();
  quizDisplayOptions.clear();
  noMistakesLive.runId = undefined;
  noMistakesLive.unresolved = undefined;
}

function component(draw: (width?: number) => string[]): Component {
  // Recompute on render, not just on renderer invocation: public invalidation
  // can redraw an already-returned component after a background bus update.
  return {
    render: (width) => draw(width).map((line) => truncateToWidth(line, Math.max(0, width))),
    invalidate() {},
  };
}

// The live ExtensionContext, refreshed on every session_start; the render
// path needs it to backfill titles but renders carry only a RenderContext.
let extensionCtx: ExtensionContext | undefined;

// Backfill: ask the session model for a one-line intent title only when a
// LIVE row renders without one — the comment title from the original tool
// message always wins, restored rows keep their dim preview, and streaming
// rows wait for argsComplete. Fire-and-forget: the row keeps its dim preview
// until the answer lands, then invalidates and redraws titled.
function requestTitle(toolCallId: string, tool: string, source: string): void {
  if (!source.trim() || generatedTitles.has(toolCallId) || pendingTitles.has(toolCallId)) return;
  const ctx = extensionCtx;
  if (!ctx?.model) return;
  pendingTitles.add(toolCallId);
  const clipped = source.length > 4000 ? `${source.slice(0, 4000)}\n…` : source;
  void (async () => {
    try {
      const model = ctx.model;
      const response = await ctx.modelRegistry.complete(
        model,
        {
          systemPrompt:
            "You write one-line intent titles for developer tool calls. Reply with ONLY the title: verb-first, 10-15 words, states the intent of the call, no trailing period, no quotes, no backticks, no markup.",
          messages: [{ role: "user" as const, content: [{ type: "text" as const, text: `${tool} call:\n${clipped}` }], timestamp: Date.now() }],
        },
        { signal: ctx.signal },
      );
      const title = clean(asRecord(response).content instanceof Array
        ? (asRecord(response).content as RecordValue[]).filter((block) => asString(asRecord(block).type) === "text")
          .map((block) => asString(asRecord(block).text)).join(" ")
        : "").replace(/^["'`]+|["'`]+$/g, "");
      if (title) {
        generatedTitles.set(toolCallId, capTitle(title));
        rows.get(toolCallId)?.invalidate?.();
      }
    } catch {
      // No title beats a broken render; the dim preview row stays.
    } finally {
      pendingTitles.delete(toolCallId);
    }
  })();
}

export default function (pi: ExtensionAPI) {
  let sessionId: string | undefined;
  pi.on("session_start", (_event, ctx) => {
    const nextId = ctx.sessionManager.getSessionId();
    if (sessionId === nextId) {
      extensionCtx = ctx;
      return;
    }
    disposeState();
    extensionCtx = ctx;
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
  pi.on("tool_result", (event) => {
    const title = generatedTitles.get(event.toolCallId);
    if (!title || asString(asRecord(event.details).intentTitle)) return;
    return { details: { ...asRecord(event.details), intentTitle: title } };
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
  const unsubscribeNoMistakes = pi.events.on("no-mistakes:activity-update", (payload: unknown) => {
    const snapshot = asRecord(asRecord(payload).snapshot);
    const runId = clean(snapshot.id);
    // A missing run id means the run ended or none is tracked: keep the last
    // known resolution state so completed runs still render filtered.
    if (!runId) return;
    if (noMistakesLive.runId !== runId) {
      noMistakesLive.runId = runId;
      noMistakesLive.unresolved = undefined;
    }
    const reviewFindings = snapshot.reviewFindings;
    if (Array.isArray(reviewFindings)) {
      const ids = new Set<string>();
      for (const item of reviewFindings) {
        const id = clean(asRecord(item).id);
        if (id) ids.add(id);
      }
      noMistakesLive.unresolved = ids;
    }
    // Redraw mounted rows so resolution applies to already-rendered chips.
    for (const row of rows.values()) row.invalidate?.();
  });
  pi.on("session_shutdown", () => {
    disposeState();
    unsubscribe();
    unsubscribeNoMistakes();
  });

  pi.registerShortcut("ctrl+q", { // frees ctrl+e for move-to-line-end
    description: "Toggle command and no-mistakes row visibility",
    handler(ctx) {
      commandsHidden = !commandsHidden;
      // Redraw every mounted call row so the transcript flips in place.
      for (const row of rows.values()) row.invalidate?.();
      // The no-mistakes result rows set their visibility class from the
      // absolute state this event carries; their cache-free render refreshes
      // on this notify's render pass.
      pi.events.emit("no-mistakes:toggle-rows", commandsHidden);
      ctx.ui?.notify(
        commandsHidden ? "Commands and no-mistakes rows hidden" : "Commands and no-mistakes rows shown",
        "info",
      );
    },
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
          if (toolName.startsWith("mcp__")) {
            const mcp = mcpIdentity(toolName);
            const badge = `mcp · ${mcp.server} — `;
            const argWidth = width - 4 - badge.length - mcp.name.length - elapsed.length;
            const arg = argWidth > 0 ? shortPedagogy(mcpArg(asRecord(args)), argWidth) : "";
            return [` ${glyph} ${theme.fg("dim", badge)}${theme.fg("text", theme.bold(mcp.name))}${theme.fg("dim", `${arg ? ` ${arg}` : ""}${elapsed}`)}`];
          }
          if (PEDAGOGY_TOOLS.has(toolName)) return [
            ` ${glyph} ${name}${theme.fg("dim", elapsed)}`,
            ...(!row.leafResult ? questionLeaf(theme, asRecord(args).question, false, width) : []),
          ];
          if (toolName === "hunk_review") return [
            ` ${glyph} ${name}${theme.fg("dim", `${asRecord(args).operation ? ` · ${clean(asRecord(args).operation)}` : ""}${elapsed}`)}`,
            ...(!row.leafResult ? commentLeaves(theme, asRecord(args).comments, false, width) : []),
          ];
          if (toolName === "tuicr") return [
            ` ${glyph} ${name}${theme.fg("dim", elapsed)}`,
            ...(!row.leafResult ? tuicrLeaf(theme, tuicrData(asRecord(args), context.cwd)) : []),
          ];
          if (toolName === "subagent_message") return [
            ` ${glyph} ${name}${theme.fg("dim", elapsed)}`,
            ...(!row.leafResult ? messageLeaf(theme, asRecord(args), false, width) : []),
          ];
          if (OUTPUT_TOOLS.has(toolName) || toolName === "mcpScript") {
            const source = toolName === "python" || toolName === "mcpScript"
              ? asString(asRecord(args).code) : asString(asRecord(args).command);
            const { rows: commands, title: lifted } = toolName === "python"
              ? pythonBodies(theme, context.toolCallId, source)
              : toolName === "mcpScript"
                ? jsBodies(theme, context.toolCallId, source)
                : commandBodies(theme, context.toolCallId, toolName, source);
            // A missing comment title falls back to the harness-requested one.
            const title = lifted ?? generatedTitles.get(context.toolCallId);
            if (!title && context.argsComplete !== false && !row.restored) {
              requestTitle(context.toolCallId, toolName, source);
            }
            // The intent title is the row's primary content (Ctrl+E hides
            // the body), so it renders muted — stronger than dim, a step
            // below the main text fg.
            const label = title ? ` ${theme.fg("muted", `— ${capTitle(title)}`)}` : "";
            if (commandsHidden) {
              // Ctrl+Q hide, orthogonal to Ctrl+O: the intent title is the
              // row in collapsed AND expanded views; a title-less call keeps
              // a dim one-line preview so the row stays identifiable.
              if (title) return [` ${glyph} ${name}${label}${theme.fg("dim", elapsed)}`];
              const room = width - clean(toolName).length - 12;
              return [` ${glyph} ${name} ${theme.fg("dim", `$ ${shortPedagogy(source, room)}`)}${theme.fg("dim", elapsed)}`];
            }
            if (commands.length === 1 && commands[0].command && !title) {
              // Inline `$ command` stays for title-less calls only: a lifted
              // title never shares its row with the command, so a titled
              // single command rides the same bare-header + railed-leaf
              // layout as multi-command calls.
              return [` ${glyph} ${name} ${theme.fg("dim", "$")} ${commands[0].body}${theme.fg("dim", elapsed)}`];
            }
            if (commands.length > 0) {
              const rail = theme.fg("borderMuted", "├─");
              const tail = theme.fg("borderMuted", "└─");
              return [
                ` ${glyph} ${name}${label}${theme.fg("dim", elapsed)}`,
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
            if (title) {
              // Comment-only call: no executable row survives the lift, so
              // the title is the whole row.
              return [` ${glyph} ${name}${label}${theme.fg("dim", elapsed)}`];
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
          const arg = preview(toolName, asRecord(args), context.cwd);
          return [` ${glyph} ${name}${theme.fg("dim", `${arg ? ` ${arg}` : ""}${elapsed}`)}`];
        });
      },
      renderResult(result, { expanded, isPartial }, theme, context) {
        const row = capture(context);
        // Reloaded sessions restore harness-requested titles from the stored
        // result details; seed the map before drawing so this very draw sees it.
        const storedTitle = asString(asRecord(asRecord(result).details).intentTitle);
        if (storedTitle && !generatedTitles.has(context.toolCallId)) {
          generatedTitles.set(context.toolCallId, storedTitle);
          rows.get(context.toolCallId)?.invalidate?.();
        }
        const draw = (width = 200) => {
          const live = background.get(context.toolCallId);
          // Retain the last done update too: the parent's stored return value
          // only says "started" and must not replace the final chip on redraw.
          const effective = live?.result ?? result;
          const partial = live ? !live.done : isPartial;
          const running = partial || (CONNECTED.has(toolName) && !live?.done
            && roots(effective).some((root) => RUNNING.has(asString(asRecord(root.progress).status))));
          row.failed = INSPECT_TOOLS.has(toolName) || toolName.startsWith("mcp__")
            ? context.isError || asRecord(effective).isError === true
            : failed(effective, context);
          if (RECEIPT_TOOLS.has(toolName) || toolName.startsWith("mcp__")) row.failed ||= Boolean(asRecord(effective.details).error) || asRecord(effective.details).status === "failed";
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
          if (toolName === "tuicr") {
            row.leafResult = true;
            return renderTuicr(effective, expanded, row, theme, context, width);
          }
          if (toolName === "hunk_review") {
            row.leafResult = true;
            return renderReview(effective, expanded, row, theme, context, width);
          }
          if (toolName.startsWith("mcp__")) return renderMcp(toolName, effective, expanded, row, theme, context, width);
          if (toolName === "grep") return renderGrep(effective, expanded, row, theme, context, width);
          if ((toolName === "find" || toolName === "ls") && expanded) return [
            inspectionBanner(toolName, effective, row, theme),
            ...(!row.failed ? (toolName === "find" ? findTree : lsListing)(theme, context.toolCallId,
              inspectionPaths(effective, toolName === "find" ? "No files found matching pattern" : "(empty directory)")) : []),
          ];
          if (toolName === "no_mistakes_axi" && expanded) return renderPipeline(effective, row, theme, context, width);
          // Minimized rows keep the exit status in its status color but dim
          // the line-count tail, so the muted intent title stays the row's
          // focus instead of competing with a full-brightness summary.
          const collapsedSummary = ():
            string => {
            if (!commandsHidden || row.failed || running || !OUTPUT_TOOLS.has(toolName)) {
              return theme.fg(row.failed ? "error" : running ? "muted" : "success", running ? "running" : summary(toolName, effective, Boolean(row.failed)));
            }
            const [status, ...rest] = summary(toolName, effective, false).split(" · ");
            return theme.fg("success", status) + (rest.length ? theme.fg("dim", ` · ${rest.join(" · ")}`) : "");
          };
          const lines = CONNECTED.has(toolName)
            ? renderConnectedChips(toolName, asRecord(context.args), effective, expanded, partial, row, theme, context.isError || asRecord(effective).isError === true, context.toolCallId)
            : [expanded && row.settled && OUTPUT_TOOLS.has(toolName)
              ? statusBanner(theme, effective, row)
              : ` ${theme.fg("borderMuted", "└─")} ${collapsedSummary()}`];
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
    // and bash/powershell/python keep their expansion ours too: the native file
    // render proved near-uncolored, and the native bash output view has no
    // framing — ours adds the exit banner plus the railed head-and-tail fold.
    // Inspection, pedagogy, receipt, and MCP tools keep their own bodies too.
    const other = CONNECTED.has(toolName) || FILE_TOOLS.has(toolName) || OUTPUT_TOOLS.has(toolName) || INSPECT_TOOLS.has(toolName) || PEDAGOGY_TOOLS.has(toolName) || RECEIPT_TOOLS.has(toolName) || toolName.startsWith("mcp__") ? undefined : next();
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
