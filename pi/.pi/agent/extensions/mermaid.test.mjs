import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const installRoot = join(homedir(), ".pi/agent/install");
const versionFile = join(installRoot, "current-version");
const jitiPath = [
	process.env.JITI_PATH,
	existsSync(versionFile) && join(installRoot, "releases", readFileSync(versionFile, "utf8").trim(), "node_modules/jiti/lib/jiti.cjs"),
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));

if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

const { createJiti } = require(jitiPath);

// Peer stubs (house pattern from lesson.test.mjs). mermaid.ts imports Type
// from typebox and Text from pi-tui at runtime; the pi-coding-agent import
// is type-only and erased. grok-mermaid is stubbed so gate-3 behavior is
// configurable per test; the mmdflux child process is real IO and is
// exercised below only when the binary exists (or a fake bin is installed).
const tempRoot = mkdtempSync(join(tmpdir(), "mermaid-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
const stubTypes = join(tempRoot, "types.cjs");
const stubGrok = join(tempRoot, "grok-mermaid.cjs");
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(
	stubTui,
	`
class Text { constructor(text) { this.text = text; } }
exports.Text = Text;
`,
);
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(
	stubGrok,
	`
exports.render = (src) => (globalThis.__grokRender ? globalThis.__grokRender(src) : { width: 40, warnings: [], plain: ["stub art"] });
`,
);

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
		"grok-mermaid": stubGrok,
	},
});

const mermaidModule = jiti("./mermaid.ts");
const {
	sanitizeId,
	escapeLabel,
	validateParams,
	emitMermaid,
	extractMermaidSource,
	runMmdflux,
	diffStructure,
	diffArtContainment,
	paneWidth,
} = mermaidModule;
const extension = mermaidModule.default;

const haveMmdflux = existsSync(join(homedir(), ".local", "bin", "mmdflux")) || !!process.env.PI_MERMAID_MMDFLUX;

// ── registration ─────────────────────────────────────────────────────────────

const registered = [];
extension({ registerTool(def) { registered.push(def); } });
assert.equal(registered.length, 1, "mermaid should register exactly one tool");
const tool = registered[0];
assert.equal(tool.name, "mermaid");
assert.equal(typeof tool.execute, "function");
assert.ok(tool.description.length > 40, "description should be substantive");
assert.ok(
	tool.description.includes("Use this instead of writing mermaid fences inline"),
	"description should say it replaces inline generation",
);
assert.ok(tool.description.includes("guaranteed to render"), "description should promise chat rendering");
assert.ok(tool.promptGuidelines.length >= 3, "should carry usage guidelines");
assert.equal(typeof tool.renderResult, "function", "should render its own result");
assert.ok(tool.parameters, "should declare parameters");

// ── ids and labels ────────────────────────────────────────────────────────────

assert.equal(sanitizeId("Agent Run", 0), "Agent_Run");
assert.equal(sanitizeId("!!!", 4), "n5", "unsanitizable id falls back to an index id");
assert.equal(escapeLabel("two\nlines"), "two<br/>lines");
assert.equal(escapeLabel("a`b\u0007c"), "abc", "backticks and control chars are stripped");

// ── validateParams ────────────────────────────────────────────────────────────

const badType = validateParams({ type: "erDiagram", nodes: [{ id: "a" }] });
assert.equal(badType.ok, false);
assert.ok(
	badType.error.includes("flowchart, sequenceDiagram, stateDiagram-v2, classDiagram"),
	`unknown type names the supported set: ${badType.error}`,
);

const badEndpoint = validateParams({ type: "flowchart", nodes: [{ id: "a" }], edges: [{ from: "a", to: "ghost" }] });
assert.equal(badEndpoint.ok, false);
assert.ok(badEndpoint.error.includes('"ghost" is not a declared node'), `endpoint error names the ghost: ${badEndpoint.error}`);

const badQuote = validateParams({ type: "flowchart", nodes: [{ id: "a", label: 'say "hi"' }] });
assert.equal(badQuote.ok, false);
assert.ok(badQuote.error.includes("double quotes"), `label quote policy is enforced: ${badQuote.error}`);

const badGroup = validateParams({ type: "flowchart", nodes: [{ id: "a" }], groups: [{ id: "g", title: "G", members: ["ghost"] }] });
assert.equal(badGroup.ok, false);
assert.ok(badGroup.error.includes('member "ghost"'), `group member must be declared: ${badGroup.error}`);

const emptySeq = validateParams({ type: "sequenceDiagram", actors: [{ id: "a" }] });
assert.equal(emptySeq.ok, false, "sequence without messages is rejected");

const okFlow = validateParams({
	type: "flowchart",
	nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
	edges: [{ from: "a", to: "b", label: "uses" }],
});
assert.equal(okFlow.ok, true);
assert.equal(okFlow.value.ids.get("a"), "a");
assert.equal(okFlow.value.labels.get("a"), "Alpha");

