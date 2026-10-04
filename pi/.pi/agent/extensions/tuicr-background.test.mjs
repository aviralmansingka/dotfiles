import assert from "node:assert/strict";
import {
	buildWrapperArgs,
	collectSeenKeys,
	commentKey,
	formatCommentLine,
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

console.log("tuicr-background.test.mjs: all assertions passed");
