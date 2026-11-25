import { type Draft } from "@earendil-works/chord/delta";
import type { JsonRepresentation } from "@earendil-works/chord/json";
import type { AssistantMessage, AssistantMessageEvent, ToolCall } from "@earendil-works/pi-ai";
import { type JsonChange } from "@earendil-works/pi-ai/utils/streaming-json";
import { type AssignPlan } from "./json.ts";
import type { LiveState } from "./live.ts";
/** A partial message as `pi.live.generation.message` holds it. */
export type PartialMessage = JsonRepresentation<AssistantMessage>;
/** Committed arguments of a streamed tool call. */
type Arguments = JsonRepresentation<ToolCall>["arguments"];
/** What one partial commit writes besides the partial message itself; from `PartialChanges.take()`. */
export type PartialCommit = {
    /** The plan `assignJson()` writes the message with: text appends, and the arguments it leaves to `changes`. */
    readonly plan: AssignPlan;
    /** Each tracked tool call by content index: its argument changes since the last commit, in order, and its snapshot. */
    readonly toolCalls: ReadonlyMap<number, {
        readonly changes: readonly JsonChange[];
        readonly snapshot: Arguments;
    }>;
};
/**
 * Collects, from a response's events, what changed in its partial message since the last commit, so the commit appends
 * new text instead of reassigning growing strings. Reassigning makes Chord compare the old and new string, which costs
 * O(length) per commit.
 *
 * - Text and thinking: the `text_delta` and `thinking_delta` events. The commit appends them where the committed string
 *   plus the deltas has the new string's length, and compares otherwise. A block's `*_end` event drops them, because
 *   providers may replace the text when a block ends.
 * - Tool-call arguments: a `StreamingJsonParser` per call, fed with the raw argument text of each `toolcall_delta`,
 *   reports what each piece changed. The commit applies those changes to the committed arguments in order and leaves
 *   the arguments out of the message assignment, so the committed arguments are exactly the parsed text so far.
 *   `toolcall_end` ends the tracking; the call's last commit assigns its final arguments.
 */
export declare class PartialChanges {
    #private;
    /** Record what `event` changed. */
    observe(event: AssistantMessageEvent): void;
    /**
     * Take what changed since the last call, for a commit of `message`, a copy of the partial. Clears the arguments of
     * tracked tool calls in `message`: the commit writes them from the changes. Call `restore()` if the commit fails.
     */
    take(message: PartialMessage): PartialCommit;
    /**
     * Write `message` with what `commit` took into `generation.message`: the message leaf by leaf with the plan, then the
     * argument changes. A tracked call whose block is new here gets its arguments from its changes, which then start at
     * its first piece; when the committed message lost a call whose changes were already committed (another writer reset
     * it), the call falls back to its snapshot from now on.
     */
    commit(generation: Draft<NonNullable<LiveState["generation"]>>, message: PartialMessage, commit: PartialCommit): void;
    /** Put back what a failed commit took, so the next commit applies it first. */
    restore(commit: PartialCommit): void;
}
export {};
//# sourceMappingURL=partial-changes.d.ts.map