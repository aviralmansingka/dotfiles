import type { Draft } from "@earendil-works/chord/delta";
import type { JsonRepresentation, JsonValue } from "@earendil-works/chord/json";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { Transaction } from "../session/transaction.ts";
import type { CommitOptions, EntryId, JsonObject, SubmissionId, SubmissionSettlement, TaskId, TaskRecord, Tx } from "../types.ts";
import type { SchedulerOutcome } from "./scheduler.ts";
import type { CompactionReason, CompactionResult, ToolDiagnostic } from "./types.ts";
/** What a running tool call publishes, shared by model-issued and nested calls. */
type SlotProgress = {
    callId: string;
    name: string;
    /** `sleeping` or `waiting` while the call is parked (spec suspendable §4.2); a parked slot holds no output. */
    status: "pending" | "running" | "sleeping" | "waiting" | "done";
    /** Retained running output and what the bounds dropped. */
    output?: string;
    droppedBytes?: number;
    droppedLines?: number;
    /** Last `details()` value. */
    details?: JsonValue;
    /** Diagnostics recorded through `api.diagnostic()`. */
    diagnostics?: ToolDiagnostic[];
};
/** Presentation of one tool call of the current round. */
export type ToolSlot = SlotProgress & {
    /** Absent for a call not started yet (sequential round). */
    taskId?: TaskId;
    /** A call to a tool its request did not offer: its task settles `tool_unavailable` without running anything. */
    unoffered?: true;
    /** Result entry once done; absent when the tool task faulted or was orphaned. */
    entry?: EntryId;
};
/**
 * Presentation of one nested call: a call a running tool made through `executeTool()`. `callId` is
 * `<parentCallId>/<key>`, the call's ID, unique because keys contain no `/`. The Harness relates
 * slots by task ID: `taskId` is the call's tool task, `parentTaskId` the calling one, model-issued or nested.
 */
export type NestedToolSlot = SlotProgress & {
    parentCallId: string;
    parentTaskId: TaskId;
    taskId: TaskId;
    /**
     * What the call was made with, replaced by the arguments it runs with, after repair, `beforeTool`, and coercion,
     * once it starts executing. A model-issued call's arguments are in its assistant entry instead.
     */
    arguments: JsonObject;
    /** Once done: how the call ended, for a status line. The result itself is in the caller's `NestedCallDoc`. */
    summary?: NestedToolSummary;
};
/** How a nested call ended: an error flag, its execution time, its spend, and up to 500 characters of error text. */
export type NestedToolSummary = {
    isError: boolean;
    durationMs?: number;
    usage?: JsonRepresentation<Usage>;
    error?: string;
};
/** Presentation of one live compaction task (spec §8.7). */
export type CompactionStatus = {
    taskId: TaskId<CompactionResult>;
    /** What started it: `compact()`, a threshold, or a context overflow. */
    trigger: CompactionReason;
    /** Whether a generation waits for it: a compaction the generation owns. */
    blocking: boolean;
    attempt: number;
    /** Durable backoff before the next summarization attempt. */
    retry?: {
        at: number;
        error: string;
    };
};
/** The newest compaction that failed since a compaction last produced a summary (spec §8.7). */
export type CompactionFailure = {
    taskId: TaskId<CompactionResult>;
    /** What started the compaction that failed. */
    trigger: CompactionReason;
    /** The failed or faulted outcome's error message, or why the scheduler orphaned the task. */
    error: string;
};
/**
 * Why a run ended without an answer:
 * - `model_error`: the model's response failed, after any retries, or the compaction a request needed failed;
 * - `no_model`: no model is configured, or the configured one is not available;
 * - `aborted`: the run was aborted (`Conversation.abort()`, `abortTask()`); `detail` says when its abort handler was
 *   cut off `settings.restartLimit` times and did not finish;
 * - `reset`: a queued reset started a new context at the post-tools boundary, before an answer (a tool's handoff
 *   continues the run);
 * - `faulted`: the run's task threw where it cannot recover, or storage rejected its commit;
 * - `orphaned`: the run's task was aborted while no registered definition could take it;
 * - `interrupted`: the host stopped while the model was answering, more often than `settings.retry` retries;
 * - `restart_limit`: the run's generation was cut off `settings.restartLimit` times in a row; a request or poll it was
 *   cut off during counts as a failed attempt first, so this ends one whose charge itself keeps failing;
 * - `nothing_to_answer`: the context did not end in a user message or tool results (empty, or ending in an answer), so
 *   no request was sent, as for a continue after an answer;
 * - `turn_limit`: a tool round reached the conversation's `maxTurns`; a continue resumes on its results.
 */
