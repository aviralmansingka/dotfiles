import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// is type-only and erased. The mmdflux child process is real IO and is
// exercised below only when the binary exists.
const tempRoot = mkdtempSync(join(tmpdir(), "mermaid-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
const stubTypes = join(tempRoot, "types.cjs");
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(
	stubTui,
	`
class Text { constructor(text) { this.text = text; } }
exports.Text = Text;
`,
);
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
	},
});

const mermaidModule = jiti("./mermaid.ts");
const {
	extractMermaidSource,
	extractNoneEscape,
	buildAttemptPrompt,
	buildCheckerPrompt,
	parseCheckerVerdict,
	loadPatternCatalog,
	buildSystemPrompt,
	runMmdflux,
} = mermaidModule;
const extension = mermaidModule.default;

const haveMmdflux = existsSync(join(homedir(), ".local", "bin", "mmdflux")) || !!process.env.PI_MERMAID_MMDFLUX;

const textOf = (result) =>
	result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

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
assert.ok(tool.promptGuidelines.length >= 3, "should carry usage guidelines");
assert.equal(typeof tool.renderResult, "function", "should render its own result");

// ── extractMermaidSource (pure) ───────────────────────────────────────────────

assert.equal(
	extractMermaidSource("Here you go:\n```mermaid\nflowchart TD\n  A --> B\n```\nDone."),
	"flowchart TD\n  A --> B",
	"should extract a mermaid fence",
);
assert.equal(extractMermaidSource("```mmd\nflowchart TD\n  A --> B\n```"), null, "only the mermaid fence tag is accepted");
assert.equal(
	extractMermaidSource("flowchart TD\n  A[Root] --> Z[Goal]"),
	null,
	"a bare diagram block is not accepted",
);
assert.equal(extractMermaidSource("no diagram here at all"), null, "prose without a diagram returns null");
assert.equal(extractMermaidSource("```\nflowchart TD\n  A --> B\n```"), null, "an untagged fence is not accepted as mermaid");

// ── escape hatch, checker, catalog (pure) ────────────────────────────────────

assert.equal(extractNoneEscape("NONE: the spec needs a coordinate plot"), "the spec needs a coordinate plot");
assert.equal(extractNoneEscape("NONE: needs exact positions"), "needs exact positions");
assert.equal(extractNoneEscape("```mermaid\nflowchart TD\n  A --> B\n```"), null, "a fence is not an escape");

const checkerPrompt = buildCheckerPrompt("Type: flowchart TD. Nodes: Root, Goal.", "┌──────┐\n│ Root │");
assert.ok(checkerPrompt.includes("Type: flowchart TD"), "checker prompt carries the spec");
assert.ok(checkerPrompt.includes("│ Root │"), "checker prompt carries the rendered art");

assert.deepEqual(parseCheckerVerdict("VERDICT: MATCH"), { match: true });
assert.deepEqual(parseCheckerVerdict("verdict: match"), { match: true }, "verdict matching is case-insensitive");
const mismatchVerdict = parseCheckerVerdict("VERDICT: MISMATCH: the Goal node is missing");
assert.equal(mismatchVerdict.match, false);
assert.equal(mismatchVerdict.reason, "the Goal node is missing");
assert.equal(parseCheckerVerdict("looks fine to me").reason, "checker returned no verdict");

// Catalog: fixture skill file via PI_MERMAID_SKILL, then fallback when absent.
const fixtureSkill = join(tempRoot, "fixture-skill.md");
writeFileSync(
	fixtureSkill,
	"---\nname: mermaid\n---\n\n# mermaid\n\n## Named layout patterns\n\n### junction — split\n\nUse a junction node.\n\n## Renderers\n\nOther section.\n",
);
const savedSkill = process.env.PI_MERMAID_SKILL;
process.env.PI_MERMAID_SKILL = fixtureSkill;
try {
	const catalog = loadPatternCatalog();
	assert.ok(catalog.includes("junction"), "catalog carries the skill's named patterns");
	assert.ok(!catalog.includes("Other section"), "catalog stops at the next section");
	assert.ok(buildSystemPrompt().includes("junction"), "system prompt embeds the catalog");
	assert.ok(buildSystemPrompt().includes("You write Mermaid diagrams"), "system prompt keeps the base rules");
} finally {
	if (savedSkill === undefined) delete process.env.PI_MERMAID_SKILL;
	else process.env.PI_MERMAID_SKILL = savedSkill;
}
process.env.PI_MERMAID_SKILL = join(tempRoot, "missing-skill.md");
try {
	const fallback = loadPatternCatalog();
	assert.ok(fallback.includes("hub-and-spoke"), "fallback catalog applies when the skill file is absent");
	assert.ok(fallback.includes("Aspect rules"), "fallback carries the aspect rules");
} finally {
	if (savedSkill === undefined) delete process.env.PI_MERMAID_SKILL;
	else process.env.PI_MERMAID_SKILL = savedSkill;
}

