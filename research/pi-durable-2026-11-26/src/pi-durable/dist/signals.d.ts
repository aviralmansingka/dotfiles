import { type JsonValue } from "@earendil-works/chord/json";
import { type Static } from "@earendil-works/pi-schema";
import type { SettledSubmissionRecord } from "./harness/types.ts";
import type { SubmissionRecord, TaskRecord, TaskState, WakeReason } from "./types.ts";
/** The key of one wait for a signal: JSON, used in sleeps and parks. `T` is a phantom type. */
export type SignalKey<T> = {
    readonly signal: string;
    readonly key: string;
    readonly "~value"?: T;
};
/** A signal kind, built by `defineSignal()`: values of type `T` delivered under keys. */
export interface SignalToken<T> {
    readonly name: string;
    readonly version: number;
    /** The key of one wait; throws for an empty key. */
    key(key: string): SignalKey<T>;
}
/** What `defineSignal()` takes. */
export type SignalDefinition<S extends object> = {
    /** Unique like a task or document kind; must not contain "/". */
    readonly name: string;
    /** Positive integer version of the value shape. */
    readonly version: number;
    /** A pi-schema schema of a JSON value; the value type is `Static<S>`. */
    readonly schema: S;
    /** A value stored by an older version, to the current shape. */
    readonly migrate?: (value: JsonValue, fromVersion: number) => Static<S>;
};
/** A key's state: the value delivered under it, or expired because its sleep's deadline came first. */
export type SignalState<T> = {
    readonly kind: "value";
    readonly value: T;
} | {
    readonly kind: "expired";
};
/**
 * What a delivery did: `delivered` (durably accepted, not necessarily consumed), `duplicate` (the key holds a value),
 * `invalid` (not JSON, or not matching the schema), `closed` (the task ended, holds its outcome, is abort-marked, or the
 * key expired), `not_found` (no such task).
 */
export type SignalResult = "delivered" | "duplicate" | "invalid" | "closed" | "not_found";
type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;
type Memos = Readonly<Record<string, JsonValue>>;
type Sleeping = Extract<TaskState<JsonValue, JsonValue>, {
    readonly status: "sleeping";
}>;
/** Define a signal kind. Throws for a name with "/", a version that is not a positive integer, or a non-JSON schema. */
export declare function defineSignal<S extends object>(definition: SignalDefinition<S>): SignalToken<Static<S>>;
/**
 * Built in: delivered to `SubmissionDraft.notify` when the submission settles, in the settling commit. Its value is the
 * settled record, what `Submission.wait()` resolves to; its schema checks each variant's required fields, so another
 * delivery cannot take the key with something else.
 */
export declare const SubmissionSettled: SignalToken<({
    readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
    readonly id: import("./types.ts").SubmissionId;
    readonly conversationId: import("./types.ts").ConversationId;
    readonly requestId?: string;
    readonly notify?: import("./types.ts").SubmissionNotify;
} & {
    readonly type: "input";
} & {
    readonly status: "done";
    readonly entry: import("./types.ts").EntryId;
    readonly answer: import("./types.ts").EntryId;
    readonly reason?: never;
    readonly detail?: never;
} & {
    readonly status: "done" | "unanswered";
}) | ({
    readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
    readonly id: import("./types.ts").SubmissionId;
    readonly conversationId: import("./types.ts").ConversationId;
    readonly requestId?: string;
    readonly notify?: import("./types.ts").SubmissionNotify;
} & {
    readonly type: "input";
} & {
    readonly status: "unanswered";
    readonly entry?: import("./types.ts").EntryId;
    readonly answer?: never;
    readonly reason: string;
    readonly detail?: JsonValue;
} & {
    readonly status: "done" | "unanswered";
}) | ({
    readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
    readonly id: import("./types.ts").SubmissionId;
    readonly conversationId: import("./types.ts").ConversationId;
    readonly requestId?: string;
    readonly notify?: import("./types.ts").SubmissionNotify;
} & {
    readonly type: "write";
} & {
    readonly status: "done";
    readonly entry: import("./types.ts").EntryId;
    readonly answer?: never;
    readonly reason?: never;
    readonly detail?: never;
} & {
    readonly status: "done" | "unanswered";
}) | ({
    readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
    readonly id: import("./types.ts").SubmissionId;
    readonly conversationId: import("./types.ts").ConversationId;
    readonly requestId?: string;
    readonly notify?: import("./types.ts").SubmissionNotify;
} & {
    readonly type: "write";
} & {
    readonly status: "unanswered";
    readonly entry?: never;
    readonly answer?: never;
    readonly reason: string;
    readonly detail?: JsonValue;
} & {
    readonly status: "done" | "unanswered";
}) | ({
    readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
    readonly id: import("./types.ts").SubmissionId;
    readonly conversationId: import("./types.ts").ConversationId;
    readonly requestId?: string;
    readonly notify?: import("./types.ts").SubmissionNotify;
} & {
    readonly type: "continue";
} & {
    readonly status: "done";
    readonly entry?: never;
    readonly answer: import("./types.ts").EntryId;
    readonly reason?: never;
    readonly detail?: never;
} & {
    readonly status: "done" | "unanswered";
}) | ({
    readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
    readonly id: import("./types.ts").SubmissionId;
    readonly conversationId: import("./types.ts").ConversationId;
    readonly requestId?: string;
    readonly notify?: import("./types.ts").SubmissionNotify;
} & {
    readonly type: "continue";
} & {
    readonly status: "unanswered";
    readonly entry?: never;
    readonly answer?: never;
    readonly reason: string;
    readonly detail?: JsonValue;
} & {
    readonly status: "done" | "unanswered";
})>;
/** Whether a submission settled: answered (`done`) or not (`unanswered`). */
export declare function isSettled(record: SubmissionRecord): record is SettledSubmissionRecord;
/**
 * Decide a delivery to `record` (spec suspendable §3.2): the result, and the record to write when it changes, with the
 * value stored, or the key marked expired when the task sleeps on it past its deadline.
 */
export declare function deliverSignal<T>(record: AnyTaskRecord | undefined, token: SignalToken<T>, key: string, value: T, now: number): {
    readonly result: SignalResult;
    readonly record?: AnyTaskRecord;
};
/**
 * A key's state in `memos`, the value migrated to the token's version; undefined while nothing came. Throws for a stored
 * version newer than the token's, a missing or throwing `migrate`, or a migrated value the schema rejects.
 */
export declare function readSignal<T>(memos: Memos | undefined, token: SignalToken<T>, key: string): SignalState<T> | undefined;
/** Throws unless a sleep waits for something (`until` or a non-empty `signals`) and none of its keys served a wait. */
export declare function checkSleep(state: Sleeping, memos: Memos | undefined, task: number): void;
/** Whether a sleep can wake now: a listed key holds a value no wake used, or its deadline came. */
export declare function sleepDue(state: Sleeping, memos: Memos | undefined, now: number): boolean;
/**
 * The wake of a sleep that can wake now, and the memos the waking reservation writes: the first listed key holding a
 * value no wake used, marked consumed; otherwise the deadline, with every listed key that holds nothing marked expired.
 * Undefined when the sleep cannot wake yet.
 */
export declare function sleepWake(state: Sleeping, memos: Memos | undefined, now: number): {
    readonly wake: WakeReason;
    readonly memos: Memos;
} | undefined;
export {};
//# sourceMappingURL=signals.d.ts.map