export type RunFailureReason = "model_error" | "no_model" | "aborted" | "reset" | "faulted" | "orphaned" | "interrupted" | "restart_limit" | "nothing_to_answer" | "turn_limit";
/** The newest run that ended without an answer (spec §8.2). */
export type RunFailure = {
    /** The task that ended the run: the run's task at its end. */
    taskId: TaskId;
    /** The run's inputs, settled `unanswered`. */
    inputs: SubmissionId[];
    reason: RunFailureReason;
    /**
     * `model_error`: the error text; `no_model`: which model is missing; `faulted`: the error message; `orphaned`: why
     * the task could not run (`missing_task`, `task_too_old`, `migration_failed`); `interrupted` and `restart_limit`: what
     * was cut off, and how often; `turn_limit`: the tool rounds the run took, `"1 turn"` or `"N turns"`.
     */
    detail?: string;
    /** The failed run's `run.first`, so a continue's `afterRun` hooks see its history too. */
    first?: EntryId;
};
/** Run control (spec §8.2). */
export type LiveRun = {
    /** The task that settles the run's inputs: its generation, handed from one to the next. */
    taskId: TaskId;
    /** The run's placed inputs, settled when it ends; `[]` once it answered and runs only its `afterRun` tasks. */
    inputs: SubmissionId[];
    /** Tool rounds so far, which `AgentState.maxTurns` bounds; an `onYield` continuation starts the count over. */
    turns: number;
    /**
     * The run's first entry: the first one the boundary that started it placed, a continue's the failed run's it
     * continues; otherwise its first tool-calling answer. A run started before it was recorded may lack it; `afterRun`
     * hooks then get the answer as the first entry.
     */
    first?: EntryId;
    /**
     * Present once the run answered and its generation waits for the tasks `afterRun` hooks asked for, listed once
     * created: queued items stay queued until they are terminal, and the run then ends without a failure.
     */
    afterRun?: {
        tasks?: TaskId[];
    };
    /**
     * Present while tasks an `onYield` hook asked for decide whether the answer stands (spec suspendable §6): the
     * answer's entry, which the tasks read, and the tasks. The inputs stay open; every exit but a continuation settles
     * them `done` with this answer.
     */
    yield?: {
        answer: EntryId;
        tasks: TaskId[];
    };
};
/** Built-in live conversation state: run control and presentation of the current generation and tool round. */
export type LiveState = {
    /** Run control; present exactly while busy, also while a run that answered runs its `afterRun` tasks. */
    run?: LiveRun;
    /** Presentation of the current generation attempt. */
    generation?: {
        attempt: number;
        /** Committed throttled partial of the in-flight response. */
        message?: JsonRepresentation<AssistantMessage>;
        /** Durable backoff before the next attempt. */
        retry?: {
            at: number;
            error: string;
        };
        /** Provider-side deferred response being polled. */
        deferred?: {
            pollAt: number;
        };
    };
    /** The current tool round in call order, from the tool-calling answer until the generation's `tools` phase ends it. */
    tools?: ToolSlot[];
    /**
     * Nested calls of running tool calls, in creation order, so a parent precedes its children and task IDs ascend. A
     * call's nested slots are removed when the call settles.
     */
    nestedTools?: NestedToolSlot[];
    /** Live compaction tasks in task ID order; absent when none. */
    compactions?: CompactionStatus[];
    /**
     * The newest compaction failure, so a client can show it after the task ended. A compaction that produces a summary
     * removes it; one that is aborted or finds nothing to compact leaves it.
     */
    compactionFailure?: CompactionFailure;
    /**
     * Why the newest run ended without an answer, so a client can show it after the run ended. Set in the commit that
     * ends the run; removed when a later commit starts a run. A run started in the same commit, by
     * `afterFailedRun: "continue"` or after a reset, keeps it.
     */
    runFailure?: RunFailure;
};
export declare const LiveDoc: import("../types.ts").ConversationDocToken<LiveState>;
/**
 * How the progress throttles commit a partial answer and running tool output into `pi.live`: deferred, so storage gets
 * them together, at the next commit that reads or writes `pi.live` or after `settings.progress.persistWithinMs`. Every
 * commit that consumes or clears streamed fields reads `pi.live`, so it stores them with its own changes (spec §8.2).
 */
export declare const PROGRESS_COMMIT: CommitOptions;
/**
 * Built-in task kinds that end themselves once cut off `settings.restartLimit` times (`TaskRecord.restarts`); the
 * scheduler faults a task of any other kind instead (spec §5.4).
 */
