import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROLES = [
  "verifier-builder",
  "convergence-engineer",
  "delivery-steward",
] as const;
const WIDGET_ID = "vault-hunter-crew";
const GRACE_MS = 30_000;
const POLL_MS = 1_000;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const MAX_TOOL_OUTPUT = 40_000;
const MAX_REGISTRY_OUTPUT = 1 << 20;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const CHILD_EXTENSION = realpathSync(join(EXTENSION_DIR, "vault-hunter-crew-child.ts"));
const HERDR_STATE_EXTENSION = realpathSync(join(EXTENSION_DIR, "herdr-agent-state.ts"));

type Role = (typeof ROLES)[number];
type TerminalState = "succeeded" | "failed" | "interrupted";
type SessionIdentity = { source: string; kind: string; value: string };
type HerdrIdentity = {
  workspaceId: string;
  tabId: string;
  paneId: string;
  terminalId: string;
};
type JournalEvent = {
  v: 1;
  seq: number;
  at: string;
  runId: string;
  goalId: string;
  participantId: string;
  role: Role;
  type: string;
  [key: string]: unknown;
};
type Member = {
  runId: string;
  goalId: string;
  participantId: string;
  workerId: string;
  role: Role;
  name: string;
  cwd: string;
  journal: string;
  session: SessionIdentity;
  herdr: HerdrIdentity;
  startedAt: string;
  status: string;
  retained: boolean;
  registered: boolean;
  workerRegistered: boolean;
  lifecycleOnly?: boolean;
  graceDeadline?: number;
  lastHandoffKey?: string;
  handoffValid?: boolean;
  lastSteering?: { summary: string; sha256: string };
  terminalAt?: string;
  terminalReason?: string;
  terminalState?: TerminalState;
};

type RegistryRun = {
  schema_version: number;
  run_id: string;
  revision: number;
  participants?: any[];
  observations?: any[];
};

const LaunchSchema = Type.Object(
  {
    runId: Type.String({ description: "Exact active Vault Hunter Run ID." }),
    goalId: Type.String({ pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Stable Goal or verifier ID for this child." }),
    role: StringEnum(ROLES, { description: "Vault Hunter crew persona." }),
    prompt: Type.String({ minLength: 1, maxLength: 200_000, description: "Complete bounded assignment released only after registration." }),
    cwd: Type.Optional(Type.String({ description: "Run-owned working directory; defaults to the parent cwd." })),
  },
  { additionalProperties: false },
);
const SendSchema = Type.Object(
  {
    runId: Type.String(),
    participantId: Type.String(),
    prompt: Type.String({ minLength: 1, maxLength: 200_000 }),
  },
  { additionalProperties: false },
);
const ReleaseSchema = Type.Object(
  {
    runId: Type.String(),
    participantId: Type.String(),
    disposition: StringEnum(["close", "retain", "abort"] as const),
    result: Type.Optional(Type.String({ maxLength: 160, description: "Safe process-result summary; never a Task acceptance decision." })),
  },
  { additionalProperties: false },
);
const InspectSchema = Type.Object(
  {
    runId: Type.String(),
    participantId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

function stateRoot(): string {
  return process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "vault-hunter", "crew")
    : join(homedir(), ".local", "state", "vault-hunter", "crew");
}

function registryRoot(): string | undefined {
  return process.env.VAULT_HUNTER_STATE_DIR;
}

function now(): string {
  return new Date().toISOString();
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value ?? null))
    .digest("hex");
}

function safeLine(value: string): string {
  return (
    value
      .split(/\r?\n/, 1)[0]
      ?.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "(empty)"
  );
}

function slug(value: string, length = 40): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, length) || "crew";
}

function result(content: string, details: unknown) {
  return { content: [{ type: "text" as const, text: content }], details };
}

function unwrap(stdout: string): any {
  const decoded = JSON.parse(stdout);
  return decoded?.result ?? decoded;
}

