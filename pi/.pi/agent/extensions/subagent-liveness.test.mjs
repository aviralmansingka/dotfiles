import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Subagent-liveness hardening — the two observed live failure classes:
//   (1) a pane where pi NEVER started (bare shell from a failed delegation
//       launch) used to wait forever, because the #294 liveness fallback
//       only fires after pi was seen once;
//   (2) a live-but-wedged pi used to wait forever, because pollForExit had
//       no deadline.
// Every wait is now bounded (hard deadline, no-sighting grace, read-failure
// threshold with a pane-existence probe) on BOTH surfaces, the index.ts
// watcher registers a module watchdog as belt-and-braces, and every death
// path funnels through one completion that harvests partial output, closes
// the pane cleanly, and steers the reason. Offline and deterministic: fake
// herdr/tmux/ps bins go on PATH before import, staged responses come from
// env + state files, and the wait bounds shrink to milliseconds through the
// PI_SUBAGENT_* / NM_* testability knobs (no sleep in any test exceeds the
// poll cadence the production code itself runs at).

const require = createRequire(import.meta.url);

// Shared jiti resolution (test-lib): the validated JITI_PATH / NODE_PATH
// contract, this file's historical macOS homebrew fallback, and pi's managed
// install (which covers the old hardcoded 1.1.0 release path).
const { HOMEBREW_JITI, resolveJiti } = await import("./test-lib/jiti.mjs");
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI] });
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);
const freshJiti = () => createJiti(import.meta.url, { moduleCache: false });

const callsOf = (file) =>
	readFileSync(file, "utf8")
		.split("--call--\n")
		.filter(Boolean)
		.map((call) => call.trim().split("\n"));

const withTimeout = (promise, ms, label) =>
	Promise.race([
		promise,
		new Promise((_, reject) => {
			const timer = setTimeout(() => reject(new Error(`${label} never resolved`)), ms);
			timer.unref?.();
		}),
	]);

