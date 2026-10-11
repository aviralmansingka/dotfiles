/**
 * tuicr: open interactive tuicr reviews, steer comments back.
 *
 * Problem this replaces: asking an agent to open tuicr via the skill's
 * wrapper scripts blocks the agent (`herdr pane wait-output`, tmux/Zellij
 * equivalents) until the human closes the TUI.
 *
 * Instead, two surfaces (see README-tuicr.md):
 *   - `tuicr_review` / `/tuicr` open a review: the requested target is
 *     resolved — never silently attaching to an unrelated active session
 *     — a duplicate reviewer for the same target is refused, and the
 *     `tuicr-review` subagent is spawned. The parent opens NO pane: the
 *     subagent launches it itself with the internal `tuicr` tool from
 *     inside its own Herdr tab, so the wrapper inherits the subagent's
 *     HERDR_PANE_ID and the split lands beside the agent. The subagent
 *     answers the user's comments inside the TUI and its summary steers
 *     back when the TUI closes. Different targets run concurrently, each
 *     in its own tab with its own pane.
 *   - `tuicr` (internal; `/tuicr watch`) launches the pane in this
 *     session's own tab when no session matches the requested target, or
 *     attaches to the matching active session, then polls
 *     `tuicr review comments` and steers each new batch back with
 *     `deliverAs: "steer"` + `triggerTurn: true` — the same
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
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { execFile as execFileCb, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	activeSlugs,
	buildReviewSubagentTask,
	buildWrapperArgs,
	classifyReviewRequest,
	collectSeenKeys,
	commentKey,
	describeReviewTarget,
	formatCommentLine,
	formatLaunchResult,
	formatReplyCall,
	formatReplyResult,
	formatReviewLaunchResult,
	formatSteerContent,
	newComments,
	parseCommentPayload,
	parseSessionList,
	parseTuicrCommandArgs,
	postTuicrReply,
	resolveLaunchedSession,
	resolveSkillDir,
	resolveTargetSession,
	reviewTargetKey,
	reviewerSubagentName,
	selectWrapper,
	shouldDeliverBatch,
	targetToScopeArgs,
	truncateLines,
} from "./tuicr-core.mjs";
import { publishKeepOpenCount } from "./keep-open-slot.mjs";

const execFile = promisify(execFileCb);

const CLI_TIMEOUT_MS = 15_000;
const POLL_MS = Number(process.env.TUICR_BG_POLL_MS ?? 15_000);
const COALESCE_MS = Number(process.env.TUICR_BG_COALESCE_MS ?? 30_000);
const LAUNCH_WAIT_MS = Number(process.env.TUICR_BG_LAUNCH_WAIT_MS ?? 25_000);
const MAX_CONSECUTIVE_ERRORS = 20;

/** User-facing error carrying a message the model can act on directly. */
class TuicrBackgroundError extends Error {}

/** A resolved review target (see resolveTargetSession in tuicr-core.mjs). */
interface ReviewTarget {
	type: "pr" | "revset" | "working-tree" | "slug";
	pr?: number;
	revset?: string;
	slug?: string;
}

interface WatchState {
	repo: string;
	/** Requested target, threaded in so a launch resolves its own session. */
	target: ReviewTarget | null;
	/** Active slugs at launch time: sessions new since then are ours. */
	baselineSlugs: string[];
	slug: string | null;
	seen: Set<string>;
	pending: unknown[];
	lastDeliveredAt: number | null;
	timer: ReturnType<typeof setInterval> | null;
	firstTick: ReturnType<typeof setTimeout> | null;
	ticking: boolean;
	everActive: boolean;
	launchedAt: number;
	slugResolveDeadline: number;
	consecutiveErrors: number;
}

/** One watcher per session (v1): a new launch replaces the previous one. */
let watch: WatchState | null = null;
const replyIds = new Set<string>();
let repliesInFlight = 0;

// One tuicr-review subagent per review target (pr:<N> / rev:<revset> /
// wt:<repo> / slug:<slug>): a second watcher on the same session would
// double-answer every comment batch, while different targets run
// concurrently, each in its own tab with its own pane. Liveness is queried
// from the interactive-subagents registry, so a finished reviewer never
// blocks the next review of the same target.
const spawnedReviewers = new Map<string, string>();

