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

/** The identity a launched seat records. A launch sends the captain brief and
 *  runs the captain allowlist, so the seat it starts is a captain; a session
 *  that attaches on its own, with no launch intent to answer, is a trooper. */
export const CAPTAIN_AGENT = "mission-captain";
export const WORKER_AGENT = "mission-worker";

/** The contract of one mission driver. The driver holds the claim on one work
 *  request and steers it; it performs no step work itself. One work subagent
 *  executes each step, one judge subagent decides it, and the driver stays the
 *  single place the human visits for status and admin prompts. A launch id
 *  names the intent a seat answers, so only a launched seat is told to attach. */
export function driverTask(handle, launchID) {
  return [
    `You are the driver for mission ${handle}, not its worker. You hold the claim on this work request.`,
    ...(launchID ? [`Attach first: call mission with action=attach, handle=${handle}, launch_id=${launchID}. Its returned step brief and the missions skill describe the work, but you send that work out.`] : []),
    "Duty 1 — hold the claim: this session owns the attempt and keeps the mission tool. Report structured progress, and call mission action=verify and mission action=finish only after a judge records a pass.",
    "Duty 2 — subagents do all step work: you never edit repository code and you never write a step artifact. For each step, spawn one work subagent (agent=worker) with the step brief, its artifact path, and the acceptance criteria, then wait for its result.",
    "Duty 3 — subagents judge: after the work subagent reports, call mission action=judge and spawn one judge subagent (agent=worker, name=judge-<step>) with the returned task verbatim. Never judge your own work and never reuse the work subagent's session. The judge reads the artifact, runs the CLI checks itself through mission verify, and records its verdict with reasons as progress. When the step's checks include a cmd: check, the passed check is the verdict, so spawn no judge.",
    "Duty 4 — advance in the same turn: after a judge records a pass, spawn the next step's work subagent in that same turn instead of ending it. A pending checkpoint is the only reason to stop between steps.",
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

/** CLI refusals that make a queued line permanently undeliverable: the record
 *  already holds a different aspect of that ID, the attempt the line names is
 *  gone, ended, or no longer the owner, or its handle vanished. Matched on the
 *  CLI's own error codes (see the `Problem("code"` calls under go/mission),
 *  never on a substring: a transient failure — the CLI is busy or gone — is not
 *  on this list, so that line retries. A hook is dropped by the same rule as a
 *  report: an attempt the ledger stopped listing cannot take either one, and
 *  retrying it forever is how a wedged outbox held every later event. */
export const DROPPABLE_EVENT_CODES = new Set(["event_conflict", "stale_attempt", "attempt_terminal", "closed", "not_found", "invalid_handle"]);
export function droppableEventError(message) {
  return DROPPABLE_EVENT_CODES.has(/^([a-z_]+): /.exec(String(message ?? ""))?.[1] ?? "");
}

/** The path of a block's `pwd` answer: `file://<host>/<abs path>`, or a bare
 *  path. Only the path names the seat, so the scheme and the answering host go. */
function pwdPath(answer) {
  const text = String(answer ?? "").trim();
  if (!text) return null;
  const path = text.startsWith("file://") ? text.replace(/^file:\/\/[^/]*/, "") : text;
  if (!path.startsWith("/")) return null;
  try { return decodeURIComponent(path); } catch { return path; }
}

/** Why this session is not a mission seat. Three causes used to share one
 *  sentence — no seat at all, a Rex block that reports no cwd, and a seat in
 *  another checkout — so a captain refused in 57 ms could not say which one
 *  happened: a process environment is unreadable from outside on macOS. Each
 *  answer names the seat it saw, the cwd it reported, and the cwd this session
 *  runs in. `paneCwd` and `blockCwd` are only set when that seat answered. */
function seatRefusal({ paneID, herdrSeat, blockID, paneCwd, blockCwd, cwd }) {
  if (herdrSeat) return paneCwd === undefined
    ? `Herdr pane ${paneID} is in no workspace Herdr lists. Move this session into the mission worktree's pane before attaching.`
    : `Herdr pane ${paneID} reports ${paneCwd} but this session runs in ${cwd}. Move this session into the mission worktree's pane before attaching.`;
  if (blockCwd !== undefined) return blockCwd === null
    ? `Rex block ${blockID} reports no cwd, and this session runs in ${cwd}. Check the block still runs a shell in the mission worktree, or resume this session there.`
    : `Rex block ${blockID} reports ${blockCwd} but this session runs in ${cwd}. Resume this session in ${blockCwd}.`;
  // Neither seat was reachable, so the inputs themselves are the answer.
  const seen = [
    paneID ? `HERDR_PANE_ID=${paneID} is set without HERDR_ENV=1` : "no Herdr pane (HERDR_PANE_ID empty)",
    blockID ? `REX_BLOCK=${blockID} stays unread while HERDR_PANE_ID is set` : "no Rex block (REX_BLOCK empty)",
  ];
  return `No mission seat: ${seen.join(" and ")}. Start this session in the mission worktree's Herdr pane, or in a Rex block there.`;
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
    // The attempt whose contract this session already delivered: the contract
    // goes with the attach, and the turns after it stay short.
    this.contractAttempt = null;
    // The attempt the last ledger read listed as the owner. Every emitted line
    // names this one, never `hint.attempt`: the hint records which attempt this
    // session attached to, and a ledger read is the only thing that says which
    // attempt is the owner now.
    this.ledgerAttempt = null;
    this.surfaceSession = null;
    this.surface = null;
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
  async assertSurface(ctx) {
    const cwd = realpathSync(ctx.cwd);
    const paneID = this.env.HERDR_PANE_ID || "";
    // Only a session that carries a Herdr pane can ask Herdr about it: `herdr()`
    // refuses for every other session, so the Rex seat below must be reachable
    // without it.
    const herdrSeat = this.env.HERDR_ENV === "1" && Boolean(paneID);
    // What the pane reported when it is not this checkout: the refusal below
    // names it, so a mismatch reads without a live probe of the process.
    let paneCwd;
    if (herdrSeat) {
      // The binding is the pane's cwd, never the workspace's shape. A captain
      // seated by `mission deploy` runs in the shared army workspace, which Herdr
      // carries no worktree for, and that pane is as much the mission's seat as
      // one in the worktree's own workspace. `pane list` answers for every
      // workspace at once, so one call covers both shapes and the pane names the
      // workspace it sits in.
      const panes = (await this.herdr(["pane", "list"])).panes || [];
      const pane = panes.find(p => p.pane_id === paneID);
      if (pane) {
        const here = realpathSync(pane.foreground_cwd || pane.cwd);
        if (here === cwd) {
          this.surfaceSession = ctx.sessionManager.getSessionId();
          this.surface = { workspace: pane.workspace_id, pane: pane.pane_id };
          return this.surface;
        }
        paneCwd = here;
      }
    }
    // A Rex block is a seat too: the CLI accepts a session id and a block id
    // as workspace and pane, so bind on the cwd the block reports.
    const blockID = this.env.REX_BLOCK || "";
    const rexSeat = !paneID && Boolean(blockID);
    if (rexSeat) {
      const info = await this.seatCwd();
      // The refusal names the same form the decision compares, so a symlinked
      // block path never reads as a third directory.
      const here = info ? realpathSync(info) : null;
      if (here === cwd) {
        this.surfaceSession = ctx.sessionManager.getSessionId();
        this.surface = { workspace: this.env.REX_SESSION, pane: blockID };
        return this.surface;
      }
      throw new Error(seatRefusal({ paneID, herdrSeat, blockID, paneCwd, blockCwd: here, cwd }));
    }
    throw new Error(seatRefusal({ paneID, herdrSeat, blockID, paneCwd, cwd }));
  }
  async restore(ctx) {
    this.hint = null; this.error = null; this.surfaceSession = null; this.expectedAttachment = false;
    // A restored session starts a fresh history, so it hears the contract again.
    this.contractAttempt = null;
    this.ledgerAttempt = null;
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
    // The owner is the attempt the ledger lists now, never the one an earlier
    // attach captured. A re-claim — retry, abandon, or repair, then a fresh
    // claim — replaces this session's attempt, so this read adopts it and every
    // emitted line names the new id. An attempt another session or a managed run
    // owns is still a refusal.
    const a = (r.state.attempts || []).find(x => x.id === r.state.active_attempt) || null;
    const mine = Boolean(a?.session_id) && a.session_id === ctx.sessionManager.getSessionId();
    if (mine && this.hint.attempt !== a.id) { this.hint.attempt = a.id; this.save(ctx); }
    if (active(a) && !mine) throw new Error("Mission attempt changed; explicitly attach before continuing.");
    this.ledgerAttempt = a?.id ?? null;
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
      // The claim the CLI just rendered is the ledger's answer, so it is also
      // the attempt this session reports on until the next read replaces it.
      this.ledgerAttempt = c.attempt.id;
      // A successful attach that this session owns arms the loop. A read-only
      // attach (another session owns the binding) stays explicit.
      const own = !binding?.session_id || binding.session_id === ctx.sessionManager.getSessionId();
      if (own) this.hint.autoContinue = true;
      this.save(ctx);
      await this.record(ctx, { type: "session-start", summary: "Pi session attached" });
      return this.publicClaim(c);
    } catch (e) { if (previous) this.hint = previous; throw e; }
  }
  /** Whether this turn carries the driver contract. One attempt delivers it
   *  once: a new attempt, or a restored session, delivers it again, while a
   *  replayed attach to the same attempt repeats nothing. */
  contractTurn(attempt) {
    if (!attempt?.id || this.contractAttempt === attempt.id) return false;
    this.contractAttempt = attempt.id;
    return true;
  }
  publicClaim(c) {
    // `context` is the step brief and attempt line the CLI rendered from the
    // ledger for this claim, and `driver` its driver lines. A seat reads those,
    // not a text this extension assembled: only the CLI reads the ledger.
    return { handle: c.handle, step: c.step, attempt: c.attempt.id, context: c.context || "", driver: c.driver || [],
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
        // A line the record can never take is not re-sent: the CLI refuses a
        // reused ID, and a hook or report queued under an attempt the ledger no
        // longer lists has no attempt left to land on. Dropping it keeps the
        // outbox from wedging behind one undeliverable line — the 2026-11-05
        // wedge — while a transient failure still retries.
        if (!droppableEventError(e.message)) throw e;
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
   *  report under the same ID instead of appending a second one. The attempt it
   *  names is the one the ledger listed at the last read: a report is never
   *  queued under an id the ledger cannot show. */
  async report(ctx, message) {
    const attempt = this.ledgerAttempt;
    if (!attempt) return;
    const report = trooperReport(message);
    if (!report) return;
    if (this.hint.outbox.some(item => item.report?.id === report.id)) return;
    if (this.hint.outbox.length >= 128) throw new Error("Mission hook outbox full; restore CLI recording before continuing.");
    this.hint.outbox.push({ attempt, report });
    this.save(ctx); await this.flush(ctx);
  }
  async record(ctx, event) {
    const attempt = this.ledgerAttempt;
    if (!attempt) return;
    if (this.hint.outbox.length >= 128) throw new Error("Mission hook outbox full; restore CLI recording before continuing.");
    const seat = this.eventSeat();
    this.hint.outbox.push({ attempt, event: { id: randomUUID(), session_id: ctx.sessionManager.getSessionId(),
      session_file: ctx.sessionManager.getSessionFile(), pane_id: seat.pane, workspace_id: seat.workspace,
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
      return this.call(["settle", this.hint.handle, "--attempt", current.attempt.id, "--session-id", ctx.sessionManager.getSessionId()], this.hint.token);
    }
  }
  /** The mux this session runs in. Herdr names a workspace and a pane for every
   *  session it hosts; anything else is a Rex block, which names its session and
   *  block. Seating is the CLI's call for either, so this only says which. */
  mux() { return this.env.HERDR_ENV === "1" && this.env.HERDR_PANE_ID ? "herdr" : "rex"; }
  /** Launch one mission. Seating has one owner: the CLI. `mission deploy --mux`
   *  reserves the intent, seats the army session, the captain's window and the
   *  mission's subagent session, and acks it, for whichever mux this session runs
   *  in. This extension owns no mux command for a launch, so a Rex mission and a
   *  Herdr mission take the same path, and the launch reads the runtime back from
   *  `mission show` instead of guessing it from the calls it made. */
  async start(ctx, handle) {
    if (this.env.PI_SUBAGENT_NAME) throw new Error("Launch missions from the captain; workers own only their assigned mission.");
    const initial = await this.call(["show", handle]);
    const repos = await this.call(["repo", "list"]);
    const repo = repos.find(r => r.slug === initial.mission.repo);
    const checkout = repo?.checkouts?.[(await import("node:os")).hostname()];
    if (!checkout) throw new Error("Register a local repository checkout first.");
    // The worktree is the CLI's, not the mux's: `mission workspace` prepares or
    // revives the mission checkout the seat runs in, and deploy refuses a
    // mission without one.
    await this.call(["workspace", handle]);
    const deployment = await this.call(["deploy", handle, "--mux", this.mux()]);
    const runtime = (await this.call(["show", handle])).state.runtime;
    // A repeat press finds the captain still seated and focuses it instead of
    // seating a second one, exactly as `mission deploy` reports.
    if (deployment.focused) {
      return { launched: false, reason: "The captain seat is already live; it was focused instead of seated again.", runtime };
    }
    return { launched: true, runtime, session_file: deployment.session_file || runtime.session_file,
      pane: deployment.pane || runtime.pane, workspace: runtime.workspace };
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
  /** The seat a hook event reports: the one assertSurface resolved, or the
   *  environment that names it before an attach. A Rex seat carries no Herdr
   *  variables, so reading Herdr alone left its workspace empty. */
  eventSeat() {
    if (this.surface) return this.surface;
    return this.env.HERDR_ENV === "1"
      ? { workspace: this.env.HERDR_WORKSPACE_ID, pane: this.env.HERDR_PANE_ID }
      : { workspace: this.env.REX_SESSION, pane: this.env.REX_BLOCK };
  }
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
  /** The cwd the block itself reports. `rex block call -b <block> pwd` answers
   *  `{"pwd":"file://<host>/<path>"}` for the host the block runs on: one call
   *  and no process tree, so a seat that answers needs no walk below. A block
   *  that cannot answer — a dead seat, an older Rex — returns null, and the
   *  process probe asks the terminal instead. */
  async blockCwd() {
    try {
      const out = String(await this.run("rex", ["block", "call", "-b", this.env.REX_BLOCK, "pwd"], { env: this.env }));
      let answer = out;
      try { answer = JSON.parse(out)?.pwd ?? out; } catch { /* plain text: the answer is the path */ }
      return pwdPath(answer);
    } catch { return null; }
  }
  /** The cwd of this process's own Rex block: the block's own `pwd` first, then
   *  `rex block call … process`. `mission deploy` starts a captain through the
   *  login shell, and Rex reports only two process levels, so both are the
   *  wrapper and carry no cwd: walk down it to the process that owns the seat
   *  and read that one's cwd. */
  async seatCwd() {
    const own = await this.blockCwd();
    if (own) return own;
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
   *  the CLI seats its captain as a tab of this workspace. */
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
    // Every call below names the attempt this read found in the ledger, so a
    // re-claim is reported under its new id and a hint value can never address
    // an attempt the ledger does not list.
    const attempt = current.attempt.id;
    // The judge reads the artifact, runs the check run itself, and records its
    // verdict. Its capability is a file path; the token stays in this cache.
    if (p.action === "judge") {
      const a = current.attempt;
      const st = a.Definition || (current.record.mission.steps || []).find(s => s.id === a.step) || {};
      const checks = [...new Set(["nonempty-artifact", ...(st.checks || [])])];
      const artifact = join(this.vault, "6_missions", handle, a.artifact);
      const capability = this.judgeCapability(ctx, attempt);
      const task = judgeTask({ handle, attempt, step: a.step, artifact, evidence: a.artifact,
        acceptance: st.acceptance || "", checks, capability, vault: this.vault, binary: this.binary, cwd: a.cwd });
      return { handle, attempt, step: a.step, artifact, acceptance: st.acceptance || "", checks,
        capability, agent: "worker", name: "judge-" + a.step, task };
    }
    const args = [p.action, handle, "--attempt", attempt];
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
    if (["verify", "finish", "fail"].includes(p.action)) this.releaseJudgeCapabilities(ctx, attempt);
    if (!r.state) return r;
    const a = (r.state.attempts || []).find(x => x.id === attempt) || current.attempt;
    return { handle, status:r.state.status, attempt: attempt, attempt_status:a.status, step:a.step, checkpoint:r.state.pending_checkpoint,
      progress:a.progress?.at(-1), verification:a.verifications?.at(-1),
      message: p.action === "finish" || p.action === "fail" ? "Completion reported. Ownership remains until the turn settles; checks and checkpoints still apply." : undefined };
  }
}
