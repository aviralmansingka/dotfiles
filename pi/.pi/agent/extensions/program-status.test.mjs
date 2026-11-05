// Paths: pi/.pi/agent/extensions/program-status.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { HOMEBREW_JITI, NVM_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI, NVM_JITI] });
const { createJiti } = require(jitiPath);
const {
	createReporter,
	defineProgramStatus,
	encodeReport,
	encodeText,
	shouldReport,
	singleLine,
	truncateUtf8,
} = createJiti(import.meta.url)("./program-status.ts");

const b64 = text => Buffer.from(text, "utf8").toString("base64");
const seq = pairs => `\u001b]7501;${pairs}\u001b\\`;

test("a working report names the app and encodes the message", () => {
	assert.equal(
		encodeReport({ state: "working", msg: "Working" }),
		seq(`state=working:app=pi:msg=${b64("Working")}`),
	);
});

test("a blocked report carries its kind and one line of reason", () => {
	const report = encodeReport({ state: "blocked", kind: "permission", msg: "Approve?\nPlease\tallow" });
	assert.equal(
		report,
		seq(`state=blocked:app=pi:kind=permission:msg=${b64("Approve? Please allow")}`),
	);
});

test("progress stays inside the protocol range and is omitted when absent", () => {
	assert.match(encodeReport({ state: "working", progress: 140 }), /progress=100/);
	assert.match(encodeReport({ state: "working", progress: -3 }), /progress=0(?!\d)/);
	assert.doesNotMatch(encodeReport({ state: "working" }), /progress=/);
});

test("a message loses control characters before it is encoded", () => {
	assert.equal(singleLine("a\u0000b\u001bc\u007fd"), "a b c d");
	assert.equal(encodeText("two\nlines"), b64("two lines"));
});

test("a very long message is cut at the UTF-8 byte limit", () => {
	const cut = truncateUtf8("é".repeat(2000), 100);
	assert.ok(Buffer.byteLength(cut, "utf8") <= 100);
	assert.equal(cut.length, 50);
});

test("the reporter writes once per state change and repeats nothing", () => {
	const seen = [];
	const reporter = createReporter(text => seen.push(text));
	reporter.working();
	reporter.working();
	reporter.blocked("Need an answer");
	reporter.idle();
	assert.equal(seen.length, 3);
	assert.match(seen[0], /state=working/);
	assert.match(seen[1], /state=blocked:app=pi:kind=question/);
	assert.match(seen[2], /state=idle/);
});

test("reporting needs a terminal and a Rex block unless it is forced", () => {
	assert.equal(shouldReport({ REX_BLOCK: "block:1" }, true), true);
	assert.equal(shouldReport({ REX_SESSION: "session:1" }, true), true);
	assert.equal(shouldReport({ TERM_PROGRAM: "rex" }, true), true);
	assert.equal(shouldReport({}, true), false);
	assert.equal(shouldReport({ REX_BLOCK: "block:1" }, false), false);
	assert.equal(shouldReport({ REX_BLOCK: "block:1", PI_PROGRAM_STATUS: "0" }, true), false);
	assert.equal(shouldReport({ PI_PROGRAM_STATUS: "1" }, true), true);
});

/** A minimal pi stub: it stores handlers and lets a test fire them. */
function fakePi() {
	const handlers = new Map();
	return {
		on(event, handler) {
			handlers.set(event, handler);
		},
		fire(event, payload) {
			handlers.get(event)?.(payload);
		},
		has(event) {
			return handlers.has(event);
		},
	};
}

test("the lifecycle maps to working, blocked, and idle", () => {
	const seen = [];
	const pi = fakePi();
	const reporter = defineProgramStatus(pi, {
		write: text => seen.push(text),
		env: { REX_BLOCK: "block:1" },
		isTTY: true,
	});
	assert.ok(reporter);
	for (const event of ["agent_start", "agent_settled", "ui_prompt_start", "ui_prompt_end", "session_shutdown"]) {
		assert.ok(pi.has(event), `no handler for ${event}`);
	}
	pi.fire("agent_start");
	pi.fire("ui_prompt_start", { title: "Run the migration?" });
	pi.fire("ui_prompt_end");
	pi.fire("ui_prompt_end", {});
	pi.fire("agent_settled");
	assert.match(seen[0], /state=working/);
	assert.match(seen[1], new RegExp(`state=blocked:app=pi.*msg=${b64("Run the migration?")}`));
	assert.match(seen[2], /state=working/);
	assert.match(seen[3], /state=idle/);
	assert.equal(seen.length, 4, "a repeated working report is not written twice");
	pi.fire("session_shutdown", { reason: "quit" });
	assert.equal(seen.length, 5);
	assert.match(seen[4], /state=clear/);
});

test("nothing is wired outside a Rex terminal", () => {
	const pi = fakePi();
	assert.equal(defineProgramStatus(pi, { env: {}, isTTY: true }), null);
	assert.equal(pi.has("agent_start"), false);
});
