import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY = "subagents:rpc:v1:reply:";
const BINDING_FILE = "vault-hunter-registry.json";
const REPO_ROOT = dirname(dirname(dirname(dirname(dirname(realpathSync(fileURLToPath(import.meta.url)))))));
const ASYNC_ROOT = join(tmpdir(), `pi-subagents-uid-${process.getuid?.() ?? "unknown"}`, "async-subagent-runs");
const REGISTRY_ROOT = process.env.VAULT_HUNTER_STATE_DIR ||
  (process.env.XDG_STATE_HOME ? join(process.env.XDG_STATE_HOME, "vault-hunter") : join(homedir(), ".local", "state", "vault-hunter"));
const INTENT_DIR = join(ASYNC_ROOT, ".vault-hunter-intents");

const TaskSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  path: Type.String(),
  featurePath: Type.String(),
  kind: Type.String(),
});

const AgentSessionSchema = Type.Object({ source: Type.String(), kind: Type.String(), value: Type.String() });
const HerdrSchema = Type.Object({
  workspaceId: Type.String(), tabId: Type.String(), paneId: Type.String(), terminalId: Type.String(),
});
const ParticipantSchema = Type.Object({
  participantId: Type.String(), observedAt: Type.Optional(Type.String()), role: Type.String(), goalId: Type.Optional(Type.String()),
  agentSession: Type.Optional(AgentSessionSchema), herdr: Type.Optional(HerdrSchema),
});
const LifecycleSchema = Type.Object({
  observationId: Type.String(), observedAt: Type.Optional(Type.String()), kind: Type.String(),
  goalId: Type.Optional(Type.String()), state: Type.Optional(Type.String()), detail: Type.Optional(Type.String()),
});
const EvidenceSchema = Type.Object({
  observationId: Type.String(), observedAt: Type.Optional(Type.String()), verifierId: Type.String(), state: Type.String(),
  command: Type.Optional(Type.String()), exitStatus: Type.Optional(Type.Integer()), implementationTree: Type.Optional(Type.String()),
  artifactSha256: Type.Optional(Type.String()), detail: Type.Optional(Type.String()),
});

type Binding = {
  root: string;
  registryRunId: string;
  asyncRunId: string;
  asyncDir: string;
  goalId: string;
  kind: string;
  role: string;
  agent: string;
  startedAt: string;
};

type LaunchIntent = Omit<Binding, "asyncRunId" | "asyncDir"> & { launchId: string };
type RpcReply = { success: true; data: any } | { success: false; error: { message: string } };
type DriverPlacement = {
  observedAt: string;
  herdr: { workspaceId: string; tabId: string; paneId: string; terminalId: string };
  agentSession: { source: string; kind: string; value: string };
};
class AmbiguousLaunchError extends Error {}

function now(): string { return new Date().toISOString(); }
function slug(value: string): string { return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "run"; }
function text(content: string, details: unknown) { return { content: [{ type: "text" as const, text: content }], details }; }

function wireHerdr(input: any) {
  return input ? {
    workspace_id: input.workspaceId, tab_id: input.tabId,
    pane_id: input.paneId, terminal_id: input.terminalId,
  } : null;
}

function wireParticipant(input: any) {
  return {
    participant_id: input.participantId,
    observed_at: input.observedAt ?? now(),
    role: input.role,
    goal_id: input.goalId ?? "",
    herdr: wireHerdr(input.herdr),
    agent_session: input.agentSession ? {
      source: input.agentSession.source, kind: input.agentSession.kind, value: input.agentSession.value,
    } : null,
  };
}

function wireLifecycle(input: any) {
  return {
    observation_id: input.observationId,
    observed_at: input.observedAt ?? now(),
    kind: input.kind,
    goal_id: input.goalId ?? "",
    state: input.state ?? "",
    detail: input.detail ?? "",
  };
}

