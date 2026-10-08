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
				throw new Error(`Multiple active tuicr sessions under ${repo}; pass sessionSlug to choose one.`);
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
