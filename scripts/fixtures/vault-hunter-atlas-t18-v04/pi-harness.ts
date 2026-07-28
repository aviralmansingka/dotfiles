import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import atlasAdapter from "../../../pi/.pi/agent/extensions/vault-hunter-run.ts";

const outputPath = process.env.T18_V04_RESULT!;
const captured = new Map<string, any>();

function wrappedAPI(pi: ExtensionAPI): ExtensionAPI {
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") {
        return (definition: any) => {
          captured.set(definition.name, definition);
          return (target.registerTool as any)(definition);
        };
      }
      const value = Reflect.get(target as any, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function context(base: ExtensionContext, values: Record<string, unknown>): ExtensionContext {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(values, property)) return values[property as string];
      return Reflect.get(target as any, property, receiver);
    },
  });
}

async function rejected(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  throw new Error("operation unexpectedly succeeded");
}

export default function verifier(pi: ExtensionAPI) {
  atlasAdapter(wrappedAPI(pi));

  pi.on("session_start", async (_event, realContext) => {
    const result: Record<string, unknown> = { ok: false };
    try {
      const names = [...captured.keys()].sort();
      const wanted = [
        "agent_run_preflight",
        "atlas_accept_verifier_attempt",
        "atlas_capabilities",
        "atlas_create",
        "atlas_evidence_get",
        "atlas_get",
        "atlas_reject_verifier_attempt",
        "atlas_retire_run",
      ];
      if (JSON.stringify(names) !== JSON.stringify(wanted)) throw new Error(`tool set mismatch: ${JSON.stringify(names)}`);

      const sessionManager = new Proxy(realContext.sessionManager, {
        get(target, property, receiver) {
          if (property === "getSessionFile") return () => process.env.T18_V04_SESSION_FILE;
          if (property === "getSessionId") return () => "session-t18-v04";
          return Reflect.get(target as any, property, receiver);
        },
      });
      const confirmations: Array<{ title: string; message: string }> = [];
      const approvedContext = context(realContext, {
        mode: "tui",
        hasUI: true,
        cwd: process.env.T18_V04_CWD,
        sessionManager,
        ui: new Proxy(realContext.ui, {
          get(target, property, receiver) {
            if (property === "confirm") {
              return async (title: string, message: string) => {
                confirmations.push({ title, message });
                return true;
              };
            }
            return Reflect.get(target as any, property, receiver);
          },
        }),
      });

      const preflight = captured.get("agent_run_preflight");
      const atlasGet = captured.get("atlas_get");
      const atlasAccept = captured.get("atlas_accept_verifier_attempt");
      const atlasReject = captured.get("atlas_reject_verifier_attempt");
      const atlasRetire = captured.get("atlas_retire_run");
      const atlasCapabilities = captured.get("atlas_capabilities");

      const preflightResult = await preflight.execute("preflight", {}, new AbortController().signal, undefined, approvedContext);
      const acceptResult = await atlasAccept.execute("accept", { id: "attempt-201", expectedRevision: 1 }, new AbortController().signal, undefined, approvedContext);
      const rejectResult = await atlasReject.execute("reject", { identity: "attempt-202", expectedRevision: 1, reason: "insufficient-evidence" }, new AbortController().signal, undefined, approvedContext);
      const retireResult = await atlasRetire.execute("retire", { name: "retire-me", expectedRevision: 1 }, new AbortController().signal, undefined, approvedContext);
      const retiredRead = await atlasGet.execute("retired-read", { resource: "runs", id: "run-204" }, new AbortController().signal, undefined, approvedContext);
      const retiredAttempts = await atlasGet.execute("retired-attempts", { resource: "verifierattempts", run: "retire-me" }, new AbortController().signal, undefined, approvedContext);
      const retiredParticipant = await atlasGet.execute("retired-participant", { resource: "participants", id: "participant-retired" }, new AbortController().signal, undefined, approvedContext);
      const retiredUsage = await atlasGet.execute("retired-usage", { resource: "usage", id: "run-204" }, new AbortController().signal, undefined, approvedContext);
      const retryPending = await atlasGet.execute("retry-pending", { resource: "verifierattempts", run: "retry-me", pending: true }, new AbortController().signal, undefined, approvedContext);
      const capabilitiesResult = await atlasCapabilities.execute("capabilities", {}, new AbortController().signal, undefined, approvedContext);
      const retiredWriteError = await rejected(() => atlasReject.execute("retired-write", { id: "attempt-205", expectedRevision: 1, reason: "too-late" }, new AbortController().signal, undefined, approvedContext));
      const sharedAttemptError = await rejected(() => atlasAccept.execute("shared-attempt", { identity: "attempt-shared", expectedRevision: 1 }, new AbortController().signal, undefined, approvedContext));

      const beforeDecline = readFileSync(process.env.T18_V04_COMMAND_LOG!, "utf8").trim().split(/\n+/).filter(Boolean).length;
      const declinedError = await rejected(() => atlasRetire.execute(
        "retire-declined",
        { name: "retire-me", expectedRevision: 1 },
        new AbortController().signal,
        undefined,
        context(approvedContext, {
          ui: new Proxy(realContext.ui, { get(target, property, receiver) { if (property === "confirm") return async () => false; return Reflect.get(target as any, property, receiver); } }),
        }),
      ));
      const afterDecline = readFileSync(process.env.T18_V04_COMMAND_LOG!, "utf8").trim().split(/\n+/).filter(Boolean).length;

      const noUIError = await rejected(() => atlasRetire.execute(
        "retire-no-ui",
        { id: "run-204", expectedRevision: 1 },
        new AbortController().signal,
        undefined,
        context(approvedContext, { hasUI: false, mode: "print" }),
      ));

      Object.assign(result, {
        ok: true,
        tools: wanted.map((name) => ({ name, parameters: captured.get(name).parameters })),
        preflightResult,
        acceptResult,
        rejectResult,
        retireResult,
        retiredRead,
        retiredAttempts,
        retiredParticipant,
        retiredUsage,
        retryPending,
        capabilitiesResult,
        retiredWriteError,
        sharedAttemptError,
        beforeDecline,
        afterDecline,
        declinedError,
        noUIError,
        confirmations,
        commandLog: readFileSync(process.env.T18_V04_COMMAND_LOG!, "utf8"),
        source: readFileSync(process.env.T18_V04_SOURCE!, "utf8"),
      });
    } catch (error) {
      result.error = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
    }
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  });

  pi.on("input", () => ({ action: "handled" }));
}
