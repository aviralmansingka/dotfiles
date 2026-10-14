import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";
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
	firstNonEmptyLine,
	formatSteerContent,
	newComments,
	parseCommentPayload,
	parseSessionList,
	parseTuicrCommandArgs,
	pickSession,
	postTuicrReply,
	prSessionNumber,
	resolveLaunchedSession,
	resolveSkillDir,
	resolveTargetSession,
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
// the current branch, else the working tree) applies.
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
assert.deepEqual(parseTuicrCommandArgs("watch --revset main..@-"), {
	action: "watch", scope: "revset", revset: "main..@-",
});
assert.deepEqual(parseTuicrCommandArgs("pr 272 /repo"), {
	action: "open", scope: "pr", pr: 272, repo: "/repo",
});
assert.throws(() => parseTuicrCommandArgs("open /repo /repo2"), /Unknown \/tuicr argument/);
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

// ── review subagent task and launch result (the subagent owns the pane) ──

// Launch task: the subagent opens the pane in its OWN tab, never attachOnly.
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

// ── firstNonEmptyLine (#246: transcript shows only the leading line) ──

assert.equal(firstNonEmptyLine("Re: src/main.rs:42\n\nFull body."), "Re: src/main.rs:42");
assert.equal(firstNonEmptyLine("\n \n\ttab-indented lead"), "tab-indented lead");
assert.equal(firstNonEmptyLine("  padded  "), "padded");
assert.equal(firstNonEmptyLine(""), "");
assert.equal(firstNonEmptyLine(null), "");
assert.equal(firstNonEmptyLine(undefined), "");
assert.equal(firstNonEmptyLine("\n \n"), "");

// ── reply-loop prevention (#246): own replies never steer back ──

// author filter alone excludes the agent's own comments
const ownAuthored = { id: "a1", author: "pi-agent", path: "a.ts", content: "Re: answer" };
assert.deepEqual(newComments(new Set(), [ownAuthored]), []);
// v0.24 omits authors: the tracked reply id excludes the round trip
const ownUnattributed = { id: "a2", path: "a.ts", content: "Re: answer" };
assert.deepEqual(newComments(new Set(), [ownUnattributed], new Set(["a2"])), []);
// unknown id + no author is treated as a user comment
assert.deepEqual(newComments(new Set(), [ownUnattributed]), [ownUnattributed]);
// a user comment keeps flowing even while a reply is tracked
const userFlow = { id: "u9", author: "user", path: "a.ts", content: "next" };
assert.deepEqual(newComments(new Set(), [ownUnattributed, userFlow], new Set(["a2"])), [userFlow]);
// both exclusion layers compose with the seen baseline
assert.deepEqual(newComments(collectSeenKeys([userFlow]), [ownAuthored, ownUnattributed, userFlow], new Set(["a2"])), []);

// ── target classification (#289) ──

assert.equal(classifyReviewRequest({}), "default");
assert.equal(classifyReviewRequest({ scope: undefined }), "default");
assert.equal(classifyReviewRequest({ sessionSlug: "s1" }), "session");
assert.equal(classifyReviewRequest({ scope: "pr", pr: 287 }), "pr");
assert.equal(classifyReviewRequest({ scope: "revset", revset: "main..@-" }), "revset");
assert.equal(classifyReviewRequest({ scope: "working-tree" }), "working-tree");
assert.throws(() => classifyReviewRequest({ scope: "staged" }), /Unknown scope/);

// ── PR slug suffix parsing (#289: no prefix confusion) ──

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

// ── resolveTargetSession (#289): the requested target is always honored ──
// Consolidated API: ours (name + status shape) carrying main's decision
// matrix — attach / launch / error, never any-active attach.

const s288 = { slug: "gh:owner/repo/pr/288", active: true, kind: "pr" };
const s287 = { slug: "gh:owner/repo/pr/287", active: true, kind: "pr" };
const repo = "/repo";

// THE INCIDENT: an explicit PR never attaches to an unrelated active
// session — no match launches a pane for the requested PR instead.
assert.deepEqual(
	resolveTargetSession({ scope: "pr", pr: 287 }, { repo, sessions: [s288] }),
	{ status: "launch", target: { type: "pr", pr: 287 } },
);
// An explicit working-tree review launches even while a session is active.
assert.deepEqual(
	resolveTargetSession({ scope: "working-tree" }, { repo, sessions: [s288] }),
	{ status: "launch", target: { type: "working-tree" } },
);
// A matching PR session is attached to.
assert.deepEqual(
	resolveTargetSession({ scope: "pr", pr: 288 }, { repo, sessions: [s288] }),
	{ status: "ok", session: s288, target: { type: "pr", pr: 288 } },
);
// An explicit revset always launches a new pane — never a suffix attach.
assert.deepEqual(
	resolveTargetSession({ scope: "revset", revset: "main..@-" }, { repo, sessions: [s288] }),
	{ status: "launch", target: { type: "revset", revset: "main..@-" } },
);
// An explicit slug attaches to exactly that session — active or not — and
// keys the review by its PR when the slug encodes one.
assert.deepEqual(
	resolveTargetSession({ sessionSlug: "s1" }, { repo, sessions: [{ slug: "s1", active: false }] }),
	{ status: "ok", session: { slug: "s1", active: false }, target: { type: "slug", slug: "s1" } },
);
assert.deepEqual(
	resolveTargetSession({ sessionSlug: "gh:owner/repo/pr/288" }, { repo, sessions: [s288] }),
	{ status: "ok", session: s288, target: { type: "pr", pr: 288 } },
);
assert.match(
	resolveTargetSession({ sessionSlug: "zz" }, { repo, sessions: [s288] }).message,
	/No tuicr session named zz under \/repo.*tuicr review list --repo \/repo/s,
);
// Two active sessions for the same PR cannot be told apart.
assert.equal(
	resolveTargetSession({ scope: "pr", pr: 288 }, {
		repo,
		sessions: [s288, { slug: "gh:o2/r2/pr/288", active: true }],
	}).status,
	"error",
);
assert.match(
	resolveTargetSession({ scope: "pr", pr: 288 }, {
		repo,
		sessions: [s288, { slug: "gh:o2/r2/pr/288", active: true }],
	}).message,
	/Multiple active tuicr sessions for PR 288[\s\S]*gh:o2\/r2\/pr\/288[\s\S]*sessionSlug/,
);

