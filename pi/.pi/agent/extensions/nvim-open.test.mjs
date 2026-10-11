import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
const tempRoot = mkdtempSync(join(tmpdir(), "nvim-open-test-"));
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
// Fake herdr/nvim/tmux binaries go on PATH BEFORE the module import, so no
// openEditor path can ever reach a real multiplexer or editor (house rule).
const editorBin = join(tempRoot, "fakebin");
const editorCapture = join(tempRoot, "editor-calls");
mkdirSync(editorBin, { recursive: true });
writeFileSync(editorCapture, "");
writeFileSync(
	join(editorBin, "herdr"),
	`#!/bin/sh
if [ -n "$NVIM_TEST_CAPTURE" ]; then
	printf '%s\\n' "$@" >> "$NVIM_TEST_CAPTURE"
	printf '%s\\n' --call-- >> "$NVIM_TEST_CAPTURE"
fi
case "$1:$2" in
	pane:current)
		[ "$NVIM_TEST_NO_CURRENT" = 1 ] && exit 1
		printf '%s\\n' '{"result":{"pane":{"pane_id":"w7:p1","tab_id":"w7:t1","cwd":"/repo","workspace_id":"w7"}}}'
		;;
	pane:list)
		[ "$NVIM_TEST_PANES_FAIL" = 1 ] && exit 1
		cat "$NVIM_TEST_PANES_FILE"
		;;
	pane:process-info)
		if [ "$NVIM_TEST_PROC_FAIL" = 1 ]; then
			exit 1
		elif [ -f "$NVIM_TEST_PROCS_DIR/$4.json" ]; then
			cat "$NVIM_TEST_PROCS_DIR/$4.json"
		else
			printf '{"result":{"process_info":{"pane_id":"%s","foreground_processes":[]}}}' "$4"
		fi
		;;
	pane:split) printf '%s\\n' '{"result":{"pane":{"pane_id":"w7:p9"}}}' ;;
	pane:run) [ "$NVIM_TEST_RUN_FAIL" = 1 ] && exit 1; printf '%s\\n' '{"result":{}}' ;;
	pane:send-text) [ "$NVIM_TEST_SEND_FAIL" = 1 ] && exit 1; printf '%s\\n' '{"result":{}}' ;;
	pane:neighbor)
		if [ -f "$NVIM_TEST_NEIGHBORS_DIR/$6" ]; then
			printf '{"result":{"neighbor":{"neighbor_pane_id":"%s"}}}' "$(cat "$NVIM_TEST_NEIGHBORS_DIR/$6")"
		else
			printf '%s\\n' '{"result":{"neighbor":{"neighbor_pane_id":""}}}'
		fi
		;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
	{ mode: 0o755 },
);
writeFileSync(
	join(editorBin, "nvim"),
	`#!/bin/sh
if [ -n "$NVIM_TEST_CAPTURE" ]; then
	printf '%s\\n' "$@" >> "$NVIM_TEST_CAPTURE"
	printf '%s\\n' --call-- >> "$NVIM_TEST_CAPTURE"
fi
case "$3" in
	--remote-expr) [ "$NVIM_TEST_NVIM_DEAD" = 1 ] && exit 1 ;;
	--remote) [ "$NVIM_TEST_REMOTE_FAIL" = 1 ] && exit 1 ;;
esac
exit 0
`,
	{ mode: 0o755 },
);
writeFileSync(
	join(editorBin, "tmux"),
	`#!/bin/sh
if [ -n "$NVIM_TEST_CAPTURE" ]; then
	printf '%s\\n' "$@" >> "$NVIM_TEST_CAPTURE"
	printf '%s\\n' --call-- >> "$NVIM_TEST_CAPTURE"
