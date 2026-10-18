import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolveJiti } from "./test-lib/jiti.mjs";

// stdin-death-guard: arms only on a tty stdin, arms once per process, and
// converts stdin EOF into a recorded entry plus process.exit(129).

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

const tempRoot = mkdtempSync(join(tmpdir(), "stdin-guard-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	interopDefault: true,
	require: { alias: { "@earendil-works/pi-coding-agent": stubAgent } },
});

const EXT = new URL("./stdin-death-guard.ts", import.meta.url).pathname;
const ARMED = Symbol.for("pi-extensions/stdin-death-guard");

function freshLoad() {
	delete globalThis[ARMED];
	return jiti.import(EXT);
}

// Control the tty flag around each case.
async function withStdinTTY(tty, fn) {
	const had = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
	Object.defineProperty(process.stdin, "isTTY", { value: tty, configurable: true });
	try {
		return await fn();
	} finally {
		if (had) Object.defineProperty(process.stdin, "isTTY", had);
		else delete process.stdin.isTTY;
	}
}

async function main() {
	const exits = [];
	const realExit = process.exit;
	process.exit = (code) => {
		exits.push(code);
	};
	try {
		// 1. Piped stdin (rpc/json/print): must not arm at all.
		const entries1 = [];
		await withStdinTTY(false, async () => {
			const mod = await freshLoad();
			const pi = { appendEntry: (t, d) => entries1.push([t, d]) };
			mod.default(pi);
		});
		assert.equal(exits.length, 0, "piped stdin must not exit");
		assert.equal(process.stdin.listenerCount("end"), 0, "piped stdin must not arm listeners");

		// 2. TTY stdin: EOF on the stream exits 129 with a recorded entry.
		const entries2 = [];
		await withStdinTTY(true, async () => {
			const mod = await freshLoad();
			const pi = { appendEntry: (t, d) => entries2.push([t, d]) };
			mod.default(pi);
		});
		assert.equal(process.stdin.listenerCount("end"), 1, "tty stdin arms the end listener");
		process.stdin.emit("end");
		assert.equal(exits.length, 1, "stdin end exits exactly once");
		assert.equal(exits[0], 129, "exit code mirrors emergencyTerminalExit");
		assert.equal(entries2.length, 1, "exit records one session entry");
		assert.equal(entries2[0][0], "stdin_eof_exit");
		assert.equal(entries2[0][1].reason, "end");

		// 3. Arm-once across reloads: the process-level flag survives a
		// module re-load (extension reload); the re-armed default() must be a
		// no-op, and a second EOF signal must not exit again.
		const mod3 = await jiti.import(EXT);
		mod3.default({});
		assert.equal(process.stdin.listenerCount("end"), 0, "reload must not re-arm after a fired once-listener");
		assert.equal(process.stdin.listenerCount("close"), 1, "reload must not stack a second close listener");
		process.stdin.emit("close");
		assert.equal(exits.length, 1, "already-exited guard does not exit again");

		// Remove the listeners the test armed so later suites are unaffected.
		process.stdin.removeAllListeners("end");
		process.stdin.removeAllListeners("close");
	} finally {
		process.exit = realExit;
		delete globalThis[ARMED];
	}
	console.log("stdin-death-guard: ok (piped no-arm, tty exit 129 + entry, arm-once)");
}

await main();
