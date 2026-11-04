import { missionContinues } from "./core.mjs";

// The mission panel's pure part: it turns one CLI record into rows and keys.
// No TUI and no CLI call lives here, so the suite tests it directly.

/** The widest row label decides the label column: "Checkpoint" is 10 columns.
 *  The panel adds one space before the value, so every value starts at 11. */
export const LABEL_COLUMN = 10;

/** The key row, in display order. `esc` and `q` both close the panel. */
export const PANEL_KEYS = [
  { key: "a", action: "accept", label: "accept" },
  { key: "v", action: "revise", label: "revise" },
  { key: "s", action: "start", label: "start" },
  { key: "t", action: "retry", label: "retry" },
  { key: "o", action: "open", label: "open in desk" },
  { key: "esc", action: "close", label: "close" },
];

/** Step states the CLI writes, in human words. */
const STEP_LABELS = {
  pending: "pending",
  running: "in progress",
  verifying: "verifying",
  passed: "passed",
  failed: "failed",
  needs_changes: "needs changes",
};

/** Checkpoint states the CLI writes, in human words. */
const CHECKPOINT_LABELS = {
  pending: "waiting",
  accepted: "accepted",
  not_reached: "not reached",
};

const ATTEMPT_LABELS = { running: "running", reported: "reported", succeeded: "succeeded", failed: "failed" };

/** A mission status decides the header color. */
const STATUS_TONES = {
  ready: "accent",
  running: "accent",
  waiting: "warning",
  review: "warning",
  done: "success",
  failed: "error",
};

const words = (map, value) => map[value] || String(value || "").replaceAll("_", " ");

/** Map one key press to its action. Unknown keys have no action. */
export function actionForKey(key) {
  return PANEL_KEYS.find(entry => entry.key === key)?.action;
}

/** Why an action cannot run now, or undefined when it can. */
export function actionBlockReason(action, record) {
  const state = record?.state;
  if (action === "close") return undefined;
  if (!state) return "no mission record";
  if (action === "open") return undefined;
  if (action === "accept" || action === "revise") {
    const id = state.pending_checkpoint;
    if (!id) return "no pending checkpoint";
    if (state.checkpoints?.[id]?.status !== "pending") return "checkpoint is not pending";
    return undefined;
  }
  if (action === "start") {
    if (state.active_attempt) return "attempt is running";
    if (state.pending_checkpoint) return "checkpoint is waiting";
    return missionContinues(state) ? undefined : "no step to start";
  }
  if (action === "retry") {
    if (state.active_attempt) return "attempt is running";
    return state.steps?.[state.current_step]?.status === "failed" ? undefined : "current step is not failed";
  }
  return "unknown action";
}

/** Every key with its current state. A disabled key stays visible and dimmed. */
export function panelActions(record) {
  return PANEL_KEYS.map(entry => {
    const reason = actionBlockReason(entry.action, record);
    return reason ? { ...entry, enabled: false, reason } : { ...entry, enabled: true };
  });
}

/** "attempt-1a2b3c…" as "attempt-1a2b": the panel names the attempt, not its hash. */
export function shortAttempt(id) {
  const text = String(id || "");
  const suffix = text.replace(/^attempt-/, "");
  return suffix.length > 4 ? "attempt-" + suffix.slice(0, 4) : text;
}

/** A compact duration: "12s", "3m", "2h 5m". */
export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** Run time of a started attempt, or "" when the start time is unusable. */
export function elapsedSince(startedAt, now = Date.now()) {
  const start = Date.parse(startedAt || "");
  return Number.isFinite(start) ? formatElapsed(now - start) : "";
}

const has = value => typeof value === "string" && value.trim().length > 0;

/** The current step: the recorded one, else the first step that has not passed. */
function currentStep(mission, state) {
  const steps = mission.steps || [];
  const id = state.current_step || steps.find(step => state.steps?.[step.id]?.status !== "passed")?.id;
  if (!id) return undefined;
  return { id, def: steps.find(step => step.id === id), state: state.steps?.[id] };
}

/** Rows the panel shows: Goal, Step, Attempt, Checkpoint, Blocker. */
function recordRows(record, now) {
  const mission = record.mission || {};
  const state = record.state || {};
  const rows = [];
  const add = (label, value, status = "", tone = "text") => {
    if (!has(value)) return;
    rows.push({ label, value: String(value), status: status || "", tone });
  };
  add("Goal", mission.goal);
  const step = currentStep(mission, state);
  if (step) add("Step", has(step.def?.title) ? `${step.id} · ${step.def.title}` : step.id,
    words(STEP_LABELS, step.state?.status), step.state?.status === "failed" ? "error" : "text");
  const attempts = state.attempts || [];
  const attempt = (state.active_attempt && attempts.find(a => a.id === state.active_attempt)) || attempts.at(-1);
  if (attempt?.id) {
    const elapsed = attempt.status === "running" ? elapsedSince(attempt.started_at, now) : "";
    const status = words(ATTEMPT_LABELS, attempt.status) + (elapsed ? " " + elapsed : "");
    add("Attempt", `${shortAttempt(attempt.id)}${has(attempt.agent) ? " · " + attempt.agent : ""}`, status,
      attempt.status === "failed" ? "error" : "accent");
  }
  const pending = state.pending_checkpoint;
  if (pending) {
    const definition = (mission.checkpoints || []).find(checkpoint => checkpoint.id === pending);
    add("Checkpoint", has(definition?.question) ? `${pending} · ${definition.question}` : pending,
      words(CHECKPOINT_LABELS, state.checkpoints?.[pending]?.status), "warning");
  }
  // The blocker row always states something: "none" is a fact the human reads.
  const progress = attempt?.progress || [];
  const blocker = [...progress].reverse().find(entry => has(entry.blocker))?.blocker;
  rows.push({ label: "Blocker", value: blocker || "none", status: "", tone: blocker ? "error" : "dim" });
  return rows;
}

/** The whole panel as data: header, rows, keys, and one optional reason line. */
export function buildPanelModel(input = {}) {
  const { record, handle, error, now = Date.now() } = input;
  const name = record?.handle || handle || "";
  if (!record) {
    const reason = error || (name ? `No record found for ${name}.` : "A mission handle is required.");
    return { handle: name, status: "", statusLine: "", tone: "error", rows: [], keys: panelActions(undefined), error: reason };
  }
  const state = record.state || {};
  const status = state.status || "unknown";
  const tone = STATUS_TONES[status] || "text";
  const revision = Number.isInteger(state.revision) ? `rev ${state.revision}` : "";
  const statusLine = [status, revision].filter(Boolean).join(" · ");
  return { handle: name, status, statusLine, tone, rows: recordRows(record, now), keys: panelActions(record), error };
}

/** The CLI arguments for one human checkpoint decision. */
export function checkpointArgs(handle, record, options = {}) {
  const { decision, actor, note } = options;
  if (!has(handle)) throw new Error("Choose a mission handle first.");
  if (decision !== "accept" && decision !== "revise") throw new Error("A checkpoint decision is accept or revise.");
  const state = record?.state;
  const id = state?.pending_checkpoint;
  if (!id) throw new Error("This mission has no pending checkpoint.");
  if (!Number.isInteger(state.revision)) throw new Error("The mission record has no revision.");
  const fallback = decision === "accept" ? "Accepted in the Pi mission panel" : "Revision requested in the Pi mission panel";
  return ["checkpoint", handle, "--id", id, "--decision", decision, "--human", "--actor", actor || "pi-user",
    "--note", has(note) ? note : fallback, "--revision", String(state.revision)];
}
