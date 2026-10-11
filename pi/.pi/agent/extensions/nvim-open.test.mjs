import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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
const jiti = createJiti(import.meta.url, { alias: {
	"@earendil-works/pi-coding-agent": stubAgent,
	"@earendil-works/pi-ai": stubAi,
	"@earendil-works/pi-tui": stubTui,
} });

try {
	let tool;
	const commands = {};
	const nvimOpen = jiti("./nvim-open.ts");
	nvimOpen.default({
		registerTool: (definition) => { tool = definition; },
		registerCommand: (name, definition) => { commands[name] = definition; },
	});
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
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
console.log("nvim-open tests passed");