// ── buildAttemptPrompt (pure) ─────────────────────────────────────────────────

const first = buildAttemptPrompt("Type: flowchart TD. Nodes: A, B. Edge: A --> B.");
assert.ok(first.includes("flowchart TD"), "prompt carries the spec");
assert.ok(first.includes("~7 nodes"), "prompt carries the node budget");
assert.ok(!first.includes("rejected"), "first attempt has no failure feedback");

const retry = buildAttemptPrompt("spec text", { source: "flowchart TD\n  A -->", error: "Parse error at line 2" });
assert.ok(retry.includes("rejected"), "retry prompt names the rejection");
assert.ok(retry.includes("Reason: Parse error at line 2"), "retry prompt carries the reason");
assert.ok(retry.includes("A -->"), "retry prompt carries the previous source");

// ── runMmdflux against the real binary (skipped when absent) ──────────────────

if (haveMmdflux) {
	const ok = await runMmdflux("flowchart TD\n  A[Root] --> Z[Goal]");
	assert.ok(ok.ok, `valid diagram should pass: ${JSON.stringify(ok).slice(0, 200)}`);
	assert.ok(ok.art.includes("Root"), "valid diagram renders node labels as art");

	const bad = await runMmdflux("flowchart TD\n  A -->");
	assert.ok(!bad.ok, "invalid diagram should fail");
	assert.equal(bad.kind, "parse", "a completed run with a parse error is a parse verdict");
	assert.ok(/parse error|error/i.test(bad.error), `failure should carry a parse error: ${bad.error.slice(0, 120)}`);
} else {
	console.log("note: mmdflux not found; skipping integration checks");
}

// ── execute paths with a fake model registry ─────────────────────────────────

const fakeCtx = (replies, { sol = true, authed = true } = {}) => {
	let calls = 0;
	const ctx = {
		modelRegistry: {
			find: (provider, id) =>
				provider === "openai-codex" && id === "gpt-6.1-sol" && sol ? { id: "gpt-6.1-sol" } : undefined,
			hasConfiguredAuth: () => authed,
			complete: async () => {
				const reply = replies[Math.min(calls, replies.length - 1)];
				calls++;
				return {
					content: [{ type: "text", text: reply }],
					usage: { inputTokens: 10, outputTokens: 5 },
				};
			},
		},
	};
	ctx.callCount = () => calls;
	return ctx;
};

// No mermaid in the replies → isError with the last error, usage summed.
const failing = await tool.execute(
	"id-1",
	{ spec: "a diagram of the build pipeline" },
	undefined,
	() => {},
	fakeCtx(["I cannot draw that.", "Still no diagram."]),
);
assert.equal(failing.isError, true, "all-bad replies should error");
assert.equal(failing.details.attempts, 4, "details record every consumed attempt");
assert.equal(failing.details.error, "model returned no mermaid block");
assert.equal(failing.usage.inputTokens, 40, "nested usage is summed");
assert.equal(failing.usage.outputTokens, 20, "nested usage is summed");

// sol absent from the registry → loud error, no session-model substitution.
const noSolCtx = fakeCtx(["```mermaid\nflowchart TD\n  A --> B\n```"], { sol: false });
const noSol = await tool.execute("id-3", { spec: "a diagram" }, undefined, () => {}, noSolCtx);
assert.equal(noSol.isError, true, "missing sol should error instead of substituting the session model");
assert.equal(noSol.details.error, "no model");
assert.equal(noSol.details.attempts, 0);
assert.equal(noSolCtx.callCount(), 0, "no nested call runs without a model");

