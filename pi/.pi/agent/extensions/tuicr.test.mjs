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
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildReplyArgs,
	buildReviewSubagentTask,
	buildWrapperArgs,
	collectSeenKeys,
	commentKey,
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
	resolveSkillDir,
	resolveTargetSession,
	scopeToTuicrArgs,
	selectWrapper,
	shouldDeliverBatch,
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

assert.deepEqual(parseTuicrCommandArgs(""), { action: "open", scope: "working-tree" });
assert.deepEqual(parseTuicrCommandArgs("open"), { action: "open", scope: "working-tree" });
assert.deepEqual(parseTuicrCommandArgs("open pr 272"), {
	action: "open", scope: "pr", pr: 272,
});
assert.deepEqual(parseTuicrCommandArgs("pr 272"), {
	action: "open", scope: "pr", pr: 272,
});
assert.deepEqual(parseTuicrCommandArgs("open -r main..@-"), {
	action: "open", scope: "revset", revset: "main..@-",
});
assert.deepEqual(parseTuicrCommandArgs("watch"), {
	action: "watch", scope: "working-tree",
});
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

// ── review subagent task and launch result ──

const taskKnown = buildReviewSubagentTask({
	repo: "/repo", slug: "s1", scope: "pr", revset: undefined, pr: 272,
});
assert.match(taskKnown, /PR 272/);
assert.match(taskKnown, /sessionSlug "s1"/);
assert.match(taskKnown, /attachOnly true/);
assert.match(taskKnown, /tuicr_reply/);
assert.match(taskKnown, /merge or review later/);
const taskUnresolved = buildReviewSubagentTask({
	repo: "/repo", slug: null, scope: "working-tree", revset: undefined, pr: undefined,
});
assert.match(taskUnresolved, /working tree/);
assert.match(taskUnresolved, /Never launch a new pane/);
assert.match(taskUnresolved, /retry for up to a minute/);

// Scope args are validated on the attach path too — no pane launches, so
// scopeToTuicrArgs never runs upstream of the task build.
assert.throws(
	() => buildReviewSubagentTask({ repo: "/repo", slug: "s1", scope: "pr", revset: undefined, pr: undefined }),
	/pr is required/,
);
assert.throws(
	() => buildReviewSubagentTask({ repo: "/repo", slug: "s1", scope: "revset", revset: undefined, pr: undefined }),
	/revset is required/,
);
assert.throws(
	() => buildReviewSubagentTask({ repo: "/repo", slug: "s1", scope: "staged", revset: undefined, pr: undefined }),
	/Unknown scope/,
);

// Attaching names the session actually watched, not the requested scope.
const taskAttached = buildReviewSubagentTask({
	repo: "/repo", slug: "s1", attached: true, scope: "pr", revset: undefined, pr: 272,
});
assert.match(taskAttached, /active tuicr session s1/);
assert.doesNotMatch(taskAttached, /PR 272/);
assert.match(taskAttached, /sessionSlug "s1"/);

// Pre-attach comments are swept, and any final steer ends the flow.
assert.match(taskKnown, /existed before the watcher attached/);
assert.match(taskKnown, /tuicr review comments --session <slug> --repo <repo>/);
assert.match(taskKnown, /no pi-agent reply/);
assert.match(taskKnown, /watcher stopped early/);

const reviewLaunch = formatReviewLaunchResult({
	repo: "/repo", slug: "s1", attached: false, subagent: "tuicr-review",
});
assert.match(reviewLaunch, /session s1 is active/);
assert.match(reviewLaunch, /"tuicr-review" subagent now watches/);
assert.match(reviewLaunch, /merge or review later/);
const reviewAttach = formatReviewLaunchResult({
	repo: "/repo", slug: "s1", attached: true, subagent: "tuicr-review",
});
assert.match(reviewAttach, /Attached to the active tuicr review session/);
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

// ── resolveTargetSession (#289: explicit target, never any-active) ──