function reviewerRunning(name: string): boolean {
	const isRunning = (globalThis as any).__pi_interactive_subagents?.isSubagentRunning;
	return typeof isRunning === "function" ? isRunning(name) : false;
}

// While this session's watcher is active, future turns are guaranteed
// (comment batches steer in). subagent-done.ts reads this count in its
// agent_end handler so an auto-exit subagent hosting a watcher (the
// tuicr-review agent) parks in "waiting" instead of exiting after its
// first turn — the same suppression ask_question and running children use.
//
// COMPOSITION: this is a SHARED slot — no-mistakes-pane.ts publishes its
// run-tracking count under the same well-known symbol, and a session can
// load both writers (the nm-orchestrator discovers them via agent-dir:
// parent). Both sides publish through the one shared module
// (keep-open-slot.mjs), which owns the composition: keyed per-owner entries
// in a null-prototype holder on globalThis, summed by one reader. That makes
// the composition symmetric and idempotent BY CONSTRUCTION — either load
// order sums both counts, repeated loads replace (never stack) their own
// entry, and a broken or foreign previous owner reads as 0 instead of
// masking this watcher's count.
publishKeepOpenCount("tuicr", (): number => (watch ? 1 : 0));

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
	clearInterval(watch.timer as ReturnType<typeof setInterval>);
	if (watch.firstTick) clearTimeout(watch.firstTick);
	watch = null;
	notify(`tuicr background watcher stopped: ${reason}`, "info");
}

function deliver(pi: ExtensionAPI, state: WatchState, final: boolean) {
	const batch = newComments(new Set(), state.pending, replyIds);
	state.pending = [];
	if (!final && batch.length === 0) return;
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

/**
 * Stop the watcher and deliver the final `tuicr_review_comments` steer so the
 * hosting session (a parked tuicr-review subagent, or the captain chat) wakes,
 * wraps up, and — for the subagent — can auto-exit. Every watcher death the
 * host did not cause itself goes through here.
 */
function stopWatchWithFinalSteer(
	pi: ExtensionAPI,
	state: WatchState,
	reason: string,
	content: string,
) {
	stopWatch(reason);
	pi.sendMessage(
		{
			customType: "tuicr_review_comments",
			content,
			display: true,
			details: { repo: state.repo, slug: state.slug, final: true, count: 0 },
		},
		{ triggerTurn: true, deliverAs: "steer" },
	);
}

async function tick(pi: ExtensionAPI, state: WatchState) {
	if (state.ticking || repliesInFlight > 0) return;
	state.ticking = true;
	try {
		if (!state.slug) {
			if (Date.now() > state.slugResolveDeadline) {
				stopWatchWithFinalSteer(
					pi,
					state,
					`no tuicr session became active for ${state.repo}`,
					`tuicr background watcher gave up: no review session became active for ${state.repo}. The pane may have failed to launch — check it, or ask the user to start tuicr manually and re-run tuicr.`,
				);
				return;
			}
			// The requested target resolves ambiguity: a PR target matches its
			// `/pr/<N>` session, and a launch attaches to the session that
			// appeared after it — never to one that was already active.
			const prTarget = state.target?.type === "pr" ? state.target.pr ?? null : null;
			const resolved = resolveLaunchedSession({
				sessions: await listSessions(state.repo),
				baselineSlugs: state.baselineSlugs,
				pr: prTarget,
			});
			if (resolved.status === "ok") {
				state.slug = resolved.session.slug;
				state.everActive = true;
				// Baseline whatever the user already wrote before we attached.
				state.seen = collectSeenKeys(await fetchComments(state.repo, state.slug));
				notify(`tuicr background watcher attached to ${state.slug}`, "info");
			} else if (resolved.status === "ambiguous") {
				const slugs = resolved.sessions
					.map((session) => `  ${(session as { slug?: string })?.slug}`)
					.join("\n");
				const which = state.target?.type === "pr" ? ` for PR ${state.target.pr}` : "";
				stopWatchWithFinalSteer(
					pi,
					state,
					"multiple active tuicr sessions; pass a session slug",
					`tuicr background watcher stopped: several possible tuicr sessions are active under ${state.repo}${which}, so it cannot tell which one to watch:\n${slugs}\nAsk the user which session holds this review, then re-attach with the tuicr tool and that sessionSlug. If the user cannot say, summarize the review so far and stop.`,
				);
				return;
			}
			return;
		}

		const comments = await fetchComments(state.repo, state.slug);
		const fresh = newComments(state.seen, comments, replyIds);
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

		// An add can persist before its CLI process returns the id. Wait until
		// replies are tracked before flushing any concurrently fetched batch.
		if (repliesInFlight > 0) return;
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
			const detail = error instanceof Error ? error.message : error;
			const missed = newComments(new Set(), state.pending, replyIds);
			state.pending = [];
			const missedLines = missed.length > 0
				? ` ${missed.length} fetched comment(s) were never delivered:\n${truncateLines(missed.map(formatCommentLine), 40).join("\n")}`
				: "";
			stopWatchWithFinalSteer(
				pi,
				state,
				`repeated tuicr CLI failures: ${detail}`,
				`tuicr background watcher stopped: the tuicr CLI kept failing for ${state.repo}${state.slug ? ` (session ${state.slug})` : ""} — ${detail}. Tell the user the CLI is unavailable, summarize the review so far, and stop.${missedLines}`,
			);
		}
	} finally {
		state.ticking = false;
	}
}