export declare const LIMITS_RESTARTS: ReadonlySet<string>;
/** Whether `task` was cut off `settings.restartLimit` times in a row, so its phase ends it instead of running. */
export declare function cutOffTooOften(task: {
    readonly restarts?: number;
}, runtime: {
    readonly settings: {
        readonly restartLimit: number;
    };
}): boolean;
/**
 * Whether a task at the limit may still do the cleanup it does when it ends, such as converting a partial: only at the
 * limit. Past it, that cleanup may be what cut the task off, so the task ends without it.
 */
export declare function salvageable(task: {
    readonly restarts?: number;
}, runtime: {
    readonly settings: {
        readonly restartLimit: number;
    };
}): boolean;
/** How often a task was cut off, for a message: "once", or "3 times in a row". */
export declare function cutOffCount(task: {
    readonly restarts?: number;
}): string;
/** How a run ends: with an answer, or without one, settling its inputs `unanswered` and recording why. */
export type RunEnd = {
    readonly status: "done";
    readonly answer: EntryId;
} | {
    readonly status: "unanswered";
    readonly reason: RunFailureReason;
    readonly detail?: string;
    /** The inputs' settlement; default `unanswered` with `reason` and `detail`. */
    readonly settlement?: SubmissionSettlement;
};
/**
 * End the run owned by `taskId`: settle each of its inputs, remove `run`, and, without an answer, record
 * `runFailure`. A run that answered already, and runs only its `afterRun` tasks, records no failure, however it ends.
 * Always removes `generation`, `tools`, and `nestedTools`, whose presentation belongs to the ending run.
 */
export declare function endRun(tx: Tx, live: Draft<LiveState>, taskId: TaskId, end: RunEnd): void;
/** Add the status of a compaction task created in this commit; statuses stay in task ID order. */
export declare function addCompactionStatus(live: Draft<LiveState>, status: CompactionStatus): void;
/** The status of compaction task `taskId`, if listed. */
export declare function compactionStatus(live: Draft<LiveState>, taskId: TaskId): Draft<CompactionStatus> | undefined;
/** Remove the status of compaction task `taskId`, and the list once empty. */
export declare function removeCompactionStatus(live: Draft<LiveState>, taskId: TaskId): void;
/** Remove the status of compaction task `taskId` and record that it failed with `error`. */
export declare function failCompactionStatus(live: Draft<LiveState>, taskId: TaskId, error: string): void;
/**
 * The slot of tool task `taskId`, model-issued or nested, if `pi.live` still lists it. Nested slots are found by binary
 * search: a tool may make thousands of nested calls, each of which looks up its slot in several commits, and every
 * element a search reads costs a node in the draft's change tracker. Their task IDs ascend: each slot is appended in
 * the commit that creates its task, task IDs ascend in commit order, and removal keeps the order.
 */
export declare function toolSlot(live: Draft<LiveState>, taskId: TaskId): Draft<ToolSlot | NestedToolSlot> | undefined;
/** A tool task's slot in `pi.live`, told apart by whose call it is: a model-issued call's, or a nested call's. */
export type FoundSlot = {
    readonly kind: "model";
    readonly slot: Draft<ToolSlot>;
} | {
    readonly kind: "nested";
    readonly slot: Draft<NestedToolSlot>;
};
/** The slot of tool task `taskId` with whose call it is, if `pi.live` still lists it (see `toolSlot`). */
export declare function findSlot(live: Draft<LiveState>, taskId: TaskId): FoundSlot | undefined;
/**
 * Mark a slot done and clear its running output; the caller sets a model-issued call's result `entry`, or a nested
 * call's `summary`. Neither is set when the task faulted or was orphaned.
 */
export declare function finishSlot(slot: Draft<ToolSlot | NestedToolSlot>): void;
/** Remove the nested slots below tool task `taskId`, transitively; the list holds parents before their children. */
export declare function removeNestedSlots(live: Draft<LiveState>, taskId: TaskId): void;
/** Remove what a tool published while running; its result entry or a rerun replaces it. */
export declare function clearProgress(slot: Draft<SlotProgress>): void;
/** Remove a slot's running output only: a parked call, and its next run, keep its details and diagnostics. */
export declare function clearOutput(slot: Draft<SlotProgress>): void;
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
export declare function settleSchedulerOutcome(tx: Transaction, record: TaskRecord<JsonValue, JsonValue, JsonValue>, outcome: SchedulerOutcome): Promise<void>;
export {};
//# sourceMappingURL=live.d.ts.map