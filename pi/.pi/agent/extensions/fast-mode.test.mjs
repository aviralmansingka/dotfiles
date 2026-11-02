// Fast mode: gpt-* requests on the openai/openai-codex providers must carry
// service_tier: "priority", unless the payload already sets a tier, the model
// is not a gpt model, the provider is someone else, or PI_FAST_MODE is a falsy
// word. This suite pins those rules plus the copy-not-mutate contract.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);
// The extension only type-imports the agent package; stub it so no value
// import can reach for the real (unavailable) package in CI.
const tempRoot = mkdtempSync(join(tmpdir(), "fast-mode-test-"));
const stubPi = join(tempRoot, "pi-coding-agent.cjs");
writeFileSync(stubPi, "module.exports = {};\n");
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": stubPi },
});

const savedFastMode = process.env.PI_FAST_MODE;
delete process.env.PI_FAST_MODE;

try {
	const { applyFastMode, default: fastMode } = jiti("./fast-mode.ts");

	// --- payload rewrite -------------------------------------------------------

	const gptModel = { provider: "openai", id: "gpt-5.5" };
	const base = { model: "gpt-5.5", input: [{ role: "user", content: "hi" }] };

	const fast = applyFastMode(base, gptModel);
	assert.deepEqual(fast, { ...base, service_tier: "priority" }, "openai gpt model gets priority");
	assert.equal(base.service_tier, undefined, "incoming payload is never mutated");
	assert.notEqual(fast, base, "a copy is returned, not the input");

	assert.deepEqual(
		applyFastMode({ model: "gpt-5.1-codex" }, { provider: "openai-codex", id: "gpt-5.1-codex" }),
		{ model: "gpt-5.1-codex", service_tier: "priority" },
		"openai-codex gpt model gets priority",
	);

	// --- untouched cases -------------------------------------------------------

	assert.equal(
		applyFastMode({ model: "o3" }, { provider: "openai", id: "o3" }),
		undefined,
		"non-gpt model id is untouched",
	);
	assert.equal(
		applyFastMode({ model: "gpt-5.5" }, { provider: "fireworks", id: "gpt-5.5" }),
		undefined,
		"other providers are untouched",
	);
	assert.equal(applyFastMode({ model: "gpt-5.5" }, undefined), undefined, "no model is untouched");
	assert.equal(applyFastMode(null, gptModel), undefined, "null payload is untouched");

	const flex = { model: "gpt-5.5", service_tier: "flex" };
	assert.equal(applyFastMode(flex, gptModel), undefined, "an explicit tier wins");
	assert.equal(flex.service_tier, "flex", "an explicit tier is preserved");

	// --- kill switch -----------------------------------------------------------

	for (const value of ["off", "OFF", " 0 ", "false", "No"]) {
		assert.equal(applyFastMode(base, gptModel, { PI_FAST_MODE: value }), undefined, `${value} disables`);
	}
	assert.deepEqual(
		applyFastMode(base, gptModel, { PI_FAST_MODE: "1" }),
		{ ...base, service_tier: "priority" },
		"any other value keeps fast mode on",
	);
	assert.deepEqual(
		applyFastMode(base, gptModel, {}),
		{ ...base, service_tier: "priority" },
		"unset keeps fast mode on",
	);

	process.env.PI_FAST_MODE = "off";
	assert.equal(applyFastMode(base, gptModel), undefined, "process.env kill switch is honored");
	delete process.env.PI_FAST_MODE;

	// --- hook registration -----------------------------------------------------

	assert.equal(typeof fastMode, "function", "default export must be a factory");
	const handlers = new Map();
	fastMode({ on: (name, handler) => handlers.set(name, handler) });
	const handler = handlers.get("before_provider_request");
	assert.equal(typeof handler, "function", "registers the before_provider_request hook");
	assert.equal(handlers.size, 1, "no other hooks registered");

	const replaced = handler({ type: "before_provider_request", payload: base }, { model: gptModel });
	assert.equal(replaced.service_tier, "priority", "hook returns the rewritten payload");
	assert.equal(handler({ payload: base }, {}), undefined, "missing session model is a no-op");

	console.log("fast-mode.test.mjs: all assertions passed");
} finally {
	if (savedFastMode === undefined) delete process.env.PI_FAST_MODE;
	else process.env.PI_FAST_MODE = savedFastMode;
	rmSync(tempRoot, { recursive: true, force: true });
}
