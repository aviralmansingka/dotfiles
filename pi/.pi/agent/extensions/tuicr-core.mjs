/**
 * Pure logic for the tuicr extension.
 *
 * The extension solves two problems with asking an agent to open tuicr:
 *   1. The multiplexer wrapper scripts (tmux/Zellij/Herdr) block until the
 *      TUI exits, parking the agent for the whole review. We spawn the
 *      wrapper detached instead, so the pane opens (splitting the caller's
 *      own pane — the wrapper inherits the caller's HERDR_PANE_ID) but the
 *      tool returns.
 *   2. There is no push channel from tuicr to the agent. We poll
 *      `tuicr review comments` and steer new comments back into the session
 *      (`pi.sendMessage(..., { triggerTurn: true, deliverAs: "steer" })`).
 *
 * Review targets are honored exactly (see resolveReviewTarget): a request
 * never silently attaches to an unrelated active session.
 *
 * Kept free of pi imports so it can be unit-tested with plain `node`.
 */

/** Multiplexer detection, innermost-first (mirrors the tuicr skill). */
export const WRAPPER_MARKERS = [
	{ kind: "cmux", marker: "CMUX_WORKSPACE_ID", script: "tuicr-wrapper-cmux.sh" },
	{ kind: "tmux", marker: "TMUX", script: "tuicr-wrapper.sh" },
	{ kind: "zellij", marker: "ZELLIJ", script: "tuicr-wrapper-zellij.sh" },
	{ kind: "herdr", marker: "HERDR_ENV", script: "tuicr-wrapper-herdr.sh" },
];

/** Pick the wrapper script for the current multiplexer, or null. */
export function selectWrapper(env = process.env) {
	for (const { marker, script } of WRAPPER_MARKERS) {
		if (env[marker]) return script;
	}
	return null;
}

/** Directory holding the tuicr skill's wrapper scripts. */
export function resolveSkillDir(env = process.env) {
	return env.TUICR_SKILL_DIR ?? `${env.HOME ?? ""}/.agents/skills/tuicr`;
}

/** Translate the tool's scope enum into tuicr passthrough args. */
export function scopeToTuicrArgs(scope, revset, prNumber) {
	if (scope === "working-tree") return ["-w"];
	if (scope === "revset") {
		const trimmed = typeof revset === "string" ? revset.trim() : "";
		if (trimmed === "") {
			throw new Error("revset is required when scope is 'revset'");
		}
		return ["-r", trimmed];
	}
	if (scope === "pr") {
		const n = Number(prNumber);
		if (!Number.isInteger(n) || n < 1) {
			throw new Error("pr is required and must be a positive integer when scope is 'pr'");
		}
		return ["pr", String(n)];
	}
	throw new Error(`Unknown scope: ${scope}`);
}

/**
 * Parse `/tuicr` command text.
 *
 * Grammar:
 *   /tuicr [open] [pr <N> | -r <revset> | -w] [repo-directory]   → subagent review flow (default)
 *   /tuicr watch [pr <N> | -r <revset> | -w] [repo-directory]     → internal chat-watcher mode
 *   /tuicr stop                                                  → stop the watcher
 *
 * `open` is the default action and may be omitted (`/tuicr pr 272`). A bare
 * call carries no scope: the target resolution treats it as "the current
 * branch's open PR, else the working tree".
 *
 * @returns {{ action: "open" | "watch", scope?: string, revset?: string, pr?: number, repo?: string } | { action: "stop" }} Parsed command; scope/revset/pr/repo are present only when given.
 */
