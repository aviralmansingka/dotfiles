#!/usr/bin/env node
// Extension loader smoke (CI meta layer, rule A3/A4).
//
// Guards the PR #230 failure class: a non-factory or unimportable .ts under
// pi/.pi/agent/extensions/ broke EVERY pi session machine-wide, and no
// per-extension unit test can see it, because unit tests import the modules
// they own, while pi imports whatever settings.json lists.
//
// This script:
//   1. asserts every `+extensions/...` entry in pi/.pi/agent/settings.json
//      exists on disk (no dangling references), and
//   2. jiti-imports EVERY .ts under pi/.pi/agent/extensions/ (top-level and
//      nested) with stubbed external packages, asserting each top-level file
//      exports a default factory function. Nested files must at least load.
//
// External imports are stubbed with the same mechanism the unit tests use
// (jiti alias to temp .cjs stubs, see tool-call-renderer-public.test.mjs):
// '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui',
// '@earendil-works/pi-ai', 'turndown', '@mozilla/readability', 'linkedom'.
// 'typebox' resolves from NODE_PATH (pinned typebox@1.3.27 next to jiti).
//
// Offline, deterministic, no sleeps. Set JITI_PATH and NODE_PATH as in
// docs/ci-tests/ci-meta.md.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Shared jiti/typebox resolution contract (pi/.pi/agent/extensions/
// test-lib/jiti.mjs): explicit JITI_PATH first (validated loudly — a stale
// value never falls through silently), then NODE_PATH entries, then pi's
// managed install. When nothing resolves and no explicit JITI_PATH was
// given, the smoke bootstraps jiti@2 + typebox@1.3.27 into a temp prefix
// (the same recipe as scripts/nm-test.sh), so it never depends on the
// caller's env (rel-classifier hit 11 `Cannot find module 'typebox'`
// failures running the smoke without the env).
import { resolveJiti } from "../pi/.pi/agent/extensions/test-lib/jiti.mjs";

function resolveJitiWithBootstrap() {
  if (process.env.JITI_PATH) return resolveJiti(); // explicit env: loud, no masking
  try {
    return resolveJiti();
  } catch (error) {
    const root = mkdtempSync(join(tmpdir(), "loader-smoke-jiti-"));
    const installed = spawnSync("npm", ["install", "--prefix", root, "jiti@2", "typebox@1.3.27"], { encoding: "utf8" });
    const jitiPath = join(root, "node_modules", "jiti", "lib", "jiti.cjs");
    if (installed.status === 0 && existsSync(jitiPath)) {
      return { jitiPath, nodePath: join(root, "node_modules") };
    }
    throw new Error(`jiti not found and the bootstrap failed: ${error?.message ?? error}`);
  }
}

const require = createRequire(import.meta.url);
const { jitiPath, nodePath } = resolveJitiWithBootstrap();
// typebox sits next to jiti; make node's resolver see it even when the
// caller exported no NODE_PATH.
if (!(process.env.NODE_PATH || "").split(":").includes(nodePath)) {
  process.env.NODE_PATH = `${nodePath}${process.env.NODE_PATH ? ":" + process.env.NODE_PATH : ""}`;
  Module._initPaths();
}
const { createJiti } = require(jitiPath);

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const agentDir = join(scriptDir, "..", "pi", ".pi", "agent");
const extensionsDir = join(agentDir, "extensions");

// A recursive callable stub: every property of the stub module (and of
// every value it returns) is the same callable proxy, so import-time
// expressions like `Type.Object({...})` or `class X extends Stub` never
// crash on missing members.
const STUB_SOURCE = [
  "const fn = new Proxy(function stub() { return fn; }, {",
  "  get(_target, key) { return typeof key === 'symbol' ? undefined : fn; },",
  "});",
  "module.exports = fn;",
].join("\n");

const STUBBED_SPECIFIERS = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-ai",
  "turndown",
  "@mozilla/readability",
  "linkedom",
];

function walkTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    // Never descend into dependency dirs: a host-side node_modules under a
    // stowed package (web-fetch/linkedom) is runtime state, not a repo
    // extension — importing its .d.ts files as factories is meaningless and
    // fails on files like types/dom/token-list.d.ts.
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...walkTsFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(join(dir, entry.name));
  }
  return out;
}

const tsFiles = walkTsFiles(extensionsDir);
assert.ok(tsFiles.length > 0, "no .ts files found under pi/.pi/agent/extensions/");

const tempRoot = mkdtempSync(join(tmpdir(), "extension-loader-smoke-"));
let failures = 0;
try {
  const stubPath = join(tempRoot, "stub.cjs");
  writeFileSync(stubPath, STUB_SOURCE);
  const alias = Object.fromEntries(STUBBED_SPECIFIERS.map((s) => [s, stubPath]));
  const jiti = createJiti(import.meta.url, { alias });

  let factories = 0;
  let libraries = 0;
  for (const file of tsFiles) {
    const rel = relative(extensionsDir, file);
    try {
      const mod = jiti(file);
      if (!rel.includes(sep)) {
        // Top-level files are settings.json candidates: pi calls their
        // default export as a factory. A missing or non-function default is
        // the PR #230 class.
        assert.equal(typeof mod?.default, "function", `${rel} must export a default factory function`);
        factories++;
      } else {
        libraries++;
      }
      console.log(`ok   ${rel}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${rel}: ${error?.message ?? error}`);
    }
  }

  // settings.json `+extensions/...` entries must exist on disk.
  const settingsPath = join(agentDir, "settings.json");
  assert.ok(existsSync(settingsPath), "pi/.pi/agent/settings.json not found");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  for (const entry of settings.extensions ?? []) {
    if (!entry.startsWith("+")) continue;
    const target = join(agentDir, entry.slice(1));
    assert.ok(existsSync(target), `settings.json lists ${entry} but ${target} does not exist`);
    console.log(`ok   settings.json entry ${entry} exists`);
  }

  console.log(
    `Passed: ${factories} top-level factories export default, ${libraries} nested modules load, settings.json entries exist.`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`Failed: ${failures} extension module(s) failed to load.`);
  process.exit(1);
}
process.exit(0);
