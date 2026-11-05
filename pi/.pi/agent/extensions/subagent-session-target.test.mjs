// Paths: pi/.pi/agent/extensions/interactive-subagents/**
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { HOMEBREW_JITI, NVM_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI, NVM_JITI] });
const { createJiti } = require(jitiPath);

/** A fake rex that logs argv and answers session lookup and tab creation. */
function fakeRex() {
	const dir = mkdtempSync(join(tmpdir(), "fake-rex-"));
	const log = join(dir, "argv.log");
	const rex = join(dir, "rex");
	writeFileSync(rex, `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  *"ls --json"*) printf '%s' '{"sessions":[{"session_id":"session:mission","label":"mission-rex-army"}]}' ;;
  *"window new"*) printf '%s' '{"block_ids":["block:child"]}' ;;
  *"split"*) printf '%s' '{"block_ids":["block:child"]}' ;;
esac
`);
	chmodSync(rex, 0o755);
	return { dir, log, calls: () => readFileSync(log, "utf8").trim().split("\n") };
}

/** Run `fn` with a fake rex and a controlled environment, then restore it. */
function withEnv(extra, fn) {
	const saved = { ...process.env };
	Object.assign(process.env, extra);
	try {
		return fn();
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in saved)) delete process.env[key];
		}
		Object.assign(process.env, saved);
	}
}

const base = {
	REX_SESSION: "session:army",
	REX_BLOCK: "block:army",
	PI_SUBAGENT_CWD: "/worktree",
};

test("a child tab follows PI_SUBAGENT_SESSION and the child cwd", () => {
	const fake = fakeRex();
	const rex = createJiti(import.meta.url)("./interactive-subagents/pi-extension/subagents/rex.ts");
	withEnv({ ...base, PATH: `${fake.dir}:${process.env.PATH}`, PI_SUBAGENT_SESSION: "mission-rex-army" }, () => {
		assert.equal(rex.createSurface("trooper-S03"), "block:child");
		const created = fake.calls().find(line => line.includes("window new"));
		assert.ok(created, "no window new call was made");
		assert.match(created, /-s session:mission/);
		assert.match(created, /-c \/worktree/);
		assert.match(created, /π trooper-S03/);
	});
});

test("without PI_SUBAGENT_SESSION a child stays in the caller's session", () => {
	const fake = fakeRex();
	const rex = createJiti(import.meta.url)("./interactive-subagents/pi-extension/subagents/rex.ts");
	withEnv({ ...base, PATH: `${fake.dir}:${process.env.PATH}` }, () => {
		delete process.env.PI_SUBAGENT_SESSION;
		rex.createSurface("trooper-S04");
		const created = fake.calls().find(line => line.includes("window new"));
		assert.ok(created, "no window new call was made");
		assert.match(created, /-s session:army/);
	});
});

test("a split stays beside its anchor and keeps the anchor's session", () => {
	const fake = fakeRex();
	const rex = createJiti(import.meta.url)("./interactive-subagents/pi-extension/subagents/rex.ts");
	withEnv({ ...base, PATH: `${fake.dir}:${process.env.PATH}`, PI_SUBAGENT_SESSION: "mission-rex-army" }, () => {
		assert.equal(rex.createSurfaceSplit("trooper-S05", "right", "block:army"), "block:child");
		const split = fake.calls().find(line => line.includes("split"));
		assert.ok(split, "no split call was made");
		assert.match(split, /-s session:army/);
		assert.match(split, /-b block:army/);
	});
});

test("an explicit session argument wins over the environment", () => {
	const fake = fakeRex();
	const rex = createJiti(import.meta.url)("./interactive-subagents/pi-extension/subagents/rex.ts");
	withEnv({ ...base, PATH: `${fake.dir}:${process.env.PATH}`, PI_SUBAGENT_SESSION: "mission-from-env" }, () => {
		rex.createSurface("trooper-S06", { session: "mission-rex-army", cwd: "/explicit" });
		const created = fake.calls().find(line => line.includes("window new"));
		assert.ok(created, "no window new call was made");
		assert.match(created, /-s session:mission/);
		assert.match(created, /-c \/explicit/);
	});
});

test("an explicit target session carries the child's later sends and captures", () => {
	const fake = fakeRex();
	const rex = createJiti(import.meta.url)("./interactive-subagents/pi-extension/subagents/rex.ts");
	// The caller is the captain, seated in the army session. The trooper it
	// deploys is named the mission session, so the tab lands there.
	withEnv({ ...base, PATH: `${fake.dir}:${process.env.PATH}`, REX_SESSION: "session:army" }, () => {
		delete process.env.PI_SUBAGENT_SESSION;
		const child = rex.createSurface("trooper-S05", { session: "mission-rex-army" });
		assert.equal(child, "block:child");
		const created = fake.calls().find(line => line.includes("window new"));
		assert.match(created, /-s session:mission/);
		assert.doesNotMatch(created, /-s session:army/);
		// Every later call the captain makes on that block resolves inside the
		// session that owns it: rex refuses a block target from another session.
		rex.sendCommand(child, "echo hello");
		rex.readScreen(child, 5);
		const scoped = fake.calls().filter(line => /^(send|send-key|capture)\b/.test(line));
		assert.equal(scoped.length, 3);
		for (const line of scoped) {
			assert.match(line, /-s session:mission/, `not scoped to the child's session: ${line}`);
			assert.match(line, /-b block:child/, `no block target: ${line}`);
			assert.doesNotMatch(line, /-s session:army/, `the caller's session leaked into ${line}`);
		}
	});
});

test("an unknown session name fails and names the live sessions", () => {
	const fake = fakeRex();
	const rex = createJiti(import.meta.url)("./interactive-subagents/pi-extension/subagents/rex.ts");
	withEnv({ ...base, PATH: `${fake.dir}:${process.env.PATH}`, REX_SESSION: "session:army", REX_BLOCK: "block:army", PI_SUBAGENT_CWD: "/worktree" }, () => {
		assert.throws(
			() => rex.createSurface("trooper-S07", { session: "mission-missing" }),
			/unknown session "mission-missing"; live sessions: mission-rex-army/,
		);
	});
});

console.log("subagent session target tests passed");