fi
[ "$NVIM_TEST_TMUX_FAIL" = 1 ] && exit 1
exit 0
`,
	{ mode: 0o755 },
);
const savedOpenPath = process.env.PATH;
const savedXdgRuntime = process.env.XDG_RUNTIME_DIR;
process.env.NVIM_TEST_CAPTURE = editorCapture;
process.env.PATH = `${editorBin}:${savedOpenPath}`;
const nvimTestEnvKeys = [
	"NVIM_TEST_CAPTURE",
	"NVIM_TEST_NO_CURRENT",
	"NVIM_TEST_PANES_FAIL",
	"NVIM_TEST_PANES_FILE",
	"NVIM_TEST_PROC_FAIL",
	"NVIM_TEST_PROCS_DIR",
	"NVIM_TEST_NEIGHBORS_DIR",
	"NVIM_TEST_RUN_FAIL",
	"NVIM_TEST_SEND_FAIL",
	"NVIM_TEST_NVIM_DEAD",
	"NVIM_TEST_REMOTE_FAIL",
	"NVIM_TEST_TMUX_FAIL",
];
const clearNvimTestEnv = () => {
	for (const key of nvimTestEnvKeys) {
		if (key !== "NVIM_TEST_CAPTURE") delete process.env[key];
	}
};

const jiti = createJiti(import.meta.url, { alias: {
	"@earendil-works/pi-coding-agent": stubAgent,
	"@earendil-works/pi-ai": stubAi,
	"@earendil-works/pi-tui": stubTui,
} });

try {
	let tool;
	const nvimOpen = jiti("./nvim-open.ts");
	nvimOpen.default({ registerTool: (definition) => { tool = definition; }, registerCommand() {}, on: () => {} });
	assert.equal(tool.name, "nvim_open");
	const theme = { fg: (_token, text) => text, bold: (text) => text };
	const tagged = { fg: (token, text) => `<${token}>${text}</${token}>`, bold: (text) => `<b>${text}</b>` };
	const options = { expanded: true, isPartial: false };
	const context = { args: { cwd: "/repo" }, cwd: "/fallback", isError: false };
	// Actual sessions have content only, with no details.
	const result = { content: [{ type: "text", text: "Launched vim in a vertical split (pane w5G:p2) at /repo." }] };
	const view = tool.renderResult(result, options, theme, context).render(100).join("\n");
	assert.match(view, /^ ├─ ⌨ {2}nvim · \/repo\n └─ ✓ opened in editor pane$/);
	const styled = tool.renderResult(result, options, tagged, context).render(500).join("\n");
	assert.ok(styled.includes("<dim> ├─ ⌨  nvim · "));
	assert.ok(styled.includes("<text><b>/repo</b></text>"));
	assert.ok(styled.includes("<success>✓ opened in editor pane</success>"));
	assert.match(tool.renderResult(result, options, theme, { ...context, args: {} }).render(100)[0], /\/fallback$/);

	const files = ["src/one.ts", "docs/My Notes.md"];
	const fileContext = { ...context, args: { cwd: "/repo", files } };
	const listed = tool.renderResult(result, options, theme, fileContext).render(100).join("\n");
	assert.match(listed, /^ ├─ ⌨ {2}nvim · 2 files/);
	assert.match(listed, / │  src\/one.ts\n │  docs\/My Notes.md/);
	const styledFiles = tool.renderResult(result, options, tagged, fileContext).render(500).join("\n");
	assert.ok(styledFiles.includes("<dim> │  src/one.ts</dim>"));
	const longFile = "abcdefghij".repeat(6);
	const wrapped = tool.renderResult(result, options, theme, { ...context, args: { files: [longFile] } }).render(24);
	assert.match(wrapped[0], /1 file$/);
	assert.deepEqual(wrapped.slice(1, -1), Array(3).fill(" │  abcdefghijabcdefghij"));
	assert.ok(wrapped.every((line) => line.length <= 24));

	for (const message of ["Sent 1 file(s) to existing editor (pane w20:p4A).", "Focused existing editor pane (w20:p4A).", "Launched vim in a tmux split at /repo.", "Opened 2 file(s) in the herdr-nvim sidebar (tab w6V:t1).", "Focused the herdr-nvim sidebar (tab w6V:t1)."]) {
		assert.match(tool.renderResult({ content: [{ type: "text", text: message }] }, options, theme, context).render(100).at(-1), /✓ opened in editor pane$/);
	}
	for (const [message, isError] of [["Could not focus existing editor pane (w20:p4A).", false], ["Could not open files in the herdr-nvim sidebar (tab w6V:t1).", false], ["Could not focus the herdr-nvim sidebar (tab w6V:t1).", false], ["Editor unavailable", true]]) {
		const failed = { content: [{ type: "text", text: `${message}\nHidden second line` }] };
		const errorView = tool.renderResult(failed, options, tagged, { ...context, isError }).render(500).join("\n");
		assert.ok(errorView.includes(`<error>✗ ${message}</error>`));
		assert.ok(!errorView.includes("Hidden second line"));
		assert.ok(!errorView.includes("✓ opened"));
	}
	for (const width of [1, 4, 12]) {
		assert.ok(tool.renderResult(result, options, theme, fileContext).render(width).every((line) => line.length <= width));
	}

	// ── herdr-nvim daemon socket resolution (pure) ─────────────────────
	const runtimeDir = join(tempRoot, "xdg-run");
	process.env.XDG_RUNTIME_DIR = runtimeDir;
	assert.deepEqual(nvimOpen.sidebarSocketCandidates("w6V:t1"), [
		join(runtimeDir, "herdr-nvim", "w6V_t1.sock"),
		join(tmpdir(), "herdr-nvim", "w6V_t1.sock"),
	]);
	delete process.env.XDG_RUNTIME_DIR;
	assert.deepEqual(nvimOpen.sidebarSocketCandidates("w26:t2"), [
		join(tmpdir(), "herdr-nvim", "w26_t2.sock"),
	]);
	// No socket registered for this tab → null (registry dir may exist
	// with other tabs' daemons; only the exact tab key matches).
	assert.equal(nvimOpen.sidebarDaemonSocket("w99:t9"), null);

	// ── sidebar-pane process matcher (pure) ─────────────────────────────
	// Shapes recorded live from a visible herdr-nvim sidebar pane: the
	// `herdr-nvim sidebar` launcher before it execs, and the exec'd
	// `nvim --server <socket> --remote-ui` client — the steady state.
	const daemonSocket = join(tmpdir(), "herdr-nvim", "w6V_t1.sock");
	const remoteUi = {
		name: "nvim", pid: 4242,
		argv: ["/home/avirus/.local/share/bob/nightly/bin/nvim", "--server", daemonSocket, "--remote-ui"],
	};
	assert.equal(nvimOpen.isSidebarProcess(remoteUi, daemonSocket), true);
	const launcher = {
		name: "herdr-nvim", pid: 4243,
		argv: ["/plugins/github/chmarax.herdr-nvim-x/bin/herdr-nvim", "sidebar"],
	};
	assert.equal(nvimOpen.isSidebarProcess(launcher, daemonSocket), true);
	// name missing → fall back to argv[0], basename-matched.
	assert.equal(
		nvimOpen.isSidebarProcess({ name: "", pid: 4244, argv: ["/opt/bin/nvim", "--server", daemonSocket, "--remote-ui"] }, daemonSocket),
		true,
	);
	// A plain editor nvim (no --remote-ui) is not the sidebar.
	assert.equal(
		nvimOpen.isSidebarProcess({ name: "nvim", pid: 7, argv: ["/usr/bin/nvim", "src/main.rs"] }, daemonSocket),
		false,
	);
	// A remote-ui client on another tab's daemon socket is not this sidebar.
	assert.equal(
		nvimOpen.isSidebarProcess({ ...remoteUi, argv: ["/usr/bin/nvim", "--server", join(tmpdir(), "herdr-nvim", "w9_t9.sock"), "--remote-ui"] }, daemonSocket),
		false,
	);
	// The headless daemon itself (--listen, no --server/--remote-ui) is not a pane process.
	assert.equal(
		nvimOpen.isSidebarProcess({ name: "nvim", pid: 8, argv: ["/usr/bin/nvim", "--headless", "--listen", daemonSocket] }, daemonSocket),
		false,
	);

	// ── dotfiles worktree config detection (pure) ───────────────────
	const dotfilesRoot = join(tempRoot, "dotfiles");
	mkdirSync(join(dotfilesRoot, "nvim", ".config", "nvim"), { recursive: true });
	writeFileSync(join(dotfilesRoot, "nvim", ".config", "nvim", "init.lua"), "");
	assert.equal(
		nvimOpen.dotfilesConfigHome(join(dotfilesRoot, "nvim", ".config", "nvim", "lua")),
		join(dotfilesRoot, "nvim", ".config"),
	);
	const plainRoot = join(tempRoot, "plain");
	mkdirSync(plainRoot);
	assert.equal(nvimOpen.dotfilesConfigHome(plainRoot), null);

	// ── openEditor orchestration against the fake herdr/nvim/tmux bins ──────
	const repoCwd = join(tempRoot, "repo");
	mkdirSync(repoCwd);
	const readEditorCalls = () =>
		readFileSync(editorCapture, "utf8")
			.split("--call--\n")
			.filter(Boolean)
			.map((call) => call.trim().split("\n"));
	const paneJson = (paneId, processes) => ({
		result: { process_info: { pane_id: paneId, foreground_processes: processes } },
	});
	const stageHerdr = (name, { panes = [], procs = {}, neighbors = {} } = {}) => {
		const dir = join(tempRoot, name);
		const panesFile = join(dir, "panes.json");
		const procsDir = join(dir, "procs");
		const neighborsDir = join(dir, "neighbors");
		mkdirSync(procsDir, { recursive: true });
		mkdirSync(neighborsDir, { recursive: true });
		writeFileSync(panesFile, JSON.stringify({ result: { panes } }));
		for (const [paneId, processes] of Object.entries(procs)) {
			writeFileSync(join(procsDir, `${paneId}.json`), JSON.stringify(paneJson(paneId, processes)));
		}
		for (const [direction, neighborId] of Object.entries(neighbors)) {
			writeFileSync(join(neighborsDir, direction), neighborId);
		}
		process.env.NVIM_TEST_PANES_FILE = panesFile;
		process.env.NVIM_TEST_PROCS_DIR = procsDir;
		process.env.NVIM_TEST_NEIGHBORS_DIR = neighborsDir;
		return dir;
	};
	const basePanes = [
		{ pane_id: "w7:p1", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" },
		{ pane_id: "w9:p1", tab_id: "w9:t9", cwd: "/other", workspace_id: "w9" },
	];
	const editorProc = [{ name: "nvim", pid: 9, argv: ["nvim", "src/main.rs"] }];
	const runOpenEditor = async (files) => {
		const before = readEditorCalls().length;
		const result = await nvimOpen.openEditor(repoCwd, files);
		return { result, calls: readEditorCalls().slice(before) };
	};

	// A live sidebar daemon owns the tab: files open over its RPC socket and
	// the visible sidebar pane is focused — no split is launched.
	{
		clearNvimTestEnv();
		const xdgDir = join(tempRoot, "g1-xdg");
		mkdirSync(join(xdgDir, "herdr-nvim"), { recursive: true });
		const daemonSocket = join(xdgDir, "herdr-nvim", "w7_t1.sock");
		writeFileSync(daemonSocket, "");
		stageHerdr("g1", {
			panes: [...basePanes, { pane_id: "w7:p2", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" }],
			procs: {
				"w7:p2": [{
					name: "nvim", pid: 77,
					argv: ["/usr/bin/nvim", "--server", daemonSocket, "--remote-ui"],
				}],
		},
			neighbors: { right: "w7:p2" },
		});
		process.env.XDG_RUNTIME_DIR = xdgDir;
		const { result, calls } = await runOpenEditor(["src/one.ts", "docs/My Notes.md"]);
		assert.deepEqual(result, {
			message: "Opened 2 file(s) in the herdr-nvim sidebar (tab w7:t1).",
			ok: true,
			launched: false,
		});
		assert.deepEqual(calls[0], ["pane", "current"]);
		assert.deepEqual(calls[1], ["--server", daemonSocket, "--remote-expr", "1"]);
		assert.deepEqual(calls[2], ["--server", daemonSocket, "--remote", join(repoCwd, "src", "one.ts")]);
		assert.deepEqual(calls[3], ["--server", daemonSocket, "--remote", join(repoCwd, "docs", "My Notes.md")]);
		assert.deepEqual(calls[4], ["pane", "list"]);
		assert.deepEqual(calls[5], ["pane", "process-info", "--pane", "w7:p1"]);
		assert.deepEqual(calls[6], ["pane", "process-info", "--pane", "w7:p2"]);
		assert.deepEqual(calls[7], ["pane", "neighbor", "--pane", "w7:p1", "--direction", "right"]);
		assert.deepEqual(calls[8], ["pane", "focus", "--pane", "w7:p1", "--direction", "right"]);
		assert.equal(calls.some((call) => call[0] === "pane" && call[1] === "split"), false);
		if (savedXdgRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = savedXdgRuntime;
		clearNvimTestEnv();
	}

	// Sidebar matrix: a dead socket is ignored; a live daemon with the sidebar
	// toggled off still takes the files; open/focus failures report ok:false.
	{
		clearNvimTestEnv();
		const xdgDir = join(tempRoot, "gx-xdg");
		mkdirSync(join(xdgDir, "herdr-nvim"), { recursive: true });
		const daemonSocket = join(xdgDir, "herdr-nvim", "w7_t1.sock");
		const prevXdg = process.env.XDG_RUNTIME_DIR;
		process.env.XDG_RUNTIME_DIR = xdgDir;
		writeFileSync(daemonSocket, "");
		process.env.NVIM_TEST_NVIM_DEAD = "1";
		stageHerdr("gx-dead", { panes: basePanes });
		let { result } = await runOpenEditor(["src/one.ts"]);
		assert.deepEqual(result, {
			message: `Launched vim in a vertical split (pane w7:p9) at ${repoCwd} with 1 file(s).`,
			ok: true,
			launched: true,
		});
		delete process.env.NVIM_TEST_NVIM_DEAD;
		stageHerdr("gx-off", { panes: basePanes });
		({ result } = await runOpenEditor(["src/one.ts"]));
		assert.deepEqual(result, {
			message: "Opened 1 file(s) in the herdr-nvim sidebar (tab w7:t1) — press prefix+t in that tab to view.",
			ok: true,
			launched: false,
		});
		({ result } = await runOpenEditor([]));
		assert.deepEqual(result, {
			message: "The herdr-nvim sidebar (tab w7:t1) is this tab's editor — press prefix+t in that tab to view.",
			ok: true,
			launched: false,
		});
		process.env.NVIM_TEST_REMOTE_FAIL = "1";
		({ result } = await runOpenEditor(["src/one.ts"]));
		assert.deepEqual(result, {
			message: "Could not open files in the herdr-nvim sidebar (tab w7:t1).",
			ok: false,
			launched: false,
		});
		delete process.env.NVIM_TEST_REMOTE_FAIL;
		stageHerdr("gx-focus", {
			panes: [...basePanes, { pane_id: "w7:p2", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" }],
			procs: {
				"w7:p2": [{
					name: "nvim", pid: 78,
					argv: ["/usr/bin/nvim", "--server", daemonSocket, "--remote-ui"],
				}],
		},
		});
		({ result } = await runOpenEditor([]));
		assert.deepEqual(result, {
			message: "Could not focus the herdr-nvim sidebar (tab w7:t1).",
			ok: false,
			launched: false,
		});
		if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = prevXdg;
		clearNvimTestEnv();
	}

	// An existing editor in this tab receives :e keystrokes, then focus.
	{
		clearNvimTestEnv();
		stageHerdr("g2", {
			panes: [...basePanes, { pane_id: "w7:p2", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" }],
			procs: { "w7:p2": editorProc },
			neighbors: { right: "w7:p2" },
		});
		const { result, calls } = await runOpenEditor(["src/one.ts", "docs/My Notes.md"]);
		assert.deepEqual(result, {
			message: "Sent 2 file(s) to existing editor (pane w7:p2).",
			ok: true,
			launched: false,
		});
		const sendTextCalls = calls.filter((call) => call[1] === "send-text");
		assert.equal(sendTextCalls.length, 2);
		assert.match(sendTextCalls[0][3], /:e .*src\/one\.ts$/);
		assert.match(sendTextCalls[1][3], /:e .*docs\/My\\ Notes\.md$/, "spaces are backslash-escaped for :e");
		assert.equal(sendTextCalls.every((call) => call[2] === "w7:p2"), true);
		assert.deepEqual(calls.at(-1), ["pane", "focus", "--pane", "w7:p1", "--direction", "right"]);
		assert.equal(calls.some((call) => call[1] === "split"), false);
		clearNvimTestEnv();
	}

	// No editor and no daemon → one vertical split; the pane dies with nvim and
	// the RPC socket name is sanitized (colons are not allowed).
	{
		clearNvimTestEnv();
		stageHerdr("g3", { panes: basePanes });
		const { result, calls } = await runOpenEditor(["src/one.ts"]);
		assert.deepEqual(result, {
			message: `Launched vim in a vertical split (pane w7:p9) at ${repoCwd} with 1 file(s).`,
			ok: true,
			launched: true,
		});
		assert.deepEqual(
			calls.find((call) => call[1] === "split"),
			["pane", "split", "--current", "--direction", "right", "--cwd", repoCwd, "--focus"],
		);
		const paneRun = calls.find((call) => call[1] === "run");
		assert.equal(paneRun[2], "w7:p9");
		assert.match(paneRun[3], /nvim --listen .*pi-nvim-w7-p9\.sock/);
		assert.ok(paneRun[3].includes(`'${join(repoCwd, "src", "one.ts")}'`), "file paths are shell-quoted");
		assert.ok(paneRun[3].includes("herdr pane close w7:p9"), "the pane closes with nvim");
		assert.ok(paneRun[3].startsWith("bash -c "));
		clearNvimTestEnv();
	}

	// A failed pane scan must NOT launch a duplicate editor — tmux takes over.
	{
		clearNvimTestEnv();
		stageHerdr("g4", { panes: basePanes });
		process.env.NVIM_TEST_PANES_FAIL = "1";
		const { result, calls } = await runOpenEditor(["src/one.ts"]);
		assert.deepEqual(result, {
			message: `Launched vim in a tmux split at ${repoCwd}.`,
			ok: true,
			launched: true,
		});
		assert.equal(calls.some((call) => call[1] === "split"), false, "no herdr split on scan error");
		const tmuxSplit = calls.find((call) => call[0] === "split-window");
		assert.deepEqual(tmuxSplit.slice(0, 4), ["split-window", "-h", "-c", repoCwd]);
		assert.match(tmuxSplit[4], /nvim --listen /);
		clearNvimTestEnv();
	}

	// No herdr at all → straight to the tmux fallback.
	{
		clearNvimTestEnv();
		process.env.NVIM_TEST_NO_CURRENT = "1";
		const { result, calls } = await runOpenEditor([]);
		assert.deepEqual(result, {
			message: `Launched vim in a tmux split at ${repoCwd}.`,
			ok: true,
			launched: true,
		});
		assert.deepEqual(calls[0], ["pane", "current"]);
		assert.equal(calls.some((call) => call[1] === "list"), false, "no scan without a current pane");
		assert.equal(calls.some((call) => call[0] === "split-window"), true);
		clearNvimTestEnv();
	}

	// Both surfaces fail → a manual command is reported, ok:false.
	{
		clearNvimTestEnv();
		process.env.NVIM_TEST_NO_CURRENT = "1";
		process.env.NVIM_TEST_TMUX_FAIL = "1";
		const { result } = await runOpenEditor(["src/one.ts"]);
		assert.deepEqual(result, {
			message: `Could not launch vim automatically. Run manually: cd ${repoCwd} && vim ${join(repoCwd, "src", "one.ts")}`,
			ok: false,
			launched: false,
		});
		clearNvimTestEnv();
	}

	// A failed :e send reports failure instead of pretending success.
	{
		clearNvimTestEnv();
		stageHerdr("g2b", {
			panes: [...basePanes, { pane_id: "w7:p2", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" }],
			procs: { "w7:p2": editorProc },
			neighbors: { right: "w7:p2" },
		});
		process.env.NVIM_TEST_SEND_FAIL = "1";
		const { result } = await runOpenEditor(["src/one.ts"]);
		assert.deepEqual(result, {
			message: "Could not send files to existing editor (pane w7:p2).",
			ok: false,
			launched: false,
		});
		clearNvimTestEnv();
	}

	// No files and no focusable neighbor → focus failure reports ok:false.
	{
		clearNvimTestEnv();
		stageHerdr("g7b", {
			panes: [...basePanes, { pane_id: "w7:p2", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" }],
			procs: { "w7:p2": editorProc },
		});
		const { result, calls } = await runOpenEditor([]);
		assert.deepEqual(result, {
			message: "Could not focus existing editor pane (w7:p2).",
			ok: false,
			launched: false,
		});
		assert.equal(calls.some((call) => call[1] === "send-text"), false);
		clearNvimTestEnv();
	}

	// The registered tool's execute() drives the same orchestration.
	{
		clearNvimTestEnv();
		process.env.NVIM_TEST_NO_CURRENT = "1";
		const executeResult = await tool.execute("call-1", { cwd: repoCwd, files: ["src/one.ts"] });
		assert.deepEqual(executeResult, {
			content: [{ type: "text", text: `Launched vim in a tmux split at ${repoCwd}.` }],
		});
		clearNvimTestEnv();
	}

	// findEditorPane stays tri-state: found | absent | error — never a false
	// "absent" that would launch a duplicate.
	{
		clearNvimTestEnv();
		const staging = stageHerdr("g8", {
			panes: [...basePanes, { pane_id: "w7:p2", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" }],
			procs: { "w7:p2": editorProc },
		});
		assert.deepEqual(nvimOpen.findEditorPane("w7:t1"), {
			status: "found",
			editor: { paneId: "w7:p2", pid: 9 },
		});
		// The focus-buffer helper resolves the same pane, with the editor name.
		assert.deepEqual(nvimOpen.detectEditorProcess(), { paneId: "w7:p2", pid: 9, name: "nvim" });
		writeFileSync(
			join(staging, "procs", "w7:p2.json"),
			JSON.stringify(paneJson("w7:p2", [{ name: "vim", pid: 11, argv: ["vim"] }])),
		);
		assert.deepEqual(nvimOpen.detectEditorProcess(), { paneId: "w7:p2", pid: 11, name: "vim" });
		process.env.NVIM_TEST_NO_CURRENT = "1";
		assert.equal(nvimOpen.detectEditorProcess(), null);
		delete process.env.NVIM_TEST_NO_CURRENT;
		writeFileSync(
			join(staging, "procs", "w7:p2.json"),
			JSON.stringify(paneJson("w7:p2", editorProc)),
		);
		// A pane whose process-info fails makes the scan an error, not "absent".
		process.env.NVIM_TEST_PROC_FAIL = "1";
		assert.deepEqual(nvimOpen.findEditorPane("w7:t1"), { status: "error" });
		delete process.env.NVIM_TEST_PROC_FAIL;
		// No editor processes anywhere → absent.
		writeFileSync(
			join(staging, "procs", "w7:p2.json"),
			JSON.stringify(paneJson("w7:p2", [])),
		);
		assert.deepEqual(nvimOpen.findEditorPane("w7:t1"), { status: "absent" });
		// A pane-list failure → error.
		process.env.NVIM_TEST_PANES_FAIL = "1";
		assert.deepEqual(nvimOpen.findEditorPane("w7:t1"), { status: "error" });
		delete process.env.NVIM_TEST_PANES_FAIL;
		// No panes in this tab at all → error.
		assert.deepEqual(nvimOpen.findEditorPane("w8:t8"), { status: "error" });
		clearNvimTestEnv();
	}

	// The /nvim command parses quote-aware arguments before opening.
	{
		clearNvimTestEnv();
		let nvimCommand;
		nvimOpen.default({
			registerTool() {},
			registerCommand(name, definition) {
				if (name === "nvim") nvimCommand = definition;
			},
			on: () => {},
		});
		assert.equal(typeof nvimCommand.handler, "function");
		process.env.NVIM_TEST_NO_CURRENT = "1";
		const notified = [];
		const before = readEditorCalls().length;
		await nvimCommand.handler("docs/'My Notes.md' src/one.ts", {
			cwd: repoCwd,
			ui: { notify: (message) => notified.push(message) },
		});
		const calls = readEditorCalls().slice(before);
		assert.match(notified[0], /Launched vim in a tmux split at /);
		const tmuxSplit = calls.find((call) => call[0] === "split-window");
		assert.ok(
			tmuxSplit[4].includes(`'${join(repoCwd, "docs", "My Notes.md")}'`),
			"quotes are stripped and the space stays inside one path",
		);
		assert.ok(tmuxSplit[4].includes(`'${join(repoCwd, "src", "one.ts")}'`));
		clearNvimTestEnv();
	}

	// ── nvim-open.sh: the same lifecycle, driven the way the skill runs it ──
	const shRoot = mkdtempSync(join(tmpdir(), "nvim-open-sh-test-"));
	const shBin = join(shRoot, "bin");
	const shUtilBin = join(shRoot, "util-bin");
	const shHome = join(shRoot, "home");
	const shTmp = join(shRoot, "tmp");
	mkdirSync(shBin, { recursive: true });
	mkdirSync(shUtilBin, { recursive: true });
	mkdirSync(shHome, { recursive: true });
	mkdirSync(shTmp, { recursive: true });
	for (const utility of ["timeout", "dirname", "sed", "mktemp", "mkdir", "date", "id", "seq", "python3", "cat"]) {
		const real = execFileSync("sh", ["-c", `command -v ${utility}`], { encoding: "utf8" }).trim();
		assert.ok(real, `host provides ${utility} for the nvim-open.sh tests`);
		symlinkSync(real, join(shUtilBin, utility));
		symlinkSync(real, join(shBin, utility));
	}
	writeFileSync(
		join(shBin, "herdr"),
		`#!/bin/sh
