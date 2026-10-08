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
  const NEVER_DELEGATE = new Set([...CONNECTED, "read", "write", "bash", "powershell", "grep", "find", "ls", "ask_user_question", "quiz"]);
  for (const name of [...NEVER_DELEGATE, "edit", "ask_question", "mcp__not_connected__search", "unknown"]) {
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
