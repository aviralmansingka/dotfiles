/**
 * `remote` — bring up a subagent on an always-on remote host (the saved
 * Herdr SSH machine `devbox`) so agent work survives a closed MacBook.
 *
 * Why: the MacBook sleeps when the lid closes and every local agent stops
 * with it. A remote subagent must therefore live entirely on the remote
 * host: the remote Herdr server owns the tab, pane, and pi session, and
 * every client (Mac `herdr --remote`, phone `ssh devbox; herdr`) is
 * detachable. There is no cross-machine steer message — results stay on
 * the remote host and are read by attaching. Host choice is devbox by
 * design: it answers on a public IP from any network (a plane), while the
 * homelab needs Tailscale plus a healthy home uplink.
 *
 * `/remote <task>`:
 *   1. `herdr --machine devbox agent list` — learn taken agent names.
 *   2. `herdr --machine devbox tab create --label <name> --cwd '~'
 *      --no-focus` — a fresh tab at a shell prompt in the remote default
 *      session. Parse `.result.tab.tab_id` and `.result.root_pane.pane_id`.
 *   3. `herdr --machine devbox agent start <name> --kind pi --pane <pane>`
 *      — pi launches in that pane and waits at its prompt.
 *   4. `herdr --machine devbox agent prompt <name> <task>` — fire and
 *      forget: no `--wait`, the turn runs on the remote host.
 *
 * `/remote` with no args (or `status`) lists remote agents and states plus
 * the attach commands.
 *
 * House rules honored: panes are created through the herdr CLI, never raw
 * tmux; the extension closes only tabs it created itself in this run; and
 * `--machine` is never combined with `--session` or `--remote`. Machine
 * API forwarding requires the remote server to already run — it does;
 * `herdr machine add devbox` prepared it.
 *
 * Cleanup policy: if `agent start` fails the fresh tab is closed (no agent
 * ever lived in it). If `agent prompt` fails the tab and the idle pi agent
 * are kept — the agent is up and can be driven by attaching; killing it
 * from here would discard a live session the user can still use.
 */
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MACHINE = "devbox";
const AGENT_KIND = "pi";
const AGENT_NAME_MAX = 24;
const NAME_WORDS = 5;
const MAX_NAME_ATTEMPTS = 20;
const LIST_TIMEOUT_MS = 30_000;
const CREATE_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 120_000;
const START_FLAG_TIMEOUT_MS = 60_000;
const PROMPT_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 30_000;
const EXCERPT_MAX = 200;

const ATTACH_HINTS = [
	"Attach from Mac: herdr --remote devbox",
	"Attach from phone: ssh devbox, then run herdr",
].join("\n");

// --- herdr runner -----------------------------------------------------------

function herdr(args: string[], timeoutMs: number): string {
	return execFileSync("herdr", args, {
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer: 16 * 1024 * 1024,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function excerpt(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat;
}

/** Turn a failed herdr call into a readable message, keeping stderr. */
function herdrError(step: string, error: unknown): Error {
	const err = error as { stderr?: string | Buffer; message?: string };
	const detail = err.stderr ? String(err.stderr).trim() : (err.message ?? "");
	if (/(timed out|connection|refused|unreachable)/i.test(detail)) {
		return new Error(
			`${MACHINE} is unreachable while running ${step} — check the network. ` +
				`Diagnose with: herdr machine status ${MACHINE} (${excerpt(detail)})`,
		);
	}
	return new Error(`herdr ${step} failed: ${excerpt(detail)}`);
}

// --- pure helpers (exported for tests) --------------------------------------

/** Slugify a task into a short agent name: first words, [a-z0-9-]. */
export function slugifyAgentName(task: string): string {
	const slug = task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const words = slug.split("-").filter(Boolean).slice(0, NAME_WORDS).join("-");
	const name = words.slice(0, AGENT_NAME_MAX).replace(/-+$/g, "");
	return name || "remote";
}

/** Pick a name not already taken by a remote agent: base, then base-2, -3… */
export function pickAgentName(task: string, taken: readonly string[]): string {
	const base = slugifyAgentName(task);
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let i = 2; i < 2 + MAX_NAME_ATTEMPTS; i++) {
		const suffix = `-${i}`;
		const stem = base.length + suffix.length <= AGENT_NAME_MAX ? base : base.slice(0, AGENT_NAME_MAX - suffix.length);
		const candidate = `${stem}${suffix}`;
		if (!used.has(candidate)) return candidate;
	}
	return `remote-${Date.now()}`;
}

export interface TabCreateResult {
	tabId: string;
	paneId: string;
}

/** Parse `tab create` JSON into the ids the next steps need. */
export function parseTabCreate(stdout: string): TabCreateResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error(`tab create returned invalid JSON: ${excerpt(stdout)}`);
	}
	const result = (parsed as { result?: Record<string, unknown> }).result ?? {};
	const tab = (result.tab ?? {}) as Record<string, unknown>;
	const pane = (result.root_pane ?? {}) as Record<string, unknown>;
	if (typeof tab.tab_id !== "string" || !tab.tab_id) {
		throw new Error(`tab create result has no .result.tab.tab_id: ${excerpt(stdout)}`);
	}
	if (typeof pane.pane_id !== "string" || !pane.pane_id) {
		throw new Error(`tab create result has no .result.root_pane.pane_id: ${excerpt(stdout)}`);
	}
	return { tabId: tab.tab_id, paneId: pane.pane_id };
}

