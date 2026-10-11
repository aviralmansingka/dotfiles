import assert from "node:assert/strict";
import {
	activeSlugs,
	buildReplyArgs,
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
	pickSession,
	postTuicrReply,
	prSessionNumber,
	resolveLaunchedSession,
	resolveReviewTarget,
	resolveSkillDir,
	reviewTargetKey,
	reviewerSubagentName,
	scopeToTuicrArgs,
	selectWrapper,
	shouldDeliverBatch,
	targetToScopeArgs,
	truncateLines,
} from "./tuicr-core.mjs";

// ── selectWrapper / resolveSkillDir ──

assert.equal(selectWrapper({ HERDR_ENV: "1", HOME: "/h" }), "tuicr-wrapper-herdr.sh");
assert.equal(selectWrapper({ TMUX: "/tmp/x", HERDR_ENV: "1", HOME: "/h" }), "tuicr-wrapper.sh");
assert.equal(selectWrapper({ CMUX_WORKSPACE_ID: "w", TMUX: "/tmp/x", HOME: "/h" }), "tuicr-wrapper-cmux.sh");
assert.equal(selectWrapper({ ZELLIJ: "0", HOME: "/h" }), "tuicr-wrapper-zellij.sh");
assert.equal(selectWrapper({ HOME: "/h" }), null);
assert.equal(resolveSkillDir({ TUICR_SKILL_DIR: "/custom", HOME: "/h" }), "/custom");
assert.equal(resolveSkillDir({ HOME: "/h" }), "/h/.agents/skills/tuicr");

// ── scope / wrapper args ──

assert.deepEqual(scopeToTuicrArgs("working-tree"), ["-w"]);
assert.deepEqual(scopeToTuicrArgs("revset", "main..@-"), ["-r", "main..@-"]);
assert.throws(() => scopeToTuicrArgs("revset", "  "), /revset is required/);
assert.deepEqual(scopeToTuicrArgs("pr", undefined, 272), ["pr", "272"]);
assert.throws(() => scopeToTuicrArgs("pr"), /pr is required/);
assert.throws(() => scopeToTuicrArgs("pr", undefined, 0), /pr is required/);
assert.throws(() => scopeToTuicrArgs("pr", undefined, "abc"), /pr is required/);
assert.throws(() => scopeToTuicrArgs("staged"), /Unknown scope/);
assert.deepEqual(buildWrapperArgs({ repo: "/repo", tuicrArgs: ["pr", "272"] }), [
	"/repo",
	"--",
	"pr",
	"272",
]);

// ── /tuicr command grammar ──

// A bare call carries no scope: the default target resolution (open PR of
// the current branch, else working tree) applies.
assert.deepEqual(parseTuicrCommandArgs(""), { action: "open" });
assert.deepEqual(parseTuicrCommandArgs("open"), { action: "open" });
assert.deepEqual(parseTuicrCommandArgs("open pr 272"), {
	action: "open", scope: "pr", pr: 272,
});
assert.deepEqual(parseTuicrCommandArgs("pr 272"), {
	action: "open", scope: "pr", pr: 272,
});
assert.deepEqual(parseTuicrCommandArgs("open -r main..@-"), {
	action: "open", scope: "revset", revset: "main..@-",
});
assert.deepEqual(parseTuicrCommandArgs("watch"), { action: "watch" });
assert.deepEqual(parseTuicrCommandArgs("watch -w /repo"), {
	action: "watch", scope: "working-tree", repo: "/repo",
});
assert.deepEqual(parseTuicrCommandArgs("open -w /repo"), {
	action: "open", scope: "working-tree", repo: "/repo",
});
assert.deepEqual(parseTuicrCommandArgs("stop"), { action: "stop" });
assert.throws(() => parseTuicrCommandArgs("open pr"), /positive PR number/);
assert.throws(() => parseTuicrCommandArgs("open pr abc"), /positive PR number/);
assert.throws(() => parseTuicrCommandArgs("open -r"), /-r <revset>/);
assert.throws(() => parseTuicrCommandArgs("open --bogus"), /Unknown \/tuicr argument/);

// ── target classification ──