// ids that sanitize to the same string get unique suffixes
const collision = validateParams({
	type: "flowchart",
	nodes: [{ id: "a b" }, { id: "a_b" }],
	edges: [{ from: "a b", to: "a_b" }],
});
assert.equal(collision.ok, true);
assert.notEqual(collision.value.ids.get("a b"), collision.value.ids.get("a_b"), "collision ids are de-duplicated");

// ── emitMermaid ───────────────────────────────────────────────────────────────

const flowSrc = emitMermaid(okFlow.value);
assert.ok(flowSrc.startsWith("flowchart TD"), `flowchart header: ${flowSrc.split("\n")[0]}`);
assert.ok(flowSrc.includes('a["Alpha"]'), "node label is quoted verbatim");
assert.ok(flowSrc.includes('a -->|"uses"| b'), "edge label is quoted");

const grouped = validateParams({
	type: "flowchart",
	nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }],
	edges: [{ from: "a", to: "b" }],
	groups: [{ id: "zone", title: "Zone 1", members: ["b", "c"] }],
});
const groupSrc = emitMermaid(grouped.value);
assert.ok(groupSrc.includes('subgraph zone["Zone 1"]'), "group emits a titled subgraph");
assert.ok(groupSrc.includes('    b["Beta"]'), "grouped members keep their labels inside the subgraph");
assert.ok(groupSrc.includes('    c["Gamma"]'), "every grouped member is labeled");
assert.ok(/^  a\[/m.test(groupSrc), "ungrouped nodes stay outside");

const seq = validateParams({
	type: "sequenceDiagram",
	actors: [{ id: "you", label: "You" }, { id: "ag", label: "Agent" }],
	messages: [
		{ from: "you", to: "ag", text: "do the thing" },
		{ from: "ag", to: "you", text: "done", dashed: true },
	],
});
const seqSrc = emitMermaid(seq.value);
assert.ok(seqSrc.includes("participant you as You"));
assert.ok(seqSrc.includes("you->>ag: do the thing"));
assert.ok(seqSrc.includes("ag-->>you: done"), "dashed flag selects the reply arrow");

const state = validateParams({
	type: "stateDiagram-v2",
	states: [{ id: "s1", label: "Working" }, { id: "s2" }],
	transitions: [{ from: "[*]", to: "s1" }, { from: "s1", to: "s2", label: "done" }, { from: "s2", to: "[*]" }],
});
const stateSrc = emitMermaid(state.value);
assert.ok(stateSrc.includes('state "Working" as s1'), "labeled state uses the display form");
assert.ok(stateSrc.includes("[*] --> s1"), "start pseudo-state works");
assert.ok(stateSrc.includes("s1 --> s2 : done"), "transition label uses the colon form");

const cls = validateParams({
	type: "classDiagram",
	classes: [{ id: "w", name: "Widget", members: ["+draw()"] }],
	relations: [{ from: "w", to: "w", kind: "extends" }],
});
assert.ok(cls.ok, `class params validate: ${cls.ok === false ? cls.error : ""}`);
const clsSrc = emitMermaid(cls.value);
assert.ok(clsSrc.includes("class Widget {"), "class block emits the class NAME, not the param id");
assert.ok(!clsSrc.includes("class w {"), "param ids never leak into classDiagram output");
assert.ok(clsSrc.includes("+draw()"), "member emitted");
assert.ok(clsSrc.includes("Widget <|-- Widget"), "relations reference class names");

// ── extractMermaidSource ──────────────────────────────────────────────────────

assert.equal(extractMermaidSource("junk\n```mermaid\nflowchart TD\n  A --> B\n```\nmore"), "flowchart TD\n  A --> B");
assert.equal(extractMermaidSource("no fence here"), null);

// ── diffStructure / diffArtContainment ────────────────────────────────────────

const mmds = { nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], edges: [{ source: "a", target: "b", label: "uses" }] };
assert.deepEqual(diffStructure(mmds, okFlow.value), [], "exact structure matches cleanly");

assert.ok(
	diffStructure({ nodes: [{ id: "b", label: "Beta" }], edges: [] }, okFlow.value).some((p) => p.includes('"a" missing')),
	"missing node is reported",
);
assert.ok(
	diffStructure({ nodes: mmds.nodes, edges: [{ source: "a", target: "b" }] }, okFlow.value).some((p) => p.includes("label rendered as")),
	"dropped edge label is reported",
);
assert.ok(
	diffStructure({ nodes: [...mmds.nodes, { id: "zz", label: "Invented" }], edges: mmds.edges }, okFlow.value).some((p) => p.includes('invented node "zz"')),
	"invented node is reported",
);

