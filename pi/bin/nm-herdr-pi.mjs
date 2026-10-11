#!/usr/bin/env node
// nm-herdr-pi — the pi step-agent shim for the no-mistakes Herdr bridge.
//
// The no-mistakes daemon launches this instead of real pi through
// `agent_path_override.pi` in ~/.no-mistakes/config.yaml. To the daemon it
// behaves exactly like pi: it consumes the prompt on stdin, prints pi
// json-mode JSONL on stdout, and exits with pi-like status.
//
// Bridge mode (only when the parent session is alive and hosting):
//   - The run id is the cwd basename (a ULID, same derivation as the
//     no-mistakes-pane extension's bridge server).
//   - The parent creates `$NM_HOME/herdr-bridge/<run-id>` only after it first
//     observes the run, so the shim waits for that dir (bounded), then for
//     its socket, connects, and hands the invocation over: the parent session
//     opens a visible Herdr subagent tab that runs real pi interactively, and
//     streams translated json-mode events back over the socket. This shim
//     writes them to stdout.
//   - A `fatal` message from the server (tab could not open or settle) exits
//     1 with the reason on stderr, so the daemon's own retry/fallback logic
//     takes over exactly as it would for a failing headless agent.
//
// Passthrough mode (the default whenever no bridge is alive): exec real pi
// with the same argv, stdin, stdio, and signals. Runs that outlive the
// parent session, daemon restarts, and non-Herdr contexts are unchanged.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const BRIDGE_WAIT_MS = Number(process.env.NM_HERDR_BRIDGE_WAIT_MS ?? 5000);
const CONNECT_RETRIES = 8;
const POLL_MS = 200;
const ENV_PREFIXES = [/^NO_MISTAKES_/, /^NM_/, /^GIT_/];

function nmHome() {
	return process.env.NM_HOME ?? join(homedir(), ".no-mistakes");
}

function runIdOf(cwd) {
	const name = basename(resolve(cwd));
	return ULID.test(name) ? name : undefined;
}

function realPiPath() {
	const override = process.env.NM_HERDR_REAL_PI;
	if (override && existsSync(override)) return override;
	const candidate = join(homedir(), ".pi", "agent", "bin", "pi");
	if (existsSync(candidate)) return candidate;
	return "pi";
}

function sleep(ms) {
	return new Promise((done) => setTimeout(done, ms));
}

function pickEnv() {
	const out = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (ENV_PREFIXES.some((pattern) => pattern.test(key))) out[key] = value;
	}
	return out;
}

let pendingWrites = 0;
let pendingExit = null;

function writeDrained(stream, text) {
	pendingWrites++;
	stream.write(text, () => {
		pendingWrites--;
		exitIfDrained();
	});
}

function exitIfDrained() {
	if (pendingExit !== null && pendingWrites <= 0) {
		const code = pendingExit;
		pendingExit = null;
		process.exit(code);
	}
}

function passthrough(prompt) {
	const child = spawn(realPiPath(), process.argv.slice(2), {
		stdio: [prompt === null ? "inherit" : "pipe", "inherit", "inherit"],
		env: process.env,
	});
	if (prompt !== null) {
		child.stdin.on("error", () => {});
		child.stdin.end(prompt);
	}
	const forward = (signal) => {
		try {
			child.kill(signal);
		} catch {}
	};
	process.on("SIGTERM", () => forward("SIGTERM"));
	process.on("SIGINT", () => forward("SIGINT"));
	child.on("exit", (code, signal) => {
		if (signal) {
			try {
				process.kill(process.pid, signal);
			} catch {
				process.exit(1);
			}
		} else {
			process.exit(code ?? 0);
		}
	});
}

function readStdinFully() {
	return new Promise((done) => {
		const chunks = [];
		process.stdin.on("data", (chunk) => chunks.push(chunk));
		process.stdin.on("end", () => done(Buffer.concat(chunks)));
		process.stdin.on("error", () => done(Buffer.concat(chunks)));
	});
}

function isSocket(path) {
	try {
		return statSync(path).isSocket?.() === true || (statSync(path).mode & 0o170000) === 0o140000;
	} catch {
		return false;
	}
}

async function connectWithRetries(sockPath) {
	for (let attempt = 0; attempt < CONNECT_RETRIES; attempt++) {
		const socket = await new Promise((done) => {
			const s = createConnection(sockPath);
			s.once("connect", () => done(s));
			s.once("error", () => {
				s.destroy();
				done(null);
			});
		});
		if (socket) return socket;
		await sleep(POLL_MS);
	}
	return null;
}

async function bridgeMode(sockPath, prompt) {
	const socket = await connectWithRetries(sockPath);
	if (!socket) {
		process.stderr.write("nm-herdr-pi: bridge socket refused connection; falling back to headless pi\n");
		passthrough(prompt);
		return;
	}

	let buffer = "";
	let finished = false;
	const writeStdout = (text) => {
		pendingWrites++;
		if (!process.stdout.write(text, () => {
			pendingWrites--;
			exitIfDrained();
		})) {
			socket.pause();
			process.stdout.once("drain", () => socket.resume());
		}
	};
	const exitBridge = (code, error) => {
		if (finished) return;
		finished = true;
		if (error) writeDrained(process.stderr, `nm-herdr-pi: ${error}\n`);
		try {
			socket.destroy();
		} catch {}
		pendingExit = code;
		exitIfDrained();
	};

	process.on("SIGTERM", () => {
		if (!socket.destroyed) {
			try {
				socket.write(JSON.stringify({ type: "killed" }) + "\n");
			} catch {}
		}
		exitBridge(0);
	});

	socket.on("error", () => exitBridge(1, "bridge connection lost mid-turn (the daemon will retry or fail the step)"));
	socket.on("close", () => exitBridge(0));
	socket.on("data", (chunk) => {
		buffer += chunk.toString("utf-8");
		let index;
		while ((index = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			if (message?.type === "events" && Array.isArray(message.lines)) {
				for (const eventLine of message.lines) {
					writeStdout(String(eventLine) + "\n");
				}
			} else if (message?.type === "fatal") {
				exitBridge(1, `bridge server: ${message.message ?? "fatal"}`);
			}
		}
	});

	socket.write(
		JSON.stringify({
			type: "hello",
			argv: process.argv.slice(2),
			cwd: process.cwd(),
			env: pickEnv(),
			prompt: prompt.toString("utf-8"),
		}) + "\n",
	);
}

async function main() {
	// A TTY stdin means a human ran this directly: behave like pi itself.
	if (process.stdin.isTTY) {
		passthrough(null);
		return;
	}
	const prompt = await readStdinFully();
	const runId = runIdOf(process.cwd());
	const dir = runId ? join(nmHome(), "herdr-bridge", runId) : undefined;
	if (!dir) {
		passthrough(prompt);
		return;
	}
	const deadline = Date.now() + BRIDGE_WAIT_MS;
	while (!existsSync(dir) && Date.now() < deadline) {
		await sleep(POLL_MS);
	}
	if (!existsSync(dir)) {
		passthrough(prompt);
		return;
	}
	const sockPath = join(dir, "sock");
	while (!isSocket(sockPath) && Date.now() < deadline) {
		await sleep(POLL_MS);
	}
	if (!isSocket(sockPath)) {
		passthrough(prompt);
		return;
	}
	await bridgeMode(sockPath, prompt);
}

main().catch((err) => {
	writeDrained(process.stderr, `nm-herdr-pi: ${err?.stack ?? err}\n`);
	pendingExit = 1;
	exitIfDrained();
});