function startWatch(
	pi: ExtensionAPI,
	repo: string,
	slug: string | null,
	seen: Set<string>,
	opts: { target?: ReviewTarget | null; baselineSlugs?: string[] } = {},
) {
	if (watch) stopWatch("replaced by a new tuicr launch");
	const state: WatchState = {
		repo,
		target: opts.target ?? null,
		baselineSlugs: opts.baselineSlugs ?? [],
		slug,
		seen,
		pending: [],
		lastDeliveredAt: null,
		timer: null,
		firstTick: null,
		ticking: false,
		everActive: slug !== null,
		slugResolveDeadline: Date.now() + LAUNCH_WAIT_MS * 3,
		consecutiveErrors: 0,
	};
	state.timer = setInterval(() => void tick(pi, state), POLL_MS);
	watch = state;
	// First tick soon so early comments are not missed while the TUI warms up.
	// Cleared by stopWatch so a stopped watcher never ticks again.
	state.firstTick = setTimeout(() => void tick(pi, state), Math.min(2_000, POLL_MS));
}

// ── Launch / attach ──

async function resolveRepo(input: string | undefined, fallback: string): Promise<string> {
	const candidate = input ?? fallback;
	const { stdout } = await execFile("git", ["-C", candidate, "rev-parse", "--show-toplevel"], {
		timeout: 5_000,
	}).catch(() => ({ stdout: candidate }));
	return stdout.trim() || candidate;
}

/** Current branch of the repo ("" when detached or git fails). */
async function gitCurrentBranch(repo: string): Promise<string> {
	const { stdout } = await execFile("git", ["-C", repo, "branch", "--show-current"], {
		timeout: 5_000,
	}).catch(() => ({ stdout: "" }));
	return String(stdout).trim();
}

/** Open PRs whose head is the given branch ([] when gh fails). */
async function ghOpenPrsForBranch(
	repo: string,
	branch: string,
): Promise<{ number: number; title: string }[]> {
	const { stdout } = await execFile(
		"gh",
		["pr", "list", "--head", branch, "--state", "open", "--json", "number,title"],
		{ timeout: CLI_TIMEOUT_MS, cwd: repo },
	).catch(() => ({ stdout: "[]" }));
	try {
		const parsed = JSON.parse(String(stdout));
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((entry) => Number.isInteger((entry as { number?: unknown })?.number))
			.map((entry) => ({
				number: Number((entry as { number: number }).number),
				title: String((entry as { title?: string })?.title ?? ""),
			}));
	} catch {
		return [];
	}
}

