import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
  process.env.JITI_PATH,
  join(homedir(), ".pi/agent/install/releases/1.1.0/node_modules/jiti/lib/jiti.cjs"),
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
  "/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
const { createJiti } = require(jitiPath);
const root = mkdtempSync(join(tmpdir(), "web-fetch-test-"));
try {
  const agent = join(root, "agent.cjs");
  const tui = join(root, "tui.cjs");
  const typebox = join(root, "typebox.cjs");
  const extraction = join(root, "extraction.cjs");
  const turndown = join(root, "turndown.cjs");
  writeFileSync(agent, `
    let initialized = false;
    exports.names = [];
    exports.initTheme = (name) => { initialized = true; exports.names.push(name); };
    exports.highlightCode = (code, lang) => code.split("\\n").map((line) => initialized && lang ? '<hl:' + lang + '>' + line : line);
  `);
  writeFileSync(tui, `
    exports.Text = class { constructor(text) { this.text = text; } render() { return this.text.split("\\n"); } invalidate() {} };
    exports.truncateToWidth = (text, width, ellipsis = "…") => text.length <= width ? text : text.slice(0, Math.max(0, width - ellipsis.length)) + ellipsis.slice(0, width);
    exports.wrapTextWithAnsi = (text, width) => {
      if (!text) return [""];
      const lines = []; for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width)); return lines;
    };
  `);
  writeFileSync(typebox, "exports.Type = new Proxy({}, { get: () => (value) => value });\n");
  writeFileSync(extraction, "exports.Readability = class {}; exports.parseHTML = () => ({});\n");
  writeFileSync(turndown, "module.exports = class {};\n");
  const jiti = createJiti(import.meta.url, { alias: {
    "@earendil-works/pi-coding-agent": agent,
    "@earendil-works/pi-tui": tui,
    typebox,
    "@mozilla/readability": extraction,
    linkedom: extraction,
    turndown,
  } });
  let tool;
  jiti("./index.ts").default({ registerTool(value) { tool = value; } });
  const theme = { name: "gruvbox-material", fg: (_color, text) => text, bold: (text) => text };
  const styled = { ...theme, fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => `<b>${text}</b>` };
  const result = (text, details = { url: "https://example.test/page", title: "Example", chars: text.length }) => ({ content: [{ type: "text", text }], details });
  const render = (value, { width = 240, skin = theme, expanded = true, isPartial = false, isError = false, args = {} } = {}) => {
    const component = tool.renderResult(value, { expanded, isPartial }, skin, { isError, args });
    component.invalidate();
    return component.render(width).join("\n");
  };
  const legacy = result("# Example\n\nSource: https://example.test/page\n\n---\n\nplain prose", { url: "https://example.test/page", title: "Example", chars: 11 });
  const out = render(legacy);
  assert.match(out, /^ ├─ ⇠  Example · text\/markdown · 11 chars\n └─ ✓ fetched · example.test\n    plain prose$/);
  assert.ok(!out.includes("Source:"), "synthetic execute header is represented by the leaf, not repeated");
  const tags = render(legacy, { skin: styled, width: 1000 });
  assert.ok(tags.includes("<dim>⇠ "));
  assert.ok(tags.includes("<text><b>Example"));
  assert.ok(tags.includes("<dim> · text/markdown · 11 chars"));
  assert.ok(tags.includes("<success>✓"));
  assert.match(render(result("doc", { title: "PDF", url: "https://example.test/a.pdf", chars: 2000, contentType: "application/pdf" })), /PDF · application\/pdf · 2,000 chars/);
  assert.match(render(legacy, { expanded: false }), /fetched · example.test$/);
  const failure = render(result("HTTP 404: Missing\nFurther details", {}), { isError: true, args: { url: "https://example.test/missing" } });
  assert.match(failure, /^ ├─ ⇠  example.test/);
  assert.match(failure, / └─ ✗ HTTP 404: Missing$/);
  assert.ok(!failure.includes("Further details"));
  assert.ok(render(result("Failed"), { isError: true, skin: styled }).includes("<error>✗ Failed"));
  assert.match(render(result(""), { isPartial: true }), /Fetching…/);
  assert.match(render(result("hello", {})), /unknown source/);
  assert.match(render({ content: legacy.content }), /Example · text\/markdown · 11 chars/);
  const api = require(agent);
  assert.deepEqual(api.highlightCode("const n = 1;", "ts"), ["const n = 1;"], "mirror the uninitialized dual-module trap");
  const markdown = result("intro\n## Heading\nText with `code` and **bold**.\n- one\n2. two\n```ts\nconst n = 1;\n```\nafter");
  const md = render(markdown, { skin: styled, width: 1000 });
  assert.ok(md.includes("<accent><b>## Heading"));
  assert.match(md, /intro\n    \n.*## Heading.*\n    \n/);
  assert.ok(md.includes("<success>`code`"));
  assert.ok(md.includes("<b>**bold**"));
  assert.ok(md.includes("<dim>- "));
  assert.ok(md.includes("<dim>2. "));
  assert.ok(md.includes("<dim>```ts"));
  assert.ok(md.includes("<hl:ts>const n = 1;"), "initTheme must run before highlighting");
  assert.deepEqual(api.names, ["gruvbox-material"]);
  render(markdown);
  assert.deepEqual(api.names, ["gruvbox-material"], "initialize only once for the active theme name");
  render(markdown, { skin: { ...theme, name: "light" } });
  assert.deepEqual(api.names, ["gruvbox-material", "light"], "theme changes resync highlighting");
  const unterminated = render(result("~~~python\nprint(1)"));
  assert.match(unterminated, /<hl:python>print\(1\)/);
  const nestedFence = render(result("````md\n```\nstill code\n````\nprose"));
  assert.match(nestedFence, /<hl:md>```/);
  assert.match(nestedFence, /<hl:md>still code/);
  assert.match(nestedFence, /    prose$/);
  assert.match(render(result("```\nno language\n```")), /    no language/);
  const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
  const exact = render(result(body(60)));
  assert.equal(exact.split("\n").length, 62, "60 body lines plus leaf and banner");
  assert.doesNotMatch(exact, /hidden/);
  const boundary = render(result(body(61)));
  assert.match(boundary, /… 1 lines hidden …/);
  assert.ok(!boundary.includes("line 30"));
  assert.match(boundary, /line 29/);
  assert.match(boundary, /line 31/);
  const folded = render(result(body(100)));
  assert.equal(folded.split("\n").length, 63);
  assert.match(folded, /… 40 lines hidden …/);
  assert.match(folded, /    line 0\n/);
  assert.match(folded, /    line 99$/);
  assert.ok(!folded.includes("line 30"));
  assert.ok(!folded.includes("line 69"));
  const narrow = render(result("x".repeat(1300)), { width: 24 });
  assert.match(narrow, /… 5 lines hidden …/, "fold counts rendered visual lines, not source lines");
  assert.ok(narrow.split("\n").every((line) => line.length <= 24));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, headers: new Headers({ "content-type": "text/plain; charset=utf-8" }), text: async () => "plain body" });
    const executed = await tool.execute("id", { url: "https://example.test/readme.txt" });
    assert.equal(executed.details.contentType, "text/plain");
    assert.equal(executed.details.chars, 10);
    assert.match(render(executed), /text\/plain · 10 chars/);
    assert.match(render(executed), /    plain body$/);
  } finally { globalThis.fetch = originalFetch; }
  console.log("web-fetch tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
