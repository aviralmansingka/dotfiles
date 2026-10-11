import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const jitiPath = [
	process.env.JITI_PATH,
	join(homedir(), ".pi/agent/install/releases/1.1.0/node_modules/jiti/lib/jiti.cjs"),
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
const { createJiti } = require(jitiPath);
const root = mkdtempSync(join(tmpdir(), "edit-relative-paths-test-"));
try {
	// The extension imports the agent package type-only; stub it so jiti
	// resolution cannot reach the real install.
	const agent = join(root, "agent.cjs");
	writeFileSync(agent, "exports.noop = () => {};\n");
	const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": agent } });

	const registrations = [];
	let handler;
	jiti("./edit-relative-paths.ts").default({
		on(event, fn) {
			registrations.push(event);
			assert.equal(event, "tool_call", "the extension registers exactly one tool_call handler");
			handler = fn;
			return () => {};
		},
	});
	assert.equal(registrations.length, 1, "no other event is registered");

	const call = (toolName, path, cwd = join(root, "work")) => {
		const event = { type: "tool_call", toolName, input: path === undefined ? {} : { path } };
		const result = handler(event, { cwd });
		assert.equal(result, undefined, "the handler never blocks a call");
		return event.input.path;
	};

	{
		// Absolute paths under the session cwd rewrite to their relative form.
		assert.equal(call("edit", `${root}/work/pi/.pi/agent/extensions/x.ts`), "pi/.pi/agent/extensions/x.ts");
		assert.equal(call("edit", `${root}/work/x.ts`), "x.ts");
		// Redundant segments collapse through node:path semantics.
		assert.equal(call("edit", `${root}/work/a/../b.ts`), "b.ts");
	}

	{
		// Paths outside the session cwd stay absolute: no valid relative form.
		assert.equal(call("edit", "/etc/hosts"), "/etc/hosts");
		assert.equal(call("edit", `${root}/elsewhere/x.ts`), `${root}/elsewhere/x.ts`);
		// The cwd itself names a directory, not an edit target: untouched.
		assert.equal(call("edit", join(root, "work")), join(root, "work"));
	}

	{
		// Already-relative and tilde paths pass through untouched.
		assert.equal(call("edit", "pi/x.ts"), "pi/x.ts");
		assert.equal(call("edit", "~/notes.md"), "~/notes.md");
	}

	{
		// The rewrite is edit-only: other file tools keep their arguments.
		assert.equal(call("write", `${root}/work/x.ts`), `${root}/work/x.ts`);
		assert.equal(call("read", `${root}/work/x.ts`), `${root}/work/x.ts`);
	}

	{
		// Missing or non-string path never throws and never mutates.
		assert.equal(call("edit", undefined), undefined);
		assert.equal(call("edit", 42), 42);
	}

	{
		// Without a ctx cwd the handler falls back to process.cwd().
		const event = { type: "tool_call", toolName: "edit", input: { path: join(process.cwd(), "x.ts") } };
		handler(event, undefined);
		assert.equal(event.input.path, "x.ts");
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
