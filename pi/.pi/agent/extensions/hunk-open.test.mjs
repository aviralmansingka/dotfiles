import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	openHunkWithHost,
	parseHunkArgs,
} from "./hunk-open-core.mjs";
import { registerHunkReviewCommand } from "./interactive-subagents/pi-extension/subagents/hunk-review-command.mjs";

function frontmatter(path) {
	const text = readFileSync(new URL(path, import.meta.url), "utf8");
	const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
	assert.ok(block, `${path} must have frontmatter`);
	return Object.fromEntries(
		block.split("\n").map((line) => {
			const separator = line.indexOf(":");
			return [line.slice(0, separator), line.slice(separator + 1).trim()];
		}),
	);
}

function fakeHost(overrides = {}) {
	const calls = [];
	return {
		calls,
		currentPane: () => ({ pane_id: "parent", tab_id: "tab" }),
		findHunkPane: () => ({ status: "absent" }),
		focusPane: (...args) => {
			calls.push(["focus", ...args]);
			return true;
		},
		launchPane: (...args) => {
			calls.push(["launch", ...args]);
			return "hunk-pane";
		},
		tmuxOpen: (...args) => {
			calls.push(["tmux", ...args]);
			return false;
		},
		manualCommand: () => "manual fallback",
		...overrides,
	};
}

assert.deepEqual(parseHunkArgs('show "HEAD~2" -- docs/my\\ file.md'), [
	"show",
	"HEAD~2",
	"--",
	"docs/my file.md",
]);

const launchHost = fakeHost();
assert.deepEqual(await openHunkWithHost("/repo", [], launchHost), {
	message: "Opened Hunk in pane hunk-pane.",
	launched: true,
});
assert.deepEqual(launchHost.calls, [["launch", "/repo", ["diff", "--watch"]]]);

const focusHost = fakeHost({
	findHunkPane: () => ({ status: "found", paneId: "existing" }),
});
assert.deepEqual(await openHunkWithHost("/repo", ["show", "HEAD"], focusHost), {
	message: "Focused existing Hunk pane (existing).",
	launched: false,
});
assert.deepEqual(focusHost.calls, [["focus", "existing", "parent"]]);

const fallbackHost = fakeHost({
	currentPane: () => null,
	tmuxOpen: (_cwd, args) => args[0] === "diff",
});
assert.deepEqual(await openHunkWithHost("/repo", [], fallbackHost), {
	message: "Opened Hunk in a tmux split.",
	launched: true,
});

let reviewCommand;
let reviewParams;
registerHunkReviewCommand(
	{
		registerCommand(name, definition) {
			assert.equal(name, "hunk-review");
			reviewCommand = definition;
		},
	},
	async (params) => {
		reviewParams = params;
		return {
			content: [{ type: "text", text: "started" }],
			details: { status: "started", name: params.agent },
		};
	},
);
assert.ok(reviewCommand);
const notifications = [];
const commandContext = {
	cwd: "/repo",
	ui: { notify: (...args) => notifications.push(args) },
};
await reviewCommand.handler("correctness and regressions", commandContext);
assert.equal(reviewParams.agent, "hunk-review");
assert.equal(reviewParams.cwd, "/repo");
assert.match(reviewParams.task, /Review focus: correctness and regressions/);
assert.deepEqual(notifications, [["Hunk reviewer \"hunk-review\" launched.", "info"]]);

const reviewer = frontmatter("./interactive-subagents/agents/hunk-review.md");
assert.equal(reviewer.name, "hunk-review");
assert.equal(reviewer.skills, "hunk-review");
assert.equal(reviewer["auto-exit"], "true");
assert.equal(reviewer.tools, "read, grep, find, ls, safe_bash");

const professor = frontmatter("./interactive-subagents/agents/professor.md");
assert.ok(professor.tools.split(", ").includes("hunk_open"));
assert.deepEqual(professor.subagent_agents.split(", "), [
	"researcher",
	"hunk-review",
]);

console.log("Hunk open and review behavior passed");
