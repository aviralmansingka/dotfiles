import type { Draft } from "@earendil-works/chord/delta";
import type { DeferredHandle, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ConversationId, EntryId, SubmissionId, Task, TaskId, Tx } from "../types.ts";
import { type LiveState } from "./live.ts";
import { type ToolTaskResult } from "./tool.ts";
import type { CompactionResult, ConversationStreamOptions, GenerationHooks, ModelRef, RunSummary } from "./types.ts";
export type GenerationInput = Record<string, never>;
export type GenerationCheckpoint = {
    phase: "prepare";
    attempt: number;
    /** The blocking compaction this generation waited for; it starts no other compaction (spec §8.3). */
    compacted?: TaskId<CompactionResult>;
    /** Error text of the overflow that started `compacted`; checked once when `prepare` resumes. */
    overflow?: string;
    /** Set when the blocking threshold started `compacted`; its outcome is checked once when `prepare` resumes. */
    threshold?: true;
} | {
    phase: "request";
    attempt: number;
    compacted?: TaskId<CompactionResult>;
    model: ModelRef;
    thinkingLevel: ModelThinkingLevel;
    /** The settings' request options when preparation committed; a resend after recovery uses them unchanged. */
    streamOptions: ConversationStreamOptions;
    /** Newest entry included in the request. */
    cutoff: EntryId;
} | {
    phase: "retry";
    attempt: number;
    compacted?: TaskId<CompactionResult>;
    until: number;
    /**
     * The deferred response a poll was fetching when the host died: the next attempt polls it again instead of
     * sending another request, so the provider's job is neither lost nor paid twice. Absent otherwise.
     */
    poll?: {
        model: ModelRef;
        thinkingLevel?: ModelThinkingLevel;
        cutoff: EntryId;
        handle: DeferredHandle;
    };
} | {
    phase: "poll";
    attempt: number;
    compacted?: TaskId<CompactionResult>;
    model: ModelRef;
    /** Absent in checkpoints of earlier versions. */
    thinkingLevel?: ModelThinkingLevel;
    cutoff: EntryId;
    handle: DeferredHandle;
    pollAt: number;
} | {
    /** Waiting on the round's tool tasks, which the generation owns (spec §8.5). */
    phase: "tools";
    /** The tool-calling answer. */
    assistant: EntryId;
    /** Tool tasks created so far, in call order; grows by one per started call of a sequential round. */
    tools: TaskId<ToolTaskResult>[];
    /** Calls of a sequential round not started yet, in call order. */
    pending: string[];
} | {
    /**
     * The run answered: its answer is committed and its inputs settled, and it keeps `pi.live.run` while `afterRun`
     * hooks are asked for tasks (spec §8.3). A crash here asks them again: nothing was created yet.
     */
    phase: "finish";
    run: RunSummary;
} | {
    /** Waiting on the tasks `afterRun` hooks asked for, which the generation owns; then the run ends. */
    phase: "drain";
    answer: EntryId;
    tasks: TaskId[];
} | {
    /**
     * The round is complete and waits on the tasks `afterTools` hooks asked for, which the generation owns; then it
     * ends as the `tools` phase ends it (spec suspendable §6). A crash before they exist asks the hooks again.
     */
    phase: "afterTools";
    assistant: EntryId;
    tools: TaskId<ToolTaskResult>[];
    tasks: TaskId[];
} | {
    /**
     * The answer is appended, and the run's inputs stay open while the tasks an `onYield` hook asked for, which the
     * generation owns, decide whether it stands (`LiveRun.yield`).
     */
    phase: "yield";
    answer: EntryId;
    tasks: TaskId[];
};
export type GenerationResult = {
    entryId: EntryId;
};
/**
 * Built-in generation task: prepares the positional system prompt and tool loadout, requests or polls the model,
 * retries, and classifies the response. The run's inputs live in `pi.live.run`.
 */
export declare const GenerationTask: Task<GenerationInput, GenerationCheckpoint, GenerationResult, GenerationHooks>;
/**
 * Append a committed partial left by an interrupted, aborted, faulted, or orphaned attempt as an aborted assistant
 * entry; the caller replaces or removes `generation`.
 */
export declare function convertPartial(tx: Tx, live: Draft<LiveState>, conversationId: ConversationId): Promise<void>;
/**
 * Start a run for `inputs`, placed input submissions, whose first entry is `first` (`LiveRun.first`): a new generation
 * takes `pi.live.run`. Removes `runFailure`, unless `keepFailure`: a run started in the commit that ended the failed one
 * keeps its failure.
 */
export declare function startRun(tx: Tx, conversationId: ConversationId, live: Draft<LiveState>, run: {
    readonly inputs: SubmissionId[];
    readonly first: EntryId | undefined;
}, options?: {
    readonly keepFailure?: boolean;
}): Promise<void>;
/** Hand run control from `from` to `to`; the run's inputs move with it. */
export declare function handOver(live: Draft<LiveState>, from: TaskId, to: TaskId): void;
//# sourceMappingURL=generation.d.ts.map