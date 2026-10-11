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
	assert.equal(typeof tool.promptSnippet, "string", "a prompt snippet is registered");
	assert.ok(tool.promptSnippet.length > 0, "the prompt snippet is not empty");
	assert.ok(Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length > 0, "prompt guidelines are registered");

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
		assert.equal(details.timedOut, undefined, "a clean run does not set timedOut");
		assert.equal(details.aborted, undefined, "a clean run does not set aborted");
		assert.equal(details.truncated, undefined, "a clean run does not set truncated");
	}

	{
		// Output above the 256 KiB cap is cut and flagged, never unbounded.
		const CAP = 256 * 1024;
		const { text, isError, details } = await finish(run({ code: `print("x" * ${CAP + 40 * 1024})` }));
		assert.equal(isError, false);
		assert.equal(details.exitCode, 0);
		assert.equal(details.truncated, true, "oversized output sets the truncated flag");
		assert.equal(details.stdout.length, CAP, "stdout is cut at the 256 KiB cap");
		assert.ok(text.length >= CAP, "the text result carries the capped stdout");
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
		// timeoutMs below the 1 s floor clamps up to the floor, not down.
		const { text, isError, details } = await finish(run({ code: "import time\ntime.sleep(30)", timeoutMs: 50 }));
		assert.equal(isError, true);
		assert.equal(details.timedOut, true);
		assert.match(text, /Timed out after 1s/, "a sub-floor timeout still waits the 1 s minimum");
	}

	{
		// A missing uv binary surfaces as a structured error, not a crash.
		const savedPath = process.env.PATH;
		process.env.PATH = "/nonexistent-python-tool-test";
		try {
			const { text, isError, details } = await finish(run({ code: "print(1)" }));
			assert.equal(isError, true);
			assert.match(text, /Could not run .uv run python./, "the error names the uv command");
			assert.match(text, /uv is installed/, "the error tells how to fix it");
			assert.equal(details.exitCode, undefined, "a failed spawn has no exit code");
			assert.equal(details.stdout, "");
			assert.equal(details.stderr, "");
		} finally {
			process.env.PATH = savedPath;
		}
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
		for (const code of ["", "   ", "\n\t"]) {
			const { text, isError, details } = await finish(run({ code }));
			assert.equal(isError, true);
			assert.match(text, /non-empty/);
			assert.equal(details.exitCode, undefined, "no child ran, so no exit code exists");
		}
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
		["dash-tagged heredoc", "python3 - <<-'EOF'\nprint(1)\nEOF"],
		["versioned one-liner", "python3.11 -c 'print(1)'"],
		["flagged one-liner", "python3 -u -c 'x = 1'"],
		["double-quoted one-liner", "python -c \"print('a && b')\""],
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
		["uv-run script file", "uv run python scripts/analyze.py --flag"],
		["uv-run module", "uv run python -m pytest"],
		["chain chars inside quotes stay one command", "bash -c 'echo start; python3 run.py'"],
	];
	for (const [label, command] of mustPass) {
		assert.equal(blocked(command), undefined, `${label}: not blocked`);
	}
	assert.equal(guard({ toolName: "read", input: { path: "x" } }), undefined, "non-bash calls pass untouched");
} finally {
	rmSync(root, { recursive: true, force: true });
}
