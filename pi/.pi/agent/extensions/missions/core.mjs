import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, realpathSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);
const hash = text => createHash("sha256").update(text).digest("hex");
export const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
const active = a => a && ["running", "reported"].includes(a.status);

/** The agent name that an `agent_name_taken` failure names, or null. */
export function takenAgentName(message) {
  const text = String(message ?? "");
  if (!text.includes("agent_name_taken")) return null;
  return /agent name ([\w-]+) is already used/.exec(text)?.[1] ?? null;
}

/** The Herdr agent name of one mission launch. Herdr keeps names unique per
 *  server and accepts 32 characters of [a-z0-9_-] that start with a letter. The
 *  name comes from the mission handle, so a launch reads back as the mission it
 *  serves. `tag` appends a short hash when the plain name is taken. */
export function workerAgentName(handle, tag = "") {
  const tail = slug(String(handle || "").split("/").pop() || "mission").slice(0, 24) || "mission";
  const mark = String(tag || "").replace(/[^a-z0-9]+/gi, "").toLowerCase().slice(0, 6);
  return `mission-${tail}${mark ? "-" + mark : ""}`.slice(0, 32).replace(/-+$/, "");
}

/** The identity a launched seat records. A launch sends the captain brief and
 *  runs the captain allowlist, so the seat it starts is a captain; a session
 *  that attaches on its own, with no launch intent to answer, is a trooper. */
export const CAPTAIN_AGENT = "mission-captain";
export const WORKER_AGENT = "mission-worker";

/** The agent arguments of a plan's captain argv: everything after the
 *  executable. `herdr agent start <name> --kind pi --pane <id> [-- AGENT_ARG...]`
 *  starts the binary itself and passes this tail to it, and `pi` has no profile
 *  flag, so the argv tail is the only place a plan's tool allowlist can reach a
 *  launched seat. A plan with no argv passes nothing and the seat keeps the
 *  defaults it would have had. */
export function seatArgs(argv) {
  return (Array.isArray(argv) ? argv : []).map(arg => String(arg ?? "")).filter(Boolean).slice(1);
}

/** Whether a `mission plan` answer carries anything a launch can use: the
 *  captain contract, the seat's argv tail, or the subagent session. A failed
 *  call, an empty object, and a CLI that predates `plan` all answer nothing
 *  usable, so one degradation rule covers all three. */
export function usablePlan(plan) {
  if (!plan || typeof plan !== "object") return false;
  if (typeof plan.captain_brief === "string" && plan.captain_brief !== "") return true;
  if (Array.isArray(plan.captain_argv) && plan.captain_argv.length > 0) return true;
  return typeof plan.subagent_session === "string" && plan.subagent_session !== "";
}

/** How long a launch waits for its new agent to reach the prompt. */
export const AGENT_READY_TIMEOUT_MS = 60000;

/** A tab Herdr just created may still be starting its shell. The launch retries
 *  the `agent_pane_busy` refusal this long before it gives up. */
export const AGENT_PANE_READY_RETRIES = 20;
export const AGENT_PANE_READY_DELAY_MS = 250;

/** The code and message of a failed Herdr call, or the raw text. */
export function herdrError(message) {
  const text = String(message ?? "");
  try {
    const error = JSON.parse(text.slice(text.indexOf("{"))).error;
    if (error?.code) return `${error.code}: ${error.message}`;
  } catch { /* the call failed without a Herdr envelope */ }
  return text;
}

/** One message a human can act on: the name, the pane that holds it, and the
 *  next step. */
export function agentCollisionReport(name, holder, action) {
  const pane = holder?.pane_id || "an unknown pane";
  const status = holder?.agent_status || "unknown";
  const cwd = holder?.foreground_cwd || holder?.cwd || "unknown";
  return `Herdr agent name "${name}" is held by pane ${pane} (status ${status}, cwd ${cwd}). ${action}`;
}
/** The launcher configuration a driver pane must inherit: where Pi finds the
 *  extension, which vault and CLI it serves, and its private state directory.
 *  A checkout that is not installed (a preview or a mission worktree) sends its
 *  own agent dir this way. The attempt token never travels this way. */
export function driverEnv(env = process.env) {
  return ["PI_CODING_AGENT_DIR", "MISSION_VAULT", "MISSION_BIN", "MISSION_STATE_DIR"]
    .filter(key => typeof env[key] === "string" && env[key] !== "" && !env[key].includes("\0"))
    .map(key => [key, env[key]]);
}

/** The launch prompt of a mission driver. The launched agent holds the claim on
 *  one work request and steers it; it performs no step work itself. One work
 *  subagent executes each step, one judge subagent decides it, and the driver
 *  stays the single place the human visits for status and admin prompts. */
export function driverTask(handle, launchID) {
  return [
    `You are the driver for mission ${handle}, not its worker. You hold the claim on this work request.`,
    `Attach first: call mission with action=attach, handle=${handle}, launch_id=${launchID}. Its returned step brief and the missions skill describe the work, but you send that work out.`,
    "Duty 1 — hold the claim: this session owns the attempt and keeps the mission tool. Report structured progress, and call mission action=verify and mission action=finish only after a judge records a pass.",
    "Duty 2 — subagents do all step work: you never edit repository code and you never write a step artifact. For each step, spawn one work subagent (agent=worker) with the step brief, its artifact path, and the acceptance criteria, then wait for its result.",
    "Duty 3 — subagents judge: after the work subagent reports, call mission action=judge and spawn one judge subagent (agent=worker, name=judge-<step>) with the returned task verbatim. Never judge your own work and never reuse the work subagent's session. The judge reads the artifact, runs the CLI checks itself through mission verify, and records its verdict with reasons as progress.",
    "Touchpoint — you answer the human's status and admin prompts in this session. Status: call mission action=status and report what is running, what passed, and what is next, plus any review or blocker, in plain words. Admin: run the change through an existing command — mission action=edit (with the revision you reported), mission action=retry, mission action=fail, or a checkpoint decision the human explicitly gives — then confirm the result. A stale edit is refused, never forced. Stop at human checkpoints and never approve one yourself.",
    "Keep the mission worktree as this session's cwd and keep the mission tool available for later steps. Do not launch another mission owner.",
  ].join("\n");
}

/** One judge subagent's task. The judge works on the artifact, not on code: it
 *  reads the result, runs the CLI check run itself, and records the verdict with
 *  reasons in the attempt's existing progress fields. The attempt token reaches
 *  the judge only as the private capability file path `capability`, never as a
 *  credential in this prompt. */
