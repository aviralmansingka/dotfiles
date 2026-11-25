import { defineDoc } from "../documents.js";
import { convertPartial } from "./generation.js";
export const LiveDoc = defineDoc({
    kind: "pi.live",
    version: 3,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({}),
    // Version 1 named a compaction's trigger `reason`, in `compactions` and `compactionFailure`. Versions 1 and 2 (as
    // builds before `run.turns` stored it) may lack `run.turns`: a run in flight across the upgrade counts its turns
    // from 0. Version 2 already names the trigger `trigger`, so renaming leaves it alone.
    migrate: (value) => {
        const live = value;
        const { run, compactions, compactionFailure } = live;
        return {
            ...value,
            ...(run === undefined ? {} : { run: { ...run, turns: typeof run.turns === "number" ? run.turns : 0 } }),
            ...(compactions === undefined ? {} : { compactions: compactions.map(renameReason) }),
            ...(compactionFailure === undefined ? {} : { compactionFailure: renameReason(compactionFailure) }),
        };
    },
    // REMINDER: a complete base whenever nothing runs (spec §8.2): no generation and no running tool slot. That holds
    // while idle, in the commit handing a generation over to its tool round, and between tools, so the delta chain
    // spans at most one generation or the overlapping execution of one round's tools. A slot holds output only while
    // running, so every base is small; a nested call's result lives in its caller's task documents, never here. Do not
    // add a delta-count bound; the tool output benchmark checks this rule.
    checkpointWhen: (value) => value.generation === undefined &&
        !(value.tools ?? []).some((slot) => slot.status === "running") &&
        !(value.nestedTools ?? []).some((slot) => slot.status === "running"),
});
/** A copy of a version 1 compaction status or failure with `reason` renamed `trigger`, its keys in their order. */
function renameReason(value) {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key === "reason" ? "trigger" : key, field]));
}
/**
 * How the progress throttles commit a partial answer and running tool output into `pi.live`: deferred, so storage gets
 * them together, at the next commit that reads or writes `pi.live` or after `settings.progress.persistWithinMs`. Every
 * commit that consumes or clears streamed fields reads `pi.live`, so it stores them with its own changes (spec §8.2).
 */
export const PROGRESS_COMMIT = { persistence: { kind: "deferred" } };
/** Built-in task kinds that can own `pi.live.run`. */
const RUN_TASK_KINDS = new Set(["pi.generation"]);
const TOOL_TASK_KIND = "pi.tool";
const COMPACTION_TASK_KIND = "pi.compaction";
/**
 * Built-in task kinds that end themselves once cut off `settings.restartLimit` times (`TaskRecord.restarts`); the
 * scheduler faults a task of any other kind instead (spec §5.4).
 */
export const LIMITS_RESTARTS = new Set([...RUN_TASK_KINDS, TOOL_TASK_KIND, COMPACTION_TASK_KIND]);
/** Whether `task` was cut off `settings.restartLimit` times in a row, so its phase ends it instead of running. */
export function cutOffTooOften(task, runtime) {
    // The settings are read only for a task that was cut off at all, so the normal path resolves nothing more.
    return task.restarts !== undefined && task.restarts >= runtime.settings.restartLimit;
}
/**
 * Whether a task at the limit may still do the cleanup it does when it ends, such as converting a partial: only at the
 * limit. Past it, that cleanup may be what cut the task off, so the task ends without it.
 */
export function salvageable(task, runtime) {
    return (task.restarts ?? 0) <= runtime.settings.restartLimit;
}
/** How often a task was cut off, for a message: "once", or "3 times in a row". */
export function cutOffCount(task) {
    const restarts = task.restarts ?? 0;
    return restarts === 1 ? "once" : `${restarts} times in a row`;
}
/**
 * End the run owned by `taskId`: settle each of its inputs, remove `run`, and, without an answer, record
 * `runFailure`. A run that answered already, and runs only its `afterRun` tasks, records no failure, however it ends.
 * Always removes `generation`, `tools`, and `nestedTools`, whose presentation belongs to the ending run.
 */