export function parseTuicrCommandArgs(raw) {
	const tokens = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { action: "open" };
	if (tokens[0] === "stop") return { action: "stop" };

	const parsed = { action: "open", scope: undefined, revset: undefined, pr: undefined, repo: undefined };
	const rest = [...tokens];
	if (rest[0] === "open" || rest[0] === "watch") parsed.action = rest.shift();

	while (rest.length > 0) {
		const token = rest.shift();
		if (token === "pr") {
			const value = Number(rest.shift());
			if (!Number.isInteger(value) || value < 1) {
				throw new Error(`Usage: /tuicr ${parsed.action} pr <number> — expected a positive PR number`);
			}
			parsed.scope = "pr";
			parsed.pr = value;
		} else if (token === "-r" || token === "--revset") {
			const value = rest.shift();
			if (!value || value.startsWith("-")) {
				throw new Error(`Usage: /tuicr ${parsed.action} -r <revset>`);
			}
			parsed.scope = "revset";
			parsed.revset = value;
		} else if (token === "-w") {
			parsed.scope = "working-tree";
		} else if (!token.startsWith("-") && parsed.repo === undefined) {
			parsed.repo = token;
		} else {
			throw new Error(`Unknown /tuicr argument: ${token}`);
		}
	}
	// Omit unset keys so deepStrictEqual comparisons stay shape-stable.
	const result = { action: parsed.action };
	if (parsed.scope !== undefined) result.scope = parsed.scope;
	if (parsed.revset !== undefined) result.revset = parsed.revset;
	if (parsed.pr !== undefined) result.pr = parsed.pr;
	if (parsed.repo !== undefined) result.repo = parsed.repo;
	return result;
}

/**
 * Arguments handed to the wrapper script: `[repo] -- <tuicr args>`.
 * The scope is always passed explicitly so the user never has to pick
 * staged/unstaged/commit-range manually inside the TUI.
 */
export function buildWrapperArgs({ repo, tuicrArgs }) {
	if (!repo || typeof repo !== "string") throw new Error("repo is required");
	return [repo, "--", ...tuicrArgs];
}

/** Parse `tuicr review list` output (a JSON array of sessions). */
export function parseSessionList(stdout) {
	const data = JSON.parse(stdout);
	if (!Array.isArray(data)) {
		throw new Error(`Unexpected tuicr review list payload: ${typeof data}`);
	}
	return data;
}

export function activeSessions(sessions) {
	return sessions.filter((session) => session?.active === true);
}

/**
 * Resolve a review request into an action, honoring the requested target —
 * never silently attaching to an unrelated active session (#289:
 * tuicr_review pr:287 attached to PR-288's session). Consolidated from the
 * two #289 fixes: our explicit-target statuses plus main's decision matrix.
 * Pure: the caller supplies the `tuicr review list` sessions and, for a bare
 * call with no target, the current branch and its open PRs (git/gh results
 * injected by the caller).
 *
 * Rules:
 *   1. explicit sessionSlug → attach to exactly that session (missing →
 *      error); a slug ending in `/pr/<N>` also keys the review by that PR.
 *   2. explicit PR → attach only to an active session whose slug ends with
 *      `/pr/<N>` (two matches → error); none matches → launch for that PR.
 *   3. explicit revset → launch a new pane for the range.
 *   4. explicit working tree → launch a new pane with -w, even while other
 *      sessions are active.
 *   5. no target → the current branch's open PRs: exactly one → that PR
 *      (match-or-launch as above); none → working-tree launch; several →
 *      error listing them, asking for `pr` explicitly.
 *
 * @returns one of
 *   { status: "ok", session, target }   → attach to that session
 *   { status: "launch", target }        → launch a new pane for the target
 *   { status: "error", message }        → refuse, with an actionable message
 * where target is { type: "pr", pr } | { type: "revset", revset } |
 * { type: "working-tree" } | { type: "slug", slug }.
 */
