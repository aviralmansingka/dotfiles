// Fast mode: gpt-* requests on the openai/openai-codex providers must carry
// service_tier: "priority", unless the payload already sets a tier, the model
// is not a gpt model, the provider is someone else, or fast mode is off. This
// suite pins those rules, the copy-not-mutate contract, the Fireworks Fast
// sibling mapping, and the `/fast` command's session override (which beats the
// PI_FAST_MODE default at load).
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

// Fireworks chat catalogue: two ids with a Fast sibling, one without.
const fireworksIds = ["glm-latest", "glm-fast-latest", "kimi-k3", "kimi-k3-fast", "deepseek-v3", "auto"];

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
		baseIdFor,
		default: fastMode,
		fastIdFor,
		fastModeEnabled,
		siblingModel,
	} = jiti("./fast-mode.ts");

	// --- payload rewrite -------------------------------------------------------

	const gptModel = { provider: "openai", id: "gpt-5.5" };
	const base = { model: "gpt-5.5", input: [{ role: "user", content: "hi" }] };

	const fast = applyFastMode(base, gptModel);
	assert.deepEqual(fast, { ...base, service_tier: "priority" }, "openai gpt model gets priority");
	assert.equal(base.service_tier, undefined, "incoming payload is never mutated");
	assert.notEqual(fast, base, "a copy is returned, not the input");
	assert.equal(applyFastMode(base, gptModel, false), undefined, "state off leaves the payload alone");

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
	assert.equal(
		applyFastMode({ model: "glm-latest" }, { provider: "fireworks", id: "glm-latest" }),
		undefined,
		"fireworks speed is a model swap, never a service tier",
	);
	assert.equal(applyFastMode({ model: "gpt-5.5" }, undefined), undefined, "no model is untouched");
	assert.equal(applyFastMode(null, gptModel), undefined, "null payload is untouched");

	const flex = { model: "gpt-5.5", service_tier: "flex" };
	assert.equal(applyFastMode(flex, gptModel), undefined, "an explicit tier wins");
	assert.equal(flex.service_tier, "flex", "an explicit tier is preserved");

	// --- PI_FAST_MODE default --------------------------------------------------

	for (const value of ["off", "OFF", " 0 ", "false", "No"]) {
		assert.equal(fastModeEnabled({ PI_FAST_MODE: value }), false, `${value} disables`);
		assert.equal(applyFastMode(base, gptModel, fastModeEnabled({ PI_FAST_MODE: value })), undefined);
	}
	assert.equal(fastModeEnabled({ PI_FAST_MODE: "1" }), true, "any other value keeps fast mode on");
	assert.equal(fastModeEnabled({}), true, "unset keeps fast mode on");
	assert.deepEqual(applyFastMode(base, gptModel, fastModeEnabled({})), { ...base, service_tier: "priority" });

	process.env.PI_FAST_MODE = "off";
	assert.equal(applyFastMode(base, gptModel), undefined, "process.env kill switch is honored");
	delete process.env.PI_FAST_MODE;

	// --- Fireworks sibling mapping --------------------------------------------

	assert.equal(fastIdFor("glm-latest"), "glm-fast-latest", "-latest takes -fast before it");
	assert.equal(fastIdFor("kimi-k3"), "kimi-k3-fast", "a plain id gains a -fast suffix");
	assert.equal(baseIdFor("glm-fast-latest"), "glm-latest", "-fast-latest maps back to -latest");
	assert.equal(baseIdFor("kimi-k3-fast"), "kimi-k3", "-fast maps back to the plain id");
	assert.equal(fastIdFor("glm-fast-latest"), undefined, "an already-fast id has no fast sibling");
	assert.equal(baseIdFor("glm-latest"), undefined, "a base id has no base sibling");
	assert.equal(baseIdFor("auto"), undefined, "a non-fast id is not a fast variant");

	assert.equal(
		siblingModel({ provider: "fireworks", id: "glm-latest" }, [
			{ provider: "fireworks", id: "glm-latest" },
			{ provider: "fireworks", id: "glm-fast-latest" },
		], "fast")?.id,
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

	// --- hook registration -----------------------------------------------------

	assert.equal(typeof fastMode, "function", "default export must be a factory");
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
	assert.equal(hook({ payload: base }, { model: gptModel }), undefined, "/fast off stops the rewrite");
	assert.match(openaiNotes.at(-1).message, /Fast mode OFF/, "off is reported");

	await command.handler("on", openaiCtx);
	assert.equal(hook({ payload: base }, { model: gptModel }).service_tier, "priority", "/fast on re-enables");

	await command.handler("toggle", openaiCtx);
	assert.equal(hook({ payload: base }, { model: gptModel }), undefined, "toggle flips it off");
	await command.handler("toggle", openaiCtx);
	assert.equal(hook({ payload: base }, { model: gptModel }).service_tier, "priority", "toggle flips it back on");

	await command.handler("", openaiCtx);
	assert.match(openaiNotes.at(-1).message, /^Fast mode ON — gpt-5\.5: OpenAI priority tier/, "reports state");

	await command.handler("maybe", openaiCtx);
	assert.match(openaiNotes.at(-1).message, /Usage: \/fast \[on \| off \| toggle\]/, "unknown argument prints usage");

	// PI_FAST_MODE=off only sets the load-time default; /fast on beats it.
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

	console.log("fast-mode.test.mjs: all assertions passed");
} finally {
	if (savedFastMode === undefined) delete process.env.PI_FAST_MODE;
	else process.env.PI_FAST_MODE = savedFastMode;
	rmSync(tempRoot, { recursive: true, force: true });
}
