import assert from "node:assert/strict";
import { execSync } from "node:child_process";
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
    'exports.truncateToVisualLines = (text, maxLines, width, _padding, keep = "end") => {',
    '  const out = [];',
    '  for (const line of String(text).split("\\n")) {',
    '    const chars = [...line];',
    '    for (let i = 0; i < chars.length; i += Math.max(1, width)) out.push(chars.slice(i, i + Math.max(1, width)).join(""));',
    '  }',
    '  const skipped = Math.max(0, out.length - maxLines);',
    '  return { visualLines: skipped ? (keep === "start" ? out.slice(0, maxLines) : out.slice(out.length - maxLines)) : out, skippedCount: skipped };',
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
  let shortcut;
  extension({
    registerToolRenderer(value) { resolver = value; },
    registerShortcut(key, options) { shortcut = { key, ...options }; },
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event); },
    events: {
      on(event, handler) { bus.set(event, handler); return () => bus.delete(event); },
      emit(event, payload) { bus.get(event)?.(payload); },
    },
  });
  shutdown = handlers.get("session_shutdown");
  const session = (id, entries = []) => handlers.get("session_start")({}, {
    sessionManager: { getSessionId: () => id, getEntries: () => entries },
  });
  session("first");
  const theme = { fg: (_color, text) => text, bold: (text) => text, italic: (text) => text };
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
  const NEVER_DELEGATE = new Set([...CONNECTED, "read", "write", "bash", "powershell", "python", "grep", "find", "ls", "ask_user_question", "quiz", "explain", "subagent_message", "hunk_review", "tuicr", "mcp__not_connected__search"]);
  for (const name of [...NEVER_DELEGATE, "mcp__whatsapp__list_messages", "edit", "ask_question", "unknown"]) {
    const ours = NEVER_DELEGATE.has(name) || name.startsWith("mcp__");
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
      assert.match(render(stillOurs.renderResult(result("ok"), { ...options, expanded: true }, theme, ctx)), /└─/, "expansion stays ours");
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
  const replyRenderer = {
    renderShell: "self",
    renderCall: () => ({ render: () => ["◇ tuicr_reply"], invalidate() {} }),
    renderResult: () => ({ render: () => ["✎ re: src/main.rs:42", "└─ ✓ posted to session s · visible in tuicr"], invalidate() {} }),
  };
  assert.equal(resolver("tuicr_reply", () => replyRenderer), replyRenderer, "tuicr replies own call and result rows even when collapsed");
  const bash = resolver("bash", () => undefined);
  // Ctrl+Q command-visibility toggle: every launch starts hidden.
  assert.ok(shortcut, "ctrl+q shortcut is registered");
  assert.equal(shortcut.key, "ctrl+q");
  assert.equal(typeof shortcut.handler, "function");
  assert.ok(shortcut.description, "the shortcut carries a /hotkeys description");
  const notifications = [];
  const shortcutCtx = { ui: { notify: (message, type) => notifications.push([message, type]) } };
  const quietStart = { executionStarted: false };
  const hiddenBash = render(bash.renderCall(
    { command: "# list files changed on this branch against main\ngit diff --name-only main...HEAD" },
    theme,
    context("hidden-title", {}, quietStart),
  ));
  assert.match(hiddenBash, /^ ◇ bash — list files changed on this branch against main$/m, "hidden mode: the intent title is the row");
  assert.ok(!hiddenBash.includes("$"), "hidden mode: no command body renders");
  const hiddenPlain = render(bash.renderCall({ command: "git status --short" }, theme, context("hidden-plain", {}, quietStart)));
  assert.match(hiddenPlain, /◇ bash \$ git status --short/, "hidden mode: a title-less call keeps a one-line preview");
  assert.equal(hiddenPlain.split("\n").length, 1, "hidden mode: no railed body rows");
  const hiddenExpanded = render(bash.renderCall(
    { command: "# list files changed on this branch against main\ngit diff --name-only main...HEAD" },
    theme,
    context("hidden-expanded", {}, { executionStarted: false, expanded: true }),
  ));
  assert.match(hiddenExpanded, /^ ◇ bash — list files changed on this branch against main$/m, "expanded rows keep the hidden title-only form");
  assert.ok(!hiddenExpanded.includes("git diff"), "Ctrl+Q stays orthogonal to Ctrl+O: expansion never reveals the command body");
  const beforeToggle = invalidations;
  shortcut.handler(shortcutCtx);
  assert.ok(invalidations > beforeToggle, "the toggle invalidates mounted rows");
  assert.deepEqual(notifications.at(-1), ["Commands and no-mistakes rows shown", "info"]);
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
  const heredocTheme = { ...theme, fg: (color, text) => color === "dim" ? `<dim>${text}</dim>` : text };
  for (const [opener, tag] of [["<<'PY'", "PY"], ['<<"EOF"', "EOF"], ["<< EOF", "EOF"]]) {
    const command = `python3 - ${opener}\nimport os\nprint(os.getcwd())\n${tag}\necho done`;
    const out = render(bash.renderCall({ command }, heredocTheme, context(`heredoc-${opener}`, {}, quiet)));
    assert.match(out, /├─.*\$.*<hl:bash>python3 -/, "the invocation is an executable leaf");
    assert.equal(out.split("\n").filter((line) => /├─.*\$/.test(line)).length, 1, "only the invocation gets an intermediate executable leaf");
    assert.equal(out.split("\n").filter((line) => line.includes("$")).length, 2, "only python3 and echo get $ markers");
    for (const body of ["import os", "print(os.getcwd())", tag]) {
      const row = out.split("\n").find((line) => line.includes(`<dim>${body}</dim>`));
      assert.ok(row, `${opener}: body and terminator rows render dim`);
      assert.match(row, /│/, "continuations keep the connecting spine");
      assert.ok(!row.includes("$") && !row.includes("<hl:bash>"), "continuations are not executable rows");
    }
    assert.match(out, /└─.*\$.*<hl:bash>echo done/, "the terminator restores command context");
  }
  const python = resolver("python", () => undefined);
  const pyCode = { code: "import os\nprint(os.getcwd())" };
  const pyCall = render(python.renderCall(pyCode, theme, context("py-call", pyCode, quiet)));
  assert.match(pyCall, /◇ python/, "multi-line python renders a bare header row");
  assert.match(pyCall, /├─ \$ {2}<hl:python>import os/, "the first code line is the executable $ leaf, python-highlighted");
  assert.match(pyCall, /│ {5}<hl:python>print\(os\.getcwd\(\)\)/, "remaining code lines ride the spine, still python-highlighted");
  assert.ok(!pyCall.includes("<hl:bash>"), "python rows never use the bash grammar");
  assert.equal(pyCall.split("\n").filter((line) => line.includes("$")).length, 1, "only the first code line gets a $ marker");
  assert.match(render(python.renderCall({ code: "print(1)" }, theme, context("py-one", {}, quiet))), /◇ python \$ <hl:python>print\(1\)/, "single-line snippets stay inline");
  const pyBlank = render(python.renderCall({ code: "\n\nimport os\n" }, theme, context("py-blank", {}, quiet)));
  assert.match(pyBlank, /└─ \$ {2}<hl:python>import os/, "leading and trailing blank lines do not steal the leaf");
  assert.ok(!render(python.renderCall({ code: "   " }, theme, context("py-empty", {}, quiet))).includes("├─"), "blank-only code renders no leaves");
  // Intent-title lift: the leading `#` comment becomes the row title; the
  // next non-comment line takes the $ leaf. Bash and python only.
  const bashTitle = render(bash.renderCall({ command: "# list files changed on this branch against main\ngit diff --name-only main...HEAD" }, theme, context("bash-title", {}, quiet)));
  assert.match(bashTitle, /^ ◇ bash — list files changed on this branch against main$/m, "a lifted bash title renders a bare header row, even for a single command");
  assert.match(bashTitle, /└─ \$ {2}<hl:bash>git diff --name-only main\.\.\.HEAD/, "a titled single command rides its own railed $ leaf");
  assert.ok(!bashTitle.includes("◇ bash — list files changed on this branch against main $"), "the command never shares the title row");
  const bashTitleMulti = render(bash.renderCall({ command: "# verify worktree state before the rebase\ngit status --short\ngit log --oneline -1" }, theme, context("bash-title-multi", {}, quiet)));
  assert.match(bashTitleMulti, /^ ◇ bash — verify worktree state before the rebase$/m, "a lifted title rides the bare header row");
  assert.match(bashTitleMulti, /├─ \$ {2}<hl:bash>git status --short/, "the first line after the comment becomes the $");
  assert.ok(!bashTitleMulti.includes("# verify"), "the lifted comment never renders as a body row");
  const commentOnly = render(bash.renderCall({ command: "# check whether the daemon reloaded after the config change" }, theme, context("bash-comment-only", {}, quiet)));
  assert.match(commentOnly, /^ ◇ bash — check whether the daemon reloaded after the config change$/m, "a comment-only call renders the title as the whole row");
  assert.ok(!commentOnly.includes("$"), "no $ leaf renders without executable text");
  const heredocComment = render(bash.renderCall({ command: "cat <<EOF\n# not a title\nEOF\necho done" }, theme, context("heredoc-comment", {}, quiet)));
  assert.ok(!heredocComment.includes("— "), "a # inside a heredoc body never lifts");
  assert.match(heredocComment, /│ {5}# not a title/, "heredoc # lines stay body rows");
  const pyTitle = render(python.renderCall({ code: "# parse the session log for nested bash calls\nimport json\nrows = [json.loads(line) for line in open(path)]" }, theme, context("py-title", {}, quiet)));
  assert.match(pyTitle, /^ ◇ python — parse the session log for nested bash calls$/m, "a lifted python title rides the header row");
  assert.match(pyTitle, /├─ \$ {2}<hl:python>import json/, "the first code line after the comment becomes the $");
  assert.match(pyTitle, /│ {5}<hl:python>rows = /, "remaining code lines ride the spine");
  const longTitle = `# ${"word ".repeat(30).trim()}`;
  const capped = render(bash.renderCall({ command: `${longTitle}\necho hi` }, theme, context("bash-cap", {}, quiet)));
  assert.ok(capped.includes("…"), "overlong titles truncate with an ellipsis");
  assert.ok(!capped.includes(longTitle.slice(2)), "the untruncated title never renders");
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
  const midclose = render(bash.renderCall({ command: 'git commit -q -m "Add sample\n\nDemonstrates row shapes." && git log --oneline -1' }, theme, context("midclose", {}, quiet)));
  assert.match(midclose, /├─ \$ {2}<hl:bash>git commit -q -m "Add sample/);
  assert.match(midclose, /^ │\s*$/m);
  assert.match(midclose, /Demonstrates row shapes\."/, "the quoted message renders dim to its close");
  assert.match(midclose, / │  && <hl:bash>git log --oneline -1/, "a command following a mid-line quote close gets its own executable row");
  const bashOut = render(bash.renderResult(result("line one\nline two\nline three", { exitCode: 0 }), { ...options, expanded: true }, theme, context("bout", {}, quiet)));
  assert.match(bashOut, /└─ ✓ exit 0 · 3 lines/, "the status banner replaces the collapsed summary when expanded");
  assert.match(bashOut, /^ {4}line two$/m, "output lines indent with plain space, no rail glyph");
  const many = Array.from({ length: 100 }, (_, i) => `out ${i}`).join("\n");
  const folded = render(bash.renderResult(result(many, { exitCode: 0 }), { ...options, expanded: true }, theme, context("fold", {}, quiet)));
  assert.match(folded, /^ {4}out 0$/m);
  assert.match(folded, /^ {4}out 29$/m);
  assert.ok(!folded.includes("out 30"), "middle lines fold away");
  assert.match(folded, /… 40 lines hidden …/);
  assert.match(folded, /^ {4}out 99$/m);
  const errTheme = { ...theme, fg: (c, t) => (c === "error" ? `<e>${t}</e>` : t) };
  const failedBanner = render(bash.renderResult(result("boom", { exitCode: 2 }), { ...options, expanded: true }, errTheme, context("fb", {}, quiet)));
  assert.match(failedBanner, /└─ <e>✗ exit 2<\/e> · 1 line/, "failed runs get a red ✗ banner");
  assert.match(failedBanner, /^ {4}boom$/m);
  assert.match(render(python.renderResult(result("hi\n", { exitCode: 0, stdout: "hi\n", stderr: "" }), options, theme, context("py-res", pyCode))), /exit 0 · 1 line/, "collapsed python rows use the bash exit/line summary");
  const pyBanner = render(python.renderResult(result("hi\n", { exitCode: 0 }), { ...options, expanded: true }, theme, context("py-ban", pyCode)));
  assert.match(pyBanner, /└─ ✓ exit 0 · 1 line/, "expanded python rows get the status banner");
  assert.match(pyBanner, /^ {4}hi$/m, "stdout renders behind the plain indent");
  const pyFail = render(python.renderResult(result("stderr:\nTraceback", { exitCode: 1 }), { ...options, expanded: true }, errTheme, context("py-fail", pyCode)));
  assert.match(pyFail, /└─ <e>✗ exit 1<\/e> · 2 lines/, "failed python runs get the red ✗ banner");
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

  const mcpRead = resolver("mcp__whatsapp__list_messages", () => { throw new Error("MCP must not delegate"); });
  const mcpCtx = context("mcp-read", { query: "first\nsecond", message: "ignored" }, quiet);
  const mcpHeader = render(mcpRead.renderCall(mcpCtx.args, styT, mcpCtx));
  assert.ok(mcpHeader.includes("<dim>mcp · whatsapp — </dim><text><b>list_messages</b></text><dim> first…</dim>"));
  const previewKeys = ["query", "message", "text", "path", "channel", "file", "url", "name"];
  for (let i = 0; i < previewKeys.length; i++) {
    const args = { fallback: "fallback", ...Object.fromEntries(previewKeys.map((key, j) => [key, j < i ? " \n" : key])) };
    assert.ok(render(mcpRead.renderCall(args, theme, mcpCtx)).endsWith(` ${previewKeys[i]}`));
  }
  for (const args of [{ count: 5, empty: "\n ", custom: "fallback" }, { query: {}, custom: "fallback" }]) {
    assert.ok(render(mcpRead.renderCall(args, theme, mcpCtx)).endsWith(" fallback"));
  }
  const streamingMcpArgs = { query: "fir" };
  const streamingMcp = mcpRead.renderCall(streamingMcpArgs, theme, context("mcp-stream", streamingMcpArgs, quiet));
  assert.ok(render(streamingMcp).endsWith(" fir"));
  streamingMcpArgs.query = "first line";
  assert.ok(render(streamingMcp).endsWith(" first line"));
  assert.ok(render(mcpRead.renderCall({ query: "x".repeat(100) }, theme, mcpCtx), 50).endsWith("…"));
  const mcpText = result("one\n\n \ntwo\n");
  delete mcpText.details;
  assert.equal(render(mcpRead.renderResult(mcpText, options, theme, mcpCtx)), " └─ ✓ 2 items");
  const mcpShown = render(mcpRead.renderResult(mcpText, { ...options, expanded: true }, styT, mcpCtx));
  assert.ok(mcpShown.includes("<success>✓ 2 items</success>") && mcpShown.includes("    <toolOutput>two</toolOutput>"));
  assert.ok(!mcpShown.includes("│"));
  for (const count of [60, 61, 62, 100]) {
    const out = render(mcpRead.renderResult(result(Array.from({ length: count }, (_, i) => `item-${i}`).join("\n")), { ...options, expanded: true }, theme, context(`mcp-fold-${count}`, {}, quiet)));
    assert.ok(out.includes(`✓ ${count} items`) && out.includes("    item-0\n") && out.endsWith(`    item-${count - 1}`));
    assert.equal(out.includes("lines hidden"), count > 60);
    if (count > 60) assert.ok(out.includes(`… ${count - 60} lines hidden …`) && !out.includes("    item-30\n"));
  }
  for (const truncated of [result("one", { truncation: { truncated: true } }), result("one", { truncation: true }), result("one", { outputGuard: { truncated: true } }), result("one\n…200 chars truncated…")]) {
    assert.ok(render(mcpRead.renderResult(truncated, options, theme, mcpCtx)).includes(" · truncated"));
  }
  for (const empty of [result(""), result("\n \n"), { content: [] }]) {
    assert.ok(render(mcpRead.renderResult(empty, { ...options, expanded: true }, styT, mcpCtx)).includes("<dim>✓ no results</dim>"));
  }
  const safeMcp = render(mcpRead.renderResult(result("\u001b[31mone\u001b[0m\ntwo\tthree"), { ...options, expanded: true }, theme, mcpCtx));
  assert.ok(!safeMcp.includes("\u001b") && safeMcp.includes("    two  three"));
  const wrappingMcp = render(mcpRead.renderResult(result("abcdefghij".repeat(5)), { ...options, expanded: true }, theme, mcpCtx), 24);
  assert.equal(wrappingMcp.split("\n").slice(1).map((line) => line.slice(4)).join(""), "abcdefghij".repeat(5));
  const mcpSend = resolver("mcp__google_workspace__send_gmail_message", () => undefined);
  const sendCtx = context("mcp-send", { user_google_email: "sender", to: "recipient", body: "Hello\nGoodbye" }, quiet);
  const mcpSent = render(mcpSend.renderResult(result("receipt"), options, styT, sendCtx));
  assert.ok(mcpSent.includes("<borderMuted>├─</borderMuted> <dim>» </dim> <text>Hello…</text>"));
  assert.ok(mcpSent.includes("<success>✓ sent</success>") && !mcpSent.includes("receipt"));
  const mcpSendShown = render(mcpSend.renderResult(result("receipt"), { ...options, expanded: true }, styT, sendCtx));
  assert.ok(mcpSendShown.includes("<dim>» </dim> <text>Hello</text>") && mcpSendShown.includes("<borderMuted>│</borderMuted>     <text>Goodbye</text>"));
  const mcpFile = render(mcpSend.renderResult(result("receipt"), options, theme, context("mcp-file", { recipient: "recipient", media_path: "/tmp/photo.png" }, quiet)));
  assert.ok(mcpFile.includes("├─ »  /tmp/photo.png") && !mcpFile.includes("recipient"));
  const payload = "abcdefghij".repeat(30) + "END";
  const fullSend = render(mcpSend.renderResult(result(""), { ...options, expanded: true }, theme, context("mcp-send-wrap", { message: payload }, quiet)), 24);
  assert.equal(fullSend.split("\n").slice(0, -1).map((line) => line.slice(7)).join(""), payload, "shown payload wraps fully on the spine");
  for (const prefix of ["list_", "get_", "search_", "fetch_", "read_", "query_", "whoami", "download_", "send_", "post_", "create_", "modify_", "update_", "add_", "draft_", "append_", "move_", "rename_", "invite_", "join_", "manage_"]) {
    const tool = resolver(`mcp__server__${prefix}example`, () => undefined);
    const out = render(tool.renderResult(result("one"), options, theme, context(`mcp-class-${prefix}`, { text: "payload" }, quiet)));
    assert.ok(out.includes(["list_", "get_", "search_", "fetch_", "read_", "query_", "whoami", "download_"].includes(prefix) ? "✓ 1 item" : "✓ sent"), prefix);
  }
  for (const name of ["mcp__browserbase__act", "mcp__browserbase__observe", "mcp__list_server__batch_get", "mcp__server__list", "mcp__unknown"]) {
    const tool = resolver(name, () => undefined);
    const out = render(tool.renderResult(result('{"steps":["done"]}'), { ...options, expanded: true }, theme, context(name, {}, quiet)));
    assert.ok(out.includes("└─ ✓ done\n    {\"steps\":[\"done\"]}") && !out.includes("│"), name);
  }
  for (const tool of [mcpRead, mcpSend, resolver("mcp__browserbase__act", () => undefined)]) {
    for (const [value, extra] of [[result("bad request\nmore detail"), { isError: true }], [{ ...result("bad request\nmore detail"), isError: true }, {}]]) {
      const out = render(tool.renderResult(value, options, styT, context("mcp-error", { text: "payload" }, { ...quiet, ...extra })));
      assert.ok(out.includes("<error>✗ bad request</error>") && !out.includes("more detail"));
    }
    const partial = render(tool.renderResult(result("one"), { ...options, isPartial: true }, theme, context("mcp-partial", {}, quiet)));
    assert.ok(partial.includes("● running") && !partial.includes("✓"));
  }
  assert.ok(render(mcpRead.renderResult(result("an example exited with code 2"), options, theme, mcpCtx)).includes("✓ 1 item"), "MCP text is not a shell exit status");
  assert.ok(render(mcpRead.renderResult(result("", { error: "unavailable" }), options, styT, mcpCtx)).includes("<error>✗ unavailable</error>"));
  const adapterResult = result("message 1\nmessage 2", { mode: "call", server: "google_workspace", tool: "search_gmail_messages", mcpResult: { structuredContent: { result: "message 1\nmessage 2" } } });
  assert.equal(render(mcpRead.renderResult(adapterResult, options, theme, mcpCtx)), " └─ ✓ 2 items", "adapter metadata is not an invented item list");

  const message = resolver("subagent_message", () => undefined);
  const messageArgs = { name: "scout", message: "Inspect the renderer.\nThen report back." };
  const messageCtx = context("message", messageArgs, quiet);
  const messageCall = message.renderCall(messageArgs, styT, messageCtx);
  const letter = render(messageCall);
  assert.ok(letter.includes("<text><b>subagent_message</b></text>"));
  assert.ok(letter.includes("<dim>» </dim> <text>scout</text><dim> — Inspect the renderer.…</dim>"));
  assert.ok(!letter.includes("Then report back"));
  const steerResult = result('Message delivered to running subagent "scout".', { id: "abc", name: "scout", status: "steered" });
  assert.ok(render(message.renderResult(steerResult, options, styT, messageCtx)).includes("<success>✓ steered · delivered live</success>"));
  assert.ok(!render(messageCall).includes("»"), "receipt owns the leaf once a result arrives");
  const messageShown = render(message.renderResult(steerResult, { ...options, expanded: true }, styT, messageCtx));
  assert.ok(messageShown.includes("<dim>» </dim> <text>scout</text>"));
  assert.ok(messageShown.includes("<borderMuted>│</borderMuted>  <dim>Then report back.</dim>"));
  assert.ok(messageShown.includes("<dim>the child keeps running; its result arrives as a steer message</dim>"));
  const resumedMessage = render(message.renderResult(result("", { name: "scout", status: "started" }), { ...options, expanded: true }, styT, messageCtx));
  assert.ok(resumedMessage.includes("<accent>⟳ resumed · follow-up dispatched</accent>"));
  assert.ok(resumedMessage.includes("<dim>waits for readiness on Herdr, dispatch on tmux</dim>"));
  for (const [text, banner] of [['Message delivered to running subagent "worker".', "✓ steered"], ['Session "worker" resumed.', "⟳ resumed"]]) {
    const sparse = render(message.renderResult(result(text), options, theme, context(`sparse-${banner}`, {}, quiet)));
    assert.ok(sparse.includes("├─ »  worker") && sparse.includes(banner));
  }
  const longMessage = "abcdefghij".repeat(30) + "END";
  const narrowMessage = render(message.renderResult(steerResult, { ...options, expanded: true }, theme, context("message-wrap", { name: "scout", message: longMessage }, quiet)), 24);
  assert.equal(narrowMessage.split("\n").filter((line) => line.startsWith(" │  ")).map((line) => line.slice(4)).join(""), longMessage, "full message wraps on the bare spine without folding");
  assert.ok(render(message.renderResult(steerResult, { ...options, isPartial: true }, theme, context("message-partial", messageArgs, quiet))).includes("└─ running"));
  assert.ok(render(message.renderResult(result("missing", { error: "missing" }), options, styT, messageCtx)).includes("<error>✗ missing</error>"));
  assert.ok(render(message.renderResult(result("", { status: "cancelled" }), options, styT, messageCtx)).includes("<dim>✗ cancelled</dim>"));
  assert.ok(render(message.renderResult(result(""), options, theme, context("message-empty", {}, quiet))).includes("✗ unavailable"));
  assert.ok(!render(message.renderResult(steerResult, options, theme, messageCtx)).includes("<success>"), "theme change invalidates receipt cache");
  const streamingMessage = { name: "worker", message: "fir" };
  const streamingLetter = message.renderCall(streamingMessage, theme, context("message-stream", streamingMessage, quiet));
  assert.ok(render(streamingLetter).includes("worker — fir"));
  streamingMessage.message = "first line";
  assert.ok(render(streamingLetter).includes("worker — first line"));

  const hunk = resolver("hunk_review", () => undefined);
  const commentArgs = { operation: "comment_apply", comments: [
    { filePath: "src/a.ts", newLine: 12, summary: "Guard the input.\nMore context", rationale: "Missing values can reach this path." },
    { filePath: "src/b.ts", oldLine: 8, summary: "Keep the check." },
  ] };
  const commentCtx = context("hunk-comments", commentArgs, quiet);
  const commentCall = hunk.renderCall(commentArgs, styT, commentCtx);
  const commentCallText = render(commentCall);
  assert.ok(commentCallText.includes("<text><b>hunk_review</b></text><dim> · comment_apply</dim>"));
  assert.ok(commentCallText.includes("<dim>✎ </dim> <dim>src/a.ts:12 — </dim><text>Guard the input.…</text>"));
  assert.ok(commentCallText.includes("<dim>✎ </dim> <dim>src/b.ts:8 — </dim><text>Keep the check.</text>"));
  assert.ok(!commentCallText.includes("Missing values"));
  // Actual CLI shape: no details and no session id in comment_apply output.
  const appliedComments = { result: { applied: [
    { commentId: "c1", fileId: "f1", filePath: "src/a.ts", hunkIndex: 0, side: "new", line: 12 },
    { commentId: "c2", fileId: "f2", filePath: "src/b.ts", hunkIndex: 1, side: "old", line: 8 },
  ] } };
  const appliedResult = result(JSON.stringify(appliedComments));
  delete appliedResult.details;
  const commentMin = render(hunk.renderResult(appliedResult, options, styT, commentCtx));
  assert.ok(commentMin.includes("<success>✓ applied · 2 comments</success>"));
  assert.ok(!commentMin.includes("session") && !commentMin.includes("Missing values"));
  assert.ok(!render(commentCall).includes("✎"), "comment result owns the leaves");
  const commentShown = render(hunk.renderResult(appliedResult, { ...options, expanded: true }, styT, commentCtx));
  assert.ok(commentShown.includes("<borderMuted>│</borderMuted>  <dim>Missing values can reach this path.</dim>"));
  const identifiedApply = render(hunk.renderResult(result(JSON.stringify(appliedComments), { sessionId: "review-7" }), options, theme, commentCtx));
  assert.ok(identifiedApply.includes("✓ applied · 2 comments · session review-7"));
  const returnedRationale = render(hunk.renderResult(result("", { applied: [{ filePath: "src/b.ts", rationale: "Returned rationale." }] }), { ...options, expanded: true }, styT, context("hunk-rationale", { operation: "comment_apply", comments: [commentArgs.comments[1]] }, quiet)));
  assert.ok(returnedRationale.includes("<dim>Returned rationale.</dim>"));
  assert.ok(returnedRationale.includes("✓ applied · 1 comment"));
  const streamingComments = { operation: "comment_apply", comments: [{ filePath: "src/a.ts" }] };
  const streamingHunk = hunk.renderCall(streamingComments, theme, context("hunk-stream", streamingComments, quiet));
  assert.ok(render(streamingHunk).includes("├─ ✎  src/a.ts"));
  streamingComments.comments[0].newLine = 3;
  streamingComments.comments[0].summary = "First";
  streamingComments.comments.push({ filePath: "src/b.ts", hunkNumber: 2, summary: "Second" });
  const streamed = render(streamingHunk);
  assert.ok(streamed.includes("├─ ✎  src/a.ts:3 — First") && streamed.includes("├─ ✎  src/b.ts · hunk 2 — Second"));
  const longRationale = "abcdefghij".repeat(30) + "END";
  const rationaleWrapped = render(hunk.renderResult(appliedResult, { ...options, expanded: true }, theme, context("hunk-wrap", { operation: "comment_apply", comments: [{ filePath: "a", rationale: longRationale }] }, quiet)), 24);
  assert.equal(rationaleWrapped.split("\n").filter((line) => line.startsWith(" │  ")).map((line) => line.slice(4)).join(""), longRationale);
  const reviewArgs = { operation: "review", includePatch: true, includeNotes: true };
  const reviewCtx = context("hunk-review", reviewArgs, quiet);
  const reviewData = { review: { sessionId: "session-1", repoRoot: "/repo", title: "repo diff", showAgentNotes: true, liveCommentCount: 1,
    files: [{ path: "src/a.ts", additions: 1, deletions: 1, hunkCount: 1, patch: "@@ -1 +1 @@\n-old\n+new", hunks: [] }],
    reviewNotes: [{ noteId: "n1", filePath: "src/a.ts", body: "Keep this note." }],
  } };
  const reviewResult = result(JSON.stringify(reviewData));
  const reviewMin = render(hunk.renderResult(reviewResult, options, styT, reviewCtx));
  assert.ok(reviewMin.includes("<dim>▣ </dim> <text>hunk</text><dim> · /repo</dim>"));
  assert.ok(reviewMin.includes("<success>✓ session session-1</success>"));
  assert.ok(!reviewMin.includes("Keep this note"));
  const reviewShown = render(hunk.renderResult(reviewResult, { ...options, expanded: true }, styT, reviewCtx));
  assert.ok(reviewShown.includes('    <toolOutput>  "showAgentNotes": true,</toolOutput>'));
  assert.ok(reviewShown.includes('"body": "Keep this note."'));
  assert.ok(reviewShown.includes("    <dim>@@ -1 +1 @@</dim>\n    <dim>-old</dim>\n    <dim>+new</dim>"));
  assert.ok(!reviewShown.includes("│"), "session state uses copyable plain indentation, not rails");
  for (const count of [60, 61, 100]) {
    const output = Array.from({ length: count }, (_, i) => `state ${i}`).join("\n");
    const foldedState = render(hunk.renderResult(result(output), { ...options, expanded: true }, theme, context(`hunk-fold-${count}`, reviewArgs, quiet)));
    assert.ok(foldedState.includes("    state 0\n") && foldedState.includes(`    state ${count - 1}`));
    assert.equal(foldedState.includes("lines hidden"), count > 60);
    if (count > 60) {
      assert.ok(foldedState.includes(`… ${count - 60} lines hidden …`));
      assert.ok(!foldedState.includes("    state 30\n"));
    }
  }
  const truncatedReview = '{"review":{"sessionId":"cut-1","repoRoot":"/repo","files":[{"patch":"incomplete';
  const truncatedHunk = render(hunk.renderResult(result(truncatedReview), { ...options, expanded: true }, theme, context("hunk-cut", reviewArgs, quiet)));
  assert.ok(truncatedHunk.includes("hunk · /repo") && truncatedHunk.includes("✓ session cut-1") && truncatedHunk.includes("incomplete"));
  const unknownApply = render(hunk.renderResult(result('{"result":{"applied":['), options, theme, commentCtx));
  assert.ok(unknownApply.includes("✓ completed") && !unknownApply.includes("✓ applied"), "never substitute requested count for an unknown applied count");
  const unknownReview = render(hunk.renderResult(result("Hunk command completed."), { ...options, expanded: true }, theme, context("hunk-unknown", reviewArgs, quiet)));
  assert.ok(unknownReview.includes("├─ ▣  hunk") && unknownReview.includes("✓ completed") && !unknownReview.includes("✓ session"));
  assert.ok(render(hunk.renderResult(reviewResult, { ...options, isPartial: true }, theme, context("hunk-partial", reviewArgs, quiet))).includes("└─ running"));
  const failedReview = render(hunk.renderResult(result("No active Hunk sessions"), options, styT, context("hunk-error", reviewArgs, { ...quiet, isError: true })));
  assert.ok(failedReview.includes("<error>✗ No active Hunk sessions</error>") && !failedReview.includes("✓"));
  assert.ok(render(hunk.renderResult(result("", { status: "cancelled" }), options, styT, reviewCtx)).includes("<dim>✗ cancelled</dim>"));
  assert.ok(!render(hunk.renderResult(reviewResult, { ...options, expanded: true }, theme, reviewCtx)).includes("<dim>"), "review cache follows theme changes");

  const ask = resolver("ask_user_question", () => undefined);
  const askArgs = { question: "Which approach?", details: "Choose for clarity.", options: [{ label: "First" }, { label: "Second" }, { label: "Third" }] };
  const askCtx = context("ask-choice", askArgs, quiet);
  const askCall = ask.renderCall(askArgs, styT, askCtx);
  const askCallText = render(askCall);
  assert.ok(askCallText.includes("<text><b>ask_user_question</b></text>"));
  assert.ok(askCallText.includes("<borderMuted>├─</borderMuted> <dim>? </dim> <text>Which approach?</text>"));
  assert.ok(!askCallText.includes("Choose for clarity"));
  const askDetails = { status: "answered", question: askArgs.question, context: askArgs.details, mode: "single-select", answers: [{ type: "option", index: 2, label: "Second", value: "second" }] };
  const askCollapsed = render(ask.renderResult(result("ignored", askDetails), options, styT, askCtx));
  assert.ok(askCollapsed.includes("<success>✓ option 2 — Second</success>"));
  assert.ok(askCollapsed.includes("<dim>? </dim>") && !askCollapsed.includes("Choose for clarity"));
  assert.ok(!render(askCall).includes("?"), "the result owns the question after first result, avoiding duplicate leaves");
  const askShown = render(ask.renderResult(result("ignored", askDetails), { ...options, expanded: true }, styT, askCtx));
  assert.ok(askShown.includes("<dim>Choose for clarity.</dim>"));
  assert.ok(askShown.includes("<dim>1 </dim> <dim>First</dim>"));
  assert.ok(askShown.includes("<dim>2 </dim> <text>✓ Second</text>"));
  const longQuestion = "question ".repeat(35) + "QUESTION_END";
  const longAskCtx = context("ask-long", { ...askArgs, question: longQuestion }, quiet);
  const longAsk = result("User selected: 1. First");
  const askNarrow = render(ask.renderResult(longAsk, options, theme, longAskCtx), 40);
  assert.equal(askNarrow.split("\n").length, 2, "minimized question never wraps");
  assert.ok(askNarrow.split("\n")[0].endsWith("…"));
  const askWrapped = render(ask.renderResult(longAsk, { ...options, expanded: true }, theme, longAskCtx), 40);
  assert.equal(askWrapped.split("\n").filter((line) => line.includes("? ")).length, 1);
  assert.ok(askWrapped.includes(" │     question") && askWrapped.includes("QUESTION_END"), "question wraps fully on a bare spine");
  const multilineCall = render(ask.renderCall({ question: "first\nsecond" }, theme, context("ask-stream", {}, quiet)));
  assert.ok(multilineCall.includes("├─ ?  first…") && !multilineCall.includes("second"));
  for (const question of ["W", "Wh", "Which?"]) {
    assert.ok(render(ask.renderCall({ question }, theme, context("ask-stream", {}, quiet))).includes(`?  ${question}`));
  }
  const multiAsk = render(ask.renderResult(result("", { ...askDetails, mode: "multi-select", answers: [{ index: 1, label: "First" }, { index: 3, label: "Third" }] }), options, styT, askCtx));
  assert.ok(multiAsk.includes("<success>✓ options 1 + 3</success>"));
  const typedAsk = render(ask.renderResult(result("", { ...askDetails, mode: "text", answers: [{ type: "text", label: "x".repeat(60), value: "typed" }] }), options, theme, askCtx));
  assert.ok(typedAsk.includes(`✓ ${"x".repeat(39)}…`));
  for (const status of ["cancelled", "unavailable"]) {
    assert.ok(render(ask.renderResult(result("", { status }), options, styT, askCtx)).includes(`<dim>✗ ${status}</dim>`));
  }
  for (const [text, banner] of [["User selected: 2. Second", "✓ option 2 — Second"], ["User selected:\n- 1. First\n- 3. Third", "✓ options 1 + 3"], ["User selected: Second", "✓ option 2 — Second"], ["User answered: typed answer", "✓ typed answer"], ["User selected: Other: custom", "✓ custom"], ["User cancelled the question", "✗ cancelled"]]) {
    assert.ok(render(ask.renderResult(result(text), options, theme, askCtx)).includes(banner), text);
  }
  const mixedOther = render(ask.renderResult(result("User selected:\n- 1. First\n- Other: custom"), options, theme, askCtx));
  assert.ok(mixedOther.includes("✓ option 1 — custom"));
  const multilineTyped = render(ask.renderResult(result("", { ...askDetails, mode: "text", answers: [{ type: "text", label: "first\nsecond" }] }), options, theme, askCtx));
  assert.ok(multilineTyped.includes("✓ first…") && !multilineTyped.includes("second"));
  const askPartial = render(ask.renderResult(result("", askDetails), { expanded: true, isPartial: true }, theme, askCtx));
  assert.ok(askPartial.includes("running") && !askPartial.includes("✓"));
  const longOptionCtx = context("ask-long-option", { question: "Pick?", options: [{ label: "label ".repeat(30) + "LABEL_END" }] }, quiet);
  const longOptionOut = render(ask.renderResult(result("User selected: 1. label"), { ...options, expanded: true }, theme, longOptionCtx), 40);
  assert.ok(longOptionOut.includes("LABEL_END") && longOptionOut.includes("└─ ✓ option 1"));
  const changedAsk = render(ask.renderResult(result("", askDetails), { ...options, expanded: true }, theme, askCtx));
  assert.ok(changedAsk.includes("✓ Second") && !changedAsk.includes("<dim>"), "theme changes invalidate pedagogy cache");

  const quiz = resolver("quiz", () => undefined);
  const quizArgs = { ...askArgs, shuffle: false, correctAnswer: "second", explanation: "Use `second` with **care**.", contextFiles: ["src/quiz.ts"] };
  const quizCtx = context("quiz-choice", quizArgs, quiet);
  assert.ok(render(quiz.renderCall(quizArgs, styT, quizCtx)).includes("<dim>? </dim> <text>Which approach?</text>"));
  const quizDetails = { status: "answered", question: quizArgs.question, mode: "single-select", answers: [{ index: 2, label: "Second", value: "second" }], correctIndices: [2], options: quizArgs.options.map((option, i) => ({ index: i + 1, label: option.label })), correct: true, dontKnow: false, explanation: quizArgs.explanation };
  const quizRight = render(quiz.renderResult(result("", quizDetails), { ...options, expanded: true }, styT, quizCtx));
  assert.ok(quizRight.includes("<success>✓ correct · option 2</success>"));
  assert.ok(quizRight.includes("<dim>2 </dim> <text>✓ Second</text>"));
  assert.ok(quizRight.includes("<dim>✎ </dim> Use <success>`second`</success> with <b>**care**</b>."));
  assert.ok(quizRight.includes("<dim>context: src/quiz.ts</dim>"));
  assert.ok(quizRight.includes("<dim>Choose for clarity.</dim>"));
  const quizWrongDetails = { ...quizDetails, correct: false, answers: [{ index: 3, label: "Third", value: "third" }] };
  const quizWrong = render(quiz.renderResult(result("", quizWrongDetails), { ...options, expanded: true }, styT, quizCtx));
  assert.ok(quizWrong.includes("<error>✗ incorrect · picked 3 · correct 2</error>"));
  assert.ok(quizWrong.includes("<dim>3 </dim> <error>✗ Third</error>"));
  assert.ok(quizWrong.includes("<dim>2 </dim> <success>✓ Second</success>"));
  for (const details of [{ ...quizDetails, correct: false, dontKnow: true, answers: [] }, { status: "too-hard", correctIndices: [2], answers: [] }]) {
    const out = render(quiz.renderResult(result("", details), { ...options, expanded: true }, styT, quizCtx));
    assert.ok(out.includes("<mdLink>● don't know — a genuine gap</mdLink>"));
    assert.ok(out.includes("<dim>1 </dim> <dim>First</dim>"));
    assert.ok(out.includes("<dim>2 </dim> <success>✓ Second</success>"));
    assert.ok(!out.includes("✗"));
  }
  const shuffledCtx = context("quiz-shuffle", { ...quizArgs, shuffle: true }, quiet);
  const shuffled = { ...quizDetails, options: [{ index: 1, label: "Third" }, { index: 2, label: "First" }, { index: 3, label: "Second" }], correctIndices: [3], answers: [{ index: 3, label: "Second" }] };
  const shuffledOut = render(quiz.renderResult(result("", shuffled), { ...options, expanded: true }, theme, shuffledCtx));
  assert.ok(shuffledOut.includes("1  Third") && shuffledOut.includes("3  ✓ Second"), "use displayed order, never input order");
  const partialQuizCtx = context("quiz-partial-shuffle", { ...quizArgs, shuffle: true }, quiet);
  const partialQuiz = render(quiz.renderResult(result("Awaiting user response...", { options: shuffled.options }), { expanded: true, isPartial: true }, theme, partialQuizCtx));
  assert.ok(partialQuiz.includes("running") && !partialQuiz.includes("✓") && !partialQuiz.includes("Use `second`"));
  const pausedQuiz = render(quiz.renderResult(result("", { status: "too-hard", correctIndices: [3], answers: [] }), { ...options, expanded: true }, theme, partialQuizCtx));
  assert.ok(pausedQuiz.includes("3  ✓ Second"), "Ctrl+P retains the partial update's shuffled display order");
  for (const [text, banner] of [
    ["User answered correctly.\nSelected: 2. Second\nCorrect: 2. Second\nExplanation: Use `second`.", "✓ correct · option 2"],
    ["User answered incorrectly.\nSelected: 3. Third\nCorrect: 2. Second", "✗ incorrect · picked 3 · correct 2"],
    ["User selected Other (I don't know) — a genuine knowledge gap, not a wrong guess.\nCorrect: 2. Second", "● don't know — a genuine gap"],
    ["User passed with Ctrl+P because the question was too hard.", "● don't know — a genuine gap"],
    ["User cancelled the quiz", "✗ cancelled"],
  ]) {
    assert.ok(render(quiz.renderResult(result(text), options, theme, context(`quiz-fallback-${banner}`, quizArgs, quiet))).includes(banner), text);
  }
  for (const status of ["cancelled", "unavailable", "follow-up"]) {
    assert.ok(render(quiz.renderResult(result("", { status }), options, styT, quizCtx)).includes(`<dim>✗ ${status}</dim>`));
  }
  const quizMin = render(quiz.renderResult(result("", quizDetails), options, styT, quizCtx));
  assert.ok(!quizMin.includes("Choose for clarity") && !quizMin.includes("✎") && !quizMin.includes("context:"));
  const longQuizCtx = context("quiz-long-question", { ...quizArgs, question: longQuestion }, quiet);
  const longQuizResult = result("User answered correctly.\nSelected: 2. Second\nCorrect: 2. Second");
  const quizMinLong = render(quiz.renderResult(longQuizResult, options, theme, longQuizCtx), 40);
  assert.equal(quizMinLong.split("\n").length, 2);
  assert.ok(quizMinLong.split("\n")[0].endsWith("…"));
  const quizLong = render(quiz.renderResult(longQuizResult, { ...options, expanded: true }, theme, longQuizCtx), 40);
  assert.ok(quizLong.includes("QUESTION_END") && quizLong.includes(" │     question"));
  assert.equal(quizLong.split("\n").filter((line) => line.includes("? ")).length, 1);

  const explain = resolver("explain", () => undefined);
  const explainArgs = { question: "Explain the mechanism?", expected: "A descriptor names a file.\n- A table owns descriptors.", details: "Name the kernel construct." };
  const explainCtx = context("explain-grade", explainArgs, quiet);
  assert.ok(render(explain.renderCall(explainArgs, styT, explainCtx)).includes("<dim>? </dim> <text>Explain the mechanism?</text>"));
  const explainDetails = { status: "answered", question: explainArgs.question, answer: "A descriptor names a file.\nA process owns everything.", grading: { verdict: "partially_correct", grade: "C", summary: "Identify the owning table.", correctAnswer: "A table owns descriptors.", refinements: [{ quote: "A process owns everything.", issue: "Loose ownership", correction: "A table owns descriptors." }] } };
  const explainShown = render(explain.renderResult(result("", explainDetails), { ...options, expanded: true }, styT, explainCtx));
  assert.ok(explainShown.includes("<mdLink>● partially correct · grade C</mdLink>"));
  assert.ok(explainShown.includes("<dim>expected: </dim><success>✓ </success><dim>A descriptor names a file.</dim>"));
  assert.ok(explainShown.includes("<dim>expected: </dim><mdLink>● </mdLink><dim>A table owns descriptors.</dim>"));
  assert.ok(explainShown.includes("<dim>A </dim> <text>A descriptor names a file.</text>"));
  assert.ok(explainShown.includes("<dim>✎ </dim> <dim>Identify the owning table.</dim>"));
  assert.ok(explainShown.includes("<dim>· </dim> <dim>“A process owns everything.” — Loose ownership → A table owns descriptors.</dim>"));
  assert.ok(explainShown.includes("<dim>Name the kernel construct.</dim>"));
  for (const [verdict, grade, color, banner] of [["correct", "A", "success", "✓ correct"], ["partially_correct", "C", "mdLink", "● partially correct"], ["incorrect", "D", "error", "✗ incorrect"]]) {
    const details = { ...explainDetails, grading: { ...explainDetails.grading, verdict, grade } };
    const minimized = render(explain.renderResult(result("", details), options, styT, explainCtx));
    assert.ok(minimized.includes(`<${color}>${banner} · grade ${grade}</${color}>`));
    assert.ok(!minimized.includes("expected:") && !minimized.includes("Name the kernel construct") && !minimized.includes("✎"));
    if (verdict === "incorrect") {
      const expanded = render(explain.renderResult(result("", details), { ...options, expanded: true }, styT, explainCtx));
      assert.ok(expanded.includes("<error>✗ </error><dim>A table owns descriptors.</dim>"));
    }
    const fallback = `Question: Explain the mechanism?\nUser's answer (their own words):\nA descriptor names a file.\nA process owns everything.\n\nGrader verdict: ${verdict.toUpperCase()} (grade: ${grade})\nIdentify the owning table.\nCorrect answer: A table owns descriptors.\nTerminology refinements:\n- "A process owns everything." — Loose ownership → A table owns descriptors.\n\nVerdict is advisory — you own the final call and the follow-up.`;
    const parsed = render(explain.renderResult(result(fallback), { ...options, expanded: true }, styT, explainCtx));
    assert.ok(parsed.includes(`<${color}>${banner} · grade ${grade}</${color}>`));
    assert.ok(parsed.includes("<dim>A </dim> <text>A descriptor names a file.</text>"));
    assert.ok(parsed.includes("<dim>✎ </dim> <dim>Identify the owning table.</dim>"));
    assert.ok(parsed.includes("<dim>· </dim> <dim>“A process owns everything.” — Loose ownership → A table owns descriptors.</dim>"));
    assert.ok(!parsed.includes("Verdict is advisory"));
  }
  for (const output of [result("", { status: "answered" }), result('Question: Q?\nUser submitted an EMPTY answer — treat this as an honest "I don\'t know": a genuine gap to teach into, not a failure.')]) {
    assert.ok(render(explain.renderResult(output, options, styT, explainCtx)).includes("<mdLink>● don't know — a genuine gap</mdLink>"));
  }
  for (const status of ["cancelled", "unavailable"]) {
    assert.ok(render(explain.renderResult(result("", { status }), options, styT, explainCtx)).includes(`<dim>✗ ${status}</dim>`));
  }
  const bareVerdict = render(explain.renderResult(result("Grader verdict: CORRECT (grade: A)"), options, theme, explainCtx));
  assert.ok(bareVerdict.includes("✓ correct · grade A"));
  const failedExplain = render(explain.renderResult(result("", explainDetails), options, styT, context("failed-explain", explainArgs, { ...quiet, isError: true })));
  assert.ok(failedExplain.includes("<dim>✗ unavailable</dim>") && !failedExplain.includes("✗ answered"));
  const ungraded = render(explain.renderResult(result("", { status: "answered", answer: "My ungraded answer." }), { ...options, expanded: true }, styT, explainCtx));
  assert.ok(ungraded.includes("<dim>✗ unavailable</dim>") && ungraded.includes("<text>My ungraded answer.</text>"));
  const ambiguousCtx = context("explain-ambiguous", { question: "Q?", expected: "A table owns descriptors.\nA table owns descriptors.\nSome other claim." }, quiet);
  const ambiguous = render(explain.renderResult(result("", explainDetails), { ...options, expanded: true }, styT, ambiguousCtx));
  assert.ok(ambiguous.includes("<dim>expected: </dim><dim>A table owns descriptors.</dim>"));
  assert.ok(!ambiguous.includes("<mdLink>● </mdLink>") && !ambiguous.includes("<success>✓ </success>"), "ambiguous or unrelated claims stay unmarked");
  const inventedQuote = { ...explainDetails, grading: { ...explainDetails.grading, refinements: [{ quote: "Not in the answer", issue: "Wrong", correction: "A table owns descriptors." }] } };
  const invented = render(explain.renderResult(result("", inventedQuote), { ...options, expanded: true }, styT, explainCtx));
  assert.ok(invented.includes("<dim>expected: </dim><dim>A table owns descriptors.</dim>"), "never map invented grader quotes");
  const longExplainCtx = context("explain-long", { question: longQuestion, expected: "" }, quiet);
  const longExplainDetails = { status: "answered", answer: "answer ".repeat(30) + "ANSWER_END", grading: { verdict: "incorrect", grade: "F", summary: "summary ".repeat(25) + "SUMMARY_END", refinements: [{ quote: "quote ".repeat(30) + "QUOTE_END", issue: "wrong", correction: "correct" }] } };
  const explainMinLong = render(explain.renderResult(result("", longExplainDetails), options, theme, longExplainCtx), 40);
  assert.equal(explainMinLong.split("\n").length, 2);
  assert.ok(explainMinLong.split("\n")[0].endsWith("…"));
  const explainLong = render(explain.renderResult(result("", longExplainDetails), { ...options, expanded: true }, theme, longExplainCtx), 40);
  assert.ok(explainLong.includes("QUESTION_END") && explainLong.includes("ANSWER_END") && explainLong.includes("SUMMARY_END") && explainLong.includes("QUOTE_END"));
  for (const marker of ["? ", " A ", " ✎ ", " · "]) assert.equal(explainLong.split("\n").filter((line) => line.includes(marker)).length, marker === " · " ? 2 : 1);
  const explainPartial = render(explain.renderResult(result("", explainDetails), { expanded: true, isPartial: true }, theme, explainCtx));
  assert.ok(explainPartial.includes("running") && !explainPartial.includes("grade C"));
  for (const tool of [ask, quiz, explain]) {
    const narrow = tool.renderResult(result(""), { ...options, expanded: true }, theme, context(`pedagogy-narrow-${tool === ask ? "ask" : tool === quiz ? "quiz" : "explain"}`, { question: longQuestion }, quiet));
    assert.ok(narrow.render(16).every((line) => [...line].length <= 16));
  }

  const grep = resolver("grep", () => undefined);
  const grepArgs = { pattern: "needle", path: "src", glob: "*.ts", ignoreCase: true, literal: true, context: 2 };
  const grepCtx = context("grep-hits", grepArgs, quiet);
  const grepCall = render(grep.renderCall(grepArgs, styT, grepCtx));
  assert.ok(grepCall.includes('<text><b>"needle"</b></text>'));
  assert.ok(grepCall.includes("<dim> in src · *.ts · -i · -F · ctx 2</dim>"));
  assert.ok(grepCall.includes("<borderMuted>├─</borderMuted> <dim>$ </dim>"));
  const hits = result("src/a.ts:2:needle one\nsrc/a.ts:9:two NEEDLEs\nsrc/with:colon.ts:3:needle three");
  const grepCollapsed = render(grep.renderResult(hits, options, styT, grepCtx));
  assert.match(grepCollapsed, /3 matches · 2 files/);
  assert.ok(grepCollapsed.includes("<borderMuted>│</borderMuted>  <dim>src/a.ts:2:</dim><toolOutput><b>needle</b> one"));
  assert.ok(!grepCollapsed.includes("two NEEDLEs"));
  const grepExpanded = render(grep.renderResult(hits, { ...options, expanded: true }, styT, grepCtx));
  assert.ok(grepExpanded.includes("<success><b>✓ 3 matches</b></success><dim> · 2 files</dim>"));
  assert.ok(grepExpanded.includes("two <b>NEEDLE</b>s"));
  assert.ok(grepExpanded.includes("<dim>src/with:colon.ts:3:</dim>"));
  const grepZero = render(grep.renderResult(result("No matches found"), { ...options, expanded: true }, styT, context("grep-zero", grepArgs, quiet)));
  assert.ok(grepZero.includes("<error><b>✗ 0 matches</b></error>"));
  assert.ok(!grepZero.includes("No matches found"));
  const grepMany = result(Array.from({ length: 100 }, (_, i) => `file.ts:${i + 1}:needle ${i}`).join("\n"));
  const grepFold = render(grep.renderResult(grepMany, { ...options, expanded: true }, styT, context("grep-fold", grepArgs, quiet)));
  assert.match(grepFold, /100 matches/);
  assert.ok(grepFold.includes("<dim>… 40 lines hidden …</dim>"));
  assert.ok(grepFold.includes("file.ts:30:") && grepFold.includes("file.ts:71:") && grepFold.includes("file.ts:100:"));
  assert.ok(!grepFold.includes("file.ts:31:"));
  const grepPartial = render(grep.renderResult(hits, { expanded: true, isPartial: true }, styT, context("grep-partial", grepArgs, quiet)));
  assert.match(grepPartial, /running/);
  assert.ok(!grepPartial.includes("✓") && grepPartial.includes("<b>needle</b>"));
  const grepError = render(grep.renderResult(result("bad pattern"), { ...options, expanded: true }, styT, context("grep-error", grepArgs, { ...quiet, isError: true })));
  assert.ok(grepError.includes("<error><b>✗ bad pattern</b></error>"));
  const grepNative = result("src/a.ts-9- before:123: context\nsrc/a.ts:10: value:123: needle\nsrc/a.ts-11- after\nsrc/a.ts:12: needle\nsrc/with:colon.ts:3: needle");
  const grepNativeCtx = context("grep-native", grepArgs, quiet);
  const grepNativeOut = render(grep.renderResult(grepNative, { ...options, expanded: true }, styT, grepNativeCtx));
  assert.match(grepNativeOut, /3 matches/);
  assert.ok(grepNativeOut.includes(" · 2 files"));
  assert.ok(grepNativeOut.includes("<dim>src/a.ts:10:</dim><toolOutput> value:123: <b>needle</b>"));
  assert.ok(grepNativeOut.includes("<dim>src/a.ts-9- before:123: context</dim>"));
  assert.ok(grepNativeOut.includes("<dim>src/a.ts-11- after</dim>"));
  const grepNativeCollapsed = render(grep.renderResult(grepNative, options, styT, grepNativeCtx));
  assert.ok(grepNativeCollapsed.includes("src/a.ts:10:") && !grepNativeCollapsed.includes("src/a.ts-9-"));
  for (const details of [{ matchLimitReached: 1 }, { linesTruncated: true }]) {
    const grepLimit = render(grep.renderResult(result("a.ts:1: needle\n\n[tool truncation notice]", details), { ...options, expanded: true }, styT, context(`grep-${JSON.stringify(details)}`, grepArgs, quiet)));
    assert.ok(grepLimit.includes("✓ 1 match") && grepLimit.includes(" · 1 file · truncated"));
  }
  const grepLong = render(grep.renderResult(result(`a.ts:42: needle ${"x".repeat(500)}`), { ...options, expanded: true }, theme, context("grep-long", grepArgs, quiet)), 40);
  assert.match(grepLong, /a\.ts:42: needle/);
  assert.match(grepLong, /… \d+ wrapped lines hidden/);
  const grepLiteralArgs = { pattern: "a.b", literal: true };
  const grepLiteral = render(grep.renderResult(result("f:1:a.b axb a.b"), { ...options, expanded: true }, styT, context("grep-literal", grepLiteralArgs, quiet)));
  assert.ok(grepLiteral.includes("<b>a.b</b> axb <b>a.b</b>"));
  // A new partial source or theme must invalidate the per-call row cache.
  const grepChanged = render(grep.renderResult(result("new:4:new needle"), { ...options, expanded: true }, theme, grepCtx));
  assert.match(grepChanged, /new:4:new needle/);
  assert.ok(!grepChanged.includes("<b>"));

  const find = resolver("find", () => undefined);
  const findCtx = context("find-tree", { pattern: "*.ts", path: "src" }, quiet);
  assert.match(render(find.renderCall(findCtx.args, theme, findCtx)), /"\*\.ts" in src/);
  const paths = result("src/a.ts\nsrc/nested/b.ts\nREADME.md\n");
  assert.match(render(find.renderResult(paths, options, styT, findCtx)), /3 paths/);
  const tree = render(find.renderResult(paths, { ...options, expanded: true }, styT, findCtx));
  assert.ok(tree.includes("<success><b>✓ 3 paths</b></success>"));
  assert.ok(tree.includes("<borderMuted>├── </borderMuted><accent><b>src/</b></accent>"));
  assert.ok(tree.includes("<borderMuted>│   ├── </borderMuted><toolOutput>a.ts</toolOutput>"));
  assert.ok(tree.includes("<borderMuted>│   └── </borderMuted><accent><b>nested/</b></accent>"));
  assert.ok(tree.includes("<borderMuted>│       └── </borderMuted><toolOutput>b.ts</toolOutput>"));
  assert.ok(tree.includes("<borderMuted>└── </borderMuted><toolOutput>README.md</toolOutput>"));
  const treeFold = render(find.renderResult(result(Array.from({ length: 100 }, (_, i) => `src/file-${i}.ts`).join("\n")), { ...options, expanded: true }, styT, context("find-fold", {}, quiet)));
  assert.ok(treeFold.includes("<dim>… 41 hidden …</dim>"));
  assert.ok(treeFold.includes("file-0.ts") && treeFold.includes("file-99.ts"));
  assert.ok(!treeFold.includes("file-30.ts"));
  const treeTruncated = render(find.renderResult(result("a.ts\nb.ts\n\n[2 results limit reached. Use limit=4 for more]", { resultLimitReached: 2, truncation: { truncated: true } }), { ...options, expanded: true }, styT, context("find-limit", {}, quiet)));
  assert.ok(treeTruncated.includes("<success><b>✓ 2 paths</b></success><dim> · truncated</dim>"));
  assert.ok(!treeTruncated.includes("limit reached"));
  const treeEmpty = render(find.renderResult(result("No files found matching pattern"), { ...options, expanded: true }, styT, context("find-empty", {}, quiet)));
  assert.ok(treeEmpty.includes("✓ 0 paths") && !treeEmpty.includes("└──"));
  const treePartial = render(find.renderResult(paths, { expanded: true, isPartial: true }, styT, context("find-partial", {}, quiet)));
  assert.match(treePartial, /running/);
  assert.ok(!treePartial.includes("✓") && treePartial.includes("nested/"));
  const treeError = render(find.renderResult(result("path not found"), { ...options, expanded: true }, styT, context("find-error", {}, { ...quiet, isError: true })));
  assert.ok(treeError.includes("<error><b>✗ path not found</b></error>") && !treeError.includes("└──"));

  const ls = resolver("ls", () => undefined);
  const lsCtx = context("ls-list", { path: "." }, quiet);
  // Real session results omit details normally; limited results only carry
  // entryLimitReached (and optionally truncation), never an entries array.
  const listing = result(".git/\nREADME.md\nsrc/\ntest.mjs");
  delete listing.details;
  assert.match(render(ls.renderResult(listing, options, styT, lsCtx)), /2 dirs · 2 files/);
  const lsOut = render(ls.renderResult(listing, { ...options, expanded: true }, styT, lsCtx));
  assert.ok(lsOut.includes("<success><b>✓ 2 dirs</b></success><dim> · 2 files</dim>"));
  assert.ok(lsOut.includes("<borderMuted>├── </borderMuted><accent><b>.git/</b></accent>"));
  assert.ok(lsOut.includes("<borderMuted>├── </borderMuted><toolOutput>README.md</toolOutput>"));
  assert.ok(lsOut.includes("<borderMuted>└── </borderMuted><toolOutput>test.mjs</toolOutput>"));
  assert.ok(!lsOut.includes(" → "), "native stat follows links; never invent link metadata");
  const lsLimited = render(ls.renderResult(result("one/\ntwo.txt\n\n[2 entries limit reached. Use limit=4 for more]", { entryLimitReached: 2 }), { ...options, expanded: true }, styT, context("ls-limit", {}, quiet)));
  assert.ok(lsLimited.includes("✓ 1 dir") && lsLimited.includes(" · 1 file · truncated"));
  assert.ok(!lsLimited.includes("entries limit"), "tool notices are not listing entries");
  const lsBytes = render(ls.renderResult(result("one/\ntwo.txt\n\n[50.0KB limit reached]", { truncation: { truncated: true, content: "one/\ntwo.txt", lastLinePartial: false, totalLines: 3, totalBytes: 60000, outputLines: 2, outputBytes: 12, maxBytes: 51200 } }), { ...options, expanded: true }, styT, context("ls-bytes", {}, quiet)));
  assert.ok(lsBytes.includes(" · 1 file · truncated"));
  assert.ok(!lsBytes.includes("50.0KB") && !lsBytes.includes("60000"), "output byte counts are not file sizes");
  const lsPlain = render(ls.renderResult(result("one.txt\ntwo.txt"), { ...options, expanded: true }, styT, context("ls-plain", {}, quiet)));
  assert.ok(lsPlain.includes("✓ 2 results") && lsPlain.includes("<toolOutput>one.txt</toolOutput>"));
  assert.ok(!lsPlain.includes("dirs") && !lsPlain.includes("<accent>"));
  const lsEmpty = render(ls.renderResult(result("(empty directory)"), { ...options, expanded: true }, styT, context("ls-empty", {}, quiet)));
  assert.ok(lsEmpty.includes("✓ 0 dirs") && lsEmpty.includes(" · 0 files") && !lsEmpty.includes("└──"));
  const lsError = render(ls.renderResult(result("Path not found: /missing", {}), { ...options, expanded: true }, styT, context("ls-error", {}, { ...quiet, isError: true })));
  assert.ok(lsError.includes("<error><b>✗ Path not found: /missing</b></error>") && !lsError.includes("└──"));
  const lsPartial = render(ls.renderResult(listing, { expanded: true, isPartial: true }, styT, context("ls-partial", {}, quiet)));
  assert.match(lsPartial, /running/);
  assert.ok(!lsPartial.includes("✓") && lsPartial.includes("src/"));
  const lsEscapes = render(ls.renderResult(result("\u001b[31msrc/\u001b[0m\nfile\tname"), { ...options, expanded: true }, styT, context("ls-safe", {}, quiet)));
  assert.ok(!lsEscapes.includes("\u001b") && lsEscapes.includes("file  name") && lsEscapes.includes("✓ 1 dir"));
  const lsUpdated = render(ls.renderResult(result("new/"), { ...options, expanded: true }, theme, lsCtx));
  assert.match(lsUpdated, /✓ 1 dir · 0 files/);
  assert.ok(!lsUpdated.includes("README.md") && !lsUpdated.includes("<accent>"));
  for (const [tool, output, args] of [[grep, hits, grepArgs], [find, paths, {}], [ls, listing, {}]]) {
    const narrow = tool.renderResult(output, { ...options, expanded: true }, theme, context(`narrow-${JSON.stringify(args)}-${output.content[0].text}`, args, quiet));
    assert.ok(narrow.render(16).every((line) => [...line].length <= 16));
  }

  const tuicr = resolver("tuicr", () => { throw new Error("tuicr must not delegate"); });
  const tuicrArgs = { repo: "/work/my-repo/" };
  const tuicrCtx = context("tuicr-launch", tuicrArgs, quiet);
  const tuicrCall = tuicr.renderCall(tuicrArgs, styT, tuicrCtx);
  const tuicrCallText = render(tuicrCall);
  assert.ok(tuicrCallText.includes("◇") && tuicrCallText.includes("tuicr"));
  assert.ok(tuicrCallText.includes("<borderMuted>├─</borderMuted> <dim>▣ </dim> <text>my-repo</text><dim> · working-tree</dim>"));
  const tuicrResult = result("launched", { slug: "calm-fox", attached: false, paneId: 42 });
  const watching = render(tuicr.renderResult(tuicrResult, options, styT, tuicrCtx));
  assert.ok(watching.includes("<success>✓ watching · session calm-fox · pane 42</success>"));
  assert.ok(!render(tuicrCall).includes("▣"), "the result takes ownership of the session leaf");
  const tuicrShown = render(tuicr.renderResult(tuicrResult, { ...options, expanded: true }, styT, tuicrCtx), 500);
  assert.ok(tuicrShown.includes("<dim>scope: working-tree</dim>"));
  assert.ok(tuicrShown.includes("<dim>slug: calm-fox</dim>"));
  assert.ok(tuicrShown.includes("<dim>comments arrive as steer messages; the final batch lands when the TUI exits</dim>"));
  for (const [args, expected] of [
    [{ scope: "revset", revset: "main..HEAD" }, "tmp · revset main..HEAD"],
    [{ sessionSlug: "existing" }, "tmp · attached · session existing"],
    [{}, "tmp · working-tree"],
  ]) {
    const call = render(tuicr.renderCall(args, theme, context(`tuicr-${expected}`, args, quiet)));
    assert.ok(call.includes(`├─ ▣  ${expected}`));
  }
  for (const [text, expected] of [
    ["Attached to active tuicr review session vivid-bird (/work/project). New comments will be steered", "project · attached · session vivid-bird"],
    ["tuicr launched in a background pane for /work/project — this call did not block. Session vivid-bird is active in the new pane.", "project · working-tree"],
  ]) {
    const out = render(tuicr.renderResult(result(text), options, theme, context(`tuicr-${text}`, {}, quiet)));
    assert.ok(out.includes(`▣  ${expected}`) && out.includes("✓ watching · session vivid-bird"));
    assert.ok(!out.includes(" · pane "), "a new pane is not a pane ID");
  }
  const pendingTuicr = render(tuicr.renderResult(result("The session slug is still being resolved", { slug: null, attached: false }), options, theme, context("tuicr-pending", {}, quiet)));
  assert.ok(pendingTuicr.includes("✓ watching") && !pendingTuicr.includes(" · session"));
  const tuicrError = render(tuicr.renderResult(result("missing session\nmore detail", { error: "missing session\nmore detail" }), options, styT, context("tuicr-error", {}, quiet)));
  assert.ok(tuicrError.includes("<error>✗ missing session</error>") && !tuicrError.includes("watching"));
  const tuicrPartial = render(tuicr.renderResult(result(""), { ...options, isPartial: true }, theme, context("tuicr-stream", {}, quiet)));
  assert.ok(tuicrPartial.includes("running") && !tuicrPartial.includes("watching"));

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
  const pipelineOutput = render(axi.renderResult(pipeline, options, theme, context("axi")));
  assert.match(pipelineOutput, /× no-mistakes · tests failed/);
  const pipelineFallback = render(axi.renderResult(pipeline, { ...options, expanded: true }, theme, context("axi")));
  assert.ok(pipelineFallback.includes("└─ ✗ tests failed") && pipelineFallback.includes("    failed"));
  assert.ok(!pipelineFallback.includes("│"), "unstructured pipeline output uses plain indentation");
  const cleanToon = `run:
  id: "01MEXAMPLE"
  branch: fix/topic
  status: running
  head: abcdef12
  pr: "https://github.com/owner/repo/pull/185"
  findings: none
  steps[9]{step,status,findings,duration_ms}:
    intent,completed,0,1
    rebase,completed,0,1419
    review,completed,0,12
    test,completed,0,5
    document,completed,0,0
    lint,completed,0,0
    push,completed,0,0
    pr,completed,0,0
    ci,running,0,0
branch_sync:
  state: pipeline_owned
  note: Pipeline owns this branch.
  next_action:
    command: no-mistakes axi status`;
  const gateToon = `run:
  branch: fix/topic
  status: running
  findings: 1 awaiting
  steps[3]{step,status,findings,duration_ms}:
    intent,completed,0,1
    rebase,awaiting_approval,1,1419
    ci,pending,0,0
gate:
  step: rebase
  status: awaiting_approval
  summary: branch bundles 3 unpushed main commit
  findings[1]{id,severity,file,action,description}:
    R1,error,src/view.ts,ask-user,"Rendered lines exceed the viewport, including the overflow marker."
branch_sync:
  state: pipeline_owned
  next_action:
    command: no-mistakes axi status`;
  const toonResult = (output, extra = {}) => result("[no-mistakes axi — visible (tui), exit 0]\n" + output, {
    output, subcommand: "run", progress: { kind: "pipeline", status: "completed" }, ...extra,
  });
  const toonCtx = context("toon", {}, quiet);
  const showToon = (output, t = theme, extra = {}) => render(axi.renderResult(toonResult(output, extra), { ...options, expanded: true }, t, toonCtx), 1000);
  const cleanFrame = showToon(cleanToon, styT);
  assert.ok(cleanFrame.includes("<borderMuted>├─</borderMuted> <dim>▣ </dim> <text>fix/topic</text><dim> · pr #185</dim>"));
  assert.ok(cleanFrame.includes("<mdLink>● gate running · 0 findings</mdLink>"));
  assert.ok(cleanFrame.includes("<dim>intent </dim><success>✓</success>"));
  assert.ok(cleanFrame.includes("<dim>rebase </dim><success>✓</success><dim> 1.4s</dim>"));
  assert.ok(cleanFrame.includes("<dim>ci </dim><mdLink>●</mdLink>"));
  assert.ok(cleanFrame.includes("<dim>branch_sync: pipeline_owned · Pipeline owns this branch.</dim>"));
  assert.ok(cleanFrame.includes("<dim>next: no-mistakes axi status</dim>"));
  assert.ok(!cleanFrame.includes("run:") && !cleanFrame.includes("01MEXAMPLE"));
  const gateFrame = showToon(gateToon, styT);
  assert.ok(gateFrame.includes("<mdLink>● gate awaiting approval · 1 finding</mdLink><dim> · rebase</dim>"));
  assert.ok(gateFrame.includes("<dim>✎ </dim> <dim>r1 · rebase — Rendered lines exceed the viewport, including the overflow marker.</dim>"));
  assert.ok(gateFrame.includes("<borderMuted>│</borderMuted>  <dim>branch bundles 3 unpushed main commit</dim>"));
  const gatePlain = showToon(gateToon);
  assert.ok(gatePlain.includes("intent ✓ · rebase ● 1.4s · ci pending"));
  assert.ok(!gatePlain.includes("outcome") && !gatePlain.includes("pr #"));
  for (const outcome of ["passed", "merged"]) {
    const passed = showToon(cleanToon.replace("status: running", "status: completed") + `\noutcome: ${outcome}`, styT);
    assert.ok(passed.includes(`<success>✓ gate passed · 0 findings · outcome ${outcome}</success>`));
  }
  for (const output of [
    cleanToon.replace("status: running", "status: failed") + "\noutcome: failed",
    gateToon.replaceAll("awaiting_approval", "blocked"),
  ]) assert.ok(showToon(output, styT).includes("<error>✗ gate blocked ·"));
  assert.ok(showToon(cleanToon, styT, { exitCode: 1 }).includes("<error>✗ gate blocked"), "a nonzero exit blocks even without isError");
  const minimalToon = showToon("run:\n  status: completed");
  assert.ok(minimalToon.includes("✓ gate passed") && !minimalToon.includes("findings") && !minimalToon.includes("▣"));
  const unknownToon = showToon("run:\n  branch: topic\n  status: futuristic\nunknown:\n  command: do not render");
  assert.ok(unknownToon.includes("▣  topic") && !unknownToon.includes("gate passed") && !unknownToon.includes("do not render"));
  for (const subcommand of ["run", "respond", "status", "sync"]) {
    const chip = render(axi.renderResult(toonResult(gateToon, { subcommand }), options, styT, toonCtx), 1000);
    assert.ok(chip.includes(`<text><b>no-mistakes</b></text><dim> · ${subcommand}</dim><mdLink> · findings 1</mdLink>`));
    assert.ok(!chip.includes("1.4s") && !chip.includes("✎"));
  }
  const compoundToon = gateToon.replace("findings: 1 awaiting", 'findings: "1 awaiting, 1 auto-fix"');
  const compoundFrame = showToon(compoundToon);
  assert.ok(compoundFrame.includes("findings: 1 awaiting, 1 auto-fix") && !compoundFrame.includes(" · 1 finding"));
  const compoundChip = render(axi.renderResult(toonResult(compoundToon), options, theme, toonCtx));
  assert.ok(!compoundChip.includes("findings 1") && !compoundChip.includes("findings 2"), "compound categories do not imply a run-wide total");
  const cleanChip = render(axi.renderResult(toonResult(cleanToon), options, styT, toonCtx));
  assert.ok(!cleanChip.includes("findings 0"), "zero findings do not add a badge");
  const bareChip = render(axi.renderResult(result("ok"), options, theme, context("bare-axi", {}, quiet)));
  assert.ok(bareChip.includes("▸ no-mistakes ◆ 0 tools"), "absent details keep the old chip");
  const invalidTable = showToon(gateToon.replace('R1,error,src/view.ts,ask-user,"Rendered lines exceed the viewport, including the overflow marker."', 'R1,error,unclosed,"quote'));
  assert.ok(!invalidTable.includes("✎"), "incomplete CSV rows are omitted");
  const malformedCell = showToon(gateToon.replace('"Rendered lines exceed the viewport, including the overflow marker."', '"bad"junk'));
  assert.ok(!malformedCell.includes("✎"), "invalid quoted scalars reject the entire finding row");
  for (const header of ["unknown-section:", "help[6]:"]) {
    const isolated = showToon(`run:\n  status: running\n  ${header}\n    status: completed`);
    assert.ok(isolated.includes("● gate running") && !isolated.includes("✓ gate passed"), "unsupported subtrees cannot overwrite parent fields");
  }
  const escapedFinding = showToon(gateToon.replace("Rendered lines exceed the viewport, including the overflow marker.", 'A \\"quoted\\" label, and `code`.'));
  assert.ok(escapedFinding.includes('r1 · rebase — A "quoted" label, and `code`.'));
  const narrowGate = render(axi.renderResult(toonResult(gateToon), { ...options, expanded: true }, theme, toonCtx), 45);
  assert.ok(narrowGate.includes("│     "), "finding continuations use a bare spine");
  assert.ok(narrowGate.split("\n").every((line) => [...line].length <= 45));
  for (const count of [60, 62, 63, 100]) {
    const raw = Array.from({ length: count }, (_, i) => `raw-line-${i + 1}`).join("\n");
    const fallback = showToon(raw);
    assert.ok(!fallback.includes("│") && fallback.includes("    raw-line-1\n") && fallback.includes(`    raw-line-${count}`));
    if (count <= 62) assert.ok(!fallback.includes("lines hidden"));
    else {
      assert.ok(fallback.includes(`… ${count - 60} lines hidden …`));
      assert.ok(fallback.includes("    raw-line-30\n") && !fallback.includes("    raw-line-31\n"));
      assert.ok(fallback.includes(`    raw-line-${count - 29}\n`));
    }
  }
  const safeToon = showToon(cleanToon.replace("fix/topic", "fix/\u001b[31mtopic\u001b[0m"));
  assert.ok(safeToon.includes("fix/topic") && !safeToon.includes("\u001b"));
  // Live no-mistakes resolution: activity updates carry the current review
  // gate's unresolved finding ids. Findings a later fix round resolved drop
  // from chips of the same run; other runs' chips stay unfiltered history.
  const liveToon = `run:
  id: "01M4LIVERUN0000000000000"
  branch: fix/live
  status: running
  findings: 2 auto-fix
  steps[3]{step,status,findings,duration_ms}:
    intent,completed,0,1
    review,awaiting_approval,2,1419
    ci,pending,0,0
gate:
  step: review
  status: awaiting_approval
  findings[2]{id,severity,file,action,description}:
    keep-me,error,src/a.ts,auto-fix,"Still open at the gate."
    fixed-me,error,src/b.ts,auto-fix,"Resolved by a later fix round."
branch_sync:
  state: pipeline_owned`;
  const liveCtx = context("live-axi", {}, quiet);
  const liveShow = () => render(axi.renderResult(toonResult(liveToon), { ...options, expanded: true }, theme, liveCtx), 1000);
  const liveChip = () => render(axi.renderResult(toonResult(liveToon), options, theme, liveCtx));
  const beforeLive = liveShow();
  assert.ok(beforeLive.includes("keep-me") && beforeLive.includes("fixed-me"), "before tracking, all findings render");
  const nmUpdate = bus.get("no-mistakes:activity-update");
  assert.ok(typeof nmUpdate === "function", "the renderer subscribes to no-mistakes activity updates");
  nmUpdate({ snapshot: { id: "01M4LIVERUN0000000000000", gate: "review", reviewFindings: [{ id: "keep-me", severity: "error" }] } });
  const afterLive = liveShow();
  assert.ok(afterLive.includes("keep-me"), "unresolved findings stay visible");
  assert.ok(!afterLive.includes("fixed-me"), "resolved findings drop from the chip");
  assert.ok(afterLive.includes("1 resolved finding hidden"), "the hidden count is disclosed");
  const afterChip = liveChip();
  assert.ok(afterChip.includes("findings 1") && !afterChip.includes("findings 2"), "the badge counts only visible findings");
  nmUpdate({ snapshot: { id: "01M4OTHERRUN00000000000", gate: "review", reviewFindings: [] } });
  const otherRun = liveShow();
  assert.ok(otherRun.includes("fixed-me"), "chips of other runs render unfiltered");
  nmUpdate({ snapshot: { id: "01M4LIVERUN0000000000000", gate: "review", reviewFindings: [{ id: "keep-me", severity: "error" }] } });
  nmUpdate({ snapshot: undefined });
  const endedRun = liveShow();
  assert.ok(!endedRun.includes("fixed-me"), "the last known resolution state survives the run ending");
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
  shortcut.handler(shortcutCtx);
  assert.deepEqual(notifications.at(-1), ["Commands and no-mistakes rows hidden", "info"], "the toggle flips back to hidden");
  const hiddenPy = render(python.renderCall(
    { code: "# parse the session log for nested bash calls\nimport json" },
    theme,
    context("hidden-py", {}, { executionStarted: false }),
  ));
  assert.match(hiddenPy, /^ ◇ python — parse the session log for nested bash calls$/m, "hidden mode covers python titles");
  assert.ok(!hiddenPy.includes("import json"), "hidden mode: python code never renders");
  const colorTheme = { ...theme, fg: (color, text) => `<${color}>${text}</${color}>` };
  const sumCtx = context("hidden-sum", {});
  const sumRow = bash.renderResult(result("a\nb", { exitCode: 0 }), options, colorTheme, sumCtx);
  const sumOut = render(sumRow);
  assert.match(sumOut, /<success>exit 0<\/success><dim> · 2 lines<\/dim>/, "minimized summary: exit status keeps its color, the line count dims");
  assert.ok(!sumOut.includes("<success>exit 0 · 2 lines</success>"), "the count never rides the status color");
  // Edit rows render repo-relative paths: an absolute path under the
  // session cwd's git root strips to that root; other paths stay as-is.
  const gitRoot = mkdtempSync(join(tempRoot, "git-"));
  execSync("git init --quiet", { cwd: gitRoot });
  const editRow = resolver("edit", () => undefined);
  const inRepo = render(editRow.renderCall(
    { path: `${gitRoot}/src/main.rs`, edits: [{ oldText: "a", newText: "b" }] },
    theme,
    context("edit-in-repo", {}, { cwd: gitRoot }),
  ));
  assert.match(inRepo, /◇ edit src\/main\.rs · 1 edit/, "an absolute path under the repo root renders relative to it");
  assert.ok(!inRepo.includes(gitRoot), "the repo root never appears in the row");
  const outside = render(editRow.renderCall(
    { path: "/etc/hosts", edits: [{ oldText: "a", newText: "b" }] },
    theme,
    context("edit-outside", {}, { cwd: "/tmp" }),
  ));
  assert.match(outside, /◇ edit \/etc\/hosts · 1 edit/, "a path outside the repo stays absolute");
  const relative = render(editRow.renderCall(
    { path: "src/main.rs", edits: [{ oldText: "a", newText: "b" }] },
    theme,
    context("edit-relative", {}, { cwd: gitRoot }),
  ));
  assert.match(relative, /◇ edit src\/main\.rs · 1 edit/, "an already-relative path stays unchanged");

  // Harness-requested titles: the comment title from the original tool
  // message stays primary; a live title-less row backfills exactly one
  // model request at render time, and tool_result persists the answer
  // into the stored details as intentTitle.
  const titleRequests = [];
  const sessionWith = (id, entries = [], extra = {}) => handlers.get("session_start")({}, {
    sessionManager: { getSessionId: () => id, getEntries: () => entries },
    ...extra,
  });
  const resultHandler = handlers.get("tool_result");
  assert.ok(resultHandler, "the extension registers a tool_result handler");
  sessionWith("model-session", [], {
    model: { id: "stub-model" }, signal: undefined,
    modelRegistry: { complete: async (model, request) => {
      titleRequests.push({ model: model.id, text: request.messages[0].content[0].text });
      return { content: [{ type: "text", text: "  count files by type across the tree  " }] };
    } },
  });
  const genCtx = context("gen-1", { command: "find . -type f | sed 's/.*\.//' | sort | uniq -c" }, { executionStarted: false });
  render(bash.renderCall(genCtx.args, theme, genCtx));
  assert.equal(titleRequests.length, 1, "a live title-less row backfills exactly one title request");
  assert.match(titleRequests[0].text, /find \. -type f/, "the request carries the command source");
  await new Promise((resolve) => setImmediate(resolve));
  const genRow = render(bash.renderCall(genCtx.args, theme, genCtx));
  assert.match(genRow, /^ ◇ bash — count files by type across the tree$/m, "the requested title renders as the row title");
  render(bash.renderCall(genCtx.args, theme, genCtx));
  assert.equal(titleRequests.length, 1, "re-renders never re-request");
  const genCommentCtx = context("gen-comment", { command: "# list files changed on this branch against main\ngit diff --name-only main...HEAD" }, { executionStarted: false });
  render(bash.renderCall(genCommentCtx.args, theme, genCommentCtx));
  assert.equal(titleRequests.length, 1, "a call with its own comment title never requests");
  const streamingCtx = context("gen-stream", { command: "du -sh ." }, { executionStarted: false, argsComplete: false });
  render(bash.renderCall(streamingCtx.args, theme, streamingCtx));
  assert.equal(titleRequests.length, 1, "a row whose args are still streaming waits");
  const injected = resultHandler({ toolName: "bash", toolCallId: "gen-1", details: { exitCode: 0 } });
  assert.deepEqual(injected, { details: { exitCode: 0, intentTitle: "count files by type across the tree" } }, "tool_result persists the requested title into details");
  assert.equal(resultHandler({ toolName: "bash", toolCallId: "other", details: {} }), undefined, "calls without a requested title inject nothing");
  sessionWith("restored-session", [{ message: { role: "assistant", content: [{ type: "toolCall", id: "gen-old" }] } }]);
  const oldCtx = context("gen-old", { command: "wc -l *.md" }, { executionStarted: false });
  render(bash.renderCall(oldCtx.args, theme, oldCtx));
  assert.equal(titleRequests.length, 1, "restored rows keep their dim preview and never backfill");
  assert.match(render(bash.renderCall(oldCtx.args, theme, oldCtx)), /\$ wc -l \*\.md/, "the restored title-less row keeps its one-line preview");
  const genRestoredCtx = context("gen-restored", {});
  render(bash.renderCall({ command: "du -sh ." }, theme, genRestoredCtx));
  render(bash.renderResult(result("42M .", { exitCode: 0, intentTitle: "measure the working tree size" }), options, theme, genRestoredCtx));
  const restoredRow = render(bash.renderCall({ command: "du -sh ." }, theme, genRestoredCtx));
  assert.match(restoredRow, /— measure the working tree size/, "a stored intentTitle restores the title on reload without a request");
  assert.equal(titleRequests.length, 1, "restoring never fires a new request");
  shutdown();
  assert.equal(bus.size, 0, "shutdown releases bus subscription");
  console.log("tool-call-renderer-public tests passed");
} finally {
  shutdown?.();
  rmSync(tempRoot, { recursive: true, force: true });
}
