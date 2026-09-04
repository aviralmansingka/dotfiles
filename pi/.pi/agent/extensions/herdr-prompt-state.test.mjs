import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jitiPath = [
	process.env.JITI_PATH,
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));

if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");

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
