import assert from "node:assert/strict";
import {
	buildReplyArgs,
	buildWrapperArgs,
	collectSeenKeys,
	commentKey,
	formatCommentLine,
	formatLaunchResult,
	formatReplyCall,
	formatReplyResult,
	formatSteerContent,
	newComments,
	parseCommentPayload,
	parseSessionList,
	pickSession,
	postTuicrReply,
	resolveSkillDir,
	scopeToTuicrArgs,
	selectWrapper,
	shouldDeliverBatch,
	truncateLines,
} from "./tuicr-background-core.mjs";

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
assert.throws(() => scopeToTuicrArgs("staged"), /Unknown scope/);
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
	[[{ slug: "a", active: true }, { slug: "b", active: true }], /Multiple active tuicr sessions/],
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

console.log("tuicr-background.test.mjs: all assertions passed");