assert.equal(classifyReviewRequest({}), "default");
assert.equal(classifyReviewRequest({ scope: undefined }), "default");
assert.equal(classifyReviewRequest({ sessionSlug: "s1" }), "session");
assert.equal(classifyReviewRequest({ scope: "pr", pr: 287 }), "pr");
assert.equal(classifyReviewRequest({ scope: "revset", revset: "main..@-" }), "revset");
assert.equal(classifyReviewRequest({ scope: "working-tree" }), "working-tree");
assert.throws(() => classifyReviewRequest({ scope: "staged" }), /Unknown scope/);

// ── PR slug suffix parsing ──

assert.equal(prSessionNumber("gh:owner/repo/pr/287"), 287);
assert.equal(prSessionNumber("gh:owner/repo/pr/28"), 28); // no prefix confusion with 287
assert.equal(prSessionNumber("gh:owner/repo/pr/287/extra"), null);
assert.equal(prSessionNumber("slug@x/commits/1..1"), null);
assert.equal(prSessionNumber(null), null);
assert.deepEqual(
	activeSlugs([
		{ slug: "a", active: true },
		{ slug: "b", active: false },
		{ slug: "c", active: true },
	]),
	["a", "c"],
);

// ── target resolution: the requested target is always honored ──

const repo = "/repo";
const pr288Session = { slug: "gh:o/r/pr/288", active: true };

// THE INCIDENT: an explicit PR must never attach to an unrelated active
// session — no match launches a pane for the requested PR instead.
assert.deepEqual(
	resolveReviewTarget({ scope: "pr", pr: 287 }, { repo, sessions: [pr288Session] }),
	{ action: "launch", target: { type: "pr", pr: 287 } },
);
// An explicit working-tree review launches even while a session is active.
assert.deepEqual(
	resolveReviewTarget({ scope: "working-tree" }, { repo, sessions: [pr288Session] }),
	{ action: "launch", target: { type: "working-tree" } },
);
// A matching PR session is attached to.
assert.deepEqual(
	resolveReviewTarget({ scope: "pr", pr: 288 }, { repo, sessions: [pr288Session] }),
	{ action: "attach", slug: "gh:o/r/pr/288", target: { type: "pr", pr: 288 } },
);
// An explicit revset always launches a new pane.
assert.deepEqual(
	resolveReviewTarget({ scope: "revset", revset: "main..@-" }, { repo, sessions: [pr288Session] }),
	{ action: "launch", target: { type: "revset", revset: "main..@-" } },
);
// An explicit slug attaches to exactly that session — active or not — and
// keys the review by its PR when the slug encodes one.
assert.deepEqual(
	resolveReviewTarget({ sessionSlug: "s1" }, { repo, sessions: [{ slug: "s1", active: false }] }),
	{ action: "attach", slug: "s1", target: { type: "slug", slug: "s1" } },
);
assert.deepEqual(
	resolveReviewTarget({ sessionSlug: "gh:o/r/pr/288" }, { repo, sessions: [pr288Session] }),
	{ action: "attach", slug: "gh:o/r/pr/288", target: { type: "pr", pr: 288 } },
);
assert.match(
	resolveReviewTarget({ sessionSlug: "zz" }, { repo, sessions: [pr288Session] }).message,
	/No tuicr session named zz under \/repo.*tuicr review list --repo \/repo/s,
);
// Two active sessions for the same PR cannot be told apart.
assert.equal(
	resolveReviewTarget({ scope: "pr", pr: 288 }, {
		repo,
		sessions: [pr288Session, { slug: "gh:o2/r2/pr/288", active: true }],
	}).action,
	"error",
);
assert.match(
	resolveReviewTarget({ scope: "pr", pr: 288 }, {
		repo,
		sessions: [pr288Session, { slug: "gh:o2/r2/pr/288", active: true }],
	}).message,
	/Multiple active tuicr sessions for PR 288[\s\S]*gh:o2\/r2\/pr\/288[\s\S]*sessionSlug/,
);

