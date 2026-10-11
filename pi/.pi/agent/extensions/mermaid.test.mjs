import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
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
	renderWithGrok,
	paneWidth,
} = mermaidModule;
const extension = mermaidModule.default;

const haveMmdflux = existsSync(join(homedir(), ".local", "bin", "mmdflux")) || !!process.env.PI_MERMAID_MMDFLUX;

// ── registration ─────────────────────────────────────────────────────────────

const registered = [];
const sentMessages = [];
const messageRenderers = new Map();
extension({
	registerTool(def) { registered.push(def); },
	sendMessage(message, options) { sentMessages.push({ message, options }); },
	registerMessageRenderer(customType, renderer) { messageRenderers.set(customType, renderer); },
});
assert.equal(registered.length, 1, "mermaid should register exactly one tool");
const tool = registered[0];
assert.equal(tool.name, "mermaid");
assert.equal(typeof tool.execute, "function");
assert.ok(tool.description.length > 40, "description should be substantive");
assert.ok(
	tool.description.includes("never write the fence in your reply"),
	"description should say it replaces inline generation",
);
assert.ok(tool.description.includes("guaranteed to render"), "description should promise chat rendering");
assert.ok(tool.promptGuidelines.length >= 3, "should carry usage guidelines");
assert.equal(typeof tool.renderResult, "function", "should render its own result");
assert.ok(tool.parameters, "should declare parameters");
assert.ok(
	tool.description.includes("displayed to the user automatically as a transcript row"),
	"description should promise the automatic transcript row",
);
assert.ok(messageRenderers.has("mermaid_diagram"), "registers a transcript-row renderer for diagrams");

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
	assert.ok(ok.content[0].text.includes("Do not write the fence in your reply"), "result tells the model not to repeat the fence");
	assert.equal(ok.details.width, 40);
	assert.equal(ok.details.path, "structured");
	assert.equal(typeof ok.details.ms, "number");
	assert.equal(sentMessages.length, 1, "a successful diagram emits exactly one display message");
	const sent = sentMessages[0];
	assert.equal(sent.message.customType, "mermaid_diagram");
	assert.equal(sent.message.display, true, "the display message is shown in the transcript");
	assert.equal(sent.options.triggerTurn, false, "the display message must not trigger a turn");
	assert.ok(sent.message.details.art.length > 0, "display message carries the rendered art");
	assert.ok(sent.message.details.source.includes("flowchart TD"), "display message carries the source");

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
	assert.equal(sentMessages.length, 2, "the recovered diagram also emits its display message");
	assert.ok(sentMessages[1].message.details.source.includes("flowchart TD"), "the displayed source is the TD variant");

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
	assert.equal(sentMessages.length, 2, "rejected diagrams emit no display message");
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
	assert.ok(bug.details.error.includes("do not retry"), "emitter parse failures are never retried");
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

// ── message renderer (the transcript row the user sees) ───────────────────────

const rowRenderer = messageRenderers.get("mermaid_diagram");
const rowTheme = { fg: (_name, s) => s };
const rowDetails = { art: "┌─────┐\n│ ART │", source: "flowchart TD\n  A --> B", width: 40, paneWidth: 100, ms: 5 };
const collapsedRow = rowRenderer({ details: rowDetails }, { expanded: false, outputPad: 0 }, rowTheme);
assert.ok(collapsedRow.text.includes("ART"), "the transcript row shows the art");
assert.ok(collapsedRow.text.includes("validated"), "the transcript row header marks validation");
assert.ok(!collapsedRow.text.includes("```mermaid"), "collapsed row hides the source fence");
const expandedRow = rowRenderer({ details: rowDetails }, { expanded: true, outputPad: 0 }, rowTheme);
assert.ok(expandedRow.text.includes("```mermaid"), "expanded row shows the source fence");
assert.equal(
	rowRenderer({ details: { error: "no art" } }, { expanded: false, outputPad: 0 }, rowTheme),
	undefined,
	"a message without art renders nothing",
);

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

// ── paneWidth clamps ──────────────────────────────────────────────────────────

