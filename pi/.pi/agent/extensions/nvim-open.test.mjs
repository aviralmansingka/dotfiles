import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	nvimOpen.default({ registerTool: (definition) => { tool = definition; }, registerCommand() {} });
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
console.log("nvim-open tests passed");