/**
 * Inputs for resolveTargetSession: the repo-scoped session list, plus the
 * current branch and its open PRs when the call carries no target (the
 * bare default resolves the worktree's open PR first). git/gh failures and
 * a detached HEAD fall back to no open PRs → working-tree review.
 */
async function resolveTargetInputs(
	params: { scope?: string; revset?: string; pr?: number; sessionSlug?: string },
	repo: string,
	sessions: unknown[],
): Promise<{ repo: string; sessions: unknown[]; currentBranch?: string | null; openPrs?: unknown[] }> {
	if (classifyReviewRequest(params) !== "default") return { repo, sessions };
	const branch = await gitCurrentBranch(repo);
	return {
		repo,
		sessions,
		currentBranch: branch || null,
		openPrs: branch ? await ghOpenPrsForBranch(repo, branch) : [],
	};
}

/** Resolve the request target, mapping validation throws to tool errors. */
async function resolveReviewDecision(
	params: { repo?: string; scope?: string; revset?: string; pr?: number; sessionSlug?: string },
	cwd: string,
): Promise<{ repo: string; sessions: unknown[]; decision: ReturnType<typeof resolveTargetSession> }> {
	const repo = await resolveRepo(params.repo, cwd);
	const sessions = await listSessions(repo);
	const inputs = await resolveTargetInputs(params, repo, sessions);
	let decision;
	try {
		decision = resolveTargetSession(params, inputs);
	} catch (error) {
		throw new TuicrBackgroundError(error instanceof Error ? error.message : String(error));
	}
	if (decision.status === "error") throw new TuicrBackgroundError(decision.message);
	return { repo, sessions, decision };
}

async function startTuicrBackground(
	pi: ExtensionAPI,
	params: {
		repo?: string;
		scope?: string;
		revset?: string;
		pr?: number;
		sessionSlug?: string;
		attachOnly?: boolean;
	},
	cwd: string,
	opts: { watcher?: boolean } = {},
): Promise<{ message: string; slug: string | null; attached: boolean; repo: string }> {
	const startWatcher = opts.watcher !== false;
	// The requested target always wins — never "the only active session"
	// (#289). Invalid scope/pr/revset fail fast as tool errors.
	const { repo, sessions, decision } = await resolveReviewDecision(params, cwd);
	const target = decision.target as ReviewTarget;

	if (decision.status === "ok") {
		const slug = decision.session.slug as string;
		if (startWatcher) {
			const seen = collectSeenKeys(await fetchComments(repo, slug));
			startWatch(pi, repo, slug, seen, { target });
		}
		return { message: formatLaunchResult({ repo, slug, attached: true }), slug, attached: true, repo };
	}

	// attachOnly (strict attach for debugging and resumed reviewers): never
	// open a pane from this session — the tuicr-review subagent normally
	// launches the pane in its own tab.
	if (params.attachOnly) {
		throw new TuicrBackgroundError(
			`No active tuicr session for ${describeReviewTarget(target)} under ${repo}. Retry shortly; do not launch one.`,
		);
	}

	// Launch: the wrapper spawns detached (it still owns pane creation,
	// quoting, and pane cleanup on exit — we simply never wait) and splits
	// the pane this process runs in, so a subagent caller gets the pane
	// beside it, inside its own tab.
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
	// Baseline the sessions active now: the watcher treats only sessions
	// that appear after this point (or the target's own match) as ours.
	const baselineSlugs = activeSlugs(sessions);
	const child = spawn(wrapperPath, buildWrapperArgs({ repo, tuicrArgs: targetToScopeArgs(target) }), {
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
	// the slug; the watcher resolves it later if we time out here. Poll before
	// sleeping so an already-registered session needs no wait, and keep the
	// sleep within the wait budget.
	const prTarget = target.type === "pr" ? target.pr ?? null : null;
	const deadline = Date.now() + LAUNCH_WAIT_MS;
	let slug: string | null = null;
	while (!slug) {
		const retry = resolveLaunchedSession({
			sessions: await listSessions(repo),
			baselineSlugs,
			pr: prTarget,
		});
		if (retry.status === "ok") slug = retry.session.slug as string;
		else if (retry.status === "ambiguous" || Date.now() > deadline) break;
		else await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, LAUNCH_WAIT_MS)));
	}

	// Start the watcher even when the slug has not resolved yet: it keeps
	// resolving (by target match or baseline diff) until its deadline,
	// matching the result message's promise that the watcher picks it up.
	if (startWatcher) {
		const seen = slug ? collectSeenKeys(await fetchComments(repo, slug)) : new Set<string>();
		startWatch(pi, repo, slug, seen, { target, baselineSlugs });
	}
	return {
		message: formatLaunchResult({ repo, slug, attached: false, pending: startWatcher }),
		slug,
		attached: false,
		repo,
	};
}