const seqProblems = diffArtContainment("You            Agent\n do the thing", seq.value);
assert.equal(seqProblems.length, 1, "a message missing from the art is reported");

// regression: direction is truth — a C->B query must not match the B->C edge
const bothDirs = validateParams({
	type: "flowchart",
	nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
	edges: [
		{ from: "a", to: "b", label: "first" },
		{ from: "b", to: "c", label: "second" },
		{ from: "c", to: "b", label: "third" },
		{ from: "b", to: "a", label: "fourth" },
	],
});
assert.ok(bothDirs.ok);
assert.deepEqual(
	diffStructure(
		{ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [
			{ source: "a", target: "b", label: "first" },
			{ source: "b", target: "c", label: "second" },
			{ source: "c", target: "b", label: "third" },
			{ source: "b", target: "a", label: "fourth" },
		] },
		bothDirs.value,
	),
	[],
	"both directions coexist and match exactly",
);
const oneDir = validateParams({ type: "flowchart", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "b", to: "a", label: "up" }] });
assert.ok(oneDir.ok);
assert.ok(
	diffStructure({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b", label: "down" }] }, oneDir.value).some((p) => p.includes("missing")),
	"a reversed edge is reported as missing, never as a label match",
);

// regression: mmds turns <br/> into a real newline; the diff must accept that
const brParams = validateParams({ type: "flowchart", nodes: [{ id: "b", label: "Side focus buffer\nonly the current node" }] });
assert.ok(brParams.ok);
assert.deepEqual(
	diffStructure({ nodes: [{ id: "b", label: "Side focus buffer\nonly the current node" }], edges: [] }, brParams.value),
	[],
	"multi-line labels match their mmds newline form",
);

// ── paneWidth ─────────────────────────────────────────────────────────────────

const savedWidth = process.env.PI_MERMAID_WIDTH;
process.env.PI_MERMAID_WIDTH = "77";
assert.equal(paneWidth(), 77, "PI_MERMAID_WIDTH overrides the pane width");
if (savedWidth === undefined) delete process.env.PI_MERMAID_WIDTH;
else process.env.PI_MERMAID_WIDTH = savedWidth;
assert.ok(paneWidth() >= 40, "fallback pane width stays sane");

// ── execute with fake gates ───────────────────────────────────────────────────

// A fake mmdflux that echoes a fixed MMDS JSON matching okFlow's params.
const fakeMmds = JSON.stringify({ nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], edges: [{ source: "a", target: "b", label: "uses" }] });
const goodFlux = join(tempRoot, "good-mmdflux");
writeFileSync(goodFlux, `#!/bin/sh\nif [ "$2" = "mmds" ]; then echo '${fakeMmds}'; else echo 'fake art'; fi\n`);
chmodSync(goodFlux, 0o755);
const savedFlux = process.env.PI_MERMAID_MMDFLUX;
process.env.PI_MERMAID_MMDFLUX = goodFlux;

const run = (params) => tool.execute("id", params, undefined, () => {}, {});

try {
	// structured success: parse + structure + pane fit
	const ok = await run({
		type: "flowchart",
		nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
		edges: [{ from: "a", to: "b", label: "uses" }],
	});
	assert.equal(ok.isError, undefined, `structured call should pass: ${JSON.stringify(ok).slice(0, 200)}`);
	assert.ok(ok.content[0].text.includes("```mermaid\nflowchart TD"), "result returns the validated fence");
	assert.ok(ok.content[0].text.includes("verbatim"), "result tells the model to echo verbatim");
	assert.equal(ok.details.width, 40);
	assert.equal(ok.details.path, "structured");
	assert.equal(typeof ok.details.ms, "number");

	// width overrun on LR re-emits TD locally and passes
	globalThis.__grokRender = (src) =>
		src.includes("flowchart LR") ? { width: 500, warnings: [], plain: ["wide"] } : { width: 40, warnings: [], plain: ["fits"] };
	const lrOk = await run({
		type: "flowchart",
	direction: "LR",
		nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
		edges: [{ from: "a", to: "b", label: "uses" }],
	});
	assert.equal(lrOk.isError, undefined, `LR overrun should recover via TD: ${JSON.stringify(lrOk).slice(0, 200)}`);
	assert.ok(lrOk.content[0].text.includes("```mermaid\nflowchart TD"), "the TD variant is what ships");

	// width overrun with no variant left reports both numbers
	globalThis.__grokRender = () => ({ width: 500, warnings: [], plain: ["wide"] });
	const wide = await run({
		type: "flowchart",
		nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
		edges: [{ from: "a", to: "b", label: "uses" }],
	});
	assert.equal(wide.isError, true);
	assert.ok(wide.details.error.includes("art is 500 cols"), `width error carries the art width: ${wide.details.error}`);

	// renderer warnings block the diagram (the chat refuses to draw warnings)
	globalThis.__grokRender = () => ({ width: 40, warnings: ["node \"a\": label is missing its closing `]`"], plain: ["art"] });
	const warned = await run({
		type: "flowchart",
		nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
		edges: [{ from: "a", to: "b", label: "uses" }],
	});
	assert.equal(warned.isError, true);
	assert.ok(warned.details.error.includes("would not draw"), `warning error explains the chat rule: ${warned.details.error}`);

	// renderer crash: the chat would show raw source
	globalThis.__grokRender = () => { throw new Error("boom"); };
	const crashed = await run({
		type: "flowchart",
		nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
		edges: [{ from: "a", to: "b", label: "uses" }],
	});
	assert.equal(crashed.isError, true);
	assert.ok(crashed.details.error.includes("raw text"), `crash error names the raw-source fallback: ${crashed.details.error}`);
} finally {
	delete globalThis.__grokRender;
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// a strict-parse failure from the emitter is an internal bug, never retried
const badFlux = join(tempRoot, "bad-mmdflux");
writeFileSync(badFlux, "#!/bin/sh\necho 'Error: expected identifier' >&2\nexit 1\n");
chmodSync(badFlux, 0o755);
process.env.PI_MERMAID_MMDFLUX = badFlux;
try {
	const bug = await run({
		type: "flowchart",
		nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
		edges: [{ from: "a", to: "b", label: "uses" }],
	});
	assert.equal(bug.isError, true);
	assert.ok(bug.details.error.includes("internal emitter bug"), `emitter parse failure is a bug report: ${bug.details.error}`);
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// freeform with a broken source returns the parser error for one model retry
process.env.PI_MERMAID_MMDFLUX = badFlux;
try {
	const free = await run({ freeform: "flowchart TD\n  A -->> B\n" });
	assert.equal(free.isError, true);
	assert.ok(free.details.error.includes("does not parse strictly"), `freeform parse error is returned: ${free.details.error}`);
	assert.ok(free.details.error.includes("expected identifier") || free.details.error.includes("Error:"), "parser detail is included");
	assert.equal(free.details.path, "freeform");
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// invalid params fail before any gate runs
const invalid = await run({ type: "flowchart", nodes: [{ id: "a", label: 'no "quotes"' }] });
assert.equal(invalid.isError, true);
assert.ok(invalid.details.error.includes("invalid params"), `param errors are surfaced: ${invalid.details.error}`);

// ── real mmdflux integration (skipped when the binary is absent) ──────────────

if (haveMmdflux && !process.env.PI_MERMAID_MMDFLUX) {
	const good = await runMmdflux("flowchart TD\n  A[\"Start\"] --> B[\"End\"]\n", "text");
	assert.equal(good.ok, true, "real mmdflux parses a clean flowchart");
	assert.ok(good.art.includes("Start"), "real mmdflux renders text art");

	const structured = await runMmdflux("flowchart TD\n  A[\"Start\"] --> B[\"End\"]\n", "mmds");
	assert.equal(structured.ok, true);
	assert.equal(structured.mmds.nodes.length, 2, "mmds exposes nodes");
	assert.equal(structured.mmds.edges.length, 1, "mmds exposes edges");

	const bad = await runMmdflux("flowchart TD\n  A -->> B\n", "text");
	assert.equal(bad.ok, false);
	assert.equal(bad.kind, "parse", "parse failures are classified");
} else {
	console.log("mermaid.test.mjs: skipping real-mmdflux integration (binary not found)");
}

// ── renderResult ──────────────────────────────────────────────────────────────

const theme = { fg: (_name, s) => s };
const rendered = tool.renderResult(
	{ content: [{ type: "text", text: "unused" }], details: { art: "┌──────┐\n│ Root │", width: 40, paneWidth: 100, ms: 420 } },
	{},
	theme,
	{},
);
assert.ok(rendered.text.includes("Root"), "art renders in the result row");
assert.ok(rendered.text.includes("validated"), "header marks the diagram as validated");
assert.ok(rendered.text.includes("40/100"), "header carries width over pane");

const renderedError = tool.renderResult(
	{ content: [{ type: "text", text: "unused" }], details: { error: "art is 500 cols, pane is 100", problems: ["node \"x\" missing"] } },
	{},
	theme,
	{},
);
assert.ok(renderedError.text.includes("rejected"), "error result renders the rejection");
assert.ok(renderedError.text.includes('- node "x" missing'), "problems render as a list");

const renderedPlain = tool.renderResult({ content: [{ type: "text", text: "plain text" }], details: undefined }, {}, theme, {});
assert.equal(renderedPlain.text, "plain text", "no details falls back to content text");

rmSync(tempRoot, { recursive: true, force: true });
console.log("mermaid.test.mjs: all assertions passed");
