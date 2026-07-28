import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";

const MAX_STDOUT_BYTES = 40_000;
const GET_RESOURCES = [
  "projects",
  "themes",
  "features",
  "tasks",
  "runs",
  "verifiers",
  "verifierattempts",
  "participants",
  "usage",
] as const;
const CREATE_RESOURCES = ["run"] as const;

type GetResource = typeof GET_RESOURCES[number];
type CreateResource = typeof CREATE_RESOURCES[number];

type AtlasEnvelope = {
  api_version: string;
  kind: string;
  data: unknown;
  meta: Record<string, unknown>;
};

type DriverPlacement = {
  observedAt: string;
  herdr: { workspaceId: string; tabId: string; paneId: string; terminalId: string };
  agentSession: { source: string; kind: string; value: string };
};

const SelectorSchema = Type.Object({
  identity: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
}, { additionalProperties: false });

const AtlasGetSchema = Type.Object({
  resource: Type.Union(GET_RESOURCES.map((value) => Type.Literal(value))),
  identity: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  run: Type.Optional(Type.String()),
  pending: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const AtlasCreateSchema = Type.Object({
  resource: Type.Union(CREATE_RESOURCES.map((value) => Type.Literal(value))),
  request: Type.Object({}, { additionalProperties: true }),
}, { additionalProperties: false });

const AtlasEvidenceGetSchema = SelectorSchema;

const AtlasAcceptVerifierAttemptSchema = Type.Object({
  identity: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  expectedRevision: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

const AtlasRejectVerifierAttemptSchema = Type.Object({
  identity: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  expectedRevision: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

const AtlasRetireRunSchema = Type.Object({
  identity: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  expectedRevision: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

function text(content: string, details: unknown) {
  return { content: [{ type: "text" as const, text: content }], details };
}

function restoredRunId(ctx: ExtensionContext): string | undefined {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "vault_hunter_run") continue;
    const runId = (entry.message.details as { runId?: unknown } | undefined)?.runId;
    if (typeof runId === "string" && runId) return runId;
  }
  return undefined;
}

function selectorArgs(input: { identity?: string; id?: string; name?: string }): string[] {
  const values = [input.identity, input.id, input.name].filter((value): value is string => typeof value === "string" && value.length > 0);
  if (values.length !== 1) throw new Error("atlas selector accepts exactly one of identity, id, or name.");
  if (input.identity) return [input.identity];
  if (input.id) return ["--id", input.id];
  return ["--name", input.name!];
}

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function parseEnvelope(stdout: string): AtlasEnvelope {
  const parsed = JSON.parse(stdout) as unknown;
  const envelope = ensureObject(parsed, "Atlas output") as AtlasEnvelope;
  const keys = Object.keys(envelope).sort();
  if (keys.join(",") !== "api_version,data,kind,meta") throw new Error("Atlas returned a malformed envelope.");
  if (envelope.api_version !== "atlas/v1" || typeof envelope.kind !== "string") throw new Error("Atlas returned a malformed envelope.");
  ensureObject(envelope.meta, "Atlas meta");
  return envelope;
}

async function runAtlas(argv: string[], signal?: AbortSignal, stdin?: string): Promise<AtlasEnvelope> {
  signal?.throwIfAborted();
  return await new Promise<AtlasEnvelope>((resolve, reject) => {
    const child = spawn("atlas", argv, { stdio: ["pipe", "pipe", "pipe"], signal });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;

    child.on("error", reject);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill();
        reject(new Error("Atlas output exceeded the Pi tool bound."));
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `atlas exited ${code}`));
        return;
      }
      try {
        const trimmed = stdout.trim();
        if (!trimmed) throw new Error("Atlas returned empty stdout.");
        resolve(parseEnvelope(trimmed));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(stdin ?? "");
  });
}

function requireInitialDriverPlacement(request: Record<string, unknown>, placement: DriverPlacement): void {
  const initialDriver = ensureObject(request.initial_driver, "Atlas initial_driver");
  const payload = ensureObject(initialDriver.payload, "Atlas initial_driver payload");
  const participant = ensureObject(payload.registered_participant, "Atlas registered participant");
  const session = ensureObject(participant.agent_session, "Atlas initial driver agent_session");
  const herdr = ensureObject(participant.herdr, "Atlas initial driver herdr");
  if (session.source !== placement.agentSession.source || session.kind !== placement.agentSession.kind || session.value !== placement.agentSession.value) {
    throw new Error("Atlas initial_driver agent_session is not bound to this Pi session.");
  }
  if (herdr.workspace_id !== placement.herdr.workspaceId || herdr.tab_id !== placement.herdr.tabId || herdr.pane_id !== placement.herdr.paneId || herdr.terminal_id !== placement.herdr.terminalId) {
    throw new Error("Atlas initial_driver Herdr identity is not bound to this Pi session.");
  }
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
    observedAt: new Date().toISOString(),
    herdr: { workspaceId: pane.workspace_id, tabId: pane.tab_id, paneId: pane.pane_id, terminalId: pane.terminal_id },
    agentSession: { source: session.source, kind: session.kind, value: session.value },
  };
}

export default function (pi: ExtensionAPI) {
  let activeRunId: string | undefined;

  pi.on("session_start", (_event, ctx) => {
    activeRunId = restoredRunId(ctx);
  });

  pi.registerTool({
    name: "agent_run_preflight",
    label: "Preflight Agent Run Driver",
    description: "Validate the current Pi session, cwd, and complete Herdr tuple without invoking Atlas.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _update, ctx) {
      const placement = await driverPlacement(pi, ctx, signal);
      return text("Agent Run preflight passed.", {
        sessionId: ctx.sessionManager.getSessionId(),
        sessionFile: ctx.sessionManager.getSessionFile(),
        cwd: ctx.cwd,
        herdr: placement?.herdr,
        agentSession: placement?.agentSession,
        workerRuntime: "visible-herdr-pi",
      });
    },
  });

  pi.registerTool({
    name: "atlas_get",
    label: "Atlas Get",
    description: "Read one Atlas resource through the public machine grammar.",
    parameters: AtlasGetSchema,
    async execute(_id, params, signal) {
      const argv = ["get", params.resource as GetResource];
      if (params.identity || params.id || params.name) argv.push(...selectorArgs(params));
      if (params.run || params.pending) {
        if (params.resource !== "verifierattempts") throw new Error("atlas_get only accepts run and pending for verifierattempts.");
        if (typeof params.run === "string" && params.run.length > 0) argv.push("--run", params.run);
        if (params.pending) argv.push("--pending");
      }
      const details = await runAtlas(argv, signal);
      return text(`Atlas returned ${details.kind}.`, details);
    },
  });

  pi.registerTool({
    name: "atlas_create",
    label: "Atlas Create",
    description: "Create one Atlas resource through the public machine grammar.",
    parameters: AtlasCreateSchema,
    async execute(_id, params, signal, _update, ctx) {
      const request = ensureObject(params.request, "Atlas create request");
      if (Object.prototype.hasOwnProperty.call(request, "run")) {
        const placement = await driverPlacement(pi, ctx, signal);
        if (!placement) throw new Error("Atlas Run creation requires an interactive Herdr-bound Pi session.");
        requireInitialDriverPlacement(request, placement);
      }
      const details = await runAtlas([params.resource as CreateResource, "create", "--json"], signal, `${JSON.stringify(request)}\n`);
      if (details.kind === "Run") {
        const data = details.data as { id?: unknown };
        if (typeof data?.id === "string" && data.id) activeRunId = data.id;
      }
      return text(`Atlas created ${details.kind}.`, details);
    },
  });

  pi.registerTool({
    name: "atlas_evidence_get",
    label: "Atlas Evidence Get",
    description: "Read one Atlas Evidence envelope through the public machine grammar.",
    parameters: AtlasEvidenceGetSchema,
    async execute(_id, params, signal) {
      const details = await runAtlas(["evidence", "get", ...selectorArgs(params)], signal);
      return text(`Atlas returned ${details.kind}.`, details);
    },
  });

  pi.registerTool({
    name: "atlas_accept_verifier_attempt",
    label: "Atlas Accept Verifier Attempt",
    description: "Accept one exact pending verifier attempt through the public Atlas grammar.",
    parameters: AtlasAcceptVerifierAttemptSchema,
    async execute(_id, params, signal) {
      const details = await runAtlas([
        "accept",
        "verifierattempt",
        ...selectorArgs(params),
        "--expected-revision",
        String(params.expectedRevision),
      ], signal);
      return text(`Atlas returned ${details.kind}.`, details);
    },
  });

  pi.registerTool({
    name: "atlas_reject_verifier_attempt",
    label: "Atlas Reject Verifier Attempt",
    description: "Reject one exact pending verifier attempt through the public Atlas grammar.",
    parameters: AtlasRejectVerifierAttemptSchema,
    async execute(_id, params, signal) {
      const details = await runAtlas([
        "reject",
        "verifierattempt",
        ...selectorArgs(params),
        "--expected-revision",
        String(params.expectedRevision),
        "--reason",
        params.reason,
      ], signal);
      return text(`Atlas returned ${details.kind}.`, details);
    },
  });

  pi.registerTool({
    name: "atlas_retire_run",
    label: "Atlas Retire Run",
    description: "After interactive confirmation, retire one exact Run through the public Atlas grammar.",
    parameters: AtlasRetireRunSchema,
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      if (!ctx.hasUI) throw new Error("Atlas Run retirement requires interactive confirmation; no UI is available.");
      const target = params.identity ?? params.id ?? params.name;
      const confirmed = await ctx.ui.confirm(
        "Retire Atlas Run?",
        `Retire ${target} at exact revision ${params.expectedRevision}? This removes it from active Run listings.`,
        { signal },
      );
      if (!confirmed) throw new Error(`Atlas Run ${target} retirement was declined.`);
      const details = await runAtlas([
        "run",
        "retire",
        ...selectorArgs(params),
        "--expected-revision",
        String(params.expectedRevision),
      ], signal);
      return text(`Atlas returned ${details.kind}.`, details);
    },
  });

  pi.registerTool({
    name: "atlas_capabilities",
    label: "Atlas Capabilities",
    description: "Read Atlas capabilities through the public machine grammar.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const details = await runAtlas(["capabilities", "--output", "json"], signal);
      return text(`Atlas returned ${details.kind}.`, details);
    },
  });
}

export type AtlasGetInput = Static<typeof AtlasGetSchema>;
export type AtlasCreateInput = Static<typeof AtlasCreateSchema>;
export type AtlasEvidenceGetInput = Static<typeof AtlasEvidenceGetSchema>;
export type AtlasAcceptVerifierAttemptInput = Static<typeof AtlasAcceptVerifierAttemptSchema>;
export type AtlasRejectVerifierAttemptInput = Static<typeof AtlasRejectVerifierAttemptSchema>;
export type AtlasRetireRunInput = Static<typeof AtlasRetireRunSchema>;
