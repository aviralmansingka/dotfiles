// Interactive-bridge server: hosts no-mistakes daemon step agents as visible
// Herdr subagent tabs instead of headless processes.
//
// How the pieces meet:
//
//   - The daemon launches its pi step agents through `agent_path_override.pi`
//     (upstream-supported config), which points at the `nm-herdr-pi` shim
//     (pi/bin/nm-herdr-pi.mjs). To the daemon the shim IS pi: same argv
//     (extras + `--mode json` + `--session <uuid>` | `--no-session`, plus
//     `--extension <file>` on the strict structured-output path), prompt on
//     stdin, pi json-mode JSONL expected on stdout, cwd = the run worktree.
//   - This module listens on `$NM_HOME/herdr-bridge/<run-id>/sock`, where the
//     run id is the worktree basename (a ULID). The shim derives it the same
//     way, so both sides meet without any daemon change.
//   - Per invocation (one shim connection): the tab agent runs REAL pi
//     interactively in a Herdr tab of the parent's workspace, cwd = the step
//     worktree, with the daemon's argv translated for interactive use (drop
//     `--mode json`; `--no-session` is dropped too so the turn is streamable
//     — the daemon ignores session ids on cold turns). The daemon's prompt is
//     submitted through `herdr agent prompt --wait`.
//   - The tab's session file is tailed and translated into pi json-mode
//     events (message_end / turn_end / agent_end, plus the synthesized
//     `no_mistakes_output` tool_execution_end for strict turns), streamed to
//     the shim, which writes them to its stdout for the daemon's parser.
//   - Fixer sessions (`--session <uuid>`) reuse ONE live tab across
//     invocations, mirroring the daemon's durable fixer session. Cold
//     (session-free) turns get a fresh tab that closes when the turn settles.
//   - Fallback is the shim's job: no bridge dir/socket, connection refused,
//     or fatal mid-turn → it runs (or fails like) real headless pi, so runs
//     that outlive the parent session, daemon restarts, and non-Herdr
//     contexts keep today's behavior.
//
// Teardown rules: run terminal, session shutdown, and extension reload close
// the tab panes (a later headless `--session` resume must never meet a live
// tab writing the same session file). The bridge dir is removed so later
// shims passthrough instantly instead of probing a dead socket.

import { execFile, execFileSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BRIDGE_DIR_NAME = "herdr-bridge";
export const TURN_SETTLE_TIMEOUT_MS = 30 * 60_000;
export const TAB_READY_TIMEOUT_MS = 30_000;
export const SESSION_DISCOVER_TIMEOUT_MS = 10_000;
const PROMPT_POLL_MS = 250;
const OUTPUT_TOOL = "no_mistakes_output";

// ---------------------------------------------------------------------------
// Pure helpers — unit-tested in no-mistakes-bridge.test.mjs
// ---------------------------------------------------------------------------

export function nmHomeDir(): string {
	return process.env.NM_HOME ?? join(homedir(), ".no-mistakes");
}

/** The run id is the run worktree's basename: a ULID like
 *  `01M4KZ1QA7E1CSFXJM5B4W0240` (upstream mints run ids as ULIDs and places
 *  each run worktree at `worktrees/<repo-hash>/<run-id>`). */
export function deriveRunId(cwd: string): string | undefined {
	const name = basename(resolve(cwd));
	return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(name) ? name : undefined;
}

export function bridgeRunDir(nmHome: string, runId: string): string {
	return join(nmHome, BRIDGE_DIR_NAME, runId);
}

/** pi flags that consume the next argument as a value (from pi --help plus
 *  upstream's piArgTakesValue). Used so `--session`-like words inside values
 *  are never misread as flags. */
const PI_VALUE_FLAGS = new Set([
	"--mode", "--provider", "--model", "--api-key", "--system-prompt",
	"--append-system-prompt", "--name", "-n", "--session", "--session-id",
	"--fork", "--session-dir", "--models", "--tools", "-t", "--exclude-tools",
	"-xt", "--thinking", "--export", "--extension", "-e", "--skill",
	"--prompt-template", "--theme",
]);

export interface SplitAgentArgv {
	/** argv translated for an interactive tab: no `--mode json`, no
	 *  `--no-session` (the tab session is streamable; the daemon ignores
	 *  session ids on cold turns). `--session <uuid>` is kept so fixer turns
	 *  resume their durable session in the tab. */
	interactive: string[];
	sessionId?: string;
	/** True when the daemon asked for a session-free (cold) turn. */
	sessionless: boolean;
}

export function splitAgentArgv(argv: string[]): SplitAgentArgv {
	const interactive: string[] = [];
	let sessionId: string | undefined;
	let sessionless = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--") {
			interactive.push(...argv.slice(i));
			break;
		}
		if (arg === "--mode" && argv[i + 1] === "json") {
			i++; // drop the pair — json-mode events are synthesized from the session file
			continue;
		}
		if (arg === "--no-session") {
			sessionless = true;
			continue;
		}
		if (arg === "--session" && typeof argv[i + 1] === "string") {
			sessionId = argv[i + 1]!;
			interactive.push(arg, argv[i + 1]!);
			i++;
			continue;
		}
		if (PI_VALUE_FLAGS.has(arg) && typeof argv[i + 1] === "string") {
			interactive.push(arg, argv[i + 1]!);
			i++;
			continue;
		}
		interactive.push(arg);
	}
	return { interactive, sessionId, sessionless };
}