export function endRun(tx, live, taskId, end) {
    if (live.run?.taskId === taskId) {
        const inputs = [...live.run.inputs];
        const { first } = live.run;
        if (end.status === "done") {
            for (const id of inputs)
                tx.settleSubmission(id, { status: "done", answer: end.answer });
        }
        else if (live.run.afterRun === undefined) {
            const { reason, detail } = end;
            const settlement = end.settlement ?? {
                status: "unanswered",
                reason,
                ...(detail === undefined ? {} : { detail }),
            };
            for (const id of inputs)
                tx.settleSubmission(id, settlement);
            live.runFailure = {
                taskId,
                inputs,
                reason,
                ...(detail === undefined ? {} : { detail }),
                ...(first === undefined ? {} : { first }),
            };
        }
        delete live.run;
    }
    delete live.generation;
    delete live.tools;
    delete live.nestedTools;
}
/** Add the status of a compaction task created in this commit; statuses stay in task ID order. */
export function addCompactionStatus(live, status) {
    live.compactions ??= [];
    live.compactions.push(status);
}
/** The status of compaction task `taskId`, if listed. */
export function compactionStatus(live, taskId) {
    return live.compactions?.find((status) => status.taskId === taskId);
}
/** Remove the status of compaction task `taskId`, and the list once empty. */
export function removeCompactionStatus(live, taskId) {
    const statuses = live.compactions;
    if (statuses === undefined)
        return;
    const index = statuses.findIndex((status) => status.taskId === taskId);
    if (index >= 0)
        statuses.splice(index, 1);
    if (statuses.length === 0)
        delete live.compactions;
}
/** Remove the status of compaction task `taskId` and record that it failed with `error`. */
export function failCompactionStatus(live, taskId, error) {
    const status = compactionStatus(live, taskId);
    if (status !== undefined)
        live.compactionFailure = { taskId: status.taskId, trigger: status.trigger, error };
    removeCompactionStatus(live, taskId);
}
/**
 * The slot of tool task `taskId`, model-issued or nested, if `pi.live` still lists it. Nested slots are found by binary
 * search: a tool may make thousands of nested calls, each of which looks up its slot in several commits, and every
 * element a search reads costs a node in the draft's change tracker. Their task IDs ascend: each slot is appended in
 * the commit that creates its task, task IDs ascend in commit order, and removal keeps the order.
 */
export function toolSlot(live, taskId) {
    return live.tools?.find((each) => each.taskId === taskId) ?? nestedSlot(live, taskId);
}
/** The slot of tool task `taskId` with whose call it is, if `pi.live` still lists it (see `toolSlot`). */
export function findSlot(live, taskId) {
    const slot = live.tools?.find((each) => each.taskId === taskId);
    if (slot !== undefined)
        return { kind: "model", slot };
    const nested = nestedSlot(live, taskId);
    return nested === undefined ? undefined : { kind: "nested", slot: nested };
}
/** The nested slot of tool task `taskId`, by binary search over the ascending task IDs. */
function nestedSlot(live, taskId) {
    const nested = live.nestedTools;
    if (nested === undefined)
        return undefined;
    let low = 0;
    let high = nested.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const candidate = nested[middle];
        if (candidate.taskId === taskId)
            return candidate;
        if (candidate.taskId < taskId)
            low = middle + 1;
        else
            high = middle - 1;
    }
    return undefined;
}
/**
 * Mark a slot done and clear its running output; the caller sets a model-issued call's result `entry`, or a nested
 * call's `summary`. Neither is set when the task faulted or was orphaned.
 */
