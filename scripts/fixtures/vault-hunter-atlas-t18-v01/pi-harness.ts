import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import atlasAdapter from "../../../pi/.pi/agent/extensions/vault-hunter-run.ts";

const outputPath = process.env.T18_V01_RESULT!;
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
          if (property === "getSessionFile") return () => process.env.T18_V01_SESSION_FILE;
          if (property === "getSessionId") return () => "session-t18-v01";
          return Reflect.get(target as any, property, receiver);
        },
      });
      const confirmations: Array<{ title: string; message: string }> = [];
      const approvedContext = context(realContext, {
        mode: "tui",
        hasUI: true,
        cwd: process.env.T18_V01_CWD,
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
      const atlasCreate = captured.get("atlas_create");
      const atlasEvidenceGet = captured.get("atlas_evidence_get");
      const atlasAccept = captured.get("atlas_accept_verifier_attempt");
      const atlasReject = captured.get("atlas_reject_verifier_attempt");
      const atlasRetire = captured.get("atlas_retire_run");
      const atlasCapabilities = captured.get("atlas_capabilities");

      const preflightResult = await preflight.execute("preflight", {}, new AbortController().signal, undefined, approvedContext);
      const getResult = await atlasGet.execute("get", { resource: "runs", id: "run-1" }, new AbortController().signal, undefined, approvedContext);
      const attemptsResult = await atlasGet.execute("attempts", { resource: "verifierattempts", run: "run-1", pending: true }, new AbortController().signal, undefined, approvedContext);
      const createResult = await atlasCreate.execute("create", { resource: "run", request: { name: "release-check", run_kind: "hunter" } }, new AbortController().signal, undefined, approvedContext);
      const evidenceResult = await atlasEvidenceGet.execute("evidence", { name: "evidence-1" }, new AbortController().signal, undefined, approvedContext);
      const acceptResult = await atlasAccept.execute("accept", { identity: "attempt-1", expectedRevision: 7 }, new AbortController().signal, undefined, approvedContext);
      const rejectResult = await atlasReject.execute("reject", { id: "attempt-2", expectedRevision: 8, reason: "insufficient-evidence" }, new AbortController().signal, undefined, approvedContext);
      const retireResult = await atlasRetire.execute("retire", { identity: "run-2", expectedRevision: 9 }, new AbortController().signal, undefined, approvedContext);
      const capabilitiesResult = await atlasCapabilities.execute("capabilities", {}, new AbortController().signal, undefined, approvedContext);

      const conflictingSelectorError = await rejected(() => atlasGet.execute(
        "bad-selector",
        { resource: "runs", identity: "run-1", id: "run-2" },
        new AbortController().signal,
        undefined,
        approvedContext,
      ));
      const badFilterError = await rejected(() => atlasGet.execute(
        "bad-filter",
        { resource: "runs", run: "run-1", pending: true },
        new AbortController().signal,
        undefined,
        approvedContext,
      ));

      let confirmCalled = false;
      const noUIContext = context(realContext, {
        mode: "print",
        hasUI: false,
        cwd: process.env.T18_V01_CWD,
        sessionManager,
        ui: new Proxy(realContext.ui, {
          get(target, property, receiver) {
            if (property === "confirm") return async () => { confirmCalled = true; return true; };
            return Reflect.get(target as any, property, receiver);
          },
        }),
      });
      const noUIError = await rejected(() => atlasRetire.execute(
        "retire-no-ui",
        { identity: "run-2", expectedRevision: 9 },
        new AbortController().signal,
        undefined,
        noUIContext,
      ));
      if (confirmCalled) throw new Error("retire confirmation ran without UI");

      const declinedContext = context(realContext, {
        mode: "tui",
        hasUI: true,
        cwd: process.env.T18_V01_CWD,
        sessionManager,
        ui: new Proxy(realContext.ui, {
          get(target, property, receiver) {
            if (property === "confirm") return async () => false;
            return Reflect.get(target as any, property, receiver);
          },
        }),
      });
      const declinedError = await rejected(() => atlasRetire.execute(
        "retire-declined",
        { identity: "run-2", expectedRevision: 9 },
        new AbortController().signal,
        undefined,
        declinedContext,
      ));

      Object.assign(result, {
        ok: true,
        tools: wanted.map((name) => ({ name, parameters: captured.get(name).parameters })),
        preflightResult,
        getResult,
        attemptsResult,
        createResult,
        evidenceResult,
        acceptResult,
        rejectResult,
        retireResult,
        capabilitiesResult,
        conflictingSelectorError,
        badFilterError,
        noUIError,
        declinedError,
        confirmations,
      });
    } catch (error) {
      result.error = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
    }
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  });

  pi.on("input", () => ({ action: "handled" }));
}
