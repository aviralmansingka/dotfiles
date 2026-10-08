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
const root = mkdtempSync(join(tmpdir(), "web-search-test-"));
try {
  const tui = join(root, "tui.cjs");
  const typebox = join(root, "typebox.cjs");
  writeFileSync(tui, `
    exports.Text = class { constructor(text) { this.text = text; } render() { return this.text.split("\\n"); } invalidate() {} };
    exports.truncateToWidth = (text, width, ellipsis = "…") => text.length <= width ? text : text.slice(0, Math.max(0, width - ellipsis.length)) + ellipsis.slice(0, width);
    exports.wrapTextWithAnsi = (text, width) => {
      const lines = []; let line = "";
      for (const word of text.split(/\\s+/)) {
        if (line && line.length + word.length + 1 > width) { lines.push(line); line = ""; }
        line += (line ? " " : "") + word;
        while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width); }
      }
      lines.push(line); return lines;
    };
  `);
  writeFileSync(typebox, "exports.Type = new Proxy({}, { get: () => (value) => value });\n");
  const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-tui": tui, typebox } });
  let tool;
  jiti("./index.ts").default({ registerTool(value) { tool = value; } });
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const styled = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => `<b>${text}</b>` };
  const result = (text, details) => ({ content: [{ type: "text", text }], details });
  const render = (value, { width = 160, skin = theme, expanded = true, isPartial = false, isError = false } = {}) => {
    const component = tool.renderResult(value, { expanded, isPartial }, skin, { isError });
    component.invalidate();
    return component.render(width).join("\n");
  };
  const old = result("1. First title\n   https://one.test\n   Short snippet.\n\n2. Second title\n   https://two.test\n   Another snippet.", { resultCount: 2 });
  const out = render(old);
  assert.match(out, /^ └─ ✓ 2 results · top: First title/);
  assert.match(out, /^  1  First title\n     https:\/\/one.test\n     Short snippet\./m);
  assert.match(out, /^  2  Second title/m);
  assert.equal(render(old, { expanded: false }).split("\n").length, 1);
  const tags = render(old, { skin: styled, width: 1000 });
  assert.ok(tags.includes("<success>✓"));
  assert.ok(tags.includes("<text><b>First title"));
  assert.ok(tags.includes("<dim>https://one.test"));
  assert.ok(tags.includes("<dim>Short snippet."));
  assert.match(render(result("No results found.")), /^ └─ ✗ no results$/);
  assert.ok(render(result("No results found."), { skin: styled }).includes("<error>✗ no results"));
  assert.match(render(result("API failed\nsecret detail"), { isError: true }), /^ └─ ✗ API failed$/);
  assert.match(render(result(""), { isPartial: true }), /Searching…/);
  const structured = [{ title: "Structured", url: "https://data.test", snippet: "word ".repeat(80) }];
  const wrapped = render(result("ignored", { results: structured }), { width: 35 });
  const rows = wrapped.split("\n");
  assert.equal(rows.length, 5, "banner, title, URL, at most two snippet rows");
  assert.match(rows[4], /…$/);
  assert.ok(rows.every((line) => line.length <= 35));
  assert.match(rows[3], /^     word word/);
  assert.ok(!rows[3].endsWith("…"), "only the last snippet row truncates");
  const many = Array.from({ length: 10 }, (_, i) => ({ title: `Title ${i + 1}`, url: `https://x.test/${i}`, snippet: "brief" }));
  const folded = render(result("", { results: many }));
  assert.match(folded, /✓ 10 results/);
  assert.match(folded, /^  8  Title 8$/m);
  assert.ok(!folded.includes("Title 9"));
  assert.match(folded, /… 2 more results …/);
  assert.doesNotMatch(render(result("", { results: many.slice(0, 8) })), /more results/);
  assert.equal(render(result("1. Empty snippet\n   https://empty.test\n   ")).split("\n")[1], "  1  Empty snippet");
  assert.equal(render(result("1. Ignored\n   https://x.test\n   snippet", { results: [] })), " └─ ✗ no results", "structured details take precedence");
  const oldKey = process.env.TAVILY_API_KEY;
  const oldFetch = globalThis.fetch;
  try {
    process.env.TAVILY_API_KEY = "test-key";
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [{ title: "New", url: "https://new.test", content: "New snippet" }] }) });
    const executed = await tool.execute("id", { query: "test" });
    assert.deepEqual(executed.details.results, [{ title: "New", url: "https://new.test", snippet: "New snippet" }]);
    assert.match(render(executed), /✓ 1 results · top: New/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
  }
  console.log("web-search tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
