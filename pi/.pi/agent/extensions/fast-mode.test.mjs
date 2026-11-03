// Fast mode: gpt-* requests on the openai/openai-codex providers must carry
<<<<<<< Updated upstream
// service_tier: "priority", unless the payload already sets a tier, the model
// is not a gpt model, the provider is someone else, or fast mode is off. This
// suite pins those rules, the copy-not-mutate contract, the Fireworks Fast
// sibling mapping, and the `/fast` command's session override (which beats the
// PI_FAST_MODE default at load).
//
// State is process-wide (globalThis slot, see fast-mode-slot.mjs) because the
// extension loader builds jiti with moduleCache: false: every copy of
// fast-mode.ts has its own closure, so the payload hook, the command, and the
// prompt bubble must read one shared value. The slot cases below cover that
// default, the idempotent double-load, and the command writing through it.
=======
// service_tier: "priority" while the session state is on, unless the payload
// already sets a tier. The /fast command drives that state (default on,
// PI_FAST_MODE=off at load, session override afterwards) and swaps Fireworks
// models between base ids and their Fast router siblings. This suite pins the
// payload rules, the sibling mapping, and the command contract — fake-only,
// no live sessions, nvim, tmux, or herdr.
>>>>>>> Stashed changes
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FAST_MODE_SLOT,
	fastModeEnabled as slotEnabled,
	notifyFastModeChange,
	onFastModeChange,
	setFastModeEnabled,
} from "./fast-mode-slot.mjs";
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

// Fireworks chat catalogue: two ids with a Fast sibling, the rest without.
const fireworksIds = ["glm-latest", "glm-fast-latest", "kimi-k3", "kimi-k3-fast", "deepseek-v3", "auto"];

/** Drop the shared slot so the next read re-resolves the startup default. */
function resetSlot() {
	delete globalThis[FAST_MODE_SLOT];
}

function fakePi() {
	const commands = new Map();
	const handlers = new Map();
	const setModelCalls = [];
	const pi = {
		registerCommand: (name, options) => commands.set(name, options),
		on: (name, handler) => handlers.set(name, handler),
		setModel: async (model) => {
			setModelCalls.push(model);
			return pi.setModelResult;
		},
		setModelResult: true,
	};
	return { pi, commands, handlers, setModelCalls };
}

function fakeCtx(model) {
	const notes = [];
	const ctx = {
		model,
		modelRegistry: {
			getModelsOfType: (type, provider) =>
				type === "chat" && provider === "fireworks"
					? fireworksIds.map((id) => ({ provider: "fireworks", id }))
					: [],
		},
		ui: { notify: (message, level) => notes.push({ message, level }) },
	};
	return { ctx, notes };
}

