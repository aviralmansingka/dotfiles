// Adapter contract fixture only. This is not a Pi session and makes no model calls.
import hooks from "../hooks/pi-mission";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const handlers = new Map<string, Function>();
hooks({ on: (name: string, fn: Function) => handlers.set(name, fn) } as any);
const session = join(process.cwd(), "mock-session.jsonl");
writeFileSync(session, '{"type":"session","id":"mock-pi-contract","fixture":true}\n');
const ctx = { sessionManager: { getSessionId: () => "mock-pi-contract", getSessionFile: () => session } };
for (const [name, event] of [
  ["session_start", {}], ["agent_start", {}],
  ["tool_execution_start", { toolName: "read", toolCallId: "tool-contract-1" }],
  ["tool_execution_end", { toolName: "read", toolCallId: "tool-contract-1", isError: false }],
  ["agent_end", {}],
] as const) handlers.get(name)?.(event, ctx);
writeFileSync(process.env.MISSION_ARTIFACT!, "# Fixture evidence\n\nAdapter events reached the vault.\n");
handlers.get("session_shutdown")?.({}, ctx);
