// Fast mode: gpt-* requests on the openai/openai-codex providers must carry
// service_tier: "priority" while the session state is on, unless the payload
// already sets a tier. The /fast command drives that state (default on,
// PI_FAST_MODE=off at load, session override afterwards) and swaps Fireworks
// models between base ids and their Fast router siblings. This suite pins the
// payload rules, the sibling mapping, and the command contract — fake-only,
// no live sessions, nvim, tmux, or herdr.
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
	const {
		applyFastMode,
		fastModeEnabled,
		fastVariantId,
		baseVariantId,
		fireworksSibling,
		default: fastMode,
	} = jiti("./fast-mode.ts");

	// --- payload rewrite -------------------------------------------------------

	const gptModel = { provider: "openai", id: "gpt-5.5" };
	const base = { model: "gpt-5.5", input: [{ role: "user", content: "hi" }] };

	const fast = applyFastMode(base, gptModel);
	assert.deepEqual(fast, { ...base, service_tier: "priority" }, "on state gives openai gpt model priority");
	assert.equal(base.service_tier, undefined, "incoming payload is never mutated");
	assert.notEqual(fast, base, "a copy is returned, not the input");
	assert.equal(applyFastMode(base, gptModel, false), undefined, "state off leaves the payload alone");

	assert.deepEqual(
		applyFastMode({ model: "gpt-5.1-codex" }, { provider: "openai-codex", id: "gpt-5.1-codex" }, true),
		{ model: "gpt-5.1-codex", service_tier: "priority" },
		"openai-codex gpt model gets priority",
	);

	// --- untouched cases -------------------------------------------------------

	assert.equal(applyFastMode({ model: "o3" }, { provider: "openai", id: "o3" }), undefined, "non-gpt id untouched");
	assert.equal(
		applyFastMode({ model: "gpt-5.5" }, { provider: "fireworks", id: "gpt-5.5" }, true),
		undefined,
		"fireworks never gets service_tier (reliability path, not speed)",
	);
	assert.equal(
		applyFastMode({ model: "glm-latest" }, { provider: "fireworks", id: "glm-latest" }, true),
		undefined,
		"fireworks speed is a model swap, never a service tier",
	);
	assert.equal(applyFastMode({ model: "gpt-5.5" }, undefined, true), undefined, "no model is untouched");
	assert.equal(applyFastMode(null, gptModel, true), undefined, "null payload is untouched");

	const flex = { model: "gpt-5.5", service_tier: "flex" };
	assert.equal(applyFastMode(flex, gptModel, true), undefined, "an explicit tier wins");
	assert.equal(flex.service_tier, "flex", "an explicit tier is preserved");

	// --- session state replaces the raw env ------------------------------------

	assert.equal(applyFastMode(base, gptModel, false), undefined, "off state leaves payloads untouched");
	assert.deepEqual(applyFastMode(base, gptModel, true), { ...base, service_tier: "priority" }, "on state rewrites");
	assert.deepEqual(applyFastMode(base, gptModel), { ...base, service_tier: "priority" }, "default state is on");

	for (const value of ["off", "OFF", " 0 ", "false", "No"]) {
		assert.equal(fastModeEnabled({ PI_FAST_MODE: value }), false, `${value} disables at load`);
	}
	assert.equal(fastModeEnabled({ PI_FAST_MODE: "1" }), true, "any other value keeps fast mode on");
	assert.equal(fastModeEnabled({}), true, "unset keeps fast mode on");

	// --- Fireworks sibling mapping ---------------------------------------------

	assert.equal(fastVariantId("glm-latest"), "glm-fast-latest", "base -> fast inserts -fast before -latest");
	assert.equal(fastVariantId("kimi-k3"), "kimi-k3-fast", "base -> fast appends -fast");
	assert.equal(baseVariantId("glm-fast-latest"), "glm-latest", "fast -> base drops -fast before -latest");
	assert.equal(baseVariantId("kimi-k3-fast"), "kimi-k3", "fast -> base drops trailing -fast");

	const fwIds = [
		"glm-latest", "glm-fast-latest", "kimi-k3", "kimi-k3-fast",
		"deepseek-v3", "minimax-m2", "auto", "firerouter-fx", "gpt-oss-120b",
	];
	assert.equal(fireworksSibling("glm-latest", fwIds), "glm-fast-latest", "glm base resolves to fast sibling");
	assert.equal(fireworksSibling("kimi-k3", fwIds), "kimi-k3-fast", "kimi base resolves to fast sibling");
	assert.equal(fireworksSibling("glm-fast-latest", fwIds), "glm-latest", "glm fast resolves to base sibling");
	assert.equal(fireworksSibling("kimi-k3-fast", fwIds), "kimi-k3", "kimi fast resolves to base sibling");
	for (const alone of ["deepseek-v3", "minimax-m2", "auto", "firerouter-fx", "gpt-oss-120b"]) {
		assert.equal(fireworksSibling(alone, fwIds), undefined, `${alone} has no sibling and returns undefined`);
	}
	assert.equal(fireworksSibling("", fwIds), undefined, "empty id returns undefined");

	// --- command + hook wiring (stub pi, stub ctx) ------------------------------

	function makeSession(env) {
		if (env === undefined) delete process.env.PI_FAST_MODE;
		else process.env.PI_FAST_MODE = env;
		const hooks = new Map();
		const commands = new Map();
		const calls = { setModel: [], notify: [] };
		let setModelResult = true;
		fastMode({
			on: (name, handler) => hooks.set(name, handler),
			registerCommand: (name, command) => commands.set(name, command),
			setModel: async (model) => {
				calls.setModel.push(model);
				return setModelResult;
			},
		});
		const fwModels = fwIds.map((id) => ({ provider: "fireworks", id }));
		const makeCtx = (model) => ({
			model,
			modelRegistry: {
				getModelsOfType: (type, provider) =>
					type === "chat" && provider === "fireworks" ? fwModels : [],
			},
			ui: { notify: (message, kind) => calls.notify.push({ message, kind }) },
		});
		return {
			hook: hooks.get("before_provider_request"),
			fast: commands.get("fast"),
			calls,
			makeCtx,
			setSetModelResult: (value) => {
				setModelResult = value;
			},
		};
	}

	assert.equal(typeof fastMode, "function", "default export must be a factory");
	const wiring = makeSession();
	assert.equal(typeof wiring.hook, "function", "registers the before_provider_request hook");
	assert.equal(typeof wiring.fast?.handler, "function", "registers the /fast command");
	const hookThrough = () => wiring.hook({ payload: base }, { model: gptModel });

	// default on; /fast off stops the rewrite; /fast on re-enables it
	assert.equal(hookThrough().service_tier, "priority", "session default is on");
	await wiring.fast.handler("off", wiring.makeCtx(gptModel));
	assert.equal(hookThrough(), undefined, "/fast off stops the payload rewrite");
	assert.equal(wiring.calls.setModel.length, 0, "openai models never swap");
	await wiring.fast.handler("on", wiring.makeCtx(gptModel));
	assert.equal(hookThrough().service_tier, "priority", "/fast on re-enables the rewrite");
	await wiring.fast.handler("toggle", wiring.makeCtx(gptModel));
	assert.equal(hookThrough(), undefined, "toggle flips on -> off");
	await wiring.fast.handler("toggle", wiring.makeCtx(gptModel));
	assert.equal(hookThrough().service_tier, "priority", "toggle flips off -> on");

	// env-off default is overridden by /fast on
	const envOff = makeSession("off");
	assert.equal(envOff.hook({ payload: base }, { model: gptModel }), undefined, "PI_FAST_MODE=off disables at load");
	await envOff.fast.handler("on", envOff.makeCtx(gptModel));
	assert.equal(
		envOff.hook({ payload: base }, { model: gptModel }).service_tier,
		"priority",
		"/fast on beats the env-off default",
	);

	// /fast on swaps a fireworks base model to its Fast sibling
	const glm = makeSession();
	await glm.fast.handler("on", glm.makeCtx({ provider: "fireworks", id: "glm-latest" }));
	assert.deepEqual(glm.calls.setModel, [{ provider: "fireworks", id: "glm-fast-latest" }], "swaps to the Fast sibling");
	assert.match(glm.calls.notify.at(-1).message, /glm-latest -> glm-fast-latest/, "reports the swap");
	assert.equal(glm.calls.notify.at(-1).kind, "info");

	// /fast off swaps back from a Fast sibling to the base model
	const kimi = makeSession();
	await kimi.fast.handler("off", kimi.makeCtx({ provider: "fireworks", id: "kimi-k3-fast" }));
	assert.deepEqual(kimi.calls.setModel, [{ provider: "fireworks", id: "kimi-k3" }], "swaps back to the base model");
	assert.match(kimi.calls.notify.at(-1).message, /kimi-k3-fast -> kimi-k3/, "reports the swap back");

	// no-sibling ids never swap
	const deepseek = makeSession();
	await deepseek.fast.handler("on", deepseek.makeCtx({ provider: "fireworks", id: "deepseek-v3" }));
	assert.equal(deepseek.calls.setModel.length, 0, "no sibling means no swap");
	assert.match(deepseek.calls.notify.at(-1).message, /no Fast sibling/, "reports the missing sibling");
	assert.equal(deepseek.calls.notify.at(-1).kind, "warning");

	// setModel failure is reported, not swallowed
	const failing = makeSession();
	failing.setSetModelResult(false);
	await failing.fast.handler("on", failing.makeCtx({ provider: "fireworks", id: "kimi-k3" }));
	assert.deepEqual(failing.calls.setModel, [{ provider: "fireworks", id: "kimi-k3-fast" }], "swap was attempted");
	assert.match(failing.calls.notify.at(-1).message, /could not switch/, "reports the failed switch");
	assert.equal(failing.calls.notify.at(-1).kind, "warning");

	// no-argument report: state, model id, and what fast mode does for it
	const report = makeSession();
	await report.fast.handler("", report.makeCtx(gptModel));
	assert.equal(report.calls.notify.length, 1, "no-arg only reports");
	assert.match(report.calls.notify[0].message, /ON.*gpt-5\.5.*OpenAI priority tier/, "openai report");
	await report.fast.handler("off", report.makeCtx(gptModel));
	await report.fast.handler("", report.makeCtx(gptModel));
	assert.match(report.calls.notify.at(-1).message, /OFF/, "state change is reported");
	await report.fast.handler("", report.makeCtx({ provider: "fireworks", id: "glm-latest" }));
	assert.match(report.calls.notify.at(-1).message, /glm-fast-latest available/, "fireworks sibling report");
	await report.fast.handler("", report.makeCtx({ provider: "anthropic", id: "claude-4" }));
	assert.match(report.calls.notify.at(-1).message, /no fast variant/, "other providers report no fast variant");

	// unknown argument prints usage and changes nothing
	const usage = makeSession();
	await usage.fast.handler("warp", usage.makeCtx(gptModel));
	assert.equal(usage.calls.notify.length, 1, "usage is the only output");
	assert.match(usage.calls.notify[0].message, /[Uu]sage.*\/fast/, "usage names the command");
	assert.equal(usage.calls.notify[0].kind, "warning");
	assert.equal(
		usage.hook({ payload: base }, { model: gptModel }).service_tier,
		"priority",
		"state unchanged by unknown argument",
	);

	console.log("fast-mode.test.mjs: all assertions passed");
} finally {
	if (savedFastMode === undefined) delete process.env.PI_FAST_MODE;
	else process.env.PI_FAST_MODE = savedFastMode;
	rmSync(tempRoot, { recursive: true, force: true });
}