// sol present but unauthenticated → same loud error, no attempts burned.
const noAuthCtx = fakeCtx(["```mermaid\nflowchart TD\n  A --> B\n```"], { authed: false });
const noAuth = await tool.execute("id-4", { spec: "a diagram" }, undefined, () => {}, noAuthCtx);
assert.equal(noAuth.isError, true, "unauthenticated sol should error instead of burning attempts");
assert.equal(noAuth.details.error, "no model");
assert.equal(noAuthCtx.callCount(), 0, "no nested call runs against an unauthenticated model");

// Spatial escape: the author signals NONE → non-error result, no retries.
const escapeCtx = fakeCtx(["NONE: the spec needs a coordinate plot with exact positions"]);
const escaped = await tool.execute("id-9", { spec: "a coordinate plot of two vectors" }, undefined, () => {}, escapeCtx);
assert.ok(!escaped.isError, "the spatial escape is a clean result, not an error");
assert.ok(escaped.details.escape.includes("coordinate plot"), "details carry the escape reason");
assert.equal(escaped.details.attempts, 1);
assert.equal(escapeCtx.callCount(), 1, "the escape ends the run after one nested call");

// Valid fence + matching checker verdict → success, checker usage summed.
if (haveMmdflux) {
	const succeeding = await tool.execute(
		"id-2",
		{ spec: "Type: flowchart TD. Nodes: Root, Goal. Edge: Root --> Goal." },
		undefined,
		() => {},
		fakeCtx(["```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```", "VERDICT: MATCH"]),
	);
	assert.ok(!succeeding.isError, `valid reply should succeed: ${JSON.stringify(succeeding.content).slice(0, 200)}`);
	assert.ok(textOf(succeeding).includes("```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```"), "content embeds the validated fence");
	assert.ok(succeeding.details.art.includes("Root"), "details carry the rendered art");
	assert.equal(succeeding.details.attempts, 1);
	assert.equal(succeeding.usage.inputTokens, 20, "author and checker usage are summed");

	// Checker mismatch → retry with feedback, then match → success on attempt 2.
	const mismatchCtx = fakeCtx([
		"```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```",
		"VERDICT: MISMATCH: the Goal node label is wrong",
		"```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```",
		"VERDICT: MATCH",
	]);
	const retried = await tool.execute(
		"id-8",
		{ spec: "Type: flowchart TD. Nodes: Root, Goal. Edge: Root --> Goal." },
		undefined,
		() => {},
		mismatchCtx,
	);
	assert.ok(!retried.isError, `mismatch-then-match should succeed: ${JSON.stringify(retried.content).slice(0, 200)}`);
	assert.equal(retried.details.attempts, 2, "a checker mismatch consumes an attempt and retries");
	assert.equal(retried.usage.inputTokens, 40, "four nested calls are summed");
}

