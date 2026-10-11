// Regression harness for the mermaid v2 tool. Loads mermaid.ts through jiti
// with the REAL mmdflux binary and the REAL grok-mermaid renderer (resolved
// from the pi install), then runs one of two modes:
//
//   node mermaid.corpus.mjs gates <fences.json>
//     Gate check on historical inline fences: for each fence, run gate 1
//     (mmdflux strict parse) and gate 3 (grok-mermaid crash / warnings /
//     pane width). Reports which fences the v2 gates would have rejected —
//     the old world shipped these. Rejections here are the harness working,
//     so the exit code is 0 either way.
//
//   node mermaid.corpus.mjs e2e <cases.json>
//     Full pipeline on structured param cases: [{ name, params }] through
//     tool.execute (emit → parse → structure diff → render gates). Every
//     case must pass; any error exits 1.
//
// PI_MERMAID_WIDTH sets the pane width for both modes (default 100).

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const installRoot = join(homedir(), ".pi/agent/install");
const versionFile = join(installRoot, "current-version");
const release = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "1.1.0";
const jitiPath = [
	process.env.JITI_PATH,
	join(installRoot, "releases", release, "node_modules/jiti/lib/jiti.cjs"),
].find((p) => p && existsSync(p));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
// Usage check first so the harness never touches binaries for a bad
// invocation; binary checks below skip cleanly (exit 2, message, no stack)
// when the host lacks them.
const [mode, corpusPath] = process.argv.slice(2);
if (!mode || !corpusPath) {
	console.error("usage: node mermaid.corpus.mjs <gates|e2e> <corpus.json>");
	process.exit(2);
}
const grokReal = join(installRoot, "releases", release, "node_modules/grok-mermaid/dist/index.js");
if (!existsSync(grokReal)) {
	console.error(`corpus: real grok-mermaid not found at ${grokReal}; this is a local, manual gate — run it on a host with the chat renderer installed`);
	process.exit(2);
}

const { createJiti } = require(jitiPath);
const tempRoot = mkdtempSync(join(tmpdir(), "mermaid-corpus-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
const stubTypes = join(tempRoot, "types.cjs");
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(stubTui, "class Text { constructor(t) { this.text = t; } }\nexports.Text = Text;\n");
writeFileSync(stubTypes, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-tui": stubTui,
		typebox: stubTypes,
		"grok-mermaid": grokReal, // the chat's actual renderer, not a stub
	},
});
const mermaidModule = jiti("./mermaid.ts");
const { runMmdflux, renderWithGrok, paneWidth } = mermaidModule;
const registered = [];
const displayMessages = [];
mermaidModule.default({
	registerTool(def) { registered.push(def); },
	sendMessage(message) { displayMessages.push(message); },
	registerMessageRenderer() {},
});
const tool = registered[0];

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const pane = paneWidth();
const haveMmdflux = existsSync(join(homedir(), ".local", "bin", "mmdflux")) || !!process.env.PI_MERMAID_MMDFLUX;
if (!haveMmdflux) {
	console.error("mmdflux binary not found; set PI_MERMAID_MMDFLUX");
	process.exit(2);
}

if (mode === "gates") {
	const verdicts = { render: 0, parse: 0, crash: 0, warnings: 0, width: 0 };
	const rejects = [];
	for (const [i, fence] of corpus.entries()) {
		const parse = await runMmdflux(fence, "mmds");
		if (!parse.ok) {
			verdicts.parse++;
			rejects.push([i, "parse", parse.error.split("\n")[0].slice(0, 90)]);
			continue;
		}
		const grok = await renderWithGrok(fence);
		if (!grok.ok) { verdicts.crash++; rejects.push([i, "crash", grok.error.slice(0, 90)]); continue; }
		if (grok.warnings.length > 0) { verdicts.warnings++; rejects.push([i, "warnings", grok.warnings[0].slice(0, 90)]); continue; }
		if (grok.width > pane) { verdicts.width++; rejects.push([i, "width", `art ${grok.width} cols > pane ${pane}`]); continue; }
		verdicts.render++;
	}
	console.log(`gates mode: ${corpus.length} historical fences, pane=${pane} cols`);
	console.log(`  would render in chat: ${verdicts.render}`);
	console.log(`  REJECTED by v2 gates: parse=${verdicts.parse} crash=${verdicts.crash} warnings=${verdicts.warnings} width=${verdicts.width}`);
	console.log(`  total rejected: ${corpus.length - verdicts.render} (${((corpus.length - verdicts.render) / corpus.length * 100).toFixed(1)}%) — these are the old world's shipped failures`);
	for (const [i, kind, why] of rejects) console.log(`    #${i} [${kind}] ${why}`);
	rmSync(tempRoot, { recursive: true, force: true });
	process.exit(0);
}

if (mode === "e2e") {
	let failed = 0;
	const times = [];
	for (const { name, params, expect } of corpus) {
		const t0 = Date.now();
		const result = await tool.execute("corpus", params, undefined, () => {}, {});
		const ms = Date.now() - t0;
		times.push(ms);
		if (expect === "reject" || expect === "either") {
			// Faithful params of an over-wide historical diagram. "reject": even
			// as TD it must not ship — a width error naming both numbers.
			// "either": an LR original that may legitimately recover via the
			// local TD re-emit; success or width rejection are both correct.
			const widthRejected = result.isError && /art is \d+ cols/.test(result.details?.error ?? "");
			if (widthRejected) {
				console.log(`pass ${name} (${ms} ms, expected width rejection)`);
			} else if (expect === "either" && !result.isError) {
				console.log(`pass ${name} (${ms} ms, recovered via TD re-emit, ${result.details.width}/${pane} cols)`);
			} else {
				failed++;
				console.log(`FAIL ${name} (${ms} ms): expected width rejection or TD recovery, got ${result.isError ? result.details?.error : "success"}`);
			}
			continue;
		}
		if (result.isError) {
			failed++;
			console.log(`FAIL ${name} (${ms} ms): ${result.details?.error ?? "?"}`);
		} else {
			console.log(`pass ${name} (${ms} ms, ${result.details.width}/${pane} cols, ${result.details.path})`);
		}
	}
	const total = times.reduce((a, b) => a + b, 0);
	console.log(`e2e mode: ${corpus.length} cases, ${corpus.length - failed} passed, ${failed} failed; total ${total} ms, mean ${(total / Math.max(1, times.length)).toFixed(0)} ms, max ${Math.max(...times, 0)} ms`);
	console.log(`display rows emitted: ${displayMessages.length} (one custom-message transcript row per delivered diagram)`);
	rmSync(tempRoot, { recursive: true, force: true });
	process.exit(failed ? 1 : 0);
}

console.error(`unknown mode ${mode}`);
process.exit(2);