// ---------------------------------------------------------------------------
// Wait-bounds resolution: defaults unchanged, env knobs override.
// ---------------------------------------------------------------------------
{
	const herdr = freshJiti()("./interactive-subagents/pi-extension/subagents/herdr.ts");
	const tmux = freshJiti()("./interactive-subagents/pi-extension/subagents/tmux.ts");
	const saved = {
		PI_SUBAGENT_POLL_MS: process.env.PI_SUBAGENT_POLL_MS,
		PI_SUBAGENT_MAX_WAIT_MS: process.env.PI_SUBAGENT_MAX_WAIT_MS,
		PI_SUBAGENT_STARTUP_GRACE_MS: process.env.PI_SUBAGENT_STARTUP_GRACE_MS,
		PI_SUBAGENT_PROCINFO_FAIL_LIMIT: process.env.PI_SUBAGENT_PROCINFO_FAIL_LIMIT,
	};
	try {
		for (const mod of [herdr, tmux]) {
			assert.deepEqual(mod.getSubagentPollBounds(), {
				pollMs: 1000,
				maxWaitMs: 30 * 60_000,
				startupGraceMs: 60_000,
				processInfoFailLimit: 3,
			}, "default bounds are unchanged on both surfaces");
			assert.deepEqual(
				mod.getSubagentPollBounds({ pollMs: 5, maxWaitMs: 6, startupGraceMs: 7, processInfoFailLimit: 8 }),
				{ pollMs: 5, maxWaitMs: 6, startupGraceMs: 7, processInfoFailLimit: 8 },
				"explicit overrides win over env",
			);
		}
		process.env.PI_SUBAGENT_POLL_MS = "40";
		process.env.PI_SUBAGENT_MAX_WAIT_MS = "50";
		process.env.PI_SUBAGENT_STARTUP_GRACE_MS = "60";
		process.env.PI_SUBAGENT_PROCINFO_FAIL_LIMIT = "70";
		for (const mod of [herdr, tmux]) {
			assert.deepEqual(mod.getSubagentPollBounds(), {
				pollMs: 40,
				maxWaitMs: 50,
				startupGraceMs: 60,
				processInfoFailLimit: 70,
			}, "env knobs override both surfaces identically");
		}
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

// ---------------------------------------------------------------------------
// Herdr surface matrix — no-agent, agent-gone (compat staging), pgid
// children, deadline harvest, read-failure threshold.
// ---------------------------------------------------------------------------
{
	const root = mkdtempSync(join(tmpdir(), "subagent-liveness-herdr-"));
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	const capture = join(root, "calls");
	const stageFile = join(root, "proc-stage");
	writeFileSync(
		join(bin, "herdr"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$LIV_HERDR_CAPTURE"
printf '%s\\n' --call-- >> "$LIV_HERDR_CAPTURE"
case "$1:$2" in
	pane:get)
		if [ "$LIV_PANE_GONE" = 1 ]; then exit 1; fi
		printf '%s\\n' '{"result":{"pane":{"pane_id":"wL:p1","tab_id":"wL:t9","workspace_id":"wL"}}}'
		;;
	tab:create) printf '%s\\n' '{"result":{"root_pane":{"pane_id":"wL:p2"}}}' ;;
	pane:run) printf '%s\\n' '{"result":{}}' ;;
	agent:get) printf '%s\\n' '{"result":{"agent":{"agent_status":"idle"}}}' ;;
	agent:prompt) printf '%s\\n' '{"result":{}}' ;;
	pane:read) printf '%s\\n' "$LIV_SCREEN" ;;
	pane:process-info)
		if [ "$LIV_PROC_FAIL" = 1 ]; then exit 1; fi
		mode="$LIV_PROC_MODE"
		if [ "$LIV_PROC_STAGED" = 1 ]; then
			stage=0
			[ -f "$LIV_PROC_STAGE_FILE" ] && stage=$(cat "$LIV_PROC_STAGE_FILE")
			stage=$((stage + 1))
			printf '%s' "$stage" > "$LIV_PROC_STAGE_FILE"
			if [ "$stage" = 1 ]; then mode=pi; else mode=shell; fi
		fi
		case "$mode" in
			pi) printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":200,"argv":["zsh"]},{"name":"pi","pid":201,"argv":["pi","--session","x.jsonl"]}]}}}' ;;
			pi-child) printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":200,"argv":["zsh"]},{"name":"pi","pid":201,"argv":["pi"]},{"name":"bash","pid":300,"argv":["bash","-c","sleep 30"]}]}}}' ;;
			*) printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":200,"argv":["zsh"]}]}}}' ;;
		esac
		;;
	tab:close) printf '%s\\n' '{"result":{}}' ;;
	pane:close) printf '%s\\n' '{"result":{}}' ;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	const saved = {
		PATH: process.env.PATH,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID,
		TMUX: process.env.TMUX,
		TMUX_PANE: process.env.TMUX_PANE,
	};
	try {
		process.env.PATH = `${bin}:${saved.PATH}`;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "wL:p1";
		delete process.env.HERDR_WORKSPACE_ID;
		delete process.env.TMUX;
		delete process.env.TMUX_PANE;
		process.env.LIV_HERDR_CAPTURE = capture;
		process.env.LIV_PROC_STAGE_FILE = stageFile;
		delete process.env.LIV_SCREEN;
		delete process.env.LIV_PANE_GONE;
		delete process.env.LIV_PROC_FAIL;
		delete process.env.LIV_PROC_STAGED;
		const herdr = freshJiti()("./interactive-subagents/pi-extension/subagents/herdr.ts");

		// Failure class 1: pi never seen (bare shell) + grace expiry →
		// no-agent, bounded, and pollForExit itself closes nothing.
		process.env.LIV_PROC_MODE = "shell";
		const noAgentStart = Date.now();
		// Grace 400ms (not 120ms): each poll spawns the stub herdr (a node
		// process, ~50-80ms on macOS), and the >=2 process-info assertion below
		// needs at least two completed polls even on slow hosts.
		const noAgent = await withTimeout(
			herdr.pollForExit("wL:p2", new AbortController().signal, {
				interval: 20,
				startupGraceMs: 400,
				maxWaitMs: 60_000,
			}),
			4000,
			"no-agent poll",
		);
		assert.ok(Date.now() - noAgentStart < 2000, "no-agent fires at the grace bound, not forever");
		assert.deepEqual(noAgent, { reason: "no-agent", exitCode: null });
		const noAgentCalls = callsOf(capture);
		assert.ok(noAgentCalls.filter((c) => c[1] === "process-info").length >= 2);
		assert.equal(
			noAgentCalls.some((c) => (c[1] === "close") || (c[0] === "tab" && c[1] === "close")),
			false,
			"pollForExit itself must not close anything",
		);

		// #294 compat: seen-then-gone (tick1 = pi, tick2 = shell-only)
		// still reports a clean agent-gone completion.
		rmSync(stageFile, { force: true });
		process.env.LIV_PROC_STAGED = "1";
		const agentGone = await herdr.pollForExit("wL:p2", new AbortController().signal, {
			interval: 20,
		});
		assert.deepEqual(agentGone, { reason: "agent-gone", exitCode: 0 });
		delete process.env.LIV_PROC_STAGED;

		// A foreground child listed alongside pi (pgid members) is NOT gone:
		// the pi entry keeps the pane alive until the hard deadline.
		process.env.LIV_PROC_MODE = "pi-child";
		const childKept = await herdr.pollForExit("wL:p2", new AbortController().signal, {
			interval: 20,
			startupGraceMs: 50,
			maxWaitMs: 160,
		});
		assert.deepEqual(childKept, { reason: "timeout", exitCode: null });

		// Failure class 2: a live-but-wedged pi hits the hard deadline. A
		// zero deadline exercises the final harvest deterministically.
		process.env.LIV_PROC_MODE = "pi";
		assert.deepEqual(
			await herdr.pollForExit("wL:p2", new AbortController().signal, { interval: 20, maxWaitMs: 0 }),
			{ reason: "timeout", exitCode: null },
			"deadline with nothing to harvest → timeout, null exit code",
		);
		assert.deepEqual(
			await herdr.pollForExit("wL:p2", new AbortController().signal, { interval: 20, maxWaitMs: 0 }),
			{ reason: "timeout", exitCode: null },
			"a live pi at a zero deadline still times out",
		);
		process.env.LIV_SCREEN = "__SUBAGENT_DONE_5__";
		assert.deepEqual(
			await herdr.pollForExit("wL:p2", new AbortController().signal, { interval: 20, maxWaitMs: 0 }),
			{ reason: "sentinel", exitCode: 5 },
			"the deadline harvest reveals a landed sentinel's real exit code",
		);
		delete process.env.LIV_SCREEN;

		// Read-failure threshold: 3 consecutive process-info failures with a
		// GONE pane probe → the killed path.
		const killedStart = Date.now();
		process.env.LIV_PROC_FAIL = "1";
		process.env.LIV_PANE_GONE = "1";
		const killed = await withTimeout(
			herdr.pollForExit("wL:p2", new AbortController().signal, {
				interval: 20,
				processInfoFailLimit: 3,
				maxWaitMs: 60_000,
			}),
			4000,
			"killed poll",
		);
		assert.ok(Date.now() - killedStart < 2000, "read failures resolve quickly when the pane is gone");
		assert.deepEqual(killed, { reason: "killed", exitCode: 130 });

		// Read failures with the pane still ALIVE: keep waiting past the
		// threshold — only the deadline ends it, and the pane-existence probe
		// ran, so the failures were counted, not trusted.
		delete process.env.LIV_PANE_GONE;
		const aliveCallsBefore = callsOf(capture).length;
		const keptWaiting = await herdr.pollForExit("wL:p2", new AbortController().signal, {
			interval: 20,
			processInfoFailLimit: 3,
			maxWaitMs: 320,
		});
		assert.deepEqual(keptWaiting, { reason: "timeout", exitCode: null });
		const keptCalls = callsOf(capture).slice(aliveCallsBefore);
		const procInfoAttempts = keptCalls.filter((c) => c[1] === "process-info").length;
		const existenceProbes = keptCalls.filter(
			(c) => c[0] === "pane" && c[1] === "get" && c[2] === "wL:p2",
		).length;
		assert.ok(procInfoAttempts >= 5, `kept polling past the failure threshold (${procInfoAttempts})`);
		assert.ok(existenceProbes >= 1, "the pane-existence probe ran after the threshold");
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		delete process.env.LIV_HERDR_CAPTURE;
		delete process.env.LIV_PROC_STAGE_FILE;
		delete process.env.LIV_SCREEN;
		delete process.env.LIV_PANE_GONE;
		delete process.env.LIV_PROC_FAIL;
		delete process.env.LIV_PROC_STAGED;
		delete process.env.LIV_PROC_MODE;
		rmSync(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// tmux twin — the same core matrix through fake tmux + fake ps bins (tmux
// has no process-info: the pane tree comes from pane_pid + ps).
// ---------------------------------------------------------------------------
{
	const root = mkdtempSync(join(tmpdir(), "subagent-liveness-tmux-"));
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	const capture = join(root, "calls");
	const psCapture = join(root, "ps-calls");
	const stageFile = join(root, "ps-stage");
	writeFileSync(
		join(bin, "tmux"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$LIV_TMUX_CAPTURE"
printf '%s\\n' --call-- >> "$LIV_TMUX_CAPTURE"
case "$1" in
	capture-pane) printf '%s\\n' "$LIV_SCREEN" ;;
	display-message)
		case "$5" in
			'#{pane_pid}')
				[ "$LIV_PANE_PID_FAIL" = 1 ] && exit 1
				printf '%s\\n' 4242
				;;
			'#{pane_id}')
				[ "$LIV_PANE_GONE" = 1 ] && exit 1
				printf '%s\\n' '%12'
				;;
		esac
		;;
	*) exit 0 ;;
