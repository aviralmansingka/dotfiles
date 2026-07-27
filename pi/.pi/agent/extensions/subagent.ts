/**
 * Minimal subagents extension.
 *
 * Registers a single `subagent` tool with three agents: scout, researcher, worker.
 * Supports single and parallel execution. Output is verbal only (no file handoff).
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, parseFrontmatter, truncateHead, withFileMutationQueue, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentConfig {
	name: string;
	description: string;
	tools: string[];
	model: string;
	thinking: string;
	systemPrompt: string;
	filePath: string;
	/**
	 * If this agent has the `subagent` tool, restrict which agents it may spawn.
	 * Passed to the child pi process via `PI_SUBAGENT_ALLOWED` so the child's
	 * subagents extension filters its own registry before exposing it to the LLM.
	 * `undefined` means no restriction (child sees every registered agent).
	 */
	subagentAgents?: string[];
}

interface ToolEvent {
	tool: string;
	args: string;
	/** Matches the producing tool_execution_start/update/end event. */
	toolCallId?: string;
	/**
	 * "running" while between tool_execution_start and tool_execution_end; flipped
	 * to "done" on end. We store every in-flight call in recentTools (keyed by
	 * toolCallId) rather than a single current-tool slot, because pi-agent-core
	 * dispatches a turn's tool calls in parallel via Promise.all — a single slot
	 * would let the second start overwrite the first.
	 */
	status: "running" | "done";
	startedAt?: number;
	completedAt?: number;
	/**
	 * Live progress of subagents spawned by this tool call. Populated only for
	 * `subagent` tool calls, from the `partialResult.details.results` payload of
	 * `tool_execution_update` events (and refreshed once more from the end
	 * event's final results). Recursive: each child's own progress may carry
	 * further children via its `recentTools[i].children`.
	 */
	children?: AgentResult[];
	/** Agent identity attached by restored/provider-owned structural nodes. */
	agent?: string;
	/** Complete commands rendered as bounded syntax-highlighted leaves below bash/zsh rows. */
	shellCommands?: string[];
}

interface AgentProgress {
	agent: string;
	status: "pending" | "running" | "completed" | "failed";
	task: string;
	/**
	 * Chronological log of tool calls — running and done interleaved. The
	 * renderer prefixes running entries with `▸` and done ones with `  `.
	 */
	recentTools: ToolEvent[];
	toolCount: number;
	tokens: number;
	durationMs: number;
	startedAt?: number;
	completedAt?: number;
	lastMessage: string;
	error?: string;
}

interface AgentResult {
	agent: string;
	task: string;
	output: string;
	exitCode: number;
	progress: AgentProgress;
	model?: string;
	contextWindow?: number;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number };
}

interface Details {
	results: AgentResult[];
}

// ── Config ─────────────────────────────────────────────────────────────

interface ExtensionConfig {
	maxConcurrency?: number;
}

const EXT_DIR = path.dirname(new URL(import.meta.url).pathname);
const AGENTS_DIR = path.join(EXT_DIR, "subagent-agents");
const TOOLS_DIR = path.join(EXT_DIR, "subagent-tools");
const CONFIG_PATH = path.join(EXT_DIR, "subagent.config.json");
const DEFAULT_MAX_CONCURRENCY = 4;

function loadConfig(): ExtensionConfig {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as ExtensionConfig;
		}
	} catch {}
	return {};
}

// Built-in tools that pi provides natively (no extension needed)
const BUILTIN_TOOLS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);

// Custom tools that require loading an extension into the subagent process
const EXT_BASE = path.join(process.env.HOME || "~", ".pi", "agent", "extensions");
const CUSTOM_TOOL_EXTENSIONS: Record<string, string> = {
	web_search: path.join(EXT_BASE, "web-search", "index.ts"),
	web_fetch: path.join(EXT_BASE, "web-fetch", "index.ts"),
	safe_bash: path.join(TOOLS_DIR, "safe-bash.ts"),
	video_extract: path.join(EXT_BASE, "video-extract", "index.ts"),
	youtube_search: path.join(EXT_BASE, "youtube-search", "index.ts"),
	google_image_search: path.join(EXT_BASE, "google-image-search", "index.ts"),
	// `subagent` is the tool this very extension registers. Listing it here lets
	// a parent agent grant it to a child agent — the child pi process loads this
	// same index.ts via `--extension`, sees its own subagent tool, and (if
	// PI_SUBAGENT_ALLOWED is set) only registers the allowlisted agents.
	subagent: path.join(EXT_DIR, "subagent.ts"),
};

// ── Agent Discovery & Registration ────────────────────────────────────

let agents: AgentConfig[] = [];

// Read once at module load. If we're a child subagent process whose parent
// pinned an allowlist, we silently ignore any agent (built-in OR registered
// later by a third-party extension) that isn't in the list.
const SUBAGENT_ALLOWLIST: string[] | undefined = (() => {
	const raw = process.env.PI_SUBAGENT_ALLOWED;
	if (!raw) return undefined;
	const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
	return list.length > 0 ? list : undefined;
})();

export function registerAgent(config: AgentConfig): void {
	if (SUBAGENT_ALLOWLIST && !SUBAGENT_ALLOWLIST.includes(config.name)) return;
	if (agents.find((a) => a.name === config.name)) {
		throw new Error(`Agent already registered: ${config.name}`);
	}
	agents.push(config);
}

export function unregisterAgent(name: string): void {
	agents = agents.filter((a) => a.name !== name);
}

// Expose registration functions globally so other extensions loaded via jiti
// (which creates separate module instances) can access the shared agents array.
(globalThis as any).__pi_subagents = { registerAgent, unregisterAgent };

function loadAgents(): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!fs.existsSync(AGENTS_DIR)) return agents;
	for (const entry of fs.readdirSync(AGENTS_DIR)) {
		if (!entry.endsWith(".md")) continue;
		const filePath = path.join(AGENTS_DIR, entry);
		const content = fs.readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
		if (!frontmatter.name) continue;
		const tools = (frontmatter.tools || "")
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const rawSubagentAgents = (frontmatter as Record<string, string>).subagent_agents;
		const subagentAgents = rawSubagentAgents
			? rawSubagentAgents.split(",").map((t) => t.trim()).filter(Boolean)
			: undefined;
		agents.push({
			name: frontmatter.name,
			description: frontmatter.description || "",
			tools,
			model: frontmatter.model || "anthropic/claude-sonnet-4-6",
			thinking: frontmatter.thinking || "medium",
			systemPrompt: body,
			filePath,
			subagentAgents,
		});
	}
	return agents;
}

// ── Pi Binary Resolution ──────────────────────────────────────────────

function resolvePiBinary(): { command: string; baseArgs: string[] } {
	// Resolve the pi entry point from process.argv[1]
	const entry = process.argv[1];
	if (entry) {
		try {
			const realEntry = fs.realpathSync(entry);
			if (/\.(?:mjs|cjs|js)$/i.test(realEntry)) {
				return { command: process.execPath, baseArgs: [realEntry] };
			}
		} catch {}
	}
	return { command: "pi", baseArgs: [] };
}

// ── Formatting Utilities ──────────────────────────────────────────────