export function shellQuote(value: string): string {
	return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/** Launcher script for the tab: exports the daemon-provided environment
 *  subset (gate evidence + git non-interactive discipline + NM_* wiring) and
 *  execs real pi interactively with the translated argv. `--no-extensions`
 *  keeps the step agent deterministic (no global extension machinery); the
 *  daemon's strict `--extension <file>` output tool and the pane-state
 *  reporter are loaded explicitly, since explicit -e paths still work under
 *  --no-extensions. */
export function buildTabLauncher(opts: {
	realPi: string;
	interactiveArgv: string[];
	env: Record<string, string>;
	extraExtensions: string[];
}): string {
	const exports = Object.entries(opts.env)
		.filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
		.map(([key, value]) => `export ${key}=${shellQuote(value)}`);
	const command = [
		opts.realPi,
		"--no-extensions",
		...opts.interactiveArgv,
		...opts.extraExtensions.flatMap((path) => ["-e", path]),
	].map(shellQuote).join(" ");
	return ["#!/bin/bash", ...exports, `exec ${command}`, ""].join("\n");
}

function firstText(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	for (const block of content) {
		if (typeof block === "string" && block) return block;
		if (block && typeof block === "object" && (block as any).type === "text") {
			const text = (block as any).text;
			if (typeof text === "string" && text) return text;
		}
	}
	return undefined;
}

/** Translate a live pi session file into the json-mode event stream the
 *  daemon's parser consumes (verified against a captured `pi --mode json`
 *  stream and upstream's internal/agent/pi.go piParser):
 *   - the `session` header record → `{"type":"session","id"}` (once)
 *   - `message` records → `{"type":"message_end","message"}` — the parser
 *     takes final text, model, provider, usage, and stopReason from these
 *   - a `no_mistakes_output` toolCall + its toolResult → the synthesized
 *     `tool_execution_end` envelope (terminate/details.output) the strict
 *     path requires
 *   - finish() → `turn_end`, `agent_end` (system + this turn's messages),
 *     and `agent_settled`
 */
export class SessionEventTranslator {
	private sessionEmitted: boolean;
	private systemMessage: unknown;
	private readonly turnMessages: unknown[] = [];
	private lastAssistant: unknown;
	private readonly outputToolCalls = new Set<string>();
	private pendingSessionId: string | undefined;

	constructor(sessionId?: string) {
		this.sessionEmitted = false;
		this.pendingSessionId = sessionId;
	}

	feedRecord(record: unknown): string[] {
		if (!record || typeof record !== "object") return [];
		const rec = record as Record<string, unknown>;
		if (rec.type === "session") {
			if (!this.sessionEmitted) {
				const id = typeof rec.id === "string" && rec.id ? rec.id : this.pendingSessionId;
				if (id) {
					this.sessionEmitted = true;
					return [JSON.stringify({ type: "session", id })];
				}
			}
			return [];
		}
		if (rec.type !== "message") return [];
		const message = rec.message;
		if (!message || typeof message !== "object") return [];
		const msg = message as Record<string, unknown>;
		const lines: string[] = [];
		if (msg.role === "system") {
			if (this.systemMessage === undefined) this.systemMessage = msg;
			return lines;
		}
		this.turnMessages.push(msg);
		lines.push(JSON.stringify({ type: "message_end", message: msg }));
		if (msg.role === "assistant") {
			this.lastAssistant = msg;
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (
						block && typeof block === "object" &&
						(block as any).type === "toolCall" &&
						(block as any).name === OUTPUT_TOOL &&
						typeof (block as any).id === "string"
					) {
						this.outputToolCalls.add((block as any).id);
					}
				}
			}
		}
		if (
			msg.role === "toolResult" &&
			typeof msg.toolCallId === "string" &&
			this.outputToolCalls.has(msg.toolCallId)
		) {
			const text = firstText(msg.content);
			if (text !== undefined) {
				try {
					const output = JSON.parse(text);
					lines.push(
						JSON.stringify({
							type: "tool_execution_end",
							toolName: OUTPUT_TOOL,
							isError: false,
							toolCallId: msg.toolCallId,
							result: { terminate: true, details: { output } },
						}),
					);
				} catch {
					// Unparseable tool text: emit nothing. The daemon then finds no
					// output-tool result and rejects/retries the turn, exactly as it
					// would for a headless agent that never called the tool cleanly.
				}
			}
		}
		return lines;
	}

	finish(): string[] {
		const messages: unknown[] = [];
		if (this.systemMessage !== undefined) messages.push(this.systemMessage);
		messages.push(...this.turnMessages);
		const lines: string[] = [];
		if (this.lastAssistant !== undefined) {
			lines.push(JSON.stringify({ type: "turn_end", message: this.lastAssistant }));
		}
		lines.push(JSON.stringify({ type: "agent_end", messages }));
		lines.push(JSON.stringify({ type: "agent_settled", aborted: false }));
		return lines;
	}
}

