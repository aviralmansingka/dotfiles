// Paths: pi/.pi/agent/extensions/interactive-subagents/agents/**
// Role split for auto-exit. A child-role profile parks at the end of its
// step, so the session that waits for its result never wakes. Durable and
// teaching profiles must park: they wait on the human. This suite pins both
// sides, fails if a role list names a profile that does not exist, and fails
// if a shipped profile belongs to no role list.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAgentDefinition } from "./interactive-subagents/pi-extension/subagents/agent-definitions.mjs";

const agentsDir = join(dirname(fileURLToPath(import.meta.url)), "interactive-subagents", "agents");

const ROLE_LISTS = [
	{
		role: "child",
		autoExit: true,
		profiles: [
			"worker",
			"scout",
			"researcher",
			"research-orchestrator",
			"tuicr-review",
			"mission-worker",
		],
	},
	{
		role: "durable",
		autoExit: false,
		profiles: ["mission-captain", "mission-commander"],
	},
	{
		role: "teaching",
		autoExit: false,
		profiles: ["professor", "reviser"],
	},
];

/** Read one shipped profile through the real parser; return null if absent. */
function readProfile(name) {
	const file = join(agentsDir, `${name}.md`);
	if (!existsSync(file)) return null;
	return parseAgentDefinition(readFileSync(file, "utf8"), name);
}

/** Render the flag for a failure message, including a missing line. */
function showAutoExit(value) {
	return value === undefined ? "no auto-exit line in the frontmatter" : `auto-exit: ${value}`;
}

for (const { role, autoExit, profiles } of ROLE_LISTS) {
	test(`${role}-role profiles set auto-exit: ${autoExit}`, () => {
		for (const name of profiles) {
			const definition = readProfile(name);
			assert.ok(
				definition,
				`the ${role} role lists ${name}, but interactive-subagents/agents/${name}.md does not exist`,
			);
			assert.equal(
				definition.autoExit,
				autoExit,
				`${name} is a ${role}-role profile: expected "auto-exit: ${autoExit}", got ${showAutoExit(definition.autoExit)}`,
			);
		}
	});
}

test("every shipped profile belongs to a role list", () => {
	const shipped = readdirSync(agentsDir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => file.slice(0, -3))
		.sort();
	const named = ROLE_LISTS.flatMap(({ profiles }) => profiles).sort();
	assert.deepEqual(
		shipped.filter((name) => !named.includes(name)),
		[],
		"the role lists name no profile for these shipped agents",
	);
	assert.deepEqual(
		named,
		shipped,
		"the role lists and the shipped agent profiles disagree",
	);
});
