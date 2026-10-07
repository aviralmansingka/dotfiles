import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
  process.env.JITI_PATH,
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
  "/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
const { createJiti } = require(jitiPath);
const source = readFileSync(new URL("./tool-call-renderer-public.ts", import.meta.url), "utf8");
for (const marker of ["Symbol.for", "prototype", "rendererState", "dist/bundle", "updateResult", "hideThinkingBlock", "requestRender", "globalThis"]) {
  assert.ok(!source.includes(marker), `public API guard: ${marker}`);
}
for (const [, specifier] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
  assert.ok(specifier.startsWith("node:") || ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"].includes(specifier));
}

const tempRoot = mkdtempSync(join(tmpdir(), "tool-call-renderer-public-test-"));
let shutdown;
try {
  const stubAgent = join(tempRoot, "agent.cjs");
  const stubTui = join(tempRoot, "tui.cjs");
  writeFileSync(stubAgent, [
    'exports.keyHint = () => "ctrl+o to expand";',
    'exports.getLanguageFromPath = (p) => String(p || "").endsWith(".md") ? "markdown" : undefined;',
    'let hlInited = false;',
    'exports.initTheme = (name) => { hlInited = true; exports.lastInitName = name; };',
    // mirrors the real dual-instance trap: uninitiated highlightCode silently
    // returns plain lines even for valid languages
    'exports.highlightCode = (code, lang) => (hlInited && lang) ? String(code).split("\\n").map((l) => l ? `<hl:${lang}>${l}` : l) : String(code).split("\\n");',
    'exports.truncateToVisualLines = (text, maxLines, width) => {',
    '  const out = [];',
    '  for (const line of String(text).split("\\n")) {',
    '    const chars = [...line];',
    '    for (let i = 0; i < chars.length; i += Math.max(1, width)) out.push(chars.slice(i, i + Math.max(1, width)).join(""));',
    '  }',
    '  const skipped = Math.max(0, out.length - maxLines);',
    '  return { visualLines: skipped ? out.slice(out.length - maxLines) : out, skippedCount: skipped };',
    '};',
  ].join("\n") + "\n");
  writeFileSync(stubTui, 'exports.truncateToWidth = (text, width) => [...text].slice(0, width).join("");\n');
  const jiti = createJiti(import.meta.url, {
    alias: {
      "@earendil-works/pi-coding-agent": stubAgent,
      "@earendil-works/pi-tui": stubTui,
    },
  });
  const extension = jiti("./tool-call-renderer-public.ts").default;
  const handlers = new Map();
  const bus = new Map();
  let resolver;
  extension({
    registerToolRenderer(value) { resolver = value; },
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event); },
    events: { on(event, handler) { bus.set(event, handler); return () => bus.delete(event); } },
  });
  shutdown = handlers.get("session_shutdown");
  const session = (id, entries = []) => handlers.get("session_start")({}, {
    sessionManager: { getSessionId: () => id, getEntries: () => entries },
  });
  session("first");
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  let invalidations = 0;
  const context = (toolCallId, args = {}, extra = {}) => ({
    args, toolCallId, invalidate: () => invalidations++, state: {}, lastComponent: undefined,
    cwd: "/tmp", executionStarted: true, argsComplete: true, isPartial: false,
    expanded: false, showImages: false, isError: false, ...extra,
  });
  const result = (text, details = {}) => ({ content: [{ type: "text", text }], details });
  const render = (component, width = 240) => {
    assert.equal(typeof component.invalidate, "function");
    component.invalidate();
    const lines = component.render(width);
    assert.ok(Array.isArray(lines) && lines.every((line) => typeof line === "string"));
    return lines.join("\n");
  };
  const options = { expanded: false, isPartial: false };
  const CONNECTED = new Set(["subagent", "no_mistakes_axi"]);
  const NEVER_DELEGATE = new Set([...CONNECTED, "read", "write"]);
  for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls", "subagent", "no_mistakes_axi", "mcp__not_connected__search", "unknown"]) {
    const ours = NEVER_DELEGATE.has(name);
    let calls = 0;
    const renderer = resolver(name, () => { calls++; });
    assert.equal(calls, ours ? 0 : 1);
    assert.equal(renderer.renderShell, "self");
    const ctx = context(name, { path: "file.txt", pattern: "needle" });
    assert.match(render(renderer.renderCall(ctx.args, theme, ctx)), /◇/);
    render(renderer.renderResult(result("ok"), options, theme, ctx));
    assert.match(render(renderer.renderCall(ctx.args, theme, ctx)), /◆/);
    if (ours) {
      const theirs = { renderShell: "default", renderResult() {} };
      const stillOurs = resolver(name, () => theirs);
      assert.equal(stillOurs.renderShell, "self", "connected and file tools never delegate expansion");
      assert.match(render(stillOurs.renderResult(result("ok"), { ...options, expanded: true }, theme, ctx)), /│/, "expansion stays ours");
      continue;
    }
    const downstream = {
      renderShell: "default",
      renderCall() {},
      renderResult: () => ({ render: () => ["NATIVE EXPANDED"], invalidate() {} }),
    };
    const owned = resolver(name, () => downstream);
    assert.equal(owned.renderShell, "self", "we own the row shell even over downstream renderers");
    assert.match(render(owned.renderResult(result("ok"), options, theme, ctx)), /└─/, "collapsed summary stays ours");
    assert.equal(
      render(owned.renderResult(result("ok"), { expanded: true, isPartial: false }, theme, ctx)),
      "NATIVE EXPANDED",
      "expanded body delegates to the downstream renderResult",
    );
    assert.equal(
      resolver(name, () => ({ renderCall() {} })).renderShell,
      "self",
      "downstream without renderResult: we render everything",
    );
  }
  const bash = resolver("bash", () => undefined);
  const bashCtx = context("timed", { command: "printf hi\nexit 0" });
  handlers.get("tool_execution_start")({ toolCallId: "timed" });
  const call = bash.renderCall(bashCtx.args, theme, bashCtx);
  const callOut = render(call);
  assert.match(callOut, /◇ bash/, "multi-line commands render a bare header row");
  assert.ok(!callOut.includes("◇ bash $"), "multi-line commands drop the inline $ form");
  assert.match(callOut, /├─ \$ {2}<hl:bash>printf hi/, "each command line gets its own railed $ row, highlighted");
  assert.match(callOut, /└─ \$ {2}<hl:bash>exit 0/);
  assert.match(render(bash.renderCall({ command: "printf hi" }, theme, context("single", {}, { executionStarted: false }))), /◇ bash \$ <hl:bash>printf hi/, "single-line commands stay inline");
  const quiet = { executionStarted: false };
  const commitMsg = render(bash.renderCall({ command: 'git commit -m "subject line\n\nquoted body\nmore body"\n&& git push' }, theme, context("quoted", {}, quiet)));
  assert.match(commitMsg, /├─ \$ {2}<hl:bash>git commit -m "subject line/, "the command line keeps its $");
  assert.match(commitMsg, /^ │\s*$/m, "a blank line inside the quote keeps the connecting rail");
  assert.match(commitMsg, /│ {5}quoted body/, "continuations between commands carry the rail");
  assert.match(commitMsg, /│ {5}more body"/);
  assert.match(commitMsg, / │  && <hl:bash>git push/, "a line starting with the joining operator renders its marker on the spine");
  assert.ok(!commitMsg.includes("$ quoted body"), "quoted lines are never prettended as $ commands");
  const heredoc = render(bash.renderCall({ command: "cat <<EOF\nbody line\nEOF\necho done" }, theme, context("heredoc", {}, quiet)));
  assert.match(heredoc, /├─ \$ {2}<hl:bash>cat <<EOF/);
  assert.match(heredoc, /│ {5}body line/, "heredoc bodies are continuations");
  assert.match(heredoc, /│ {5}EOF/, "the closing tag is a continuation too");
  assert.match(heredoc, /└─ \$ {2}<hl:bash>echo done/);
  const bsCommand = "printf 'a' \\\\ && \\" + "\n  echo b";
  const backslash = render(bash.renderCall({ command: bsCommand }, theme, context("bs", {}, quiet)));
  assert.match(backslash, /├─ \$ {2}.*printf/, "the wrapped command keeps its leaf");
  assert.match(backslash, / │  && <hl:bash>echo b/, "a backslash-continued segment after an operator completes as an executable row on the spine");
  const chained = render(bash.renderCall({ command: "node test.mjs 2>&1 | tail -3 && git add -A && git push -q && echo pushed" }, theme, context("chain", {}, quiet)));
  assert.match(chained, /├─ \$ {2}<hl:bash>node test\.mjs 2>&1/, "the first segment gets the $");
  assert.match(chained, / │  \|  <hl:bash>tail -3/, "pipe-joined segments ride the spine with their operator");
  assert.match(chained, / │  && <hl:bash>git add -A/);
  assert.match(chained, / │  && <hl:bash>git push -q/);
  assert.match(chained, / │  && <hl:bash>echo pushed/, "the final segment rides the spine too — leaves only on $ rows");
  const subshell = render(bash.renderCall({ command: "F=$(ls -t x | head -1) && echo $F" }, theme, context("sub", {}, quiet)));
  assert.match(subshell, /├─ \$ {2}<hl:bash>F=\$\(ls -t x \| head -1\)/, "operators inside $(…) do not split");
  assert.match(subshell, / │  && <hl:bash>echo \$F/);
  const beforeTick = invalidations;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.ok(invalidations > beforeTick, "clock invalidates the public row context");
  assert.match(render(call), /1\.\ds/);
  assert.match(render(bash.renderResult(result("hi", { exitCode: 0 }), options, theme, bashCtx)), /exit 0 · 1 line/);
  const afterDone = invalidations;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(invalidations, afterDone, "settled results disarm their clocks");
  assert.match(render(call), /◆/);
  assert.doesNotMatch(render(call), /\d+ms/, "sub-second elapsed is suppressed");
  const errorTheme = { ...theme, fg: (color, text) => color === "error" ? `<error>${text}</error>` : text };
  const error = bash.renderResult(result("bad command"), options, errorTheme, context("error", {}, { isError: true }));
  assert.match(render(error), /<error>bad command/);
  assert.match(render(bash.renderResult(result("Command exited with code 2"), options, theme, context("exit"))), /Command exited with code 2/);
  const edit = resolver("edit", () => undefined);
  assert.match(render(edit.renderResult(result("updated", { diff: "+new\n-old\n same" }), options, theme, context("edit-stats"))), /\+1 −1/);
  const read = resolver("read", () => undefined);
  const long = Array.from({ length: 220 }, (_, i) => `line ${i}`).join("\n");
  const expanded = read.renderResult(result(long), { ...options, expanded: true }, theme, context("long", { path: "file.txt" }));
  const expandedOut = render(expanded);
  assert.match(expandedOut, /… 20 more lines/);
  assert.ok(expandedOut.includes("line 199"), "cap keeps the first 200 lines");
  assert.ok(!expandedOut.includes("line 200"), "lines past the cap are folded");
  assert.ok(expanded.render(10).every((line) => [...line].length <= 10));
  assert.match(render(read.renderResult(result("  indented"), { ...options, expanded: true }, theme, context("indent", { path: "file.txt" }))), /1 │   indented/);
  const namedTheme = { ...theme, name: "gruvbox-material" };
  const md = render(read.renderResult(result("# Title\n\nparagraph"), { ...options, expanded: true }, namedTheme, context("md", { path: "notes.md" })));
  assert.match(md, /1 │ # Title/);
  assert.match(md, /3 │ paragraph/);
  assert.equal(require(stubAgent).lastInitName, "gruvbox-material", "our highlight instance is theme-synced before highlighting");
  const fence = render(read.renderResult(result("# Title\n\n```ts\nconst a = 1;\n```\n\ntail"), { ...options, expanded: true }, namedTheme, context("mdf", { path: "notes.md" })));
  assert.match(fence, /1 │ # Title/);
  assert.match(fence, /3 │ ```ts/);
  assert.match(fence, /4 │ <hl:ts>const a = 1;/, "fenced blocks highlight with their info-string language");
  assert.match(fence, /5 │ ```/);
  assert.match(fence, /7 │ tail/);
  assert.equal(fence.split("\n")[2], "2 │ ", "blank lines keep their numbered row");
  const styT = { name: "gruvbox-material", fg: (c, t) => `<${c}>${t}</${c}>`, bold: (t) => `<b>${t}</b>`, italic: (t) => `<i>${t}</i>` };
  const styled = render(read.renderResult(result("# Title\n\nSome **bold** and `code` with [a link](http://x)\n\n- item with *em*\n\n> quoted\n\n```ts\nconst a = 1;\n```\n"), { ...options, expanded: true }, styT, context("mds", { path: "notes.md" })));
  assert.ok(styled.includes("<accent><b># Title</b></accent>"), "headings render accent bold");
  assert.ok(styled.includes("Some <b>**bold**</b> and <success>`code`</success> with <accent>a link</accent><dim>(http://x)</dim>"), "inline spans style on the live theme, inline code gruvbox green");
  assert.ok(styled.includes("<accent>- </accent>item with <i>*em*</i>"), "list markers accent, emphasis italic");
  assert.ok(styled.includes("<muted>> </muted>quoted"), "quote markers muted");
  assert.ok(styled.includes("<dim>```ts</dim>"), "fence lines dim");
  assert.ok(styled.includes("<hl:ts>const a = 1;"), "inner code still engine-highlighted");

  const subagent = resolver("subagent", () => undefined);
  const ctx = context("child", { name: "scout" });
  const childCall = subagent.renderCall(ctx.args, theme, ctx);
  const initial = result("started", { results: [{ progress: { status: "running" }, output: "starting" }] });
  const chip = subagent.renderResult(initial, { ...options, expanded: true }, theme, ctx);
  assert.match(render(chip), /▹ scout/);
  const update = bus.get("subagent:background-update");
  const beforeUpdate = invalidations;
  update({ toolCallId: "child", done: false, result: {
    progress: { status: "running", recentTools: [{ name: "read", status: "running", preview: "file.ts" }] },
    output: "stalled · awaiting response",
  } });
  assert.ok(invalidations > beforeUpdate);
  assert.match(render(chip), /stalled · awaiting response/);
  assert.match(render(chip), /└─ ◇ read/);
  update({ toolCallId: "child", done: true, result: {
    progress: { status: "completed", recentTools: [{ name: "read", status: "completed" }] },
    output: "finished", stats: { toolCount: 1, inputTokens: 1200, outputTokens: 8, cost: 0.02 },
  } });
  assert.match(render(chip), /▸ scout ◆ 1 tool/);
  assert.match(render(chip), /└─ ◆ read/);
  assert.match(render(chip), /↑1.2k ↓8 \$0.020/);
  assert.match(render(childCall), /◆/);
  assert.match(render(subagent.renderResult(initial, options, theme, ctx)), /▸ scout/, "done bus updates survive stale parent results");
  const restoredResult = result("done", { results: [{
    progress: { status: "completed", recentTools: [{ name: "bash", status: "completed" }] },
    stats: { toolCount: 2 },
  }] });
  assert.match(render(subagent.renderResult(restoredResult, { ...options, expanded: true }, theme, context("stored"))), /▸.*└─/s);
  const mixed = result("mixed", { results: [
    { name: "good", progress: { status: "completed" }, stats: { toolCount: 1 } },
    { name: "bad", progress: { status: "failed", error: "broken" } },
  ] });
  const mixedOutput = render(subagent.renderResult(mixed, options, theme, context("mixed")));
  assert.match(mixedOutput, /├─ ▸ good ◆/);
  assert.match(mixedOutput, /└─ × bad · broken/);
  const axi = resolver("no_mistakes_axi", () => undefined);
  const pipeline = result("failed", { progress: { kind: "pipeline", status: "failed", error: "tests failed", recentTools: [{ name: "tests", status: "failed" }] } });
  const pipelineOutput = render(axi.renderResult(pipeline, { ...options, expanded: true }, theme, context("axi")));
  assert.match(pipelineOutput, /× no-mistakes · tests failed/);
  assert.match(pipelineOutput, /└─ × tests/);
  session("first");
  assert.match(render(chip), /▸ scout/, "same session preserves live final state");
  session("second", [{ message: { role: "assistant", content: [{ type: "toolCall", id: "restored" }] } }]);
  const beforeLate = invalidations;
  update({ toolCallId: "child", done: false, result: { output: "old session" } });
  assert.equal(invalidations, beforeLate, "ignore old session events");
  const restoredCtx = context("restored", { path: "file.txt" });
  const restoredCall = read.renderCall(restoredCtx.args, theme, restoredCtx);
  render(read.renderResult(result("a\nb"), options, theme, restoredCtx));
  assert.doesNotMatch(render(restoredCall), /\d+(?:ms|s)/, "restored calls have no invented elapsed time");
  shutdown();
  assert.equal(bus.size, 0, "shutdown releases bus subscription");
  console.log("tool-call-renderer-public tests passed");
} finally {
  shutdown?.();
  rmSync(tempRoot, { recursive: true, force: true });
}