export function judgeTask({ handle, attempt, step, artifact, evidence, acceptance, checks, capability, vault, binary = "mission", cwd }) {
  const cli = `"${binary}" --json --vault "${vault}"`;
  const token = `--token "$(cat '${capability}')"`;
  return [
    `You are the judge for step ${step} of mission ${handle}. You are independent of the work subagent that produced the artifact. You edit no file and you write no step artifact.`,
    "",
    `Artifact: ${artifact}`,
    `Acceptance criteria: ${acceptance}`,
    `Check list: ${checks.join(", ")}`,
    "",
    "1. Read the artifact in full. Judge it against the acceptance criteria, not against the subagent's summary.",
    "2. Run the CLI checks yourself:",
    `   ${cli} verify ${handle} --attempt ${attempt} ${token}`,
    "3. Read the verification it returns: every check verdict, its summary, and the evidence paths under the attempt's artifacts directory.",
    "4. Record your verdict with reasons as the attempt's progress, citing the artifact and the check logs you read:",
    `   ${cli} progress ${handle} --attempt ${attempt} ${token} --event-id judge-${attempt} --status ready --summary "verdict: pass — <reasons>" --evidence ${evidence}`,
    "   A failed verdict records --status blocked --blocker \"<what must change>\" instead of --status ready. A passing verdict must still name what you checked.",
    "5. Return the same verdict as your final message: the decision, the reasons, and the check evidence you relied on. Report no progress on the step's behalf otherwise, do not call finish, and change no repository file.",
    "",
    `Work in ${cwd}.`,
  ].join("\n");
}

/** Every Herdr workspace that belongs to this repository lineage: the primary
 * checkout's workspace plus one linked-worktree workspace per worktree Herdr
 * has open (missions register their own mission/<slug> checkout). */
export function repositoryWorkspaces(workspaces, common) {
  return (workspaces || []).filter(w => w.worktree?.repo_key === common);
}
export function pendingCount(symbol) {
  const fn = globalThis[Symbol.for(symbol)];
  if (typeof fn !== "function") return 0;
  try { const n = fn(); return Number.isFinite(n) && n >= 0 ? n : Infinity; } catch { return Infinity; }
}
export function quiescent(event, ctx) {
  return event.aborted === false && event.outcome === "completed" && ctx.isIdle() && !ctx.hasPendingMessages() &&
    pendingCount("pi-subagents/running-children-count") === 0 && pendingCount("pi-subagents/keep-open-count") === 0;
}

/** Tools that only inspect: they never change the worktree or the vault, so the
 *  mission gate always passes them. `mission` stays available in every state so
 *  a held session can inspect its record, report progress, or pick up a step;
 *  `run-command` only prints a repair command, so a worker that owns no active
 *  step can still hand the human the exact command to run; `mermaid` writes no
 *  repository file and holds no authority either. */
export const INSPECTION_TOOLS = new Set(["read", "grep", "find", "ls", "tool_search", "mission", "run-command", "mermaid"]);

/** Tools that cannot change the repository: the inspection tools plus bash,
 *  which a worker needs to read its own ledger. A tracking record that fails
 *  must not stop a worker from investigating that failure. */
export const TRACKING_SAFE_TOOLS = new Set([...INSPECTION_TOOLS, "bash"]);

/** The block reason for a tool call whose tracking record failed, or undefined
 *  when the call may run with a warning. Repository edits stay blocked until
 *  tracking recovers. */
export function trackingFailureBlock(toolName, error) {
  if (TRACKING_SAFE_TOOLS.has(toolName)) return undefined;
  return "Mission tracking must recover before work continues: " + error;
}

/** Mission statuses that hold no agent write authority: "waiting" and "review"
 *  wait on a human checkpoint decision, while "done", "failed", and "closed"
 *  already ended the mission. Status alone decides, never the active attempt — a
 *  closed mission has no attempt left, and blocking its tools would leave the
 *  session unable to report, clean up, or answer the human. The gate reads work
 *  authority only; the CLI keeps the vault record, because a closed handle takes
 *  no new attempt or progress and answers code "closed". */
export const CLOSED_MISSION_STATUSES = new Set(["waiting", "review", "done", "failed", "closed"]);

/** Step statuses the CLI still advances to (nextStep in go/mission). */
const CONTINUABLE_STEP_STATUSES = new Set(["pending", "needs_changes"]);

/** The plain-language status a driver speaks to the human. It reads only the
 *  ledger's existing fields, so the answer cannot drift from `mission show`:
 *  what is running, what passed, what is next, and the review or blocker that
 *  needs the human. */
export function driverStatus(record) {
  const state = record?.state;
  if (!state) return ["No mission record to report."];
  const steps = record.mission?.steps || [];
  const title = id => steps.find(s => s.id === id)?.title || id;
  const status = id => state.steps?.[id]?.status || "pending";
  const lines = [`Mission ${record.handle} is ${state.status}.`];
  const attempts = state.attempts || [];
  const running = attempts.find(a => a.id === state.active_attempt);
  const report = running?.progress?.at(-1);
  if (running) {
    lines.push(`Running step ${running.step} (${title(running.step)}) under attempt ${running.id}${report ? `; last report: ${report.summary}` : ""}.`);
  } else if (state.current_step && status(state.current_step) !== "passed") {
    lines.push(`Current step ${state.current_step} (${title(state.current_step)}) is ${status(state.current_step)}.`);
  }
  const passed = steps.filter(s => status(s.id) === "passed").map(s => `${s.id} (${s.title})`);
  lines.push(passed.length ? `Passed: ${passed.join(", ")}.` : "Nothing has passed yet.");
  if (state.pending_checkpoint) {
    const def = (record.mission?.checkpoints || []).find(c => c.id === state.pending_checkpoint);
    lines.push(`Review ${state.pending_checkpoint} waits${def?.after ? ` after ${def.after}` : ""}: ${def?.question || "decide the checkpoint"}`);
  }
  const next = steps.find(s => CONTINUABLE_STEP_STATUSES.has(status(s.id)));
  lines.push(next ? `Next: ${next.id} (${next.title}).` : "Next: no step is left to run.");
  const stalled = [...attempts].reverse().map(a => a.progress?.at(-1)).find(p => p?.blocker);
  if (stalled) lines.push(`Blocker: ${stalled.blocker}`);
  return lines;
}

/** The pending review of a record: the derived field when the CLI emits it,
 *  else the stored pending checkpoint. Null when no review waits. */
export function pendingReviewOf(record) {
  if (!record) return null;
  if (record.pending_review) return record.pending_review;
  const state = record.state;
  const id = state?.pending_checkpoint;
  if (!id) return null;
  const cs = state.checkpoints?.[id];
  if (!cs || cs.status !== "pending") return null;
  const def = (record.mission?.checkpoints || []).find(c => c.id === id);
  return { id, question: def?.question || "", evidence: cs.evidence || "" };
}