function wireEvidence(input: any) {
  return {
    observation_id: input.observationId,
    observed_at: input.observedAt ?? now(),
    verifier_id: input.verifierId,
    state: input.state,
    command: input.command ?? "",
    exit_status: input.exitStatus ?? null,
    implementation_tree: input.implementationTree ?? "",
    artifact_sha256: input.artifactSha256 ?? "",
    detail: input.detail ?? "",
  };
}

async function driverPlacement(pi: ExtensionAPI, ctx: ExtensionContext, signal?: AbortSignal): Promise<DriverPlacement | undefined> {
  if (ctx.mode !== "tui") return undefined;
  const paneId = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
  if (!paneId) throw new Error("Interactive Vault Hunter drivers must run inside a Herdr pane.");

  const response = await pi.exec("herdr", ["pane", "get", paneId], { signal, timeout: 5_000 });
  if (response.code !== 0) throw new Error(response.stderr.trim() || `Herdr could not resolve pane ${paneId}.`);
  const decoded = JSON.parse(response.stdout);
  const pane = decoded?.result?.pane ?? decoded?.pane;
  const sessionFile = ctx.sessionManager.getSessionFile();
  const session = pane?.agent_session;
  const fields = [pane?.workspace_id, pane?.tab_id, pane?.pane_id, pane?.terminal_id];
  if (fields.some((value) => typeof value !== "string" || !value)) throw new Error(`Herdr returned an incomplete identity for pane ${paneId}.`);
  if (pane.pane_id !== paneId) throw new Error(`Herdr resolved ${paneId} as a different pane.`);
  if (!sessionFile || session?.source !== "herdr:pi" || session?.kind !== "path" || session?.value !== sessionFile) {
    throw new Error(`Herdr pane ${paneId} is not bound to this Pi session.`);
  }
  const paneCwd = pane.foreground_cwd ?? pane.cwd;
  if (!paneCwd || realpathSync(paneCwd) !== realpathSync(ctx.cwd)) throw new Error(`Herdr pane ${paneId} is not in this Pi session's cwd.`);

  return {
    observedAt: now(),
    herdr: { workspaceId: pane.workspace_id, tabId: pane.tab_id, paneId: pane.pane_id, terminalId: pane.terminal_id },
    agentSession: { source: session.source, kind: session.kind, value: session.value },
  };
}

function sameDriver(input: any, participantId: string, herdr: any, agentSession: any): boolean {
  return input?.participant_id === participantId &&
    input?.herdr?.workspace_id === herdr?.workspace_id && input?.herdr?.tab_id === herdr?.tab_id &&
    input?.herdr?.pane_id === herdr?.pane_id && input?.herdr?.terminal_id === herdr?.terminal_id &&
    input?.agent_session?.source === agentSession.source && input?.agent_session?.kind === agentSession.kind &&
    input?.agent_session?.value === agentSession.value;
}

function registry(input: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("go", ["run", "./cmd/vault-hunter-registry"], {
      cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"], signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `vault-hunter-registry exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function rpc(pi: ExtensionAPI, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const requestId = `vault-hunter-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsubscribe?.();
      callback();
    };
    const onAbort = () => finish(() => reject(new AmbiguousLaunchError(`pi-subagents RPC ${method} was cancelled; launch state is being reconciled from the persisted intent.`)));
    const timer = setTimeout(() => finish(() => reject(new AmbiguousLaunchError(`pi-subagents RPC ${method} exceeded its launch handshake window; launch state is being reconciled from the persisted intent.`))), 30_000);
    const unsubscribe = pi.events.on(`${RPC_REPLY}${requestId}`, (raw) => finish(() => {
      const reply = raw as RpcReply;
      if (!reply?.success) reject(new Error(reply?.error?.message ?? `pi-subagents RPC ${method} failed`));
      else resolve(reply.data);
    }));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    pi.events.emit(RPC_REQUEST, { version: 1, requestId, method, params, source: { extension: "vault-hunter-run" } });
  });
}

