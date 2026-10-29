import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);
// The extension only type-imports the agent package, but keep the same stub
// mechanism as every other suite so a future value import cannot start
// resolving against the real (unavailable) package in CI.
const tempRoot = mkdtempSync(join(tmpdir(), "opengateway-test-"));
const stubPi = join(tempRoot, "pi-agent.cjs");
writeFileSync(stubPi, "exports.registerCommand = () => {};\n");
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": stubPi },
});

try {
	const ext = jiti("./opengateway.ts");

	// --- factory registration -------------------------------------------------

	assert.equal(typeof ext.default, "function", "default export must be a factory");

	const registrations = [];
	const apiCalls = [];
	ext.default({
		registerProvider: (name, config) => {
			registrations.push({ name, config });
		},
		registerCommand: () => {
			apiCalls.push("registerCommand");
		},
	});

	assert.equal(registrations.length, 1, "exactly one provider registration");
	assert.equal(apiCalls.length, 0, "no other extension APIs used");
	const [registration] = registrations;
	assert.equal(registration.name, "opengateway");

	// --- provider configuration ------------------------------------------------

	const { config } = registration;
	assert.equal(config.name, "OpenGateway");
	assert.equal(config.baseUrl, "https://apis.opengateway.ai/v1");
	assert.equal(config.api, "openai-completions");
	// Env interpolation spec, not a literal key — the secret stays in ~/.env.
	assert.equal(config.apiKey, "$OPENGATEWAY_API_KEY");
	// openai-completions never adds Authorization itself; authHeader must be on.
	assert.equal(config.authHeader, true);
	assert.equal(config.refreshModels, undefined, "static single-model provider");

	// --- model metadata ----------------------------------------------------------

	const models = config.models;
	assert.equal(models.length, 1);
	const model = models[0];
	assert.equal(model.id, "deepseek/deepseek-v4.1-flash-ultrafast");
	assert.equal(model.name, "DeepSeek V4.1 Flash UltraFast");
	assert.equal(model.reasoning, true);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.equal(model.contextWindow, 1_000_000);
	assert.equal(model.maxTokens, 65_536);
	// List prices per million tokens (promos bill lower at the gateway).
	assert.deepEqual(model.cost, { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 });
	// Only the standard effort set is exposed through the gateway.
	assert.deepEqual(model.thinkingLevelMap, { minimal: null, xhigh: null, max: null });
	// No cache-warming without a published retention lifetime.
	assert.equal(model.promptCache, undefined);

	console.log("opengateway.test.mjs: all assertions passed");
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
