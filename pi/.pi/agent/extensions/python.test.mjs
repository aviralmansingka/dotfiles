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
const root = mkdtempSync(join(tmpdir(), "python-tool-test-"));
try {
	// typebox stub: parameter schemas only need to load, not validate here.
	const typebox = join(root, "typebox.cjs");
	writeFileSync(typebox, "exports.Type = new Proxy({}, { get: () => (value) => value });\n");
	const agent = join(root, "agent.cjs");
	writeFileSync(agent, "exports.copyToClipboard = () => {};\n");
	const jiti = createJiti(import.meta.url, { alias: { typebox, "@earendil-works/pi-coding-agent": agent } });
	let tool;
	jiti("./python.ts").default({ registerTool(value) { tool = value; } });
	assert.equal(tool.name, "python");
	assert.equal(tool.label, "python");
	assert.ok(tool.parameters, "the tool declares a parameter schema");
	assert.ok(tool.description.includes("uv run python"), "the description states the uv execution path");
	assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true }, "annotations stay honest: arbitrary code execution");

	const run = (params, signal) => tool.execute("t", params, signal, undefined, { cwd: root });
	const finish = async (promise) => {
		const outcome = await promise;
		assert.ok(Array.isArray(outcome.content) && outcome.content[0].type === "text");
		return { text: outcome.content[0].text, isError: outcome.isError === true, details: outcome.details ?? {} };
	};

	{
		// stdout round-trip and cwd plumbing.
		const { text, isError, details } = await finish(run({ code: "import os\nprint(os.getcwd())" }));
		assert.equal(isError, false);
		assert.equal(details.exitCode, 0);
		assert.equal(text, root);
		assert.ok(details.durationMs !== undefined, "durationMs lands in details for the exit banner");
	}

	{
		// stderr stays separate; nonzero exit marks the result as error.
		const { text, isError, details } = await finish(run({
			code: 'import sys\nprint("out")\nprint("err", file=sys.stderr)\nsys.exit(3)',
		}));
		assert.equal(isError, true);
		assert.equal(details.exitCode, 3);
		assert.equal(details.stdout, "out\n");
		assert.equal(details.stderr, "err\n");
		assert.match(text, /^out\nstderr:\nerr$/);
	}

	{
		// The timeout kills the child instead of hanging the session.
		const startedAt = Date.now();
		const { text, isError, details } = await finish(run({ code: "import time\ntime.sleep(30)", timeoutMs: 1000 }));
		assert.equal(isError, true);
		assert.equal(details.timedOut, true);
		assert.notEqual(details.exitCode, 0, "a killed child never reports a clean exit (uv forwards 128+signal)");
		assert.match(text, /Timed out after 1s/);
		assert.ok(Date.now() - startedAt < 10_000, "the kill fires near the timeout, not at sleep's end");
	}

	{
		// The abort signal kills the child mid-run.
		const controller = new AbortController();
		const pending = run({ code: "import time\ntime.sleep(30)" }, controller.signal);
		setTimeout(() => controller.abort(), 200);
		const { text, isError, details } = await finish(pending);
		assert.equal(isError, true);
		assert.equal(details.aborted, true);
		assert.match(text, /aborted/);
	}

	{
		// Empty code never spawns a child.
		const { text, isError } = await finish(run({ code: "   " }));
		assert.equal(isError, true);
		assert.match(text, /non-empty/);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
