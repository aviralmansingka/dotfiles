/**
 * Pure logic for the tuicr-background extension.
 *
 * The extension solves two problems with asking an agent to open tuicr:
 *   1. The multiplexer wrapper scripts (tmux/Zellij/Herdr) block until the
 *      TUI exits, parking the agent for the whole review. We spawn the
 *      wrapper detached instead, so the pane opens but the tool returns.
 *   2. There is no push channel from tuicr to the agent. We poll
 *      `tuicr review comments` and steer new comments back into the session
 *      (`pi.sendMessage(..., { triggerTurn: true, deliverAs: "steer" })`).
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
export function scopeToTuicrArgs(scope, revset) {
	if (scope === "working-tree") return ["-w"];
	if (scope === "revset") {
		const trimmed = typeof revset === "string" ? revset.trim() : "";
		if (trimmed === "") {
			throw new Error("revset is required when scope is 'revset'");
		}
		return ["-r", trimmed];
	}
	throw new Error(`Unknown scope: ${scope}`);
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

/** Comments not yet seen; the caller folds their keys into the seen set. */
export function newComments(seenKeys, comments) {
	return comments.filter((comment) => !seenKeys.has(commentKey(comment)));
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