const s288 = { slug: "gh:owner/repo/pr/288", active: true, kind: "pr" };
const s287 = { slug: "gh:owner/repo/pr/287", active: true, kind: "pr" };
const localSession = { slug: "wt@x/working", active: true, kind: "local" };
const revsetSession = { slug: "rev@x/commits/main..@", active: true, kind: "local" };

// explicit slug resolves to that slug or reports it missing
assert.equal(resolveTargetSession([s288], { sessionSlug: "gh:owner/repo/pr/288" }).status, "ok");
assert.deepEqual(resolveTargetSession([s288], { sessionSlug: "zz" }), { status: "missing", slug: "zz" });
// explicit slug outranks a disagreeing scope
assert.equal(
	resolveTargetSession([s288], { sessionSlug: "gh:owner/repo/pr/288", scope: "pr", pr: 287 }).session.slug,
	"gh:owner/repo/pr/288",
);
// a pr target matches its own session even with another active session (#289)
const prPick = resolveTargetSession([s287, s288], { scope: "pr", pr: 287 });
assert.equal(prPick.status, "ok");
assert.equal(prPick.session.slug, "gh:owner/repo/pr/287");
// a pr target miss with others active reports missing — never any-active
const prMiss = resolveTargetSession([s288], { scope: "pr", pr: 287 });
assert.equal(prMiss.status, "missing");
assert.equal(prMiss.target, "PR 287");
assert.deepEqual(prMiss.sessions, [s288]);
// nothing active at all → none, so the caller may launch a fresh pane
assert.equal(resolveTargetSession([{ slug: "gh:owner/repo/pr/288", active: false }], { scope: "pr", pr: 287 }).status, "none");
assert.equal(resolveTargetSession([], { scope: "pr", pr: 287 }).status, "none");
// the pr number must match exactly, not as a prefix
assert.equal(resolveTargetSession([{ slug: "gh:owner/repo/pr/2873", active: true }], { scope: "pr", pr: 287 }).status, "missing");
// local sessions never satisfy a pr target
assert.equal(resolveTargetSession([localSession], { scope: "pr", pr: 287 }).status, "missing");
// revset targets match a session naming that commit range
assert.equal(resolveTargetSession([revsetSession], { scope: "revset", revset: "main..@" }).status, "ok");
assert.equal(resolveTargetSession([revsetSession], { scope: "revset", revset: "other..range" }).status, "missing");
assert.equal(resolveTargetSession([], { scope: "revset", revset: "main..@" }).status, "none");
// no explicit target keeps the single-active attach convenience
assert.equal(resolveTargetSession([localSession], {}).status, "ok");
assert.equal(resolveTargetSession([localSession, s288], {}).status, "ambiguous");
assert.equal(resolveTargetSession([{ slug: "x", active: false }], {}).status, "none");

// ── extension behavior: jiti + fake tuicr/git binaries + stubbed peers ──
// House pattern (mermaid/no-mistakes style): the tuicr/gh/git CLIs never run
// for real — fake binaries land on PATH before the extension imports, the
// wrapper script is a stub under TUICR_SKILL_DIR, and every scenario stages
// the comment/session fixtures the fake CLI serves. No network, no panes.