{
	const savedEnv = process.env.PI_MERMAID_WIDTH;
	const savedCols = process.stdout.columns;
	try {
		process.env.PI_MERMAID_WIDTH = "60.9";
		assert.equal(paneWidth(), 60, "env width is floored, never fractional");
		process.env.PI_MERMAID_WIDTH = "39";
		assert.notEqual(paneWidth(), 39, "env width under 40 is ignored as unusable");
		process.env.PI_MERMAID_WIDTH = "garbage";
		assert.ok(paneWidth() >= 40, "non-numeric env width is ignored");
		delete process.env.PI_MERMAID_WIDTH;
		process.stdout.columns = 84;
		assert.equal(paneWidth(), 80, "stdout columns minus pane chrome (4 cols)");
		process.stdout.columns = 20;
		assert.equal(paneWidth(), 100, "unusable stdout columns fall back to the default width");
		process.stdout.columns = undefined;
		assert.equal(paneWidth(), 100, "no stdout columns falls back to the default width");
	} finally {
		if (savedEnv === undefined) delete process.env.PI_MERMAID_WIDTH;
		else process.env.PI_MERMAID_WIDTH = savedEnv;
		if (savedCols === undefined) delete process.stdout.columns;
		else process.stdout.columns = savedCols;
	}
}

// ── validateParams: per-type content requirements ─────────────────────────────

const needs = (params, what) => {
	const r = validateParams(params);
	assert.equal(r.ok, false, `${what} is rejected`);
	assert.ok(r.error.includes(what), `error names the requirement: ${r.error}`);
};
needs({ type: "flowchart" }, "flowchart needs at least one node");
needs({ type: "sequenceDiagram" }, "sequenceDiagram needs at least one actor");
needs({ type: "sequenceDiagram", actors: [{ id: "a" }] }, "sequenceDiagram needs at least one message");
needs({ type: "stateDiagram-v2" }, "stateDiagram-v2 needs at least one state");
needs({ type: "classDiagram" }, "classDiagram needs at least one class");

const noId = validateParams({ type: "flowchart", nodes: [{ id: "   " }] });
assert.equal(noId.ok, false);
assert.ok(noId.error.includes("id is required"), `blank ids are rejected: ${noId.error}`);

// undeclared references, per type
const ghostActor = validateParams({
	type: "sequenceDiagram",
	actors: [{ id: "a" }],
	messages: [{ from: "a", to: "ghost", text: "hi" }, { from: "a", to: "a", text: "" }],
});
assert.equal(ghostActor.ok, false);
assert.ok(ghostActor.error.includes('"ghost" is not a declared actor'), `ghost actor is named: ${ghostActor.error}`);
assert.ok(ghostActor.error.includes("text is required"), `blank message text is named: ${ghostActor.error}`);

const ghostState = validateParams({ type: "stateDiagram-v2", states: [{ id: "s" }], transitions: [{ from: "s", to: "ghost" }] });
assert.equal(ghostState.ok, false);
assert.ok(ghostState.error.includes('"ghost" is not a declared state'), `ghost state is named: ${ghostState.error}`);

const ghostClass = validateParams({ type: "classDiagram", classes: [{ id: "c", name: "C" }], relations: [{ from: "c", to: "ghost" }] });
assert.equal(ghostClass.ok, false);
assert.ok(ghostClass.error.includes('"ghost" is not a declared class'), `ghost class is named: ${ghostClass.error}`);

