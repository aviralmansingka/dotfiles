import { type Context } from "@earendil-works/chord/context";
import { type WatchCall, type WatchEnd, type WatchHandle } from "@earendil-works/chord/watch";
import { type SessionImpl } from "../session/session.ts";
import type { ConversationId, ConversationRecord, EntryId, EntryRecord, JsonObject, Observation, Observer } from "../types.ts";
/** Structural view of one conversation: a window over its transcript and its built-in documents (spec §9.3). */
export type ConversationView = {
    readonly conversation: ConversationRecord;
    /**
     * A window over the transcript, its fork-aware history (`Conversation.entries()`), in entry ID order. Head markers
     * such as compaction summaries sit where they were written; their `head` tells where the entries they summarize end.
     */
    readonly entries: readonly EntryRecord[];
    /** ID of the entry just before the window; absent when the window starts the transcript. */
    readonly before?: EntryId;
    /** Built-in conversation documents keyed by kind; absent documents are absent. */
    readonly docs: Readonly<Record<string, JsonObject>>;
};
/**
 * Which entries a view's window holds (spec §9.3). The window holds between `min` and `max` entries: it starts with
 * the newest `min` entries, takes appends, and once it would hold more than `max`, drops its oldest in one splice down
 * to `min`. With `from`, it starts at `from` instead when at most `max` entries are at or after it.
 */
export type ConversationWindow = {
    /**
     * Where the first value's window starts, inclusive, such as right after the newest entry a client has
     * (`ConversationTranscript.resume`). It selects only that first value: every entry committed after the attachment is
     * appended, whatever its ID. A `from` past the newest entry starts the window empty, with `before` the newest entry.
     */
    readonly from?: EntryId;
    /** Default 50; an integer, at least 1. */
    readonly min?: number;
    /** Default `2 * min`; an integer, at least `min`. */
    readonly max?: number;
};
/** Receives each next revision of one observer's window, and the Session's close. */
export type ViewObserver = {
    advance(call: WatchCall<ConversationView>, context: Context): void;
    /** The Session closed (`ended`), or failed (`failed`). */
    end(end: WatchEnd): void;
};
/** The view mounts of a Harness, for adapters built on them. */
export declare function conversationViews(harness: object): ConversationViews;
/**
 * The Harness's conversation view mounts: at most one per conversation, built on the Session line by its first
 * observer and dropped with its last. Each mount advances from the Session's commits as memory adopts them, deferred ones
 * (`CommitPersistence`) before they are stored, and hands each observer the next revision of its own window.
 */
export declare class ConversationViews {
    #private;
    constructor(session: SessionImpl);
    /** Report an observer's listener error through the Harness. */
    report(error: unknown): void;
    /**
     * Attach a synchronous observer of the view (`Harness.observeConversation()`), behind `guardObserver()`; `context`
     * governs only the attachment.
     */
    observe(id: ConversationId, observer: Observer<ConversationView>, context: Context, window?: ConversationWindow): Promise<Observation<ConversationView>>;
    /** A serialized watch of the view, an observer of its mount; aborting `context` ends it `aborted`. */
    watch(id: ConversationId, context: Context, window?: ConversationWindow): Promise<WatchHandle<ConversationView>>;
    /**
     * Register an observer created from its window's first revision, atomically on the Session line: it sees every later
     * publication and nothing earlier. `release` drops it, and the mount with its last observer.
     */
    attach<O extends ViewObserver>(id: ConversationId, window: ConversationWindow | undefined, create: (value: ConversationView, release: () => void) => O, context: Context): Promise<{
        observer: O;
        detach: () => void;
    }>;
}
//# sourceMappingURL=view.d.ts.map