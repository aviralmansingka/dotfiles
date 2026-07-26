import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(dirname(dirname(dirname(realpathSync(fileURLToPath(import.meta.url)))))));
const REGISTRY_ROOT = process.env.VAULT_HUNTER_STATE_DIR ||
  (process.env.XDG_STATE_HOME ? join(process.env.XDG_STATE_HOME, "vault-hunter") : join(homedir(), ".local", "state", "vault-hunter"));

const TaskSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  path: Type.String(),
  featurePath: Type.String(),
  kind: Type.String(),
});

const AgentSessionSchema = Type.Object(
  { source: Type.String(), kind: Type.String(), value: Type.String() },
  { additionalProperties: false },
);
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

const ListRunsSchema = Type.Object({
  taskId: Type.Optional(Type.String()),
  featurePath: Type.Optional(Type.String()),
  agentSession: Type.Optional(AgentSessionSchema),
  updatedAtFrom: Type.Optional(Type.String()),
  updatedAtThrough: Type.Optional(Type.String()),
}, { additionalProperties: false });

const RetireRunSchema = Type.Object({
  runId: Type.String(),
  expectedRevision: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export type VaultHunterListRunsInput = Static<typeof ListRunsSchema>;
export type VaultHunterRetireRunInput = Static<typeof RetireRunSchema>;

type RegistryTaskSummary = {
  id: string;
  title: string;
  path: string;
  feature_path: string;
  kind: string;
};

type RegistryRunSummary = {
  schema_version: number;
  run_id: string;
  revision: number;
  invoked_at: string;
  updated_at: string;
  task: RegistryTaskSummary;
};

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
type PendingSubagent = {
  runId: string;
  startedAt: string;
  agent: string;
  taskSha256: string;
  cwd: string;
  observationKey: string;
  parentSessionId: string;
};
type SubagentResult = {
  agent?: string;
  output?: string;
  exitCode?: number;
  model?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number; turns?: number };
  progress?: { durationMs?: number; toolCount?: number; error?: string };
};

function now(): string { return new Date().toISOString(); }
function slug(value: string): string { return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "run"; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function text(content: string, details: unknown) { return { content: [{ type: "text" as const, text: content }], details }; }

function registryString(record: any, field: string): string {
  const value = record?.[field];
  if (typeof value !== "string") throw new Error(`Registry returned an invalid ${field}.`);
  return value;
}

function registryInteger(record: any, field: string): number {
  const value = record?.[field];
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Registry returned an invalid ${field}.`);
  return value;
}

function projectRunSummary(record: any): RegistryRunSummary {
  const task = record?.task;
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("Registry returned an invalid task summary.");
  return {
    schema_version: registryInteger(record, "schema_version"),
    run_id: registryString(record, "run_id"),
    revision: registryInteger(record, "revision"),
    invoked_at: registryString(record, "invoked_at"),
    updated_at: registryString(record, "updated_at"),
    task: {
      id: registryString(task, "id"),
      title: registryString(task, "title"),
      path: registryString(task, "path"),
      feature_path: registryString(task, "feature_path"),
      kind: registryString(task, "kind"),
    },
  };
}

function boundedRunSummaries(records: RegistryRunSummary[]): RegistryRunSummary[] {
  const bounded: RegistryRunSummary[] = [];
  for (const record of records) {
    const candidate = [...bounded, record];
    if (Buffer.byteLength(JSON.stringify({ runs: candidate }), "utf8") > 40_000) break;
    bounded.push(record);
  }
  return bounded;
}

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

export default function (pi: ExtensionAPI) {
  let activeRunId: string | undefined;
  let registrationQueue = Promise.resolve();
  const pendingSubagents = new Map<string, PendingSubagent>();

  async function observe(input: Record<string, unknown>, ctx: ExtensionContext): Promise<void> {
    try { await registry(input); }
    catch (error) { if (ctx.hasUI) ctx.ui.notify(`Vault Hunter observation failed: ${String(error)}`, "warning"); }
  }

  async function recordParentUsage(runId: string, boundary: string, observationKey: string, ctx: ExtensionContext): Promise<void> {
    const observedAt = now();
    await observe({
      action: "append", root: REGISTRY_ROOT, run_id: runId, updated_at: observedAt,
      lifecycle: {
        observation_id: `parent-usage-${observationKey}`, observed_at: observedAt, kind: "parent/usage", goal_id: "run", state: "observed",
        detail: JSON.stringify({
          schema: "vault-hunter-parent-usage/v1", boundary, parent_session_id: ctx.sessionManager.getSessionId(),
          session_file: ctx.sessionManager.getSessionFile() ?? "", observed_at: observedAt, usage: parentUsage(ctx),
        }),
      },
    }, ctx);
  }

  async function reconcileInterrupted(runId: string, ctx: ExtensionContext): Promise<void> {
    let run: any;
    try { run = await registry({ action: "get", root: REGISTRY_ROOT, run_id: runId }); }
    catch { return; }
    const parentSessionId = ctx.sessionManager.getSessionId();
    const terminal = new Set((run.lifecycle ?? []).map((item: any) => item.observation_id));
    for (const item of run.lifecycle ?? []) {
      if (item.kind !== "subagent/started") continue;
      let detail: any;
      try { detail = JSON.parse(item.detail); } catch { continue; }
      if (detail?.parent_session_id !== parentSessionId) continue;
      const match = String(item.observation_id).match(/^subagent-(.+)-started$/);
      if (!match || terminal.has(`subagent-${match[1]}-finished`) || terminal.has(`subagent-${match[1]}-interrupted`)) continue;
      const observedAt = now();
      await observe({
        action: "append", root: REGISTRY_ROOT, run_id: runId, updated_at: observedAt,
        lifecycle: {
          observation_id: `subagent-${match[1]}-interrupted`, observed_at: observedAt, kind: "subagent/interrupted",
          goal_id: item.goal_id, state: "interrupted",
          detail: JSON.stringify({ schema: "vault-hunter-subagent/v1", tool_call_id: detail.tool_call_id, parent_session_id: parentSessionId, started_at: item.observed_at, ended_at: observedAt, reason: "session-recovery" }),
        },
      }, ctx);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    activeRunId = restoredRunId(ctx);
    if (activeRunId) await reconcileInterrupted(activeRunId, ctx);
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (!activeRunId) return;
    for (const [toolCallId, pending] of pendingSubagents) {
      const observedAt = now();
      await observe({
        action: "append", root: REGISTRY_ROOT, run_id: pending.runId, updated_at: observedAt,
        lifecycle: {
          observation_id: `subagent-${pending.observationKey}-interrupted`, observed_at: observedAt, kind: "subagent/interrupted",
          goal_id: `subagent/${pending.agent}`, state: "interrupted",
          detail: JSON.stringify({ schema: "vault-hunter-subagent/v1", tool_call_id: toolCallId, parent_session_id: pending.parentSessionId, started_at: pending.startedAt, ended_at: observedAt, reason: `session-${event.reason}` }),
        },
      }, ctx);
    }
    pendingSubagents.clear();
    const key = sha256(`${ctx.sessionManager.getSessionId()}:${event.reason}:${ctx.sessionManager.getLeafId() ?? "root"}`).slice(0, 20);
    await recordParentUsage(activeRunId, `session/${event.reason}`, key, ctx);
  });

  async function serializeRegistration<T>(work: () => Promise<T>): Promise<T> {
    const previous = registrationQueue;
    let release!: () => void;
    registrationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  pi.registerTool({
    name: "vault_hunter_preflight",
    label: "Preflight Vault Hunter Driver",
    description: "Validate this Pi driver's exact Herdr placement and cwd without creating or updating a Run.",
    promptSnippet: "Preflight the interactive Vault Hunter driver before the invocation checkpoint.",
    promptGuidelines: ["Call vault_hunter_preflight once before any Vault Hunter invocation vault edit; fix a failed host binding and restart the invocation instead of writing a blocker checkpoint."],
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _update, ctx) {
      const placement = await driverPlacement(pi, ctx, signal);
      if (!pi.getActiveTools().includes("subagent")) throw new Error("The required synchronous subagent tool is not active.");
      return text("Vault Hunter driver preflight passed.", {
        sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(),
        cwd: ctx.cwd, herdr: placement?.herdr, subagent: "active",
      });
    },
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
        activeRunId = runId;
        return text(`Vault Hunter Run ${runId} is observable at revision ${run.revision}.`, {
          runId, revision: run.revision, root: REGISTRY_ROOT, herdr: placement?.herdr,
        });
      });
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "subagent" || !activeRunId) return;
    const agent = typeof event.input.agent === "string" ? event.input.agent : "unknown";
    const task = typeof event.input.task === "string" ? event.input.task : "";
    const startedAt = now();
    const parentSessionId = ctx.sessionManager.getSessionId();
    const observationKey = sha256(`${parentSessionId}:${event.toolCallId}`).slice(0, 20);
    const pending = {
      runId: activeRunId, startedAt, agent, taskSha256: sha256(task),
      cwd: typeof event.input.cwd === "string" ? event.input.cwd : ctx.cwd,
      observationKey, parentSessionId,
    };
    pendingSubagents.set(event.toolCallId, pending);
    await observe({
      action: "append", root: REGISTRY_ROOT, run_id: pending.runId, updated_at: startedAt,
      participant: {
        participant_id: `headless-${observationKey}`, observed_at: startedAt, role: agent, goal_id: `subagent/${agent}`,
        herdr: null, agent_session: { source: "pi-subagents", kind: "tool-call", value: event.toolCallId },
      },
      lifecycle: {
        observation_id: `subagent-${observationKey}-started`, observed_at: startedAt, kind: "subagent/started",
        goal_id: `subagent/${agent}`, state: "running",
        detail: JSON.stringify({ schema: "vault-hunter-subagent/v1", tool_call_id: event.toolCallId, parent_session_id: parentSessionId, agent, task_sha256: pending.taskSha256, cwd: pending.cwd }),
      },
    }, ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "subagent") return;
    const pending = pendingSubagents.get(event.toolCallId);
    if (!pending) return;
    pendingSubagents.delete(event.toolCallId);
    const endedAt = now();
    const result = subagentResult(event.details);
    const usage = result?.usage;
    const output = result?.output ?? event.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    const failed = event.isError || result?.exitCode !== undefined && result.exitCode !== 0 || !!result?.progress?.error;
    await observe({
      action: "append", root: REGISTRY_ROOT, run_id: pending.runId, updated_at: endedAt,
      lifecycle: {
        observation_id: `subagent-${pending.observationKey}-finished`, observed_at: endedAt, kind: "subagent/finished",
        goal_id: `subagent/${pending.agent}`, state: failed ? "failed" : "completed",
        detail: JSON.stringify({
          schema: "vault-hunter-subagent/v1", tool_call_id: event.toolCallId, parent_session_id: pending.parentSessionId,
          agent: pending.agent, model: result?.model ?? "", task_sha256: pending.taskSha256, result_sha256: sha256(output),
          cwd: pending.cwd, started_at: pending.startedAt, ended_at: endedAt,
          duration_ms: result?.progress?.durationMs ?? Date.parse(endedAt) - Date.parse(pending.startedAt),
          exit_status: result?.exitCode ?? (failed ? 1 : 0), tool_count: result?.progress?.toolCount ?? 0,
          usage: {
            input: usage?.input ?? 0, output: usage?.output ?? 0, cache_read: usage?.cacheRead ?? 0,
            cache_write: usage?.cacheWrite ?? 0, total_tokens: (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0),
            cost: usage?.cost ?? 0, turns: usage?.turns ?? 0,
          },
          error: result?.progress?.error ?? "",
        }),
      },
    }, ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "vault_hunter_record" || event.isError) return;
    const input = event.input as { runId?: unknown; lifecycle?: { kind?: unknown; state?: unknown } };
    const runId = typeof input.runId === "string" ? input.runId : activeRunId;
    if (!runId) return;
    const kind = typeof input.lifecycle?.kind === "string" ? input.lifecycle.kind : "";
    const state = typeof input.lifecycle?.state === "string" ? input.lifecycle.state : "";
    if (!/checkpoint|terminal|run\/done|cleanup/.test(kind) && !/^(done|completed|blocked|rejected|awaiting-human-evaluation)$/.test(state)) return;
    const key = sha256(`${ctx.sessionManager.getSessionId()}:${event.toolCallId}`).slice(0, 20);
    await recordParentUsage(runId, `vault_hunter_record/${kind || state}`, key, ctx);
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

  pi.registerTool({
    name: "vault_hunter_list_runs",
    label: "List Vault Hunter Runs",
    description: "List active Vault Hunter Run summaries through the Registry command contract. Structured results are capped below 50KB and exclude observation histories.",
    parameters: ListRunsSchema,
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      const filter = {
        ...(params.taskId !== undefined ? { task_id: params.taskId } : {}),
        ...(params.featurePath !== undefined ? { feature_path: params.featurePath } : {}),
        ...(params.agentSession !== undefined ? { agent_session: {
          source: params.agentSession.source, kind: params.agentSession.kind, value: params.agentSession.value,
        } } : {}),
        ...(params.updatedAtFrom !== undefined ? { updated_at_from: params.updatedAtFrom } : {}),
        ...(params.updatedAtThrough !== undefined ? { updated_at_through: params.updatedAtThrough } : {}),
      };
      const response = await registry({ action: "list", root: REGISTRY_ROOT, filter }, signal);
      if (!Array.isArray(response)) throw new Error("Registry returned an invalid list response.");
      const projected = response.map(projectRunSummary);
      const runs = boundedRunSummaries(projected);
      const suffix = runs.length === projected.length ? "" : ` ${projected.length - runs.length} additional summaries were omitted to bound the result.`;
      return text(`Listed ${runs.length} active Vault Hunter Run summaries.${suffix}`, { runs });
    },
  });

  pi.registerTool({
    name: "vault_hunter_retire_run",
    label: "Retire Vault Hunter Run",
    description: "After interactive confirmation, retire one exact active Vault Hunter Run revision through the Registry command contract.",
    parameters: RetireRunSchema,
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      if (!ctx.hasUI) throw new Error("Vault Hunter Run retirement requires interactive confirmation; no UI is available.");
      const confirmed = await ctx.ui.confirm(
        "Retire Vault Hunter Run?",
        `Retire ${params.runId} at exact revision ${params.expectedRevision}? This removes it from active Run listings.`,
        { signal },
      );
      if (!confirmed) throw new Error(`Vault Hunter Run ${params.runId} retirement was declined.`);
      signal?.throwIfAborted();
      const response = await registry({
        action: "retire", root: REGISTRY_ROOT,
        run_id: params.runId, expected_revision: params.expectedRevision,
      }, signal);
      const runId = registryString(response, "run_id");
      const revision = registryInteger(response, "revision");
      if (runId !== params.runId || revision !== params.expectedRevision) {
        throw new Error("Registry returned a different retired Run identity or revision.");
      }
      return text(`Retired Vault Hunter Run ${runId} at revision ${revision}.`, { runId, revision });
    },
  });
}
