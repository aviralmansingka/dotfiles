import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MAX_JOURNAL_BYTES = 1 << 20;
const ROLES = new Set([
  "verifier-builder",
  "convergence-engineer",
  "delivery-steward",
]);
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

type Config = {
  runId: string;
  goalId: string;
  participantId: string;
  role: string;
  journal: string;
  releaseToken: string;
};

function stateRoot(): string {
  return process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "vault-hunter", "crew")
    : join(homedir(), ".local", "state", "vault-hunter", "crew");
}

function config(): Config | undefined {
  const value = {
    runId: process.env.VAULT_HUNTER_RUN_ID,
    goalId: process.env.VAULT_HUNTER_GOAL_ID,
    participantId: process.env.VAULT_HUNTER_CREW_PARTICIPANT_ID,
    role: process.env.VAULT_HUNTER_CREW_ROLE,
    journal: process.env.VAULT_HUNTER_CREW_JOURNAL,
    releaseToken: process.env.VAULT_HUNTER_CREW_RELEASE_TOKEN,
  };
  if (Object.values(value).every((item) => item === undefined)) return undefined;
  if (
    !value.runId ||
    !value.goalId ||
    !value.participantId ||
    !value.role ||
    !value.journal ||
    !value.releaseToken ||
    !SAFE_ID.test(value.runId) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.goalId) ||
    !SAFE_ID.test(value.participantId) ||
    !ROLES.has(value.role) ||
    !/^[a-f0-9]{64}$/.test(value.releaseToken)
  ) return undefined;
  const expected = join(stateRoot(), value.runId, `${value.participantId}.jsonl`);
  if (resolve(value.journal) !== resolve(expected)) return undefined;
  return value as Config;
}

function hash(value: unknown): string {
  const input = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return createHash("sha256").update(input).digest("hex");
}

function summary(value: string): string {
  return (
    value
      .split(/\r?\n/, 1)[0]
      ?.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "(empty)"
  );
}

function assistantText(message: any): string {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((item: any) => item?.type === "text" && typeof item.text === "string")
    .map((item: any) => item.text)
    .join("\n");
}

function toolSummary(name: string, args: unknown): string {
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  if (name === "bash") return "bash command";
  return typeof input.path === "string"
    ? `${summary(name)} ${summary(input.path).split("/").at(-1)}`
    : summary(name);
}

function numericUsage(message: any): Record<string, number> | undefined {
  const usage = message?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const output: Record<string, number> = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      output[key] = value;
  }
  const cost = usage.cost?.total;
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0)
    output.cost = cost;
  return Object.keys(output).length ? output : undefined;
}

function regularFileOrAbsent(path: string): number {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`unsafe journal path: ${path}`);
    return stat.size;
  } catch (error: any) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

function existingEvents(path: string): any[] {
  const events: any[] = [];
  for (const candidate of [`${path}.2`, `${path}.1`, path]) {
    if (regularFileOrAbsent(candidate) === 0) continue;
    for (const line of readFileSync(candidate, "utf8").split("\n"))
      if (line) events.push(JSON.parse(line));
  }
  return events;
}

function handoffFields(role: string, text: string): { fields: string[]; valid: boolean } {
  const required: Record<string, string[]> = {
    "verifier-builder": ["outcome", "verifier manifest", "baseline", "evidence", "risks", "blockers"],
    "convergence-engineer": ["outcome", "base", "head", "tree", "changed paths", "verifier results", "artifacts", "risks", "blockers"],
    "delivery-steward": ["outcome", "candidate tree", "review", "certification", "pr/ci", "risks", "blockers"],
  };
  const fields = required[role] ?? [];
  const present = fields.filter((field) => new RegExp(`^\\s*(?:[-*]\\s*)?${field.replace("/", "\\/")}\\s*:\\s*\\S.*$`, "im").test(text));
  return { fields: present, valid: present.length === fields.length };
}