function formatTokens(n: number): string {
	return n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function formatContextUsage(tokens: number, contextWindow: number | undefined): string {
	if (!contextWindow) return `${formatTokens(tokens)} ctx`;
	const pct = (tokens / contextWindow) * 100;
	const maxStr = contextWindow >= 1_000_000 ? `${(contextWindow / 1_000_000).toFixed(1)}M` : `${Math.round(contextWindow / 1000)}k`;
	return `${pct.toFixed(1)}%/${maxStr}`;
}

function formatToolPreview(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "bash":
		case "safe_bash":
			return `$ ${((args.command as string) || "").slice(0, 80)}`;
		case "read":
			return `read ${(args.path as string) || ""}`;
		case "write":
			return `write ${(args.path as string) || ""}`;
		case "edit":
			return `edit ${(args.path as string) || ""}`;
		case "grep":
			return `grep ${(args.pattern as string) || ""}`;
		case "find":
			return `find ${(args.pattern as string) || ""}`;
		case "ls":
			return `ls ${(args.path as string) || "."}`;
		case "web_search":
			return `search "${(args.query as string) || ""}"`;
		case "web_fetch":
			return `fetch ${(args.url as string) || ""}`;
		default: {
			const s = JSON.stringify(args);
			return `${name} ${s.slice(0, 60)}`;
		}
	}
}

function truncLine(text: string, maxWidth: number): string {
	// Collapse embedded newlines first so we render exactly one visible line.
	// We can't strip them inside `text` directly (would also touch ANSI escapes
	// like "\x1b[0m"), so we only target literal \r and \n outside of escapes.
	if (text.includes("\n") || text.includes("\r")) {
		text = text.replace(/\r?\n/g, "↵ ");
	}
	if (visibleWidth(text) <= maxWidth) return text;
	// Simple truncation - strip to fit
	let result = "";
	let width = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		// Skip ANSI escape sequences
		if (ch === "\x1b") {
			const match = text.slice(i).match(/^\x1b\[[0-9;]*m/);
			if (match) {
				result += match[0];
				i += match[0].length - 1;
				continue;
			}
		}
		if (width >= maxWidth - 1) {
			return result + "…";
		}
		result += ch;
		width++;
	}
	return result;
}

// ── Subagent Execution ────────────────────────────────────────────────

async function buildPiArgs(
	agent: AgentConfig,
	task: string,
	cwd: string,
): Promise<{ args: string[]; tempDir: string; childEnv: NodeJS.ProcessEnv | undefined }> {
	const piBin = resolvePiBinary();
	const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-sub-"));

	// Write system prompt to temp file
	const promptPath = path.join(tempDir, `${agent.name}.md`);
	await withFileMutationQueue(promptPath, async () => {
		await fs.promises.writeFile(promptPath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
	});

	const args = [...piBin.baseArgs, "--mode", "json", "-p", "--no-session", "--no-skills"];

	// Separate builtin tools from custom tools. Both kinds share the same
	// --tools allowlist in pi; --no-tools would disable extension tools too.
	const allowlist: string[] = [];
	const extensionPaths = new Set<string>();

	for (const tool of agent.tools) {
		if (BUILTIN_TOOLS.has(tool)) {
			allowlist.push(tool);
		} else if (CUSTOM_TOOL_EXTENSIONS[tool]) {
			allowlist.push(tool);
			extensionPaths.add(CUSTOM_TOOL_EXTENSIONS[tool]);
		}
	}

	// Use --no-extensions then add only what we need
	args.push("--no-extensions");

	if (allowlist.length > 0) {
		// --tools is a unified allowlist that applies to built-in, extension, and custom tools.
		args.push("--tools", allowlist.join(","));
	} else {
		// Agent declared no tools — disable everything.
		args.push("--no-tools");
	}

	for (const extPath of extensionPaths) {
		args.push("--extension", extPath);
	}

	args.push("--models", agent.model);
	args.push("--thinking", agent.thinking);
	args.push("--append-system-prompt", promptPath);

	// Handle long tasks by writing to file
	const TASK_LIMIT = 8000;
	if (task.length > TASK_LIMIT) {
		const taskPath = path.join(tempDir, "task.md");
		await withFileMutationQueue(taskPath, async () => {
			await fs.promises.writeFile(taskPath, `Task: ${task}`, { encoding: "utf-8", mode: 0o600 });
		});
		args.push(`@${taskPath}`);
	} else {
		args.push(`Task: ${task}`);
	}

	// If this agent is allowed to spawn subagents AND we want to restrict which
	// ones, pass the allowlist down via env. The child pi process loads this
	// extension and filters its agent registry before exposing tool descriptions
	// to the LLM — so the child literally cannot request an agent outside the
	// allowlist (the name isn't in its prompt).
	let childEnv: NodeJS.ProcessEnv | undefined;
	if (agent.tools.includes("subagent") && agent.subagentAgents && agent.subagentAgents.length > 0) {
		childEnv = { ...process.env, PI_SUBAGENT_ALLOWED: agent.subagentAgents.join(",") };
	}

	return { args: [piBin.command, ...args], tempDir, childEnv };
}

function extractTextFromContent(content: unknown): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n");
	}
	return "";
}

/** Collapse any whitespace run (incl. newlines) into a single space. Used to
 *  keep tool-arg previews to one renderable line in collapsed view. */
function flatten(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

// Per-event hard cap on the generic arg preview. Shell commands have a separate,
// complete record and are bounded by terminal width when rendered.
const MAX_ARG_PREVIEW = 4000;

function capArgPreview(s: string): string {
	return s.length > MAX_ARG_PREVIEW ? s.slice(0, MAX_ARG_PREVIEW) + "…" : s;
}

function extractToolArgsPreview(args: Record<string, unknown>): string {
	const cap = capArgPreview;
	if (args.command) return cap(flatten(String(args.command)));
	if (args.path) return cap(flatten(String(args.path)));
	if (args.query) return `"${cap(flatten(String(args.query)))}"`;
	if (args.url) return cap(flatten(String(args.url)));
	if (args.pattern) return cap(flatten(String(args.pattern)));
	// `subagent` tool args: show which agent(s) it's calling, not the full task body.
	if (args.agent) return flatten(String(args.agent));
	if (Array.isArray(args.tasks)) {
		const names = (args.tasks as Array<{ agent?: string }>)
			.map((t) => t?.agent || "?")
			.join(", ");
		return `parallel(${names})`;
	}
	return cap(flatten(JSON.stringify(args)));
}

function extractShellCommands(tool: string, args: Record<string, unknown>): string[] | undefined {
	if (tool !== "bash" && tool !== "zsh") return undefined;
	const raw = Array.isArray(args.command) ? args.command : [args.command];
	// Keep the complete command separate from the capped, flattened generic args
	// preview. Sanitizing and one-line normalization belong at the render boundary,
	// where terminal width provides the display bound without discarding the tail.
	const commands = raw.filter((command): command is string => typeof command === "string");
	return commands.length > 0 ? commands : undefined;
}

function shellCommandForDisplay(command: string): string {
	return flatten(command.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "�"));
}

