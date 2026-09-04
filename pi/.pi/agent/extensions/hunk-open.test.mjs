import assert from "node:assert/strict";
import {
	hunkPaneCommand,
	isWatchedHunkProcess,
	openHunkWithHost,
} from "./hunk-open-core.mjs";
import { registerHunkReviewCommand } from "./interactive-subagents/pi-extension/subagents/hunk-review-command.mjs";

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

assert.equal(
	isWatchedHunkProcess({ name: "hunk", argv: ["hunk", "diff", "--watch"] }),
	true,
);
assert.equal(
	isWatchedHunkProcess({ name: "hunk", argv: ["hunk", "show", "HEAD"] }),
	false,
);
assert.equal(
	isWatchedHunkProcess({ name: "hunk", argv: ["hunk", "diff"] }),
	false,
);
assert.deepEqual(hunkPaneCommand("pane-1", ["diff", "--watch"]), [
	"sh",
	"-c",
	'hunk "$@"; herdr pane close "$0"',
	"pane-1",
	"diff",
	"--watch",
]);

const launchHost = fakeHost();
assert.deepEqual(await openHunkWithHost("/repo", launchHost), {
	message: "Opened Hunk in pane hunk-pane.",
	launched: true,
});
assert.deepEqual(launchHost.calls, [["launch", "/repo", ["diff", "--watch"]]]);

const focusHost = fakeHost({
	findHunkPane: () => ({ status: "found", paneId: "existing" }),
});
assert.deepEqual(await openHunkWithHost("/repo", focusHost), {
	message: "Focused existing Hunk pane (existing).",
	launched: false,
});
assert.deepEqual(focusHost.calls, [["focus", "existing", "parent"]]);

const blockedFocusHost = fakeHost({
	findHunkPane: () => ({ status: "found", paneId: "existing" }),
	focusPane: (...args) => {
		blockedFocusHost.calls.push(["focus", ...args]);
		return false;
	},
});
assert.deepEqual(await openHunkWithHost("/repo", blockedFocusHost), {
	message: "Opened Hunk in pane hunk-pane.",
	launched: true,
});
assert.deepEqual(blockedFocusHost.calls, [
	["focus", "existing", "parent"],
	["launch", "/repo", ["diff", "--watch"]],
]);

const fallbackHost = fakeHost({
	currentPane: () => null,
	tmuxOpen: (_cwd, args) => args[0] === "diff",
});
assert.deepEqual(await openHunkWithHost("/repo", fallbackHost), {
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

console.log("Hunk open and review behavior passed");
