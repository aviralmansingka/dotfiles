import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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
const paneCommand = hunkPaneCommand("pane '$(printf injected)'", [
	"diff",
	"--watch",
	"argument with spaces",
	"$(printf injected)",
	"semi;colon",
]);
const commandResult = spawnSync(
	"sh",
	[
		"-c",
		`hunk() { printf 'hunk'; printf '\\n%s' "$@"; }
herdr() { printf '\\nherdr'; printf '\\n%s' "$@"; }
${paneCommand}`,
	],
	{ encoding: "utf8" },
);
assert.equal(commandResult.status, 0, commandResult.stderr);
assert.equal(
	commandResult.stdout,
	"hunk\ndiff\n--watch\nargument with spaces\n$(printf injected)\nsemi;colon\nherdr\npane\nclose\npane '$(printf injected)'",
);

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

// Render the registered tool with peer stubs; no live Herdr/editor IO.
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
const tempRoot = mkdtempSync(join(tmpdir(), "hunk-open-test-"));
const stubAgent = join(tempRoot, "agent.cjs");
const stubAi = join(tempRoot, "ai.cjs");
const stubTui = join(tempRoot, "tui.cjs");
writeFileSync(stubAgent, "exports.defineTool = (tool) => tool;\n");
writeFileSync(stubAi, "exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n");
writeFileSync(stubTui, `
exports.truncateToWidth = (text, width) => text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + "…";
exports.wrapTextWithAnsi = (text, width) => {
	const lines = [];
	for (let start = 0; start < text.length; start += width) lines.push(text.slice(start, start + width));
	return lines.length ? lines : [""];
};
`);
const jiti = createJiti(import.meta.url, { alias: {
	"@earendil-works/pi-coding-agent": stubAgent,
	"@earendil-works/pi-ai": stubAi,
	"@earendil-works/pi-tui": stubTui,
} });
try {
	let tool;
	jiti("./hunk-open.ts").default({ registerTool: (definition) => { tool = definition; }, registerCommand() {} });
	assert.equal(tool.name, "hunk_open");
	const theme = { fg: (_token, text) => text, bold: (text) => text };
	const tagged = { fg: (token, text) => `<${token}>${text}</${token}>`, bold: (text) => `<b>${text}</b>` };
	const options = { expanded: true, isPartial: false };
	const context = { args: { cwd: "/repo" }, cwd: "/fallback", isError: false };
	const opened = { content: [{ type: "text", text: "Opened Hunk in pane w5C:p2." }], details: { message: "Opened Hunk in pane w5C:p2.", launched: true } };
	const view = tool.renderResult(opened, options, theme, context).render(100).join("\n");
	assert.match(view, /^ ├─ ▣ {2}hunk · \/repo/);
	assert.match(view, / │  review canvas only — no reviewer launched/);
	assert.match(view, / └─ ✓ canvas open$/);
	const styled = tool.renderResult(opened, options, tagged, context).render(500).join("\n");
	assert.ok(styled.includes("<dim> ├─ ▣  hunk · "));
	assert.ok(styled.includes("<text><b>/repo</b></text>"));
	assert.ok(styled.includes("<dim> │  review canvas only — no reviewer launched</dim>"));
	assert.ok(styled.includes("<success>✓ canvas open</success>"));
	assert.match(tool.renderResult(opened, options, theme, { ...context, args: {} }).render(100)[0], /\/fallback$/);
	const focused = { content: [{ type: "text", text: "Focused existing Hunk pane (existing)." }], details: { launched: false } };
	assert.match(tool.renderResult(focused, options, theme, context).render(100).at(-1), /✓ canvas open$/);
	for (const [message, isError] of [["Could not open Hunk automatically. Run: hunk diff --watch", false], ["Hunk unavailable", true]]) {
		const failed = { content: [{ type: "text", text: `${message}\nHidden second line` }], details: { launched: false } };
		const errorView = tool.renderResult(failed, options, tagged, { ...context, isError }).render(500).join("\n");
		assert.ok(errorView.includes(`<error>✗ ${message}</error>`));
		assert.ok(!errorView.includes("Hidden second line"));
		assert.ok(!errorView.includes("✓ canvas open"));
	}
	const wrapped = tool.renderResult(opened, options, theme, context).render(24);
	assert.ok(wrapped.length > 3, "canvas note wraps");
	assert.ok(wrapped.every((line) => line.length <= 24));
	for (const width of [1, 4, 12]) {
		assert.ok(tool.renderResult(opened, options, theme, context).render(width).every((line) => line.length <= width));
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
console.log("Hunk open and review behavior passed");