export interface RemoteAgent {
	name: string;
	state: string;
}

/** Parse `agent list` JSON into { name, state } rows. */
export function parseAgentList(stdout: string): RemoteAgent[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error(`agent list returned invalid JSON: ${excerpt(stdout)}`);
	}
	const result = (parsed as { result?: Record<string, unknown> }).result ?? {};
	const agents = result.agents;
	if (!Array.isArray(agents)) return [];
	return agents
		.map((entry) => {
			const agent = (entry ?? {}) as Record<string, unknown>;
			return {
				name: typeof agent.name === "string" ? agent.name : "",
				state: typeof agent.agent_status === "string" ? agent.agent_status : "unknown",
			};
		})
		.filter((agent) => agent.name);
}

/** Render a status body for the notify message. */
export function formatAgentList(agents: readonly RemoteAgent[]): string {
	if (!agents.length) return `No agents running on ${MACHINE}.`;
	return agents.map((agent) => `${agent.name} — ${agent.state}`).join("\n");
}

// --- command ----------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	const status = (ctx: { ui: { notify: (message: string, level: string) => void } }) => {
		try {
			const agents = parseAgentList(herdr(["--machine", MACHINE, "agent", "list"], LIST_TIMEOUT_MS));
			ctx.ui.notify(`${formatAgentList(agents)}\n\n${ATTACH_HINTS}`, "info");
		} catch (error) {
			ctx.ui.notify(herdrError("agent list", error).message, "error");
		}
	};

	const spawn = (task: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => {
		let listed = false;
		let created: TabCreateResult | null = null;
		let agentUp = false;
		let name = "";
		try {
			const taken = parseAgentList(
				herdr(["--machine", MACHINE, "agent", "list"], LIST_TIMEOUT_MS),
			).map((agent) => agent.name);
			listed = true;
			name = pickAgentName(task, taken);
			created = parseTabCreate(
				herdr(
					["--machine", MACHINE, "tab", "create", "--label", name, "--cwd", "~", "--no-focus"],
					CREATE_TIMEOUT_MS,
				),
			);
			herdr(
				[
					"--machine",
					MACHINE,
					"agent",
					"start",
					name,
					"--kind",
					AGENT_KIND,
					"--pane",
					created.paneId,
					"--timeout",
					String(START_FLAG_TIMEOUT_MS),
				],
				START_TIMEOUT_MS,
			);
			agentUp = true;
			herdr(["--machine", MACHINE, "agent", "prompt", name, task], PROMPT_TIMEOUT_MS);
		} catch (error) {
			const step = !listed ? "agent list" : !created ? "tab create" : !agentUp ? "agent start" : "agent prompt";
			if (created && !agentUp) {
				// No agent ever lived in the tab — close the tab we just made.
				try {
					herdr(["--machine", MACHINE, "tab", "close", created.tabId], CLOSE_TIMEOUT_MS);
				} catch {
					// Best effort: the error below is the one that matters.
				}
				ctx.ui.notify(
					`${herdrError(step, error).message}\nThe fresh tab was closed; nothing is running on ${MACHINE}.`,
					"error",
				);
				return;
			}
			if (agentUp) {
				// The pi agent is up and idle; keep it — the user can attach and drive it.
				ctx.ui.notify(
					`${herdrError(step, error).message}\nAgent "${name}" is up on ${MACHINE} but the task was not submitted — attach to drive it.\n${ATTACH_HINTS}`,
					"error",
				);
				return;
			}
			ctx.ui.notify(herdrError(step, error).message, "error");
			return;
		}
		ctx.ui.notify(
			[
				`"${name}" spawned on ${MACHINE} and working on the task.`,
				ATTACH_HINTS,
				"Check status: /remote",
			].join("\n"),
			"info",
		);
	};

	pi.registerCommand("remote", {
		description: "Spawn a subagent on devbox (/remote <task>) or show its status",
		handler: async (args: string, ctx) => {
			const task = (args ?? "").trim();
			if (!task || task.toLowerCase() === "status") {
				status(ctx);
				return;
			}
			spawn(task, ctx);
		},
	});
}
