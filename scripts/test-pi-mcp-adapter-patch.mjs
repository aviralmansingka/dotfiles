// Paths: scripts/pi-mcp-adapter-patch scripts/test-pi-mcp-adapter-patch.mjs
// Offline suite for scripts/pi-mcp-adapter-patch, the vendored fix that sends
// pi-mcp-adapter's OAuth URL to the TUI instead of console.log.
//
// The patch is exact string matching against upstream proxy-modes.ts, so this
// suite proves the three anchors still land on the committed fixture excerpt:
// a pristine copy gets patched, a second run is a no-op, --check reports both
// states and never writes, one missing anchor aborts with the file untouched,
// a missing package dir exits 0, and PI_CODING_AGENT_DIR resolution works.
// No network, no live pi session, no nvim, no tmux. See
// docs/ci-tests/pi-mcp-adapter-patch.md.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts/pi-mcp-adapter-patch");
const fixture = join(root, "scripts/fixtures/pi-mcp-adapter/proxy-modes.excerpt.ts");
const MARKER = "function reportAuthorizationUrl(";

let checks = 0;
const started = process.hrtime.bigint();
const tmp = mkdtempSync(join(tmpdir(), "pi-mcp-adapter-patch-"));
const ok = (name) => {
  checks += 1;
  console.log(`PASS ${name}`);
};
const run = (args, agentDir) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir || join(tmp, "absent-agent") },
  });
const writePackage = (dir, source, version) => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "proxy-modes.ts");
  writeFileSync(file, source);
  if (version) writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  return file;
};

try {
  const pristine = readFileSync(fixture, "utf8");
  assert.ok(!pristine.includes(MARKER), "fixture must ship unpatched");

  // 1. A pristine fixture gets all three edits.
  const dir = join(tmp, "work", "pi-mcp-adapter");
  const target = writePackage(dir, pristine, "7.0.1");
  const first = run(["--file", target]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), "patched (7.0.1)");
  const patched = readFileSync(target, "utf8");
  assert.ok(patched.includes(MARKER), "helper inserted");
  assert.equal(patched.match(/onAuthorizationUrl:/g)?.length, 2, "both call sites route the URL");
  assert.ok(
    !patched.includes("    openAuthorizationUrl: state.openBrowser,\n  };\n  const watcher"),
    "background auth options replaced",
  );
  assert.ok(patched.includes("signal ? { ...autoAuthOptions, signal } : autoAuthOptions"), "auto-auth collapsed");
  ok("pristine fixture is patched");

  // 2. A second run writes nothing.
  const second = run(["--file", target]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout.trim(), "already patched (7.0.1)");
  assert.equal(readFileSync(target, "utf8"), patched, "already patched file is unchanged");
  ok("second run is a no-op");

  // 3. --check reports patched, exit 0, and never writes.
  const checkPatched = run(["--check", "--file", target]);
  assert.equal(checkPatched.status, 0, checkPatched.stderr);
  assert.equal(checkPatched.stdout, "patched\n");
  assert.equal(readFileSync(target, "utf8"), patched);
  ok("--check reports patched without writing");

  // 4. --check reports unpatched, exit 1, and never writes.
  const clean = writePackage(join(tmp, "check", "pi-mcp-adapter"), pristine);
  const checkClean = run(["--check", "--file", clean]);
  assert.equal(checkClean.status, 1);
  assert.equal(checkClean.stdout, "unpatched\n");
  assert.equal(readFileSync(clean, "utf8"), pristine, "--check must not write");
  ok("--check reports unpatched without writing");

  // 5. One missing anchor: exit 1, the anchor is named, the file stays intact.
  const line = "    openAuthorizationUrl: state.openBrowser,\n";
  assert.equal(pristine.split(line).length - 1, 1, "anchor line must be unique in the fixture");
  const brokenSource = pristine.replace(line, "");
  const broken = writePackage(join(tmp, "broken", "pi-mcp-adapter"), brokenSource, "9.9.9");
  const brokenRun = run(["--file", broken]);
  assert.equal(brokenRun.status, 1, "a missing anchor must fail");
  assert.match(brokenRun.stderr, /background auth options/);
  assert.match(brokenRun.stderr, /9\.9\.9/);
  assert.match(brokenRun.stderr, /Re-derive the anchors/);
  assert.equal(readFileSync(broken, "utf8"), brokenSource, "a failed run must not write");
  ok("missing anchor fails with exit 1 and no write");

  // 6. No adapter installed: exit 0 so install.sh never fails.
  const absent = run(["--check"]);
  assert.equal(absent.status, 0, "missing package dir must not fail");
  assert.equal(absent.stdout, "pi-mcp-adapter not installed\n");
  ok("missing package dir exits 0");

  // 7. Default path resolution through PI_CODING_AGENT_DIR.
  const agent = join(tmp, "agent");
  writePackage(join(agent, "npm", "node_modules", "pi-mcp-adapter"), pristine, "9.9.9");
  const resolved = run([], agent);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), "patched (9.9.9)");
  assert.ok(readFileSync(join(agent, "npm", "node_modules", "pi-mcp-adapter", "proxy-modes.ts"), "utf8").includes(MARKER));
  ok("PI_CODING_AGENT_DIR path resolution");

  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`\nPassed: ${checks} checks in ${ms.toFixed(0)} ms`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