// A missing mmdflux binary must end the run after one attempt, not burn the rest.
const emptyBin = join(tempRoot, "empty-bin");
mkdirSync(emptyBin, { recursive: true });
const savedHome = process.env.HOME;
const savedPath = process.env.PATH;
const savedFlux = process.env.PI_MERMAID_MMDFLUX;
delete process.env.PI_MERMAID_MMDFLUX;
process.env.HOME = tempRoot;
process.env.PATH = emptyBin;
try {
	const envCtx = fakeCtx(["```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```"]);
	const envFail = await tool.execute(
		"id-5",
		{ spec: "Type: flowchart TD. Nodes: Root, Goal. Edge: Root --> Goal." },
		undefined,
		() => {},
		envCtx,
	);
	assert.equal(envFail.isError, true, "missing mmdflux should fail the tool");
	assert.equal(envCtx.callCount(), 1, "a missing binary must not consume further attempts");
	assert.equal(envFail.details.attempts, 1, "details report the single attempt that ran");
	assert.ok(
		envFail.details.error.includes("mmdflux binary not found"),
		`error names the environment failure: ${envFail.details.error}`,
	);
} finally {
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
	if (savedPath === undefined) delete process.env.PATH;
	else process.env.PATH = savedPath;
	if (savedFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedFlux;
}

// A validator killed by a signal (timeout or crash) is an environment failure, not a parse error.
const killerBin = join(tempRoot, "killer-mmdflux");
writeFileSync(killerBin, "#!/bin/sh\nkill -9 $$\n");
chmodSync(killerBin, 0o755);
const savedKillerFlux = process.env.PI_MERMAID_MMDFLUX;
process.env.PI_MERMAID_MMDFLUX = killerBin;
try {
	const killed = await runMmdflux("flowchart TD\n  A --> B");
	assert.ok(!killed.ok, "a killed validator should fail");
	assert.equal(killed.kind, "environment", "a signal kill must classify as environment, not parse");
	assert.match(killed.error, /SIGKILL/, `error names the kill: ${killed.error}`);

	const killCtx = fakeCtx(["```mermaid\nflowchart TD\n  A --> B\n```"]);
	const killFail = await tool.execute("id-6", { spec: "a diagram" }, undefined, () => {}, killCtx);
	assert.equal(killFail.isError, true, "a killed validator should fail the tool");
	assert.equal(killCtx.callCount(), 1, "a killed validator must not consume further attempts");
	assert.equal(killFail.details.attempts, 1, "details report the single attempt that ran");
} finally {
	if (savedKillerFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedKillerFlux;
}

// Progress updates must be partial AgentToolResult objects (SDK contract:
// AgentToolUpdateCallback, pi-agent-core types.d.ts:407). The interactive
// TUI's ToolExecutionComponent.updateDisplay dereferences partial.content as
// an array on every update, so a raw string payload crashes the whole session
// with an uncaught TypeError. Consume each update the way the TUI does.
const tuiSeen = [];
const tuiOnUpdate = (partial) => {
	// ToolExecutionComponent.updateDisplay behavior: partial.content.filter(...)
	tuiSeen.push(partial.content.filter((c) => c.type === "text").map((c) => c.text).join(" "));
};
const savedTuiFlux = process.env.PI_MERMAID_MMDFLUX;
process.env.PI_MERMAID_MMDFLUX = killerBin; // deterministic env failure after both updates fire
try {
	const tuiCtx = fakeCtx(["```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```"]);
	await tool.execute("id-7", { spec: "a diagram" }, undefined, tuiOnUpdate, tuiCtx);
	assert.equal(tuiCtx.callCount(), 1, "the environment failure ends the run after one nested call");
	assert.equal(tuiSeen.length, 2, "both progress updates fire: writing, then validating");
	assert.match(tuiSeen[0], /writing diagram/, `first update reports the writing step: ${tuiSeen[0]}`);
	assert.match(tuiSeen[1], /validating with mmdflux/, `second update reports the validation step: ${tuiSeen[1]}`);
} finally {
	if (savedTuiFlux === undefined) delete process.env.PI_MERMAID_MMDFLUX;
	else process.env.PI_MERMAID_MMDFLUX = savedTuiFlux;
}

// ── renderResult ─────────────────────────────────────────────────────────────

const theme = { fg: (_name, s) => s };
const rendered = tool.renderResult(
	{ content: [{ type: "text", text: "unused" }], details: { art: "┌──────┐\n│ Root │", attempts: 1 } },
	{},
	theme,
	{},
);
assert.ok(rendered.text.includes("Root"), "art renders in the result row");
assert.ok(rendered.text.includes("validated"), "header marks the diagram as validated");

const renderedError = tool.renderResult(
	{ content: [{ type: "text", text: "unused" }], details: { error: "Parse error at line 2", attempts: 4 } },
	{},
	theme,
	{},
);
assert.ok(renderedError.text.includes("failed after 4"), "error result renders the attempt count");

const renderedEscape = tool.renderResult(
	{ content: [{ type: "text", text: "unused" }], details: { escape: "needs a coordinate plot", attempts: 1 } },
	{},
	theme,
	{},
);
assert.ok(renderedEscape.text.includes("not expressible"), "escape result renders the reason");

const renderedPlain = tool.renderResult({ content: [{ type: "text", text: "plain text" }], details: undefined }, {}, theme, {});
assert.equal(renderedPlain.text, "plain text", "no details falls back to content text");

rmSync(tempRoot, { recursive: true, force: true });
console.log("mermaid.test.mjs: all assertions passed");
