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

console.log("subagent session target tests passed");
