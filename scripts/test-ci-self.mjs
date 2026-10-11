#!/usr/bin/env node
// CI self-check (CI meta layer, rules A1/A2/A9/X9 + dynamic path routing).
//
// The workflow .github/workflows/ci.yml is itself a test surface. This
// script guards the wiring classes that broke for real:
//   - PR #175: a trigger-level `paths:` filter on a workflow that owns a
//     required check stops reporting that check on unchanged PRs and
//     blocks merges. The trigger block must have NO paths filter.
//   - PRs #227/#257/#279: hand-written test lists drift silently (claimed
//     wired but missing; red merges). Test discovery must be glob-based
//     (git ls-files), never a literal list of runnable files.
//   - Routing: every scripts/test-* entry declares its trigger paths in a
//     "# Paths: <globs>" header. The changes job harvests those headers
//     into the gate of the job that RUNS the entry (test-nvim-*.sh ->
//     nvim-tests, test-terraform* -> ops-tests, everything else ->
//     scripts-tests). This script mirrors that logic and proves, with a
//     synthetic diff, that a declared path triggers a job that runs the
//     entry that declared it.
//   - The aggregate `result` job must always report (if: !cancelled()).
//   - Deletion lockstep (A11): every Tier 2 exclusion entry must exist on
//     disk and match a discovery glob.
//
// Offline, deterministic, no sleeps. Run: node scripts/test-ci-self.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ciPath = join(repoRoot, ".github/workflows/ci.yml");
const exclusionsPath = join(repoRoot, "scripts/ci-tier2-exclusions.txt");

const ci = readFileSync(ciPath, "utf8");
const triggerBlock = ci.slice(0, ci.indexOf("jobs:"));

// 1. PR #175: no trigger-level paths filter on this workflow.
assert.ok(
  !/^(\s*)paths:/m.test(triggerBlock),
  "ci.yml trigger block must not have a paths filter (PR #175: required checks stop reporting)",
);

// 2. The aggregate result job must always report.
assert.ok(ci.includes("!cancelled()"), "ci.yml must keep an always-reporting result job (if: !cancelled())");

// 3. A1: no hand-written list of runnable test files. Direct invocations of
//    a literal test path are the drift class (#227, #257, #279); discovery
//    loops invoke "$f" variables instead.
const handListed = ci
  .split("\n")
  .filter((line) => /^\s*(node|bash|sh|python3?)\s+[^\s$]+\.(test\.mjs|test\.py|\.sh)\s*$/.test(line));
assert.deepEqual(handListed, [], `ci.yml must not hand-list test files (use git ls-files discovery):\n${handListed.join("\n")}`);

// 4. Discovery globs, routing, harvest, and provisioning must be wired.
for (const needle of [
  "pi/.pi/agent/extensions/**",
  "agents/**",
  "scripts/test-*",
  "test_*.py",
  "nvim/.config/nvim/tests/",
  "scripts/test-terraform*",
  "scripts/test-extension-loader.mjs",
  // Area routing: every scripts/test-nvim-*.sh belongs to the nvim job,
  // terraform entries to the ops job; the scripts loop filters them out.
  "scripts/test-nvim-*.sh",
  "scripts/test-(nvim-.*|terraform.*)",
  // Path-header harvest: entries self-wire their trigger paths.
  "# Paths:",
  // Provisioning contracts the discovered tests rely on.
  "astral-sh/setup-uv",
  "lua5.4",
  "hashicorp/setup-terraform",
]) {
  assert.ok(ci.includes(needle), `ci.yml must wire: ${needle}`);
}

// 5. Path gating: every area job must be gated on the changes job outputs.
for (const job of ["pi-tests", "nvim-tests", "scripts-tests", "ops-tests"]) {
  const block = ci.slice(ci.indexOf(`  ${job}:`));
  const body = block.slice(0, block.indexOf("\n  result:") === -1 ? undefined : block.indexOf("\n  result:"));
  assert.ok(body.includes("needs: changes"), `${job} must depend on the changes job`);
  assert.ok(/if:\s*needs\.changes\.outputs\./.test(body), `${job} must be gated on changes outputs`);
}