// ── Subagent review flow ──

/**
 * Spawn the tuicr-review subagent that owns the review. The parent opens no
 * pane and starts no watcher: the subagent launches the pane itself (inside
 * its own tab) with the internal tuicr tool — or attaches, when the target
 * resolves to an already-active session — and answers the user's comments
 * in the TUI until its final summary steers back.
 */
async function startTuicrReview(
	pi: ExtensionAPI,
	params: { repo?: string; scope?: string; revset?: string; pr?: number; sessionSlug?: string },
	cwd: string,
	ctx: { cwd: string; ui: unknown },
): Promise<{
	message: string;
	repo: string;
	targetKey: string;
	reviewer: string;
	slug: string | null;
}> {
	const spawnFn = (globalThis as any).__pi_interactive_subagents?.executeSubagent;
	if (typeof spawnFn !== "function") {
		throw new TuicrBackgroundError(
			"interactive-subagents is not loaded, so the tuicr-review subagent cannot spawn. Attach a watcher with the plain tuicr tool instead.",
		);
	}
	const { repo, decision } = await resolveReviewDecision(params, cwd);
	const target = decision.target as ReviewTarget;
	const slug = decision.status === "ok" ? (decision.session.slug as string) : null;

	// One reviewer per review TARGET: a second watcher on the same session
	// would double-answer every comment batch, while a different target runs
	// concurrently in its own tab with its own pane.
	const key = reviewTargetKey(target, repo);
	const running = spawnedReviewers.get(key);
	if (running && reviewerRunning(running)) {
		throw new TuicrBackgroundError(
			`A tuicr-review subagent ("${running}") is already handling the review of ${describeReviewTarget(target)} in ${repo}. ` +
				"If the TUI is still open, keep commenting there — it replies inside it. " +
				"Otherwise wait for its summary, then re-run tuicr_review. " +
				"A different target (another PR or commit range) can still be reviewed concurrently.",
		);
	}
	const task = buildReviewSubagentTask({ repo, slug, target });
	// A same-repo watcher in the parent chat would double-steer every comment
	// batch; the subagent owns the TUI conversation while it runs.
	if (watch && watch.repo === repo) stopWatch("replaced by a tuicr_review subagent");
	const requestedName = reviewerSubagentName(target, repo);
	const result = await spawnFn({ agent: "tuicr-review", name: requestedName, task, cwd: repo }, ctx);
	const text = (result?.content ?? [])
		.filter((part: { type: string }) => part.type === "text")
		.map((part: { text: string }) => part.text)
		.join("\n");
	if (result?.details?.error || result?.isError) {
		throw new TuicrBackgroundError(text || result?.details?.error || "tuicr-review subagent failed to spawn.");
	}
	// Collisions (two live reviewers whose targets sanitize identically) are
	// uniquified by interactive-subagents; track the ACTUAL name it reports.
	const reviewerName =
		typeof result?.details?.name === "string" && result.details.name ? result.details.name : requestedName;
	spawnedReviewers.set(key, reviewerName);
	return {
		message:
			formatReviewLaunchResult({ repo, target, slug, subagent: reviewerName }) +
			(text ? `\n${text}` : ""),
		repo,
		targetKey: key,
		reviewer: reviewerName,
		slug,
	};
}

// ── Registration ──

