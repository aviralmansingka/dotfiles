import { type JsonRepresentation, type JsonValue } from "@earendil-works/chord/json";
import type { ToolCall } from "@earendil-works/pi-ai";
import type { ConversationId, EntryId, JsonObject, Task, TaskId, TaskRecord, Tx, TypedEntry, WakeReason } from "../types.ts";
import type { NestedToolExecutionResult, ToolControl, ToolDiagnostic, ToolExecutionResult, ToolHooks } from "./types.ts";
/**
 * A model-issued call, read from its assistant entry, or a nested call a running tool made through `executeTool()`,
 * whose call the input carries because no entry holds it.
 */
export type ToolTaskInput = {
    kind: "model";
    assistant: EntryId;
    callId: string;
    /** A call to a tool its request did not offer: settles `tool_unavailable` without resolving the name. */
    unoffered?: true;
} | {
    kind: "nested";
    parent: TaskId;
    parentCallId: string;
    key: string;
    call: ToolCall;
    /** `false`: commit no running output, details, or diagnostics to the slot; the result still gets them. */
    progress?: false;
};
export type ToolTaskCheckpoint = {
    phase: "call";
}
/**
 * Durable intent: the final arguments and the replay policy recorded before execution, and for a run after a park,
 * why it woke and what it parked with. `execute()` runs in the phase that commits it; this phase is reached only by
 * recovery.
 */
 | {
    phase: "execute";
    arguments: JsonObject;
    replay: "safe" | "unsafe";
    wake?: WakeReason;
    checkpoint?: JsonValue;
}
/** The call is parked: the `sleeping` or `waiting` state holds this checkpoint (spec suspendable §4.2). */
 | {
    phase: "parked";
    arguments: JsonObject;
    replay: "safe" | "unsafe";
    checkpoint?: JsonValue;
};
/**
 * A model-issued call's result is its transcript entry; a nested call's result is in its caller's
 * `NestedCallDoc`, so the receipt stays small and the result retires with the caller. A version 1 task that was
 * already holding its outcome as `completing` when the Harness upgraded finishes with a version 1 result,
 * `{ entryId, control? }` without `kind`; treat a result without `kind` as a model-issued call's.
 */
export type ToolTaskResult = {
    kind: "model";
    entryId: EntryId;
    control?: ToolControl;
} | {
    kind: "nested";
};
/**
 * One key of a running tool: a nested call, its task and once it ended its result, or a task created under the key
 * (`createTask()` with `key`). A member without `kind`, written before keyed tasks, is a nested call's.
 */
export type NestedCallState = {
    kind?: "nested" | "task";
    /** Absent only inside the commit that creates the member; a creation that fails leaves no member. */
    taskId?: TaskId;
    /** Exactly what `executeTool()` returns; absent while running, and for a call the scheduler faulted or orphaned. */
    result?: JsonRepresentation<NestedToolExecutionResult>;
};
/**
 * The nested calls of a tool call, a task-scoped family of the calling task keyed by the nested call's key: so a rerun
 * finds the calls it already made, and the caller reads each result. Created with the nested task; the nested call's
 * terminal commit adds its result. One document per call, so no commit rewrites the others. Retires with the caller.
 */
export declare const NestedCallDoc: import("../types.ts").TaskDocFamilyToken<NestedCallState, null>;
/**
 * Built-in tool task: resolves the called tool among its phase agent's tools, validates, runs `beforeTool`, records intent,
 * executes, runs `afterTool`, and settles the result, all in one `call` handler so nothing separates resolution from
 * settlement. A call that parks runs again in `parked`, which resolves the tool, records intent, and executes in one
 * handler too. `execute` is reached only by recovery and applies the replay rule. A model-issued call settles by
 * appending its result entry; a nested call by writing its result to its caller's `NestedCallDoc`.
 */
export declare const ToolTask: Task<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult, ToolHooks>;
/**
 * Whether a sleeping task is a tool call parked at its gates, before its intent (spec suspendable §5.2): the registry,
 * and every open, wake it, so the gates installed then decide.
 */
export declare function gatedCall(record: TaskRecord<JsonValue, JsonValue, JsonValue>): boolean;
/**
 * Whether a task's `abandonOnRestart` children survive a restart (spec suspendable §2.5): it is a tool call that was
 * not cut off while running, parked or not started yet, whatever its status.
 */
export declare function keepsChildren(record: TaskRecord<JsonValue, JsonValue, JsonValue>): boolean;
/** An error result the Harness writes itself: no content and one `error` diagnostic with `code`. */
export declare function harnessError(code: string, message: string): ToolExecutionResult;
/**
 * Append a `pi.tool-result` entry. The content ends with the rendered diagnostics, so the stored message is exactly
 * what the model sees; `data` keeps the structured list. A result's usage is added to `pi.usage` in the same commit.
 */
export declare function appendToolResult(tx: Tx, conversationId: ConversationId, call: ToolCall, result: ToolExecutionResult, meta: {
    readonly timestamp: number;
    readonly durationMs?: number;
}): Promise<TypedEntry<{
    diagnostics: ToolDiagnostic[];
}>>;
//# sourceMappingURL=tool.d.ts.map