// 6. Tier 2 exclusion table: every entry exists on disk and is discoverable.
const exclusions = readFileSync(exclusionsPath, "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*$/, "").trim())
  .filter((line) => line.length > 0);

const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).split("\n").filter(Boolean);

// The same discovery globs ci.yml uses (keep in sync with the workflow).
const discovered = new Set([
  ...git("ls-files", "pi/.pi/agent/extensions/**").filter((f) => f.endsWith(".test.mjs")),
  ...git("ls-files", "agents/**").filter((f) => f.endsWith(".test.mjs")),
  ...git("ls-files", "--cached", "--others", "--exclude-standard", "scripts/test-*"),
  ...git("ls-files", "pi/bin").filter((f) => /^pi\/bin\/test_.*\.py$/.test(f)),
  ...git("ls-files", "nvim/.config/nvim/tests/").filter((f) => f.endsWith("_spec.lua")),
  ...git("ls-files", "scripts/test-terraform*"),
]);
assert.ok(discovered.size > 0, "discovery found no test files; the globs are broken");
for (const entry of exclusions) {
  assert.ok(existsSync(join(repoRoot, entry)), `Tier 2 exclusion ${entry} does not exist on disk (deletion lockstep)`);
  assert.ok(discovered.has(entry), `Tier 2 exclusion ${entry} matches no discovery glob (stale entry)`);
}

// ---------------------------------------------------------------------------
// Dynamic routing: mirror the changes-job gate logic and prove it with a
// synthetic diff (a zsh/** change must trigger the job that runs
// scripts/test-zsh.sh).
// ---------------------------------------------------------------------------

// Fixed gates — must match the changes job in ci.yml exactly.
const FIXED_GATES = {
  pi: ["pi/*", "agents/*", ".github/workflows/ci.yml"],
  nvim: ["nvim/*", "scripts/test-nvim-*", ".github/workflows/ci.yml"],
  scripts: [
    "scripts/*", "install.sh", "Brewfile", ".stowrc", "dependencies.json",
    "skills-lock.json", "systemd/*", "launchd/*", "gh-dash/*",
  ],
  ops: ["ops/*", ".github/workflows/ci.yml"],
};
for (const [area, globs] of Object.entries(FIXED_GATES)) {
  for (const g of globs) {
    assert.ok(ci.includes(`'${g}'`), `ci.yml changes job must keep the ${area} gate glob '${g}'`);
  }
}

// Header harvest — mirrors the changes job. Canonical marker per file
// type: "# Paths:" for .sh/.py, "// Paths:" for .mjs (node rejects "#"
// comments). Globs are separated by spaces or commas.
function headerPrefix(file) {
  return file.endsWith(".mjs") ? "// Paths:" : "# Paths:";
}
function harvestHeader(file) {
  const text = readFileSync(join(repoRoot, file), "utf8");
  const line = text.split("\n").find((l) => l.startsWith(headerPrefix(file)));
  return line ? line.slice(headerPrefix(file).length).split(/[ ,]+/).filter(Boolean) : [];
}

// Routing classification — mirrors the changes job.
function runnerJob(file) {
  if (/^scripts\/test-nvim-.*\.sh$/.test(file)) return "nvim";
  if (/^scripts\/test-terraform/.test(file)) return "ops";
  return "scripts";
}

const runnable = [...discovered].filter((f) => !exclusions.includes(f) && f.startsWith("scripts/test-"));
const gates = {
  pi: [...FIXED_GATES.pi],
  nvim: [...FIXED_GATES.nvim],
  scripts: [...FIXED_GATES.scripts],
  ops: [...FIXED_GATES.ops],
};
for (const f of runnable) gates[runnerJob(f)].push(...harvestHeader(f));
// Every header-declared glob (fixed gates excluded) — the docs rule
// consults it, mirroring the changes job.
const declaredAll = runnable.flatMap(harvestHeader);

