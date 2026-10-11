import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const { extractMermaidSource, buildAttemptPrompt, runMmdflux } = mermaidModule;
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
assert.equal(extractMermaidSource("```mmd\nflowchart TD\n  A --> B\n```"), "flowchart TD\n  A --> B", "should accept the mmd fence tag");
assert.equal(
	extractMermaidSource("flowchart TD\n  A[Root] --> Z[Goal]"),
	"flowchart TD\n  A[Root] --> Z[Goal]",
	"should accept a bare diagram block",
);
assert.equal(extractMeraldiSourceGuard("no diagram here at all"), null, "prose without a diagram returns null");
function extractMeraldiSourceGuard(raw) {
	// Wrapper so a thrown regression reads as a failure, not a test crash.
	try {
		return extractMermaidSource(raw);
	} catch {
		return "threw";
	}
}
assert.equal(extractMermaidSource("```\nflowchart TD\n  A --> B\n```"), null, "an untagged fence is not accepted as mermaid");

// ── buildAttemptPrompt (pure) ─────────────────────────────────────────────────

const first = buildAttemptPrompt("Type: flowchart TD. Nodes: A, B. Edge: A --> B.");
assert.ok(first.includes("flowchart TD"), "prompt carries the spec");
assert.ok(!first.includes("FAILED"), "first attempt has no failure feedback");

const retry = buildAttemptPrompt("spec text", { source: "flowchart TD\n  A -->", error: "Parse error at line 2" });
assert.ok(retry.includes("FAILED"), "retry prompt names the failure");
assert.ok(retry.includes("Parse error at line 2"), "retry prompt carries the parser error");
assert.ok(retry.includes("A -->"), "retry prompt carries the previous source");

// ── runMmdflux against the real binary (skipped when absent) ──────────────────

if (haveMmdflux) {
	const ok = await runMmdflux("flowchart TD\n  A[Root] --> Z[Goal]");
	assert.ok(ok.ok, `valid diagram should pass: ${JSON.stringify(ok).slice(0, 200)}`);
	assert.ok(ok.art.includes("Root"), "valid diagram renders node labels as art");

	const bad = await runMmdflux("flowchart TD\n  A -->");
	assert.ok(!bad.ok, "invalid diagram should fail");
	assert.ok(/parse error|error/i.test(bad.error), `failure should carry a parse error: ${bad.error.slice(0, 120)}`);
} else {
	console.log("note: mmdflux not found; skipping integration checks");
}

// ── execute paths with a fake model registry ─────────────────────────────────

const fakeCtx = (replies) => {
	let calls = 0;
	return {
		model: { id: "test-model" },
		modelRegistry: {
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
};

// No mermaid in the replies → isError with the last error, usage summed.
const failing = await tool.execute(
	"id-1",
	{ spec: "a diagram of the build pipeline", maxAttempts: 2 },
	undefined,
	() => {},
	fakeCtx(["I cannot draw that.", "Still no diagram."]),
);
assert.equal(failing.isError, true, "all-bad replies should error");
assert.ok(failing.details.attempts >= 2, "details record the attempt count");
assert.equal(failing.details.error, "model returned no mermaid block");
assert.equal(failing.usage.inputTokens, 20, "nested usage is summed");
assert.equal(failing.usage.outputTokens, 10, "nested usage is summed");

// Valid fence → success result whose content carries the fence verbatim.
if (haveMmdflux) {
	const succeeding = await tool.execute(
		"id-2",
		{ spec: "Type: flowchart TD. Nodes: Root, Goal. Edge: Root --> Goal." },
		undefined,
		() => {},
		fakeCtx(["```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```"]),
	);
	assert.ok(!succeeding.isError, `valid reply should succeed: ${JSON.stringify(succeeding.content).slice(0, 200)}`);
	assert.ok(textOf(succeeding).includes("```mermaid\nflowchart TD\n  R[Root] --> Z[Goal]\n```"), "content embeds the validated fence");
	assert.ok(succeeding.details.art.includes("Root"), "details carry the rendered art");
	assert.equal(succeeding.details.attempts, 1);
}

// ── renderResult ─────────────────────────────────────────────────────────────

const theme = { fg: (_name, s) => s };
const rendered = tool.renderResult(
	{ content: [{ type: "text", text: "unused" }], details: { art: "┌──────┐\n│ Root │", attempts: 1, title: "Flow" } },
	{},
	theme,
	{},
);
assert.ok(rendered.text.includes("Root"), "art renders in the result row");
assert.ok(rendered.text.includes("Flow"), "title renders in the header");

const renderedError = tool.renderResult(
	{ content: [{ type: "text", text: "unused" }], details: { error: "Parse error at line 2", attempts: 4 } },
	{},
	theme,
	{},
);
assert.ok(renderedError.text.includes("failed after 4"), "error result renders the attempt count");

const renderedPlain = tool.renderResult({ content: [{ type: "text", text: "plain text" }], details: undefined }, {}, theme, {});
assert.equal(renderedPlain.text, "plain text", "no details falls back to content text");

rmSync(tempRoot, { recursive: true, force: true });
console.log("mermaid.test.mjs: all assertions passed");