async function herdr(
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<any> {
  const response = await pi.exec("herdr", args, { signal, timeout: 15_000 });
  if (response.code !== 0)
    throw new Error(response.stderr.trim() || `herdr ${args.slice(0, 2).join(" ")} exited ${response.code}`);
  if (Buffer.byteLength(response.stdout) > MAX_TOOL_OUTPUT)
    throw new Error("Herdr output exceeded the Vault Hunter Crew bound.");
  return unwrap(response.stdout);
}

async function registry(
  _pi: ExtensionAPI,
  request: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  signal?.throwIfAborted();
  return await new Promise((resolveRequest, reject) => {
    const child = spawn("vault-hunter-registry", [], {
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REGISTRY_OUTPUT) child.kill();
      else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (bytes > MAX_REGISTRY_OUTPUT)
        return reject(new Error("Registry output exceeded the 1 MiB Vault Hunter Crew bound."));
      if (code !== 0)
        return reject(new Error(stderr.trim() || `vault-hunter-registry exited ${code}`));
      try { resolveRequest(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.end(`${JSON.stringify({ ...request, ...(registryRoot() ? { root: registryRoot() } : {}) })}\n`);
  });
}

async function getRun(
  pi: ExtensionAPI,
  runId: string,
  signal?: AbortSignal,
): Promise<RegistryRun> {
  if (!SAFE_ID.test(runId)) throw new Error(`Invalid Run ID ${runId}.`);
  return await registry(pi, { action: "get", run_id: runId }, signal) as RegistryRun;
}

function wireHerdr(value: HerdrIdentity) {
  return {
    workspace_id: value.workspaceId,
    tab_id: value.tabId,
    pane_id: value.paneId,
    terminal_id: value.terminalId,
  };
}

function wireSession(value: SessionIdentity) {
  return { source: value.source, kind: value.kind, value: value.value };
}

function sameSession(a: any, b: SessionIdentity): boolean {
  return a?.source === b.source && a?.kind === b.kind && a?.value === b.value;
}

function sameHerdr(a: any, b: HerdrIdentity): boolean {
  return a?.workspace_id === b.workspaceId &&
    a?.tab_id === b.tabId &&
    a?.pane_id === b.paneId &&
    a?.terminal_id === b.terminalId;
}

function participantObservation(run: RegistryRun, member: Member): any | undefined {
  if (run.schema_version === 1)
    return run.participants?.find(
      (item) => item.participant_id === member.participantId &&
        sameSession(item.agent_session, member.session) && sameHerdr(item.herdr, member.herdr),
    );
  return run.observations?.find((item) => {
    const payload = item.payload?.registered_participant;
    return payload?.participant_id === member.participantId &&
      sameSession(payload.agent_session, member.session) && sameHerdr(payload.herdr, member.herdr);
  });
}

function runHasActiveRole(run: RegistryRun, role: Role): boolean {
  if (run.schema_version === 1)
    return Boolean(run.participants?.some((participant) =>
      participant.role === role && !(run as any).lifecycle?.some((item: any) =>
        item.observation_id === `${participant.participant_id}-terminal`)));
  const observations = run.observations ?? [];
  return observations.some((observation) => {
    const participant = observation.payload?.registered_participant;
    return observation.kind === "registered_participant" && observation.state === "active" &&
      participant?.role === role && !observations.some((item) =>
        item.kind === "registered_participant" && item.state !== "active" &&
        item.payload?.registered_participant?.participant_id === participant.participant_id);
  });
}

function driverOwnsRun(
  run: RegistryRun,
  session: SessionIdentity,
  workspaceId: string,
): boolean {
  if (run.schema_version === 1)
    return Boolean(run.participants?.some(
      (item) => item.role === "driver" && sameSession(item.agent_session, session) &&
        item.herdr?.workspace_id === workspaceId,
    ));
  return Boolean(run.observations?.some((item) => {
    const payload = item.payload?.registered_participant;
    return item.kind === "registered_participant" && item.state === "active" &&
      payload?.role === "driver" && sameSession(payload.agent_session, session) &&
      payload.herdr?.workspace_id === workspaceId;
  }));
}

function envelope(
  member: Member,
  observationId: string,
  kind: "registered_participant" | "worker" | "runtime_telemetry",
  state: string,
  observedAt: string,
  payload: Record<string, unknown>,
  terminal = false,
) {
  return {
    observation_id: observationId,
    kind,
    state,
    goal_id: member.goalId,
    title: `${member.role} ${state}`,
    summary: `${member.role} process ${state}.`,
    observed_at: observedAt,
    correlation_id: member.runId,
    actor: { kind: "participant", id: member.participantId, agent_session: wireSession(member.session) },
    source: { kind: "producer", id: "vault-hunter-crew" },
    redaction_class: "internal",
    ...(kind !== "runtime_telemetry" ? {
      started_at: member.startedAt,
      ...(terminal ? { finished_at: observedAt } : {}),
    } : {}),
    payload: { [kind]: payload },
  };
}

async function appendV2(
  pi: ExtensionAPI,
  runId: string,
  observation: any,
  signal?: AbortSignal,
): Promise<RegistryRun> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const run = await getRun(pi, runId, signal);
    try {
      return await registry(pi, {
        action: "append_observation",
        run_id: runId,
        expected_revision: run.revision,
        updated_at: observation.observed_at,
        observation,
      }, signal) as RegistryRun;
    } catch (error) {
      if (!String(error).includes("revision conflict")) throw error;
    }
  }
  throw new Error(`Registry revision conflicts did not settle for ${runId}.`);
}

async function registerMember(
  pi: ExtensionAPI,
  run: RegistryRun,
  member: Member,
  signal?: AbortSignal,
): Promise<void> {
  if (run.schema_version === 1) {
    await registry(pi, {
      action: "append",
      run_id: member.runId,
      updated_at: member.startedAt,
      participant: {
        participant_id: member.participantId,
        observed_at: member.startedAt,
        role: member.role,
        goal_id: member.goalId,
        herdr: wireHerdr(member.herdr),
        agent_session: wireSession(member.session),
      },
      lifecycle: {
        observation_id: `${member.participantId}-started`,
        observed_at: member.startedAt,
        kind: "worker",
        goal_id: member.goalId,
        state: "active",
        detail: `${member.role} registered in exact Run-owned Herdr tab.`,
      },
    }, signal);
    member.registered = true;
    member.workerRegistered = true;
    return;
  }
  if (run.schema_version !== 2)
    throw new Error(`Unsupported Registry schema ${run.schema_version}.`);
  await appendV2(pi, member.runId, envelope(
    member,
    `${member.participantId}-participant-started`,
    "registered_participant",
    "active",
    member.startedAt,
    {
      participant_id: member.participantId,
      role: member.role,
      agent_session: wireSession(member.session),
      herdr: wireHerdr(member.herdr),
    },
  ), signal);
  member.registered = true;
  await appendV2(pi, member.runId, envelope(
    member,
    `${member.workerId}-started`,
    "worker",
    "active",
    member.startedAt,
    {
      worker_id: member.workerId,
      role: member.role,
      stage: member.role,
      owner_participant_id: member.participantId,
      agent_session: wireSession(member.session),
      herdr: wireHerdr(member.herdr),
    },
  ), signal);
  member.workerRegistered = true;
}

async function recordTerminal(
  pi: ExtensionAPI,
  member: Member,
  state: TerminalState,
  reason: string,
): Promise<void> {
  if (!member.registered) return;
  member.terminalAt ??= now();
  member.terminalReason ??= safeLine(reason);
  member.terminalState ??= state;
  if (member.terminalState !== state)
    throw new Error(`Terminal state for ${member.participantId} changed during retry.`);
  const observedAt = member.terminalAt;
  const run = await getRun(pi, member.runId);
  if (run.schema_version === 1) {
    await registry(pi, {
      action: "append",
      run_id: member.runId,
      updated_at: observedAt,
      lifecycle: {
        observation_id: `${member.participantId}-terminal`,
        observed_at: observedAt,
        kind: "worker",
        goal_id: member.goalId,
        state: member.terminalState,
        detail: `${member.terminalReason}; journal cleanup verified.`,
      },
    });
    return;
  }
  const resultText = `${member.terminalReason}; journal cleanup verified`;
  if (member.workerRegistered)
    await appendV2(pi, member.runId, envelope(
      member,
      `${member.workerId}-terminal`,
      "worker",
      member.terminalState,
      observedAt,
      {
        worker_id: member.workerId,
        role: member.role,
        stage: member.role,
        owner_participant_id: member.participantId,
        agent_session: wireSession(member.session),
        herdr: wireHerdr(member.herdr),
        terminal_result: resultText,
      },
      true,
    ));
  await appendV2(pi, member.runId, envelope(
    member,
    `${member.participantId}-participant-terminal`,
    "registered_participant",
    member.terminalState,
    observedAt,
    {
      participant_id: member.participantId,
      role: member.role,
      agent_session: wireSession(member.session),
      herdr: wireHerdr(member.herdr),
      terminal_result: resultText,
    },
    true,
  ));
}

async function assertMemberOwnership(pi: ExtensionAPI, member: Member, signal?: AbortSignal): Promise<void> {
  const run = await getRun(pi, member.runId, signal);
  if (!participantObservation(run, member))
    throw new Error(`Registry ownership for ${member.participantId} no longer matches its exact Pi and Herdr identity.`);
}

async function parentPlacement(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<{ herdr: HerdrIdentity; session: SessionIdentity }> {
  if (ctx.mode !== "tui" || process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID)
    throw new Error("Vault Hunter Crew requires an interactive Herdr-bound parent Pi session.");
  const resolved = await herdr(pi, ["pane", "get", process.env.HERDR_PANE_ID], signal);
  const pane = resolved.pane ?? resolved;
  const sessionFile = ctx.sessionManager.getSessionFile();
  const session = pane.agent_session;
  if (!sessionFile || !sameSession(session, { source: "herdr:pi", kind: "path", value: sessionFile }))
    throw new Error("The current Herdr pane is not bound to this Pi session.");
  const fields = [pane.workspace_id, pane.tab_id, pane.pane_id, pane.terminal_id];
  if (fields.some((value) => typeof value !== "string" || !value) || pane.pane_id !== process.env.HERDR_PANE_ID)
    throw new Error("Herdr returned an incomplete or contradictory parent identity.");
  return {
    herdr: {
      workspaceId: pane.workspace_id,
      tabId: pane.tab_id,
      paneId: pane.pane_id,
      terminalId: pane.terminal_id,
    },
    session: { source: session.source, kind: session.kind, value: session.value },
  };
}

const BASE_FIELDS = new Set([
  "v", "seq", "at", "runId", "goalId", "participantId", "role", "type",
]);
const EVENT_FIELDS: Record<string, Set<string>> = {
  ready: new Set(["session", "herdr"]),
  released: new Set(["summary", "sha256", "proof"]),
  steering: new Set(["summary", "sha256"]),
  lifecycle: new Set(["state", "reason"]),
  tool: new Set(["phase", "name", "summary", "sha256", "failed"]),
  progress: new Set(["textChars", "thinkingChars"]),
  usage: new Set(["usage"]),
  handoff: new Set(["summary", "sha256", "fields", "valid"]),
};

function safeEvent(value: unknown): value is JournalEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as any;
  if (event.v !== 1 || !Number.isInteger(event.seq) || event.seq < 1 ||
    typeof event.at !== "string" || !SAFE_ID.test(event.runId ?? "") ||
    typeof event.goalId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(event.goalId) || !SAFE_ID.test(event.participantId ?? "") ||
    !ROLES.includes(event.role) || !EVENT_FIELDS[event.type]) return false;
  const allowed = EVENT_FIELDS[event.type]!;
  if (Object.keys(event).some((key) => !BASE_FIELDS.has(key) && !allowed.has(key))) return false;
  for (const key of ["summary", "sha256", "proof", "state", "reason", "phase", "name"])
    if (event[key] !== undefined && typeof event[key] !== "string") return false;
  if (event.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(event.sha256)) return false;
  if (event.proof !== undefined && !/^[a-f0-9]{64}$/.test(event.proof)) return false;
  if (event.summary !== undefined && event.summary.length > 160) return false;
  if (event.failed !== undefined && typeof event.failed !== "boolean") return false;
  if (event.valid !== undefined && typeof event.valid !== "boolean") return false;
  if (event.fields !== undefined && (!Array.isArray(event.fields) ||
    event.fields.some((item: unknown) => typeof item !== "string" || item.length > 40))) return false;
  if (event.usage !== undefined) {
    if (!event.usage || typeof event.usage !== "object" || Array.isArray(event.usage)) return false;
    if (Object.entries(event.usage).some(([key, item]) =>
      !["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"].includes(key) ||
      typeof item !== "number" || !Number.isFinite(item) || item < 0)) return false;
  }
  if (event.type === "ready") {
    if (!event.session || typeof event.session !== "object" || Array.isArray(event.session) ||
      Object.keys(event.session).some((key) => !["source", "kind", "value"].includes(key)) ||
      [event.session.source, event.session.kind, event.session.value].some((item) => typeof item !== "string" || !item)) return false;
    if (!event.herdr || typeof event.herdr !== "object" || Array.isArray(event.herdr) ||
      Object.keys(event.herdr).some((key) => !["workspaceId", "tabId", "paneId"].includes(key)) ||
      [event.herdr.workspaceId, event.herdr.tabId, event.herdr.paneId].some((item) => typeof item !== "string" || !item)) return false;
  }
  for (const key of ["textChars", "thinkingChars"])
    if (event[key] !== undefined && (!Number.isInteger(event[key]) || event[key] < 0)) return false;
  return true;
}

function readJournal(
  path: string,
  expected?: Partial<Pick<Member, "runId" | "goalId" | "participantId" | "role">>,
): { events: JournalEvent[]; lifecycleOnly: boolean; problem?: string } {
  if (!existsSync(path)) return { events: [], lifecycleOnly: true, problem: "journal missing" };
  const events: JournalEvent[] = [];
  try {
    let priorSequence = 0;
    for (const candidate of [`${path}.2`, `${path}.1`, path]) {
      if (!existsSync(candidate)) continue;
      const stat = lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe journal file ${basename(candidate)}`);
      for (const line of readFileSync(candidate, "utf8").split("\n")) {
        if (!line) continue;
        const value = JSON.parse(line);
        if (!safeEvent(value)) throw new Error(`unsafe event in ${basename(candidate)}`);
        if (value.seq <= priorSequence) throw new Error(`non-monotonic sequence in ${basename(candidate)}`);
        priorSequence = value.seq;
        for (const key of ["runId", "goalId", "participantId", "role"] as const)
          if (expected?.[key] !== undefined && value[key] !== expected[key])
            throw new Error(`journal ${key} does not match custody`);
        events.push(value);
      }
    }
  } catch (error) {
    return { events: [], lifecycleOnly: true, problem: `journal corrupt: ${safeLine(String(error))}` };
  }
  return { events, lifecycleOnly: false };
}

function currentHandoff(events: JournalEvent[]): any | undefined {
  const handoffIndex = events.findLastIndex((event) => event.type === "handoff");
  const steeringIndex = events.findLastIndex((event) => event.type === "steering");
  return handoffIndex > steeringIndex ? events[handoffIndex] : undefined;
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function journalPath(runId: string, participantId: string): string {
  return join(stateRoot(), runId, `${participantId}.jsonl`);
}

function cleanupJournal(member: Member): void {
  for (const path of [member.journal, `${member.journal}.1`, `${member.journal}.2`])
    rmSync(path, { force: true });
  if ([member.journal, `${member.journal}.1`, `${member.journal}.2`].some(existsSync))
    throw new Error(`Journal cleanup could not be verified for ${member.participantId}.`);
  try {
    if (readdirSync(dirname(member.journal)).length === 0)
      rmSync(dirname(member.journal), { recursive: false });
  } catch { /* another child still owns this Run directory */ }
}

function personaPrompt(role: Role, prompt: string): string {
  const contract: Record<Role, string> = {
    "verifier-builder": "Build or sharpen only the declared verifier boundary and return a structured handoff. Do not accept evidence or mutate canonical vault state.",
    "convergence-engineer": "Own the single active implementation write lease. Converge the frozen verifier manifest, then return a structured handoff and wait for explicit release.",
    "delivery-steward": "Drive the outer No Mistakes delivery boundary. Independent review and final verifier certification belong inside No Mistakes; never make canonical vault decisions.",
  };
  const templates: Record<Role, string> = {
    "verifier-builder": "HANDOFF:\nOutcome:\nVerifier manifest:\nBaseline:\nEvidence:\nRisks:\nBlockers:",
    "convergence-engineer": "HANDOFF:\nOutcome:\nBase:\nHead:\nTree:\nChanged paths:\nVerifier results:\nArtifacts:\nRisks:\nBlockers:",
    "delivery-steward": "HANDOFF:\nOutcome:\nCandidate tree:\nReview:\nCertification:\nPR/CI:\nRisks:\nBlockers:",
  };
  return [
    `You are the Vault Hunter ${role}.`,
    contract[role],
    "Stay within the supplied paths and stop conditions. Never expose chain-of-thought or raw secrets in the handoff.",
    "Finish with exactly this labeled handoff shape; every label is required even when its value is None:",
    templates[role],
    "",
    prompt,
  ].join("\n");
}

async function assertSoloTab(
  pi: ExtensionAPI,
  workspaceId: string,
  tabId: string,
  signal?: AbortSignal,
): Promise<void> {
  const listed = await herdr(pi, ["tab", "list", "--workspace", workspaceId], signal);
  const tab = Array.isArray(listed.tabs) ? listed.tabs.find((item: any) => item.tab_id === tabId) : undefined;
  if (!tab || tab.workspace_id !== workspaceId || tab.pane_count !== 1)
    throw new Error(`Refusing to close ${tabId}: it is absent, moved, or no longer a dedicated one-pane tab.`);
}

async function waitForExactTermination(
  pi: ExtensionAPI,
  member: Pick<Member, "participantId" | "session">,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const listed = await herdr(pi, ["agent", "list"], signal);
    if (!Array.isArray(listed.agents))
      throw new Error("Herdr returned a malformed agent list while awaiting child termination.");
    if (!listed.agents.some((agent: any) => sameSession(agent.agent_session, member.session))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Exact child ${member.participantId} remained live after tab closure.`);
}

async function waitForTabTermination(
  pi: ExtensionAPI,
  tabId: string,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const listed = await herdr(pi, ["agent", "list"], signal);
    if (!Array.isArray(listed.agents))
      throw new Error("Herdr returned a malformed agent list while awaiting tab termination.");
    if (!listed.agents.some((agent: any) => agent.tab_id === tabId)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Child in exact tab ${tabId} remained live after tab closure.`);
}

async function sendPrompt(
  pi: ExtensionAPI,
  member: Member,
  prompt: string,
  marker = "",
  signal?: AbortSignal,
): Promise<void> {
  const live = await herdr(pi, ["agent", "get", member.name], signal);
  const agent = live.agent ?? live;
  if (!sameSession(agent.agent_session, member.session) ||
    agent.workspace_id !== member.herdr.workspaceId ||
    agent.tab_id !== member.herdr.tabId || agent.pane_id !== member.herdr.paneId ||
    agent.terminal_id !== member.herdr.terminalId)
    throw new Error(`Live identity for ${member.participantId} no longer matches its exact Run ownership.`);
  await herdr(pi, ["pane", "send-text", member.herdr.paneId, `${marker}${prompt}`], signal);
  await herdr(pi, ["pane", "send-keys", member.herdr.paneId, "return"], signal);
}

async function waitForReady(
  pi: ExtensionAPI,
  member: Omit<Member, "session" | "herdr" | "registered" | "workerRegistered" | "status" | "retained"> & { tabId: string },
  expectedWorkspace: string,
  expectedPane: string | undefined,
  signal?: AbortSignal,
): Promise<{ session: SessionIdentity; herdr: HerdrIdentity; startedAt: string }> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const journal = readJournal(member.journal, member);
    const ready = journal.events.find((event) => event.type === "ready") as any;
    if (ready) {
      const live = await herdr(pi, ["agent", "get", member.name], signal);
      const agent = live.agent ?? live;
      const identity = {
        workspaceId: agent.workspace_id,
        tabId: agent.tab_id,
        paneId: agent.pane_id,
        terminalId: agent.terminal_id,
      };
      if (!sameSession(agent.agent_session, ready.session) ||
        identity.workspaceId !== expectedWorkspace || identity.tabId !== member.tabId ||
        !identity.paneId || !identity.terminalId ||
        ready.herdr?.workspaceId !== identity.workspaceId ||
        ready.herdr?.tabId !== identity.tabId || ready.herdr?.paneId !== identity.paneId ||
        expectedPane && identity.paneId !== expectedPane)
        throw new Error("Child companion and Herdr returned contradictory launch identities.");
      return { session: ready.session, herdr: identity, startedAt: ready.at };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Child companion did not durably report its Pi session within 30 seconds.");
}

export default function (pi: ExtensionAPI) {
  const members = new Map<string, Member>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let currentCtx: ExtensionContext | undefined;
  let polling = false;
  let recoveryHealthy = false;
  let custodyQueue = Promise.resolve();

  async function serializeCustody<T>(work: () => Promise<T>): Promise<T> {
    const previous = custodyQueue;
    let release!: () => void;
    custodyQueue = new Promise<void>((resolveQueue) => { release = resolveQueue; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  function retainedFromSession(ctx: ExtensionContext): Set<string> {
    const retained = new Set<string>();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message" || entry.message.role !== "toolResult" ||
        entry.message.toolName !== "vault_hunter_crew_release" || entry.message.isError) continue;
      const details = entry.message.details as any;
      if (typeof details?.participantId !== "string") continue;
      if (details.retained === true) retained.add(details.participantId);
      if (details.journalCleanupVerified === true) retained.delete(details.participantId);
    }
    return retained;
  }

  function active(runId: string, role?: Role): Member[] {
    return [...members.values()].filter((member) =>
      member.runId === runId && member.status !== "closed" && (!role || member.role === role));
  }

  function renderWidget(ctx: ExtensionContext): void {
    const live = [...members.values()].filter((member) => member.status !== "closed");
    if (!live.length) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const lines = [ctx.ui.theme.fg("accent", ctx.ui.theme.bold("Vault Hunter Crew"))];
    for (const member of live) {
      const grace = member.graceDeadline
        ? ` · closes in ${Math.max(0, Math.ceil((member.graceDeadline - Date.now()) / 1000))}s`
        : "";
      const degraded = member.lifecycleOnly ? " · lifecycle-only" : "";
      const steering = member.lastSteering
        ? ` · steer ${member.lastSteering.summary} #${member.lastSteering.sha256.slice(0, 8)}`
        : "";
      lines.push(`${member.role} · ${member.status}${grace}${degraded}${steering} · ${member.herdr.tabId}`);
    }
    ctx.ui.setWidget(WIDGET_ID, lines);
  }

  async function closeMember(member: Member, state: TerminalState, reason: string): Promise<void> {
    if (member.status === "closed") return;
    await assertMemberOwnership(pi, member);
    if (member.status === "closed-unrecorded") {
      await recordTerminal(pi, member, state, reason);
      member.status = "closed";
      if (currentCtx) renderWidget(currentCtx);
      return;
    }
    const live = await herdr(pi, ["agent", "get", member.name]);
    const agent = live.agent ?? live;
    if (!sameSession(agent.agent_session, member.session) || !sameHerdr({
      workspace_id: agent.workspace_id,
      tab_id: agent.tab_id,
      pane_id: agent.pane_id,
      terminal_id: agent.terminal_id,
    }, member.herdr))
      throw new Error(`Refusing to close ${member.participantId}: live ownership changed.`);
    await assertSoloTab(pi, member.herdr.workspaceId, member.herdr.tabId);
    const closed = await herdr(pi, ["tab", "close", member.herdr.tabId]);
    if (closed.type !== "tab_closed" || closed.tab_id !== member.herdr.tabId)
      throw new Error(`Herdr did not confirm exact tab closure for ${member.participantId}.`);
    await waitForExactTermination(pi, member);
    cleanupJournal(member);
    member.status = "closed-unrecorded";
    await recordTerminal(pi, member, state, reason);
    member.status = "closed";
    member.graceDeadline = undefined;
    renderWidget(currentCtx!);
  }

  async function poll(): Promise<void> {
    if (polling || !currentCtx) return;
    polling = true;
    try {
      for (const member of members.values()) {
        if (member.status === "closed") continue;
        const journal = readJournal(member.journal, member);
        member.lifecycleOnly = journal.lifecycleOnly;
        if (!journal.lifecycleOnly) {
          const lifecycle = [...journal.events].reverse().find((event) => event.type === "lifecycle") as any;
          if (lifecycle?.state) member.status = lifecycle.state;
          const handoffIndex = journal.events.findLastIndex((event) => event.type === "handoff");
          const handoff = currentHandoff(journal.events);
          const steeringAfterHandoff = handoffIndex >= 0 && !handoff;
          const key = handoff ? `${handoff.at}:${handoff.sha256}` : undefined;
          member.handoffValid = handoff?.valid === true;
          const steering = [...journal.events].reverse().find((event) => event.type === "steering") as any;
          if (steering?.summary && steering?.sha256)
            member.lastSteering = { summary: steering.summary, sha256: steering.sha256 };
          if (member.status === "working" || steeringAfterHandoff) member.graceDeadline = undefined;
          if (member.role === "verifier-builder" && member.handoffValid && key && key !== member.lastHandoffKey) {
            member.lastHandoffKey = key;
            if (!member.retained && !steeringAfterHandoff) member.graceDeadline = Date.now() + GRACE_MS;
          }
        }
        if (member.role === "verifier-builder" && member.graceDeadline &&
          Date.now() >= member.graceDeadline && member.status === "idle")
          await serializeCustody(() => closeMember(member, "succeeded", "verifier-builder grace elapsed after validated durable handoff"));
      }
    } catch (error) {
      currentCtx.ui.notify(`Vault Hunter Crew monitor: ${safeLine(String(error))}`, "warning");
    } finally {
      polling = false;
      if (currentCtx) renderWidget(currentCtx);
    }
  }

  async function reconnect(ctx: ExtensionContext): Promise<void> {
    members.clear();
    const retained = retainedFromSession(ctx);
    const placement = await parentPlacement(pi, ctx);
    const listed = await herdr(pi, ["agent", "list"]);
    if (!Array.isArray(listed.agents)) throw new Error("Herdr returned a malformed agent list during Crew recovery.");
    const agents = listed.agents;
    for (const runId of existsSync(stateRoot()) ? readdirSync(stateRoot()) : []) {
      const directory = join(stateRoot(), runId);
      let files: string[];
      try { files = readdirSync(directory).filter((file) => file.endsWith(".jsonl")); }
      catch { continue; }
      for (const file of files) {
        const journal = join(directory, file);
        const replay = readJournal(journal, {
          runId,
          participantId: file.slice(0, -".jsonl".length),
        });
        const ready = replay.events.find((event) => event.type === "ready") as any;
        if (!ready || ready.runId !== runId) continue;
        const live = agents.find((agent: any) => sameSession(agent.agent_session, ready.session));
        if (!live || live.workspace_id !== placement.herdr.workspaceId ||
          live.tab_id !== ready.herdr?.tabId || live.pane_id !== ready.herdr?.paneId) continue;
        const member: Member = {
          runId,
          goalId: ready.goalId,
          participantId: ready.participantId,
          workerId: `${ready.participantId}-worker`,
          role: ready.role,
          name: live.name,
          cwd: live.cwd,
          journal,
          session: ready.session,
          herdr: {
            workspaceId: live.workspace_id,
            tabId: live.tab_id,
            paneId: live.pane_id,
            terminalId: live.terminal_id,
          },
          startedAt: ready.at,
          status: live.agent_status ?? "unknown",
          retained: retained.has(ready.participantId),
          registered: false,
          workerRegistered: false,
          lifecycleOnly: replay.lifecycleOnly,
        };
        const run = await getRun(pi, runId);
        if (!participantObservation(run, member)) continue;
        member.registered = true;
        member.workerRegistered = run.schema_version === 1 || Boolean(run.observations?.some((item: any) =>
          item.kind === "worker" && item.payload?.worker?.owner_participant_id === member.participantId));
        members.set(member.participantId, member);
      }
    }

    // A missing or corrupt journal cannot prove absence. Rebuild lifecycle-only
    // custody from the exact Registry participant/session and live Herdr tuple.
    const summaries = await registry(pi, {
      action: "list",
      filter: { agent_session: wireSession(placement.session) },
    });
    if (!Array.isArray(summaries)) throw new Error("Registry returned a malformed Run list during Crew recovery.");
    for (const summary of summaries) {
        const run = await getRun(pi, summary.run_id);
        if (!driverOwnsRun(run, placement.session, placement.herdr.workspaceId)) continue;
        if (run.schema_version === 1) {
          for (const participant of run.participants ?? []) {
            if (!ROLES.includes(participant.role) || members.has(participant.participant_id)) continue;
            if ((run as any).lifecycle?.some((item: any) => item.observation_id === `${participant.participant_id}-terminal`)) continue;
            const live = agents.find((item: any) => sameSession(item.agent_session, participant.agent_session));
            if (!live) {
              if (participant.herdr?.workspace_id !== placement.herdr.workspaceId)
                throw new Error(`Registry custody for ${participant.participant_id} is outside the driver workspace.`);
              const stale: Member = {
                runId: run.run_id, goalId: participant.goal_id,
                participantId: participant.participant_id,
                workerId: `${participant.participant_id}-worker`, role: participant.role,
                name: participant.participant_id, cwd: ctx.cwd,
                journal: journalPath(run.run_id, participant.participant_id),
                session: participant.agent_session,
                herdr: {
                  workspaceId: participant.herdr.workspace_id, tabId: participant.herdr.tab_id,
                  paneId: participant.herdr.pane_id, terminalId: participant.herdr.terminal_id,
                },
                startedAt: participant.observed_at, status: "closed-unrecorded", retained: false,
                registered: true, workerRegistered: true, lifecycleOnly: true,
              };
              cleanupJournal(stale);
              await recordTerminal(pi, stale, "interrupted", "exact-owned child was no longer live during recovery");
              continue;
            }
            if (!sameHerdr(participant.herdr, {
              workspaceId: live.workspace_id, tabId: live.tab_id,
              paneId: live.pane_id, terminalId: live.terminal_id,
            }) || live.workspace_id !== placement.herdr.workspaceId)
              throw new Error(`Live identity for ${participant.participant_id} contradicts Registry custody.`);
            members.set(participant.participant_id, {
              runId: run.run_id,
              goalId: participant.goal_id,
              participantId: participant.participant_id,
              workerId: `${participant.participant_id}-worker`,
              role: participant.role,
              name: live.name,
              cwd: live.cwd,
              journal: journalPath(run.run_id, participant.participant_id),
              session: participant.agent_session,
              herdr: {
                workspaceId: live.workspace_id, tabId: live.tab_id,
                paneId: live.pane_id, terminalId: live.terminal_id,
              },
              startedAt: participant.observed_at,
              status: live.agent_status ?? "unknown",
              retained: retained.has(participant.participant_id),
              registered: true,
              workerRegistered: true,
              lifecycleOnly: true,
            });
          }
          continue;
        }
        for (const observation of run.observations ?? []) {
          const participant = observation.payload?.registered_participant;
          if (observation.kind !== "registered_participant" || observation.state !== "active" ||
            !participant || !ROLES.includes(participant.role) || members.has(participant.participant_id)) continue;
          const terminal = run.observations?.some((item: any) =>
            item.kind === "registered_participant" && item.state !== "active" &&
            item.payload?.registered_participant?.participant_id === participant.participant_id);
          if (terminal) continue;
          const live = agents.find((item: any) => sameSession(item.agent_session, participant.agent_session));
          const worker = run.observations?.find((item: any) =>
            item.kind === "worker" && item.state === "active" &&
            item.payload?.worker?.owner_participant_id === participant.participant_id)?.payload?.worker;
          if (!live) {
            if (participant.herdr?.workspace_id !== placement.herdr.workspaceId)
              throw new Error(`Registry custody for ${participant.participant_id} is outside the driver workspace.`);
            const stale: Member = {
              runId: run.run_id, goalId: observation.goal_id,
              participantId: participant.participant_id,
              workerId: worker?.worker_id ?? `${participant.participant_id}-worker`, role: participant.role,
              name: participant.participant_id, cwd: ctx.cwd,
              journal: journalPath(run.run_id, participant.participant_id),
              session: participant.agent_session,
              herdr: {
                workspaceId: participant.herdr.workspace_id, tabId: participant.herdr.tab_id,
                paneId: participant.herdr.pane_id, terminalId: participant.herdr.terminal_id,
              },
              startedAt: observation.started_at, status: "closed-unrecorded", retained: false,
              registered: true, workerRegistered: Boolean(worker), lifecycleOnly: true,
            };
            cleanupJournal(stale);
            await recordTerminal(pi, stale, "interrupted", "exact-owned child was no longer live during recovery");
            continue;
          }
          if (!sameHerdr(participant.herdr, {
            workspaceId: live.workspace_id, tabId: live.tab_id,
            paneId: live.pane_id, terminalId: live.terminal_id,
          }) || live.workspace_id !== placement.herdr.workspaceId)
            throw new Error(`Live identity for ${participant.participant_id} contradicts Registry custody.`);
          members.set(participant.participant_id, {
            runId: run.run_id,
            goalId: observation.goal_id,
            participantId: participant.participant_id,
            workerId: worker?.worker_id ?? `${participant.participant_id}-worker`,
            role: participant.role,
            name: live.name,
            cwd: live.cwd,
            journal: journalPath(run.run_id, participant.participant_id),
            session: participant.agent_session,
            herdr: {
              workspaceId: live.workspace_id, tabId: live.tab_id,
              paneId: live.pane_id, terminalId: live.terminal_id,
            },
            startedAt: observation.started_at,
            status: live.agent_status ?? "unknown",
            retained: retained.has(participant.participant_id),
            registered: true,
            workerRegistered: Boolean(worker),
            lifecycleOnly: true,
          });
        }
      }
    for (const member of members.values())
      if (realpathSync(member.cwd) !== realpathSync(ctx.cwd))
        throw new Error(`Recovered Crew cwd for ${member.participantId} is outside the parent Run custody.`);
    renderWidget(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    recoveryHealthy = false;
    try {
      await reconnect(ctx);
      recoveryHealthy = true;
    } catch (error) {
      ctx.ui.notify(`Vault Hunter Crew recovery failed closed: ${safeLine(String(error))}`, "error");
    }
    timer = setInterval(() => void poll(), POLL_MS);
    timer.unref?.();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    recoveryHealthy = false;
    ctx.ui.setWidget(WIDGET_ID, undefined);
    currentCtx = undefined;
  });

  pi.registerTool({
    name: "vault_hunter_crew_launch",
    label: "Launch Vault Hunter Crew Persona",
    description: "Fail-closed two-phase launch of one registered Vault Hunter persona in a dedicated tab in the parent Herdr workspace. The Task prompt is withheld until exact Run, Pi session, and Herdr ownership are registered.",
    promptSnippet: "Launch a registered Vault Hunter verifier-builder, convergence-engineer, or delivery-steward.",
    promptGuidelines: [
      "Use vault_hunter_crew_launch for formal Vault Hunter persona work; never launch these writers through generic subagents.",
      "Close convergence-engineer through vault_hunter_crew_release before launching delivery-steward.",
    ],
    parameters: LaunchSchema,
    async execute(_id, params, signal, _update, ctx) {
      return await serializeCustody(async () => {
      if (!recoveryHealthy)
        throw new Error("Crew recovery is unhealthy; launch is disabled until exact Run/session custody reconnects.");
      const placement = await parentPlacement(pi, ctx, signal);
      const run = await getRun(pi, params.runId, signal);
      if (!driverOwnsRun(run, placement.session, placement.herdr.workspaceId))
        throw new Error(`The current parent does not exactly own Run ${params.runId} in this Herdr workspace.`);
      const activeRoles = ROLES.filter((role) => runHasActiveRole(run, role));
      if (active(params.runId).length || activeRoles.length)
        throw new Error(`Run ${params.runId} already has active or unreconciled crew custody: ${activeRoles.join(", ") || "live child"}.`);

      const participantId = `crew-${params.role}-${randomUUID()}`;
      const workerId = `${participantId}-worker`;
      const cwd = resolve(params.cwd ?? ctx.cwd);
      if (realpathSync(cwd) !== realpathSync(ctx.cwd))
        throw new Error("Crew cwd must be the parent driver's exact Run-owned working directory.");
      for (const extensionPath of [CHILD_EXTENSION, HERDR_STATE_EXTENSION]) {
        const extensionStat = lstatSync(extensionPath);
        if (!extensionStat.isFile() || extensionStat.isSymbolicLink())
          throw new Error(`Vault Hunter child extension is not a regular production file: ${extensionPath}`);
      }
      const journal = journalPath(params.runId, participantId);
      if ([journal, `${journal}.1`, `${journal}.2`].some(pathExists))
        throw new Error("Fresh Crew participant journal identity is already occupied.");
      const journalDirectory = dirname(journal);
      mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
      const journalDirectoryStat = lstatSync(journalDirectory);
      if (!journalDirectoryStat.isDirectory() || journalDirectoryStat.isSymbolicLink())
        throw new Error("Crew journal directory is not a private regular directory.");
      chmodSync(journalDirectory, 0o700);
      const tabLabel = `Vault Hunter · ${params.role} · ${safeLine(params.goalId)}`;
      let tabId: string | undefined;
      let provisional: Member | undefined;
      try {
        const created = await herdr(pi, [
          "tab", "create", "--workspace", placement.herdr.workspaceId,
          "--cwd", cwd, "--label", tabLabel, "--no-focus",
        ], signal);
        const tab = created.tab;
        const rootPane = created.root_pane;
        tabId = tab?.tab_id;
        if (created.type !== "tab_created" || !tabId || tab.workspace_id !== placement.herdr.workspaceId ||
          tab.pane_count !== 1 || !rootPane?.pane_id || rootPane.tab_id !== tabId)
          throw new Error("Herdr returned a malformed reserved tab.");

        const releaseToken = randomBytes(32).toString("hex");
        const name = `pi-vh-${slug(params.runId, 20)}-${slug(params.role, 24)}-${participantId.slice(-8)}`;
        const launched = await herdr(pi, [
          "agent", "start", name,
          "--cwd", cwd,
          "--workspace", placement.herdr.workspaceId,
          "--tab", tabId,
          "--no-focus",
          "--env", `SIDEKICK_NAMED_SESSION=${name.slice(3)}`,
          "--env", `VAULT_HUNTER_RUN_ID=${params.runId}`,
          "--env", `VAULT_HUNTER_GOAL_ID=${params.goalId}`,
          "--env", `VAULT_HUNTER_CREW_PARTICIPANT_ID=${participantId}`,
          "--env", `VAULT_HUNTER_CREW_ROLE=${params.role}`,
          "--env", `VAULT_HUNTER_CREW_JOURNAL=${journal}`,
          "--env", `VAULT_HUNTER_CREW_RELEASE_TOKEN=${releaseToken}`,
          "--", "pi", "--no-extensions", "--no-skills", "--no-prompt-templates",
          "-e", HERDR_STATE_EXTENSION, "-e", CHILD_EXTENSION, "--name", name.slice(3),
        ], signal);
        const launchedAgent = launched.agent ?? {};
        if (!launchedAgent.pane_id)
          throw new Error("Herdr did not start the reserved Pi child.");
        if (rootPane.pane_id !== launchedAgent.pane_id) {
          const rootClosed = await herdr(pi, ["pane", "close", rootPane.pane_id], signal);
          if (rootClosed.type !== "pane_closed" || rootClosed.pane_id !== rootPane.pane_id)
            throw new Error(`Herdr did not confirm temporary root pane closure for ${rootPane.pane_id}.`);
        }

        const base = {
          runId: params.runId,
          goalId: params.goalId,
          participantId,
          workerId,
          role: params.role,
          name: launchedAgent.name ?? name,
          cwd,
          journal,
          startedAt: "",
          tabId,
        };
        const ready = await waitForReady(pi, base, placement.herdr.workspaceId, launchedAgent.pane_id, signal);
        provisional = {
          ...base,
          startedAt: ready.startedAt,
          session: ready.session,
          herdr: ready.herdr,
          registered: false,
          workerRegistered: false,
          status: "reserved",
          retained: false,
        };
        await registerMember(pi, run, provisional, signal);
        members.set(participantId, provisional);
        await sendPrompt(
          pi,
          provisional,
          personaPrompt(params.role, params.prompt),
          `[vault-hunter-release:${releaseToken}]`,
          signal,
        );
        provisional.status = "working";
        renderWidget(ctx);
        return result(`Launched and registered ${params.role} ${participantId}.`, {
          runId: params.runId,
          goalId: params.goalId,
          participantId,
          role: params.role,
          herdr: provisional.herdr,
          agentSession: provisional.session,
          journal: { mode: "0600", maxBytes: 1 << 20, files: 3 },
        });
      } catch (error) {
        let cleanupError: unknown;
        if (tabId) {
          try {
            await assertSoloTab(pi, placement.herdr.workspaceId, tabId);
            const closed = await herdr(pi, ["tab", "close", tabId]);
            if (closed.type !== "tab_closed" || closed.tab_id !== tabId)
              throw new Error(`Herdr did not confirm exact reserved tab closure for ${tabId}.`);
            if (provisional) await waitForExactTermination(pi, provisional, signal);
            else await waitForTabTermination(pi, tabId, signal);
          } catch (closeError) { cleanupError = closeError; }
        }
        if (provisional && !cleanupError) {
          try {
            cleanupJournal(provisional);
            provisional.status = "closed-unrecorded";
            await recordTerminal(pi, provisional, "failed", `launch failed: ${safeLine(String(error))}`);
            provisional.status = "closed";
          } catch (recordError) {
            cleanupError = recordError;
            if (provisional.registered) members.set(provisional.participantId, provisional);
          }
        } else if (!provisional && !cleanupError) {
          for (const path of [journal, `${journal}.1`, `${journal}.2`]) rmSync(path, { force: true });
          if ([journal, `${journal}.1`, `${journal}.2`].some(existsSync))
            cleanupError = new Error(`Reserved journal cleanup could not be verified for ${participantId}.`);
        }
        if (cleanupError) {
          if (provisional?.registered) {
            if (provisional.status !== "closed-unrecorded") provisional.status = "cleanup-blocked";
            members.set(provisional.participantId, provisional);
          }
          throw new Error(`${safeLine(String(error))} Cleanup failed closed: ${safeLine(String(cleanupError))}`);
        }
        throw error;
      }
      });
    },
  });

  pi.registerTool({
    name: "vault_hunter_crew_send",
    label: "Steer Vault Hunter Crew Persona",
    description: "Send one bounded follow-up to an exact Run-owned crew persona. The companion records only a sanitized first line and SHA-256, never the raw prompt or reasoning.",
    parameters: SendSchema,
    async execute(_id, params, signal) {
      return await serializeCustody(async () => {
      const member = members.get(params.participantId);
      if (!member || member.runId !== params.runId || member.status.startsWith("closed"))
        throw new Error("No active exact Run-owned crew participant matches this request.");
      member.graceDeadline = undefined;
      await assertMemberOwnership(pi, member, signal);
      await sendPrompt(pi, member, params.prompt, "", signal);
      return result(`Steered ${member.role} ${member.participantId}.`, {
        runId: member.runId,
        participantId: member.participantId,
        summary: safeLine(params.prompt),
        sha256: hash(params.prompt),
      });
      });
    },
  });

  pi.registerTool({
    name: "vault_hunter_crew_release",
    label: "Release Vault Hunter Crew Persona",
    description: "Retain a verifier-builder during its 30-second grace, close a persona after a validated structured handoff, or abort exact Run-owned custody without implying success. Convergence and delivery never auto-close.",
    parameters: ReleaseSchema,
    async execute(_id, params) {
      return await serializeCustody(async () => {
      const member = members.get(params.participantId);
      if (!member || member.runId !== params.runId || member.status === "closed")
        throw new Error("No active exact Run-owned crew participant matches this request.");
      const journal = readJournal(member.journal, member);
      if (!journal.lifecycleOnly) {
        const handoff = currentHandoff(journal.events);
        member.handoffValid = handoff?.valid === true;
      }
      if (params.disposition === "retain") {
        if (member.role !== "verifier-builder" || !member.handoffValid)
          throw new Error("Only a verifier-builder with a validated durable handoff can be retained during grace.");
        member.retained = true;
        member.graceDeadline = undefined;
        if (currentCtx) renderWidget(currentCtx);
        return result(`Retained ${member.participantId}; explicit close is now required.`, {
          runId: member.runId,
          participantId: member.participantId,
          retained: true,
        });
      }
      if (params.disposition === "close" && !member.handoffValid)
        throw new Error("A validated structured handoff is required before normal persona closure; use abort for incomplete custody.");
      const state: TerminalState = params.disposition === "abort" ? "interrupted" : "succeeded";
      await closeMember(member, state, params.result ?? (state === "succeeded" ? "validated handoff released" : "explicit custody abort"));
      return result(`Closed exact Run-owned crew participant ${member.participantId}.`, {
        runId: member.runId,
        participantId: member.participantId,
        journalCleanupVerified: true,
        terminalState: state,
      });
      });
    },
  });

  pi.registerTool({
    name: "vault_hunter_crew_inspect",
    label: "Inspect Vault Hunter Crew",
    description: "Inspect safe bounded crew telemetry for one Run. Missing or corrupt journals degrade to lifecycle-only facts and never imply Task or verifier success.",
    parameters: InspectSchema,
    async execute(_id, params) {
      const selected = active(params.runId).filter((member) =>
        !params.participantId || member.participantId === params.participantId);
      const inspections = await Promise.all(selected.map(async (member) => {
        const journal = readJournal(member.journal, member);
        let liveState = "unavailable";
        try {
          const live = await herdr(pi, ["agent", "get", member.name]);
          const agent = live.agent ?? live;
          liveState = sameSession(agent.agent_session, member.session) ? agent.agent_status ?? "unknown" : "ownership-mismatch";
        } catch { /* lifecycle unavailable */ }
        const safeEvents = journal.lifecycleOnly
          ? []
          : journal.events.slice(-200).map((event) => {
              const { v, runId, goalId, participantId, role, proof, ...bounded } = event;
              return bounded;
            });
        return {
          participantId: member.participantId,
          role: member.role,
          liveState,
          herdr: member.herdr,
          agentSession: member.session,
          lifecycleOnly: journal.lifecycleOnly,
          problem: journal.problem,
          events: safeEvents,
          successInferred: false,
        };
      }));
      return result(
        inspections.length
          ? `Inspected ${inspections.length} Run-owned crew participant(s); no success was inferred.`
          : `No active crew participants found for Run ${params.runId}.`,
        { runId: params.runId, participants: inspections },
      );
    },
  });
}

export type VaultHunterCrewLaunchInput = Static<typeof LaunchSchema>;
export type VaultHunterCrewSendInput = Static<typeof SendSchema>;
export type VaultHunterCrewReleaseInput = Static<typeof ReleaseSchema>;
export type VaultHunterCrewInspectInput = Static<typeof InspectSchema>;
