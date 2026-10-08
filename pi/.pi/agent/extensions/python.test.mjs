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
	const handlers = new Map();
	jiti("./python.ts").default({
		registerTool(value) { tool = value; },
		on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event); },
	});
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

	// tool_call guard: bash-wrapped inline Python is blocked with a
	// corrective reason; everything else passes untouched.
	const guard = handlers.get("tool_call");
	assert.ok(guard, "the extension registers a tool_call handler");
	const blocked = (command) => guard({ toolName: "bash", input: { command } });
	const mustBlock = [
		["heredoc", "python3 - <<'EOF'\nimport os\nprint(os.getcwd())\nEOF"],
		["unquoted heredoc", "python3 - <<EOF\nprint(1)\nEOF"],
		["heredoc without the dash", "python <<EOF\nprint(1)\nEOF"],
		["one-liner", "python3 -c 'import json; print(json.dumps({}))'"],
		["uv run heredoc", "uv run python - <<EOF\nprint(1)\nEOF"],
		["env-prefixed heredoc", "PYTHONWARNINGS=ignore python3 - <<EOF\nprint(1)\nEOF"],
		["titled heredoc", "# parse the session log for nested bash calls\npython3 - <<EOF\nprint(1)\nEOF"],
		["versioned interpreter", "python3.11 - <<EOF\nprint(1)\nEOF"],
		["flagged stdin", "python3 -B -u - <<EOF\nprint(1)\nEOF"],
	];
	for (const [label, command] of mustBlock) {
		const outcome = blocked(command);
		assert.equal(outcome?.block, true, `${label}: blocked`);
		assert.match(outcome?.reason ?? "", /python tool/, `${label}: the reason names the python tool`);
	}
	const mustPass = [
		["script file", "python3 scripts/analyze.py --flag"],
		["module run", "python3 -m http.server"],
		["chained after cd", "cd /tmp && python3 - <<EOF\nprint(1)\nEOF"],
		["piped stdin", "echo '{\"a\":1}' | python3 -c 'import json,sys; print(json.load(sys.stdin))'"],
		["plain shell", "grep -rn renderCall dist/core | head -5"],
		["install command", "pip install requests"],
	];
	for (const [label, command] of mustPass) {
		assert.equal(blocked(command), undefined, `${label}: not blocked`);
	}
	assert.equal(guard({ toolName: "read", input: { path: "x" } }), undefined, "non-bash calls pass untouched");
} finally {
	rmSync(root, { recursive: true, force: true });
}