const require = createRequire(import.meta.url);
const installRoot = join(homedir(), ".pi/agent/install");
const versionFile = join(installRoot, "current-version");
const jitiPath = [
	process.env.JITI_PATH,
	existsSync(versionFile) && join(installRoot, "releases", readFileSync(versionFile, "utf8").trim(), "node_modules/jiti/lib/jiti.cjs"),
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
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

// fake git: rev-parse --show-toplevel echoes the -C directory
writeFileSync(join(binDir, "git"), `#!/bin/sh
root=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-C" ]; then root="$2"; shift 2; else shift; fi
done
echo "$root"
`);
chmodSync(join(binDir, "git"), 0o755);

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

	function stage({ listInitial = [], listAfter = listInitial, comments = [] } = {}) {
		for (const name of ["calls.log", "wrapper.log", "launched", "last-add.json"]) {
			try {
				unlinkSync(join(stateDir, name));
			} catch {}
		}
		writeFileSync(join(stateDir, "list-initial.json"), JSON.stringify(listInitial));
		writeFileSync(join(stateDir, "list-after.json"), JSON.stringify(listAfter));
		writeFileSync(join(stateDir, "comments.json"), JSON.stringify(comments));
	}
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
			return { content: [{ type: "text", text: "watching the review" }], details: { name: "tuicr-review" } };
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

	// ── T2: explicit target resolution through both tools (#289) ──

	// pr:287 while PR-288's session is the active one → refusal, never attach
	stage({ listInitial: [s288] });
	const wrongPr = await reviewTool.execute("t-wrong-pr", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(wrongPr.isError, true);
	assert.match(wrongPr.content[0].text, /PR 287/);
	assert.match(wrongPr.content[0].text, /pr\/288/);
	assert.match(wrongPr.content[0].text, /never attaches to another session/);
	assert.equal(isas.spawned.length, 0, "no reviewer spawns for a wrong-session request");
	assert.deepEqual(wrapperCalls(), [], "no wrapper launches for a wrong-session request");
	assert.equal(keepOpenCount(), 0);
	const wrongWatch = await tuicrTool.execute("t-wrong-watch", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(wrongWatch.isError, true);
	assert.match(wrongWatch.content[0].text, /PR 287/);

	// pr:287 with both PR sessions active → attaches to the RIGHT one
	stage({ listInitial: [s287, s288] });
	const rightPr = await reviewTool.execute("t-right-pr", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(rightPr.isError, undefined);
	assert.equal(rightPr.details.slug, "gh:owner/repo/pr/287");
	assert.equal(rightPr.details.attached, true);
	assert.equal(isas.spawned.length, 1);
	assert.equal(isas.spawned[0].agent, "tuicr-review");
	assert.equal(isas.spawned[0].cwd, repoDir);
	assert.match(isas.spawned[0].task, /active tuicr session gh:owner\/repo\/pr\/287/);
	assert.deepEqual(wrapperCalls(), [], "attach never launches a wrapper");

	// duplicate-reviewer refusal is per target repo, and liveness unblocks it
	isas.running = true;
	const duplicate = await reviewTool.execute("t-dup", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(duplicate.isError, true);
	assert.match(duplicate.content[0].text, /already handling the review/);
	assert.equal(isas.spawned.length, 1, "a duplicate reviewer never spawns");
	isas.running = false;
	const resumed = await reviewTool.execute("t-resume", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(resumed.isError, undefined);
	assert.equal(isas.spawned.length, 2, "a finished reviewer no longer blocks the next review");

	// revset targets: match by slug, refuse on a named-range miss
	stage({ listInitial: [revsetSession] });
	const revsetOk = await reviewTool.execute("t-revset", { repo: repoDir, scope: "revset", revset: "main..@" }, undefined, undefined, harness.ctx);
	assert.equal(revsetOk.isError, undefined);
	assert.equal(revsetOk.details.slug, "rev@x/commits/main..@");
	const revsetMiss = await reviewTool.execute("t-revset-miss", { repo: repoDir, scope: "revset", revset: "other..range" }, undefined, undefined, harness.ctx);
	assert.equal(revsetMiss.isError, true);
	assert.match(revsetMiss.content[0].text, /commit range other\.\.range/);

	// invalid scope fails fast — even with an active session to attach to
	stage({ listInitial: [s288] });
	const badScope = await reviewTool.execute("t-bad-scope", { repo: repoDir, scope: "pr" }, undefined, undefined, harness.ctx);
	assert.equal(badScope.isError, true);
	assert.match(badScope.content[0].text, /pr is required/);
	assert.equal(isas.spawned.length, 3, "an invalid scope spawns no reviewer");

	// explicit sessionSlug outranks a disagreeing pr scope
	const slugWins = await reviewTool.execute("t-slug-wins", { repo: repoDir, scope: "pr", pr: 287, sessionSlug: "gh:owner/repo/pr/288" }, undefined, undefined, harness.ctx);
	assert.equal(slugWins.isError, undefined);
	assert.equal(slugWins.details.slug, "gh:owner/repo/pr/288");

	// ── T2: attachOnly contract and the launch flow ──

	// attachOnly never opens a pane; failure while nothing is active
	stage({ listInitial: [] });
	const attachFail = await tuicrTool.execute("t-attach-fail", { repo: repoDir, attachOnly: true }, undefined, undefined, harness.ctx);
	assert.equal(attachFail.isError, true);
	assert.match(attachFail.content[0].text, /do not launch one/);
	assert.deepEqual(wrapperCalls(), []);

	// fresh pr review: wrapper spawns detached with the explicit scope, the
	// session registers, the reviewer spawns against that exact target
	stage({ listInitial: [], listAfter: [s287] });
	const launched = await reviewTool.execute("t-launch", { repo: repoDir, scope: "pr", pr: 287 }, undefined, undefined, harness.ctx);
	assert.equal(launched.isError, undefined);
	assert.equal(launched.details.slug, "gh:owner/repo/pr/287");
	assert.equal(launched.details.attached, false);
	assert.deepEqual(wrapperCalls(), [`${repoDir} -- pr 287`], "wrapper receives the repo and the explicit scope");
	assert.equal(isas.spawned.length, 5);
	assert.match(isas.spawned[4].task, /PR 287/);
	assert.match(isas.spawned[4].task, /sessionSlug "gh:owner\/repo\/pr\/287"/);
	assert.equal(keepOpenCount(), 0, "the review flow leaves the parent watcher-free");

	// the subagent-side attach: attachOnly resolves the pane the parent owns
	const attachOk = await tuicrTool.execute("t-attach-ok", { repo: repoDir, attachOnly: true, sessionSlug: "gh:owner/repo/pr/287" }, undefined, undefined, harness.ctx);
	assert.equal(attachOk.isError, undefined);
	assert.equal(keepOpenCount(), 1, "the watcher holds one keep-open slot");
	assert.deepEqual(wrapperCalls(), [`${repoDir} -- pr 287`], "attachOnly never adds a wrapper launch");
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
	const attach = await tuicrTool.execute("t-watch", { repo: repoDir }, undefined, undefined, harness.ctx);
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
		() => harness.sent.some((entry) => entry.message.customType === "tuicr_review_comments" && entry.message.details.final && /several tuicr sessions/.test(entry.message.content)),
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
	const flakyAttach = await tuicrTool.execute("t-flaky", { repo: repoDir }, undefined, undefined, harness.ctx);
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

	// /tuicr watch drives the internal chat-watcher path end to end
	stage({ listInitial: [watchedSession], listAfter: [watchedSession], comments: [baselineComment] });
	await harness.commands.get("tuicr").handler("watch", harness.ctx);
	assert.equal(keepOpenCount(), 1, "/tuicr watch starts the internal watcher");
	assert.match(harness.notifications.at(-1).message, /Attached to active tuicr review session watched-s1/);
	harness.commands.get("tuicr").handler("stop", harness.ctx);
	assert.equal(keepOpenCount(), 0);

	// /tuicr open (the default action) drives the review flow, parent stays watcher-free
	stage({ listInitial: [s287, s288] });
	await harness.commands.get("tuicr").handler("open pr 287", harness.ctx);
	assert.equal(keepOpenCount(), 0, "/tuicr open leaves the parent watcher-free");
	assert.match(harness.notifications.at(-1).message, /gh:owner\/repo\/pr\/287/);

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
	const attachB = await toolB.execute("k-attach", { repo: repoDir }, undefined, undefined, harnessB.ctx);
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
} finally {
	restoreEnv();
	rmSync(extRoot, { recursive: true, force: true });
}

console.log("tuicr.test.mjs: all assertions passed");
