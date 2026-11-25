import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import type { CommitResult, ConversationId, ConversationQuery, ConversationRecord, Cursor, DocumentAddress, DocumentId, DocumentPoint, DocumentQuery, DocumentRecord, EntryId, EntryQuery, EntryRecord, Id, Page, Seq, Storage, StorageWrite, StoredDocument, SubmissionId, SubmissionQuery, SubmissionRecord, TaskId, TaskQuery, TaskRecord } from "../types.ts";
type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;
type StoredEntry = {
    readonly entry: EntryRecord;
    readonly commitSeq: Seq;
};
/**
 * Storage that serves hot record reads from memory: conversations, tasks, and written submissions, each table bounded
 * by a count, the least recently used record leaving first, except live tasks, which are kept until they end, and the
 * ended tasks a task waits on, kept until it moved on from its wait: a task's record is read again at each of its state
 * changes, a waiter reads the outcomes of what it waited on once it resumes (`runtime.outcomes()`), and both are
 * bounded by live work, which the scheduler keeps in memory too. Without that, a burst of more tasks than the count
 * would make each of those reads a Storage read on the line. Every commit goes through it, and one process owns a
 * Storage, so it applies each batch as it is published and never goes stale: `commit()`'s batches when the Session publishes
 * them (`published()`), not at their durability receipts. A read
 * result is kept only when no commit published since the read started wrote its record, as the read may not observe
 * that commit; versions are kept only for records with a read in flight. Cached values are frozen and shared. Entries,
 * scans, and documents pass through: the Session keeps documents and the newest entry per conversation itself, and
 * context ranges hold the entries a run reads.
 *
 * Not for a read-only Session: another process writes its Storage.
 */
export declare class CachedStorage implements Storage {
    #private;
    constructor(storage: Storage);
    /** The backend's own scope for a publication (`Storage.publishing`), when it has one. */
    get publishing(): Storage["publishing"];
    /** Pass the batches through; the Session applies each one with `published()` when it publishes it. */
    commit(batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, context: Context): Promise<CommitResult>;
    /**
     * Apply a batch `commit()` stored, when the Session publishes it. Its records are frozen in place and kept as
     * they are, no copies: the Session's components that follow the publication, such as the scheduler's live tasks,
     * hold the same objects, so a live task's record is in memory once.
     */
    published(writes: readonly StorageWrite[]): void;
    mintId<I extends Id<string>>(): Promise<I>;
    conversation(id: ConversationId, context: Context): Promise<ConversationRecord | undefined>;
    scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<ConversationRecord, Cursor>>;
    entry(id: EntryId, context: Context): Promise<StoredEntry | undefined>;
    entry(conversationId: ConversationId, id: EntryId, context: Context): Promise<StoredEntry | undefined>;
    findLatestHeadMarker(conversationId: ConversationId, atOrBeforeEntryId: EntryId | undefined, context: Context): Promise<(EntryRecord & {
        readonly head: EntryId;
    }) | undefined>;
    scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<EntryRecord, Cursor>>;
    task(id: TaskId, context: Context): Promise<AnyTaskRecord | undefined>;
    scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<AnyTaskRecord, Cursor>>;
    /** Cached as written only: this process writes every submission it settles, and a read one is usually settled. */
    submission(id: SubmissionId, context: Context): Promise<SubmissionRecord | undefined>;
    scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<SubmissionRecord, Cursor>>;
    submissionByRequest(conversationId: ConversationId, requestId: string, context: Context): Promise<SubmissionRecord | undefined>;
    findDocument(address: DocumentAddress, at: DocumentPoint, context: Context): Promise<DocumentRecord | undefined>;
    document(id: DocumentId, at: DocumentPoint, context: Context): Promise<StoredDocument | undefined>;
    scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<DocumentRecord, Cursor>>;
    close(context: Context): Promise<void>;
    /** Records kept per table, for tests that bound memory. */
    get sizes(): {
        readonly conversations: number;
        readonly tasks: number;
        readonly liveTasks: number;
        readonly awaited: number;
        readonly waits: number;
        readonly submissions: number;
    };
    /** Records with a read in flight, for tests that bound memory. */
    get readsInFlight(): number;
}
/** `storage`'s publication scope (`Storage.publishing`), for a wrapper to expose as its own; none when it has none. */
export declare function scopeOf(storage: Storage): Storage["publishing"];
export {};
//# sourceMappingURL=cached-storage.d.ts.map