/** Gate one tool call by mission status. Returns a block reason, or undefined
 *  when the call may proceed. A pending review blocks only mission finish:
 *  a worker keeps every tool so it can investigate and fix its own result.
 *  Inspection tools always pass. A closed mission passes every tool. An open
 *  mission authorizes changes only while one of its attempts is active;
 *  "ready" means the session must pick up a step first. */
export function missionToolBlock({ toolName, action, current = null, tracked = true, expectedAttachment = false }) {
  const record = current?.record;
  const review = pendingReviewOf(record);
  if (review && toolName === "mission" && action === "finish") {
    const next = record?.next_command || `mission checkpoint accept ${record?.handle} ${review.id} --note "Reviewed the evidence"`;
    return `Review ${review.id} is waiting. Decide with: ${next}`;
  }
  if (INSPECTION_TOOLS.has(toolName)) return undefined;
  if (!tracked) return expectedAttachment ? "Restore the mission credential cache before changing repository files." : undefined;
  const status = record?.state?.status;
  if (CLOSED_MISSION_STATUSES.has(status)) return undefined;
  if (current?.attempt) return undefined;
  return "No active mission step. Inspect the review or explicitly pick up next.";
}

/** True only when a settled mission can start another step. Terminal
 *  ("done"/"failed") and human-facing ("waiting"/"review") statuses never
 *  continue, so the extension does not inject action=next after the end. */
export function missionContinues(state) {
  if (state?.status !== "ready" || state.pending_checkpoint) return false;
  return Object.values(state.steps ?? {}).some(step => CONTINUABLE_STEP_STATUSES.has(step.status));
}

/** The mission status a finished subagent reached, in the progress vocabulary.
 *  Only a clean completion is "ready": a stall parks for a human decision
 *  ("needs-input"), and every death — provider error, kill, timeout, a launch
 *  that never ran, an agent that vanished — is "blocked". */
export function trooperStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (["done", "completed", "succeeded", "sentinel", "agent-gone"].includes(value)) return "ready";
  if (value === "stalled") return "needs-input";
  return "blocked";
}

/** The name a trooper report carries: `details.name`, the finished subagent's
 *  own name, so a judge step records the judge and never the mission worker
 *  that spawned it. That is the only name a `subagent_result` message carries;
 *  an unnamed completion reports nothing rather than borrowing another
 *  vocabulary (an agent profile is not the subagent's name). */
export function trooperName(completion) {
  const name = completion?.details?.name;
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, 64) : "";
}

/** The paragraphs a `subagent_result` presentation wraps around the trooper's
 *  own words: the headline, the narration, and the follow-up hint. Shapes come
 *  from resolveResultPresentation in
 *  pi/.pi/agent/extensions/interactive-subagents/pi-extension/subagents/index.ts
 *  (spawn, resume, and orphan finalize, including the `Recovered at parent
 *  restart` prefix). None of them is a report: the trooper wrote its own line. */
const PRESENTATION_NOISE = [
  /^Sub-agent ".*" (completed|failed|timed out|never started|stalled|pane was closed)/,
  /^Adopted sub-agent ".*" error:/,
  /^Recovered at parent restart/,
  /^Do not wait further:/,
  /^Nothing ran, so there is nothing to resume/,
  /^Do not treat this as an error/,
  /^It is still alive and still owns its tab/,
  /^Ask the user what to do next:/,
  /^The subagent did not produce a result\./,
  /^Follow up with subagent_message/,
];
/** Labels a death path puts in front of a harvested line, or beside it. */
const PRESENTATION_LABELS = [/Partial results attached:$/, /Last harvest:$/];

/** The one line a trooper wrote: the first paragraph of its completion that is
 *  not presentation, flattened and clipped so a sitrep row shows it whole. An
 *  empty line means the trooper wrote nothing the presentation kept. */
export function trooperLine(content, limit = 160) {
  const text = Array.isArray(content)
    ? content.map(part => (typeof part === "string" ? part : part?.text ?? "")).join("\n\n")
    : String(content ?? "");
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\s*\n/)
    .map(part => PRESENTATION_LABELS.reduce((line, label) => line.replace(label, ""), part.replace(/\s+/g, " ").trim()).trim())
    .filter(Boolean);
  const body = paragraphs.find(part => !PRESENTATION_NOISE.some(noise => noise.test(part))) ?? "";
  return body.length > limit ? body.slice(0, limit - 1).trimEnd() + "…" : body;
}

/** The report one finished subagent leaves on the attempt: who reported, the
 *  state it reached, the one line it wrote, and what comes next. The ID names
 *  one completion of one subagent session, so a reload that replays the same
 *  steer reuses it instead of appending a second copy, while a resumed run that
 *  ends differently reports under a new ID — the CLI keeps the final state as
 *  the trooper's row instead of refusing the second report. */
export function trooperReport(message) {
  if (message?.customType !== "subagent_result") return null;
  const details = message.details ?? {};
  const trooper = trooperName(message);
  if (!trooper) return null;
  const status = trooperStatus(details.status);
  const summary = trooperLine(message.content) || `${trooper} finished`;
  const follow = `subagent_message({ name: "${trooper}" })`;
  const next = status === "ready" ? "Read the result in this session"
    : status === "needs-input" ? `Steer it with ${follow}` : `Resume or replace it with ${follow}`;
  const session = String(details.sessionFile || details.sessionId || trooper);
  const report = { id: "trooper-" + hash([session, status, summary].join("\u0000")).slice(0, 24), trooper, status, summary, next };
  if (status !== "ready") report.blocker = trooperLine(details.errorMessage ?? details.error ?? "", 160) || summary;
  return report;
}

/** CLI refusals that make a queued trooper report permanently undeliverable: the
 *  record already holds a different aspect of that ID, the attempt the trooper
 *  finished under is gone or no longer active, or its handle vanished. Matched
 *  on the CLI's own error codes (see the `Problem("code"` calls under
 *  go/mission), never on a substring: a transient failure — the CLI is busy or
 *  gone — is not on this list, so that report retries. */
export const DROPPABLE_REPORT_CODES = new Set(["event_conflict", "stale_attempt", "attempt_terminal", "closed", "not_found", "invalid_handle"]);
export function droppableReportError(message) {
  return DROPPABLE_REPORT_CODES.has(/^([a-z_]+): /.exec(String(message ?? ""))?.[1] ?? "");
}

/** Credentials and an unacknowledged hook outbox are local transport state.
 * Canonical mission facts, transcripts, and attempts live only in the CLI vault.
 * No credentials are put in a prompt, tool result, or a child's environment.
 */
