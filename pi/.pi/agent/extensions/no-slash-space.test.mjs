// Pins the /no-slash-space rules against the real installed provider: a bare
// command completion drops the trailing space, a slash inside a word opens no
// picker, and real path tokens still complete.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

const PI_TUI = join(
	process.env.HOME ?? "",
	".pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-tui/dist/autocomplete.js",
);
const { CombinedAutocompleteProvider } = await import(PI_TUI);

const root = mkdtempSync(join(tmpdir(), "no-slash-space-"));
writeFileSync(join(root, "alpha.txt"), "x\n");

try {
	const commands = [
		{ name: "help", description: "Show help" },
		{ name: "model", description: "Switch model", getArgumentCompletions: () => [{ value: "gpt-6", label: "gpt-6" }] },
	];
	const builtin = () => new CombinedAutocompleteProvider(commands, root);

	const handlers = new Map();
	let wrapped;
	const jiti = createJiti(import.meta.url);
	const extension = jiti("./no-slash-space.ts");
	extension.default({ on: (event, handler) => handlers.set(event, handler) });

	const ctx = { ui: { addAutocompleteProvider: (factory) => (wrapped = factory(builtin())) } };
	const start = handlers.get("session_start");
	assert.ok(start, "the wrapper registers from session_start, where ctx.ui exists");
	start({}, ctx);
	assert.ok(wrapped, "the provider is wrapped");
	start({}, ctx); // restart must not stack a second wrapper

	// --- the real provider, for contrast ---
	assert.equal(builtin().applyCompletion(["/he"], 0, 3, { value: "help", label: "help" }, "/he").lines[0], "/help ");

	// --- trailing space is dropped ---
	{
		const r = wrapped.applyCompletion(["/he"], 0, 3, { value: "help", label: "help" }, "/he");
		assert.equal(r.lines[0], "/help");
		assert.equal(r.cursorCol, 5);
	}
	{
		// Text after the cursor: no bare-command match, so the result stands.
		const args = [["/he world"], 0, 3, { value: "help", label: "help" }, "/he"];
		assert.deepEqual(wrapped.applyCompletion(...args), builtin().applyCompletion(...args));
	}
	{
		const r = wrapped.applyCompletion(["/model gp"], 0, 9, { value: "gpt-6", label: "gpt-6" }, "gp");
		assert.equal(r.lines[0], "/model gpt-6", "argument completion is unchanged");
	}

	// --- prose slashes stay quiet ---
	const quiet = async (line) => wrapped.getSuggestions([line], 0, line.length, { signal: new AbortController().signal });
	assert.equal(await quiet("and/or"), null, "a prose slash opens no picker");
	assert.equal(await quiet("TCP/IP"), null);
	assert.equal(await quiet("read src/index.ts"), null, "bare relative tokens stay prose");

	// --- real path tokens still complete ---
	const afterDot = await wrapped.getSuggestions(["./al"], 0, 4, { signal: new AbortController().signal });
	assert.ok(afterDot?.items.some((item) => item.value.includes("alpha.txt")), "./ paths complete");
	const forced = await wrapped.getSuggestions(["and/or"], 0, 7, {
		signal: new AbortController().signal,
		force: true,
	});
	assert.ok(forced !== undefined, "explicit Tab still reaches the provider");

	console.log("no-slash-space: ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