// quotes are rejected in every label slot, never escaped
const quoted = (params, where) => {
	const r = validateParams(params);
	assert.equal(r.ok, false, `quotes rejected in ${where}`);
	assert.ok(r.error.includes("double quotes"), `quote policy in ${where}: ${r.error}`);
};
quoted({ type: "flowchart", nodes: [{ id: "a" }], groups: [{ id: "g", title: 'say "hi"', members: ["a"] }] }, "a group title");
quoted({ type: "flowchart", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b", label: 'x"y' }] }, "an edge label");
quoted({ type: "sequenceDiagram", actors: [{ id: "a" }, { id: "b" }], messages: [{ from: "a", to: "b", text: 'x"y' }] }, "a message text");
quoted({ type: "stateDiagram-v2", states: [{ id: "s" }], transitions: [{ from: "s", to: "s", label: 'x"y' }] }, "a transition label");
quoted({ type: "classDiagram", classes: [{ id: "c", name: "C" }], relations: [{ from: "c", to: "c", label: 'x"y' }] }, "a relation label");

// labels that clean up to nothing are rejected
const blankLabel = validateParams({ type: "flowchart", nodes: [{ id: "a", label: "\u0007`" }] });
assert.equal(blankLabel.ok, false);
assert.ok(blankLabel.error.includes("label is empty after cleanup"), `post-cleanup empties are named: ${blankLabel.error}`);

// class members cannot carry braces or newlines
const braces = validateParams({ type: "classDiagram", classes: [{ id: "c", name: "C", members: ["+f({})"] }] });
assert.equal(braces.ok, false);
assert.ok(braces.error.includes("no braces or newlines"), `brace members are named: ${braces.error}`);

// direction handling: LR passes through, anything else defaults to TD
assert.equal(validateParams({ type: "flowchart", nodes: [{ id: "a" }], direction: "LR" }).value.direction, "LR");
assert.equal(validateParams({ type: "flowchart", nodes: [{ id: "a" }], direction: "sideways" }).value.direction, "TD");
assert.equal(validateParams({ type: "flowchart", nodes: [{ id: "a" }] }).value.direction, "TD");

// ids are clamped to 40 chars; non-ascii is scrubbed
assert.equal(sanitizeId("x".repeat(80), 0).length, 40, "ids are clamped to 40 chars");
assert.equal(sanitizeId("\u00fcn\u00efcode", 0), "n_code", "non-ascii chars become underscores");

// edges may target a group id, and the emitter keeps that reference
const edgeToGroup = validateParams({
	type: "flowchart",
	nodes: [{ id: "a" }, { id: "b" }],
	groups: [{ id: "g", title: "G", members: ["b"] }],
	edges: [{ from: "a", to: "g" }],
});
assert.ok(edgeToGroup.ok, `group endpoints validate: ${edgeToGroup.ok === false ? edgeToGroup.error : ""}`);
const edgeToGroupSrc = emitMermaid(edgeToGroup.value);
assert.ok(/^  a --> g$/m.test(edgeToGroupSrc), `edge to a group emits the plain arrow: ${JSON.stringify(edgeToGroupSrc)}`);

// ── emitMermaid: exact forms ───────────────────────────────────────────────────

assert.ok(emitMermaid(okFlow.value, "LR").startsWith("flowchart LR"), "the LR override reaches the flowchart header");
assert.ok(emitMermaid(state.value, "LR").includes("  direction LR"), "the state diagram carries its own direction line");
assert.ok(!stateSrc.includes("as s2"), "an unlabeled state never emits the display form");

// every relation kind maps to its exact arrow
const relAll = validateParams({
	type: "classDiagram",
	classes: ["A", "B", "C", "D", "E", "F", "G"].map((name) => ({ id: name.toLowerCase(), name })),
	relations: [
		{ from: "a", to: "b", kind: "extends" },
		{ from: "a", to: "c", kind: "implements" },
		{ from: "a", to: "d", kind: "composition" },
		{ from: "a", to: "e", kind: "aggregation" },
		{ from: "a", to: "f" },
		{ from: "a", to: "g", kind: "dependency", label: "uses" },
	],
});
assert.ok(relAll.ok);
const relSrc = emitMermaid(relAll.value);
assert.ok(relSrc.includes("A <|-- B"), "extends arrow");
assert.ok(relSrc.includes("A <|.. C"), "implements arrow");
assert.ok(relSrc.includes("A *-- D"), "composition arrow");
assert.ok(relSrc.includes("A o-- E"), "aggregation arrow");
assert.ok(relSrc.includes("A --> F"), "default association arrow");
assert.ok(relSrc.includes("A ..> G : uses"), "dependency arrow with its colon label");

// sequenceDiagram lines cannot hold <br/>: newlines flatten to spaces
const seqBr = validateParams({
	type: "sequenceDiagram",
	actors: [{ id: "a", label: "two\nlines" }],
	messages: [{ from: "a", to: "a", text: "one\ntwo" }],
});
assert.ok(seqBr.ok);
const seqBrSrc = emitMermaid(seqBr.value);
assert.ok(seqBrSrc.includes("participant a as two lines"), `actor labels flatten: ${seqBrSrc}`);
assert.ok(seqBrSrc.includes("a->>a: one two"), `message text flattens: ${seqBrSrc}`);

// ── diffStructure: classDiagram and stateDiagram-v2 paths ─────────────────────

const clsPair = validateParams({
	type: "classDiagram",
	classes: [{ id: "w", name: "Widget" }, { id: "b", name: "Button" }],
	relations: [{ from: "b", to: "w", kind: "extends" }],
});
assert.ok(clsPair.ok);
// class relations may come back in either orientation (W <|-- B)
assert.deepEqual(
	diffStructure(
		{ nodes: [{ id: "Widget", label: "Widget" }, { id: "Button", label: "Button" }], edges: [{ source: "Widget", target: "Button" }] },
		clsPair.value,
	),
	[],
	"class relations match in either orientation",
);
assert.ok(
	diffStructure(
		{ nodes: [{ id: "Widget", label: "Widget" }, { id: "Button", label: "Button" }], edges: [] },
		clsPair.value,
	).some((p) => p.includes("edge b->w missing")),
	"a missing class relation is reported",
);
assert.ok(
	diffStructure(
		{ nodes: [{ id: "Widget", label: "Gadget" }, { id: "Button", label: "Button" }], edges: [{ source: "Widget", target: "Button" }] },
		clsPair.value,
	).some((p) => p.includes('class "w" rendered as "Gadget"')),
	"a renamed class body is reported",
);

const stateMmdsOk = {
	nodes: [{ id: "s1", label: "Working" }, { id: "s2", label: "s2" }],
	edges: [
		{ source: "__root_start", target: "s1" },
		{ source: "s1", target: "s2", label: "done" },
		{ source: "s2", target: "__root_end" },
	],
};
assert.deepEqual(diffStructure(stateMmdsOk, state.value), [], "[*] maps to the root start/end pseudo-states");
assert.ok(
	diffStructure({ nodes: [{ id: "s1", label: "Working" }], edges: stateMmdsOk.edges }, state.value).some((p) => p.includes('state "s2" missing')),
	"a missing state is reported",
);
assert.ok(
	diffStructure({ nodes: stateMmdsOk.nodes, edges: [{ source: "__root_start", target: "s1" }] }, state.value).some((p) => p.includes("transition s1->s2 missing")),
	"a missing transition is reported",
);
assert.ok(
	diffStructure(
		{ nodes: stateMmdsOk.nodes, edges: stateMmdsOk.edges.map((e) => (e.label === "done" ? { ...e, label: "finished" } : e)) },
		state.value,
	).some((p) => p.includes('transition s1->s2 label rendered as "finished"')),
	"a wrong transition label is reported",
);

// ── diffArtContainment: actor visibility ──────────────────────────────────────

assert.ok(
	diffArtContainment("Agent only here\n do the thing\n done", seq.value).some((p) => p.includes('actor "you"')),
	"an actor missing from the art is reported",
);
assert.deepEqual(diffArtContainment("You Agent\n do the thing\n done", seq.value), [], "full containment passes");

// ── renderWithGrok: direct contract ───────────────────────────────────────────

try {
	globalThis.__grokRender = () => { throw new Error("kaboom"); };
	const grokCrash = await renderWithGrok("flowchart TD\n  A --> B");
	assert.equal(grokCrash.ok, false);
	assert.equal(grokCrash.kind, "crash");
	assert.ok(grokCrash.error.includes("kaboom"), `crash error names the throw: ${grokCrash.error}`);

	globalThis.__grokRender = () => ({ plain: ["no width field"] });
	const grokNoArt = await renderWithGrok("flowchart TD\n  A --> B");
	assert.equal(grokNoArt.ok, false);
	assert.equal(grokNoArt.kind, "crash");
	assert.ok(grokNoArt.error.includes("no art"), `artless render is a crash: ${grokNoArt.error}`);

	globalThis.__grokRender = () => ({ width: 42, warnings: ["w1"], plain: ["art"] });
	assert.deepEqual(
		await renderWithGrok("flowchart TD\n  A --> B"),
		{ ok: true, width: 42, warnings: ["w1"], art: "art" },
		"a good render returns width, warnings, and joined art",
	);
} finally {
	delete globalThis.__grokRender;
}

// ── grok-mermaid unavailable: the mmdflux text-art width is the local proxy ────

const stubGrokBroken = join(tempRoot, "grok-broken.cjs");
writeFileSync(stubGrokBroken, "throw new Error('cannot import grok');\n");
// jiti caches modules by resolved path, so the no-grok instance needs its
// own copy of the source to pick up the different grok alias.
const noGrokSource = join(tempRoot, "mermaid-nogrok.ts");
writeFileSync(noGrokSource, readFileSync(fileURLToPath(new URL("./mermaid.ts", import.meta.url)), "utf8"));
const jitiNoGrok = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
		"grok-mermaid": stubGrokBroken,
	},
});
const noGrokModule = jitiNoGrok(noGrokSource);
const unavailable = await noGrokModule.renderWithGrok("flowchart TD\n  A --> B");
assert.equal(unavailable.ok, false);
assert.equal(unavailable.kind, "unavailable", "an unimportable chat renderer is reported as unavailable");

