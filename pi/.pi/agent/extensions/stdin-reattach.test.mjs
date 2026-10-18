import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolveJiti } from "./test-lib/jiti.mjs";

// stdin-reattach: arms only on a tty stdin, arms once per process, registers
// a zero-height widget to capture the TUI, and never arms in piped modes.
// (The full recovery path — reopen, rewire, repaint — is exercised by the
// repro harness against a real pty, not here: triggering 'end' in-process
// would attempt real device opens.)

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

const tempRoot = mkdtempSync(join(tmpdir(), "stdin-reattach-test-"));
const stubAgent = join(tempRoot, "pi-coding-agent.cjs");
const stubTui = join(tempRoot, "pi-tui.cjs");
writeFileSync(stubAgent, "exports.defineTool = (t) => t;\n");
writeFileSync(stubTui, "class Text { constructor(t) { this.text = t; } }\nexports.Text = Text;\n");

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	interopDefault: true,
	alias: {
		"@earendil-works/pi-coding-agent": stubAgent,
		"@earendil-works/pi-tui": stubTui,
	},
});

const EXT = new URL("./stdin-reattach.ts", import.meta.url).pathname;
const ARMED = Symbol.for("pi-extensions/stdin-reattach");

function freshLoad() {
	delete globalThis[ARMED];
	return jiti.import(EXT);
}

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

// The tty-name probe must never throw or block in a non-tty test runner.
const realReadlink = (await import("node:fs")).readlinkSync;

async function main() {
	// 1. Piped stdin: no listeners, no widget.
	const widgets1 = [];
	await withStdinTTY(false, async () => {
		const mod = await freshLoad();
		const pi = {
			on: (name, fn) => {
				if (name === "session_start") fn({}, { ui: { setWidget: (k, f) => widgets1.push(k) } });
			},
		};
		mod.default(pi);
	});
	assert.equal(widgets1.length, 0, "piped stdin must not register the widget");
	assert.equal(process.stdin.listenerCount("end"), 0, "piped stdin must not arm end");
	assert.equal(process.stdin.listenerCount("SIGHUP") > 0, false, "piped stdin must not arm SIGHUP");

	// 2. TTY stdin: arms end/close + SIGHUP, registers the capture widget,
	//    and the widget factory yields a zero-text component.
	const widgets2 = [];
	await withStdinTTY(true, async () => {
		const mod = await freshLoad();
		let factory;
		const pi = {
			on: (name, fn) => {
				if (name === "session_start") fn({}, { ui: { setWidget: (k, f) => { widgets2.push(k); factory = f; } } });
			},
		};
		mod.default(pi);
		assert.ok(factory, "widget factory registered");
		const component = factory({ requestRender() {} }, {});
		assert.equal(component.text, "", "capture widget renders zero rows");
	});
	assert.equal(widgets2[0], "stdin-reattach");
	assert.equal(process.stdin.listenerCount("end"), 1, "tty arms one end listener");
	assert.equal(process.stdin.listenerCount("close"), 1, "tty arms one close listener");
	assert.ok(process.listenerCount("SIGHUP") >= 1, "tty arms SIGHUP handling");

	// 3. Arm-once across reloads.
	await withStdinTTY(true, async () => {
		const mod = await jiti.import(EXT);
		mod.default({ on: () => {} });
	});
	assert.equal(process.stdin.listenerCount("end"), 1, "reload must not double-arm");
	assert.equal(process.stdin.listenerCount("close"), 1, "reload must not double-arm close");

	// Leave nothing armed for later suites.
	process.stdin.removeAllListeners("end");
	process.stdin.removeAllListeners("close");
	delete globalThis[ARMED];
	console.log("stdin-reattach: ok (piped no-arm, tty arm + widget capture, arm-once)");
}

await main();
