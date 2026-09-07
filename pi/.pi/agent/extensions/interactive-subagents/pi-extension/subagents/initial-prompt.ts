export interface SubagentInitialPromptPayload {
  skills: string[];
  task: string;
}

export interface ResolvedSubagentSkill {
  name: string;
  filePath: string;
  baseDir: string;
}

export function encodeSubagentInitialPrompt(payload: SubagentInitialPromptPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function buildSubagentInitialPrompt(
  encoded: string,
  availableSkills: ResolvedSubagentSkill[],
  readSkillBody: (skill: ResolvedSubagentSkill) => string,
): string {
  const payload = JSON.parse(Buffer.from(encoded.trim(), "base64url").toString("utf8"));
  if (
    !payload ||
    !Array.isArray(payload.skills) ||
    !payload.skills.every((name: unknown) => typeof name === "string") ||
    typeof payload.task !== "string"
  ) {
    throw new Error("Invalid subagent initial prompt");
  }

  return [
    ...payload.skills.map((name: string) => {
      const skill = availableSkills.find((candidate) => candidate.name === name);
      if (!skill) throw new Error(`Subagent skill not found: ${name}`);
      return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${readSkillBody(skill)}\n</skill>`;
    }),
    payload.task,
  ].join("\n\n");
}
