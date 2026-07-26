import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import vaultHunterRun from "../../../pi/.pi/agent/extensions/vault-hunter-run.ts";

const outputPath = process.env.T09_V03_PI_RESULT!;
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
  vaultHunterRun(wrappedAPI(pi));

  pi.on("session_start", async (_event, realContext) => {
    const result: Record<string, unknown> = { ok: false };
    try {
      const list = captured.get("vault_hunter_list_runs");
      const retire = captured.get("vault_hunter_retire_run");
      if (!list || !retire) throw new Error("Registry administration tools were not both registered");

      const confirmations: Array<{ title: string; message: string }> = [];
      const approvedContext = context(realContext, {
        mode: "tui",
        hasUI: true,
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

      const listResult = await list.execute(
        "list-normal",
        {
          taskId: "T09",
          featurePath: "features/vault-hunter-atlas/feature.md",
          agentSession: { source: "pi", kind: "id", value: "session-alpha" },
          updatedAtFrom: "2026-07-26T10:00:00Z",
          updatedAtThrough: "2026-07-26T11:00:00Z",
        },
        new AbortController().signal,
        undefined,
        approvedContext,
      );

      let forbiddenConfirmCalled = false;
      const noUIContext = context(realContext, {
        mode: "print",
        hasUI: false,
        ui: new Proxy(realContext.ui, {
          get(target, property, receiver) {
            if (property === "confirm") return async () => { forbiddenConfirmCalled = true; return true; };
            return Reflect.get(target as any, property, receiver);
          },
        }),
      });
      const noUIError = await rejected(() => retire.execute(
        "retire-no-ui", { runId: "run-a", expectedRevision: 7 }, undefined, undefined, noUIContext,
      ));
      if (forbiddenConfirmCalled) throw new Error("retire attempted confirmation when UI was unavailable");

      const declinedContext = context(realContext, {
        mode: "tui",
        hasUI: true,
        ui: new Proxy(realContext.ui, {
          get(target, property, receiver) {
            if (property === "confirm") return async () => false;
            return Reflect.get(target as any, property, receiver);
          },
        }),
      });
      const declinedError = await rejected(() => retire.execute(
        "retire-declined", { runId: "run-a", expectedRevision: 7 }, undefined, undefined, declinedContext,
      ));

      const unavailableContext = context(realContext, {
        mode: "tui",
        hasUI: true,
        ui: new Proxy(realContext.ui, {
          get(target, property, receiver) {
            if (property === "confirm") return async () => { throw new Error("confirmation unavailable sentinel"); };
            return Reflect.get(target as any, property, receiver);
          },
        }),
      });
      const unavailableError = await rejected(() => retire.execute(
        "retire-unavailable", { runId: "run-a", expectedRevision: 7 }, undefined, undefined, unavailableContext,
      ));

      const retireResult = await retire.execute(
        "retire-approved", { runId: "run-a", expectedRevision: 7 },
        new AbortController().signal, undefined, approvedContext,
      );

      async function cancelled(tool: any, id: string, params: Record<string, unknown>) {
        const controller = new AbortController();
        const started = Date.now();
        const promise = rejected(() => tool.execute(id, params, controller.signal, undefined, approvedContext));
        setTimeout(() => controller.abort(), 150);
        const error = await promise;
        return { error, elapsedMs: Date.now() - started };
      }
      const listCancellation = await cancelled(list, "list-cancel", { taskId: "WAIT" });
      const retireCancellation = await cancelled(
        retire, "retire-cancel", { runId: "wait-retire", expectedRevision: 9 },
      );

      Object.assign(result, {
        ok: true,
        tools: [
          { name: list.name, label: list.label, description: list.description, parameters: list.parameters },
          { name: retire.name, label: retire.label, description: retire.description, parameters: retire.parameters },
        ],
        listResult,
        retireResult,
        noUIError,
        declinedError,
        unavailableError,
        confirmations,
        listCancellation,
        retireCancellation,
      });
    } catch (error) {
      result.error = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
    }
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  });

  pi.on("input", () => ({ action: "handled" }));
}
