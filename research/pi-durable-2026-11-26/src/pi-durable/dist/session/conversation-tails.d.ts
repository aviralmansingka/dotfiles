import type { ConversationId, EntryId, EntryRecord, StorageWrite } from "../types.ts";
/** An entry that carries a `head`: the marker of a context range. */
export type HeadMarker = EntryRecord & {
    readonly head: EntryId;
};
/**
 * The newest entry ID and newest head marker per conversation, for the Session that owns its Storage: every entry is
 * written by one of its commits, so `apply` keeps both current, and a value read from Storage stays valid until the
 * next entry of that conversation. Read only on the Session line after touching the conversation's appends, so no
 * commit that appends to it is unpublished and a value read from Storage can be kept. The newest entry visible from a conversation is its own newest, or for a fork without entries
 * of its own the parent's entry at the fork point: IDs grow, so a conversation's own new entry is always the newest.
 * Each map is bounded by a count, the least recently used conversation leaving first. Kept markers are frozen: entry
 * records are immutable (`Tx.appendEntry()`).
 */
export declare class ConversationTails {
    #private;
    /** The newest entry ID visible from `conversationId`, read with `read` when not known. */
    latest(conversationId: ConversationId, read: () => Promise<EntryId | undefined>): Promise<EntryId | undefined>;
    /**
     * The newest visible head marker at or before `atOrBefore` (any when `undefined`), read with `read` when not known.
     * The newest marker answers every cutoff at or after it, and no marker answers every cutoff.
     */
    marker(conversationId: ConversationId, atOrBefore: EntryId | undefined, read: () => Promise<HeadMarker | undefined>): Promise<HeadMarker | undefined>;
    /** The newest entry ID of `conversationId` if known, without reading: `null` for none, `undefined` when unknown. */
    peek(conversationId: ConversationId): EntryId | null | undefined;
    /** At a commit's publication: apply a durable batch. */
    apply(writes: readonly StorageWrite[]): void;
    /** How many conversations have their newest entry kept, for tests that bound memory. */
    get size(): number;
    /** How many conversations have their newest head marker kept, for tests that bound memory. */
    get markers(): number;
}
//# sourceMappingURL=conversation-tails.d.ts.map