export function resolveTargetSession(
	params = {},
	{ repo = "", sessions = [], currentBranch = null, openPrs = [] } = {},
) {
	const kind = classifyReviewRequest(params);
	if (kind === "session") {
		const slug = String(params.sessionSlug);
		const picked = pickSession(sessions, slug);
		if (picked.status === "missing") {
			return {
				status: "error",
				message: `No tuicr session named ${slug} under ${repo}. Run \`tuicr review list --repo ${repo}\` for valid slugs.`,
			};
		}
		const sessionSlug = picked.session.slug;
		const pr = prSessionNumber(sessionSlug);
		return {
				status: "ok",
				session: picked.session,
				target: pr ? { type: "pr", pr } : { type: "slug", slug: sessionSlug },
			};
	}
	if (kind === "pr") return prMatchOrLaunch(requirePrNumber(params.pr), repo, sessions);
	if (kind === "revset") {
		return { status: "launch", target: { type: "revset", revset: requireRevset(params.revset) } };
	}
	if (kind === "working-tree") {
		return { status: "launch", target: { type: "working-tree" } };
	}
	// Bare call with no target: resolve the current worktree's open PR first.
	const prs = Array.isArray(openPrs) ? openPrs : [];
	if (prs.length === 1) return prMatchOrLaunch(requirePrNumber(prs[0]?.number), repo, sessions);
	if (prs.length > 1) {
		const listed = prs
			.map((entry) => `  #${entry?.number} ${entry?.title ?? ""}`.trimEnd())
			.join("\n");
		return {
			status: "error",
			message: `Several open PRs for branch ${currentBranch ?? "(unknown)"} under ${repo}:\n${listed}\nPass pr explicitly to choose which one to review.`,
		};
	}
	return { status: "launch", target: { type: "working-tree" } };
}

/**
 * Resolve which session to watch.
 * - explicit slug → that session, or `missing`
 * - exactly one active → it
 * - none active → `none`
 * - several active → `ambiguous` (caller must ask)
 */
export function pickSession(sessions, slug) {
	if (slug) {
		const found = sessions.find((session) => session?.slug === slug);
		return found ? { status: "ok", session: found } : { status: "missing", slug };
	}
	const active = activeSessions(sessions);
	if (active.length === 0) return { status: "none" };
	if (active.length === 1) return { status: "ok", session: active[0] };
	return { status: "ambiguous", sessions: active };
}

/** Slugs of the currently active sessions, in list order. */
export function activeSlugs(sessions) {
	return activeSessions(sessions)
		.map((session) => session?.slug)
		.filter((slug) => typeof slug === "string");
}

/** PR number encoded at the end of a tuicr session slug (`…/pr/<N>`), or null. */
export function prSessionNumber(slug) {
	const match = /\/pr\/(\d+)$/.exec(String(slug ?? ""));
	return match ? Number(match[1]) : null;
}

function requirePrNumber(pr) {
	const n = Number(pr);
	if (!Number.isInteger(n) || n < 1) {
		throw new Error("pr is required and must be a positive integer when scope is 'pr'");
	}
	return n;
}

function requireRevset(revset) {
	const trimmed = typeof revset === "string" ? revset.trim() : "";
	if (trimmed === "") throw new Error("revset is required when scope is 'revset'");
	return trimmed;
}

/**
 * Which resolution rule applies to a review request.
 * - "session" — explicit sessionSlug: attach to exactly that session.
 * - "pr" / "revset" / "working-tree" — an explicit target.
 * - "default" — no target given: resolve the current branch's open PR.
 */
export function classifyReviewRequest({ scope, sessionSlug } = {}) {
	if (sessionSlug) return "session";
	if (scope === undefined || scope === null) return "default";
	if (scope === "pr" || scope === "revset" || scope === "working-tree") return scope;
	throw new Error(`Unknown scope: ${scope}`);
}

function prMatchOrLaunch(pr, repo, sessions) {
	const matching = activeSessions(sessions).filter(
		(session) => prSessionNumber(session?.slug) === pr,
	);
	if (matching.length === 1) {
		return { status: "ok", session: matching[0], target: { type: "pr", pr } };
	}
	if (matching.length > 1) {
		const listed = matching.map((session) => `  ${session?.slug}`).join("\n");
		return {
			status: "error",
			message: `Multiple active tuicr sessions for PR ${pr} under ${repo}:\n${listed}\nPass sessionSlug to choose one.`,
		};
	}
	return { status: "launch", target: { type: "pr", pr } };
}