// Bare default rules (injected git/gh results).
// Exactly one open PR → that PR, match-or-launch.
assert.deepEqual(
	resolveReviewTarget({}, {
		repo, sessions: [pr288Session], currentBranch: "fix/a", openPrs: [{ number: 288, title: "t" }],
	}),
	{ action: "attach", slug: "gh:o/r/pr/288", target: { type: "pr", pr: 288 } },
);
assert.deepEqual(
	resolveReviewTarget({}, {
		repo, sessions: [], currentBranch: "fix/a", openPrs: [{ number: 287, title: "t" }],
	}),
	{ action: "launch", target: { type: "pr", pr: 287 } },
);
// Zero open PRs → working-tree review, never the unrelated active session.
assert.deepEqual(
	resolveReviewTarget({}, { repo, sessions: [pr288Session], currentBranch: "main", openPrs: [] }),
	{ action: "launch", target: { type: "working-tree" } },
);
// Detached HEAD (no branch) → working-tree review.
assert.deepEqual(
	resolveReviewTarget({}, { repo, sessions: [], currentBranch: "", openPrs: [] }),
	{ action: "launch", target: { type: "working-tree" } },
);
// Several open PRs → error listing them, asking for pr explicitly.
const several = resolveReviewTarget({}, {
	repo,
	sessions: [],
	currentBranch: "fix/a",
	openPrs: [
		{ number: 287, title: "chore: remove historical docs" },
		{ number: 288, title: "fix(agents): /simple" },
	],
});
assert.equal(several.action, "error");
assert.match(several.message, /Several open PRs for branch fix\/a under \/repo/);
assert.match(several.message, /#287 chore: remove historical docs/);
assert.match(several.message, /#288 fix\(agents\): \/simple/);
assert.match(several.message, /Pass pr explicitly/);

// Invalid combos throw before any decision.
assert.throws(() => resolveReviewTarget({ scope: "pr" }, { repo }), /pr is required/);
assert.throws(() => resolveReviewTarget({ scope: "revset" }, { repo }), /revset is required/);
assert.throws(() => resolveReviewTarget({ scope: "staged" }, { repo }), /Unknown scope/);

// ── keys and deterministic subagent names (one reviewer per target) ──

assert.equal(reviewTargetKey({ type: "pr", pr: 287 }, repo), "pr:287");
assert.equal(reviewTargetKey({ type: "revset", revset: "main..@-" }, repo), "rev:main..@-");
assert.equal(reviewTargetKey({ type: "working-tree" }, "/home/u/dotfiles"), "wt:/home/u/dotfiles");
assert.equal(reviewTargetKey({ type: "slug", slug: "s1" }, repo), "slug:s1");
assert.equal(reviewerSubagentName({ type: "pr", pr: 287 }, repo), "tuicr-review-pr-287");
// Non-alphanumeric runs collapse to a single dash (lossy but deterministic;
// collisions are uniquified upstream by interactive-subagents).
assert.equal(reviewerSubagentName({ type: "revset", revset: "main..@-" }, repo), "tuicr-review-rev-main");
assert.equal(reviewerSubagentName({ type: "revset", revset: "main..HEAD" }, repo), "tuicr-review-rev-main-HEAD");
assert.equal(reviewerSubagentName({ type: "working-tree" }, "/home/u/dotfiles"), "tuicr-review-wt-dotfiles");
assert.equal(
	reviewerSubagentName({ type: "slug", slug: "gh:o/r/pr/288" }, repo),
	"tuicr-review-slug-gh-o-r-pr-288",
);
// Same target → same key (duplicate refused); different targets → different
// keys (concurrent reviewers).
assert.equal(
	reviewTargetKey({ type: "pr", pr: 287 }, repo),
	reviewTargetKey({ type: "pr", pr: 287 }, "/other"),
);
assert.notEqual(
	reviewTargetKey({ type: "pr", pr: 287 }, repo),
	reviewTargetKey({ type: "pr", pr: 288 }, repo),
);
assert.notEqual(
	reviewTargetKey({ type: "pr", pr: 287 }, repo),
	reviewTargetKey({ type: "working-tree" }, repo),
);
assert.equal(describeReviewTarget({ type: "pr", pr: 287 }), "PR 287");
assert.equal(describeReviewTarget({ type: "revset", revset: "main..@-" }), "commit range main..@-");
assert.equal(describeReviewTarget({ type: "working-tree" }), "the working tree");
assert.equal(describeReviewTarget({ type: "slug", slug: "s1" }), "session s1");
assert.deepEqual(targetToScopeArgs({ type: "pr", pr: 287 }), ["pr", "287"]);
assert.deepEqual(targetToScopeArgs({ type: "revset", revset: "main..@-" }), ["-r", "main..@-"]);
assert.deepEqual(targetToScopeArgs({ type: "working-tree" }), ["-w"]);
assert.throws(() => targetToScopeArgs({ type: "staged" }), /Unknown review target type/);

// ── watcher ambiguity resolution by target ──

// A PR target resolves by slug suffix even with several sessions active.
assert.deepEqual(
	resolveLaunchedSession({
		sessions: [pr288Session, { slug: "gh:o/r/pr/287", active: true }],
		baselineSlugs: [],
		pr: 287,
	}),
	{ status: "ok", session: { slug: "gh:o/r/pr/287", active: true } },
);
// No matching PR session yet → wait (the pane may still be launching).
assert.equal(
	resolveLaunchedSession({ sessions: [pr288Session], baselineSlugs: [], pr: 287 }).status,
	"wait",
);
// Several matching PR sessions → ambiguous.
assert.equal(
	resolveLaunchedSession({
		sessions: [{ slug: "gh:a/r/pr/288", active: true }, { slug: "gh:b/r/pr/288", active: true }],
		pr: 288,
	}).status,
	"ambiguous",
);
// A non-PR launch owns the session that appeared after it, not one that was
// already active.
assert.deepEqual(
	resolveLaunchedSession({
		sessions: [pr288Session, { slug: "new@x/commits/1..1", active: true }],
		baselineSlugs: ["gh:o/r/pr/288"],
	}),
	{ status: "ok", session: { slug: "new@x/commits/1..1", active: true } },
);
// Nothing new yet → wait.
assert.equal(
	resolveLaunchedSession({ sessions: [pr288Session], baselineSlugs: ["gh:o/r/pr/288"] }).status,
	"wait",
);
// Several new sessions → ambiguous.
assert.equal(
	resolveLaunchedSession({
		sessions: [{ slug: "n1", active: true }, { slug: "n2", active: true }],
		baselineSlugs: [],
	}).status,
	"ambiguous",
);

// ── review subagent task and launch result (the subagent owns the pane) ──

const taskLaunchPr = buildReviewSubagentTask({
	repo: "/repo", slug: null, target: { type: "pr", pr: 272 },
});
assert.match(taskLaunchPr, /PR 272 in \/repo/);
assert.match(taskLaunchPr, /Open the review FIRST with the tuicr tool/);
assert.match(taskLaunchPr, /YOUR OWN tab/);
assert.match(taskLaunchPr, /scope "pr", pr 272/);
assert.match(taskLaunchPr, /Do not pass attachOnly/);
assert.doesNotMatch(taskLaunchPr, /attachOnly true/);
assert.match(taskLaunchPr, /tuicr_reply/);
assert.match(taskLaunchPr, /merge or review later/);
// The sweep and final-steer contracts are kept.
assert.match(taskLaunchPr, /existed before the watcher attached/);
assert.match(taskLaunchPr, /tuicr review comments --session <slug> --repo <repo>/);
assert.match(taskLaunchPr, /no pi-agent reply/);
assert.match(taskLaunchPr, /watcher stopped early/);

const taskLaunchRevset = buildReviewSubagentTask({
	repo: "/repo", slug: null, target: { type: "revset", revset: "main..@-" },
});
assert.match(taskLaunchRevset, /commit range main\.\.@-/);
assert.match(taskLaunchRevset, /scope "revset", revset "main\.\.@-"/);

const taskLaunchWt = buildReviewSubagentTask({
	repo: "/repo", slug: null, target: { type: "working-tree" },
});
assert.match(taskLaunchWt, /the working tree/);
assert.match(taskLaunchWt, /scope "working-tree"/);

// Attach task (session already active): sessionSlug + attachOnly, never a
// second pane.
const taskAttach = buildReviewSubagentTask({
	repo: "/repo", slug: "gh:o/r/pr/272", target: { type: "pr", pr: 272 },
});
assert.match(taskAttach, /active tuicr session gh:o\/r\/pr\/272 \(PR 272\)/);
assert.match(taskAttach, /sessionSlug "gh:o\/r\/pr\/272"/);
assert.match(taskAttach, /attachOnly true/);
assert.match(taskAttach, /never launch a second one/);

const taskAttachSlug = buildReviewSubagentTask({
	repo: "/repo", slug: "s1", target: { type: "slug", slug: "s1" },
});
assert.match(taskAttachSlug, /active tuicr session s1 in \/repo/);
assert.doesNotMatch(taskAttachSlug, /\(session s1\)/);

// Target validation happens on the task path too.
assert.throws(
	() => buildReviewSubagentTask({ repo: "/repo", slug: null, target: { type: "pr" } }),
	/pr is required/,
);
assert.throws(
	() => buildReviewSubagentTask({ repo: "/repo", slug: null, target: { type: "revset" } }),
	/revset is required/,
);
assert.throws(
	() => buildReviewSubagentTask({ repo: "/repo", slug: null, target: { type: "staged" } }),
	/Unknown review target type/,
);
assert.throws(() => buildReviewSubagentTask({ repo: "", slug: null, target: { type: "working-tree" } }), /repo is required/);

const reviewLaunch = formatReviewLaunchResult({
	repo: "/repo", target: { type: "pr", pr: 272 }, slug: null, subagent: "tuicr-review-pr-272",
});
assert.match(reviewLaunch, /Spawned the "tuicr-review-pr-272" subagent for PR 272 in \/repo/);
assert.match(reviewLaunch, /opens the tuicr pane inside its own tab/);
assert.match(reviewLaunch, /does not carry the session slug/);
assert.match(reviewLaunch, /merge or review later/);
const reviewAttach = formatReviewLaunchResult({
	repo: "/repo", target: { type: "pr", pr: 272 }, slug: "gh:o/r/pr/272", subagent: "tuicr-review-pr-272",
});
assert.match(reviewAttach, /attaches to the active session gh:o\/r\/pr\/272/);
assert.deepEqual(buildWrapperArgs({ repo: "/repo", tuicrArgs: ["-w"] }), [
	"/repo",
	"--",
	"-w",
]);
assert.throws(() => buildWrapperArgs({ repo: "", tuicrArgs: [] }), /repo is required/);

// ── session list / picking ──

const sessions = parseSessionList(
	JSON.stringify([
		{ slug: "a", active: false },
		{ slug: "b", active: true },
		{ slug: "c", active: true },
	]),
);
assert.equal(pickSession(sessions).status, "ambiguous");
assert.equal(pickSession(sessions, "a").status, "ok");
assert.equal(pickSession(sessions, "a").session.slug, "a");
assert.equal(pickSession(sessions, "zz").status, "missing");
assert.equal(pickSession([{ slug: "only", active: true }]).status, "ok");
assert.equal(pickSession([{ slug: "only", active: false }]).status, "none");
assert.throws(() => parseSessionList('{"sessions":[]}'), /Unexpected/);

// ── comment keys / diffing ──

const c1 = { id: 1, path: "a.ts", start_line: 3, comment_type: "issue", content: "fix" };
const c2 = { id: 2, path: "b.ts", comment_type: "note", content: "why?" };
assert.equal(commentKey(c1), "1");
assert.equal(commentKey({ path: "x", content: "y" }), "x|||y");
const seen = collectSeenKeys([c1]);
assert.deepEqual(newComments(seen, [c1, c2]), [c2]);
assert.deepEqual(newComments(seen, [c1]), []);

// composite keys stay stable across identical re-emissions
const composite = { path: "x", start_line: 1, end_line: 2, content: "y" };
assert.deepEqual(newComments(collectSeenKeys([composite]), [composite]), []);

// ── payload parsing ──

assert.deepEqual(parseCommentPayload("[]"), []);
assert.deepEqual(parseCommentPayload(JSON.stringify([c1])), [c1]);
assert.deepEqual(parseCommentPayload(JSON.stringify({ comments: [c2] })), [c2]);
assert.throws(() => parseCommentPayload('{"nope":1}'), /Unexpected/);

// ── batch coalescing ──

assert.equal(shouldDeliverBatch({ pendingCount: 0, lastDeliveredAt: null, now: 0, coalesceMs: 1000 }), false);
assert.equal(shouldDeliverBatch({ pendingCount: 2, lastDeliveredAt: null, now: 0, coalesceMs: 1000 }), true);
assert.equal(
	shouldDeliverBatch({ pendingCount: 2, lastDeliveredAt: 1000, now: 1500, coalesceMs: 1000 }),
	false,
);
assert.equal(
	shouldDeliverBatch({ pendingCount: 2, lastDeliveredAt: 1000, now: 2000, coalesceMs: 1000 }),
	true,
);

// ── formatting ──

assert.equal(
	formatCommentLine({
		path: "src/main.rs",
		start_line: 42,
		end_line: 48,
		side: "new",
		comment_type: "suggestion",
		content: "split this\nsecond line ignored",
	}),
	"- [suggestion] src/main.rs:42-48 (new): split this",
);
assert.equal(
	formatCommentLine({ comment_type: "praise", content: "nice" }),
	"- [praise] review-level: nice",
);
assert.deepEqual(truncateLines(["a", "b", "c"], 2), ["a", "b", "… +1 more"]);
assert.deepEqual(truncateLines(["a"], 5), ["a"]);

const steer = formatSteerContent({
	repo: "/repo",
	slug: "slug@x/commits/1..1",
	comments: [c1, c2],
	final: false,
});
assert.match(steer, /tuicr review feedback \(slug@x\/commits\/1\.\.1\): 2 new user comment/);
assert.match(steer, /- \[issue\] a\.ts:3: fix/);
assert.match(steer, /issue = fix first/);
assert.match(steer, /tuicr review comments --repo \/repo --session slug@x\/commits\/1\.\.1/);

const finalEmpty = formatSteerContent({ repo: "/r", slug: "s", comments: [], final: true });
assert.match(finalEmpty, /ended \(s\); no new comments/);

const launchAttached = formatLaunchResult({ repo: "/r", slug: "s", attached: true });
assert.match(launchAttached, /Attached to active tuicr review session s/);
const launchNew = formatLaunchResult({ repo: "/r", slug: null, attached: false, pending: true });
assert.match(launchNew, /did not block/);
assert.match(launchNew, /still being resolved/);

// ── reply CLI flow: no subprocess or live review required ──

const reply = { message: "\nFixed the empty case.\n\nFull explanation here.", file: "src/main.rs", line: 42, replyTo: "user-1" };
const userComment = { id: "user-1", author: "user", path: "src/main.rs", start_line: 42, content: "Handle empty input" };
function fakeCli({ sessions = [{ slug: "active", active: true }], comments = [userComment], error } = {}) {
	const calls = [];
	return {
		calls,
		execFile: async (command, args, options) => {
			calls.push({ command, args, options });
			assert.equal(command, "tuicr");
			if (args[1] === "list") return { stdout: JSON.stringify(sessions) };
			if (args[1] === "comments") return { stdout: JSON.stringify(comments) };
			assert.equal(args[1], "add");
			if (error) throw error;
			return { stdout: JSON.stringify({ id: "agent-1" }) };
		},
	};
}
const watchedCli = fakeCli();
const replyIds = new Set();
const signal = new AbortController().signal;
const posted = await postTuicrReply(reply, {
	cwd: "/cwd", watch: { repo: "/watched", slug: "watched" }, execFile: watchedCli.execFile, signal, replyIds,
});
assert.deepEqual(posted.details, {
	slug: "watched", file: "src/main.rs", line: 42, replyTo: "user-1", posted: true, firstLine: "Fixed the empty case.",
});
assert.match(posted.content[0].text, /visible in tuicr/);
assert.deepEqual(watchedCli.calls.map((call) => call.args), [
	["review", "comments", "--session", "watched", "--repo", "/watched"],
	["review", "add", "--session", "watched", "--repo", "/watched", "--username", "pi-agent",
		"--target-file", "src/main.rs", "--line", "42", "--", `Re: src/main.rs:42\n\n${reply.message}`],
]);
assert.equal(watchedCli.calls[1].options.signal, signal);
assert.equal(watchedCli.calls[1].options.timeout, 15_000);
assert.ok(replyIds.has("agent-1"));
assert.deepEqual(newComments(new Set(), [{ id: "agent-1", content: "Answer" }], replyIds), []);
const echoCli = fakeCli({ comments: [{ id: "agent-1", content: "Answer" }] });
assert.equal((await postTuicrReply({ message: "Answer", replyTo: "agent-1" }, {
	cwd: "/cwd", execFile: echoCli.execFile, replyIds,
})).isError, true);

const fallbackCli = fakeCli();
assert.equal((await postTuicrReply(reply, { cwd: "/cwd", execFile: fallbackCli.execFile })).details.slug, "active");
assert.deepEqual(fallbackCli.calls[0].args, ["review", "list", "--repo", "/cwd"]);
const explicitCli = fakeCli();
assert.equal((await postTuicrReply({ ...reply, sessionSlug: "explicit" }, {
	cwd: "/cwd", watch: { repo: "/watched", slug: "watched" }, execFile: explicitCli.execFile,
})).details.slug, "explicit");
assert.deepEqual(explicitCli.calls[0].args, ["review", "comments", "--session", "explicit", "--repo", "/cwd"]);
assert.deepEqual(buildReplyArgs({ repo: "/r", slug: "gh:owner/repo/pr/1", message: "--not-a-flag", replyTo: "user-1" }), [
	"review", "add", "--session", "gh:owner/repo/pr/1", "--username", "pi-agent", "--", "Re: comment user-1\n\n--not-a-flag",
]);
assert.deepEqual(buildReplyArgs({ repo: "/r", slug: "s", file: "src/main.rs", message: "Answer" }).slice(-4), [
	"--target-file", "src/main.rs", "--", "Re: src/main.rs\n\nAnswer",
]);

for (const [sessions, expected] of [
	[[], /No active tuicr session/],
	[[{ slug: "stale", active: false }], /No active tuicr session/],
	// The ambiguity error lists the active slugs so the caller can pick one.
	[
		[{ slug: "a", active: true }, { slug: "b", active: true }],
		/Multiple active tuicr sessions under \/cwd:\n  a\n  b\nPass sessionSlug to choose one\./,
	],
]) {
	const cli = fakeCli({ sessions });
	const result = await postTuicrReply(reply, { cwd: "/cwd", execFile: cli.execFile });
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, expected);
	assert.equal(cli.calls.length, 1);
}
for (const params of [{ message: "  " }, { message: "Answer", line: 3 }, { ...reply, line: 1.5 }]) {
	const cli = fakeCli();
	assert.equal((await postTuicrReply(params, { cwd: "/cwd", execFile: cli.execFile })).isError, true);
	assert.equal(cli.calls.length, 0);
}
for (const comments of [[], [{ ...userComment, author: "pi-agent" }], [{ ...userComment, id: "wrong" }]]) {
	const cli = fakeCli({ comments });
	const result = await postTuicrReply(reply, { cwd: "/cwd", execFile: cli.execFile });
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /No matching user review comment/);
	assert.ok(!cli.calls.some((call) => call.args[1] === "add"));
}
const anchorCli = fakeCli();
assert.equal((await postTuicrReply({ message: "Answer", file: "src/main.rs", line: 42 }, { cwd: "/cwd", execFile: anchorCli.execFile })).details.posted, true);
const reviewCli = fakeCli();
assert.equal((await postTuicrReply({ message: "Answer" }, { cwd: "/cwd", execFile: reviewCli.execFile })).details.posted, true);
assert.equal(reviewCli.calls.at(-1).args.at(-1), "Re: review comments\n\nAnswer");
assert.deepEqual(newComments(new Set(), [userComment, { id: "agent-1", author: "pi-agent", content: "Answer" }]), [userComment]);

