/**
 * tuicr-background: launch tuicr detached, steer review comments back.
 *
 * Problem this replaces: asking an agent to open tuicr via the skill's
 * wrapper scripts blocks the agent (`herdr pane wait-output`, tmux/Zellij
 * equivalents) until the human closes the TUI.
 *
 * Instead:
 *   - `tuicr_background` / `/tuicr-bg` spawn the same wrapper detached
 *     (the pane still opens; the wrapper still closes it on exit) and
 *     return immediately. An existing active session is attached instead.
 *   - A single watcher polls `tuicr review comments` and steers each new
 *     batch back with `deliverAs: "steer"` + `triggerTurn: true` — the same
 *     delivery path interactive-subagents uses — coalescing bursts so a
 *     comment at a time does not spawn a steer per comment. When the TUI
 *     exits, the remaining batch and a final notice are steered once.
 *
 * The watcher is started from the tool/command that needs it (never the
 * factory) and torn down idempotently on session_shutdown. Session shutdown
 * does NOT close the tuicr pane — a human is reviewing in it.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { execFile as execFileCb, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	buildWrapperArgs,
	collectSeenKeys,
	commentKey,
	formatLaunchResult,
	formatSteerContent,
	newComments,
	parseCommentPayload,
	parseSessionList,
	pickSession,
	resolveSkillDir,
	scopeToTuicrArgs,
	selectWrapper,
	shouldDeliverBatch,
	truncateLines,
} from "./tuicr-background-core.mjs";

const execFile = promisify(execFileCb);

const CLI_TIMEOUT_MS = 15_000;
const POLL_MS = Number(process.env.TUICR_BG_POLL_MS ?? 15_000);
const COALESCE_MS = Number(process.env.TUICR_BG_COALESCE_MS ?? 30_000);
const LAUNCH_WAIT_MS = Number(process.env.TUICR_BG_LAUNCH_WAIT_MS ?? 25_000);
const MAX_CONSECUTIVE_ERRORS = 20;

/** User-facing error carrying a message the model can act on directly. */
class TuicrBackgroundError extends Error {}

interface WatchState {
	repo: string;
	slug: string | null;
	seen: Set<string>;
	pending: unknown[];
	lastDeliveredAt: number | null;
	timer: ReturnType<typeof setInterval>;
	ticking: boolean;
	everActive: boolean;
	launchedAt: number;
	slugResolveDeadline: number;
	consecutiveErrors: number;
}

/** One watcher per session (v1): a new launch replaces the previous one. */
let watch: WatchState | null = null;

// The tool's execute closure needs the ExtensionAPI; captured at factory time.
let piRef: ExtensionAPI | null = null;
let latestUi: { notify: (message: string, level: "info" | "warning" | "error") => void } | null =
	null;

function notify(message: string, level: "info" | "warning" | "error" = "info") {
	try {
		latestUi?.notify(message, level);
	} catch {
		// UI contexts can be invalidated by session replacement; the steer
		// message and its renderer are the durable record.
	}
}

// ── tuicr CLI helpers ──

async function listSessions(repo: string): Promise<unknown[]> {
	const { stdout } = await execFile("tuicr", ["review", "list", "--repo", repo], {
		timeout: CLI_TIMEOUT_MS,
	});
	return parseSessionList(stdout);
}

async function fetchComments(repo: string, slug: string): Promise<unknown[]> {
	const { stdout } = await execFile(
		"tuicr",
		["review", "comments", "--session", slug, ...(slug.startsWith("gh:") ? [] : ["--repo", repo])],
		{ timeout: CLI_TIMEOUT_MS },
	);
	return parseCommentPayload(stdout);
}

// ── Watcher ──

function stopWatch(reason: string) {
	if (!watch) return;
	clearInterval(watch.timer);
	watch = null;
	notify(`tuicr background watcher stopped: ${reason}`, "info");
}