/**
 * Resolve which session a just-launched pane created. The requested target
 * wins: with a PR target, an active session whose slug ends with `/pr/<N>`
 * is ours no matter how many other sessions are active. Otherwise the first
 * session that became active after launch (not in the baseline snapshot of
 * active slugs) is ours. None yet → `wait`; several → `ambiguous`.
 */
export function resolveLaunchedSession({ sessions, baselineSlugs = [], pr = null }) {
	if (pr != null) {
		const matching = activeSessions(sessions).filter(
			(session) => prSessionNumber(session?.slug) === pr,
		);
		if (matching.length === 1) return { status: "ok", session: matching[0] };
		if (matching.length > 1) return { status: "ambiguous", sessions: matching };
		return { status: "wait" };
	}
	const baseline = new Set(baselineSlugs);
	const fresh = activeSessions(sessions).filter((session) => !baseline.has(session?.slug));
	if (fresh.length === 1) return { status: "ok", session: fresh[0] };
	if (fresh.length > 1) return { status: "ambiguous", sessions: fresh };
	return { status: "wait" };
}

/** Human-readable name for a review target. */
export function describeReviewTarget(target) {
	switch (target?.type) {
		case "pr": return `PR ${target.pr}`;
		case "revset": return `commit range ${target.revset}`;
		case "working-tree": return "the working tree";
		case "slug": return `session ${target.slug}`;
		default: throw new Error(`Unknown review target type: ${target?.type}`);
	}
}

/** Registry key: one spawned reviewer per review target. */
export function reviewTargetKey(target, repo) {
	switch (target?.type) {
		case "pr": return `pr:${target.pr}`;
		case "revset": return `rev:${target.revset}`;
		case "working-tree": return `wt:${repo}`;
		case "slug": return `slug:${target.slug}`;
		default: throw new Error(`Unknown review target type: ${target?.type}`);
	}
}

function nameToken(value) {
	const token = String(value ?? "")
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return token || "t";
}

function dirBasename(path) {
	return String(path ?? "").split("/").filter(Boolean).pop() ?? "";
}

/**
 * Deterministic subagent name for a review target. Collisions (two reviews
 * of targets that sanitize identically) are uniquified upstream by
 * interactive-subagents; the spawn ack carries the actual name back.
 */
export function reviewerSubagentName(target, repo) {
	switch (target?.type) {
		case "pr": return `tuicr-review-pr-${target.pr}`;
		case "revset": return `tuicr-review-rev-${nameToken(target.revset)}`;
		case "working-tree": return `tuicr-review-wt-${nameToken(dirBasename(repo))}`;
		case "slug": return `tuicr-review-slug-${nameToken(target.slug)}`;
		default: throw new Error(`Unknown review target type: ${target?.type}`);
	}
}

/** Tuicr passthrough args for a resolved review target. */
export function targetToScopeArgs(target) {
	if (target?.type === "pr") return scopeToTuicrArgs("pr", undefined, target.pr);
	if (target?.type === "revset") return scopeToTuicrArgs("revset", target.revset, undefined);
	if (target?.type === "working-tree") return scopeToTuicrArgs("working-tree", undefined, undefined);
	throw new Error(`Unknown review target type: ${target?.type}`);
}

/** Stable identity for a comment (falls back to a composite key). */
export function commentKey(comment) {
	if (comment?.id !== undefined && comment?.id !== null) return String(comment.id);
	return [
		comment?.path ?? "",
		comment?.start_line ?? "",
		comment?.end_line ?? "",
		comment?.content ?? "",
	].join("|");
}

export function collectSeenKeys(comments) {
	return new Set(comments.map(commentKey));
}

export const AGENT_USERNAME = "pi-agent";