// ---------------------------------------------------------------------------
// Server — Herdr tab hosting (side-effectful; covered by integration, not
// unit tests)
// ---------------------------------------------------------------------------

interface TabHandle {
	paneId: string;
	sessionId?: string;
	scriptPath?: string;
}

interface RunBridge {
	runId: string;
	dir: string;
	server: Server;
	tabs: Map<string, TabHandle>;
	ordinal: number;
}

const BRIDGE_KEY = Symbol.for("pi-no-mistakes/bridge-state");

interface BridgeState {
	runs: Map<string, RunBridge>;
}

function bridgeState(): BridgeState {
	let state = (globalThis as any)[BRIDGE_KEY] as BridgeState | undefined;
	if (!state) {
		state = { runs: new Map() };
		(globalThis as any)[BRIDGE_KEY] = state;
	}
	return state;
}

export function herdrBridgeAvailable(): boolean {
	if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) return false;
	try {
		execFileSync("sh", ["-c", "command -v herdr"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function herdrJsonSync(args: string[]): any | null {
	try {
		return JSON.parse(execFileSync("herdr", args, { encoding: "utf-8", timeout: 10_000 }));
	} catch {
		return null;
	}
}

function herdrOkSync(args: string[]): boolean {
	try {
		execFileSync("herdr", args, { encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "ignore", "ignore"] });
		return true;
	} catch {
		return false;
	}
}

function paneAlive(paneId: string): boolean {
	return herdrOkSync(["pane", "get", paneId]);
}

function realPiPath(): string {
	const override = process.env.NM_HERDR_REAL_PI;
	if (override && existsSync(override)) return override;
	const candidate = join(homedir(), ".pi", "agent", "bin", "pi");
	if (existsSync(candidate)) return candidate;
	return "pi";
}

function paneStateExtensionPath(): string | undefined {
	const candidate = join(homedir(), ".pi", "agent", "extensions", "herdr-agent-state.ts");
	return existsSync(candidate) ? candidate : undefined;
}

function piSessionsDir(): string {
	return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
}

function mangledSessionDir(cwd: string): string {
	return `--${resolve(cwd).split("/").join("-")}--`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((done) => setTimeout(done, ms));
}

interface Hello {
	argv: string[];
	cwd: string;
	env: Record<string, string>;
	prompt: string;
}

function isHello(value: unknown): value is Hello {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.argv) && typeof v.cwd === "string" && typeof v.prompt === "string";
}

/** True when a live server answers the socket at `sockPath`. */
export function probeSocket(sockPath: string): Promise<boolean> {
	return new Promise((done) => {
		const probe = createConnection(sockPath);
		const finish = (alive: boolean) => {
			clearTimeout(timer);
			probe.destroy();
			done(alive);
		};
		const timer = setTimeout(() => finish(false), 500);
		timer.unref?.();
		probe.once("connect", () => finish(true));
		probe.once("error", () => finish(false));
	});
}

/** Ensure the bridge listener exists for a run (idempotent). No-op without
 *  Herdr — the shims passthrough headless and nothing changes. A socket
 *  another live host answers means that host owns the run's bridge: this
 *  process never touches the dir. A socket nobody answers is a stale
 *  leftover from a dead host: only that file is removed before claiming. */
export function ensureBridgeServer(runId: string): void {
	const state = bridgeState();
	if (state.runs.has(runId)) return;
	if (!herdrBridgeAvailable()) return;
	const dir = bridgeRunDir(nmHomeDir(), runId);
	const sockPath = join(dir, "sock");
	if (existsSync(sockPath)) {
		void probeSocket(sockPath).then((alive) => {
			if (alive || state.runs.has(runId)) return;
			try {
				rmSync(sockPath, { force: true });
			} catch {}
			claimBridgeServer(state, runId, dir, sockPath);
		});
		return;
	}
	claimBridgeServer(state, runId, dir, sockPath);
}

function claimBridgeServer(state: BridgeState, runId: string, dir: string, sockPath: string): void {
	mkdirSync(dir, { recursive: true });
	const bridge: RunBridge = { runId, dir, server: undefined as any, tabs: new Map(), ordinal: 0 };
	const server = createServer((socket) => void handleConnection(bridge, socket));
	let listening = false;
	server.on("listening", () => {
		listening = true;
	});
	server.on("error", () => {
		// An error before the first listen means another host claimed the run.
		if (bridgeState().runs.get(runId) === bridge) state.runs.delete(runId);
		if (listening) void teardownRun(bridge);
	});
	try {
		server.listen(sockPath);
		// The pane extension's own TUI keeps this process alive in production;
		// unref keeps a headless host (tests, JSON mode) from draining never.
		server.unref();
	} catch {
		return;
	}
	bridge.server = server;
	state.runs.set(runId, bridge);
}

async function handleConnection(bridge: RunBridge, socket: Socket): Promise<void> {
	let buffer = "";
	let onKilled: (() => void) | undefined;
	let started = false;
	socket.on("data", (chunk) => {
		buffer += chunk.toString("utf-8");
		let index: number;
		while ((index = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			if (!line) continue;
			try {
				const message = JSON.parse(line);
				if (message?.type === "hello" && isHello(message) && !started) {
					started = true;
					void runInvocation(bridge, socket, message, (killer) => {
						onKilled = killer;
					});
				} else if (message?.type === "killed") {
					onKilled?.();
				}
			} catch {
				socket.destroy();
			}
		}
	});
	socket.on("error", () => socket.destroy());
}

async function runInvocation(
	bridge: RunBridge,
	socket: Socket,
	hello: Hello,
	registerKiller: (killer: () => void) => void,
): Promise<void> {
	const send = (payload: Record<string, unknown>) => {
		if (!socket.destroyed) socket.write(JSON.stringify(payload) + "\n");
	};
	const fatal = (message: string) => {
		send({ type: "fatal", message });
		socket.end();
	};

	const { interactive, sessionId, sessionless } = splitAgentArgv(hello.argv);
	const runId = deriveRunId(hello.cwd);
	if (!runId) {
		fatal("bridge: invocation cwd is not a run worktree");
		return;
	}
	const step = `agent-${++bridge.ordinal}`;
	const tabKey = sessionId ?? `cold-${bridge.ordinal}`;

	let created: TabHandle | undefined;
	let tab = sessionId ? bridge.tabs.get(sessionId) : undefined;
	if (tab && !paneAlive(tab.paneId)) {
		bridge.tabs.delete(sessionId!);
		tab = undefined;
	}
	if (!tab) {
		const opened = openTab(bridge, hello, interactive, step, tabKey);
		if (!opened) {
			fatal(`bridge: could not open a Herdr tab for step ${step}`);
			return;
		}
		created = opened;
		tab = opened;
		bridge.tabs.set(tabKey, tab);
	}

	const cut = { flag: false };
	registerKiller(() => {
		cut.flag = true;
	});
	socket.on("close", () => {
		cut.flag = true;
	});
	const closeTab = (handle: TabHandle) => {
		herdrOkSync(["pane", "close", handle.paneId]);
		if (handle.scriptPath) {
			try {
				rmSync(handle.scriptPath, { force: true });
			} catch {}
		}
		bridge.tabs.delete(tabKey);
	};

	try {
		await waitTabReady(tab.paneId);
		const translator = new SessionEventTranslator(sessionId);

		let sessionFile: string | undefined;
		let fd: number | undefined;
		let offset = 0;
		if (sessionId) {
			// Resumed fixer session: the durable session file already exists,
			// so seed the translator from its head now (the emitted session
			// event line goes to the shim, like a headless pi startup) and
			// stream only records appended after this point — the prior
			// conversation is never re-emitted.
			sessionFile = await discoverSessionFile(tab, hello, sessionId);
			for (const line of applyPreface(translator, sessionFile, sessionId)) {
				send({ type: "events", lines: [line] });
			}
			fd = openSync(sessionFile, "r");
			offset = statSync(sessionFile).size;
		}

		// A fresh tab writes its session file only when its first turn starts
		// (verified live: an idle tab pi has an empty session dir), so the
		// daemon's prompt must be in flight before discovery can ever succeed
		// — for a cold step the opposite order always times out.
		const submit = execFileAsync(
			"herdr",
			["agent", "prompt", tab.paneId, hello.prompt, "--wait", "--timeout", String(TURN_SETTLE_TIMEOUT_MS)],
			{ timeout: TURN_SETTLE_TIMEOUT_MS + 30_000, maxBuffer: 1024 * 1024 },
		);
		// A failure before the race below (discovery fatal, daemon cut)
		// must not leave the in-flight prompt as an unhandled rejection.
		submit.catch(() => {});

		if (!sessionId) {
			// Cold step: the whole fresh session file is this one turn, so the
			// stream starts at byte 0 and the head records (session header,
			// system message, this turn's user record) flow through the
			// translator in file order.
			sessionFile = await discoverSessionFile(tab, hello, sessionId);
			fd = openSync(sessionFile, "r");
		}

		const streamNew = () => {
			offset = streamNewRecords(fd!, offset, (record) => {
				for (const line of translator.feedRecord(record)) send({ type: "events", lines: [line] });
			});
		};

		let settled = false;
		const polling = (async () => {
			while (!cut.flag && !settled) {
				await sleep(PROMPT_POLL_MS);
				if (cut.flag) return false;
				streamNew();
			}
			return false;
		})();
		settled = await Promise.race([submit.then(() => true), polling]);
		if (cut.flag && !settled) {
			// The daemon cut the invocation (timeout/cancel): kill the tab so a
			// retry or later --session resume never meets a second writer.
			closeTab(tab);
			closeSync(fd!);
			socket.end();
			return;
		}
		streamNew();
		for (const line of translator.finish()) send({ type: "events", lines: [line] });
		closeSync(fd!);
		socket.end();
		if (sessionless) closeTab(tab);
	} catch (err) {
		if (created) closeTab(created);
		fatal(`bridge: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function openTab(
	bridge: RunBridge,
	hello: Hello,
	interactive: string[],
	step: string,
	tabKey: string,
): TabHandle | undefined {
	const parent = herdrJsonSync(["pane", "get", process.env.HERDR_PANE_ID!]);
	const workspaceId = parent?.result?.pane?.workspace_id;
	if (typeof workspaceId !== "string" || !workspaceId) return undefined;
	const created = herdrJsonSync([
		"tab",
		"create",
		"--workspace",
		workspaceId,
		"--cwd",
		hello.cwd,
		"--label",
		`subagent: nm ${bridge.runId.slice(-6)} ${step}`,
		"--no-focus",
	]);
	const paneId = created?.result?.root_pane?.pane_id ?? created?.result?.pane?.pane_id;
	if (typeof paneId !== "string" || !paneId) return undefined;

	const extraExtensions = paneStateExtensionPath() ? [paneStateExtensionPath()!] : [];
	const script = buildTabLauncher({
		realPi: realPiPath(),
		interactiveArgv: interactive,
		env: hello.env ?? {},
		extraExtensions,
	});
	const scriptPath = join(bridge.dir, `launch-${tabKey}.sh`);
	writeFileSync(scriptPath, script, { mode: 0o755 });
	if (!herdrOkSync(["pane", "run", paneId, "bash", scriptPath])) {
		herdrOkSync(["pane", "close", paneId]);
		try {
			rmSync(scriptPath, { force: true });
		} catch {}
		return undefined;
	}
	return { paneId, scriptPath };
}

async function waitTabReady(paneId: string): Promise<void> {
	const deadline = Date.now() + TAB_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const info = herdrJsonSync(["agent", "get", paneId]);
		const status = info?.result?.agent?.agent_status;
		if (status === "idle" || status === "done") return;
		if (status === "blocked") {
			throw new Error("tab agent is blocked during startup (read its pane before bridging)");
		}
		await sleep(PROMPT_POLL_MS);
	}
	throw new Error("tab agent never became ready");
}

async function discoverSessionFile(tab: TabHandle, hello: Hello, sessionId?: string): Promise<string> {
	const deadline = Date.now() + SESSION_DISCOVER_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const info = herdrJsonSync(["agent", "get", tab.paneId]);
		const path = info?.result?.agent?.agent_session?.value;
		if (typeof path === "string" && path && existsSync(path)) return path;
		await sleep(PROMPT_POLL_MS);
	}
	// Fallback: resolve by session id under the mangled sessions dir.
	if (sessionId) {
		const dir = join(piSessionsDir(), mangledSessionDir(hello.cwd));
		try {
			const { readdirSync } = require("node:fs") as typeof import("node:fs");
			for (const name of readdirSync(dir)) {
				if (name.endsWith(`_${sessionId}.jsonl`)) return join(dir, name);
			}
		} catch {}
	}
	throw new Error("could not discover the tab agent's session file");
}

/** Seed the translator from the head of the session file: the `session`
 *  header (its id) and the system message record (replayed inside
 *  agent_end). Returns the event lines the records emit — headless pi
 *  prints the session event first, so the caller sends them before any
 *  turn record. For a resumed session the head also holds the whole prior
 *  conversation, which must NOT be re-emitted — only the session id and the
 *  first system record are taken. */
function applyPreface(translator: SessionEventTranslator, sessionFile: string, sessionId?: string): string[] {
	const lines: string[] = [];
	try {
		const head = readHead(sessionFile, 512 * 1024);
		let systemSeen = false;
		for (const record of head.records) {
			if (record?.type === "session") {
				lines.push(...translator.feedRecord(record));
			} else if (record?.type === "message" && (record as any).message?.role === "system" && !systemSeen) {
				systemSeen = true;
				lines.push(...translator.feedRecord(record));
			}
			if (systemSeen && sessionId) break; // resumed: preface done once both are found
		}
	} catch {}
	return lines;
}

function readHead(path: string, maxBytes: number): { records: unknown[] } {
	// Synchronous head read, capped: the system message sits within the first
	// records of the file, well before 512 KiB in practice.
	const fd = openSync(path, "r");
	try {
		const size = statSync(path).size;
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		const read = readSync(fd, buffer, 0, length, 0);
		const text = buffer.subarray(0, read).toString("utf-8");
		const records: unknown[] = [];
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				records.push(JSON.parse(line));
			} catch {
				// torn or non-JSON line — ignore
			}
		}
		return { records };
	} finally {
		closeSync(fd);
	}
}

/** Read whole new lines from a growing session file using a persistent file
 *  descriptor. Returns the new offset. A torn trailing line is re-read on
 *  the next pass. Reads are capped per pass so one huge tool result never
 *  blocks the loop for long. */
function streamNewRecords(fd: number, offset: number, onRecord: (record: unknown) => void): number {
	try {
		const size = fstatSync(fd).size;
		if (size <= offset) return offset;
		const toRead = Math.min(size - offset, 4 * 1024 * 1024);
		const buffer = Buffer.alloc(toRead);
		const read = readSync(fd, buffer, 0, toRead, offset);
		if (read <= 0) return offset;
		const text = buffer.subarray(0, read).toString("utf-8");
		const lastNewline = text.lastIndexOf("\n");
		if (lastNewline < 0) return offset; // no complete line yet
		for (const line of text.slice(0, lastNewline).split("\n")) {
			if (!line.trim()) continue;
			try {
				onRecord(JSON.parse(line));
			} catch {
				// torn or non-JSON line — skip
			}
		}
		return offset + Buffer.byteLength(text.slice(0, lastNewline + 1), "utf-8");
	} catch {
		return offset;
	}
}

async function teardownRun(bridge: RunBridge): Promise<void> {
	const state = bridgeState();
	if (state.runs.get(bridge.runId) === bridge) state.runs.delete(bridge.runId);
	for (const tab of bridge.tabs.values()) {
		herdrOkSync(["pane", "close", tab.paneId]);
		if (tab.scriptPath) {
			try {
				rmSync(tab.scriptPath, { force: true });
			} catch {}
		}
	}
	bridge.tabs.clear();
	try {
		bridge.server.close();
	} catch {}
	try {
		rmSync(bridge.dir, { recursive: true, force: true });
	} catch {}
}

/** Close every bridge: stop listeners, close all step-agent tabs, remove the
 *  bridge dirs (later shims then passthrough instantly). Called on run
 *  terminal, session shutdown, and extension reload. */
export function teardownBridgeServers(): void {
	for (const bridge of Array.from(bridgeState().runs.values())) {
		void teardownRun(bridge);
	}
}

/** Close only the given run's bridge (stale socket dir removed too, so later
 *  invocations passthrough headless). */
export function teardownBridgeForRun(runId: string): void {
	const bridge = bridgeState().runs.get(runId);
	if (bridge) void teardownRun(bridge);
}