// Bare default rules (injected git/gh results).
// Exactly one open PR → that PR, match-or-launch.
assert.deepEqual(
	resolveTargetSession({}, {
		repo, sessions: [s288], currentBranch: "fix/a", openPrs: [{ number: 288, title: "t" }],
	}),
	{ status: "ok", session: s288, target: { type: "pr", pr: 288 } },
);
assert.deepEqual(
	resolveTargetSession({}, {
		repo, sessions: [], currentBranch: "fix/a", openPrs: [{ number: 287, title: "t" }],
	}),
	{ status: "launch", target: { type: "pr", pr: 287 } },
);
// Zero open PRs → working-tree review, never the unrelated active session.
assert.deepEqual(
	resolveTargetSession({}, { repo, sessions: [s288], currentBranch: "main", openPrs: [] }),
	{ status: "launch", target: { type: "working-tree" } },
);
// Detached HEAD (no branch) → working-tree review.
assert.deepEqual(
	resolveTargetSession({}, { repo, sessions: [], currentBranch: "", openPrs: [] }),
	{ status: "launch", target: { type: "working-tree" } },
);
// Several open PRs → error listing them, asking for pr explicitly.
const several = resolveTargetSession({}, {
	repo,
	sessions: [],
	currentBranch: "fix/a",
	openPrs: [
		{ number: 287, title: "chore: remove historical docs" },
		{ number: 288, title: "fix(agents): /simple" },
	],
});
assert.equal(several.status, "error");
assert.match(several.message, /Several open PRs for branch fix\/a under \/repo/);
assert.match(several.message, /#287 chore: remove historical docs/);
assert.match(several.message, /#288 fix\(agents\): \/simple/);
assert.match(several.message, /Pass pr explicitly/);

// Invalid combos throw before any decision.
assert.throws(() => resolveTargetSession({ scope: "pr" }, { repo }), /pr is required/);
assert.throws(() => resolveTargetSession({ scope: "revset" }, { repo }), /revset is required/);
assert.throws(() => resolveTargetSession({ scope: "staged" }, { repo }), /Unknown scope/);

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

// ── watcher ambiguity resolution by target (#289) ──

// A PR target resolves by slug suffix even with several sessions active.
assert.deepEqual(
	resolveLaunchedSession({
		sessions: [s288, s287],
		baselineSlugs: [],
		pr: 287,
	}),
	{ status: "ok", session: s287 },
);
// No matching PR session yet → wait (the pane may still be launching).
assert.equal(
	resolveLaunchedSession({ sessions: [s288], baselineSlugs: [], pr: 287 }).status,
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
		sessions: [s288, { slug: "new@x/commits/1..1", active: true }],
		baselineSlugs: ["gh:owner/repo/pr/288"],
	}),
	{ status: "ok", session: { slug: "new@x/commits/1..1", active: true } },
);
// Nothing new yet → wait.
assert.equal(
	resolveLaunchedSession({ sessions: [s288], baselineSlugs: ["gh:owner/repo/pr/288"] }).status,
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

// ── extension behavior: jiti + fake tuicr/git binaries + stubbed peers ──
// House pattern (mermaid/no-mistakes style): the tuicr/gh/git CLIs never run
// for real — fake binaries land on PATH before the extension imports, the
// wrapper script is a stub under TUICR_SKILL_DIR, and every scenario stages
// the comment/session fixtures the fake CLI serves. No network, no panes.

const require = createRequire(import.meta.url);
// Same contract as the sibling suites (test-lib/jiti.mjs): re-derive
// NODE_PATH from the resolved jiti root so typebox resolves when jiti comes
// from pi's managed install — this file loads no-mistakes-pane.ts for the
// keep-open composition, and that import needs typebox.
const { jitiPath, nodePath } = resolveJiti();
process.env.NODE_PATH = nodePath;
require("node:module").Module._initPaths();
const { createJiti } = require(jitiPath);

const extRoot = mkdtempSync(join(tmpdir(), "tuicr-ext-test-"));
const binDir = join(extRoot, "bin");
const skillDir = join(extRoot, "skill");
const stateDir = join(extRoot, "state");
const repoDir = join(extRoot, "repo");
mkdirSync(binDir);
mkdirSync(skillDir);
mkdirSync(stateDir);
mkdirSync(repoDir);

// fake tuicr CLI: serves staged session/comment JSON, logs every call,
// switches to the post-launch list once the wrapper marks its launch
writeFileSync(join(binDir, "tuicr"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.TUICR_FAKE_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "calls.log"), JSON.stringify(args) + "\\n");
const sub = args[1];
if (sub === "list") {
	const file = fs.existsSync(path.join(dir, "launched")) ? "list-after.json" : "list-initial.json";
	process.stdout.write(fs.readFileSync(path.join(dir, file), "utf8"));
} else if (sub === "comments") {
	process.stdout.write(fs.readFileSync(path.join(dir, "comments.json"), "utf8"));
} else if (sub === "add") {
	fs.writeFileSync(path.join(dir, "last-add.json"), JSON.stringify(args));
	process.stdout.write(JSON.stringify({ id: "agent-1" }));
} else {
	process.stderr.write("fake tuicr: unsupported " + args.join(" ") + "\\n");
	process.exit(1);
}
`);
chmodSync(join(binDir, "tuicr"), 0o755);

// fake git: rev-parse --show-toplevel echoes the -C directory;
// branch --show-current serves the staged branch (empty = detached)
writeFileSync(join(binDir, "git"), `#!/bin/sh
root=""
cmd=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -C) root="$2"; shift 2 ;;
    *) cmd="$cmd $1"; shift ;;
  esac