export function finishSlot(slot) {
    slot.status = "done";
    clearProgress(slot);
}
/** Remove the nested slots below tool task `taskId`, transitively; the list holds parents before their children. */
export function removeNestedSlots(live, taskId) {
    const nested = live.nestedTools;
    if (nested === undefined)
        return;
    const removed = new Set([taskId]);
    for (const slot of nested)
        if (removed.has(slot.parentTaskId))
            removed.add(slot.taskId);
    for (let index = nested.length - 1; index >= 0; index--) {
        if (removed.has(nested[index].parentTaskId))
            nested.splice(index, 1);
    }
    if (nested.length === 0)
        delete live.nestedTools;
}
/** Remove what a tool published while running; its result entry or a rerun replaces it. */
export function clearProgress(slot) {
    clearOutput(slot);
    delete slot.details;
    delete slot.diagnostics;
}
/** Remove a slot's running output only: a parked call, and its next run, keep its details and diagnostics. */
export function clearOutput(slot) {
    delete slot.output;
    delete slot.droppedBytes;
    delete slot.droppedLines;
}
/**
 * Harness cleanup for a terminal outcome the scheduler writes itself (`faulted` or `orphaned`). A run task ends its
 * run; a tool task's slot is marked done without an entry, and context derivation synthesizes the missing result; a
 * compaction task's status is removed and its failure recorded.
 * Ignores other kinds so it never creates `pi.live` elsewhere. The scheduler calls this without knowing task kinds;
 * the Harness passes it in (spec §5.4).
 * REMINDER: a committed generation partial becomes an aborted assistant entry here, exactly as in the generation abort
 * handler, so the transcript keeps what the model produced and `pi.usage` counts its spend. The scheduler's commit has
 * no task scope, so that entry has no `byTaskId`. Faults come from task bugs
 * or malformed provider data (a non-JSON value in a response), or a commit the Storage rejected without effect; an
 * uncertain storage failure poisons the Session instead and writes no outcome.
 */
export async function settleSchedulerOutcome(tx, record, outcome) {
    if (record.kind === TOOL_TASK_KIND) {
        const live = await tx.doc(LiveDoc, record.conversationId);
        const slot = toolSlot(live, record.id);
        if (slot !== undefined)
            finishSlot(slot);
        removeNestedSlots(live, record.id);
        return;
    }
    // Only an abort handler is faulted for the limit here (the built-in phases end themselves): the task was aborted,
    // and keeps that meaning. Its run ends `aborted`, with the limit as detail, and an aborted compaction is no failure.
    const detail = outcome.status === "faulted" ? outcome.error.detail : undefined;
    const cutOff = typeof detail === "object" && detail !== null && !Array.isArray(detail) && detail.reason === "restart_limit";
    if (record.kind === COMPACTION_TASK_KIND) {
        const live = await tx.doc(LiveDoc, record.conversationId);
        if (cutOff)
            removeCompactionStatus(live, record.id);
        else
            failCompactionStatus(live, record.id, outcome.status === "faulted" ? outcome.error.message : outcome.reason);
        return;
    }
    if (!RUN_TASK_KINDS.has(record.kind))
        return;
    const live = await tx.doc(LiveDoc, record.conversationId);
    if (live.run?.taskId !== record.id)
        return;
    // The run answered and waited for its `onYield` tasks: it ends with its answer, without a failure.
    const answered = live.run.yield?.answer;
    if (answered !== undefined)
        return endRun(tx, live, record.id, { status: "done", answer: answered });
    // Cut off, the abort handler may have died converting the partial: the run ends without it.
    if (!cutOff)
        await convertPartial(tx, live, record.conversationId);
    endRun(tx, live, record.id, outcome.status === "faulted"
        ? { status: "unanswered", reason: cutOff ? "aborted" : "faulted", detail: outcome.error.message }
        : {
            status: "unanswered",
            reason: "orphaned",
            detail: outcome.reason,
            settlement: { status: "unanswered", reason: outcome.reason },
        });
}
//# sourceMappingURL=live.js.map