try {
	const {
		applyFastMode,
<<<<<<< Updated upstream
		baseIdFor,
		default: fastMode,
		fastIdFor,
		fastModeEnabled,
		siblingModel,
=======
		fastModeEnabled,
		fastVariantId,
		baseVariantId,
		fireworksSibling,
		default: fastMode,
>>>>>>> Stashed changes
	} = jiti("./fast-mode.ts");

	// --- payload rewrite -------------------------------------------------------

	const gptModel = { provider: "openai", id: "gpt-5.5" };
	const base = { model: "gpt-5.5", input: [{ role: "user", content: "hi" }] };

<<<<<<< Updated upstream
	const fast = applyFastMode(base, gptModel, true);
	assert.deepEqual(fast, { ...base, service_tier: "priority" }, "openai gpt model gets priority");
=======
	const fast = applyFastMode(base, gptModel);
	assert.deepEqual(fast, { ...base, service_tier: "priority" }, "on state gives openai gpt model priority");
>>>>>>> Stashed changes
	assert.equal(base.service_tier, undefined, "incoming payload is never mutated");
	assert.notEqual(fast, base, "a copy is returned, not the input");
	assert.equal(applyFastMode(base, gptModel, false), undefined, "state off leaves the payload alone");

	assert.deepEqual(
		applyFastMode({ model: "gpt-5.1-codex" }, { provider: "openai-codex", id: "gpt-5.1-codex" }, true),
		{ model: "gpt-5.1-codex", service_tier: "priority" },
		"openai-codex gpt model gets priority",
	);

	// --- untouched cases -------------------------------------------------------

<<<<<<< Updated upstream
	assert.equal(
		applyFastMode({ model: "o3" }, { provider: "openai", id: "o3" }, true),
		undefined,
		"non-gpt model id is untouched",
	);
=======
	assert.equal(applyFastMode({ model: "o3" }, { provider: "openai", id: "o3" }), undefined, "non-gpt id untouched");
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
	// --- PI_FAST_MODE default --------------------------------------------------

	for (const value of ["off", "OFF", " 0 ", "false", "No"]) {
		assert.equal(fastModeEnabled({ PI_FAST_MODE: value }), false, `${value} disables`);
		assert.equal(applyFastMode(base, gptModel, fastModeEnabled({ PI_FAST_MODE: value })), undefined);
=======
	// --- session state replaces the raw env ------------------------------------

	assert.equal(applyFastMode(base, gptModel, false), undefined, "off state leaves payloads untouched");
	assert.deepEqual(applyFastMode(base, gptModel, true), { ...base, service_tier: "priority" }, "on state rewrites");
	assert.deepEqual(applyFastMode(base, gptModel), { ...base, service_tier: "priority" }, "default state is on");

	for (const value of ["off", "OFF", " 0 ", "false", "No"]) {
		assert.equal(fastModeEnabled({ PI_FAST_MODE: value }), false, `${value} disables at load`);
>>>>>>> Stashed changes
	}
	assert.equal(fastModeEnabled({ PI_FAST_MODE: "1" }), true, "any other value keeps fast mode on");
	assert.equal(fastModeEnabled({}), true, "unset keeps fast mode on");

<<<<<<< Updated upstream
	// --- Fireworks sibling mapping --------------------------------------------

	assert.equal(fastIdFor("glm-latest"), "glm-fast-latest", "-latest takes -fast before it");
	assert.equal(fastIdFor("kimi-k3"), "kimi-k3-fast", "a plain id gains a -fast suffix");
	assert.equal(baseIdFor("glm-fast-latest"), "glm-latest", "-fast-latest maps back to -latest");
	assert.equal(baseIdFor("kimi-k3-fast"), "kimi-k3", "-fast maps back to the plain id");
	assert.equal(fastIdFor("glm-fast-latest"), undefined, "an already-fast id has no fast sibling");
	assert.equal(baseIdFor("glm-latest"), undefined, "a base id has no base sibling");
	assert.equal(baseIdFor("auto"), undefined, "a non-fast id is not a fast variant");

	assert.equal(
		siblingModel(
			{ provider: "fireworks", id: "glm-latest" },
			[
				{ provider: "fireworks", id: "glm-latest" },
				{ provider: "fireworks", id: "glm-fast-latest" },
			],
			"fast",
		)?.id,
		"glm-fast-latest",
		"a catalogue sibling is found",
	);
	for (const id of ["deepseek-v3", "auto", "minimax-m2", "firerouter", "gpt-oss-120b"]) {
		assert.equal(
			siblingModel({ provider: "fireworks", id }, [{ provider: "fireworks", id }], "fast"),
			undefined,
			`${id} has no fast sibling and never swaps`,
		);
	}

	// --- shared slot ----------------------------------------------------------

	resetSlot();
	assert.equal(slotEnabled(), true, "the slot defaults to on");
	assert.deepEqual(applyFastMode(base, gptModel), { ...base, service_tier: "priority" }, "default state rewrites");

	resetSlot();
	process.env.PI_FAST_MODE = "off";
	assert.equal(slotEnabled(), false, "the slot's startup default honors PI_FAST_MODE=off");
	delete process.env.PI_FAST_MODE;
	assert.equal(setFastModeEnabled(true), true, "setEnabled returns the new value");
	assert.equal(slotEnabled(), true, "setEnabled writes the shared value");

	// A second copy of the module (extension reload, another jiti instance) must
	// adopt the existing holder — never reset `enabled` to the env default.
	process.env.PI_FAST_MODE = "off";
	const secondCopy = await import(`${new URL("./fast-mode-slot.mjs", import.meta.url).href}?second`);
	delete process.env.PI_FAST_MODE;
	assert.equal(secondCopy.FAST_MODE_SLOT, FAST_MODE_SLOT, "every copy shares one well-known key");
	assert.equal(secondCopy.fastModeEnabled(), true, "a second copy never resets an existing value");

	const seen = [];
	const stop = onFastModeChange((value) => seen.push(value));
	secondCopy.setFastModeEnabled(false);
	secondCopy.notifyFastModeChange();
	assert.deepEqual(seen, [false], "a write through another copy reaches this copy's listener");
	stop();
	notifyFastModeChange();
	assert.deepEqual(seen, [false], "unsubscribe stops delivery");
=======
	// --- Fireworks sibling mapping ---------------------------------------------
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
	resetSlot();
	const session = fakePi();
	fastMode(session.pi);
	const command = session.commands.get("fast");
	assert.equal(typeof command?.handler, "function", "registers the /fast command");
	const hook = session.handlers.get("before_provider_request");
	assert.equal(typeof hook, "function", "registers the before_provider_request hook");
	assert.equal(session.handlers.size, 1, "no other hooks registered");

	const replaced = hook({ type: "before_provider_request", payload: base }, { model: gptModel });
	assert.equal(replaced.service_tier, "priority", "hook returns the rewritten payload");
	assert.equal(hook({ payload: base }, {}), undefined, "missing session model is a no-op");

	// --- /fast state override --------------------------------------------------

	const { ctx: openaiCtx, notes: openaiNotes } = fakeCtx(gptModel);

	await command.handler("off", openaiCtx);
	assert.equal(slotEnabled(), false, "/fast off writes the shared slot");
	assert.equal(hook({ payload: base }, { model: gptModel }), undefined, "/fast off stops the rewrite");
	assert.match(openaiNotes.at(-1).message, /Fast mode OFF/, "off is reported");

	await command.handler("on", openaiCtx);
	assert.equal(slotEnabled(), true, "/fast on writes the shared slot");
	assert.equal(hook({ payload: base }, { model: gptModel }).service_tier, "priority", "/fast on re-enables");

	await command.handler("toggle", openaiCtx);
	assert.equal(slotEnabled(), false, "toggle flips the shared slot off");
	assert.equal(hook({ payload: base }, { model: gptModel }), undefined, "toggle stops the rewrite");
	await command.handler("toggle", openaiCtx);
	assert.equal(hook({ payload: base }, { model: gptModel }).service_tier, "priority", "toggle flips it back on");

	await command.handler("", openaiCtx);
	assert.match(openaiNotes.at(-1).message, /^Fast mode ON — gpt-5\.5: OpenAI priority tier/, "reports state");

	await command.handler("maybe", openaiCtx);
	assert.match(openaiNotes.at(-1).message, /Usage: \/fast \[on \| off \| toggle\]/, "unknown argument prints usage");

	// PI_FAST_MODE=off only sets the load-time default; /fast on beats it.
	resetSlot();
	process.env.PI_FAST_MODE = "off";
	const envOff = fakePi();
	fastMode(envOff.pi);
	const envOffHook = envOff.handlers.get("before_provider_request");
	const { ctx: envOffCtx } = fakeCtx(gptModel);
	assert.equal(envOffHook({ payload: base }, { model: gptModel }), undefined, "env off starts disabled");
	await envOff.commands.get("fast").handler("on", envOffCtx);
	assert.equal(
		envOffHook({ payload: base }, { model: gptModel }).service_tier,
		"priority",
		"/fast on overrides the env default",
	);
	delete process.env.PI_FAST_MODE;

	// --- /fast model swaps (Fireworks only) ------------------------------------

	resetSlot();
	const swapOn = fakePi();
	fastMode(swapOn.pi);
	const swapOnCmd = swapOn.commands.get("fast");
	{
		const { ctx, notes } = fakeCtx({ provider: "fireworks", id: "glm-latest" });
		await swapOnCmd.handler("on", ctx);
		assert.deepEqual(swapOn.setModelCalls, [{ provider: "fireworks", id: "glm-fast-latest" }], "base -> fast sibling");
		assert.match(notes.at(-1).message, /glm-latest -> glm-fast-latest/, "the swap is reported");
	}
	{
		const { ctx, notes } = fakeCtx({ provider: "fireworks", id: "kimi-k3-fast" });
		await swapOnCmd.handler("off", ctx);
		assert.equal(swapOn.setModelCalls.at(-1).id, "kimi-k3", "fast -> base sibling");
		assert.match(notes.at(-1).message, /kimi-k3-fast -> kimi-k3/, "the swap back is reported");
	}
	{
		const before = swapOn.setModelCalls.length;
		const { ctx, notes } = fakeCtx({ provider: "fireworks", id: "deepseek-v3" });
		await swapOnCmd.handler("on", ctx);
		assert.equal(swapOn.setModelCalls.length, before, "a model without a sibling never swaps");
		assert.match(notes.at(-1).message, /deepseek-v3: no fast variant/, "and says so");
	}
	{
		swapOn.pi.setModelResult = false;
		const { ctx, notes } = fakeCtx({ provider: "fireworks", id: "glm-latest" });
		await swapOnCmd.handler("on", ctx);
		assert.equal(notes.at(-1).level, "error", "a rejected setModel is reported as a failure");
		assert.match(notes.at(-1).message, /could not switch to glm-fast-latest/);
		swapOn.pi.setModelResult = true;
	}
	{
		const before = swapOn.setModelCalls.length;
		const { ctx } = fakeCtx(gptModel);
		await swapOnCmd.handler("on", ctx);
		assert.equal(swapOn.setModelCalls.length, before, "OpenAI models never swap; the hook covers them");
	}
=======
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
>>>>>>> Stashed changes

	console.log("fast-mode.test.mjs: all assertions passed");
} finally {
	if (savedFastMode === undefined) delete process.env.PI_FAST_MODE;
	else process.env.PI_FAST_MODE = savedFastMode;
	rmSync(tempRoot, { recursive: true, force: true });
}