done
case "$cmd" in
  *" rev-parse --show-toplevel"*) echo "$root" ;;
  *" branch --show-current"*)
    if [ -f "$TUICR_FAKE_DIR/branch" ]; then cat "$TUICR_FAKE_DIR/branch"; else echo ""; fi
    ;;
  *) echo "$root" ;;
esac
`);
chmodSync(join(binDir, "git"), 0o755);

// fake gh: pr list serves the staged open-PR JSON, logs every call
writeFileSync(join(binDir, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.TUICR_FAKE_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "gh-calls.log"), JSON.stringify(args) + "\\n");
if (args[0] === "pr" && args[1] === "list") {
	const file = path.join(dir, "open-prs.json");
	process.stdout.write(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "[]");
} else {
	process.stderr.write("fake gh: unsupported " + args.join(" ") + "\\n");
	process.exit(1);
}
`);
chmodSync(join(binDir, "gh"), 0o755);

// fake wrapper script: logs its argv and marks the launch (never a real pane)
writeFileSync(join(skillDir, "tuicr-wrapper-herdr.sh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$TUICR_FAKE_DIR/wrapper.log"
: > "$TUICR_FAKE_DIR/launched"
`);
chmodSync(join(skillDir, "tuicr-wrapper-herdr.sh"), 0o755);

const stubAgent = join(extRoot, "pi-coding-agent.cjs");
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
const stubTui = join(extRoot, "pi-tui.cjs");
writeFileSync(
	stubTui,
	`
class Text { constructor(text) { this.text = String(text); } }
class Box {
	constructor() { this.children = []; }
	addChild(child) { this.children.push(child); }
	render() { return this.children.flatMap((child) => child.text.split("\\n")); }
}
exports.Box = Box;
exports.Text = Text;
exports.truncateToWidth = (text) => String(text);
`,
);
const stubTypes = join(extRoot, "pi-ai.cjs");
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");

const savedEnv = { ...process.env };
process.env.PATH = `${binDir}:${process.env.PATH}`;
process.env.TUICR_SKILL_DIR = skillDir;
process.env.TUICR_FAKE_DIR = stateDir;
process.env.HERDR_ENV = "1"; // selects the (fake) herdr wrapper
// ms-scale timers so the watcher loop is deterministic and fast
process.env.TUICR_BG_POLL_MS = "20";
process.env.TUICR_BG_COALESCE_MS = "40";
process.env.TUICR_BG_LAUNCH_WAIT_MS = "90";

function restoreEnv() {
	for (const key of Object.keys(process.env)) {
		if (!(key in savedEnv)) delete process.env[key];
	}
	Object.assign(process.env, savedEnv);
}

try {
	// moduleCache:false → every loadExtension() re-evaluates tuicr.ts, which
	// the keep-open composition scenarios need (fresh publish per load).
	const jitiOpts = {
		moduleCache: false,
		alias: {
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-tui": stubTui,
			"@earendil-works/pi-ai": stubTypes,
		},
	};
	const loadExtension = () => createJiti(import.meta.url, jitiOpts)("./tuicr.ts");

	const KEEP_OPEN = Symbol.for("pi-subagents/keep-open-count");
	const keepOpenCount = () => {
		const fn = globalThis[KEEP_OPEN];
		assert.equal(typeof fn, "function", "keep-open slot must stay a function");
		return fn();
	};

	function stage({ listInitial = [], listAfter = listInitial, comments = [], branch = "", openPrs = [] } = {}) {
		for (const name of ["calls.log", "wrapper.log", "launched", "last-add.json", "gh-calls.log"]) {
			try {
				unlinkSync(join(stateDir, name));
			} catch {}
		}
		writeFileSync(join(stateDir, "list-initial.json"), JSON.stringify(listInitial));
		writeFileSync(join(stateDir, "list-after.json"), JSON.stringify(listAfter));
		writeFileSync(join(stateDir, "comments.json"), JSON.stringify(comments));
		writeFileSync(join(stateDir, "branch"), branch);
		writeFileSync(join(stateDir, "open-prs.json"), JSON.stringify(openPrs));
	}
	const ghCalls = () => {
		try {
			return readFileSync(join(stateDir, "gh-calls.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
		} catch {
			return [];
		}
	};
	const tuicrCalls = () => {
		try {
			return readFileSync(join(stateDir, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
		} catch {
			return [];
		}
	};
	const wrapperCalls = () => {
		try {
			return readFileSync(join(stateDir, "wrapper.log"), "utf8").trim().split("\n").filter(Boolean);
		} catch {
			return [];
		}
	};

	async function until(predicate, label, timeoutMs = 3000) {
		const deadline = Date.now() + timeoutMs;
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}

	function makeHarness() {
		const tools = [];
		const commands = new Map();
		const renderers = new Map();
		const handlers = new Map();
		const sent = [];
		const notifications = [];
		const ui = { notify: (message, level) => notifications.push({ message, level }) };
		const pi = {
			registerTool: (def) => tools.push(def),
			registerCommand: (name, def) => commands.set(name, def),
			registerMessageRenderer: (customType, renderer) => renderers.set(customType, renderer),
			sendMessage: (message, options) => sent.push({ message, options }),
			on: (event, handler) => handlers.set(event, handler),
		};
		const ctx = { cwd: repoDir, ui };
		return { tools, commands, renderers, handlers, sent, notifications, ui, pi, ctx };
	}

	// interactive-subagents seam: spawn + liveness, fully controlled by the test
	const isas = { running: false, spawned: [] };
	globalThis.__pi_interactive_subagents = {
		isSubagentRunning: () => isas.running,
		executeSubagent: async (params) => {
			isas.spawned.push(params);
			return { content: [{ type: "text", text: "watching the review" }], details: { name: params.name } };
		},
	};

	const mod = loadExtension();
	const harness = makeHarness();
	mod.default(harness.pi);
	const tuicrTool = harness.tools.find((tool) => tool.name === "tuicr");
	const reviewTool = harness.tools.find((tool) => tool.name === "tuicr_review");
	const replyTool = harness.tools.find((tool) => tool.name === "tuicr_reply");
	assert.ok(tuicrTool && reviewTool && replyTool, "registers the three tuicr tools");
	assert.ok(harness.commands.has("tuicr"), "registers the /tuicr command");

	// ── T2 through tuicr_review: the subagent owns the pane (#289) ──

	// THE INCIDENT: pr:287 while PR-288's session is the only active one →
	// the parent opens NO pane and attaches to NOTHING; the reviewer subagent
	// gets a launch task for PR 287 and opens the pane in its own tab.
	stage({ listInitial: [s288] });
	const wrongPr = await reviewTool.execute("t-wrong-pr", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(wrongPr.isError, undefined);
	assert.deepEqual(wrapperCalls(), [], "the parent never launches a pane in the review flow");
	assert.equal(isas.spawned.length, 1);
	assert.equal(isas.spawned[0].name, "tuicr-review-pr-287");
	assert.equal(isas.spawned[0].cwd, repoDir);
	assert.match(isas.spawned[0].task, /PR 287 in /);
	assert.match(isas.spawned[0].task, /Open the review FIRST with the tuicr tool/);
	assert.match(isas.spawned[0].task, /YOUR OWN tab/);
	assert.match(isas.spawned[0].task, /Do not pass attachOnly/);
	assert.doesNotMatch(isas.spawned[0].task, /PR 288/);
	assert.equal(wrongPr.details.targetKey, "pr:287");
	assert.equal(wrongPr.details.reviewer, "tuicr-review-pr-287");
	assert.equal(wrongPr.details.slug, null, "a launch task carries no session slug yet");
	assert.match(wrongPr.content[0].text, /Spawned the "tuicr-review-pr-287" subagent for PR 287/);
	assert.match(wrongPr.content[0].text, /opens the tuicr pane inside its own tab/);
	assert.equal(keepOpenCount(), 0, "the review flow leaves the parent watcher-free");

	// pr:287 with both PR sessions active → attaches to the RIGHT one
	stage({ listInitial: [s287, s288] });
	const rightPr = await reviewTool.execute("t-right-pr", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(rightPr.isError, undefined);
	assert.equal(rightPr.details.slug, "gh:owner/repo/pr/287");
	assert.equal(rightPr.details.targetKey, "pr:287");
	assert.equal(isas.spawned.length, 2);
	assert.equal(isas.spawned[1].name, "tuicr-review-pr-287");
	assert.match(isas.spawned[1].task, /active tuicr session gh:owner\/repo\/pr\/287 \(PR 287\)/);
	assert.match(isas.spawned[1].task, /sessionSlug "gh:owner\/repo\/pr\/287"/);
	assert.match(isas.spawned[1].task, /attachOnly true/);
	assert.deepEqual(wrapperCalls(), [], "attach never launches a wrapper");

	// duplicate-reviewer refusal is per TARGET; a different target runs concurrently
	isas.running = true;
	const duplicate = await reviewTool.execute("t-dup", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(duplicate.isError, true);
	assert.match(duplicate.content[0].text, /already handling the review of PR 287/);
	assert.match(duplicate.content[0].text, /concurrently/);
	assert.equal(isas.spawned.length, 2, "a duplicate reviewer never spawns");
	const concurrent = await reviewTool.execute("t-concurrent", { repo: repoDir, scope: "pr", pr: 288 }, undefined, undefined, harness.ctx);
	assert.equal(concurrent.isError, undefined, "a different target runs concurrently (#289)");
	assert.equal(isas.spawned.length, 3);
	assert.equal(isas.spawned[2].name, "tuicr-review-pr-288");
	isas.running = false;
	const resumed = await reviewTool.execute("t-resume", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(resumed.isError, undefined);
	assert.equal(isas.spawned.length, 4, "a finished reviewer no longer blocks the same target");

	// explicit revset always launches — even with an active session present
	stage({ listInitial: [s288] });
	const revsetLaunch = await reviewTool.execute("t-revset", { repo: repoDir, scope: "revset", revset: "main..@-" }, undefined, undefined, harness.ctx);
	assert.equal(revsetLaunch.isError, undefined);
	assert.equal(revsetLaunch.details.slug, null);
	assert.equal(revsetLaunch.details.targetKey, "rev:main..@-");
	assert.equal(isas.spawned[4].name, "tuicr-review-rev-main");
	assert.match(isas.spawned[4].task, /commit range main\.\.@-/);
	assert.deepEqual(wrapperCalls(), [], "the review flow leaves wrapper launches to the subagent");

	// invalid scope fails fast — even with an active session to attach to
	stage({ listInitial: [s288] });
	const badScope = await reviewTool.execute("t-bad-scope", { repo: repoDir, scope: "pr" }, undefined, undefined, harness.ctx);
	assert.equal(badScope.isError, true);
	assert.match(badScope.content[0].text, /pr is required/);
	assert.equal(isas.spawned.length, 5, "an invalid scope spawns no reviewer");

	// an explicit missing slug errors, and an explicit slug attaches active-or-not
	stage({ listInitial: [s288] });
	const slugMissing = await reviewTool.execute("t-slug-missing", { repo: repoDir, sessionSlug: "zz" }, undefined, undefined, harness.ctx);
	assert.equal(slugMissing.isError, true);
	assert.match(slugMissing.content[0].text, /No tuicr session named zz/);
	stage({ listInitial: [{ slug: "s1", active: false }] });
	const slugAttach = await reviewTool.execute("t-slug-attach", { repo: repoDir, sessionSlug: "s1" }, undefined, undefined, harness.ctx);
	assert.equal(slugAttach.isError, undefined);
	assert.equal(slugAttach.details.slug, "s1");
	assert.equal(slugAttach.details.targetKey, "slug:s1");
	assert.equal(isas.spawned[5].name, "tuicr-review-slug-s1");
	assert.match(isas.spawned[5].task, /sessionSlug "s1"/);

	// bare call with several open PRs → error listing them, asking for pr
	stage({ listInitial: [], branch: "fix/a", openPrs: [
		{ number: 287, title: "chore: remove historical docs" },
		{ number: 288, title: "fix(agents): /simple" },
	] });
	const severalPrs = await reviewTool.execute("t-several-prs", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(severalPrs.isError, true);
	assert.match(severalPrs.content[0].text, /Several open PRs for branch fix\/a/);
	assert.match(severalPrs.content[0].text, /#287 chore: remove historical docs/);
	assert.match(severalPrs.content[0].text, /Pass pr explicitly/);
	assert.deepEqual(ghCalls().at(-1), ["pr", "list", "--head", "fix/a", "--state", "open", "--json", "number,title"]);

	// bare call with exactly one open PR matching an active session → attach
	stage({ listInitial: [s288], branch: "fix/a", openPrs: [{ number: 288, title: "t" }] });
	const defaultAttach = await reviewTool.execute("t-default-attach", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(defaultAttach.isError, undefined);
	assert.equal(defaultAttach.details.slug, "gh:owner/repo/pr/288");
	assert.equal(defaultAttach.details.targetKey, "pr:288");
	assert.equal(isas.spawned.length, 7);
	assert.equal(isas.spawned[6].name, "tuicr-review-pr-288");

	// ── T2 through the plain tuicr tool: parent launches, resolves by target ──

	// attachOnly never opens a pane; the refusal names the requested target
	stage({ listInitial: [s288] });
	const attachFail = await tuicrTool.execute("t-attach-fail", { repo: repoDir, attachOnly: true, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(attachFail.isError, true);
	assert.match(attachFail.content[0].text, /No active tuicr session for PR 287/);
	assert.match(attachFail.content[0].text, /do not launch one/);
	assert.deepEqual(wrapperCalls(), []);

	// pr:287 while PR-288 is active: the parent launches a pane for PR 287
	// and the watcher resolves THAT session by slug suffix — never PR-288's
	stage({ listInitial: [s288], listAfter: [s288, s287] });
	const prLaunch = await tuicrTool.execute("t-pr-launch", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(prLaunch.isError, undefined);
	// The wrapper spawns detached, so its log line lands asynchronously —
	// bounded poll before asserting (slow-host race, seen on macOS).
	await until(() => wrapperCalls().length >= 1, "wrapper launch for the explicit pr target");
	assert.deepEqual(wrapperCalls(), [`${repoDir} -- pr 287`], "wrapper receives the repo and the explicit pr target");
	assert.equal(prLaunch.details.slug, "gh:owner/repo/pr/287", "the PR target resolves its own session, not PR-288's");
	assert.equal(keepOpenCount(), 1);
	harness.commands.get("tuicr").handler("stop", harness.ctx);
	assert.equal(keepOpenCount(), 0);

	// bare call with no open PR: a working-tree pane launches even while
	// PR-288's session is active, and the watcher attaches to the session
	// that APPEARED after the launch — never to the pre-active one
	stage({ listInitial: [s288], listAfter: [s288, { slug: "wt-new", active: true }], branch: "main", openPrs: [] });
	const wtLaunch = await tuicrTool.execute("t-wt-launch", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(wtLaunch.isError, undefined);
	await until(() => wrapperCalls().length >= 1, "wrapper launch for the working-tree pane");
	assert.deepEqual(wrapperCalls(), [`${repoDir} -- -w`], "the default with no open PR launches a working-tree pane");
	assert.equal(wtLaunch.details.slug, "wt-new", "baseline diff owns the NEW session, not the pre-active one");
	assert.equal(keepOpenCount(), 1);
	harness.commands.get("tuicr").handler("stop", harness.ctx);
	assert.equal(keepOpenCount(), 0);

	// the subagent-side attach: attachOnly resolves the pane it owns
	stage({ listInitial: [s287] });
	const attachOk = await tuicrTool.execute("t-attach-ok", { repo: repoDir, attachOnly: true, sessionSlug: "gh:owner/repo/pr/287" }, undefined, undefined, harness.ctx);
	assert.equal(attachOk.isError, undefined);
	assert.equal(keepOpenCount(), 1, "the watcher holds one keep-open slot");
	assert.deepEqual(wrapperCalls(), [], "attachOnly never adds a wrapper launch");
	harness.commands.get("tuicr").handler("stop", harness.ctx);
	assert.equal(keepOpenCount(), 0, "stopping the watcher releases the slot");
	const noticesBefore = harness.notifications.length;
	harness.commands.get("tuicr").handler("stop", harness.ctx);
	assert.match(harness.notifications[noticesBefore].message, /No tuicr background watcher is running/);
	harness.commands.get("tuicr").handler("open pr abc", harness.ctx);
	assert.match(harness.notifications.at(-1).message, /positive PR number/);

	// ── T1: watcher loop end-to-end — steer, reply, no self-steer, final ──

	const baselineComment = { id: "u1", author: "user", path: "a.ts", start_line: 3, comment_type: "issue", content: "baseline comment" };
	const secondComment = { id: "u2", author: "user", path: "b.ts", start_line: 7, comment_type: "suggestion", content: "second comment" };
	const thirdComment = { id: "u3", author: "user", path: "c.ts", comment_type: "note", content: "third comment" };
	const watchedSession = { slug: "watched-s1", active: true };
	stage({ listInitial: [watchedSession], listAfter: [watchedSession], comments: [baselineComment] });
	const attach = await tuicrTool.execute("t-watch", { repo: repoDir, sessionSlug: "watched-s1" }, undefined, undefined, harness.ctx);
	assert.equal(attach.isError, undefined);
	assert.match(attach.content[0].text, /Attached to active tuicr review session watched-s1/);
	assert.equal(keepOpenCount(), 1);

	// a new user comment steers in as tuicr_review_comments; baseline does not
	writeFileSync(join(stateDir, "comments.json"), JSON.stringify([baselineComment, secondComment]));
	await until(
		() => harness.sent.some((entry) => entry.message.customType === "tuicr_review_comments"),
		"first comment steer",
	);
	const firstSteer = harness.sent.find((entry) => entry.message.customType === "tuicr_review_comments");
	assert.equal(firstSteer.message.details.slug, "watched-s1");
	assert.equal(firstSteer.message.details.count, 1);
	assert.match(firstSteer.message.content, /- \[suggestion\] b\.ts:7: second comment/);
	assert.doesNotMatch(firstSteer.message.content, /baseline comment/);
	assert.equal(firstSteer.options.deliverAs, "steer");
	assert.equal(firstSteer.options.triggerTurn, true);

	// the reply posts with a visible Re: anchor and a tracked reply id
	const replyResult = await replyTool.execute(
		"t-reply",
		{ message: "Fixed.\n\nDetails here.", file: "b.ts", line: 7, replyTo: "u2" },
		undefined,
		undefined,
		harness.ctx,
	);
	assert.equal(replyResult.isError, undefined);
	assert.equal(replyResult.details.posted, true);
	assert.equal(replyResult.details.slug, "watched-s1");
	assert.equal(replyResult.details.firstLine, "Fixed.");
	assert.deepEqual(JSON.parse(readFileSync(join(stateDir, "last-add.json"), "utf8")), [
		"review", "add", "--session", "watched-s1", "--repo", repoDir, "--username", "pi-agent",
		"--target-file", "b.ts", "--line", "7", "--", "Re: b.ts:7\n\nFixed.\n\nDetails here.",
	]);

	// v0.24 shape: the agent reply carries no author, only the tracked id —
	// the watcher must keep steering NEW user comments but never its own reply
	const ownReplyEcho = { id: "agent-1", path: "b.ts", start_line: 7, content: "Re: b.ts:7 — Fixed." };
	writeFileSync(join(stateDir, "comments.json"), JSON.stringify([baselineComment, secondComment, ownReplyEcho, thirdComment]));
	await until(
		() => harness.sent.filter((entry) => entry.message.customType === "tuicr_review_comments" && !entry.message.details.final).length >= 2,
		"second comment steer",
	);
	const secondSteer = harness.sent
		.filter((entry) => entry.message.customType === "tuicr_review_comments" && !entry.message.details.final)
		.at(-1);
	assert.equal(secondSteer.message.details.count, 1);
	assert.match(secondSteer.message.content, /- \[note\] c\.ts: third comment/);
	assert.doesNotMatch(secondSteer.message.content, /Fixed\./, "the agent's own reply never steers back (#246)");

	// the review ends: one final steer, the watcher stops, the slot releases
	const endedSession = { slug: "watched-s1", active: false };
	writeFileSync(join(stateDir, "list-initial.json"), JSON.stringify([endedSession]));
	writeFileSync(join(stateDir, "list-after.json"), JSON.stringify([endedSession]));
	await until(
		() => harness.sent.some((entry) => entry.message.customType === "tuicr_review_comments" && entry.message.details.final),
		"final steer on session end",
	);
	const finalSteer = harness.sent.find((entry) => entry.message.customType === "tuicr_review_comments" && entry.message.details.final);
	assert.match(finalSteer.message.content, /tuicr review session ended/);
	assert.equal(keepOpenCount(), 0, "the ended watcher releases its keep-open slot");
	const sentAfterFinal = harness.sent.length;
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(harness.sent.length, sentAfterFinal, "a stopped watcher never steers again");
	harness.handlers.get("session_shutdown")();
	assert.equal(keepOpenCount(), 0, "session shutdown is idempotent after the watcher stopped");

	// ── watcher launch-window robustness (unresolved slug) ──

	// ambiguity after launch: the watcher refuses to guess and steers once
	stage({ listInitial: [], listAfter: [{ slug: "a", active: true }, { slug: "b", active: true }] });
	const amb = await tuicrTool.execute("t-amb", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(amb.isError, undefined);
	assert.equal(amb.details.slug, null);
	assert.match(amb.content[0].text, /watcher will pick it up/);
	await until(
		() => harness.sent.some((entry) => entry.message.customType === "tuicr_review_comments" && entry.message.details.final && /several possible tuicr sessions/.test(entry.message.content)),
		"ambiguity final steer",
	);
	assert.equal(keepOpenCount(), 0);

	// no session ever activates: the watcher gives up and steers once
	stage({ listInitial: [], listAfter: [] });
	const gaveUp = await tuicrTool.execute("t-giveup", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(gaveUp.isError, undefined);
	await until(
		() => harness.sent.some((entry) => entry.message.customType === "tuicr_review_comments" && entry.message.details.final && /no review session became active/.test(entry.message.content)),
		"give-up final steer",
	);
	assert.equal(keepOpenCount(), 0);

	// ── failure paths: CLI outages, missing peers, missing wrapper ──

	// repeated tuicr CLI failures stop the watcher with exactly one final steer
	stage({ listInitial: [watchedSession], listAfter: [watchedSession], comments: [baselineComment] });
	const flakyAttach = await tuicrTool.execute("t-flaky", { repo: repoDir, sessionSlug: "watched-s1" }, undefined, undefined, harness.ctx);
	assert.equal(flakyAttach.isError, undefined);
	for (const name of ["list-initial.json", "list-after.json", "comments.json"]) {
		unlinkSync(join(stateDir, name));
	}
	await until(
		() => harness.sent.some((entry) => entry.message.customType === "tuicr_review_comments" && entry.message.details.final && /CLI kept failing/.test(entry.message.content)),
		"CLI-failure final steer",
	);
	assert.equal(keepOpenCount(), 0, "a failed watcher releases its keep-open slot");

	// the review flow fails loudly when interactive-subagents is not loaded
	const subagentsSeam = globalThis.__pi_interactive_subagents;
	delete globalThis.__pi_interactive_subagents;
	const noBridge = await reviewTool.execute("t-no-bridge", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(noBridge.isError, true);
	assert.match(noBridge.content[0].text, /interactive-subagents is not loaded/);
	globalThis.__pi_interactive_subagents = subagentsSeam;

	// no multiplexer: launching a pane is refused, not faked
	stage({ listInitial: [] });
	const savedHerdr = process.env.HERDR_ENV;
	delete process.env.HERDR_ENV;
	const noMux = await tuicrTool.execute("t-no-mux", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(noMux.isError, true);
	assert.match(noMux.content[0].text, /No multiplexer detected/);
	process.env.HERDR_ENV = savedHerdr;

	// the wrapper script must exist where the skill dir points
	const savedSkillDir = process.env.TUICR_SKILL_DIR;
	process.env.TUICR_SKILL_DIR = join(extRoot, "missing-skill");
	const noWrapper = await tuicrTool.execute("t-no-wrapper", { repo: repoDir }, undefined, undefined, harness.ctx);
	assert.equal(noWrapper.isError, true);
	assert.match(noWrapper.content[0].text, /wrapper not found/);
	process.env.TUICR_SKILL_DIR = savedSkillDir;

	// /tuicr watch (bare) drives the internal chat-watcher path end to end:
	// the branch's single open PR resolves to its matching active session
	stage({ listInitial: [s287], branch: "fix/a", openPrs: [{ number: 287, title: "t" }], comments: [baselineComment] });
	await harness.commands.get("tuicr").handler("watch", harness.ctx);
	assert.equal(keepOpenCount(), 1, "/tuicr watch starts the internal watcher");
	assert.match(harness.notifications.at(-1).message, /Attached to active tuicr review session gh:owner\/repo\/pr\/287/);
	harness.commands.get("tuicr").handler("stop", harness.ctx);
	assert.equal(keepOpenCount(), 0);

	// /tuicr open (the default action) drives the review flow, parent stays watcher-free
	stage({ listInitial: [s287, s288] });
	await harness.commands.get("tuicr").handler("open pr 287", harness.ctx);
	assert.equal(keepOpenCount(), 0, "/tuicr open leaves the parent watcher-free");
	assert.match(harness.notifications.at(-1).message, /Spawned the "tuicr-review-pr-287" subagent for PR 287/);

	// transcript renderer for comment batches renders without a real TUI
	const batchRenderer = harness.renderers.get("tuicr_review_comments");
	assert.ok(batchRenderer, "registers a tuicr_review_comments renderer");
	const renderedLines = batchRenderer(
		{ content: "tuicr review feedback (s): 2 new user comment(s).", details: { slug: "s", count: 2, final: false } },
		{ expanded: false },
		{ fg: (_color, text) => text, bold: (text) => text, bg: (_color, text) => text },
	).render(60);
	assert.ok(renderedLines.join("\n").includes("2 new review comment"), "renderer surfaces the batch count");

	// ── keep-open slot composition (#286 shared Symbol.for contract) ──

	// a numeric previous owner composes: its count survives, ours adds on top
	const previousOwner = () => 3;
	globalThis[KEEP_OPEN] = previousOwner;
	const modB = loadExtension();
	const composingCount = globalThis[KEEP_OPEN];
	assert.notEqual(composingCount, previousOwner, "tuicr republishes a composing wrapper, not a clobber");
	assert.equal(composingCount(), 3, "the previous owner's open count survives the load");

	// increment/release symmetry through a real watcher start/stop
	const harnessB = makeHarness();
	modB.default(harnessB.pi);
	const toolB = harnessB.tools.find((tool) => tool.name === "tuicr");
	stage({ listInitial: [watchedSession], listAfter: [watchedSession], comments: [baselineComment] });
	const attachB = await toolB.execute("k-attach", { repo: repoDir, sessionSlug: "watched-s1" }, undefined, undefined, harnessB.ctx);
	assert.equal(attachB.isError, undefined);
	assert.equal(composingCount(), 4, "a running watcher adds exactly one slot");
	harnessB.commands.get("tuicr").handler("stop", harnessB.ctx);
	assert.equal(composingCount(), 3, "stopping releases exactly that slot — symmetric");

	// repeated session_start (factory) invocations stay idempotent
	modB.default(makeHarness().pi);
	modB.default(makeHarness().pi);
	assert.equal(globalThis[KEEP_OPEN], composingCount, "repeated factory calls never re-publish the slot");
	assert.equal(composingCount(), 3);

	// a broken previous owner counts as 0 instead of crashing every read
	globalThis[KEEP_OPEN] = () => {
		throw new Error("broken owner");
	};
	const modC = loadExtension();
	assert.equal(globalThis[KEEP_OPEN](), 0, "a broken previous owner reads as 0");

	// a non-function previous value counts as 0 too
	globalThis[KEEP_OPEN] = 42;
	const modD = loadExtension();
	assert.equal(globalThis[KEEP_OPEN](), 0, "a non-function previous value reads as 0");

	// ── cross-load-order composition (C28): the shared keep-open-slot module ──
	// Both writers publish through one module (keep-open-slot.mjs), so either
	// load order must sum both counts, repeated loads must REPLACE (never
	// stack) their own entry, and each side releases exactly its own slot.
	// This drives the REAL tuicr watcher and the REAL pane module's
	// run-tracking count in one process — both load orders.
	{
		const HOLDER_KEY = Symbol.for("pi-subagents/keep-open-slot-holder");
		const WATCH_STATE_KEY = Symbol.for("pi-no-mistakes/watch-state");
		const savedHolder = globalThis[HOLDER_KEY];
		const savedSlot = globalThis[KEEP_OPEN];
		const savedWatchState = globalThis[WATCH_STATE_KEY];
		// The pane module needs only a pi-tui stub (visibleWidth +
		// wrapTextWithAnsi); typebox resolves from NODE_PATH like everywhere
		// else in this suite.
		const paneTui = join(extRoot, "pane-tui.cjs");
		writeFileSync(paneTui, [
			"exports.visibleWidth = (text) => [...String(text)].length;",
			"exports.wrapTextWithAnsi = (text) => String(text).split('\\n');",
		].join("\n"));
		const loadPane = () =>
			createJiti(import.meta.url, {
				moduleCache: false,
				alias: { "@earendil-works/pi-tui": paneTui },
			})("./no-mistakes-pane.ts");
		const paneTrackingOn = () => {
			globalThis[WATCH_STATE_KEY] = { trackedRunId: "01XX", calls: new Map() };
		};
		const paneTrackingOff = () => {
			globalThis[WATCH_STATE_KEY] = undefined;
		};
		const restoreKey = (key, value) => {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		};
		try {
			// Order A: the pane module loads FIRST, tuicr second.
			restoreKey(KEEP_OPEN, undefined);
			paneTrackingOff();
			loadPane();
			paneTrackingOn();
			assert.equal(globalThis[KEEP_OPEN](), 1, "pane-first: the pane side counts alone");
			const modA = loadExtension();
			assert.equal(globalThis[KEEP_OPEN](), 1, "pane-first: tuicr's load composes, never clobbers");
			const harnessA = makeHarness();
			modA.default(harnessA.pi);
			stage({ listInitial: [watchedSession], listAfter: [watchedSession], comments: [baselineComment] });
			const toolA = harnessA.tools.find((tool) => tool.name === "tuicr");
			const attachA = await toolA.execute("c28-a", { repo: repoDir, sessionSlug: "watched-s1" }, undefined, undefined, harnessA.ctx);
			assert.equal(attachA.isError, undefined);
			assert.equal(globalThis[KEEP_OPEN](), 2, "pane-first: a running watcher sums with the pane's count");
			harnessA.commands.get("tuicr").handler("stop", harnessA.ctx);
			assert.equal(globalThis[KEEP_OPEN](), 1, "pane-first: stopping releases exactly the watcher's slot");
			// Repeated pane loads replace their own entry — the old
			// capture-and-wrap design stacked a layer per reload; the shared
			// module cannot. (The pane module's own reload semantics tear the
			// previous watch state down first, so drive the count off/on around
			// the reloads exactly like a real extension reload does.)
			paneTrackingOff();
			loadPane();
			loadPane();
			paneTrackingOn();
			assert.equal(globalThis[KEEP_OPEN](), 1, "repeated pane loads never stack their own count");
			paneTrackingOff();
			assert.equal(globalThis[KEEP_OPEN](), 0, "the pane side releases with its watch state");

			// Order B: tuicr loads FIRST, the pane module second.
			restoreKey(KEEP_OPEN, undefined);
			restoreKey(HOLDER_KEY, undefined); // fresh holder for the fresh composition
			const modB2 = loadExtension();
			const harnessB2 = makeHarness();
			modB2.default(harnessB2.pi);
			stage({ listInitial: [watchedSession], listAfter: [watchedSession], comments: [baselineComment] });
			const toolB2 = harnessB2.tools.find((tool) => tool.name === "tuicr");
			const attachB2 = await toolB2.execute("c28-b", { repo: repoDir, sessionSlug: "watched-s1" }, undefined, undefined, harnessB2.ctx);
			assert.equal(attachB2.isError, undefined);
			assert.equal(globalThis[KEEP_OPEN](), 1, "tuicr-first: the watcher counts alone");
			paneTrackingOff();
			loadPane();
			paneTrackingOn();
			assert.equal(globalThis[KEEP_OPEN](), 2, "tuicr-first: the pane's load composes, never clobbers");
			paneTrackingOff();
			assert.equal(globalThis[KEEP_OPEN](), 1, "tuicr-first: the pane side releases exactly its own count");
			harnessB2.commands.get("tuicr").handler("stop", harnessB2.ctx);
			assert.equal(globalThis[KEEP_OPEN](), 0, "tuicr-first: both sides released");
		} finally {
			restoreKey(HOLDER_KEY, savedHolder);
			restoreKey(KEEP_OPEN, savedSlot);
			restoreKey(WATCH_STATE_KEY, savedWatchState);
		}
	}
} finally {
	restoreEnv();
	rmSync(extRoot, { recursive: true, force: true });
}

console.log("tuicr.test.mjs: all assertions passed");