// Bash [[ == ]] semantics: * crosses / (git-pathspec behavior).
function bashMatch(path, pattern) {
  const re =
    "^" +
    pattern.replace(/[.+^${}()|[\]\\?*]/g, (c) => (c === "*" ? ".*" : c === "?" ? "." : "\\" + c)) +
    "$";
  return new RegExp(re).test(path);
}
const gateHits = (changed, globs) => changed.some((f) => globs.some((g) => bashMatch(f, g)));
// Docs-only rule, mirroring the changes job: an UNDECLARED *.md change
// triggers nothing; a path an entry declares beats the strip (SKILL.md
// frontmatter, README stow tables are guarded by their entries).
const effective = (files) =>
  files.filter((f) => !f.endsWith(".md") || declaredAll.some((g) => bashMatch(f, g)));

// 7. Header coverage: every runnable entry either declares its paths (and
//    those globs sit in the gate of the job that runs it) or falls back to
//    the scripts/** default gate. Header format must be the exact
//    "^# Paths:" form the harvest reads — no silent drift.
for (const f of runnable) {
  const job = runnerJob(f);
  const text = readFileSync(join(repoRoot, f), "utf8");
  // Loose: any paths-header-ish comment in any spacing/case/marker.
  // Strict: the canonical marker for this file type, exact spacing.
  const loose = /^[ \t]*(#|\/\/)[ \t]*paths?:/i.test(text);
  const strict = text.split("\n").some((l) => l.startsWith(headerPrefix(f)));
  assert.ok(!loose || strict, `${f} has a paths header in a non-canonical form; use "${headerPrefix(f)} <globs>"`);
  for (const g of harvestHeader(f)) {
    assert.ok(gates[job].includes(g), `${f} declares ${g} but it is not in the ${job} gate (harvest broken)`);
  }
  if (harvestHeader(f).length === 0 && job === "scripts") {
    assert.ok(bashMatch(f, "scripts/*"), `${f} has no "# Paths:" header and is not covered by the scripts/** default gate`);
  }
}

// 8. Synthetic gate-match tests: a fake diff must select a job that RUNS
//    the entry whose header declares those paths.
const synthetic = [
  { changed: ["zsh/.zshrc"], entry: "scripts/test-zsh.sh", entryGlobs: ["zsh/**"], job: "scripts" },
  { changed: ["tmux/tmux.conf"], entry: "scripts/test-tmux.sh", entryGlobs: ["tmux/**"], job: "scripts" },
  { changed: ["ghostty/ghostty.config", "xterm-ghostty.terminfo"], entry: "scripts/test-ghostty.sh", entryGlobs: ["ghostty/**", "xterm-ghostty.terminfo"], job: "scripts" },
  { changed: ["starship/starship.toml"], entry: "scripts/test-config-lint.py", entryGlobs: ["starship/**"], job: "scripts" },
  { changed: ["install.sh", "Brewfile"], entry: "scripts/test-install-smoke.sh", entryGlobs: ["install.sh", "Brewfile"], job: "scripts" },
  { changed: ["scripts/install-no-mistakes"], entry: "scripts/test-nm-install.sh", entryGlobs: ["scripts/install-no-mistakes"], job: "scripts" },
  { changed: ["claude/settings.json"], entry: "scripts/test-repo-parity.py", entryGlobs: ["claude/**"], job: "scripts" },
  { changed: ["nvim/.config/nvim/init.lua"], expect: { nvim: true, scripts: true } }, // install-smoke declares nvim/** (install.sh stows nvim)
  { changed: ["scripts/test-nvim-octo.sh"], expect: { nvim: true, scripts: true } }, // scripts/* fixed glob also hits; the scripts job just skips routed entries
  { changed: ["ops/terraform/main.tf"], expect: { ops: true } },
  { changed: ["pi/.pi/agent/settings.json"], expect: { pi: true, scripts: true } }, // repo-config + live-config declare pi/.pi/agent paths
  { changed: ["pi/bin/pi-stt-worker.py"], expect: { pi: true, scripts: true } }, // test-pi-stt declares pi/bin/pi-stt*
  { changed: ["pi/bin/notion-cli"], expect: { pi: true, scripts: true } }, // test-repo-parity declares pi/bin/notion-cli
  { changed: ["starship/starship.toml"], expect: { scripts: true } }, // test-config-lint declares starship/**
  { changed: ["agents/.agents/skills/nvim/SKILL.md"], expect: { pi: true, scripts: true } }, // declared agents/.agents/skills/** beats the *.md strip
  { changed: ["nvim/.markdownlint-cli2.yaml"], expect: { nvim: true, scripts: true } }, // repo-config declares it; nvim/* fixed gate also hits
  { changed: ["herdr/.config/herdr/config.toml"], expect: { scripts: true } }, // repo-config + herdr-annotate-install declare it
  { changed: ["scripts/auto-git-sync"], expect: { scripts: true } },
  { changed: ["BACKLOG.md", "CONTEXT.md"], expect: { pi: false, nvim: false, scripts: false, ops: false } }, // UNdeclared *.md triggers nothing
  { changed: ["README.md"], expect: { scripts: true } }, // declared by test-repo-parity: declared paths beat the docs strip
];
for (const t of synthetic) {
  // Mirror the changes job docs rule: undeclared *.md changes are
  // stripped before gate matching; declared paths survive the strip.
  const changed = effective(t.changed);
  const hits = Object.fromEntries(Object.keys(gates).map((a) => [a, gateHits(changed, gates[a])]));
  if (t.entry) {
    // The entry's declared globs must gate the job that runs the entry,
    // and the changed files must match at least one declared glob.
    assert.equal(runnerJob(t.entry), t.job, `${t.entry} must be run by the ${t.job} job`);
    for (const g of t.entryGlobs) {
      assert.ok(gates[t.job].includes(g), `${t.entry} declares ${g}; it must sit in the ${t.job} gate`);
    }
    assert.ok(
      gateHits(changed, t.entryGlobs),
      `synthetic diff [${t.changed}] must match the paths ${t.entry} declares`,
    );
    assert.ok(hits[t.job], `synthetic diff [${t.changed}] must trigger the ${t.job} job (runs ${t.entry})`);
  } else {
    const expected = { pi: false, nvim: false, scripts: false, ops: false, ...t.expect };
    assert.deepEqual(hits, expected, `synthetic diff [${t.changed}] selected wrong jobs`);
  }
}
// The live entry (when present) must agree with the synthetic model.
if (existsSync(join(repoRoot, "scripts/test-zsh.sh"))) {
  assert.deepEqual(harvestHeader("scripts/test-zsh.sh").filter((g) => g === "zsh/**"), ["zsh/**"],
    "scripts/test-zsh.sh must declare zsh/** in its # Paths header");
}

// 9. Report.
const running = [...discovered].filter((f) => !exclusions.includes(f));
const declared = runnable.filter((f) => harvestHeader(f).length > 0);
console.log(
  `Passed: ${running.length} tests discovered by glob, ${exclusions.length} Tier 2 exclusions all live, ` +
    `${declared.length} entries self-wire their # Paths headers, no trigger paths filter, aggregate result always reports.`,
);
function jobOf(f) {
  if (f.startsWith("scripts/test-")) return runnerJob(f);
  if (f.endsWith("_spec.lua")) return "nvim";
  return "pi"; // extensions, agents, pi/bin tests
}
for (const f of running) console.log(`  runs ${f} (${jobOf(f)})`);
for (const f of exclusions) console.log(`  tier2 ${f}`);