/** Comments not yet seen; never steer our replies back as user feedback. */
export function newComments(seenKeys, comments, replyIds = new Set()) {
	return comments.filter((comment) => comment?.author !== AGENT_USERNAME &&
		!replyIds.has(commentKey(comment)) && !seenKeys.has(commentKey(comment)));
}

/**
 * Coalescing gate: deliver a pending batch only once the window since the
 * last delivery has elapsed, so a user typing comments one at a time does
 * not spawn a steer per comment. The final delivery (session ended) ignores
 * the gate and always flushes.
 */
export function shouldDeliverBatch({ pendingCount, lastDeliveredAt, now, coalesceMs }) {
	if (!Number.isFinite(pendingCount) || pendingCount <= 0) return false;
	if (lastDeliveredAt === null || lastDeliveredAt === undefined) return true;
	return now - lastDeliveredAt >= coalesceMs;
}

/** One-line rendering of a comment for steer content and the widget. */
export function formatCommentLine(comment) {
	const type = comment?.comment_type ?? "note";
	const range =
		comment?.start_line !== undefined && comment?.start_line !== null
			? comment.end_line && comment.end_line !== comment.start_line
				? `${comment.start_line}-${comment.end_line}`
				: `${comment.start_line}`
			: "";
	const location = comment?.path
		? `${comment.path}${range ? `:${range}` : ""}`
		: "review-level";
	const side = comment?.side ? ` (${comment.side})` : "";
	const firstLine = String(comment?.content ?? "").split("\n")[0] ?? "";
	return `- [${type}] ${location}${side}: ${firstLine}`;
}

export function truncateLines(lines, maxLines) {
	if (!Number.isFinite(maxLines) || maxLines < 0) return [...lines];
	if (lines.length <= maxLines) return [...lines];
	return [...lines.slice(0, maxLines), `… +${lines.length - maxLines} more`];
}

/** Parse `tuicr review comments` output (JSON array, or an object wrapper). */
export function parseCommentPayload(stdout) {
	const data = JSON.parse(stdout);
	if (Array.isArray(data)) return data;
	if (Array.isArray(data?.comments)) return data.comments;
	throw new Error(`Unexpected tuicr review comments payload: ${typeof data}`);
}

const COMMENT_TYPE_GUIDANCE =
	"Treat comment_type as: issue = fix first; suggestion = implement or explain why not; note = answer or acknowledge; praise = no action.";

/**
 * Steer message content for a batch of new comments. Written for the model:
 * it names the session, the repo, how to treat each comment type, and how to
 * fetch the full JSON. Comment bodies are truncated to one line each.
 */
export function formatSteerContent({ repo, slug, comments, final }) {
	const batch = Array.isArray(comments) ? comments : [];
	const lines = [];
	if (final) {
		lines.push(
			batch.length > 0
				? `tuicr review session ended (${slug}) with ${batch.length} new user comment(s):`
				: `tuicr review session ended (${slug}); no new comments were added.`,
		);
	} else {
		lines.push(`tuicr review feedback (${slug}): ${batch.length} new user comment(s).`);
	}
	if (batch.length > 0) {
		lines.push("");
		lines.push(...truncateLines(batch.map(formatCommentLine), 40));
		lines.push("");
		lines.push(COMMENT_TYPE_GUIDANCE);
	}
	lines.push(
		`Full JSON: tuicr review comments --repo ${repo} --session ${slug}`,
	);
	return lines.join("\n");
}

