// Pins the /no-slash-space rule against the real installed provider: a bare
// command completion drops the trailing space, argument completions keep
// their spacing, and text that follows the completion is untouched.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

const jiti = createJiti(import.meta.url);
let wrapped;
const ui = {
	addAutocompleteProvider(factory) {
		wrapped = factory(builtin());
	},
};
const commands = [
	{ name: "help", description: "Show help" },
	{ name: "model", description: "Switch model", getArgumentCompletions: () => [{ value: "gpt-6", label: "gpt-6" }] },
];

function builtin() {
	return new CombinedAutocompleteProvider(commands, process.cwd());
}

jiti("./no-slash-space.ts").default({ ui });

const apply = (lines, cursorLine, cursorCol, item, prefix) =>
	wrapped.applyCompletion(lines, cursorLine, cursorCol, item, prefix);

// The installed provider adds the space. The wrapper removes it.
assert.equal(builtin().applyCompletion(["/he"], 0, 3, { value: "help", label: "help" }, "/he").lines[0], "/help ");

{
	const result = apply(["/he"], 0, 3, { value: "help", label: "help" }, "/he");
	assert.equal(result.lines[0], "/help", "bare command completion drops the trailing space");
	assert.equal(result.cursorCol, 5, "cursor sits after the command name");
}

{
	// Text after the cursor: the wrapper matches no bare-command pattern, so
	// the built-in result stands unchanged.
	const args = [["/he world"], 0, 3, { value: "help", label: "help" }, "/he"];
	assert.deepEqual(apply(...args), builtin().applyCompletion(...args), "following text is untouched");
}

{
	// Argument completion: prefix comes after the command space, so the
	// wrapper never touches it.
	const result = apply(["/model gp"], 0, 9, { value: "gpt-6", label: "gpt-6" }, "gp");
	assert.equal(result.lines[0], "/model gpt-6", "argument completion is unchanged");
	assert.equal(result.cursorCol, 12);
}

// Delegation only: whatever the built-in provider decides is passed through.
assert.equal(
	wrapped.shouldTriggerFileCompletion(["/model "], 0, 7),
	builtin().shouldTriggerFileCompletion(["/model "], 0, 7),
	"file completion decision is delegated",
);

console.log("no-slash-space: ok");
