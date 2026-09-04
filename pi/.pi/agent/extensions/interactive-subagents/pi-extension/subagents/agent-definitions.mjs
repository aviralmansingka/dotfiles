import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function getFrontmatterValue(frontmatter, key) {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return match ? match[1].trim() : undefined;
}

function parseOptionalBoolean(value) {
	return value != null ? value === "true" : undefined;
}

function parseCommaList(value) {
	if (value == null) return undefined;
	const list = value.split(",").map((item) => item.trim()).filter(Boolean);
	return list.length > 0 ? list : undefined;
}

function parseSessionMode(value) {
	return ["standalone", "lineage-only", "fork"].includes(value)
		? value
		: undefined;
}

export function parseAgentDefinition(content, fallbackName) {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;

	const frontmatter = match[1];
	const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
	const systemPromptMode = getFrontmatterValue(frontmatter, "system-prompt");
	return {
		name: getFrontmatterValue(frontmatter, "name") ?? fallbackName,
		description: getFrontmatterValue(frontmatter, "description"),
		model: getFrontmatterValue(frontmatter, "model"),
		tools: getFrontmatterValue(frontmatter, "tools"),
		systemPromptMode: ["replace", "append"].includes(systemPromptMode)
			? systemPromptMode
			: undefined,
		skills:
			getFrontmatterValue(frontmatter, "skill") ??
			getFrontmatterValue(frontmatter, "skills"),
		thinking: getFrontmatterValue(frontmatter, "thinking"),
		subagentAgents: parseCommaList(
			getFrontmatterValue(frontmatter, "subagent_agents"),
		),
		autoExit: parseOptionalBoolean(getFrontmatterValue(frontmatter, "auto-exit")),
		interactive: parseOptionalBoolean(
			getFrontmatterValue(frontmatter, "interactive"),
		),
		sessionMode: parseSessionMode(
			getFrontmatterValue(frontmatter, "session-mode"),
		),
		cwd: getFrontmatterValue(frontmatter, "cwd"),
		cli: getFrontmatterValue(frontmatter, "cli"),
		body: body || undefined,
		disableModelInvocation:
			getFrontmatterValue(frontmatter, "disable-model-invocation")?.toLowerCase() ===
			"true",
	};
}

export function agentIsolationArgs(agentName) {
	return agentName === "hunk-review" ? ["--no-extensions"] : [];
}

export function loadAgentDefaultsFromPaths(
	agentName,
	{ cwd, configDir, bundledDir },
) {
	const bundledPath = join(bundledDir, `${agentName}.md`);
	const paths = agentName === "hunk-review"
		? [bundledPath]
		: [
				join(cwd, ".pi", "agents", `${agentName}.md`),
				join(configDir, "agents", `${agentName}.md`),
				bundledPath,
			];

	for (const path of paths) {
		if (!existsSync(path)) continue;
		const parsed = parseAgentDefinition(readFileSync(path, "utf8"), agentName);
		if (parsed) return parsed;
	}
	return null;
}