/** The transcript shows only the leading response line, never the full body. */
export function firstNonEmptyLine(message) {
	return String(message ?? "").split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function replyAnchor({ file, line, replyTo } = {}) {
	return file ? `${file}${line !== undefined ? `:${line}` : ""}`
		: replyTo ? `comment ${replyTo}` : "review comments";
}

/** tuicr has no thread/reply flag; a visible reference precedes the full body. */
export function buildReplyArgs({ repo, slug, message, file, line, replyTo }) {
	return [
		"review", "add", "--session", slug,
		...(slug.startsWith("gh:") ? [] : ["--repo", repo]),
		"--username", AGENT_USERNAME,
		...(file ? ["--target-file", file] : []),
		...(line !== undefined ? ["--line", String(line)] : []),
		"--", `Re: ${replyAnchor({ file, line, replyTo })}\n\n${message}`,
	];
}

/** Inject execFile so the actual CLI flow is testable without a live review. */
export async function postTuicrReply(params, { cwd, watch, execFile, signal, replyIds = new Set() }) {
	try {
		if (!firstNonEmptyLine(params.message)) throw new Error("Reply message must not be empty.");
		if (params.line !== undefined && (!params.file || !Number.isInteger(params.line) || params.line < 1)) {
			throw new Error("line must be a positive integer and requires file.");
		}
		const repo = watch?.slug && (!params.sessionSlug || params.sessionSlug === watch.slug) ? watch.repo : cwd;
		let slug = params.sessionSlug ?? watch?.slug;
		const run = async (args) => execFile("tuicr", args, { timeout: 15_000, signal });
		if (!slug) {
			const picked = pickSession(parseSessionList((await run(["review", "list", "--repo", repo])).stdout));
			if (picked.status === "ambiguous") {
				const slugs = picked.sessions.map((session) => `  ${session?.slug}`).join("\n");
				throw new Error(`Multiple active tuicr sessions under ${repo}:\n${slugs}\nPass sessionSlug to choose one.`);
			}
			if (picked.status !== "ok") throw new Error(`No active tuicr session under ${repo}. Start tuicr or pass sessionSlug.`);
			slug = picked.session.slug;
		}
		const comments = parseCommentPayload((await run([
			"review", "comments", "--session", slug, ...(slug.startsWith("gh:") ? [] : ["--repo", repo]),
		])).stdout);
		const userComments = newComments(new Set(), comments, replyIds);
		const targets = userComments.filter((comment) => params.replyTo
			? commentKey(comment) === params.replyTo
			: (!params.file || comment.path === params.file) && (params.line === undefined ||
				(comment.start_line <= params.line && params.line <= (comment.end_line ?? comment.start_line))));
		if (!targets.length) {
			throw new Error("No matching user review comment to reply to. Read tuicr review comments and supply its replyTo id; never post preemptive self-review comments.");
		}
		const { stdout } = await run(buildReplyArgs({ ...params, repo, slug }));
		// v0.24 omits authors from `review comments`; track the returned id so
		// our replies cannot trigger another user-feedback steer.
		const added = JSON.parse(stdout);
		if (added.id) replyIds.add(String(added.id));
		return {
			content: [{ type: "text", text: `Posted reply to session ${slug}; visible in tuicr.` }],
			details: { slug, file: params.file, line: params.line, replyTo: params.replyTo, posted: true,
				firstLine: firstNonEmptyLine(params.message) },
		};
	} catch (error) {
		const message = String(error?.stderr || error?.message || error).trim();
		return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
	}
}

export function formatReplyCall(args, theme) {
	return `${theme.fg("toolTitle", "◇ tuicr_reply")}\n` +
		` └─ ${theme.fg("toolTitle", "✎")} ${theme.fg("dim", `re: ${replyAnchor(args)} — `)}` +
		theme.fg("toolTitle", firstNonEmptyLine(args?.message));
}

export function formatReplyResult(result, theme) {
	const details = result.details ?? {};
	if (result.isError || details.error) {
		const message = details.error ?? result.content?.find((part) => part.type === "text")?.text;
		return ` └─ ${theme.fg("error", `✗ ${firstNonEmptyLine(message)}`)}`;
	}
	if (!details.posted) return theme.fg("dim", " └─ posting reply…");
	return ` ├─ ${theme.fg("toolTitle", "✎")} ${theme.fg("dim", `re: ${replyAnchor(details)} — `)}` +
		theme.fg("toolTitle", details.firstLine ?? "") + "\n" +
		` └─ ${theme.fg("success", "✓")} ${theme.fg("dim", `posted to session ${details.slug} · visible in tuicr`)}`;
}

function targetClause(target) {
	if (target.type === "pr") return `scope "pr", pr ${target.pr}`;
	if (target.type === "revset") return `scope "revset", revset "${target.revset}"`;
	return 'scope "working-tree"';
}

/**
 * Task prompt for the tuicr-review subagent spawned by `tuicr_review`. The
 * subagent owns the pane: on a launch task it opens the review pane itself
 * with the tuicr tool (the wrapper inherits its HERDR_PANE_ID, so the split
 * lands in the subagent's own tab); on an attach task the session is already
 * active and it attaches with sessionSlug + attachOnly instead.
 */
export function buildReviewSubagentTask({ repo, slug, target }) {
	if (!repo || typeof repo !== "string") throw new Error("repo is required");
	if (target?.type === "pr") requirePrNumber(target.pr);
	if (target?.type === "revset") requireRevset(target.revset);
	if (!["pr", "revset", "working-tree", "slug"].includes(target?.type)) {
		throw new Error(`Unknown review target type: ${target?.type}`);
	}
	const desc = describeReviewTarget(target);
	const subject = slug
		? `the active tuicr session ${slug}${target.type !== "slug" ? ` (${desc})` : ""}`
		: desc;
	const opener = slug
		? `Attach this session's comment watcher with the tuicr tool: repo ${repo}, sessionSlug "${slug}", attachOnly true. The pane for ${desc} is already open — never launch a second one.`
		: `Open the review FIRST with the tuicr tool — the pane splits into YOUR OWN tab, beside you: repo ${repo}, ${targetClause(target)}. Do not pass attachOnly. The call returns once the pane is up; the session slug may still be resolving, and the watcher attaches when it appears (within about a minute).`;
	const lines = [
		`Answer the user's tuicr review comments for ${subject} in ${repo}.`,
		opener,
		"Comments that existed before the watcher attached never steer in. Right after attaching, sweep them: read the full list with bash — tuicr review comments --session <slug> --repo <repo> (omit --repo when the slug starts with gh:) — and answer every user-authored comment that has no pi-agent reply (agent replies start with `Re: `), exactly as you answer steered ones.",
		"New user comments arrive as tuicr_review_comments steer messages.",
		"Answer every user comment with tuicr_reply so it shows inside the TUI. Apply fixes for actionable comments and say what you changed.",
		"When a final steer arrives — the review session ended, or the watcher stopped early — write a terse summary of every comment, your answer, the fixes applied, and the files touched. Remind the orchestrator to ask the user whether to merge or review later. Then stop.",
	];
	return lines.join(" ");
}

/** Structured, model-facing summary returned by `tuicr_review` after spawn. */
export function formatReviewLaunchResult({ repo, target, slug, subagent }) {
	const desc = describeReviewTarget(target);
	const opener = slug
		? `It attaches to the active session ${slug}`
		: "It opens the tuicr pane inside its own tab — this result does not carry the session slug; the subagent resolves it once the pane is up";
	return (
		`Spawned the "${subagent}" subagent for ${desc} in ${repo}. ` +
		opener +
		", answers your comments in the TUI with tuicr_reply, and applies fixes for actionable ones." +
		" When the TUI closes, its summary returns here and the user will be asked whether to merge or review later."
	);
}

/** Structured, model-facing summary returned by the tool itself. */
export function formatLaunchResult({ repo, slug, attached, pending }) {
	if (attached) {
		return `Attached to active tuicr review session ${slug} (${repo}). ` +
			`New comments will be steered into this session as you review; existing comments are already baselined.`;
	}
	const suffix = slug
		? `Session ${slug} is active in the new pane.`
		: `The session slug is still being resolved; the watcher will pick it up.`;
	return (
		`tuicr launched in a background pane for ${repo} — this call did not block. ` +
		suffix +
		(pending ? " New comments will be steered into this session as the user reviews." : "")
	);
}