const sentNoGrok = [];
const registeredNoGrok = [];
noGrokModule.default({
	registerTool(def) { registeredNoGrok.push(def); },
	sendMessage(message, options) { sentNoGrok.push({ message, options }); },
	registerMessageRenderer() {},
});
const toolNoGrok = registeredNoGrok[0];
const okFlowParams = {
	type: "flowchart",
	nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
	edges: [{ from: "a", to: "b", label: "uses" }],
};
try {
	process.env.PI_MERMAID_MMDFLUX = goodFlux;
	const noGrokOk = await toolNoGrok.execute("id", okFlowParams, undefined, () => {}, {});
	assert.equal(noGrokOk.isError, undefined, `success without the chat renderer: ${JSON.stringify(noGrokOk).slice(0, 200)}`);
	assert.equal(noGrokOk.details.width, "fake art".length, "width falls back to the mmdflux text-art width");
	assert.equal(noGrokOk.details.art, "fake art");
	assert.equal(sentNoGrok.length, 1, "the display row still ships without the chat renderer");

	const wideFlux = join(tempRoot, "wide-mmdflux");
	writeFileSync(
		wideFlux,
		`#!/bin/sh\nif [ "$2" = "mmds" ]; then echo '${fakeMmds}'; else head -c 200 /dev/zero | tr '\\0' 'x'; echo; fi\n`,
	);
	chmodSync(wideFlux, 0o755);
	process.env.PI_MERMAID_MMDFLUX = wideFlux;
	const noGrokWide = await toolNoGrok.execute("id", okFlowParams, undefined, () => {}, {});
	assert.equal(noGrokWide.isError, true);
	assert.ok(noGrokWide.details.error.includes("cols, pane is"), `wide art without the renderer names both numbers: ${noGrokWide.details.error}`);
	assert.equal(sentNoGrok.length, 1, "the rejected diagram ships no display row");
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// ── environment failures and aborts are never retried ─────────────────────────

const noExec = join(tempRoot, "noexec-mmdflux");
writeFileSync(noExec, "#!/bin/sh\necho never\n");
chmodSync(noExec, 0o644);
try {
	process.env.PI_MERMAID_MMDFLUX = noExec;
	const envFail = await runMmdflux("flowchart TD\n  A --> B", "text");
	assert.equal(envFail.ok, false);
	assert.equal(envFail.kind, "environment", "a non-starting binary is an environment failure, not a parse failure");
	assert.ok(envFail.error.includes("failed to start"), `the failing candidate is named: ${envFail.error}`);

	const envFailExec = await run(okFlowParams);
	assert.equal(envFailExec.isError, true);
	assert.ok(envFailExec.details.error.includes("environment failure, not retried"), `environment failures say not retried: ${envFailExec.details.error}`);
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

const abortController = new AbortController();
abortController.abort();
try {
	process.env.PI_MERMAID_MMDFLUX = goodFlux;
	const runWithSignal = (params) => tool.execute("id", params, abortController.signal, () => {}, {});
	const aborted = await runWithSignal(okFlowParams);
	assert.equal(aborted.isError, true);
	assert.ok(aborted.details.error.includes("aborted"), `a pre-aborted signal fails the call: ${aborted.details.error}`);
	assert.equal(sentMessages.length, 2, "an aborted call ships no display row");
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// a signal aborted mid-flight kills the running mmdflux and fails the call
const slowFlux = join(tempRoot, "slow-mmdflux");
writeFileSync(slowFlux, "#!/bin/sh\nexec sleep 10\n"); // exec: the kill lands on the process holding the pipe
chmodSync(slowFlux, 0o755);
try {
	process.env.PI_MERMAID_MMDFLUX = slowFlux;
	const midFlight = new AbortController();
	const midFlightRun = tool.execute("id", okFlowParams, midFlight.signal, () => {}, {});
	setTimeout(() => midFlight.abort(), 50);
	const midFlightResult = await midFlightRun;
	assert.equal(midFlightResult.isError, true);
	assert.ok(midFlightResult.details.error.includes("aborted"), `mid-flight abort fails the call: ${midFlightResult.details.error}`);
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// ── execute: gate-2 mismatch, unsupported type, freeform success ──────────────

const mismatchMmds = JSON.stringify({ nodes: [{ id: "a", label: "Wrong" }, { id: "b", label: "Beta" }], edges: [{ source: "a", target: "b", label: "uses" }] });
const mismatchFlux = join(tempRoot, "mismatch-mmdflux");
writeFileSync(mismatchFlux, `#!/bin/sh\nif [ "$2" = "mmds" ]; then echo '${mismatchMmds}'; else echo 'fake art'; fi\n`);
chmodSync(mismatchFlux, 0o755);
try {
	process.env.PI_MERMAID_MMDFLUX = mismatchFlux;
	const mismatch = await run(okFlowParams);
	assert.equal(mismatch.isError, true);
	assert.ok(mismatch.details.error.includes("does not match your params"), `gate-2 failures name the mismatch: ${mismatch.details.error}`);
	assert.ok(mismatch.details.error.includes("call once more"), "gate-2 failures allow one retry");
	assert.deepEqual(mismatch.details.problems, ['node "a" rendered as "Wrong" instead of "Alpha"'], "the exact problem list is attached");
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// unsupported type stops at attempt 1 and names the list
const noType = await run({ type: "erDiagram", nodes: [{ id: "a" }] });
assert.equal(noType.isError, true);
assert.ok(noType.details.error.includes("type must be one of"), `the type guard fires at execute level: ${noType.details.error}`);
assert.ok(noType.details.error.includes("stateDiagram-v2"), "the error names the full supported list");

// freeform success: the fence body is extracted and gated as-is
try {
	process.env.PI_MERMAID_MMDFLUX = goodFlux;
	const freeOk = await run({ freeform: "intro\n```mermaid\nflowchart TD\n  A[\"X\"] --> B[\"Y\"]\n```\noutro" });
	assert.equal(freeOk.isError, undefined, `freeform success: ${JSON.stringify(freeOk).slice(0, 200)}`);
	assert.equal(freeOk.details.path, "freeform");
	assert.equal(freeOk.details.source, 'flowchart TD\n  A["X"] --> B["Y"]', "only the fence body is kept, trimmed");
} finally {
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// ── runMmdflux: a missing env candidate falls through to the next candidate ────

if (haveMmdflux) {
	const savedCandidate = process.env.PI_MERMAID_MMDFLUX;
	process.env.PI_MERMAID_MMDFLUX = join(tempRoot, "no-such-binary");
	try {
		const fallback = await runMmdflux('flowchart TD\n  A["S"] --> B["E"]\n', "text");
		assert.equal(fallback.ok, true, "an ENOENT env candidate falls through to the next candidate");
	} finally {
		if (savedCandidate === undefined) delete process.env.PI_MERMAID_MMDFLUX;
		else process.env.PI_MERMAID_MMDFLUX = savedCandidate;
	}
} else {
	console.log("mermaid.test.mjs: skipping env-candidate fallback (no mmdflux candidate on this host)");
}

// ── real mmdflux: the emitter round-trips every supported type ─────────────────

if (haveMmdflux && !process.env.PI_MERMAID_MMDFLUX) {
	const roundTrip = async (valid, kind, name) => {
		const src = emitMermaid(valid);
		const mmds = await runMmdflux(src, "mmds");
		assert.equal(mmds.ok, true, `emitted ${name} parses strictly: ${mmds.ok === false ? mmds.error : ""}`);
		const text = await runMmdflux(src, "text");
		assert.equal(text.ok, true, `emitted ${name} renders text art`);
		const problems = kind === "containment" ? diffArtContainment(text.art, valid) : diffStructure(mmds.mmds, valid);
		assert.deepEqual(problems, [], `emitted ${name} matches its params exactly: ${problems.join("; ")}`);
	};
	await roundTrip(okFlow.value, "structure", "flowchart");
	await roundTrip(grouped.value, "structure", "grouped flowchart");
	await roundTrip(seq.value, "containment", "sequenceDiagram");
	await roundTrip(state.value, "structure", "stateDiagram-v2");
	await roundTrip(relAll.value, "structure", "classDiagram");
} else {
	console.log("mermaid.test.mjs: skipping real-mmdflux emitter round-trip (binary not found)");
}

// ── display rows are best-effort: a throwing sendMessage never fails the call ──

{
	const throwingSource = join(tempRoot, "mermaid-throwing.ts");
	writeFileSync(throwingSource, readFileSync(fileURLToPath(new URL("./mermaid.ts", import.meta.url)), "utf8"));
	const jitiThrowing = createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-coding-agent": stubAgent,
			"@earendil-works/pi-tui": stubTui,
			typebox: stubTypes,
			"grok-mermaid": stubGrok,
		},
	});
	const registeredThrowing = [];
	jitiThrowing(throwingSource).default({
		registerTool(def) { registeredThrowing.push(def); },
		sendMessage() { throw new Error("display bus is down"); },
		registerMessageRenderer() {},
	});
	try {
		process.env.PI_MERMAID_MMDFLUX = goodFlux;
		const displayDown = await registeredThrowing[0].execute("id", okFlowParams, undefined, () => {}, {});
		assert.equal(displayDown.isError, undefined, `a failing display bus never fails the call: ${JSON.stringify(displayDown).slice(0, 200)}`);
		assert.ok(displayDown.content[0].text.includes("```mermaid"), "the validated fence still ships in the tool result");
	} finally {
		if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
		else process.env.PI_MERMAID_MMDFLUX = savedFlux;
	}
}

// ── corpus harness: a manual gate that skips cleanly without real binaries ────

// mermaid.corpus.mjs stays Tier 2 (real mmdflux + real grok-mermaid). Here we
// only pin its skip behavior: on a host without the binaries it must exit
// with a message, never a stack trace, and it must not run any case.
if (process.env.JITI_PATH) {
	const corpusScript = fileURLToPath(new URL("./mermaid.corpus.mjs", import.meta.url));
	const fakeHome = mkdtempSync(join(tmpdir(), "mermaid-corpus-home-"));
	const noBinaryEnv = { ...process.env, HOME: fakeHome };
	delete noBinaryEnv.PI_MERMAID_MMDFLUX;
	try {
		const usage = spawnSync(process.execPath, [corpusScript], { env: noBinaryEnv, encoding: "utf8", timeout: 20_000 });
		assert.equal(usage.status, 2, "no arguments prints usage");
		assert.ok(usage.stderr.includes("usage:"), `usage message: ${usage.stderr}`);

		const tinyCorpus = join(tempRoot, "tiny-corpus.json");
		writeFileSync(tinyCorpus, JSON.stringify([{ name: "tiny", params: { type: "flowchart", nodes: [{ id: "a" }] } }]));
		const skipped = spawnSync(process.execPath, [corpusScript, "e2e", tinyCorpus], { env: noBinaryEnv, encoding: "utf8", timeout: 20_000 });
		assert.equal(skipped.status, 2, "the corpus exits 2 when real binaries are absent");
		assert.ok(skipped.stderr.includes("not found"), `skip message: ${skipped.stderr}`);
		assert.ok(!/^\s+at /m.test(skipped.stderr), "the skip is a message, never a stack trace");
		assert.ok(!skipped.stdout.includes("pass tiny"), "no corpus case runs without the binaries");
	} finally {
		rmSync(fakeHome, { recursive: true, force: true });
	}
} else {
	console.log("mermaid.test.mjs: skipping corpus skip-behavior check (JITI_PATH not set)");
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("mermaid.test.mjs: all assertions passed");