function createWriter(cfg: Config) {
  let sequence = existingEvents(cfg.journal).reduce(
    (maximum, event) => Number.isInteger(event?.seq) ? Math.max(maximum, event.seq) : maximum,
    0,
  );
  const directory = dirname(cfg.journal);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    throw new Error(`unsafe journal directory: ${directory}`);
  chmodSync(directory, 0o700);

  return (type: string, data: Record<string, unknown> = {}) => {
    const event = {
      v: 1,
      seq: ++sequence,
      at: new Date().toISOString(),
      runId: cfg.runId,
      goalId: cfg.goalId,
      participantId: cfg.participantId,
      role: cfg.role,
      type,
      ...data,
    };
    const line = `${JSON.stringify(event)}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > MAX_JOURNAL_BYTES) throw new Error("telemetry event exceeds journal bound");
    const size = regularFileOrAbsent(cfg.journal);
    regularFileOrAbsent(`${cfg.journal}.1`);
    regularFileOrAbsent(`${cfg.journal}.2`);
    if (size + lineBytes > MAX_JOURNAL_BYTES) {
      rmSync(`${cfg.journal}.2`, { force: true });
      if (regularFileOrAbsent(`${cfg.journal}.1`) > 0)
        renameSync(`${cfg.journal}.1`, `${cfg.journal}.2`);
      if (regularFileOrAbsent(cfg.journal) > 0)
        renameSync(cfg.journal, `${cfg.journal}.1`);
    }
    const fd = openSync(
      cfg.journal,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    chmodSync(cfg.journal, 0o600);
  };
}

export default function (pi: ExtensionAPI) {
  const cfg = config();
  if (!cfg) return;
  const priorEvents = existingEvents(cfg.journal);
  const record = createWriter(cfg);
  const marker = `[vault-hunter-release:${cfg.releaseToken}]`;
  const releaseProof = hash(`released:${cfg.releaseToken}`);
  let released = priorEvents.some((event) => event?.type === "released" && event?.proof === releaseProof);
  const reservedTools = pi.getActiveTools();
  if (!released) pi.setActiveTools([]);
  let lastAssistant = "";
  let lastProgressAt = 0;

  pi.on("session_start", (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    record("ready", {
      session: {
        source: sessionFile ? "herdr:pi" : "pi",
        kind: sessionFile ? "path" : "session-id",
        value: sessionFile ?? ctx.sessionManager.getSessionId(),
      },
      herdr: {
        workspaceId: process.env.HERDR_WORKSPACE_ID,
        tabId: process.env.HERDR_TAB_ID,
        paneId: process.env.HERDR_PANE_ID,
      },
    });
    record("lifecycle", { state: "idle" });
  });

  pi.on("session_before_switch", () => ({ cancel: true }));
  pi.on("session_before_fork", () => ({ cancel: true }));

  pi.on("input", (event, ctx) => {
    if (!released) {
      if (!event.text.startsWith(marker)) {
        ctx.ui.notify("Vault Hunter child is reserved until Run registration completes.", "warning");
        return { action: "handled" as const };
      }
      const prompt = event.text.slice(marker.length).replace(/^\s*\n?/, "");
      released = true;
      record("released", { summary: summary(prompt), sha256: hash(prompt), proof: releaseProof });
      pi.setActiveTools(reservedTools);
      return { action: "transform" as const, text: prompt };
    }
    if (event.source !== "extension")
      record("steering", { summary: summary(event.text), sha256: hash(event.text) });
    return { action: "continue" as const };
  });

  pi.on("user_bash", () => {
    if (released) return;
    return {
      result: {
        output: "Vault Hunter child is reserved until Run registration completes.",
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });

  pi.on("agent_start", () => {
    lastAssistant = "";
    record("lifecycle", { state: "working" });
  });
  pi.on("tool_execution_start", (event) =>
    record("tool", {
      phase: "start",
      name: summary(event.toolName),
      summary: toolSummary(event.toolName, event.args),
      sha256: hash(event.args),
    }),
  );
  pi.on("tool_execution_end", (event) =>
    record("tool", {
      phase: "end",
      name: summary(event.toolName),
      failed: event.isError === true,
    }),
  );
  pi.on("message_update", (event) => {
    const now = Date.now();
    if (now - lastProgressAt < 2_000) return;
    lastProgressAt = now;
    const content = Array.isArray((event.message as any)?.content)
      ? (event.message as any).content
      : [];
    record("progress", {
      textChars: content
        .filter((item: any) => item?.type === "text")
        .reduce((total: number, item: any) => total + String(item.text ?? "").length, 0),
      thinkingChars: content
        .filter((item: any) => item?.type === "thinking")
        .reduce((total: number, item: any) => total + String(item.thinking ?? "").length, 0),
    });
  });
  pi.on("message_end", (event) => {
    const text = assistantText(event.message);
    if (text) lastAssistant = text;
  });
  pi.on("turn_end", (event) => {
    const usage = numericUsage((event as any).message);
    if (usage) record("usage", { usage });
  });
  pi.on("agent_settled", () => {
    record("lifecycle", { state: "idle" });
    if (/^\s*(?:#{1,6}\s*)?HANDOFF:/i.test(lastAssistant)) {
      const structure = handoffFields(cfg.role, lastAssistant);
      record("handoff", {
        summary: summary(lastAssistant),
        sha256: hash(lastAssistant),
        fields: structure.fields,
        valid: structure.valid,
      });
    }
  });
  pi.on("session_shutdown", (event) =>
    record("lifecycle", { state: "shutdown", reason: summary(event.reason) }),
  );
}