function bindingPath(asyncDir: string): string { return join(asyncDir, BINDING_FILE); }
function intentPath(launchId: string): string { return join(INTENT_DIR, `${launchId}.json`); }
function writeIntent(intent: LaunchIntent): void {
  mkdirSync(INTENT_DIR, { recursive: true, mode: 0o700 });
  const path = intentPath(intent.launchId);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(intent, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
function readIntent(launchId: string): LaunchIntent | undefined {
  try { return JSON.parse(readFileSync(intentPath(launchId), "utf8")) as LaunchIntent; } catch { return undefined; }
}
function removeIntent(launchId: string): void { rmSync(intentPath(launchId), { force: true }); }
function writeBinding(binding: Binding): void {
  const path = bindingPath(binding.asyncDir);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
function readBinding(asyncDir: string): Binding | undefined {
  try { return JSON.parse(readFileSync(bindingPath(asyncDir), "utf8")) as Binding; } catch { return undefined; }
}

async function appendStarted(binding: Binding): Promise<void> {
  await registry({
    action: "append", root: binding.root, run_id: binding.registryRunId, updated_at: binding.startedAt,
    participant: wireParticipant({
      participantId: `subagent-${binding.asyncRunId}`, observedAt: binding.startedAt, role: binding.role, goalId: binding.goalId,
      agentSession: { source: "pi-subagents", kind: "async-run", value: binding.asyncRunId },
    }),
    lifecycle: wireLifecycle({
      observationId: `subagent-${binding.asyncRunId}-started`, observedAt: binding.startedAt,
      kind: binding.kind, goalId: binding.goalId, state: "active",
      detail: `${binding.agent} launched headlessly; async_dir=${binding.asyncDir}`,
    }),
  });
}

function terminalState(data: any): string {
  if (["complete", "failed", "paused", "stopped"].includes(data?.state)) return data.state === "complete" ? "done" : data.state;
  const statuses = Array.isArray(data?.results) ? data.results.map((result: any) => result.status) : [];
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("paused")) return "paused";
  if (statuses.includes("stopped")) return "stopped";
  return data?.success === false ? "failed" : "done";
}

async function appendTerminal(binding: Binding, _data: any): Promise<void> {
  let data: any;
  try { data = JSON.parse(readFileSync(join(binding.asyncDir, "status.json"), "utf8")); }
  catch { return; }
  if (["queued", "running"].includes(data?.state) || !data?.endedAt) return;
  const state = terminalState(data);
  const observedAt = new Date(data.endedAt).toISOString();
  const sessionFile = data?.sessionFile ?? data?.steps?.[0]?.sessionFile;
  await registry({
    action: "append", root: binding.root, run_id: binding.registryRunId, updated_at: observedAt,
    lifecycle: wireLifecycle({
      observationId: `subagent-${binding.asyncRunId}-terminal-${state}`, observedAt,
      kind: binding.kind, goalId: binding.goalId, state,
      detail: `${binding.agent} process ${state}; async_run=${binding.asyncRunId}${sessionFile ? `; session=${sessionFile}` : ""}`,
    }),
  });
}

async function appendControl(binding: Binding, event: any): Promise<void> {
  if (!event?.type || !event?.ts) return;
  const observedAt = new Date(event.ts).toISOString();
  const child = `${event.index ?? 0}-${event.agent ?? binding.agent}`;
  await registry({
    action: "append", root: binding.root, run_id: binding.registryRunId, updated_at: observedAt,
    lifecycle: wireLifecycle({
      observationId: `subagent-${binding.asyncRunId}-control-${child}-${event.type}-${event.ts}`, observedAt,
      kind: binding.kind, goalId: binding.goalId, state: event.type, detail: event.message ?? event.reason ?? "control observation",
    }),
  });
}

async function replayControls(binding: Binding): Promise<void> {
  try {
    for (const line of readFileSync(join(binding.asyncDir, "events.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record?.type === "subagent.control" && record.event) await appendControl(binding, record.event);
    }
  } catch {
    // Missing or concurrently appended event logs are retried on the next replay.
  }
}

async function replayBinding(binding: Binding): Promise<void> {
  await appendStarted(binding);
  await replayControls(binding);
  try {
    const status = JSON.parse(readFileSync(join(binding.asyncDir, "status.json"), "utf8"));
    if (!["queued", "running"].includes(status.state)) await appendTerminal(binding, status);
  } catch {
    // A persisted binding can briefly precede status finalization; a later event or reload will retry.
  }
}

function bindIntent(intent: LaunchIntent, asyncRunId: string, asyncDir: string): Binding {
  const existing = readBinding(asyncDir);
  if (existing) return existing;
  const binding: Binding = { ...intent, asyncRunId, asyncDir };
  delete (binding as Partial<LaunchIntent>).launchId;
  writeBinding(binding);
  removeIntent(intent.launchId);
  return binding;
}

async function replayIntents(): Promise<number> {
  if (!existsSync(INTENT_DIR) || !existsSync(ASYNC_ROOT)) return 0;
  for (const file of readdirSync(INTENT_DIR).filter((name) => name.endsWith(".json"))) {
    let intent: LaunchIntent;
    try { intent = JSON.parse(readFileSync(join(INTENT_DIR, file), "utf8")) as LaunchIntent; } catch { continue; }
    const marker = `[vault-hunter:${intent.launchId}]`;
    for (const name of readdirSync(ASYNC_ROOT)) {
      const asyncDir = join(ASYNC_ROOT, name);
      try {
        if (!readFileSync(join(asyncDir, "events.jsonl"), "utf8").includes(marker)) continue;
        bindIntent(intent, name, asyncDir);
        break;
      } catch { /* not this run */ }
    }
  }
  return readdirSync(INTENT_DIR).filter((name) => name.endsWith(".json")).length;
}

async function replayAll(ctx?: ExtensionContext): Promise<void> {
  if (!existsSync(ASYNC_ROOT)) return;
  for (const name of readdirSync(ASYNC_ROOT)) {
    const binding = readBinding(join(ASYNC_ROOT, name));
    if (!binding) continue;
    try { await replayBinding(binding); }
    catch (error) { ctx?.ui.notify(`Vault Hunter Registry replay failed: ${String(error)}`, "warning"); }
  }
}

export default function (pi: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;
  let intentTimer: ReturnType<typeof setTimeout> | undefined;
  let registrationQueue = Promise.resolve();

  async function serializeRegistration<T>(work: () => Promise<T>): Promise<T> {
    const previous = registrationQueue;
    let release!: () => void;
    registrationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  function reconcilePendingIntents(ctx: ExtensionContext, deadline = Date.now() + 30_000): void {
    if (intentTimer) clearTimeout(intentTimer);
    void replayIntents().then(async (pending) => {
      await replayAll(ctx);
      if (pending === 0) return;
      if (Date.now() >= deadline) {
        ctx.ui.notify(`${pending} Vault Hunter launch intent(s) remain unbound; quarantine their worktrees and retry reconciliation on resume.`, "warning");
        return;
      }
      intentTimer = setTimeout(() => reconcilePendingIntents(ctx, deadline), 500);
      intentTimer.unref?.();
    });
  }

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    reconcilePendingIntents(ctx);
  });

  pi.on("session_shutdown", () => {
    if (intentTimer) clearTimeout(intentTimer);
    intentTimer = undefined;
    currentCtx = undefined;
  });

  pi.events.on("subagent:async-started", (data: any) => {
    const match = typeof data?.goal === "string" ? data.goal.match(/^\[vault-hunter:([^\]]+)\]/) : undefined;
    if (!match || !data?.id || !data?.asyncDir) return;
    const intent = readIntent(match[1]);
    if (!intent) return;
    const binding = bindIntent(intent, data.id, data.asyncDir);
    void replayBinding(binding).catch((error) => currentCtx?.ui.notify(`Vault Hunter Registry start write failed: ${String(error)}`, "warning"));
  });

  pi.events.on("subagent:async-complete", (data: any) => {
    const asyncDir = data?.asyncDir ?? (data?.runId ? join(ASYNC_ROOT, data.runId) : undefined);
    const binding = asyncDir ? readBinding(asyncDir) : undefined;
    if (binding) void appendTerminal(binding, data).catch((error) => currentCtx?.ui.notify(`Vault Hunter Registry completion write failed: ${String(error)}`, "warning"));
  });

  pi.events.on("subagent:control-event", (data: any) => {
    const event = data?.event ?? data;
    const asyncDir = data?.asyncDir ?? (event?.runId ? join(ASYNC_ROOT, event.runId) : undefined);
    const binding = asyncDir ? readBinding(asyncDir) : undefined;
    if (!binding) return;
    void appendControl(binding, event).catch((error) => currentCtx?.ui.notify(`Vault Hunter Registry control write failed: ${String(error)}`, "warning"));
  });

  pi.registerTool({
    name: "vault_hunter_run",
    label: "Start Vault Hunter Run",
    description: "Create or reopen one durable observational Vault Hunter Run Registry record and register this Pi driver.",
    promptSnippet: "Create the observational Run Registry record before dispatching Vault Hunter children.",
    promptGuidelines: ["Use vault_hunter_run once after the Vault Hunter invocation commit and before any formal child dispatch; interactive drivers are atomically registered with their current Herdr placement."],
    parameters: Type.Object({
      runId: Type.Optional(Type.String()), task: TaskSchema, invokedAt: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, _update, ctx) {
      return serializeRegistration(async () => {
        const runId = params.runId ?? `vh-${slug(params.task.id)}-${Date.now()}`;
        let existing: any;
        if (params.runId) {
          try { existing = await registry({ action: "get", root: REGISTRY_ROOT, run_id: runId }, signal); }
          catch (error) { if (!String(error).includes("run not found")) throw error; }
        }
        if (existing && params.invokedAt && existing.invoked_at !== params.invokedAt) {
          throw new Error(`Vault Hunter Run ${runId} has a different invocation timestamp.`);
        }
        const invokedAt = existing?.invoked_at ?? params.invokedAt ?? now();
        const sessionId = ctx.sessionManager.getSessionId();
        const placement = await driverPlacement(pi, ctx, signal);
        const observedAt = placement?.observedAt ?? now();
        const participantId = `pi-${sessionId}`;
        const agentSession = placement?.agentSession ?? { source: "pi", kind: "session-id", value: sessionId };
        const participant = {
          participant_id: participantId, observed_at: observedAt, role: "driver", goal_id: "run",
          herdr: wireHerdr(placement?.herdr),
          agent_session: { source: agentSession.source, kind: agentSession.kind, value: agentSession.value },
        };
        let run = await registry({
          action: "create", root: REGISTRY_ROOT, run: {
            schema_version: 1, run_id: runId, revision: 0, invoked_at: invokedAt, updated_at: observedAt,
            task: { id: params.task.id, title: params.task.title, path: params.task.path, feature_path: params.task.featurePath, kind: params.task.kind },
            participants: [participant],
            lifecycle: [{ observation_id: `${runId}-invoked`, observed_at: invokedAt, kind: "run", goal_id: "run", state: "active", detail: "Pi driver created the observational Run record." }],
            evidence: [],
          },
        }, signal);
        if (!(run.participants ?? []).some((item: any) => sameDriver(item, participantId, participant.herdr, participant.agent_session))) {
          run = await registry({ action: "append", root: REGISTRY_ROOT, run_id: runId, updated_at: observedAt, participant }, signal);
        }
        return text(`Vault Hunter Run ${runId} is observable at revision ${run.revision}.`, {
          runId, revision: run.revision, root: REGISTRY_ROOT, herdr: placement?.herdr,
        });
      });
    },
  });

  pi.registerTool({
    name: "vault_hunter_record",
    label: "Record Vault Hunter Observation",
    description: "Append one idempotent participant, lifecycle, or evidence observation to a Vault Hunter Run. This never advances canonical state.",
    parameters: Type.Object({
      runId: Type.String(), updatedAt: Type.Optional(Type.String()),
      participant: Type.Optional(ParticipantSchema), lifecycle: Type.Optional(LifecycleSchema), evidence: Type.Optional(EvidenceSchema),
    }),
    async execute(_id, params, signal) {
      if (!params.participant && !params.lifecycle && !params.evidence) throw new Error("At least one observation is required.");
      const updatedAt = params.updatedAt ?? now();
      const run = await registry({
        action: "append", root: REGISTRY_ROOT, run_id: params.runId, updated_at: updatedAt,
        ...(params.participant ? { participant: wireParticipant(params.participant) } : {}),
        ...(params.lifecycle ? { lifecycle: wireLifecycle(params.lifecycle) } : {}),
        ...(params.evidence ? { evidence: wireEvidence(params.evidence) } : {}),
      }, signal);
      return text(`Recorded Vault Hunter observation at revision ${run.revision}.`, { runId: params.runId, revision: run.revision });
    },
  });

  pi.registerTool({
    name: "vault_hunter_step",
    label: "Launch Vault Hunter Step",
    description: "Launch exactly one async pi-subagents child and durably bind its participant and lifecycle observations to a Vault Hunter Run Registry record.",
    promptSnippet: "Launch formal headless Vault Hunter children through a Registry-wrapped async subagent step.",
    promptGuidelines: [
      "Use vault_hunter_step instead of subagent for formal Vault Hunter headless work so the child is visible in the Run Registry.",
      "Use one vault_hunter_step call per definite child; parallel tool calls are allowed only for read-only or isolated work.",
    ],
    parameters: Type.Object({
      runId: Type.String(), goalId: Type.String(), kind: Type.String(), role: Type.String(),
      agent: Type.String(), task: Type.String(), cwd: Type.Optional(Type.String()),
      context: Type.Optional(StringEnum(["fresh", "fork"] as const)), model: Type.Optional(Type.String()),
      skill: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])), timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_id, params, signal) {
      const launchId = randomUUID();
      const intent: LaunchIntent = {
        launchId, root: REGISTRY_ROOT, registryRunId: params.runId,
        goalId: params.goalId, kind: params.kind, role: params.role, agent: params.agent, startedAt: now(),
      };
      writeIntent(intent);
      let spawned: any;
      try {
        spawned = await rpc(pi, "spawn", {
          agent: params.agent, task: `[vault-hunter:${launchId}]\n${params.task}`, async: true, context: params.context ?? "fresh",
          ...(params.cwd ? { cwd: params.cwd } : {}), ...(params.model ? { model: params.model } : {}),
          ...(params.skill ? { skill: params.skill } : {}), ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
        }, signal);
      } catch (error) {
        if (!(error instanceof AmbiguousLaunchError)) removeIntent(launchId);
        throw error;
      }
      const asyncRunId = spawned?.details?.asyncId ?? spawned?.details?.runId;
      const asyncDir = spawned?.details?.asyncDir;
      if (!asyncRunId || !asyncDir) throw new Error("pi-subagents did not return a durable async identity.");
      const binding = readBinding(asyncDir) ?? bindIntent(intent, asyncRunId, asyncDir);
      try {
        await replayBinding(binding);
      } catch (error) {
        try { await rpc(pi, "stop", { id: asyncRunId }); } catch { /* registration failure remains primary */ }
        throw new Error(`Registry registration failed; ${asyncRunId} may still be live and must be quarantined: ${String(error)}`);
      }
      return text(`Launched registered Vault Hunter child ${asyncRunId} for ${params.goalId}.`, {
        runId: params.runId, asyncRunId, asyncDir, goalId: params.goalId, agent: params.agent,
      });
    },
  });
}
