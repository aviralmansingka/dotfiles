/** Optional Pi extension. Not installed by the prototype.
 * Load in the tracked foreground process:
 *   mission run dotfiles/audit-hooks --agent scout -- pi -p -e /abs/pi-mission.ts "Read MISSION_BRIEF and do the assigned step"
 * The run wrapper owns completion. agent_end only records a turn boundary.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function missionHooks(pi: ExtensionAPI) {
  if (!process.env.MISSION_ATTEMPT || !process.env.MISSION_TOKEN) return;
  const binary = process.env.MISSION_BIN || "mission";
  let warned = false;
  const record = (event: Record<string, unknown>) => {
    const result = spawnSync(binary, ["hook", "--stdin"], {
      input: JSON.stringify({ id: randomUUID(), ...event }),
      env: process.env,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if ((result.error || result.status !== 0) && !warned) {
      warned = true;
      console.error("Mission lifecycle recording failed. Inspect the attempt before continuing. " +
        (result.error?.message || result.stdout.slice(0, 800)));
    }
  };
  pi.on("session_start", (_event, ctx) => record({
    type: "session-start",
    session_id: ctx.sessionManager.getSessionId(),
    session_file: ctx.sessionManager.getSessionFile(),
    pane_id: process.env.HERDR_PANE_ID,
    workspace_id: process.env.HERDR_WORKSPACE_ID,
    summary: "Pi session attached to attempt",
  }));
  pi.on("agent_start", () => record({ type: "agent-start", summary: "Agent turn started" }));
  pi.on("agent_end", () => record({ type: "agent-end", summary: "Agent turn ended; attempt remains owned" }));
  pi.on("tool_execution_start", event => record({
    type: "tool-start", tool: event.toolName, summary: "Tool call " + event.toolCallId,
  }));
  pi.on("tool_execution_end", event => record({
    type: "tool-end", tool: event.toolName,
    summary: "Tool call " + event.toolCallId + (event.isError ? " failed" : " ended"),
  }));
  pi.on("session_shutdown", (_event, ctx) => record({
    type: "session-end",
    session_file: ctx.sessionManager.getSessionFile(),
    summary: "Pi shutdown; preserve transcript",
  }));
}