const errorCli = fakeCli({ error: Object.assign(new Error("Command failed: tuicr review add ..."), { stderr: "error: session is read-only\nMore details\n" }) });
const failed = await postTuicrReply(reply, { cwd: "/cwd", execFile: errorCli.execFile });
assert.equal(failed.isError, true);
assert.equal(failed.content[0].text, "error: session is read-only\nMore details");

// ── compact renderCall/renderResult snapshots, including theme tokens ──
const theme = { fg: (color, text) => `<${color}>${text}</${color}>` };
assert.equal(formatReplyCall(reply, theme),
	"<toolTitle>◇ tuicr_reply</toolTitle>\n └─ <toolTitle>✎</toolTitle> <dim>re: src/main.rs:42 — </dim><toolTitle>Fixed the empty case.</toolTitle>");
assert.equal(formatReplyResult(posted, theme),
	" ├─ <toolTitle>✎</toolTitle> <dim>re: src/main.rs:42 — </dim><toolTitle>Fixed the empty case.</toolTitle>\n └─ <success>✓</success> <dim>posted to session watched · visible in tuicr</dim>");
assert.equal(formatReplyResult(failed, theme), " └─ <error>✗ error: session is read-only</error>");
assert.equal(formatReplyCall({}, theme),
	"<toolTitle>◇ tuicr_reply</toolTitle>\n └─ <toolTitle>✎</toolTitle> <dim>re: review comments — </dim><toolTitle></toolTitle>");
assert.equal(formatReplyResult({ content: [], details: {} }, theme), "<dim> └─ posting reply…</dim>");

console.log("tuicr.test.mjs: all assertions passed");
