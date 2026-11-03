// Internal sibling-extension configuration. Never accept credentials or expose
// these fields in the model-facing subagent schema.
export function missionLaunchConfig(params) {
  if (params.agent !== "mission-worker" || !params.missionContext) return undefined;
  const c = params.missionContext;
  if (![c.vault, c.binary, c.stateDir].every(v => typeof v === "string" && v.length > 0 && !v.includes("\0")))
    throw new Error("Invalid mission launch configuration");
  return { MISSION_VAULT: c.vault, MISSION_BIN: c.binary, MISSION_STATE_DIR: c.stateDir };
}