if [ -n "$SH_CAPTURE" ]; then
	printf '%s\\n' "$@" >> "$SH_CAPTURE"
	printf '%s\\n' --call-- >> "$SH_CAPTURE"
fi
if [ "$SH_HERDR_DOWN" = 1 ]; then
	exit 1
fi
case "$1:$2" in
	workspace:list) printf '%s\\n' '{"result":{"workspaces":[]}}' ;;
	pane:current) printf '%s\\n' '{"result":{"pane":{"pane_id":"w7:p1","tab_id":"w7:t1","cwd":"/repo","workspace_id":"w7"}}}' ;;
	pane:list)
		[ "$SH_PANES_FAIL" = 1 ] && exit 1
		cat "$SH_PANES_FILE"
		;;
	pane:process-info)
		if [ -f "$SH_PROCS_DIR/$4.json" ]; then
			cat "$SH_PROCS_DIR/$4.json"
		else
			printf '{"result":{"process_info":{"pane_id":"%s","foreground_processes":[]}}}' "$4"
		fi
		;;
	pane:split) printf '%s\\n' '{"result":{"pane":{"pane_id":"w7:p9"}}}' ;;
	pane:neighbor)
		if [ -f "$SH_NEIGHBORS_DIR/$6" ]; then
			printf '{"result":{"neighbor":{"neighbor_pane_id":"%s"}}}' "$(cat "$SH_NEIGHBORS_DIR/$6")"
		else
			printf '%s\\n' '{"result":{"neighbor":{"neighbor_pane_id":""}}}'
		fi
		;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	writeFileSync(join(shBin, "nvim"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	writeFileSync(
		join(shBin, "tmux"),
		`#!/bin/sh
if [ -n "$SH_CAPTURE" ]; then
	printf '%s\\n' "$@" >> "$SH_CAPTURE"
	printf '%s\\n' --call-- >> "$SH_CAPTURE"
fi
exit 0
`,
		{ mode: 0o755 },
	);
	const shScript = fileURLToPath(
		new URL("../../../../agents/.agents/skills/nvim/nvim-open.sh", import.meta.url),
	);
	// The child env carries a fake-only PATH, so bash itself must be absolute.
	const bashBin = execFileSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
	const runSh = (captureName, args, extraEnv = {}, binDir = shBin) => {
		const capture = join(shRoot, captureName);
		writeFileSync(capture, "");
		const stdout = execFileSync(bashBin, [shScript, ...args], {
			encoding: "utf8",
			env: {
				PATH: binDir,
				HOME: shHome,
				TMPDIR: `${shTmp}/`,
				XDG_RUNTIME_DIR: "",
				SH_CAPTURE: capture,
				...extraEnv,
			},
		});
		return {
			stdout,
			calls: readFileSync(capture, "utf8")
				.split("--call--\n")
				.filter(Boolean)
				.map((call) => call.trim().split("\n")),
		};
	};
	const shStage = (name, { panes = [], procs = {}, neighbors = {} } = {}) => {
		const dir = join(shRoot, name);
		const panesFile = join(dir, "panes.json");
		const procsDir = join(dir, "procs");
		const neighborsDir = join(dir, "neighbors");
		mkdirSync(procsDir, { recursive: true });
		mkdirSync(neighborsDir, { recursive: true });
		writeFileSync(panesFile, JSON.stringify({ result: { panes } }));
		for (const [paneId, processes] of Object.entries(procs)) {
			writeFileSync(
				join(procsDir, `${paneId}.json`),
				JSON.stringify({ result: { process_info: { pane_id: paneId, foreground_processes: processes } } }),
			);
		}
		for (const [direction, neighborId] of Object.entries(neighbors)) {
			writeFileSync(join(neighborsDir, direction), neighborId);
		}
		return { SH_PANES_FILE: panesFile, SH_PROCS_DIR: procsDir, SH_NEIGHBORS_DIR: neighborsDir };
	};
	const shEditorPane = { pane_id: "w7:p2", tab_id: "w7:t1", cwd: "/repo", workspace_id: "w7" };
	const shFile = join(repoCwd, "src", "one.ts");

	// No herdr → the tmux fallback, with the listen socket for nvimr.
	{
		const { stdout, calls } = runSh("i1-calls", [repoCwd, "docs/My Notes.md"], { SH_HERDR_DOWN: "1" });
		assert.match(stdout, new RegExp(`Launched nvim in a tmux split at ${repoCwd}\\.`));
		assert.match(stdout, /Listen socket: /);
		assert.deepEqual(calls[0], ["workspace", "list"]);
		const tmuxSplit = calls.find((call) => call[0] === "split-window");
		assert.deepEqual(tmuxSplit.slice(0, 4), ["split-window", "-h", "-c", repoCwd]);
		assert.match(tmuxSplit[4], /^ ?nvim --listen .+\/nvim\.\d+\.0 'docs\/My Notes\.md' ?$/);
	}

	// An existing editor in this tab receives :e keystrokes, then focus.
	{
		const { stdout, calls } = runSh("i2-calls", [repoCwd, shFile], shStage("i2", {
			panes: [basePanes[0], shEditorPane, basePanes[1]],
			procs: { "w7:p2": editorProc },
			neighbors: { right: "w7:p2" },
		}));
		assert.match(stdout, /Sent 1 file\(s\) to existing editor \(pane w7:p2\)\./);
		const sendText = calls.find((call) => call[1] === "send-text");
		assert.deepEqual(sendText.slice(0, 3), ["pane", "send-text", "w7:p2"]);
		assert.match(sendText[3], /:e .*src\/one\.ts$/);
		assert.deepEqual(calls.at(-1), ["pane", "focus", "--pane", "w7:p1", "--direction", "right"]);
		assert.equal(calls.some((call) => call[1] === "split"), false);
	}

	// No editor → one vertical split; nvim runs with a listen socket.
	{
		const { stdout, calls } = runSh("i3-calls", [repoCwd, shFile], shStage("i3", {
			panes: [basePanes[0], basePanes[1]],
		}));
		assert.ok(stdout.includes(`Launched nvim in a vertical split (pane w7:p9) at ${repoCwd} with 1 file(s).`));
		assert.match(stdout, /Listen socket: /);
		assert.deepEqual(
			calls.find((call) => call[1] === "split"),
			["pane", "split", "--current", "--direction", "right", "--cwd", repoCwd, "--focus"],
		);
		const paneRun = calls.find((call) => call[1] === "run");
		assert.equal(paneRun[2], "w7:p9");
		assert.equal(paneRun[3], "nvim");
		assert.equal(paneRun[4], "--listen");
		assert.ok(paneRun[5].length > 0, "a listen socket path is passed");
		assert.equal(paneRun[6], shFile);
	}

	// A failed pane scan must NOT split — the script falls back to tmux.
	{
		const { stdout, calls } = runSh("i4-calls", [repoCwd], {
			...shStage("i4", { panes: [basePanes[0], basePanes[1]] }),
			SH_PANES_FAIL: "1",
		});
		assert.match(stdout, new RegExp(`Launched nvim in a tmux split at ${repoCwd}\\.`));
		assert.equal(calls.some((call) => call[1] === "split"), false, "no split on scan error");
		assert.equal(calls.some((call) => call[0] === "split-window"), true);
	}

	// Neither vim nor nvim on the host → fail fast with a manual fallback.
	// The script also probes absolute fallback dirs (/home/linuxbrew, /opt/
	// homebrew) for an editor; when the host provides one there, this path is
	// not reachable hermetically, so the check runs only on hosts without one.
	const hostFallbackEditor = ["/home/linuxbrew/.linuxbrew/bin", "/opt/homebrew/bin"]
		.filter((dir) => existsSync(dir))
		.some((dir) => existsSync(join(dir, "nvim")) || existsSync(join(dir, "vim")));
	if (hostFallbackEditor) {
		process.stdout.write("skip: host fallback dirs provide an editor; fail-fast path untestable here\n");
	} else {
		assert.throws(
			() => runSh("i5-calls", [repoCwd, "a.txt"], {}, shUtilBin),
			(error) =>
				error.status === 1 && /neither vim nor nvim is installed/.test(String(error.stderr)),
		);
	}
} finally {
	if (savedOpenPath === undefined) delete process.env.PATH;
	else process.env.PATH = savedOpenPath;
	if (savedXdgRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
	else process.env.XDG_RUNTIME_DIR = savedXdgRuntime;
	for (const key of nvimTestEnvKeys) delete process.env[key];
	rmSync(tempRoot, { recursive: true, force: true });
}

	// ── launch provenance log line (pure) ──────────────────────
	assert.equal(
		nvimOpen.launchLogPath({}),
		join(homedir(), ".cache", "pi", "nvim-open-launches.log"),
	);
	assert.equal(nvimOpen.launchLogPath({ PI_NVIM_LAUNCH_LOG: "/tmp/x.log" }), "/tmp/x.log");
	const event = {
		route: "tool", cwd: "/repo/My Work", outcome: "split",
		pane: "w5G:p2", socket: "/tmp/pi-nvim-w5G-p2.sock", files: 2,
	};
	const env = {
		PI_SUBAGENT_SESSION: "/sessions/sub.jsonl",
		PI_SUBAGENT_NAME: "recon",
		HERDR_PANE_ID: "w73:pB",
	};
	const line = nvimOpen.buildLaunchLogLine(event, env);
	// Required keys, in order; spaced values are single-quoted.
	assert.match(line, /^ts=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z pid=\d+ route=tool /);
	assert.match(line, / session=\/sessions\/sub\.jsonl subagent=recon callerPane=w73:pB /);
	assert.match(line, / cwd='\/repo\/My Work' outcome=split pane=w5G:p2 socket=\/tmp\/pi-nvim-w5G-p2\.sock files=2$/);
	// session resolution: subagent session wins, then the main session file, then "-".
	assert.match(
		nvimOpen.buildLaunchLogLine(event, { PI_SESSION_FILE: "/s/main.jsonl" }),
		/ session=\/s\/main\.jsonl /,
	);
	assert.match(
		nvimOpen.buildLaunchLogLine(event, { PI_SESSION_FILE: "/s/main.jsonl", PI_SUBAGENT_SESSION: "/s/sub.jsonl" }),
		/ session=\/s\/sub\.jsonl /,
	);
	const bareLine = nvimOpen.buildLaunchLogLine(event, {});
	assert.match(bareLine, / session=- subagent=- callerPane=- /);
	// existing / sidebar outcomes carry no pane or socket keys.
	for (const outcome of ["existing", "sidebar"]) {
		const outcomeLine = nvimOpen.buildLaunchLogLine({ ...event, outcome });
		assert.ok(!/(^| )(pane|socket)=/.test(outcomeLine), `${outcome} line must not carry pane/socket`);
		assert.match(outcomeLine, new RegExp(` outcome=${outcome} files=2$`));
	}
	// failed keeps pane/socket with "-" defaults.
	assert.match(
		nvimOpen.buildLaunchLogLine({ route: "script", cwd: "/r", outcome: "failed", files: 0 }),
		/ outcome=failed pane=- socket=- files=0$/,
	);
	// Quoting: embedded quotes are shell-escaped; "=" and empty force quoting.
	assert.match(
		nvimOpen.buildLaunchLogLine({ ...event, cwd: "/it's a=b" }, {}),
		/ cwd='\/it'\\''s a=b' /,
	);
	assert.ok(nvimOpen.buildLaunchLogLine({ ...event, cwd: "" }, {}).includes("cwd='' "));

	// ── route threading through openEditor (offline) ───────────
	// A PATH holding only a no-op `tmux` makes openEditor deterministic:
	// herdr is not found (pane detection is skipped) and the tmux fallback
	// "succeeds" without touching any real multiplexer.
	const offlineBin = join(tempRoot, "offline-bin");
	mkdirSync(offlineBin);
	const fakeTmux = join(offlineBin, "tmux");
	writeFileSync(fakeTmux, "#!/bin/sh\nexit 0\n");
	chmodSync(fakeTmux, 0o755);
	const launchLog = join(tempRoot, "launches.log");
	const savedPath = process.env.PATH;
	const savedEnv = ["PI_NVIM_LAUNCH_LOG", "PI_SESSION_FILE", "PI_SUBAGENT_SESSION", "PI_SUBAGENT_NAME", "HERDR_PANE_ID"]
		.map((key) => [key, process.env[key]]);
	process.env.PATH = offlineBin;
	process.env.PI_NVIM_LAUNCH_LOG = launchLog;
	process.env.PI_SESSION_FILE = "/sessions/main.jsonl";
	delete process.env.PI_SUBAGENT_SESSION;
	delete process.env.PI_SUBAGENT_NAME;
	process.env.HERDR_PANE_ID = "w73:pB";
	const unwritableDir = join(tempRoot, "unwritable-dir");
	mkdirSync(unwritableDir);
	try {
		const lastLine = () => readFileSync(launchLog, "utf-8").split("\n").filter(Boolean).at(-1);
		// tool route: through the registered nvim_open tool execute.
		const toolResult = await tool.execute("t1", { cwd: "/repo", files: ["a.ts", "b.ts"] });
		assert.equal(toolResult.content[0].text, "Launched vim in a tmux split at /repo.");
		assert.match(lastLine(), / route=tool /);
		assert.match(lastLine(), / session=\/sessions\/main\.jsonl subagent=- callerPane=w73:pB /);
		assert.match(lastLine(), / outcome=split pane=- socket=\S*pi-nvim-\d+-\d+\.sock files=2$/);
		// command route: through the registered /nvim command handler.
		let notified;
		await commands.nvim.handler([], { cwd: "/repo", ui: { notify: (message) => { notified = message; } } });
		assert.equal(notified, "Launched vim in a tmux split at /repo.");
		assert.match(lastLine(), / route=command /);
		// library route: an explicit route string lands in the line.
		await nvimOpen.openEditor("/repo", [], "library:md-log");
		assert.match(lastLine(), / route=library:md-log /);
		// An unset route defaults to library:unknown.
		await nvimOpen.openEditor("/repo", []);
		assert.match(lastLine(), / route=library:unknown /);
		// Failure tolerance: a log path that cannot be written (a directory)
		// never fails or delays the launch — openEditor still succeeds.
		process.env.PI_NVIM_LAUNCH_LOG = unwritableDir;
		const tolerant = await nvimOpen.openEditor("/repo", ["x.ts"], "tool");
		assert.equal(tolerant.ok, true);
		assert.equal(tolerant.launched, true);
		assert.equal(tolerant.message, "Launched vim in a tmux split at /repo.");
	} finally {
		process.env.PATH = savedPath;
		for (const [key, value] of savedEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	// ── launch race lock + registry (injectable exec seam) ──────────
	// The seam swaps every herdr/nvim/tmux exec in nvim-open.ts for a fake
	// with canned responses, so the race guards run against the real
	// decision logic with zero live multiplexer access — and the run can
	// never leave a real split behind (checked against the real provenance
	// log at the end of this file's CI run).
	const seamLog = join(tempRoot, "seam-launches.log");
	const savedSeamEnv = ["PI_NVIM_LAUNCH_LOG", "PI_SESSION_FILE", "PI_SUBAGENT_SESSION", "PI_SUBAGENT_NAME", "HERDR_PANE_ID"]
		.map((key) => [key, process.env[key]]);
	process.env.PI_NVIM_LAUNCH_LOG = seamLog;
	process.env.PI_SESSION_FILE = "/sessions/main.jsonl";
	delete process.env.PI_SUBAGENT_SESSION;
	delete process.env.PI_SUBAGENT_NAME;
	try {
		/** A fake exec for one scenario: answers canned herdr JSON and
		 *  records every invocation as [command, ...args]. */
		const makeFakeExec = (scenario) => {
			const calls = [];
			const impl = (command, args) => {
				calls.push([command, ...args]);
				if (command === "herdr" && args[0] === "pane" && args[1] === "current") {
					return JSON.stringify({ result: { pane: {
						pane_id: scenario.callerPane, tab_id: scenario.tab, workspace_id: scenario.workspace, cwd: "/repo",
					} } });
				}
				if (command === "herdr" && args[0] === "pane" && args[1] === "list") {
					return JSON.stringify({ result: { panes: scenario.panes() } });
				}
				if (command === "herdr" && args[0] === "pane" && args[1] === "process-info") {
					const paneId = args[args.indexOf("--pane") + 1];
					return JSON.stringify({ result: { process_info: {
						pane_id: paneId, foreground_processes: scenario.procs(paneId),
					} } });
				}
				if (command === "herdr" && args[0] === "pane" && args[1] === "split") {
					return JSON.stringify({ result: { pane: { pane_id: scenario.newPane } } });
				}
				return '{"result":{}}';
			};
			return { impl, calls };
		};
		const countCalls = (calls, ...prefix) =>
			calls.filter((call) => prefix.every((part, i) => call[i] === part)).length;
		const findCall = (calls, ...prefix) =>
			calls.find((call) => prefix.every((part, i) => call[i] === part));

		// Scenario A — the 27 ms incident: two concurrent openEditor calls
		// in one tab. The first splits; the second waits on the per-tab lock,
		// finds the first's pane in the registry WITHOUT a pane scan (the
		// split pane's nvim has NOT reached foreground processes — it still
		// shows its shell), and routes to it. Exactly one split may happen.
		let aLists = 0;
		const a = makeFakeExec({
			callerPane: "wR1:p1", tab: "wR1:t1", workspace: "wR1", newPane: "wR1:p2",
			panes: () => {
				aLists += 1;
				// 1st list: the detection scan (caller pane only). 2nd list: the
				// post-split guard re-list (our new pane now exists too).
				return aLists === 1
					? [{ pane_id: "wR1:p1", tab_id: "wR1:t1" }]
					: [{ pane_id: "wR1:p1", tab_id: "wR1:t1" }, { pane_id: "wR1:p2", tab_id: "wR1:t1" }];
			},
			// The new pane's nvim lags behind the split — foreground is still
			// its shell. The registry must trust the pane anyway.
			procs: (paneId) => paneId === "wR1:p2"
				? [{ name: "bash", pid: 31, argv: ["bash"] }]
				: [{ name: "zsh", pid: 11, argv: ["zsh"] }],
		});
		process.env.HERDR_PANE_ID = "wR1:p1";
		nvimOpen.__setExecSyncForTests(a.impl);
		const [first, second] = await Promise.all([
			nvimOpen.openEditor("/repo", ["a.ts"], "tool"),
			nvimOpen.openEditor("/repo", ["b.ts"], "tool"),
		]);
		assert.equal(first.ok, true);
		assert.equal(first.launched, true);
		assert.match(first.message, /Launched vim in a vertical split \(pane wR1:p2\)/);
		assert.equal(second.ok, true);
		assert.equal(second.launched, false);
		assert.match(second.message, /Sent 1 file\(s\) to existing editor \(pane wR1:p2\)/);
		// Exactly ONE split — the second call never split.
		assert.equal(countCalls(a.calls, "herdr", "pane", "split"), 1);
		// Exactly TWO pane lists — the first call's detection scan and its
		// post-split guard re-list. The second call scanned NOTHING
		// (registry-first) and neither did anything later.
		assert.equal(countCalls(a.calls, "herdr", "pane", "list"), 2);
		// The second call routed its file to the registry pane.
		const routed = findCall(a.calls, "herdr", "pane", "send-text", "wR1:p2");
		assert.ok(routed, "second call must send-text to the registry pane");
		assert.match(routed[4], /:e \/repo\/b\.ts/);
		// Provenance: one split line, then one existing line.
		const seamLines = () => readFileSync(seamLog, "utf-8").split("\n").filter(Boolean);
		assert.match(seamLines().at(-2), / outcome=split pane=wR1:p2 /);
		assert.match(seamLines().at(-1), / outcome=existing files=1$/);

		// A later call in the same tab hits the registry with no pane scan.
		const listsBefore = countCalls(a.calls, "herdr", "pane", "list");
		const again = await nvimOpen.openEditor("/repo", ["c.ts"], "tool");
		assert.equal(again.ok, true);
		assert.equal(again.launched, false);
		assert.match(again.message, /Sent 1 file\(s\) to existing editor \(pane wR1:p2\)/);
		assert.equal(countCalls(a.calls, "herdr", "pane", "list"), listsBefore);
		assert.equal(countCalls(a.calls, "herdr", "pane", "split"), 1);

		// Scenario B — cross-process race: between our "absent" detection
		// and our split, another process's editor pane appeared in the tab.
		// The post-split guard closes OUR new pane and routes to the
		// pre-existing one.
		let bLists = 0;
		const b = makeFakeExec({
			callerPane: "wG1:p1", tab: "wG1:t1", workspace: "wG1", newPane: "wG1:p2",
			panes: () => {
				bLists += 1;
				// Detection sees only the caller; the guard re-list catches the
				// rival pane that appeared in between (with its nvim up).
				return bLists === 1
					? [{ pane_id: "wG1:p1", tab_id: "wG1:t1" }]
					: [
						{ pane_id: "wG1:p1", tab_id: "wG1:t1" },
						{ pane_id: "wG1:p9", tab_id: "wG1:t1" },
						{ pane_id: "wG1:p2", tab_id: "wG1:t1" },
					];
			},
			procs: (paneId) => paneId === "wG1:p9"
				? [{ name: "nvim", pid: 91, argv: ["nvim", "src/main.rs"] }]
				: [{ name: "zsh", pid: 11, argv: ["zsh"] }],
		});
		nvimOpen.__setExecSyncForTests(b.impl);
		const raced = await nvimOpen.openEditor("/repo", ["a.ts"], "tool");
		assert.equal(raced.ok, true);
		assert.equal(raced.launched, false, "the duplicate pane was closed; the surviving editor is pre-existing");
		assert.match(raced.message, /Closed duplicate pane wG1:p2/);
		assert.match(raced.message, /Sent 1 file\(s\) to existing editor \(pane wG1:p9\)/);
		// The NEW pane was closed — never the pre-existing one.
		assert.ok(findCall(b.calls, "herdr", "pane", "close", "wG1:p2"), "guard must close the new pane");
		assert.equal(countCalls(b.calls, "herdr", "pane", "close"), 1);
		// Files routed to the pre-existing editor.
		const racedRoute = findCall(b.calls, "herdr", "pane", "send-text", "wG1:p9");
		assert.ok(racedRoute, "guard must route files to the pre-existing pane");
		assert.match(racedRoute[4], /:e \/repo\/a\.ts/);
		// Provenance: the routing outcome is "existing" — the pane we briefly
		// created was closed, so no live pane is attributed to this call.
		assert.match(seamLines().at(-1), / outcome=existing files=1$/);

		// ── shutdown close: subagent yes, captain no ──────────────
		const shutdownHandlers = {};
		nvimOpen.default({
			registerTool: () => {},
			registerCommand: () => {},
			on: (name, handler) => { shutdownHandlers[name] = handler; },
		});
		assert.equal(typeof shutdownHandlers.session_shutdown, "function");
		// Reset registry state from the earlier scenarios: fire the handler
		// once under subagent env (scenario B's fake still injected, its
		// assertions already done) so the scenario-A pane closes and the
		// map clears — the shutdown scenarios then start from a clean slate.
		process.env.PI_SUBAGENT_SESSION = "/sessions/sub.jsonl";
		shutdownHandlers.session_shutdown();

		// Subagent context: the pane this process created is closed.
		const sub = makeFakeExec({
			callerPane: "wS1:p1", tab: "wS1:t1", workspace: "wS1", newPane: "wS1:p2",
			panes: () => [{ pane_id: "wS1:p1", tab_id: "wS1:t1" }, { pane_id: "wS1:p2", tab_id: "wS1:t1" }],
			procs: () => [{ name: "zsh", pid: 11, argv: ["zsh"] }],
		});
		process.env.PI_SUBAGENT_SESSION = "/sessions/sub.jsonl";
		process.env.PI_SUBAGENT_NAME = "worker";
		process.env.HERDR_PANE_ID = "wS1:p1";
		nvimOpen.__setExecSyncForTests(sub.impl);
		const subLaunch = await nvimOpen.openEditor("/repo", ["a.ts"], "tool");
		assert.equal(subLaunch.launched, true);
		assert.equal(countCalls(sub.calls, "herdr", "pane", "close"), 0, "no close before shutdown");
		shutdownHandlers.session_shutdown();
		assert.ok(findCall(sub.calls, "herdr", "pane", "close", "wS1:p2"), "subagent shutdown must close the created pane");
		assert.equal(countCalls(sub.calls, "herdr", "pane", "close"), 1);

		// Captain context: the pane this process created stays open — a
		// human may be editing in it.
		const captain = makeFakeExec({
			callerPane: "wC1:p1", tab: "wC1:t1", workspace: "wC1", newPane: "wC1:p2",
			panes: () => [{ pane_id: "wC1:p1", tab_id: "wC1:t1" }, { pane_id: "wC1:p2", tab_id: "wC1:t1" }],
			procs: () => [{ name: "zsh", pid: 11, argv: ["zsh"] }],
		});
		delete process.env.PI_SUBAGENT_SESSION;
		delete process.env.PI_SUBAGENT_NAME;
		process.env.HERDR_PANE_ID = "wC1:p1";
		nvimOpen.__setExecSyncForTests(captain.impl);
		const captainLaunch = await nvimOpen.openEditor("/repo", ["a.ts"], "tool");
		assert.equal(captainLaunch.launched, true);
		shutdownHandlers.session_shutdown();
		assert.equal(countCalls(captain.calls, "herdr", "pane", "close"), 0, "captain shutdown must leave editor panes open");
	} finally {
		nvimOpen.__setExecSyncForTests(null);
		for (const [key, value] of savedSeamEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

console.log("nvim-open tests passed");
