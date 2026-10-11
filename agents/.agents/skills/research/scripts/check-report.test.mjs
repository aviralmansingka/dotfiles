import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReport } from "./check-report.mjs";

const map = '# Report\n```mermaid\nflowchart TD\nN01["State"]\nN02["Recovery"]\nN01 --> N02\n```\n';
const report = map + "## N01: State\nThe agent saves state.\n\n## N02: Recovery\nThe agent reads state.\n";
assert.deepEqual(checkReport(report).errors, []);

const one = '# Report\n```mermaid\nflowchart TD\nN01["State"]\n```\n';
assert.deepEqual(checkReport(one + "## N01: State\n" + "Text.\n".repeat(48)).errors, []);
assert.ok(checkReport(one + "## N01: State\n" + "Text.\n".repeat(49)).errors.some(x => x.includes("50 lines")));
assert.ok(checkReport(report.replace("## N02: Recovery", "## N03: Recovery")).errors.some(x => x.includes("both")));
assert.ok(checkReport(report.replace("N01 --> N02", "N02 --> N01")).errors.some(x => x.includes("cycles")));
assert.ok(checkReport(report.replace("N01 --> N02", "N01 --> N99")).errors.some(x => x.includes("unknown node")));
assert.ok(checkReport(report.replace("N01 --> N02", "N01 --> N02 --> N01")).errors.some(x => x.includes("Unsupported")));
assert.ok(checkReport(report + "\n```js\n").errors.some(x => x.includes("not closed")));
assert.deepEqual(checkReport(report.replace("The agent reads state.", "```md\n## N99: This is code\n```")).errors, []);

const directory = mkdtempSync(join(tmpdir(), "research-report-check-"));
try {
  const script = join(directory, "check-report.mjs");
  const file = join(directory, "research.md");
  symlinkSync(fileURLToPath(new URL("./check-report.mjs", import.meta.url)), script);
  writeFileSync(file, report);
  const valid = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
  assert.equal(valid.status, 0);
  assert.match(valid.stdout, /Passed: 2 nodes/);
  writeFileSync(file, one + "## N01: State\n" + "Text.\n".repeat(49));
  const invalid = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /50 lines/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("Passed: lesson limits, map coverage, edge order, fences, and the symlink command path.");