const EMPTY_SUCCESS_MESSAGE = "Completed successfully; no final response was returned.";
const QUEUED_MESSAGE = "Queued…";
const RUNNING_MESSAGE = "Thinking…";
const FAILED_MESSAGE = "Subagent failed.";

function finalMessagePreview(text: string): string {
	const proseLines: string[] = [];
	let inCodeBlock = false;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}
		if (!inCodeBlock && trimmed && !/^#{1,6}\s/.test(trimmed)) {
			// Text does not parse Markdown, so remove common inline markup while
			// retaining the completion's prose in collapsed view.
			proseLines.push(trimmed
				.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
				.replace(/[*_~`]/g, ""));
		}
		if (proseLines.length === 3) break;
	}
	return proseLines.join(" ");
}

async function runSubagent(
	agent: AgentConfig,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate?: (progress: AgentProgress, usage: AgentResult["usage"]) => void,
	startedAt: number = Date.now(),
): Promise<AgentResult> {
	const { args, tempDir, childEnv } = await buildPiArgs(agent, task, cwd);
	const command = args[0];
	const spawnArgs = args.slice(1);

	const result: AgentResult = {
		agent: agent.name,
		task,
		output: "",
		exitCode: 0,
		model: agent.model,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		progress: {
			agent: agent.name,
			status: "running",
			task,
			recentTools: [],
			toolCount: 0,
			tokens: 0,
			durationMs: 0,
			startedAt,
			lastMessage: "Thinking…",
		},
	};

	const progress = result.progress;

	const fireUpdate = throttle(() => {
		progress.durationMs = (progress.completedAt ?? Date.now()) - startedAt;
		onUpdate?.(progress, result.usage);
	}, 150);

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn(command, spawnArgs, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			...(childEnv ? { env: childEnv } : {}),
		});

		let buf = "";
		let stderrBuf = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const evt = JSON.parse(line) as any;
				progress.durationMs = (progress.completedAt ?? Date.now()) - startedAt;

				if (evt.type === "tool_execution_start") {
					progress.toolCount++;
					const toolArgs = (evt.args || {}) as Record<string, unknown>;
					progress.recentTools.push({
						tool: evt.toolName,
						args: extractToolArgsPreview(toolArgs),
						toolCallId: evt.toolCallId,
						status: "running",
						startedAt: Date.now(),
						shellCommands: extractShellCommands(evt.toolName, toolArgs),
					});
					fireUpdate();
				}

				// Subagents emit `tool_execution_update` while their own subagent tool
				// runs — the partial result carries the live nested AgentResult[]. We
				// surface that as `children` on the in-flight ToolEvent so the renderer
				// can inline grandchild activity beneath the parent's tool row.
				if (evt.type === "tool_execution_update") {
					const partial = evt.partialResult as { details?: { results?: unknown } } | undefined;
					const nested = partial?.details?.results;
					if (evt.toolName === "subagent" && Array.isArray(nested) && evt.toolCallId) {
						const hit = progress.recentTools.find((t) => t.toolCallId === evt.toolCallId);
						if (hit) {
							hit.children = nested as AgentResult[];
							fireUpdate();
						}
					}
				}

				if (evt.type === "tool_execution_end") {
					const hit = evt.toolCallId
						? progress.recentTools.find((t) => t.toolCallId === evt.toolCallId)
						: undefined;
					if (hit) {
						hit.status = "done";
						hit.completedAt ??= Date.now();
						// Prefer the end event's final results over the last throttled
						// update — throttling can drop the trailing update, leaving stale
						// children visible on a tool that has actually completed.
						const finalResult = evt.result as { details?: { results?: unknown } } | undefined;
						const finalChildren = finalResult?.details?.results;
						if (evt.toolName === "subagent" && Array.isArray(finalChildren)) {
							hit.children = finalChildren as AgentResult[];
						}
					}
					fireUpdate();
				}

				if (evt.type === "tool_result_end") {
					fireUpdate();
				}

				if (evt.type === "message_end" && evt.message) {
					if (evt.message.role === "assistant") {
						result.usage.turns++;
						const u = evt.message.usage;
						if (u) {
							result.usage.input += u.input || 0;
							result.usage.output += u.output || 0;
							result.usage.cacheRead += u.cacheRead || 0;
							result.usage.cacheWrite += u.cacheWrite || 0;
							result.usage.cost += u.cost?.total || 0;
							// Context-window gauge: snapshot of the LATEST assistant turn's usage,
							// NOT a cumulative sum across turns. Each turn re-sends the whole
							// conversation as input + cacheRead, so one assistant message already
							// represents the current context size. Summing across N turns would
							// inflate the displayed % by roughly Nx (the bug this replaced).
							// Matches pi's `calculateContextTokens` in core/compaction/compaction.js:
							// prefer the provider-reported totalTokens, fall back to the 4-component sum.
							progress.tokens = (u as { totalTokens?: number }).totalTokens
								|| (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
						}
						if (evt.message.model) result.model = evt.message.model;
						if (evt.message.errorMessage) progress.error = evt.message.errorMessage;

						// Only retain assistant text as the eventual final response. Thinking
						// content has a different content type and is deliberately ignored.
						// Assign even an empty string so a tool-call turn cannot masquerade as
						// a later, successful empty final response.
						result.output = extractTextFromContent(evt.message.content);
					}

					fireUpdate();
				}
			} catch {
				// Non-JSON lines are expected
			}
		};

		proc.stdout.on("data", (d: Buffer) => {
			buf += d.toString();
			const lines = buf.split("\n");
			buf = lines.pop() || "";
			lines.forEach(processLine);
		});

		proc.stderr.on("data", (d: Buffer) => {
			stderrBuf += d.toString();
		});

		proc.on("close", (code) => {
			if (buf.trim()) processLine(buf);
			if (code !== 0 && stderrBuf.trim() && !progress.error) {
				progress.error = stderrBuf.trim();
			}
			resolve(code ?? 1);
		});

		proc.on("error", () => resolve(1));

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});

	// Cleanup temp dir
	try {
		fs.rmSync(tempDir, { recursive: true, force: true });
	} catch {}

	result.exitCode = exitCode;
	progress.status = exitCode === 0 && !progress.error ? "completed" : "failed";
	progress.completedAt ??= Date.now();
	progress.durationMs = progress.completedAt - startedAt;
	if (progress.error) result.output = result.output || `Error: ${progress.error}`;
	if (progress.status === "completed" && !result.output.trim()) {
		result.output = EMPTY_SUCCESS_MESSAGE;
	}

	// Truncate output if very large
	if (result.output.length > DEFAULT_MAX_BYTES) {
		const trunc = truncateHead(result.output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
		result.output = trunc.content;
		if (trunc.truncated) {
			result.output += "\n\n[Output truncated]";
		}
	}
	progress.lastMessage = result.output ? finalMessagePreview(result.output) : "";

	return result;
}

// ── Throttle ──────────────────────────────────────────────────────────

function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
	let lastCall = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return ((...args: any[]) => {
		const now = Date.now();
		const remaining = ms - (now - lastCall);
		if (remaining <= 0) {
			lastCall = now;
			if (timer) { clearTimeout(timer); timer = undefined; }
			fn(...args);
		} else if (!timer) {
			timer = setTimeout(() => {
				lastCall = Date.now();
				timer = undefined;
				fn(...args);
			}, remaining);
		}
	}) as T;
}

// ── Parallel Execution with Concurrency Limit ─────────────────────────

/**
 * Process-wide cap on simultaneous `runSubagent` calls. Each `execute()` of the
 * `subagent` tool is independent (pi runs LLM tool calls via `Promise.all`), so
 * we serialize at the `runSubagent` boundary. Per-process scope only — nested
 * subagent processes have their own semaphore, so the cap applies to direct
 * children, not the whole tree (which keeps things deadlock-free).
 */
class Semaphore {
	private inFlight = 0;
	private readonly waiters: Array<() => void> = [];
	constructor(private readonly max: number) {}
	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.inFlight >= this.max) {
			await new Promise<void>((r) => this.waiters.push(r));
		}
		this.inFlight++;
		try {
			return await fn();
		} finally {
			this.inFlight--;
			const next = this.waiters.shift();
			if (next) next();
		}
	}
}

// ── Rendering ─────────────────────────────────────────────────────────

type Theme = ExtensionContext["ui"]["theme"];
type Component = ReturnType<typeof Text.prototype.render> extends string[] ? Text : any;

type ConnectedOutputMode = "auto" | "hidden" | "expanded";
type ConnectedRenderBridge = {
	layout: "connected";
	outputMode: ConnectedOutputMode;
	thinkingVisible: boolean;
	clock?: () => number;
	invalidate?: () => void;
	parentRail: string;
	parentConnector: "├─" | "└─";
	lifecycle: {
		status: AgentProgress["status"];
		startedAt?: number;
		completedAt?: number;
		thinking: string[];
	};
};

const CONNECTED_RENDER_BRIDGE = Symbol.for("aviral.pi.work-step-renderer.subagent-bridge");
const DEFAULT_RENDER_CLOCK = () => Date.now();

function connectedRenderBridge(context: any): ConnectedRenderBridge | undefined {
	const bridge = context?.state?.[CONNECTED_RENDER_BRIDGE] as ConnectedRenderBridge | undefined;
	return bridge?.layout === "connected" ? bridge : undefined;
}

function getTermWidth(): number {
	return process.stdout.columns || 120;
}

type ShellTone = "prompt" | "command" | "argument" | "flag" | "string" | "operator";

const SHELL_RGB: Record<ShellTone, readonly [number, number, number]> = {
	prompt: [102, 92, 84],
	command: [242, 133, 52],
	argument: [235, 219, 178],
	flag: [211, 134, 155],
	string: [176, 184, 70],
	operator: [233, 177, 67],
};

function shellColor(tone: ShellTone, text: string): string {
	const [r, g, b] = SHELL_RGB[tone];
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

const SHELL_OPERATORS = ["&>>", ";;&", "<<<", "&&", "||", ">>", "<<", "|&", ">&", "<&", "<>", ">|", "&>", ";;", ";&", "|", ";", "&", ">", "<", "(", ")", "{", "}"];

function shellOperatorAt(command: string, offset: number): string | undefined {
	return SHELL_OPERATORS.find((operator) => command.startsWith(operator, offset));
}

function shellWordEnd(command: string, start: number): number {
	let quote = "";
	let substitutionDepth = 0;
	for (let i = start; i < command.length; i++) {
		const ch = command[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = "";
			continue;
		}
		if (ch === "'" || ch === '"' || ch === "`") {
			quote = ch;
			continue;
		}
		if (ch === "$" && command[i + 1] === "(") {
			substitutionDepth++;
			i++;
			continue;
		}
		if (substitutionDepth > 0) {
			if (ch === "(") substitutionDepth++;
			else if (ch === ")") substitutionDepth--;
			continue;
		}
		if (/\s/.test(ch) || shellOperatorAt(command, i)) return i;
	}
	return command.length;
}

function highlightShellWord(word: string, baseTone: ShellTone): string {
	if (baseTone === "operator" || baseTone === "command" || baseTone === "flag") {
		return shellColor(baseTone, word);
	}

	let rendered = "";
	let plainStart = 0;
	const flush = (end: number) => {
		if (end > plainStart) rendered += shellColor(baseTone, word.slice(plainStart, end));
	};
	for (let i = 0; i < word.length; i++) {
		if (word[i] !== "$" && word[i] !== "`") continue;
		flush(i);
		let end = i + 1;
		let tone: ShellTone = "flag";
		if (word[i] === "`") {
			const close = word.indexOf("`", i + 1);
			end = close === -1 ? word.length : close + 1;
			tone = "operator";
		} else if (word[i + 1] === "(") {
			let depth = 1;
			end = i + 2;
			while (end < word.length && depth > 0) {
				if (word[end] === "\\") end++;
				else if (word[end] === "(") depth++;
				else if (word[end] === ")") depth--;
				end++;
			}
			tone = "operator";
		} else if (word[i + 1] === "{") {
			const close = word.indexOf("}", i + 2);
			end = close === -1 ? word.length : close + 1;
		} else {
			const match = word.slice(i + 1).match(/^[A-Za-z_][A-Za-z0-9_]*|^[#?$!0-9*@-]/);
			end = match ? i + 1 + match[0].length : i + 1;
		}
		rendered += shellColor(tone, word.slice(i, end));
		i = end - 1;
		plainStart = end;
	}
	flush(word.length);
	return rendered;
}

function highlightShellCommand(command: string, includePrompt: boolean = true, depth: number = 0, connected: boolean = false): string {
	let rendered = includePrompt ? shellColor("prompt", "$ ") : "";
	let expectCommand = true;
	let expectPath = false;
	for (let i = 0; i < command.length;) {
		if (/\s/.test(command[i])) {
			const start = i;
			while (i < command.length && /\s/.test(command[i])) i++;
			rendered += command.slice(start, i);
			continue;
		}
		const operator = shellOperatorAt(command, i);
		if (operator) {
			rendered += shellColor("operator", operator);
			i += operator.length;
			expectPath = /^(?:>|>>|<|<<|<<<|<>|>&|<&|>\||&>|&>>)$/.test(operator);
			if (/^(?:&&|\|\||\||\|&|;|;;|;&|;;&|&|\()$/.test(operator)) expectCommand = true;
			continue;
		}
		const end = shellWordEnd(command, i);
		const word = command.slice(i, end);
		const substitution = depth < 16
			? word.match(/^([A-Za-z_][A-Za-z0-9_]*=)?\$\(([\s\S]*)\)$/)
			: undefined;
		if (substitution) {
			const assignment = substitution[1];
			if (connected && expectCommand && assignment) {
				rendered += shellColor("flag", assignment.slice(0, -1));
				rendered += shellColor("operator", "=$(");
			} else {
				rendered += shellColor("operator", `${assignment || ""}$(`);
			}
			rendered += highlightShellCommand(substitution[2], false, depth + 1, connected);
			rendered += shellColor("operator", ")");
			expectCommand = false;
			i = end;
			continue;
		}
		let tone: ShellTone;
		if (expectPath) {
			tone = "string";
			expectPath = false;
		} else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
			tone = "operator";
		} else if (/^(?:\$\(|`)/.test(word)) {
			tone = "operator";
			expectCommand = false;
		} else if (/^\$(?:[A-Za-z_]|\{|[#?$!0-9*@-])/.test(word)) {
			tone = "flag";
			expectCommand = false;
		} else if (expectCommand) {
			tone = "command";
			expectCommand = false;
		} else if (/^-/.test(word)) {
			tone = "flag";
		} else if (/^(?:['"]|~?(?:\.\.?\/|\/))/.test(word) || word.includes("/")) {
			tone = "string";
		} else {
			tone = "argument";
		}
		rendered += highlightShellWord(word, tone);
		i = end;
	}
	return rendered;
}

function renderAgentProgress(
	r: AgentResult,
	theme: Theme,
	expanded: boolean,
	w: number,
	depth: number = 0,
	connected?: { args: Record<string, unknown>; bridge: ConnectedRenderBridge },
): Container {
	if (connected) return renderConnectedTree(r, connected.args, theme, w, connected.bridge);
	const c = new Container();
	const prog = r.progress;
	const isRunning = prog.status === "running";
	const isPending = prog.status === "pending";
	const isSuccessful = prog.status === "completed" && r.exitCode === 0 && !prog.error;
	const nested = depth > 0;

	// Indent prefix for nested levels. ANSI escapes are zero-width so this works
	// with colored content. Children are visually offset by 2 spaces per depth.
	const indent = nested ? "  ".repeat(depth) : "";
	// Available width shrinks with indent so truncLine still fits one line.
	const innerW = Math.max(20, w - indent.length);

	// `line(content)`: emit one indented, optionally-truncated row. Expanded
	// prose may wrap, while bounded command leaves remain one terminal-width row.
	const addLine = (content: string, bounded: boolean = false) => {
		if (expanded && !bounded) {
			c.addChild(new Text(indent + content, 0, 0));
		} else {
			c.addChild(new Text(indent + truncLine(content, innerW), 0, 0));
		}
	};

	// Header: icon + agent + stats (always one line)
	const icon = isRunning
		? theme.fg("warning", "⟳")
		: isPending
			? theme.fg("dim", "○")
			: isSuccessful
				? theme.fg("success", "✓")
				: theme.fg("error", "✗");
	const stats = `${prog.toolCount} tools · ${formatDuration(prog.durationMs)}`;
	const modelStr = r.model ? theme.fg("dim", ` (${r.model})`) : "";
	addLine(`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${modelStr} — ${theme.fg("dim", stats)}`);

	// NOTE: the task body used to be rendered here at depth 0 (truncated when
	// collapsed, full when expanded). It's now owned by `renderCall` above this
	// block in the same tool shell — the call header shows the truncated
	// preview when collapsed and the full streaming prompt when expanded — so
	// repeating it here would duplicate the prompt on screen. Nested children
	// never rendered Task in the first place; the parent's recentTools row
	// above each child already conveys the dispatch.

	// Helper for rendering one tool row + recursively rendering its children.
	const renderToolRow = (
		toolName: string,
		args: string,
		children: AgentResult[] | undefined,
		isCurrent: boolean,
		shellCommands: string[] | undefined,
	) => {
		const body = shellCommands ? toolName : args ? `${toolName}: ${args}` : toolName;
		if (isCurrent) {
			addLine(theme.fg("warning", `▸ ${body}`));
		} else {
			addLine(theme.fg("muted", `  ${body}`));
		}
		if (shellCommands) {
			for (const command of shellCommands) {
				addLine(`    ${highlightShellCommand(shellCommandForDisplay(command))}`, true);
			}
		}
		if (children && children.length > 0) {
			for (const child of children) {
				c.addChild(renderAgentProgress(child, theme, expanded, w, depth + 1));
			}
		}
	};

	// Tool log — running and done interleaved in chronological order. Running
	// entries get the `▸` marker; done ones get a muted `  ` prefix. Children
	// (live subagent activity) render inline beneath each row.
	for (const t of prog.recentTools) {
		// Details supplied by another provider/process contain the public tool
		// event shape, not our private shellCommands cache. Reconstruct that
		// derived render state at the boundary instead of requiring producers to
		// serialize an implementation detail.
		const shellCommands = t.shellCommands ?? extractShellCommands(t.tool, { command: t.args });
		renderToolRow(t.tool, t.args, t.children, t.status === "running", shellCommands);
	}

	// A provider may supply a final AgentResult directly, bypassing runSubagent's
	// derived lastMessage and empty-output normalization. Derive both at the
	// renderer boundary as well so live and restored/native results agree.
	const isFailed = prog.status === "failed";
	// Producer prose is displayable only after successful completion. All other
	// lifecycle states have package-owned text so stale or adversarial provider
	// lastMessage/output fields cannot leak reasoning or claim false success.
	const failureNarrative = prog.error ? `Error: ${prog.error}` : FAILED_MESSAGE;
	const displayOutput = isFailed
		? failureNarrative
		: isSuccessful && !r.output.trim()
			? EMPTY_SUCCESS_MESSAGE
			: r.output;
	const displayMessage = isPending
		? QUEUED_MESSAGE
		: isRunning
			? RUNNING_MESSAGE
			: isFailed
				? failureNarrative
				: prog.lastMessage || (displayOutput ? finalMessagePreview(displayOutput) : "");
	const showsMessage = !!displayMessage && (isRunning || isPending || !expanded || (nested && isFailed && !prog.error));
	const showsOutput = !nested && !isRunning && !isPending && !!displayOutput && expanded;

	// Nonterminal agents show only safe package-owned state labels; child
	// thinking content is never parsed or rendered. Completed agents show a
	// concise prose preview in collapsed mode, while expanded mode replaces it
	// with the full Markdown. Failed agents similarly show only their normalized
	// package-owned failure narrative.
	if (showsMessage) {
		if (!nested) c.addChild(new Spacer(1));
		addLine(theme.fg("text", displayMessage));
	}

	// Expanded final output — only at depth 0. Nested levels are summarized via
	// their own tool list; the master-level result block is enough context.
	if (showsOutput) {
		c.addChild(new Spacer(1));
		const mdTheme = getMarkdownTheme();
		c.addChild(new Markdown(displayOutput, 0, 0, mdTheme));
	}

	// Usage line. Includes the context %/max gauge at every depth — each
	// subagent carries its own model/contextWindow and its own token count, so
	// the gauge is meaningful per-row even for nested children.
	if (!nested) c.addChild(new Spacer(1));
	const usageParts: string[] = [];
	if (expanded && r.usage.turns) usageParts.push(theme.fg("dim", `${r.usage.turns} ${r.usage.turns === 1 ? "turn" : "turns"}`));
	if (r.usage.input) usageParts.push(theme.fg("dim", expanded ? `in:${r.usage.input}` : `↑${formatTokens(r.usage.input)}`));
	if (r.usage.output) usageParts.push(theme.fg("dim", expanded ? `out:${r.usage.output}` : `↓${formatTokens(r.usage.output)}`));
	if (r.usage.cacheRead) usageParts.push(theme.fg("dim", expanded ? `cache-read:${r.usage.cacheRead}` : `R${formatTokens(r.usage.cacheRead)}`));
	if (r.usage.cacheWrite) usageParts.push(theme.fg("dim", expanded ? `cache-write:${r.usage.cacheWrite}` : `W${formatTokens(r.usage.cacheWrite)}`));
	if (r.usage.cost) usageParts.push(theme.fg("dim", `$${r.usage.cost.toFixed(3)}`));
	if (prog.tokens > 0) {
		const ctxStr = formatContextUsage(prog.tokens, r.contextWindow);
		const pct = r.contextWindow ? (prog.tokens / r.contextWindow) * 100 : 0;
		const coloredCtx = pct > 90 ? theme.fg("error", ctxStr) : pct > 70 ? theme.fg("warning", ctxStr) : theme.fg("dim", ctxStr);
		usageParts.push(coloredCtx);
	}
	if (usageParts.length) {
		addLine(usageParts.join(" "));
	}

	// Error. A normalized provider result may repeat this narrative in output;
	// add a dedicated error row only when the currently visible output does not.
	if (prog.error) {
		const visibleNarrative = showsMessage ? displayMessage : showsOutput ? displayOutput : "";
		if (!visibleNarrative.includes(prog.error)) {
			addLine(theme.fg("error", `Error: ${prog.error}`));
		}
	}

	return c;
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function connectedStatus(r: AgentResult, status: AgentProgress["status"] = r.progress.status): AgentProgress["status"] {
	const resultSettled = r.progress.status !== "pending" && r.progress.status !== "running";
	const failedExit = resultSettled && finiteNumber(r.exitCode) && r.exitCode !== 0;
	if (r.progress.status === "failed" || !!r.progress.error || failedExit) return "failed";
	if (status === "pending" || status === "running") return status;
	return status === "failed" ? "failed" : "completed";
}

function connectedStatusLabel(status: AgentProgress["status"]): string {
	return status === "pending" ? "queued" : status;
}

function connectedDuration(
	startedAt: number | undefined,
	completedAt: number | undefined,
	fallback: number,
	status: AgentProgress["status"] | ToolEvent["status"],
	now: number,
): number {
	if (finiteNumber(startedAt)) {
		if (finiteNumber(completedAt)) return Math.max(0, completedAt - startedAt);
		if (status === "running") return Math.max(0, now - startedAt);
	}
	return finiteNumber(fallback) && fallback >= 0 ? fallback : 0;
}

class ConnectedContainer extends Container {
	override render(width: number): string[] {
		return super.render(width).map((line) => line.trimEnd());
	}
}

const CONNECTED_RGB = {
	muted: "146;131;116",
	dim: "102;92;84",
	text: "235;219;178",
	warning: "250;189;47",
	success: "184;187;38",
	error: "242;89;75",
	tool: "128;170;158",
	nested: "211;134;155",
} as const;

function connectedColor(color: keyof typeof CONNECTED_RGB, text: string, bold: boolean = false): string {
	return `\x1b[${bold ? "1;" : ""}38;2;${CONNECTED_RGB[color]}m${text}\x1b[0m`;
}

function addConnectedLine(c: Container, line: string, width: number): void {
	const rendered = truncLine(line, width);
	const reset = rendered.endsWith("…") && rendered.includes("\x1b[") ? "\x1b[0m" : "";
	c.addChild(new Text(rendered + reset, 0, 0));
}

function connectedPrefix(_theme: Theme, prefix: string): string {
	return connectedColor("muted", prefix);
}

function countShellCommands(r: AgentResult): number {
	let count = 0;
	for (const tool of r.progress.recentTools) {
		count += (tool.shellCommands ?? extractShellCommands(tool.tool, { command: tool.args }) ?? []).length;
		for (const child of tool.children ?? []) count += countShellCommands(child);
	}
	return count;
}

function connectedSummaryMessage(r: AgentResult, status: AgentProgress["status"]): string {
	if (status === "pending") return QUEUED_MESSAGE;
	if (status === "running") return RUNNING_MESSAGE;
	if (status === "failed") return r.progress.error ? `Error: ${r.progress.error}` : FAILED_MESSAGE;
	if (!r.output.trim()) return EMPTY_SUCCESS_MESSAGE;
	return r.progress.lastMessage || finalMessagePreview(r.output);
}

function connectedUsage(r: AgentResult, duration: number): string {
	const parts: string[] = [];
	const usage = r.usage as Partial<AgentResult["usage"]> | undefined;
	const components = [usage?.input, usage?.output, usage?.cacheRead, usage?.cacheWrite];
	if (components.every(finiteNumber)) {
		const cumulative = components.reduce((sum, value) => sum + value, 0);
		if (cumulative > 0) parts.push(`${formatTokens(cumulative)} tokens`);
	} else {
		if (finiteNumber(usage?.input) && usage.input > 0) parts.push(`↑${formatTokens(usage.input)}`);
		if (finiteNumber(usage?.output) && usage.output > 0) parts.push(`↓${formatTokens(usage.output)}`);
		if (finiteNumber(usage?.cacheRead) && usage.cacheRead > 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
		if (finiteNumber(usage?.cacheWrite) && usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	}
	if (finiteNumber(usage?.cost) && usage.cost > 0) parts.push(`$${usage.cost.toFixed(3)}`);
	if (finiteNumber(r.progress.tokens) && r.progress.tokens > 0) {
		parts.push(formatContextUsage(
			r.progress.tokens,
			finiteNumber(r.contextWindow) && r.contextWindow > 0 ? r.contextWindow : undefined,
		));
	}
	parts.push(formatDuration(duration));
	return parts.join(" · ");
}

function isStructuralAgentTool(tool: ToolEvent): boolean {
	// Structural dispatch rows identify a subtree rather than a leaf operation.
	// Never turn their task/agent payload into an argument preview: restored
	// provider shapes may carry the identity explicitly or only via children.
	return tool.tool === "subagent" || tool.children !== undefined || typeof tool.agent === "string";
}

function renderConnectedTool(
	c: Container,
	tool: ToolEvent,
	theme: Theme,
	width: number,
	prefix: string,
	isLast: boolean,
	detailVisible: boolean,
	treeRunning: boolean,
	thinkingVisible: boolean,
	now: number,
): void {
	const shellCommands = tool.shellCommands ?? extractShellCommands(tool.tool, { command: tool.args }) ?? [];
	const running = tool.status === "running";
	const glyph = connectedColor(running ? "warning" : "success", running ? "⟳" : "✓");
	const argumentPreview = shellCommands.length === 0 && !isStructuralAgentTool(tool)
		? shellCommandForDisplay(tool.args)
		: "";
	const commandPart = shellCommands.length > 0
		? ` · ${shellCommands.length} ${shellCommands.length === 1 ? "command" : "commands"} · ${running ? "running" : "completed"}`
		: `${argumentPreview ? `: ${argumentPreview}` : ""} · ${running ? "running" : "done"}`;
	const emptyHint = shellCommands.length === 0 || detailVisible || treeRunning
		? connectedColor("dim", "")
		: "";
	const hint = shellCommands.length > 0 && !detailVisible
		? connectedColor("dim", " · Ctrl+O details")
		: "";
	const duration = connectedDuration(tool.startedAt, tool.completedAt, 0, tool.status, now);
	const connector = isLast ? "└─ " : "├─ ";
	addConnectedLine(
		c,
		`${connectedPrefix(theme, prefix + connector)}${glyph} ${connectedColor("tool", tool.tool + commandPart)}${emptyHint}${hint}${connectedColor("dim", ` · ${formatDuration(duration)}`)}`,
		width,
	);

	const childPrefix = prefix + (isLast ? "   " : "│  ");
	const visibleCommands = detailVisible ? shellCommands : [];
	const nestedAgents = tool.children ?? [];
	const childCount = visibleCommands.length + nestedAgents.length;
	let childIndex = 0;
	for (const command of visibleCommands) {
		const last = ++childIndex === childCount;
		addConnectedLine(
			c,
			`${connectedPrefix(theme, childPrefix + (last ? "└─ " : "├─ "))}${highlightShellCommand(shellCommandForDisplay(command), true, 0, true).replaceAll("\x1b[39m", "\x1b[0m")}`,
			width,
		);
	}
	for (const child of nestedAgents) {
		const last = ++childIndex === childCount;
		renderConnectedNestedAgent(c, child, theme, width, childPrefix, last, detailVisible, treeRunning, thinkingVisible, now);
	}
}

function renderConnectedNestedAgent(
	c: Container,
	r: AgentResult,
	theme: Theme,
	width: number,
	prefix: string,
	isLast: boolean,
	detailVisible: boolean,
	treeRunning: boolean,
	thinkingVisible: boolean,
	now: number,
): void {
	const status = connectedStatus(r);
	const running = status === "running";
	const failed = status === "failed";
	const glyph = connectedColor(failed ? "error" : running ? "warning" : status === "pending" ? "dim" : "success", failed ? "✗" : running ? "⟳" : status === "pending" ? "○" : "✓");
	const duration = connectedDuration(r.progress.startedAt, r.progress.completedAt, r.progress.durationMs, status, now);
	addConnectedLine(
		c,
		`${connectedPrefix(theme, prefix + (isLast ? "└─ " : "├─ "))}${glyph} ${connectedColor("nested", `${r.agent} · nested agent · ${connectedStatusLabel(status)}`)}${connectedColor("dim", ` · ${formatDuration(duration)}`)}`,
		width,
	);

	const childPrefix = prefix + (isLast ? "   " : "│  ");
	const message = connectedSummaryMessage(r, status);
	const showMessage = status === "completed" || status === "failed" || status === "pending" || thinkingVisible;
	const tools = r.progress.recentTools;
	for (const [index, tool] of tools.entries()) {
		const isLastTool = !showMessage && index === tools.length - 1;
		renderConnectedTool(c, tool, theme, width, childPrefix, isLastTool, detailVisible, treeRunning, thinkingVisible, now);
	}
	if (showMessage && message) {
		addConnectedLine(c, `${connectedPrefix(theme, childPrefix + "└─ ")}${connectedColor("text", message)}`, width);
	}
}

function renderConnectedMarkdown(
	c: Container,
	text: string,
	theme: Theme,
	width: number,
	prefix: string,
): void {
	const markdownTheme = {
		...getMarkdownTheme(),
		heading: (value: string) => connectedColor("text", value, true),
		bold: (value: string) => value,
	};
	const markdown = new Markdown(
		text,
		0,
		0,
		markdownTheme,
		{ color: (value: string) => connectedColor("text", value) },
	);
	const lines = markdown
		.render(Math.max(20, width - visibleWidth(prefix) - 3))
		.map((line) => line.trimEnd())
		.filter((line) => visibleWidth(line) > 0);
	for (const [index, line] of lines.entries()) {
		const connector = index === lines.length - 1 ? "└─ " : "├─ ";
		addConnectedLine(c, `${connectedPrefix(theme, prefix + connector)}${line}`, width);
	}
}

function renderConnectedTree(
	r: AgentResult,
	args: Record<string, unknown>,
	theme: Theme,
	width: number,
	bridge: ConnectedRenderBridge,
): Container {
	const c = new ConnectedContainer();
	const clock = bridge.clock ?? DEFAULT_RENDER_CLOCK;
	const clockValue = clock();
	const now = finiteNumber(clockValue) ? clockValue : DEFAULT_RENDER_CLOCK();
	const status = connectedStatus(r, bridge.lifecycle.status);
	const running = status === "running";
	const failed = status === "failed";
	const duration = connectedDuration(
		bridge.lifecycle.startedAt ?? r.progress.startedAt,
		bridge.lifecycle.completedAt ?? r.progress.completedAt,
		r.progress.durationMs,
		status,
		now,
	);
	const glyph = connectedColor(failed ? "error" : running ? "warning" : status === "pending" ? "dim" : "success", failed ? "✗" : running ? "⟳" : status === "pending" ? "○" : "✓");
	const rail = bridge.parentRail;
	const thoughts = bridge.thinkingVisible && Array.isArray(bridge.lifecycle.thinking)
		? bridge.lifecycle.thinking
		: [];
	for (const thought of thoughts) {
		addConnectedLine(c, `${connectedPrefix(theme, ` ${rail}├─ `)}${connectedColor("muted", "•")} ${connectedColor("muted", thought)}`, width);
	}
	addConnectedLine(
		c,
		`${connectedPrefix(theme, ` ${rail}${bridge.parentConnector} `)}${glyph} ${connectedColor("text", `subagent · ${r.agent} · ${connectedStatusLabel(status)}`, true)}${connectedColor("dim", ` · ${formatDuration(duration)}`)}`,
		width,
	);

	const childPrefix = ` ${rail}${bridge.parentConnector === "└─" ? "   " : "│  "}`;
	const detailVisible = bridge.outputMode === "expanded" || (bridge.outputMode === "auto" && running);
	const suppliedTask = typeof args.task === "string" ? args.task : undefined;
	const nestedAgents = r.progress.recentTools.flatMap((tool) => tool.children ?? []);
	const task = suppliedTask && (suppliedTask === r.task || nestedAgents.some((child) => suppliedTask.includes(child.agent)))
		? suppliedTask
		: r.task;
	if (detailVisible && task) {
		addConnectedLine(c, `${connectedPrefix(theme, childPrefix + "├─ ")}${connectedColor("text", "Task", true)}`, width);
		addConnectedLine(c, `${connectedPrefix(theme, childPrefix + "│  └─ ")}${connectedColor("text", task)}`, width);
	}
	for (const tool of r.progress.recentTools) {
		renderConnectedTool(c, tool, theme, width, childPrefix, false, detailVisible, running, bridge.thinkingVisible, now);
	}

	const message = connectedSummaryMessage(r, status);
	const showSummaryMessage = status !== "running" || bridge.thinkingVisible;
	const summaryMessage = showSummaryMessage && message
		? connectedColor("muted", ` · ${message}`)
		: "";
	addConnectedLine(
		c,
		`${connectedPrefix(theme, childPrefix + "└─ ")}${glyph} ${connectedColor("text", "Summary", true)}${summaryMessage}${connectedColor("dim", ` · ${formatDuration(duration)}`)}`,
		width,
	);

	const summaryPrefix = childPrefix + "   ";
	const displayOutput = status === "completed" && r.output.trim() ? r.output : "";
	if (bridge.outputMode === "expanded" && displayOutput) {
		renderConnectedMarkdown(c, displayOutput, theme, width, summaryPrefix);
	}
	const toolCount = finiteNumber(r.progress.toolCount) && r.progress.toolCount >= 0
		? r.progress.toolCount
		: r.progress.recentTools.length;
	const metrics = `${toolCount} tools · ${countShellCommands(r)} commands · ${connectedUsage(r, duration)}`;
	addConnectedLine(c, `${connectedPrefix(theme, summaryPrefix)}${connectedColor("muted", metrics)}`, width);
	if (running) bridge.invalidate?.();
	return c;
}

// ── Extension ─────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	const semaphore = new Semaphore(config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
	agents = loadAgents();

	// If spawned as a child by a parent subagent process, PI_SUBAGENT_ALLOWED
	// pins which agents we're allowed to expose. Filter the registry now, before
	// any tool description sees the agent list — the child LLM should not even
	// know that other agents exist.
	if (SUBAGENT_ALLOWLIST) {
		agents = agents.filter((a) => SUBAGENT_ALLOWLIST.includes(a.name));
	}

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Run a subagent to complete a task. Subagents have NO context from the current conversation — include all necessary context in the task description.",
		promptSnippet: "Run subagents for delegated tasks",
		promptGuidelines: [
			"Parallel tool calls are your primary parallelism mechanism — put multiple independent read/fetch/search calls in one function_calls block. Don't use subagents to parallelize simple I/O.",
			"Use subagent to delegate *reasoning and decisions*: codebase exploration (scout), web research (researcher), or isolated code changes (worker)",
			"For multiple independent subagent tasks, emit multiple `subagent` tool calls in the same turn — they run in parallel automatically.",
			"Subagents have NO context from the current conversation — include ALL necessary context in the task description",
		],
		parameters: Type.Object({
			agent: Type.String({ description: "Name of the agent to invoke" }),
			task: Type.String({ description: "Task description" }),
			cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctx.cwd;

			if (!params.agent || !params.task) {
				throw new Error("`subagent` requires both `agent` and `task`. To fan out work, emit multiple `subagent` tool calls in the same turn — they run in parallel.");
			}

			const agent = agents.find((a) => a.name === params.agent);
			if (!agent) {
				const available = agents.map((a) => a.name).join(", ") || "none";
				throw new Error(`Unknown agent: ${params.agent}. Available agents: ${available}`);
			}

			const [provider, modelId] = (agent.model || "").split("/");
			const contextWindow = provider && modelId ? ctx.modelRegistry.find(provider, modelId)?.contextWindow : undefined;
			const liveResult: AgentResult = {
				agent: params.agent,
				task: params.task,
				output: "",
				exitCode: -1,
				model: agent.model,
				contextWindow,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
				progress: { agent: params.agent, status: "pending" as const, task: params.task, recentTools: [], toolCount: 0, tokens: 0, durationMs: 0, lastMessage: QUEUED_MESSAGE },
			};
			// Publish identity before contending for a slot so queued children remain
			// visible as queued rather than claiming execution has started.
			onUpdate?.({
				content: [{ type: "text", text: "(queued...)" }],
				details: { results: [liveResult] },
			});

			const result = await semaphore.run(() => {
				// A child becomes running only after semaphore acquisition, before its
				// process can emit the first tool event.
				const startedAt = Date.now();
				liveResult.progress = { ...liveResult.progress, status: "running", startedAt, lastMessage: RUNNING_MESSAGE };
				onUpdate?.({
					content: [{ type: "text", text: "(running...)" }],
					details: { results: [liveResult] },
				});
				return runSubagent(agent, params.task!, params.cwd ?? cwd, signal, (progress, usage) => {
					liveResult.progress = progress;
					liveResult.usage = { ...usage };
					onUpdate?.({
						content: [{ type: "text", text: "(running...)" }],
						details: { results: [liveResult] },
					});
				}, startedAt);
			});

			result.contextWindow = contextWindow;
			const isError = result.exitCode !== 0 || !!result.progress.error;
			return {
				content: [{ type: "text", text: result.output || "(no output)" }],
				details: { results: [result] },
				...(isError ? { isError: true } : {}),
			};
		},

		// ── Render: tool call header ──
		//
		// Two views, toggled by ctrl+o (pi flips `context.expanded` and re-invokes
		// this on every flip). pi-agent-core also re-invokes this on every streamed
		// args delta, so in the expanded branch the full task text grows token by
		// token while the master LLM is still writing the prompt — mirroring how
		// `write`/`edit` reveal their `content` field live.
		renderCall(args, theme, context) {
			if (connectedRenderBridge(context)) return new Text("", 0, 0);

			// Collapsed view (default): single-line header + 60-char task preview.
			if (!context.expanded) {
				if (!args.agent) {
					return new Text(theme.fg("toolTitle", theme.bold("subagent")), 0, 0);
				}
				const taskPreview = args.task
					? (args.task.length > 60 ? args.task.slice(0, 60) + "…" : args.task).replace(/\n/g, " ")
					: "";
				return new Text(
					`${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", args.agent)} ${theme.fg("dim", taskPreview)}`,
					0, 0,
				);
			}

			// Expanded view: header + full streaming task body. Reuse the previous
			// Container so we don't allocate on every streamed token (same pattern
			// the built-in write/edit tools use via context.lastComponent).
			const c = context.lastComponent instanceof Container
				? (context.lastComponent.clear(), context.lastComponent)
				: new Container();
			const agentLabel = args.agent ? ` ${theme.fg("accent", args.agent)}` : "";
			const cwdLabel = args.cwd ? theme.fg("dim", ` (cwd: ${args.cwd})`) : "";
			c.addChild(new Text(`${theme.fg("toolTitle", theme.bold("subagent"))}${agentLabel}${cwdLabel}`, 0, 0));
			if (args.task) {
				c.addChild(new Spacer(1));
				// Plain Text wraps to terminal width. Markdown would also work but
				// the task prompt is the master's raw instruction text, not authored
				// markdown, and parsing partial markdown mid-stream looks jittery.
				c.addChild(new Text(theme.fg("text", args.task), 0, 0));
			}
			return c;
		},

		// ── Render: result ──
		renderResult(result, options, theme, context) {
			const details = result.details as Details | undefined;
			const bridge = connectedRenderBridge(context);
			if (bridge && details?.results?.length) {
				return renderAgentProgress(
					details.results[0],
					theme,
					options.expanded,
					getTermWidth() - 4,
					0,
					{
						args: (context?.args ?? {}) as Record<string, unknown>,
						bridge,
					},
				);
			}
			if (!details?.results?.length) {
				const t = result.content[0];
				const text = t?.type === "text" ? t.text : "(no output)";
				return new Text(text.slice(0, 200), 0, 0);
			}

			const w = getTermWidth() - 4;
			const expanded = options.expanded;
			const c = new Container();
			c.addChild(renderAgentProgress(details.results[0], theme, expanded, w));
			return c;
		},
	});
}
