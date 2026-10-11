import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

// Exercises the REAL usage.ts: the extension factory, aggregate(), and the
// UsageComponent the /usage command mounts. Stub-alias imports keep the run
// offline and hermetic; the old version of this file re-implemented the
// grid-width formula and kept passing while the implementation regressed.
const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

const root = mkdtempSync(join(tmpdir(), "usage-test-"));
let sessionsRoot;
let emptyRoot;
try {
  const agentStub = join(root, "agent.cjs");
  const tuiStub = join(root, "tui.cjs");
  // usage.ts imports only types from @earendil-works/pi-coding-agent, so the
  // stub needs no surface; the pi-tui stub supplies the two live functions.
  writeFileSync(agentStub, "module.exports = {};\n");
  // matchesKey maps the raw escape sequences the handler receives; pad=true
  // makes truncateToWidth pad content to the full width like the real one.
  writeFileSync(tuiStub, [
    "exports.matchesKey = (raw, key) => raw === key",
    '  || (key === "escape" && raw === "\\u001b")',
    '  || (key === "down" && raw === "\\u001b[B")',
    '  || (key === "up" && raw === "\\u001b[A")',
    '  || (key === "pagedown" && raw === "\\u001b[6~")',
    '  || (key === "pageup" && raw === "\\u001b[5~");',
    "const ANSI = /\\x1b\\[[0-9;]*m/g;",
    "exports.truncateToWidth = (text, width, ellipsis = '…', pad = false) => {",
    "  const styled = String(text);",
    "  const visible = [...styled.replace(ANSI, '')];",
    "  if (visible.length > width) return visible.slice(0, Math.max(0, width)).join('');",
    "  if (pad) return styled + ' '.repeat(Math.max(0, width - visible.length));",
    "  return styled;",
    "};",
  ].join("\n") + "\n");
  const jiti = createJiti(import.meta.url, {
    alias: {
      "@earendil-works/pi-coding-agent": agentStub,
      "@earendil-works/pi-tui": tuiStub,
    },
  });
  const { default: registerUsage } = jiti("./usage.ts");

  const commands = new Map();
  registerUsage({ registerCommand: (name, definition) => commands.set(name, definition) });
  assert.equal(commands.size, 1, "the extension registers exactly one command");
  const usage = commands.get("usage");
  assert.equal(usage.description.length > 0, true, "the command carries a description");

  // Session data: per-cwd subdirectories under the session-dir base, each
  // holding session JSONL records. Timestamps come from the clock so the
  // current-week and day-bucket logic stays deterministic for any run date.
  sessionsRoot = mkdtempSync(join(tmpdir(), "usage-sessions-"));
  const now = new Date();
  const iso = (offsetDays) => new Date(now.getTime() - offsetDays * 86400000).toISOString();
  const cwdA = join(sessionsRoot, "aa");
  const cwdB = join(sessionsRoot, "bb");
  mkdirSync(cwdA);
  mkdirSync(cwdB);
  const usageRecord = (over) => JSON.stringify({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 }, ...over });
  writeFileSync(join(cwdA, "s1.jsonl"), [
    JSON.stringify({ type: "message", message: { role: "assistant", usage: JSON.parse(usageRecord({ input: 10, output: 20, cacheRead: 5, cacheWrite: 5, totalTokens: 40, cost: { total: 0.5 } })), timestamp: iso(0), provider: "p", model: "model-a" } }),
    JSON.stringify({ type: "message", message: { role: "toolResult", usage: JSON.parse(usageRecord({ input: 1, output: 1, totalTokens: 2, cost: { total: 0.02 } })), timestamp: iso(1) } }),
    "not json at all",
    "",
    JSON.stringify({ type: "message", message: { role: "user", content: "hi" } }),
  ].join("\n") + "\n");
  writeFileSync(join(cwdA, "s2.jsonl"), [
    JSON.stringify({ type: "compaction", usage: JSON.parse(usageRecord({ totalTokens: 7, cost: { total: 0.07 } })), timestamp: iso(0) }),
    JSON.stringify({ type: "message", message: { role: "assistant", usage: JSON.parse(usageRecord({ input: 1000, totalTokens: 1000, cost: { total: 1.25 } })), timestamp: iso(40), provider: "p", model: "model-b" } }),
  ].join("\n") + "\n");
  writeFileSync(join(cwdB, "s3.jsonl"), [
    JSON.stringify({ type: "branch_summary", usage: JSON.parse(usageRecord({ totalTokens: 3, cost: { total: 0.03 } })), timestamp: iso(0) }),
  ].join("\n") + "\n");
  writeFileSync(join(cwdA, "notes.txt"), "not a session file");

  const widgets = new Map();
  const notifications = [];
  let inputHandler;
  const makeCtx = (sessionDir) => ({
    mode: "tui",
    sessionManager: { getSessionDir: () => sessionDir },
    ui: {
      notify: (message, type) => notifications.push([message, type]),
      setWidget: (key, factory) => widgets.set(key, factory),
      onTerminalInput: (handler) => { inputHandler = handler; return () => { if (inputHandler === handler) inputHandler = undefined; }; },
    },
  });
  const WIDGET_KEY = "usage-dashboard";
  const open = async (sessionDir) => {
    widgets.clear();
    await usage.handler([], makeCtx(sessionDir));
  };
  await open(cwdA);
  assert.ok(widgets.has(WIDGET_KEY), "an open dashboard mounts its widget");
  assert.deepEqual(notifications, [], "an open dashboard with data notifies nothing");

  const tui = { terminal: { rows: 40 }, requestRender() {} };
  let component = widgets.get(WIDGET_KEY)(tui, { name: "gruvbox-material" });
  const ansi = /\x1b\[[0-9;]*m/g;
  const visibleWidth = (line) => [...String(line).replace(ansi, "")].length;
  const renderAt = (width) => component.render(width).map((line) => String(line));

  // Aggregate totals across every per-cwd session file: 5 usage records,
  // 1052 tokens (40+2+7+1000+3), $1.87, 3 session files.
  const frame = renderAt(120).join("\n");
  assert.ok(frame.includes("/usage"), "the frame leads with the /usage title");
  assert.ok(frame.includes("$1.87"), "the frame shows the summed cost");
  assert.ok(frame.includes("1.1k tokens"), "the frame shows the summed tokens");
  assert.ok(frame.includes("5 turns"), "the frame shows the summed turns");
  assert.ok(frame.includes("3 sessions"), "the frame counts every session file");
  assert.ok(frame.includes("╭") && frame.includes("╰"), "the frame draws its box");
  assert.ok(frame.includes("█"), "days with spend render heatmap cells");
  assert.ok(frame.includes("model-a"), "the current week lists its models");
  assert.ok(!frame.includes("model-b"), "a 40-day-old model stays out of the current week");
  assert.ok(!frame.includes("not a session"), "non-JSONL files never render");

  // Width sweep: the component must fit every line inside the terminal
  // width. usage.ts hard-exited pi twice from rows wider than the viewport,
  // so this sweep is the regression net for that class.
  for (let width = 20; width <= 80; width++) {
    const lines = renderAt(width);
    assert.ok(lines.length > 0, `width=${width}: the frame renders lines`);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `width=${width}: a line is ${visibleWidth(line)} columns wide`);
    }
  }
  for (const width of [81, 100, 140, 200]) {
    for (const line of renderAt(width)) {
      assert.ok(visibleWidth(line) <= width, `width=${width}: a line is ${visibleWidth(line)} columns wide`);
    }
  }

  // Render caching: the same width keeps its lines; a new width rebuilds.
  const cached = renderAt(60);
  assert.deepEqual(renderAt(60), cached, "the same width reuses its lines");
  const wide = renderAt(120);
  assert.notDeepEqual(wide, cached, "a new width rebuilds the frame");
  const beforeInvalidate = component.render(60);
  component.invalidate();
  assert.deepEqual(component.render(60), beforeInvalidate, "invalidate forces a rebuild that yields the same lines");

  // Scrolling: j/k/g/G move the viewport; q closes the widget. The rows
  // count clamps the scroll so the frame never scrolls past its last line.
  tui.terminal.rows = 5;
  const first = renderAt(100);
  assert.equal(first.length, 5, "a 5-row terminal shows at most 5 lines");
  assert.ok(inputHandler, "the dashboard captures terminal input");
  assert.equal(inputHandler("x"), undefined, "an unhandled key passes through to the editor");
  assert.equal(inputHandler("j").consume, true, "j scrolls down and is consumed");
  assert.equal(component.scroll, 1, "j moves the scroll by one line");
  assert.equal(inputHandler("k").consume, true, "k scrolls up and is consumed");
  assert.equal(component.scroll, 0, "k returns the scroll to the top");
  assert.equal(inputHandler("G").consume, true, "G jumps to the end");
  assert.equal(component.scroll, component.lineCount - 5, "G lands on the last full frame");
  assert.ok(renderAt(100).at(-1).includes("╰"), "the bottom of the frame is visible at the end");
  assert.equal(inputHandler("g").consume, true, "g returns to the top");
  assert.equal(component.scroll, 0);
  assert.equal(inputHandler("\u001b[A").consume, true, "the up arrow scrolls like k");
  assert.equal(component.scroll, 0);
  assert.equal(inputHandler("\u001b[B").consume, true, "the down arrow scrolls like j");
  assert.equal(component.scroll, 1);
  assert.equal(inputHandler("\u001b").consume, true, "escape closes the dashboard");
  assert.equal(widgets.get(WIDGET_KEY), undefined, "escape removes the widget");
  assert.equal(inputHandler, undefined, "escape unsubscribes the input handler");

  // Toggle: a second /usage invocation closes an open dashboard.
  await open(cwdA);
  assert.ok(widgets.has(WIDGET_KEY));
  component = widgets.get(WIDGET_KEY)(tui, { name: "gruvbox-material" });
  await usage.handler([], makeCtx(cwdA));
  assert.equal(widgets.get(WIDGET_KEY), undefined, "the second invocation toggles the dashboard closed");
  await usage.handler([], makeCtx(cwdA));
  assert.ok(widgets.has(WIDGET_KEY), "the third invocation toggles it open again");

  // Degradation: empty session data and non-tui modes never mount a widget.
  // The toggle above left the dashboard open; close it so the next call runs.
  await usage.handler([], makeCtx(cwdA));
  assert.equal(widgets.get(WIDGET_KEY), undefined, "the fourth invocation toggles it closed again");
  emptyRoot = mkdtempSync(join(tmpdir(), "usage-empty-"));
  const emptyDir = join(emptyRoot, "empty");
  mkdirSync(emptyDir);
  await open(emptyDir);
  assert.equal(widgets.get(WIDGET_KEY), undefined, "no session files mount no widget");
  assert.deepEqual(notifications.at(-1), ["No sessions found", "info"]);
  widgets.clear();
  await usage.handler([], { ...makeCtx(cwdA), mode: "headless" });
  assert.equal(widgets.get(WIDGET_KEY), undefined, "headless mode mounts no widget");
  assert.deepEqual(notifications.at(-1), ["usage requires interactive mode", "error"]);

  console.log("usage tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(sessionsRoot, { recursive: true, force: true });
  rmSync(emptyRoot, { recursive: true, force: true });
}
