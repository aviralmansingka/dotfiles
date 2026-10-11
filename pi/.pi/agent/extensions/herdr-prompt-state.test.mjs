import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { HOMEBREW_JITI, NVM_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI, NVM_JITI] });
const { createJiti } = require(jitiPath);
const extension = createJiti(import.meta.url)("./herdr-prompt-state.ts").default;
const handlers = new Map();
const emitted = [];
const pi = {
	on(event, handler) {
		handlers.set(event, handler);
	},
	events: {
		emit(event, data) {
			emitted.push({ event, data });
		},
	},
};

extension(pi);
handlers.get("ui_prompt_start")({ kind: "custom" });
handlers.get("ui_prompt_end")({ kind: "custom" });
handlers.get("ui_prompt_start")({ kind: "confirm", title: "Approve deployment?" });

assert.deepEqual(emitted, [
	{ event: "herdr:blocked", data: { active: true, label: "Waiting for user input" } },
	{ event: "herdr:blocked", data: { active: false } },
	{ event: "herdr:blocked", data: { active: true, label: "Approve deployment?" } },
]);

console.log("herdr prompt state tests passed");