function deliver(pi: ExtensionAPI, state: WatchState, final: boolean) {
	const batch = state.pending;
	state.pending = [];
	// Final with an empty batch still steers so the agent learns the review
	// ended and can wrap up.
	state.lastDeliveredAt = Date.now();
	pi.sendMessage(
		{
			customType: "tuicr_review_comments",
			content: formatSteerContent({
				repo: state.repo,
				slug: state.slug ?? "(unresolved)",
				comments: batch,
				final,
			}),
			display: true,
			details: {
				repo: state.repo,
				slug: state.slug,
				final,
				count: batch.length,
			},
		},
		{ triggerTurn: true, deliverAs: "steer" },
	);
}

async function tick(pi: ExtensionAPI, state: WatchState) {
	if (state.ticking) return;
	state.ticking = true;
	try {
		if (!state.slug) {
			if (Date.now() > state.slugResolveDeadline) {
				stopWatch(`no tuicr session became active for ${state.repo}`);
				pi.sendMessage(
					{
						customType: "tuicr_review_comments",
						content: `tuicr background watcher gave up: no review session became active for ${state.repo}. The pane may have failed to launch — check it, or ask the user to start tuicr manually and re-run tuicr_background.`,
						display: true,
						details: { repo: state.repo, slug: null, final: true, count: 0, gaveUp: true },
					},
					{ triggerTurn: true, deliverAs: "steer" },
				);
				return;
			}
			const picked = pickSession(await listSessions(state.repo));
			if (picked.status === "ok") {
				state.slug = picked.session.slug;
				state.everActive = true;
				// Baseline whatever the user already wrote before we attached.
				state.seen = collectSeenKeys(await fetchComments(state.repo, state.slug));
				notify(`tuicr background watcher attached to ${state.slug}`, "info");
			} else if (picked.status === "ambiguous") {
				stopWatch("multiple active tuicr sessions; pass a session slug");
				return;
			}
			return;
		}

		const comments = await fetchComments(state.repo, state.slug);
		const fresh = newComments(state.seen, comments);
		for (const comment of fresh) state.seen.add(commentKey(comment));
		state.pending.push(...fresh);

		const entry = (await listSessions(state.repo)).find(
			(session) => (session as { slug?: string })?.slug === state.slug,
		) as { active?: boolean } | undefined;
		const active = entry?.active === true;
		if (active) state.everActive = true;
		// The wrapper closes the pane (and deactivates the session) on TUI
		// exit; only treat that as final once we have seen it active at
		// least once, so a slow launch is not mistaken for an exit.
		const final = state.everActive && !active;

		if (final) {
			deliver(pi, state, true);
			stopWatch(`review session ${state.slug} ended`);
		} else if (
			shouldDeliverBatch({
				pendingCount: state.pending.length,
				lastDeliveredAt: state.lastDeliveredAt,
				now: Date.now(),
				coalesceMs: COALESCE_MS,
			})
		) {
			deliver(pi, state, false);
		}
		state.consecutiveErrors = 0;
	} catch (error) {
		state.consecutiveErrors += 1;
		if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
			stopWatch(`repeated tuicr CLI failures: ${error instanceof Error ? error.message : error}`);
		}
	} finally {
		state.ticking = false;
	}
}

function startWatch(pi: ExtensionAPI, repo: string, slug: string | null, seen: Set<string>) {
	if (watch) stopWatch("replaced by a new tuicr_background launch");
	const state: WatchState = {
		repo,
		slug,
		seen,
		pending: [],
		lastDeliveredAt: null,
		timer: setInterval(() => void tick(pi, state), POLL_MS),
		ticking: false,
		everActive: slug !== null,
		slugResolveDeadline: Date.now() + LAUNCH_WAIT_MS * 3,
		consecutiveErrors: 0,
	};
	watch = state;
	// First tick soon so early comments are not missed while the TUI warms up.
	setTimeout(() => void tick(pi, state), 2_000);
}

// ── Launch / attach ──

async function resolveRepo(input: string | undefined, fallback: string): Promise<string> {
	const candidate = input ?? fallback;
	const { stdout } = await execFile("git", ["-C", candidate, "rev-parse", "--show-toplevel"], {
		timeout: 5_000,
	}).catch(() => ({ stdout: candidate }));
	return stdout.trim() || candidate;
}

