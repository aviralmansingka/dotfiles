import type { Context } from "@earendil-works/chord/context";
import type { Cursor, EntryId, EntryQuery, EntryRecord, Page } from "../types.ts";
import type { ConversationView, ConversationWindow } from "./view.ts";
/** One row of a client's transcript. */
export type TranscriptItem = {
    readonly kind: "entry";
    readonly entry: EntryRecord;
}
/** Entries strictly between `after` and `upTo` are missing: render "load more" and call `fillGap()`. */
 | {
    readonly kind: "gap";
    readonly after: EntryId;
    readonly upTo: EntryId;
}
/** The transcript continues above: render "load earlier" and call `loadEarlier()`. Always the first item. */
 | {
    readonly kind: "earlier";
};
/** The conversation view as a renderer sees it: `items`, the client's whole transcript, instead of the window. */
export type TranscriptView = Omit<ConversationView, "entries" | "before"> & {
    readonly items: readonly TranscriptItem[];
};
/** Pages a conversation's entries, as `Conversation.entries()` does without a cursor. */
export type EntryLoader = (query: Omit<EntryQuery, "conversationId">, limit: number, context: Context) => Promise<Page<EntryRecord, Cursor>>;
export type ConversationTranscriptOptions = {
    /** Entries `loadEarlier()` and `fillGap()` load per call; default 50. */
    readonly pageSize?: number;
};
type Gap = Extract<TranscriptItem, {
    kind: "gap";
}>;
/**
 * What a client has of one conversation: every entry it got from a view or fetched, and the gaps between (spec §9.3).
 * A layer over any `ConversationView`, wherever it comes from: call `merge()` with every value of the view; it returns
 * the view with the client's whole transcript as `items` instead of the window. Entries never change once committed,
 * so the transcript only grows; a window that dropped its oldest entries keeps them here.
 *
 * A window whose `before` lies past the newest entry the client has does not continue it, after a stall, an overflow,
 * or a reconnect: the entries in between become a gap. Nothing counts entries or computes ranges from entry IDs, which
 * have holes; only exclusive bounds are turned into the inclusive bounds of `EntryQuery`. After a drop, a new watch
 * with `resume` as its window continues the transcript.
 *
 * A merge costs O(items) and never re-sorts or re-fetches; a merge, `loadEarlier()`, or `fillGap()` that adds nothing
 * returns the previous `items` array. Concurrent calls of `loadEarlier()`, or of `fillGap()` for the same gap, share one
 * load, so a placeholder that stays visible does not fetch twice.
 */
export declare class ConversationTranscript {
    #private;
    constructor(load: EntryLoader, options?: ConversationTranscriptOptions);
    /**
     * The ID the transcript reaches: its newest entry, or the `before` of a later window that was empty. Undefined before
     * the first merge and for an empty transcript.
     */
    get newest(): EntryId | undefined;
    /**
     * The window that resumes this transcript after a drop: `{ from }` right after `newest`, so a new watch returns only
     * what was missed when it fits its window, otherwise its newest entries and a gap; `{}` for an empty transcript;
     * undefined before the first merge. `conversation.watch(context, transcript.resume)`.
     */
    get resume(): ConversationWindow | undefined;
    /** Take one value of the view: its window's entries join the transcript. */
    merge(view: ConversationView): TranscriptView;
    /** Load the page before the oldest entry held. Without anything earlier, returns the current view. */
    loadEarlier(context: Context): Promise<TranscriptView>;
    /**
     * Load the next page of `gap`, a gap item of `items`, shrinking it from its start, or removing it once nothing is
     * missing. A gap that has shrunk since loads the gap it became; one that is no longer there returns the current view.
     */
    fillGap(gap: Gap, context: Context): Promise<TranscriptView>;
}
export {};
//# sourceMappingURL=transcript.d.ts.map