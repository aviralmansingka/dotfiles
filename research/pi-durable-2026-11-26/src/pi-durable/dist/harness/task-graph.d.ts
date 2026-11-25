import { type Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import { type WatchHandle } from "@earendil-works/chord/watch";
import { type SessionImpl } from "../session/session.ts";
import type { ConversationId, JoinPolicy, Observation, Observer, TaskId, TaskOutcome } from "../types.ts";
import { type BlockedReason, type BlockedSubject } from "./scheduler.ts";
/** A live task's durable status without its checkpoint and outcome payloads (spec §9.4). */
export type TaskGraphState = {
    readonly status: "pending" | "running";
    readonly phase: string;
} | {
    readonly status: "waiting";
    readonly phase: string;
    readonly on: readonly TaskId[];
    readonly policy: JoinPolicy;
}
/** Asleep until the Harness clock reaches `until`, or one of `signals` holds a value no wake used. */
 | {
    readonly status: "sleeping";
    readonly phase: string;
    readonly until?: number;
    readonly signals?: readonly {
        readonly signal: string;
        readonly key: string;
    }[];
}
/** Outcome held until its ordinary owned work drains. */
 | {
    readonly status: "completing";
    readonly outcome: TaskOutcome<JsonValue>["status"];
};
export type TaskGraphNode = {
    readonly id: TaskId;
    readonly kind: string;
    readonly conversationId: ConversationId;
    /** Owner task; absent for a conversation-owned task. */
    readonly owner?: TaskId;
    readonly background: boolean;
    readonly abortRequested: boolean;
    readonly state: TaskGraphState;
    /**
     * Why it cannot run here, when it cannot: no registered definition takes it (`missing_task`, `task_too_old`,
     * `migration_failed`). Follows registry changes.
     */
    readonly blocked?: BlockedReason;
    /** Conversations this task owns, in ID order. */
    readonly conversations: readonly ConversationId[];
};
/** Every live task of the Session (spec §9.4). */
export type TaskGraph = {
    /** Every live task, keyed by its decimal ID. */
    readonly tasks: Readonly<Record<string, TaskGraphNode>>;
};
export type TaskGraphWatch = WatchHandle<TaskGraph>;
/** What the graph asks the scheduler: a task's blocked reason, and when reasons may change without a commit. */
export type TaskGraphBlocking = {
    readonly blocked: (record: BlockedSubject) => BlockedReason | undefined;
    readonly subscribeBlocked: (listener: () => void) => () => void;
};
/**
 * The Harness's task graph mount: built on the Session line by its first observer and dropped with its last. It
 * advances from the Session's commit publications, which are durable.
 */
export declare class TaskGraphView {
    #private;
    constructor(session: SessionImpl, blocking: TaskGraphBlocking);
    /**
     * Attach a synchronous observer of the graph (`Harness.observeTaskGraph()`), behind `guardObserver()`; `context`
     * governs only the attachment.
     */
    observe(observer: Observer<TaskGraph>, context: Context): Promise<Observation<TaskGraph>>;
    /** A serialized watch of the graph, an observer of its mount; aborting `context` ends it `aborted`. */
    watch(context: Context): Promise<TaskGraphWatch>;
}
//# sourceMappingURL=task-graph.d.ts.map