async function startTuicrBackground(
	pi: ExtensionAPI,
	params: { repo?: string; scope?: string; revset?: string; sessionSlug?: string },
	cwd: string,
): Promise<{ message: string; slug: string | null; attached: boolean }> {
	const repo = await resolveRepo(params.repo, cwd);
	const sessions = await listSessions(repo);
	const picked = pickSession(sessions, params.sessionSlug);

	if (picked.status === "missing") {
		throw new TuicrBackgroundError(
			`No tuicr session named ${picked.slug} under ${repo}. Run \`tuicr review list --repo ${repo}\` for valid slugs.`,
		);
	}
	if (picked.status === "ambiguous") {
		const slugs = picked.sessions.map((session) => (session as { slug: string }).slug).join("\n  ");
		throw new TuicrBackgroundError(
			`Multiple active tuicr sessions under ${repo}:\n  ${slugs}\nPass sessionSlug to choose one.`,
		);
	}

	if (picked.status === "ok") {
		const slug = picked.session.slug as string;
		const seen = collectSeenKeys(await fetchComments(repo, slug));
		startWatch(pi, repo, slug, seen);
		return { message: formatLaunchResult({ repo, slug, attached: true }), slug, attached: true };
	}

	// No active session: launch the wrapper detached. The wrapper still owns
	// pane creation, quoting, and pane cleanup on exit — we simply never wait.
	const script = selectWrapper();
	if (!script) {
		throw new TuicrBackgroundError(
			"No multiplexer detected (Herdr/tmux/Zellij/cmux). Start pi inside one, or pass sessionSlug to attach to an existing session.",
		);
	}
	const wrapperPath = join(resolveSkillDir(), script);
	if (!existsSync(wrapperPath)) {
		throw new TuicrBackgroundError(
			`tuicr wrapper not found at ${wrapperPath}. Set TUICR_SKILL_DIR or install the tuicr skill.`,
		);
	}
	const tuicrArgs = scopeToTuicrArgs(params.scope ?? "working-tree", params.revset);
	const child = spawn(wrapperPath, buildWrapperArgs({ repo, tuicrArgs }), {
		cwd: repo,
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	child.unref();
	child.on("error", (error) => {
		notify(`tuicr wrapper failed to start: ${error.message}`, "error");
	});

	// Give the TUI a moment to register its session so the result can carry
	// the slug; the watcher resolves it later if we time out here.
	const deadline = Date.now() + LAUNCH_WAIT_MS;
	let slug: string | null = null;
	while (Date.now() < deadline && !slug) {
		await new Promise((resolve) => setTimeout(resolve, 1_000));
		const retry = pickSession(await listSessions(repo));
		if (retry.status === "ok") slug = retry.session.slug as string;
		if (retry.status === "ambiguous") break;
	}

	const seen = slug ? collectSeenKeys(await fetchComments(repo, slug)) : new Set<string>();
	startWatch(pi, repo, slug, seen);
	return {
		message: formatLaunchResult({ repo, slug, attached: false, pending: true }),
		slug,
		attached: false,
	};
}

// ── Registration ──

// eslint-disable-next-line @typescript-eslint/no-use-before-define -- execute runs only after the factory sets piRef
const tuicrBackgroundTool = defineTool({
	name: "tuicr_background",
	label: "Launch tuicr in background",
	description:
		"Launch tuicr (interactive TUI code review) in a background pane without blocking, or attach to the active tuicr review session. New user review comments are polled and steered back into this session automatically as each batch lands, so work can continue while the user reviews; a final steer arrives when the TUI exits. Use this INSTEAD of running a tuicr wrapper script through bash — those wrappers block until the TUI is closed.",
	promptSnippet: "Open tuicr detached and receive review comments as steer messages",
	promptGuidelines: [
		"Use tuicr_background instead of running tuicr wrapper scripts via bash; the wrappers block the agent until the TUI exits.",
		"tuicr_background returns immediately; user review comments arrive later as tuicr_review_comments steer messages.",
		"Only one watcher runs per session — a second launch replaces the first.",
	],
	parameters: Type.Object({
		repo: Type.Optional(
			Type.String({ description: "Repository directory. Defaults to the session working directory." }),
		),
		scope: Type.Optional(
			Type.Union([Type.Literal("working-tree"), Type.Literal("revset")], {
				description: "Review scope. Defaults to working-tree.",
			}),
		),
		revset: Type.Optional(
			Type.String({ description: "Commit range to review (required when scope is 'revset')." }),
		),
		sessionSlug: Type.Optional(
			Type.String({
				description:
					"Attach to this specific tuicr session slug (from `tuicr review list`) instead of launching a new pane.",
			}),
		),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		latestUi = ctx.ui;
		try {
			const result = await startTuicrBackground(piRef!, params, ctx.cwd);
			return {
				content: [{ type: "text" as const, text: result.message }],
				details: result,
			};
		} catch (error) {
			if (error instanceof TuicrBackgroundError) {
				return {
					content: [{ type: "text" as const, text: error.message }],
					details: { error: error.message },
					isError: true,
				};
			}
			throw error;
		}
	},
});

export default function tuicrBackground(pi: ExtensionAPI) {
	piRef = pi;

	pi.registerTool(tuicrBackgroundTool);

	pi.registerCommand("tuicr-bg", {
		description:
			"Launch tuicr detached (or attach to the active session) and steer new review comments back. '/tuicr-bg stop' stops the watcher.",
		handler: async (args, ctx) => {
			latestUi = ctx.ui;
			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			if (tokens[0] === "stop") {
				if (!watch) {
					ctx.ui.notify("No tuicr background watcher is running.", "info");
					return;
				}
				stopWatch("stopped by /tuicr-bg stop");
				return;
			}
			let repo: string | undefined;
			let scope = "working-tree";
			let revset: string | undefined;
			const rest = [...tokens];
			if (rest.length > 0 && !rest[0].startsWith("-")) repo = rest.shift();
			const dashIndex = rest.indexOf("-r");
			if (dashIndex !== -1 && rest.length > dashIndex + 1) {
				scope = "revset";
				revset = rest[dashIndex + 1];
			}
			try {
				const result = await startTuicrBackground(piRef!, { repo, scope, revset }, ctx.cwd);
				ctx.ui.notify(result.message, "info");
			} catch (error) {
				ctx.ui.notify(
					error instanceof TuicrBackgroundError ? error.message : String(error),
					"error",
				);
			}
		},
	});

	// Compact visible record of each delivered batch; the steer itself is the
	// functional part, this only renders in the transcript.
	pi.registerMessageRenderer("tuicr_review_comments", (message, options, theme) => {
		const details = message.details as { slug?: string; count?: number; final?: boolean } | undefined;
		if (!details) return undefined;
		const header = details.final
			? `${theme.fg("accent", "◆")} ${theme.fg("toolTitle", theme.bold("tuicr review ended"))} ${theme.fg("dim", details.slug ?? "")}`
			: `${theme.fg("accent", "◆")} ${theme.fg("toolTitle", theme.bold(`tuicr — ${details.count ?? 0} new review comment(s)`))} ${theme.fg("dim", details.slug ?? "")}`;

		const contentLines = [header];
		const body = String(message.content ?? "").split("\n");
		const bodyLines = options.expanded ? body : truncateLines(body, 4);
		contentLines.push(...bodyLines.map((line) => theme.fg("dim", line)));
		if (!options.expanded && body.length > 4) {
			contentLines.push(theme.fg("muted", "Ctrl+O to expand"));
		}

		return {
			render(width: number): string[] {
				const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
				box.addChild(new Text(contentLines.join("\n"), 0, 0));
				return ["", ...box.render(width)];
			},
		};
	});

	pi.on("session_shutdown", () => {
		// Leave the tuicr pane alone: a human may still be reviewing in it.
		if (watch) stopWatch("session shutdown");
		latestUi = null;
	});
}