export class MissionBridge {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.vault = resolve((this.env.MISSION_VAULT || join(homedir(), "vault")).replace(/^~(?=\/|$)/, homedir()));
    if (existsSync(this.vault)) this.vault = realpathSync(this.vault);
    this.binary = this.env.MISSION_BIN || "mission";
    this.cacheDir = this.env.MISSION_STATE_DIR || join(this.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "pi-missions");
    this.run = options.run || (async (bin, args, options = {}) => {
      const r = await exec(bin, args, { encoding: "utf8", timeout: 180000, maxBuffer: 32 << 20, ...options });
      return r.stdout;
    });
    this.hint = null;
    this.error = null;
    this.surfaceSession = null;
    this.expectedAttachment = false;
  }
  key(ctx) { return join(this.cacheDir, hash(this.vault + "\0" + ctx.sessionManager.getSessionId()) + ".json"); }
  save(ctx) {
    mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    const file = this.key(ctx), temp = file + "." + randomUUID();
    writeFileSync(temp, JSON.stringify(this.hint), { mode: 0o600 }); renameSync(temp, file);
  }
  /** One judge subagent's one-shot capability: the directory holds this attempt's
   *  token in a 0600 file, so the judge can run the CLI checks and record its
   *  verdict while the credential never enters a prompt, a tool result, or a
   *  child's environment. The driver hands over the path only. */
  judgeDir(ctx) { return join(this.cacheDir, "judges", hash(this.vault + "\0" + ctx.sessionManager.getSessionId())); }
  judgeCapability(ctx, attempt) {
    const dir = this.judgeDir(ctx);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, attempt + ".token");
    writeFileSync(file, this.hint.token, { mode: 0o600 });
    return file;
  }
  /** Drop the judge capabilities of one attempt, or every stale one at a session
   *  start. A leftover file only outlives a crash; the next session clears it. */
  releaseJudgeCapabilities(ctx, attempt) {
    const dir = this.judgeDir(ctx);
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (attempt && name !== attempt + ".token") continue;
      try { rmSync(join(dir, name), { force: true }); } catch { /* the next session start retries */ }
    }
  }
  /** One file, one write, one rename: a reader never sees a half-written
   *  request, and the desk and this extension can both read at any moment. */
  writeJSON(file, value) {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    const temp = file + "." + randomUUID();
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, file);
  }
  async call(args, token) {
    const env = { ...this.env };
    for (const key of Object.keys(env)) if (key.startsWith("MISSION_")) delete env[key];
    if (token) env.MISSION_TOKEN = token;
    let stdout;
    try { stdout = await this.run(this.binary, ["--json", "--vault", this.vault, ...args], { env }); }
    catch (e) { stdout = e.stdout; if (!stdout) throw new Error("Mission CLI unavailable: " + e.message); }
    let r;
    try { r = JSON.parse(stdout); } catch { throw new Error("Mission CLI returned invalid JSON"); }
    if (!r.ok) throw new Error(`${r.error?.code}: ${r.error?.message}`);
    // The CLI may just have created a vault under a symlinked parent (/tmp on
    // macOS). Use its canonical location before persisting session credentials.
    if (existsSync(this.vault)) this.vault = realpathSync(this.vault);
    return r.data;
  }
  async herdr(args) {
    if (this.env.HERDR_ENV !== "1") throw new Error("Mission session control requires a Herdr pane.");
    return JSON.parse(await this.run("herdr", args, { env: this.env })).result;
  }
  /** The mission desk owns its terminal, so it runs in a pane of its own. A
   *  session outside Herdr cannot host it; the caller notifies instead. */
  async openDesk() {
    const split = await this.herdr(["pane", "split", "--current", "--direction", "right"]);
    const pane = split?.pane?.pane_id || split?.root_pane?.pane_id;
    if (!pane) throw new Error("Herdr returned no pane for the mission desk.");
    // `pane run` answers with no JSON, so the desk launch sends only the command.
    await this.run("herdr", ["pane", "run", pane, this.binary, "--vault", this.vault, "ui"], { env: this.env });
    return pane;
  }
  async common(cwd) { return realpathSync((await this.run("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"])).trim()); }
  /** The Herdr agent that holds one name, or null. Herdr lists a name only for
   *  an agent it started; a detected agent carries none. */
  async agentNamed(name) {
    const agents = (await this.herdr(["agent", "list"])).agents || [];
    return agents.find(a => a.name === name) || null;
  }
  /** Start the mission seat as a full Pi agent in the mission pane. The name
   *  comes from the mission. A name that another session holds takes a short
   *  handle hash once; the launch never renames another session's agent.
   *  `args` is the plan's captain argv tail, passed through Herdr's AGENT_ARG
   *  slot so the seat runs the allowlist the plan emits. */
  /** Start the mission worker once its pane is a free shell. A tab that Herdr
   *  just created can still be bringing its shell up, and `agent start` refuses
   *  a pane that is not an available shell yet; that refusal is retried, not
   *  fatal. Every other failure keeps its own handling. */
  async startWorker(handle, pane, args = []) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.startWorkerOnce(handle, pane, args); }
      catch (e) {
        if (!String(e.message).includes("agent_pane_busy") || attempt >= AGENT_PANE_READY_RETRIES) throw e;
        await new Promise(r => setTimeout(r, AGENT_PANE_READY_DELAY_MS));
      }
    }
  }
  async startWorkerOnce(handle, pane, args = []) {
    const start = name => this.herdr(["agent", "start", name, "--kind", "pi", "--pane", pane,
      ...(args.length ? ["--", ...args] : [])]);
    const name = workerAgentName(handle);
    try { await start(name); return name; }
    catch (e) { if (!takenAgentName(e.message)) throw e; }
    const retry = workerAgentName(handle, hash(handle));
    try { await start(retry); return retry; }
    catch (e) {
      const taken = takenAgentName(e.message);
      if (!taken) throw e;
      throw new Error(agentCollisionReport(taken, await this.agentNamed(taken),
        `That session holds the name. End it, or run \`herdr agent rename <pane> <new name>\`, then launch again (agent_name_taken).`));
    }
  }
  /** The agent a pane hosts, "unknown" when Herdr cannot answer, or null when
   *  the pane holds no agent. */
  async paneAgent(pane) {
    try { return (await this.herdr(["pane", "get", pane])).pane?.agent || null; }
    catch { return "unknown"; }
  }
  /** A failed launch stays retryable: it releases the intent it reserved, but
   *  only when no worker can own it. A pane that hosts an agent, an
   *  unanswered Herdr call, or a recorded session keeps the intent. */
  async releaseLaunch(handle, launchID, pane) {
    if (!launchID) return false;
    if (pane == null || await this.paneAgent(pane)) return false;
    try { await this.call(["launch", handle, "--release", "--launch-id", launchID]); return true; }
    catch { return false; }
  }
  async assertSurface(ctx) {
    const cwd = realpathSync(ctx.cwd);
    // Only a session that carries a Herdr pane can ask Herdr about it: `herdr()`
    // refuses for every other session, so the Rex seat below must be reachable
    // without it.
    if (this.env.HERDR_ENV === "1" && this.env.HERDR_PANE_ID) {
      const common = await this.common(ctx.cwd);
      const workspaces = repositoryWorkspaces((await this.herdr(["workspace", "list"])).workspaces, common);
      if (!workspaces.length) throw new Error("Open the repository's Herdr workspace first; missions register their worktree from it.");
      // A mission session lives in its own worktree workspace. Missions bound
      // before worktree workspaces existed still sit in the primary workspace, so
      // accept any workspace of this repository whose pane sits in the mission
      // checkout — the pane cwd, not the workspace count, is the binding.
      for (const w of workspaces) {
        const result = await this.herdr(["pane", "list", "--workspace", w.workspace_id]);
        const pane = result.panes?.find(p => p.pane_id === this.env.HERDR_PANE_ID);
        if (!pane || realpathSync(pane.foreground_cwd || pane.cwd) !== cwd) continue;
        this.surfaceSession = ctx.sessionManager.getSessionId();
        return { workspace: w.workspace_id, pane: pane.pane_id };
      }
    }
    // A Rex block is a seat too: the CLI accepts a session id and a block id
    // as workspace and pane, so bind on the cwd the block reports.
    if (!this.env.HERDR_PANE_ID && this.env.REX_BLOCK) {
      const info = await this.seatCwd();
      if (info && realpathSync(info) === cwd) {
        this.surfaceSession = ctx.sessionManager.getSessionId();
        return { workspace: this.env.REX_SESSION, pane: this.env.REX_BLOCK };
      }
    }
    throw new Error("Missions need a Herdr pane or a Rex block, running in the mission worktree. Move or resume this session there before attaching.");
  }
  async restore(ctx) {
    this.hint = null; this.error = null; this.surfaceSession = null; this.expectedAttachment = false;
    const file = this.key(ctx);
    if (!existsSync(file)) return;
    this.expectedAttachment = true;
    this.hint = JSON.parse(readFileSync(file, "utf8"));
    if (this.hint.session !== ctx.sessionManager.getSessionId() || this.hint.vault !== this.vault)
      throw new Error("Mission credential cache identity mismatch");
    // A judge capability belongs to one turn: at a session start every one of
    // them is stale, and the token stays in this session's cache alone.
    this.releaseJudgeCapabilities(ctx);
    await this.assertSurface(ctx);
    await this.flush(ctx);
    return this.current(ctx);
  }
  async current(ctx) {
    if (!this.hint) return null;
    if (this.surfaceSession !== ctx.sessionManager.getSessionId()) throw new Error("Restore the mission's Herdr attachment before continuing.");
    const r = await this.call(["show", this.hint.handle]);
    const b = r.state.runtime;
    if (!b || b.session_id !== ctx.sessionManager.getSessionId() || b.cwd !== realpathSync(ctx.cwd) || b.session_file !== realpathSync(ctx.sessionManager.getSessionFile() || ""))
      throw new Error("Mission owner differs from this session; tracking is suspended.");
    const a = r.state.attempts.find(a => a.id === r.state.active_attempt);
    if (active(a) && a.id !== this.hint.attempt) throw new Error("Mission attempt changed; explicitly attach before continuing.");
    return { record: r, attempt: a };
  }
  async attach(ctx, handle, launchID, agent) {
    if (this.hint && this.hint.handle !== handle) throw new Error("This session already tracks another mission.");
    const surface = await this.assertSurface(ctx);
    const record = await this.call(["show", handle]);
    const binding = record.state.runtime;
    if (binding && binding.cwd !== realpathSync(ctx.cwd)) throw new Error("This mission is bound to another worktree: " + binding.cwd);
    if (binding?.session_id && binding.session_id !== ctx.sessionManager.getSessionId()) throw new Error("Resume the existing Pi owner: " + binding.session_id);
    const previous = this.hint;
    // A launched worker continues eligible steps. A captain that attaches and
    // holds the claim continues too: autonomy follows ownership, not how the
    // session arrived. PI_SUBAGENT_AGENT keeps the answer for a worker the old
    // spawn path started.
    this.hint ||= { handle, token: randomUUID() + randomUUID(), session: ctx.sessionManager.getSessionId(), vault: this.vault, outbox: [],
      autoContinue: Boolean(launchID) || this.env.PI_SUBAGENT_AGENT === "mission-worker" };
    // Persist the capability BEFORE claiming, so a crash can replay attach.
    this.save(ctx);
    try {
      const args = ["attach", handle, "--session-id", ctx.sessionManager.getSessionId(), "--session-file", ctx.sessionManager.getSessionFile() || "",
        "--cwd", ctx.cwd, "--workspace", surface.workspace, "--pane", surface.pane,
        "--agent", agent || (launchID ? CAPTAIN_AGENT : WORKER_AGENT)];
      if (launchID) args.push("--launch-id", launchID);
      const c = await this.call(args, this.hint.token);
      this.expectedAttachment = true;
      this.hint.attempt = c.attempt.id; this.hint.launchID = launchID;
      // A successful attach that this session owns arms the loop. A read-only
      // attach (another session owns the binding) stays explicit.
      const own = !binding?.session_id || binding.session_id === ctx.sessionManager.getSessionId();
      if (own) this.hint.autoContinue = true;
      this.save(ctx);
      await this.record(ctx, { type: "session-start", summary: "Pi session attached" });
      return this.publicClaim(c);
    } catch (e) { if (previous) this.hint = previous; throw e; }
  }
  publicClaim(c) {
    return { handle: c.handle, step: c.step, attempt: c.attempt.id, brief: c.attempt.brief_snapshot,
      artifact: c.environment.MISSION_ARTIFACT, brief_file: c.environment.MISSION_BRIEF, cwd: c.attempt.cwd };
  }
  async flush(ctx) {
    const previous = this.flushing || Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this.flushOutbox(ctx));
    this.flushing = pending;
    try { await pending; } finally { if (this.flushing === pending) this.flushing = null; }
  }
  async flushOutbox(ctx) {
    if (!this.hint?.attempt) return;
    while (this.hint.outbox.length) {
      const item = this.hint.outbox[0];
      try { await this.deliver(item); }
      catch (e) {
        // A report the record can never take is not re-sent: the CLI refuses a
        // reused ID, and a trooper that finished after its attempt settled has
        // no attempt left to report on. Dropping it keeps the outbox from
        // wedging behind one undeliverable line; a transient failure retries.
        if (!(item.report && droppableReportError(e.message))) throw e;
      }
      this.hint.outbox.shift(); this.save(ctx);
    }
    this.error = null;
  }
  /** Send one outbox item: a lifecycle hook, or one trooper report. Hook argv
   *  contains bounded metadata only; credentials travel in env. */
  async deliver(item) {
    if (item.report) {
      const r = item.report;
      const args = ["progress", this.hint.handle, "--attempt", item.attempt, "--event-id", r.id,
        "--actor", r.trooper, "--status", r.status, "--summary", r.summary];
      if (r.next) args.push("--next", r.next);
      if (r.blocker) args.push("--blocker", r.blocker);
      return this.call(args, this.hint.token);
    }
    const e = item.event;
    const args = ["hook", e.type, "--handle", this.hint.handle, "--attempt", item.attempt, "--event-id", e.id,
      "--session-id", e.session_id, "--session-file", e.session_file, "--pane", e.pane_id || "", "--workspace", e.workspace_id || "", "--message", e.summary || ""];
    if (e.tool) args.push("--tool", e.tool);
    if (e.model) args.push("--model", e.model);
    if (e.quiescent) args.push("--quiescent");
    return this.call(args, this.hint.token);
  }
  /** Record one finished trooper. The report queues in the same outbox as the
   *  lifecycle hooks and flushes at once, so a reload replays an unacknowledged
   *  report under the same ID instead of appending a second one. */
  async report(ctx, message) {
    if (!this.hint?.attempt) return;
    const report = trooperReport(message);
    if (!report) return;
    if (this.hint.outbox.some(item => item.report?.id === report.id)) return;
    if (this.hint.outbox.length >= 128) throw new Error("Mission hook outbox full; restore CLI recording before continuing.");
    this.hint.outbox.push({ attempt: this.hint.attempt, report });
    this.save(ctx); await this.flush(ctx);
  }
  async record(ctx, event) {
    if (!this.hint?.attempt) return;
    if (this.hint.outbox.length >= 128) throw new Error("Mission hook outbox full; restore CLI recording before continuing.");
    this.hint.outbox.push({ attempt: this.hint.attempt, event: { id: randomUUID(), session_id: ctx.sessionManager.getSessionId(),
      session_file: ctx.sessionManager.getSessionFile(), pane_id: this.env.HERDR_PANE_ID, workspace_id: this.env.HERDR_WORKSPACE_ID,
      model:ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, ...event } });
    this.save(ctx); await this.flush(ctx);
  }
  async end(ctx, event) {
    await this.record(ctx, { type: "agent-end", summary: "Pi turn ended; automatic continuations may still run" });
  }
  async settled(ctx, event) {
    await this.record(ctx, { type: "agent-settled", summary: "Pi run settled", quiescent: quiescent(event, ctx) });
    const current = await this.current(ctx);
    if (current?.attempt?.status === "reported" && quiescent(event, ctx)) {
      return this.call(["settle", this.hint.handle, "--attempt", this.hint.attempt, "--session-id", ctx.sessionManager.getSessionId()], this.hint.token);
    }
  }
  async start(ctx, handle) {
    if (this.env.PI_SUBAGENT_NAME) throw new Error("Launch missions from the captain; workers own only their assigned mission.");
    const initial = await this.call(["show", handle]);
    const repos = await this.call(["repo", "list"]);
    const repo = repos.find(r => r.slug === initial.mission.repo);
    const checkout = repo?.checkouts?.[(await import("node:os")).hostname()];
    if (!checkout) throw new Error("Register a local repository checkout first.");
    const r = await this.call(["workspace", handle]);
    const cwd = r.state.runtime.cwd;
    const reservation = await this.call(["launch", handle]);
    if (!reservation.acquired) return { launched: false, reason: "Owner or launch intent already recorded; resume/attach it instead of launching again.", runtime: reservation.runtime };
    const launchID = reservation.runtime.launch_id;
    // The launch description has one owner: the CLI renders it in `mission
    // plan`, and plan writes nothing, so reading it here costs no state. Read it
    // BEFORE any seat exists, because the tab's environment and the seat's argv
    // are both taken from it, and Herdr fixes a tab's environment at creation.
    // This launch already reserved its intent, so the brief names that id.
    //
    // A plan enriches a launch; it never gates one. A CLI that predates
    // `mission plan`, a call that fails, and an answer with nothing usable are
    // one case: the launch degrades to #441's driver contract and #441's default
    // seat, which is exactly what a launch had before the plan existed. The
    // degradation is reported on the result, never swallowed. A plan that
    // answers still wins every field it answers.
    let planError = null;
    const planned = await this.call(["plan", handle, "--launch-id", launchID])
      .catch(e => { planError = e.message; return null; });
    const plan = usablePlan(planned) ? planned : null;
    if (!plan) planError ||= "mission plan answered nothing usable";
    // A failed launch must stay retryable: the reservation is released unless a
    // worker can own it. A launch that half-succeeded keeps it for inspection.
    let pane = null;
    try {
      // The CLI created the mission/<slug> checkout; Herdr registers it as the
      // repository's linked worktree workspace (idempotent: a relaunch reuses the
      // same workspace). Anchored on the primary checkout, because Herdr refuses
      // create/open from inside a linked worktree.
      const worktree = await this.herdr(["worktree", "open", "--cwd", checkout, "--path", cwd, "--no-focus"]);
      const workspace = worktree.workspace?.workspace_id;
      if (!workspace) throw new Error("Herdr did not return the mission worktree workspace; launch intent retained for inspection.");
      // The captain pane must inherit the launcher's configuration: Herdr sets a
      // tab's environment at creation and `worktree open` has no env flag, so the
      // launch always creates its own tab with that environment and then closes a
      // fresh workspace's empty root tab. The workspace keeps exactly one tab.
      // The plan's subagent session rides in the same environment
      // (`PI_SUBAGENT_SESSION`, rex.ts reads it as a label or an id), so every
      // trooper the captain deploys lands in mission-<slug> instead of army
      // without the captain having to repeat the name in each call.
      const env = [...driverEnv(this.env), ...(plan?.subagent_session ? [["PI_SUBAGENT_SESSION", plan.subagent_session]] : [])]
        .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
      const tab = await this.herdr(["tab", "create", "--workspace", workspace, "--cwd", cwd, "--label", initial.mission.slug, "--no-focus", ...env]);
      pane = tab.root_pane?.pane_id;
      if (!pane || tab.root_pane.workspace_id !== workspace) throw new Error("Herdr returned a different workspace; launch intent retained for inspection.");
      // A workspace that was already open may be parked on the mission's previous
      // session; its other tabs stay. Only a fresh workspace's empty root tab goes.
      const empty = worktree.already_open ? null : worktree.root_pane?.pane_id;
      if (empty && empty !== pane) {
        try { await this.herdr(["pane", "close", empty]); }
        catch { /* a leftover empty tab stays visible; it is never silent */ }
      }
      // The seat is a full Pi agent in this pane, not a subagent: it carries no
      // subagent env, loadout file, timer, or watchdog. Pi loads the repository
      // configuration and the missions skill in that worktree. Its reach is the
      // plan's argv, because Herdr starts the binary itself and Pi has no
      // profile flag: `seatArgs` is the only channel a profile can travel.
      const agent = await this.startWorker(handle, pane, seatArgs(plan?.captain_argv));
      try { await this.herdr(["agent", "wait", pane, "--until", "idle", "--timeout", String(AGENT_READY_TIMEOUT_MS)]); }
      catch (e) { throw new Error(`Herdr agent ${agent} did not become ready: ${herdrError(e.message)}`); }
      // The captain contract is the plan's, so this session starts from the text
      // the plan rendered for the intent this launch reserved. A plan that names
      // no brief (or no plan at all) keeps the capability layer's own driver
      // task, which answers the same launch id this reservation holds.
      await this.herdr(["agent", "prompt", pane, plan?.captain_brief || driverTask(handle, launchID)]);
      const sessionFile = (await this.herdr(["agent", "get", pane])).agent?.agent_session?.value;
      if (!sessionFile) throw new Error("Herdr reported no session for the mission agent; launch intent retained for inspection.");
      await this.call(["launch", handle, "--launch-id", launchID, "--session-file", sessionFile]);
      // The intent this launch acquired before the plan read is the one it
      // acks: a degraded plan changes the seat's argv and prompt, never the
      // reservation, so the ack rules are the same for both paths.
      return { launched: true, runtime: (await this.call(["show", handle])).state.runtime, session_file: sessionFile, pane, workspace,
        ...(planError ? { plan_degraded: planError } : {}) };
    } catch (e) {
      if (!(await this.releaseLaunch(handle, launchID, pane))) throw e;
      throw new Error(`${e.message} The launch intent is released; launch again when the cause is clear.`);
    }
  }
  /** Launch requests the desk left behind. The desk cannot start a mission: it
   *  writes one file per handle, this session claims it, and start() stays the
   *  only launch path. */
  launchDir() { return join(this.cacheDir, "launches"); }
  pendingLaunches() {
    const dir = this.launchDir();
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      try {
        const request = JSON.parse(readFileSync(file, "utf8"));
        if (request?.state === "pending" && request.handle) out.push({ ...request, file });
      } catch { /* a torn or foreign file is not a request */ }
    }
    return out;
  }
  /** Claim a request by rewriting it. A second claim reads "claimed" and loses,
   *  so one press can never produce two workers. */
  claimLaunch(request, sessionID) {
    let live;
    try { live = JSON.parse(readFileSync(request.file, "utf8")); } catch { return false; }
    if (live?.state !== "pending") return false;
    this.writeJSON(request.file, { ...live, state: "claimed", claimed_by: sessionID,
      updated_at: new Date().toISOString() });
    return true;
  }
  settleLaunch(request, patch) {
    let live;
    try { live = JSON.parse(readFileSync(request.file, "utf8")); } catch { live = request; }
    const { file, ...rest } = live;
    this.writeJSON(request.file, { ...rest, ...patch, updated_at: new Date().toISOString() });
  }
  /** The repository this session belongs to, by git common directory. A request
   *  from another repository is left for that repository's session. */
  async sessionRepo(ctx) {
    const common = await this.common(ctx.cwd);
    for (const repo of await this.call(["repo", "list"])) {
      for (const path of Object.values(repo.checkouts || {})) {
        try { if (await this.common(path) === common) return repo.slug; } catch { /* checkout is gone */ }
      }
    }
    return null;
  }
  /** The Herdr seat this session occupies. The desk writes the same two values
   *  into its request, so a request addressed to this workspace belongs here. */
  seat() { return { workspace: this.env.HERDR_WORKSPACE_ID || "", label: this.env.HERDR_PANE_ID || "" }; }
  /** The working directory of one live process: `lsof` on macOS, `/proc` on
   *  Linux. This reads the real seat; no environment value can stand in. */
  async procCwd(pid) {
    try {
      return process.platform === "darwin"
        ? String(await this.run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { env: this.env }))
          .split("\n").find(line => line.startsWith("n/"))?.slice(1) || null
        : String(await this.run("readlink", [`/proc/${pid}/cwd`], { env: this.env })).trim() || null;
    } catch { return null; }
  }
  /** The cwd of this process's own Rex block, via `rex block call … process`.
   *  `mission deploy` starts a captain through the login shell, and Rex reports
   *  only two process levels, so both are the wrapper and carry no cwd: walk
   *  down it to the process that owns the seat and read that one's cwd. */
  async seatCwd() {
    try {
      const out = await this.run("rex", ["block", "call", "-b", this.env.REX_BLOCK, "process"], { env: this.env });
      const info = JSON.parse(out);
      const known = info?.foreground?.cwd || info?.child?.cwd;
      // Most blocks answer directly, and that first call is the whole probe.
      if (known) return known;
      let pid = info?.foreground?.pid ?? info?.child?.pid;
      // Shallowest first: the seat is the first process under the wrapper, so a
      // deeper helper that happens to run elsewhere cannot hide its cwd.
      for (let depth = 0; pid && depth < 3; depth++) {
        let child = null;
        try { child = String(await this.run("pgrep", ["-P", String(pid)], { env: this.env })).trim().split("\n")[0] || null; }
        catch { child = null; }
        if (!child || !/^\d+$/.test(child)) return null;
        const cwd = await this.procCwd(child);
        if (cwd) return cwd;
        pid = child;
      }
      return null;
    } catch { return null; }
  }
  /** Whether an addressed Herdr workspace still exists. A request whose seat is
   *  gone (the session quit, the pane closed) may be adopted; a live seat keeps
   *  its own request. Outside Herdr nothing is live, so a repository session
   *  adopts the request after the checkout-family check. */
  async workspaceLive(workspace) {
    if (!workspace || this.env.HERDR_ENV !== "1") return false;
    try {
      const list = (await this.herdr(["workspace", "list"])).workspaces || [];
      return list.some(w => w.workspace_id === workspace);
    } catch { return false; }
  }
  /** Which pending request this session may claim. One request belongs to one
   *  repository and one checkout family; the addressed workspace goes first, an
   *  unaddressed request next, and a dead address inside the same family last. */
  async mayClaim(request, repo, seat, common) {
    if (request.repo !== repo) return false;
    if (request.owner_common && common && request.owner_common !== common) return false;
    if (!request.owner_workspace || request.owner_workspace === seat.workspace) return true;
    return !(await this.workspaceLive(request.owner_workspace));
  }
  claimRank(request, seat) {
    if (request.owner_workspace && request.owner_workspace === seat.workspace) return 0;
    return request.owner_workspace ? 2 : 1;
  }
  /** Claim and start one pending request this session may serve. Workers never
   *  launch; a busy turn waits; a second sweep finds the claim gone. A captain
   *  that already owns a mission still serves this workspace's request, because
   *  start() puts the worker in the mission's own worktree workspace. */
  async sweepLaunches(ctx) {
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      if (this.env.PI_SUBAGENT_NAME) return;
      const pending = this.pendingLaunches();
      if (!pending.length) return;
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
      const repo = await this.sessionRepo(ctx);
      if (!repo) return;
      const seat = this.seat();
      let common = null;
      try { common = await this.common(ctx.cwd); } catch { /* cwd is not a checkout */ }
      const candidates = [];
      for (const request of pending) if (await this.mayClaim(request, repo, seat, common)) candidates.push(request);
      candidates.sort((a, b) => this.claimRank(a, seat) - this.claimRank(b, seat));
      const request = candidates[0];
      if (!request || !this.claimLaunch(request, ctx.sessionManager.getSessionId())) return;
      try {
        const result = await this.start(ctx, request.handle);
        const launched = result?.launched === true;
        this.settleLaunch(request, { state: launched ? "started" : "failed", launch_id: result?.runtime?.launch_id,
          ...(result?.plan_degraded ? { plan_degraded: result.plan_degraded } : {}),
          ...(launched ? { workspace: result?.workspace, pane: result?.pane, session_file: result?.session_file }
            : { error: result?.reason || "the launch was not acknowledged" }) });
      } catch (e) {
        this.settleLaunch(request, { state: "failed", error: e.message });
      }
    })();
    try { await this.sweeping; } finally { this.sweeping = null; }
  }
  async action(ctx, p, eventID = randomUUID()) {
    const handle = p.handle || this.hint?.handle;
    if (p.action === "list") return (await this.call(["list"])).map(r => ({handle:r.handle,title:r.mission.title,status:r.state.status,step:r.state.current_step,checkpoint:r.state.pending_checkpoint}));
    if (p.action === "create") {
      if (!p.repo || !p.title || !p.goal || !p.steps?.length) throw new Error("Create needs repo, title, goal, and step titles.");
      const args = ["new", p.handle || `${p.repo}/${slug(p.title)}`, "--title", p.title, "--goal", p.goal, "--kind", p.kind || "implementation"];
      for (const step of p.steps) args.push("--step", step);
      return this.call(args);
    }
    if (!handle) throw new Error("Choose a mission handle first.");
    if (p.action === "start") return this.start(ctx, handle);
    if (p.action === "attach" || p.action === "next") return this.attach(ctx, handle, p.launch_id || this.hint?.launchID, p.agent);
    if (p.action === "status") {
      const record = await this.call(["show", handle]);
      return { ...record, summary: driverStatus(record) };
    }
    if (p.action === "steps") return this.call(["steps", handle]);
    // Retry is the existing CLI command, exposed so the driver can steer a failed
    // step back to pending without leaving this session.
    if (p.action === "retry") return this.call(["retry", handle]);
    if (p.action === "edit") {
      if (!p.step) throw new Error("Edit needs a step id.");
      const args = ["step", "edit", handle, p.step];
      for (const key of ["instructions", "acceptance", "output"]) if (p[key] !== undefined) args.push("--"+key, p[key]);
      if (p.checks) args.push("--checks", p.checks.join(","));
      // The revision guard from #426 stays load-bearing: the edit names the
      // revision the driver's answer was built from, so a write that landed in
      // between is refused instead of overwritten. A fresh read is the default,
      // never a blind write.
      const revision = Number.isInteger(p.revision) && p.revision > 0 ? p.revision : (await this.call(["show", handle])).state.revision;
      args.push("--revision", String(revision));
      // Reset is deliberately CLI-only: inspect history and obtain a user decision first.
      return this.call(args);
    }
    if (!this.hint?.attempt || handle !== this.hint.handle) throw new Error("Attach this session before reporting progress.");
    await this.flush(ctx);
    const current = await this.current(ctx);
    if (!active(current?.attempt)) throw new Error("No active step; inspect checkpoints or explicitly pick up next.");
    // The judge reads the artifact, runs the check run itself, and records its
    // verdict. Its capability is a file path; the token stays in this cache.
    if (p.action === "judge") {
      const a = current.attempt;
      const st = a.Definition || (current.record.mission.steps || []).find(s => s.id === a.step) || {};
      const checks = [...new Set(["nonempty-artifact", ...(st.checks || [])])];
      const artifact = join(this.vault, "6_missions", handle, a.artifact);
      const capability = this.judgeCapability(ctx, a.id);
      const task = judgeTask({ handle, attempt: a.id, step: a.step, artifact, evidence: a.artifact,
        acceptance: st.acceptance || "", checks, capability, vault: this.vault, binary: this.binary, cwd: a.cwd });
      return { handle, attempt: a.id, step: a.step, artifact, acceptance: st.acceptance || "", checks,
        capability, agent: "worker", name: "judge-" + a.step, task };
    }
    const args = [p.action, handle, "--attempt", this.hint.attempt];
    if (p.action === "progress") {
      args.push("--status", p.status || "working", "--summary", p.summary || "", "--event-id", p.event_id || eventID);
      if (p.actor) args.push("--actor", p.actor);
      if (p.next) args.push("--next", p.next);
      if (p.blocker) args.push("--blocker", p.blocker);
      for (const evidence of p.evidence || []) args.push("--evidence", evidence);
    } else if (p.action === "finish" || p.action === "fail") { if (p.summary) args.push("--note", p.summary); }
    else if (p.action !== "verify") throw new Error("Unknown mission action");
    const r = await this.call(args, this.hint.token);
    // The judge has finished once the driver verifies or reports: its one-shot
    // capability must not outlive that, and a failed call keeps it for a retry.
    if (["verify", "finish", "fail"].includes(p.action)) this.releaseJudgeCapabilities(ctx, this.hint.attempt);
    if (!r.state) return r;
    const a = r.state.attempts.find(a => a.id === this.hint.attempt);
    return { handle, status:r.state.status, attempt:a.id, attempt_status:a.status, step:a.step, checkpoint:r.state.pending_checkpoint,
      progress:a.progress?.at(-1), verification:a.verifications?.at(-1),
      message: p.action === "finish" || p.action === "fail" ? "Completion reported. Ownership remains until the turn settles; checks and checkpoints still apply." : undefined };
  }
}