esac
`,
		{ mode: 0o755 },
	);
	writeFileSync(
		join(bin, "ps"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$LIV_PS_CAPTURE"
printf '%s\\n' --call-- >> "$LIV_PS_CAPTURE"
if [ "$LIV_PS_FAIL" = 1 ]; then exit 1; fi
if [ "$LIV_PS_STAGED" = 1 ]; then
	stage=0
	[ -f "$LIV_PS_STAGE_FILE" ] && stage=$(cat "$LIV_PS_STAGE_FILE")
	stage=$((stage + 1))
	printf '%s' "$stage" > "$LIV_PS_STAGE_FILE"
	if [ "$stage" = 1 ]; then
		printf '%s\\n' "4242 1 zsh -l"
		printf '%s\\n' "5001 4242 bash /tmp/launch.sh"
		printf '%s\\n' "5002 5001 pi --session x.jsonl"
	else
		printf '%s\\n' "4242 1 zsh -l"
	fi
	exit 0
fi
case "$LIV_PS_MODE" in
	pi)
		printf '%s\\n' "4242 1 zsh -l"
		printf '%s\\n' "5001 4242 bash /tmp/launch.sh"
		printf '%s\\n' "5002 5001 pi --session x.jsonl"
		;;
	pi-child)
		printf '%s\\n' "4242 1 zsh -l"
		printf '%s\\n' "5001 4242 bash /tmp/launch.sh"
		printf '%s\\n' "5002 5001 pi --session x.jsonl"
		printf '%s\\n' "6001 5002 bash -c sleep 30"
		;;
	*)
		printf '%s\\n' "4242 1 zsh -l"
		;;
esac
`,
		{ mode: 0o755 },
	);
	const saved = {
		PATH: process.env.PATH,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		TMUX: process.env.TMUX,
		TMUX_PANE: process.env.TMUX_PANE,
	};
	try {
		process.env.PATH = `${bin}:${saved.PATH}`;
		delete process.env.HERDR_ENV;
		delete process.env.HERDR_PANE_ID;
		process.env.TMUX = "/tmp/fake-liveness-socket,1,0";
		process.env.TMUX_PANE = "%5";
		process.env.LIV_TMUX_CAPTURE = capture;
		process.env.LIV_PS_CAPTURE = psCapture;
		process.env.LIV_PS_STAGE_FILE = stageFile;
		delete process.env.LIV_SCREEN;
		delete process.env.LIV_PANE_PID_FAIL;
		delete process.env.LIV_PANE_GONE;
		delete process.env.LIV_PS_FAIL;
		delete process.env.LIV_PS_STAGED;
		const tmux = freshJiti()("./interactive-subagents/pi-extension/subagents/tmux.ts");

		// The pure state machine matches the herdr contract exactly.
		assert.equal(tmux.isPiForegroundProcess({ name: "pi", argv: ["pi"] }), true);
		assert.equal(tmux.isPiForegroundProcess({ name: "bash", argv: ["/usr/local/bin/pi"] }), true);
		assert.equal(tmux.isPiForegroundProcess({ name: "nvim", argv: ["nvim"] }), false);
		assert.deepEqual(tmux.updateAgentLiveness(false, [{ name: "zsh", argv: ["zsh"] }]), {
			seenAgent: false,
			agentGone: false,
		}, "startup shell must never count as agent-gone");
		assert.deepEqual(
			tmux.updateAgentLiveness(true, [{ name: "zsh", argv: ["zsh"] }]),
			{ seenAgent: true, agentGone: true },
		);
		assert.deepEqual(tmux.updateAgentLiveness(true, null), {
			seenAgent: true,
			agentGone: false,
		}, "transient foreground-read failure keeps polling");

		// Failure class 1: bare pane (shell tree, no pi) + grace → no-agent.
		process.env.LIV_PS_MODE = "shell";
		const noAgent = await withTimeout(
			tmux.pollForExit("%12", new AbortController().signal, {
				interval: 20,
				startupGraceMs: 120,
				maxWaitMs: 60_000,
			}),
			4000,
			"tmux no-agent poll",
		);
		assert.deepEqual(noAgent, { reason: "no-agent", exitCode: null });

		// Seen-then-gone: the staged ps tree shows pi on tick 1, only the
		// shell afterwards → clean agent-gone completion.
		rmSync(stageFile, { force: true });
		process.env.LIV_PS_STAGED = "1";
		assert.deepEqual(
			await tmux.pollForExit("%12", new AbortController().signal, { interval: 20 }),
			{ reason: "agent-gone", exitCode: 0 },
		);
		delete process.env.LIV_PS_STAGED;

		// A tool child in pi's process tree is NOT gone (pgid members).
		process.env.LIV_PS_MODE = "pi-child";
		assert.deepEqual(
			await tmux.pollForExit("%12", new AbortController().signal, {
				interval: 20,
				startupGraceMs: 50,
				maxWaitMs: 160,
			}),
			{ reason: "timeout", exitCode: null },
			"a child alongside pi keeps the watcher waiting (until the deadline)",
		);

		// Failure class 2 + deadline harvest, deterministic at a zero deadline.
		process.env.LIV_PS_MODE = "pi";
		assert.deepEqual(
			await tmux.pollForExit("%12", new AbortController().signal, { interval: 20, maxWaitMs: 0 }),
			{ reason: "timeout", exitCode: null },
		);
		process.env.LIV_SCREEN = "__SUBAGENT_DONE_9__";
		assert.deepEqual(
			await tmux.pollForExit("%12", new AbortController().signal, { interval: 20, maxWaitMs: 0 }),
			{ reason: "sentinel", exitCode: 9 },
		);
		delete process.env.LIV_SCREEN;

		// Read-failure threshold with a gone pane → killed; with an alive
		// pane → keep polling past the threshold until the deadline.
		process.env.LIV_PS_MODE = "pi";
		process.env.LIV_PANE_PID_FAIL = "1";
		process.env.LIV_PANE_GONE = "1";
		assert.deepEqual(
			await withTimeout(
				tmux.pollForExit("%12", new AbortController().signal, {
					interval: 20,
					processInfoFailLimit: 3,
					maxWaitMs: 60_000,
				}),
				4000,
				"tmux killed poll",
			),
			{ reason: "killed", exitCode: 130 },
		);
		delete process.env.LIV_PANE_GONE;
		const aliveCallsBefore = callsOf(capture).length;
		assert.deepEqual(
			await tmux.pollForExit("%12", new AbortController().signal, {
				interval: 20,
				processInfoFailLimit: 3,
				maxWaitMs: 320,
			}),
			{ reason: "timeout", exitCode: null },
		);
		const keptCalls = callsOf(capture).slice(aliveCallsBefore);
		const pidReads = keptCalls.filter(
			(c) => c[0] === "display-message" && c[4] === "#{pane_pid}",
		).length;
		const probes = keptCalls.filter(
			(c) => c[0] === "display-message" && c[4] === "#{pane_id}",
		).length;
		assert.ok(pidReads >= 5, `kept polling past the failure threshold (${pidReads})`);
		assert.ok(probes >= 1, "the pane-existence probe ran after the threshold");
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		delete process.env.LIV_TMUX_CAPTURE;
		delete process.env.LIV_PS_CAPTURE;
		delete process.env.LIV_PS_STAGE_FILE;
		delete process.env.LIV_SCREEN;
		delete process.env.LIV_PANE_PID_FAIL;
		delete process.env.LIV_PANE_GONE;
		delete process.env.LIV_PS_FAIL;
		delete process.env.LIV_PS_STAGED;
		delete process.env.LIV_PS_MODE;
		rmSync(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// index.ts watcher end-to-end — the whole extension loads through the stub
// aliases, the real `subagent` tool execute runs against a staged fake-herdr
// bin, and every death path drives the REAL harvest, clean close, and
// subagent_result steer with `details.status` saying WHY it died.
// ---------------------------------------------------------------------------
{
	const root = mkdtempSync(join(tmpdir(), "subagent-liveness-e2e-"));
	const bin = join(root, "bin");
	const capture = join(root, "calls");
	const sessionDir = join(root, "sessions");
	const configDir = join(root, "agent-config");
	const stubDir = join(root, "stubs");
	mkdirSync(bin, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });
	mkdirSync(configDir, { recursive: true });
	mkdirSync(stubDir, { recursive: true });
	const parentSessionFile = join(sessionDir, "parent.jsonl");
	// The worker profile's extension tools (web_search, web_fetch, mermaid,
	// tuicr, tuicr_reply) must be discoverable in the child's agent dir —
	// the subagent tool's spawn gate refuses a profile naming tools no
	// source provides (C30).
	for (const dir of ["web-search", "web-fetch"]) {
		mkdirSync(join(configDir, "extensions", dir), { recursive: true });
		writeFileSync(join(configDir, "extensions", dir, "index.ts"), "export {};\n");
	}
	for (const file of ["mermaid.ts", "tuicr.ts"]) {
		writeFileSync(join(configDir, "extensions", file), "export {};\n");
	}
	writeFileSync(
		parentSessionFile,
		JSON.stringify({ type: "session", version: 3, id: "parent-id", cwd: root, timestamp: new Date().toISOString() }) + "\n",
	);
	writeFileSync(
		join(bin, "herdr"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$LIV_E2E_CAPTURE"
printf '%s\\n' --call-- >> "$LIV_E2E_CAPTURE"
case "$1:$2" in
	pane:get) printf '%s\\n' '{"result":{"pane":{"pane_id":"wE:p1","tab_id":"wE:t1","workspace_id":"wE"}}}' ;;
	tab:create) printf '%s\\n' '{"result":{"root_pane":{"pane_id":"wE:p2"}}}' ;;
	pane:run) printf '%s\\n' '{"result":{}}' ;;
	agent:get) printf '%s\\n' '{"result":{"agent":{"agent_status":"idle"}}}' ;;
	agent:prompt) printf '%s\\n' '{"result":{}}' ;;
	pane:read) printf '%s\\n' "$LIV_E2E_SCREEN" ;;
	pane:process-info)
		if [ "$LIV_E2E_PROC" = shell ]; then
			printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":200,"argv":["zsh"]}]}}}'
		else
			printf '%s\\n' '{"result":{"process_info":{"foreground_processes":[{"name":"zsh","pid":200,"argv":["zsh"]},{"name":"pi","pid":201,"argv":["pi"]}]}}}'
		fi
		;;
	tab:close) printf '%s\\n' '{"result":{}}' ;;
	pane:close) printf '%s\\n' '{"result":{}}' ;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	writeFileSync(
		join(stubDir, "agent.cjs"),
		"exports.defineTool = (tool) => tool;\nexports.keyHint = () => 'hint';\n",
	);
	writeFileSync(
		join(stubDir, "ai.cjs"),
		"exports.Type = new Proxy({}, { get: () => (...args) => ({ args }) });\n",
	);
	writeFileSync(
		join(stubDir, "tui.cjs"),
		[
			"exports.Box = class Box { constructor(...a) { this.a = a; } };",
			"exports.Text = class Text { constructor(text) { this.text = text; } render() { return String(this.text).split('\\n'); } };",
			"exports.truncateToWidth = (text, width) => String(text).slice(0, Math.max(0, width));",
			"exports.visibleWidth = (text) => String(text).length;",
			"",
		].join("\n"),
	);
	const saved = {
		PATH: process.env.PATH,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID,
		TMUX: process.env.TMUX,
		TMUX_PANE: process.env.TMUX_PANE,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_SUBAGENT_AGENT: process.env.PI_SUBAGENT_AGENT,
		PI_SUBAGENT_ALLOWED: process.env.PI_SUBAGENT_ALLOWED,
		PI_SUBAGENT_POLL_MS: process.env.PI_SUBAGENT_POLL_MS,
		PI_SUBAGENT_MAX_WAIT_MS: process.env.PI_SUBAGENT_MAX_WAIT_MS,
		PI_SUBAGENT_STARTUP_GRACE_MS: process.env.PI_SUBAGENT_STARTUP_GRACE_MS,
		PI_SUBAGENT_SHELL_READY_DELAY_MS: process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS,
	};
	try {
		process.env.PATH = `${bin}:${saved.PATH}`;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "wE:p1";
		delete process.env.HERDR_WORKSPACE_ID;
		delete process.env.TMUX;
		delete process.env.TMUX_PANE;
		process.env.PI_CODING_AGENT_DIR = configDir;
		delete process.env.PI_SUBAGENT_AGENT;
		delete process.env.PI_SUBAGENT_ALLOWED;
		process.env.PI_SUBAGENT_POLL_MS = "25";
		process.env.PI_SUBAGENT_STARTUP_GRACE_MS = "150";
		process.env.PI_SUBAGENT_MAX_WAIT_MS = "1500";
		process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = "0";
		process.env.LIV_E2E_CAPTURE = capture;
		delete process.env.LIV_E2E_SCREEN;
		process.env.LIV_E2E_PROC = "pi";

		const sentMessages = [];
		const registeredTools = new Map();
		const handlers = {};
		const fakePi = {
			registerTool: (tool) => registeredTools.set(tool.name, tool),
			registerCommand() {},
			registerMessageRenderer() {},
			registerShortcut() {},
			getAllTools: () => [],
			on: (name, handler) => { handlers[name] = handler; },
			events: { on() {}, emit() {} },
			sendMessage: (message, opts) => {
				sentMessages.push({ message, opts });
			},
		};
		const e2e = createJiti(import.meta.url, {
			alias: {
				"@earendil-works/pi-coding-agent": join(stubDir, "agent.cjs"),
				"@earendil-works/pi-ai": join(stubDir, "ai.cjs"),
				"@earendil-works/pi-tui": join(stubDir, "tui.cjs"),
			},
		})(new URL("./interactive-subagents/pi-extension/subagents/index.ts", import.meta.url).href);
		const hooks = e2e.__test__;
		e2e.default(fakePi);
		handlers.session_start?.({}, {});

		const subagentTool = registeredTools.get("subagent");
		assert.ok(subagentTool, "the subagent tool is registered");
		const spawn = (task) =>
			subagentTool.execute(
				"call-liveness",
				{ agent: "worker", task },
				new AbortController().signal,
				undefined,
				{
					sessionManager: {
						getSessionFile: () => parentSessionFile,
						getSessionId: () => "parent-id",
						getSessionDir: () => sessionDir,
					},
					cwd: root,
				},
			);
		const steerFor = async (name, budgetMs = 4000) => {
			const started = Date.now();
			for (;;) {
				const steer = sentMessages.find(
					(entry) => entry.message.customType === "subagent_result" && entry.message.details?.name === name,
				);
				if (steer) return steer;
				assert.ok(Date.now() - started < budgetMs, `subagent_result steer for ${name} never arrived`);
				await new Promise((resolve) => setTimeout(resolve, 15));
			}
		};
		const writeChildSession = (sessionFile, text) => {
			writeFileSync(
				sessionFile,
				[
					JSON.stringify({ type: "session", version: 3, id: "child-id", cwd: root, timestamp: new Date().toISOString() }),
					JSON.stringify({ type: "message", id: "c1", message: { role: "user", content: [{ type: "text", text: "Work." }] } }),
					JSON.stringify({
						type: "message",
						id: "c2",
						message: {
							role: "assistant",
							model: "test-model",
							content: [{ type: "text", text }],
							usage: { input: 5, output: 7, totalTokens: 12, cost: { total: 0.1 } },
						},
					}),
				].join("\n") + "\n",
			);
		};

		// Watchdog sweep unit: a past-deadline watcher is aborted, a future
		// one is not, and sweeping again is a no-op.
		{
			const pastAbort = new AbortController();
			const futureAbort = new AbortController();
			hooks.registerActiveWatcher(
				{ id: "sweep-past", surface: "wE:p2", abortController: pastAbort },
				Date.now() - 1000,
			);
			hooks.registerActiveWatcher(
				{ id: "sweep-future", surface: "wE:p2", abortController: futureAbort },
				Date.now() + 60_000,
			);
			assert.equal(hooks.sweepExpiredSubagents(), 1, "only the past-deadline watcher is swept");
			assert.equal(pastAbort.signal.aborted, true);
			assert.equal(futureAbort.signal.aborted, false);
			assert.equal(hooks.sweepExpiredSubagents(), 1, "sweeping again changes nothing (idempotent)");
			hooks.unregisterActiveWatcher("sweep-past");
			hooks.unregisterActiveWatcher("sweep-future");
			assert.equal(hooks.sweepExpiredSubagents(), 0, "unregistered watchers are never swept");
		}

		// Scenario 1 — no-agent: pi never appears; the steer says why, and
		// the whole tab (not just the pane) closes so siblings cannot orphan.
		{
			process.env.LIV_E2E_PROC = "shell";
			const ack = await spawn("Summarize the repo.");
			const name = ack.details.name;
			const callsBefore = callsOf(capture).length;
			const steer = await steerFor(name);
			assert.equal(steer.message.details.status, "no-agent");
			assert.equal(steer.message.details.exitCode, 1);
			assert.match(steer.message.content, /never started/);
			assert.doesNotMatch(steer.message.content, /completed/);
			assert.equal(steer.opts.deliverAs, "steer");
			assert.equal(steer.opts.triggerTurn, true);
			const calls = callsOf(capture).slice(callsBefore);
			assert.ok(
				calls.some((c) => c[0] === "tab" && c[1] === "close" && c[2] === "wE:t1"),
				"no-agent closes the whole tab",
			);
			assert.equal(hooks.runningSubagents.size, 0, "the dead subagent is deregistered");
			assert.equal(hooks.activeWatchers.size, 0, "its watcher registration is released");
		}

		// Scenario 2 — timeout with partial harvest: a wedged-but-alive pi
		// hits the deadline; the partial session output rides the steer.
		{
			process.env.LIV_E2E_PROC = "pi";
			process.env.PI_SUBAGENT_MAX_WAIT_MS = "250";
			const ack = await spawn("Keep working.");
			const name = ack.details.name;
			const running = [...hooks.runningSubagents.values()].at(-1);
			assert.ok(running, "the subagent is registered as running");
			writeChildSession(running.sessionFile, "Halfway: 2 of 5 files done.");
			const callsBefore = callsOf(capture).length;
			const steer = await steerFor(name);
			assert.equal(steer.message.details.status, "timeout");
			assert.equal(steer.message.details.exitCode, 1);
			assert.equal(steer.message.details.partial, true);
			assert.match(steer.message.content, /timed out/);
			assert.match(steer.message.content, /partial results attached/i);
			assert.match(steer.message.content, /Halfway: 2 of 5 files done\./);
			assert.ok(steer.message.details.stats, "partial stats ride along");
			const calls = callsOf(capture).slice(callsBefore);
			assert.ok(
				calls.some((c) => c[0] === "tab" && c[1] === "close" && c[2] === "wE:t1"),
				"timeout closes the whole tab (no orphaned attach pane)",
			);
			assert.equal(hooks.runningSubagents.size, 0);
			assert.equal(hooks.activeWatchers.size, 0);
			process.env.PI_SUBAGENT_MAX_WAIT_MS = "1500";
		}

		// Scenario 3 — watchdog sweep rescue: the poll sleeps past its own
		// deadline and the module watchdog aborts it; the captain still sees
		// a timeout (never a silent wait, never a wrong "cancelled").
		{
			process.env.LIV_E2E_PROC = "pi";
			process.env.PI_SUBAGENT_POLL_MS = "150";
			process.env.PI_SUBAGENT_MAX_WAIT_MS = "50";
			const ack = await spawn("Wedged run.");
			const name = ack.details.name;
			const steer = await steerFor(name);
			assert.equal(steer.message.details.status, "timeout");
			assert.doesNotMatch(steer.message.content, /cancelled/i);
			const steersForName = sentMessages.filter(
				(entry) => entry.message.customType === "subagent_result" && entry.message.details?.name === name,
			);
			assert.equal(steersForName.length, 1, "exactly one completion steer — no double-steer");
			assert.equal(hooks.runningSubagents.size, 0);
			process.env.PI_SUBAGENT_POLL_MS = "25";
			process.env.PI_SUBAGENT_MAX_WAIT_MS = "1500";
		}

		// Scenario 4 — agent-gone compat (#294's staging): pi seen, then the
		// pane holds only a shell → clean completion, harvest, status says so.
		{
			process.env.LIV_E2E_PROC = "pi";
			process.env.PI_SUBAGENT_POLL_MS = "120";
			const ack = await spawn("Almost done.");
			const name = ack.details.name;
			const running = [...hooks.runningSubagents.values()].at(-1);
			assert.ok(running);
			writeChildSession(running.sessionFile, "All done: 3 files.");
			// Flip the staged tree to shell-only only after the first tick has
			// actually read the pane's foreground processes (pi present), so the
			// liveness fallback fires with a real harvest — #294's staging.
			const procCallsBefore = callsOf(capture)
				.filter((c) => c[1] === "process-info" && c[2] === "--pane" && c[3] === running.surface).length;
			const flipStart = Date.now();
			for (;;) {
				const now = callsOf(capture)
					.filter((c) => c[1] === "process-info" && c[2] === "--pane" && c[3] === running.surface).length;
				if (now > procCallsBefore) break;
				assert.ok(Date.now() - flipStart < 4000, "first liveness tick never ran");
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			process.env.LIV_E2E_PROC = "shell";
			const steer = await steerFor(name);
			assert.equal(steer.message.details.status, "agent-gone");
			assert.equal(steer.message.details.exitCode, 0);
			assert.match(steer.message.content, /completed/);
			assert.match(steer.message.content, /All done: 3 files\./);
			assert.equal(hooks.runningSubagents.size, 0);
		}

		// Teardown: shutdown clears the watchdog so this process can exit.
		handlers.session_shutdown?.({}, {});
		assert.equal(hooks.activeWatchers.size, 0);
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		delete process.env.LIV_E2E_CAPTURE;
		delete process.env.LIV_E2E_SCREEN;
		delete process.env.LIV_E2E_PROC;
		rmSync(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// no-mistakes bridge — waitTabReady and discoverSessionFile carry bounded
// deadlines (env-overridable), so a step tab that never reports ready or
// never surfaces a session file cannot wedge the orchestrator.
// ---------------------------------------------------------------------------
{
	const root = mkdtempSync(join(tmpdir(), "subagent-liveness-bridge-"));
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, "herdr"),
		`#!/bin/sh
case "$1:$2" in
	agent:get) printf '%s\\n' '{"result":{"agent":{"agent_status":"'"$LIV_BRIDGE_STATUS"'"}}}' ;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	const saved = {
		PATH: process.env.PATH,
		NM_BRIDGE_POLL_MS: process.env.NM_BRIDGE_POLL_MS,
		NM_TAB_READY_TIMEOUT_MS: process.env.NM_TAB_READY_TIMEOUT_MS,
		NM_SESSION_DISCOVER_TIMEOUT_MS: process.env.NM_SESSION_DISCOVER_TIMEOUT_MS,
	};
	try {
		process.env.PATH = `${bin}:${saved.PATH}`;
		process.env.NM_BRIDGE_POLL_MS = "25";
		process.env.NM_TAB_READY_TIMEOUT_MS = "120";
		process.env.NM_SESSION_DISCOVER_TIMEOUT_MS = "120";
		const bridge = freshJiti()("./no-mistakes-pane/bridge.ts");
		assert.equal(bridge.TAB_READY_TIMEOUT_MS, 120, "NM_TAB_READY_TIMEOUT_MS overrides the deadline");
		assert.equal(bridge.SESSION_DISCOVER_TIMEOUT_MS, 120, "NM_SESSION_DISCOVER_TIMEOUT_MS overrides the deadline");

		// A tab that never becomes ready rejects at the deadline, quickly.
		process.env.LIV_BRIDGE_STATUS = "unknown";
		const readyStart = Date.now();
		await assert.rejects(bridge.waitTabReady("wB:p1"), /never became ready/);
		assert.ok(Date.now() - readyStart < 2000, "the readiness wait is deadline-bounded");

		// A blocked tab rejects immediately with the actionable reason.
		process.env.LIV_BRIDGE_STATUS = "blocked";
		await assert.rejects(bridge.waitTabReady("wB:p1"), /blocked during startup/);

		// A tab that never surfaces a session file rejects at its deadline.
		process.env.LIV_BRIDGE_STATUS = "idle";
		const discoverStart = Date.now();
		await assert.rejects(
			bridge.discoverSessionFile({ paneId: "wB:p1" }, {}, undefined),
			/could not discover the tab agent's session file/,
		);
		assert.ok(Date.now() - discoverStart < 2000, "the discovery wait is deadline-bounded");
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		delete process.env.LIV_BRIDGE_STATUS;
		rmSync(root, { recursive: true, force: true });
	}
}

console.log("PASS subagent-liveness");
