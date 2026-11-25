import { type Store } from "@earendil-works/chord";
import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import type { CommitResult, ConversationId, ConversationQuery, ConversationRecord, Cursor, DocumentAddress, DocumentId, DocumentPoint, DocumentQuery, DocumentRecord, EntryId, EntryQuery, EntryRecord, Id, Page, Seq, Storage, StorageWrite, StoredDocument, SubmissionId, SubmissionQuery, SubmissionRecord, TaskId, TaskQuery, TaskRecord } from "../../types.ts";
type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
type StoredEntry = {
    readonly entry: EntryRecord;
    readonly commitSeq: Seq;
};
/**
 * Durable's `Storage` on Chord's store (slice 6b D1, D2, §2): its records as declared tables under an owner name, its
 * documents in the store's documents engine, its ids from the store's one allocator, each commit call as one series
 * of the store's commit queue (one backend transaction, one seq per batch), published in the host's batch. Several may share a store under distinct owner names
 * (claims); the app owns the store, and `close` leaves it open.
 */
export declare class StoreStorage implements Storage {
    #private;
    private constructor();
    /**
     * Opens Durable's storage in `store` under `owner` (a lowercase `[a-z0-9@/._~-]` name): claims its tables and its
     * document namespaces (a second claim is refused `invalid/args`), creates or migrates its tables, and raises the
     * store's allocator above every id it holds (one index read). A failure releases what it claimed.
     */
    static open(store: Store, owner: string, context: Context): Promise<StoreStorage>;
    /**
     * Commit `batches` as one series of the store (`ChordStore.commitSeries`): one backend transaction, one seq per
     * batch, each batch's checks (at staging, then against the state the earlier ones left) before its writes.
     */
    commit(batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, context: Context): Promise<CommitResult>;
    /**
     * Run a commit's publication in the attached host's batch (`batch.within`: it joins a running batch, opens one, or
     * runs next while one sends): Chord sources over Durable's views are marked in one batch per commit. Plainly without
     * a host.
     */
    publishing(publish: () => void, context: Context): void;
    mintId<I extends Id<string>>(): Promise<I>;
    conversation(id: ConversationId, context: Context): Promise<ConversationRecord | undefined>;
    scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<ConversationRecord, Cursor>>;
    entry(id: EntryId, context: Context): Promise<StoredEntry | undefined>;
    entry(conversationId: ConversationId, id: EntryId, context: Context): Promise<StoredEntry | undefined>;
    findLatestHeadMarker(conversationId: ConversationId, atOrBeforeEntryId: EntryId | undefined, context: Context): Promise<(EntryRecord & {
        readonly head: EntryId;
    }) | undefined>;
    scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<EntryRecord, Cursor>>;
    task(id: TaskId, context: Context): Promise<StoredTask | undefined>;
    scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<StoredTask, Cursor>>;
    submission(id: SubmissionId, context: Context): Promise<SubmissionRecord | undefined>;
    scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<SubmissionRecord, Cursor>>;
    submissionByRequest(conversationId: ConversationId, requestId: string, context: Context): Promise<SubmissionRecord | undefined>;
    findDocument(address: DocumentAddress, at: DocumentPoint, context: Context): Promise<DocumentRecord | undefined>;
    document(id: DocumentId, at: DocumentPoint, context: Context): Promise<StoredDocument | undefined>;
    scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<DocumentRecord, Cursor>>;
    /**
     * Refuses new calls, waits for its commits underway, then releases its claims; the store stays open (the app's),
     * and finishes the reads underway, which change nothing.
     */
    close(_context: Context): Promise<void>;
}
export {};
//# sourceMappingURL=storage.d.ts.map