// eslint-disable-next-line @typescript-eslint/no-use-before-define -- execute runs only after the factory sets piRef
const tuicrBackgroundTool = defineTool({
	name: "tuicr",
	label: "Launch the tuicr pane and attach the comment watcher",
	description:
		"INTERNAL — the comment watcher. Launch the tuicr review pane in THIS session's own tab (splitting this pane) and attach the watcher, or attach to the active session matching the requested target. Comments then steer into THIS session as tuicr_review_comments messages. The tuicr-review subagent uses this tool to open the review pane in its own tab; a captain opening a review for the user should call tuicr_review instead. With attachOnly, never open a pane — fail while no session matches the requested target.",
	promptSnippet: "Launch the tuicr pane in this session's tab and attach the comment watcher",
	promptGuidelines: [
		"Prefer tuicr_review when opening a review for the user; plain tuicr is the internal watcher (it can also launch the pane in this session's own tab).",
		"The requested target is always honored: an explicit pr attaches only to that PR's active session (slug ending /pr/<N>) or launches a pane for it — never to an unrelated session. A bare call resolves the current branch's open PR (exactly one → that PR; none → working tree; several → error asking for pr).",
		"tuicr returns immediately; user review comments arrive later as tuicr_review_comments steer messages.",
		"Only one watcher runs per session — a second launch replaces the first.",
		"With attachOnly true, never launch a pane: report the failure so the caller can retry.",
	],
	parameters: Type.Object({
		repo: Type.Optional(
			Type.String({ description: "Repository directory. Defaults to the session working directory." }),
		),
		scope: Type.Optional(
			Type.Union([Type.Literal("working-tree"), Type.Literal("revset"), Type.Literal("pr")], {
				description:
					"Review target: 'pr', 'revset', or 'working-tree'. Omit to resolve the current branch's open PR (exactly one → that PR; none → working tree; several → error asking for pr).",
				}),
		),
		revset: Type.Optional(
			Type.String({ description: "Commit range to review (required when scope is 'revset')." }),
		),
		pr: Type.Optional(
			Type.Integer({ minimum: 1, description: "Pull request number (required when scope is 'pr')." }),
		),
		sessionSlug: Type.Optional(
			Type.String({
				description:
					"Attach to this specific tuicr session slug (from `tuicr review list`) instead of launching a new pane.",
			}),
		),
		attachOnly: Type.Optional(
			Type.Boolean({
				description:
					"Never launch a pane; fail while no session matches the requested target. Strict attach for debugging and resumed reviewers — the tuicr-review subagent normally launches the pane in its own tab.",
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

const tuicrReviewTool = defineTool({
	name: "tuicr_review",
	label: "Spawn the tuicr-review subagent for a review target",
	description:
		"Open a tuicr code review (working tree, a commit range, or a GitHub PR by number) by spawning the tuicr-review subagent. The requested target is always honored — an explicit PR attaches to that PR's session or opens a pane for it, never to an unrelated session. The SUBAGENT opens the tuicr pane inside its own tab, receives the user's comments, answers each one INSIDE the TUI with tuicr_reply, applies fixes for actionable comments, and when the user closes the TUI its summary of every comment and fix steers back to this session. A bare call with no target reviews the current branch's open PR (exactly one) or the working tree. Then ask the user whether to merge or review later. This is the preferred way to open any code review — never run a tuicr wrapper script through bash.",
	promptSnippet: "Spawn the tuicr-review subagent; it opens the pane in its own tab and answers comments",
	promptGuidelines: [
		"Use tuicr_review as the default way to open a code review — working tree, revset, or PR number.",
		"One reviewer per review target: a second tuicr_review for the SAME target is refused — tell the user to keep commenting in the open TUI or wait for its summary. Different targets (another PR or range) run concurrently, each in its own tab with its own pane.",
		"With no scope/pr, the current branch's open PR is reviewed when exactly one is open; several open PRs error asking for pr explicitly.",
		"While the tuicr-review subagent runs, do not reply to review comments yourself; the subagent owns the TUI conversation.",
		"When the tuicr-review subagent result arrives, give the user its summary and ask via ask_user_question whether to merge the branch or review later.",
	],
	parameters: Type.Object({
		repo: Type.Optional(
			Type.String({ description: "Repository directory. Defaults to the session working directory." }),
		),
		scope: Type.Optional(
			Type.Union([Type.Literal("working-tree"), Type.Literal("revset"), Type.Literal("pr")], {
				description:
				"Review target: 'pr', 'revset', or 'working-tree'. Omit to resolve the current branch's open PR (exactly one → that PR; none → working tree; several → error asking for pr).",
			}),
		),
		revset: Type.Optional(
			Type.String({ description: "Commit range to review (required when scope is 'revset')." }),
		),
		pr: Type.Optional(
			Type.Integer({ minimum: 1, description: "Pull request number (required when scope is 'pr')." }),
		),
		sessionSlug: Type.Optional(
			Type.String({
				description: "Run the review against this active session instead of opening a new pane.",
			}),
		),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		latestUi = ctx.ui;
		try {
			const result = await startTuicrReview(piRef!, params, ctx.cwd, ctx);
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

const tuicrReplyTool = defineTool({
	name: "tuicr_reply",
	label: "Reply in tuicr",
	description: "Reply to user review comments inside tuicr as pi-agent. Posts the full response with a visible Re: reference; the chat shows only its leading line. Never use for preemptive self-review comments.",
	promptSnippet: "Answer user review comments in tuicr",
	promptGuidelines: [
		"Use tuicr_reply to answer user review comments so responses appear in tuicr; never post preemptive self-review comments.",
		"Put the full response text in message. The chat row shows the leading line only.",
		"Supply replyTo from tuicr review comments when known, and file/line for a human-visible anchor. Replies use a Re: prefix because tuicr has no threading flag.",
	],
	parameters: Type.Object({
		message: Type.String({ minLength: 1, description: "Full response text to post in tuicr." }),
		file: Type.Optional(Type.String({ minLength: 1, description: "File to anchor the reply to." })),
		line: Type.Optional(Type.Integer({ minimum: 1, description: "Line anchor; requires file." })),
		replyTo: Type.Optional(Type.String({ minLength: 1, description: "User comment id being answered." })),
		sessionSlug: Type.Optional(Type.String({ minLength: 1, description: "Defaults to the watcher's session, or the only active session under cwd." })),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		repliesInFlight += 1;
		try {
			return await postTuicrReply(params, { cwd: ctx.cwd, watch, execFile, signal, replyIds });
		} finally {
			repliesInFlight -= 1;
		}
	},
	renderShell: "self",
	renderCall(args, theme) {
		return {
			render: (width: number) => formatReplyCall(args, theme).split("\n").map((line: string) => truncateToWidth(line, width)),
			invalidate() {},
		};
	},
	renderResult(result, _options, theme, context) {
		return {
			render: (width: number) => formatReplyResult({ ...result, isError: context?.isError }, theme).split("\n").map((line: string) => truncateToWidth(line, width)),
			invalidate() {},
		};
	},
});

export default function tuicrBackground(pi: ExtensionAPI) {
	piRef = pi;

	pi.registerTool(tuicrBackgroundTool);
	pi.registerTool(tuicrReviewTool);
	pi.registerTool(tuicrReplyTool);

	pi.registerCommand("tuicr", {
		description:
			"Open a tuicr review with the tuicr-review subagent: /tuicr [open] [pr <N> | -r <revset> | -w] [repo]. " +
			"A bare /tuicr reviews the current branch's open PR (or the working tree when none is open). " +
			"'watch' runs the internal chat-watcher instead; 'stop' stops it.",
		handler: async (args, ctx) => {
			latestUi = ctx.ui;
			let parsed;
			try {
				parsed = parseTuicrCommandArgs(args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			if (parsed.action === "stop") {
				if (!watch) {
					ctx.ui.notify("No tuicr background watcher is running.", "info");
					return;
				}
				stopWatch("stopped by /tuicr stop");
				return;
			}
			const params = {
				repo: parsed.repo,
				scope: parsed.scope,
				revset: parsed.revset,
				pr: parsed.pr,
			};
			try {
				const result =
					parsed.action === "watch"
						? await startTuicrBackground(piRef!, params, ctx.cwd)
						: await startTuicrReview(piRef!, params, ctx.cwd, ctx);
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
