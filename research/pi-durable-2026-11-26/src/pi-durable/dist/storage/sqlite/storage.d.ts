import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import type { SqliteDatabase } from "@earendil-works/chord/sqlite";
import type { CommitResult, ConversationId, ConversationQuery, ConversationRecord, Cursor, DocumentAddress, DocumentId, DocumentPoint, DocumentQuery, DocumentRecord, EntryId, EntryQuery, EntryRecord, Id, Page, Seq, Storage, StorageWrite, StoredDocument, SubmissionId, SubmissionQuery, SubmissionRecord, TaskId, TaskQuery, TaskRecord } from "../../types.ts";
type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
export type SqliteStorageOptions = {
    /**
     * Prefix for every table and index in the durable schema. It must be a SQLite identifier and must not use
     * SQLite's reserved `sqlite_` prefix. Existing data is not migrated when this changes.
     */
    readonly prefix?: string;
};
/** Portable SQLite implementation of the Pico storage contract. */
export declare class SqliteStorage implements Storage {
    private readonly db;
    private readonly schema;
    private nextId;
    private closed;
    private closing;
    private admittedReads;
    private readsDrained;
    private constructor();
    /** Initialize storage over an owned SQLite database facade. */
    static open(db: SqliteDatabase, options?: SqliteStorageOptions): Promise<SqliteStorage>;
    /**
     * Commit `batches` in one SQL transaction, each with its own seq. Each batch is checked before it writes anything,
     * against the state the earlier ones left, and the first one refused ends the batch: the transaction commits the ones
     * before it. No savepoints, which Durable Objects do not allow: the checks run before the writes instead. The checks
     * read the stored state of all batches up front and run in memory, and the accepted batches are written per table in
     * multi-row statements (`commit.ts`), so a call costs a few statements whatever its number of batches. A batch with a
     * copy reads the copy's source from the database: the batches before it are written first, so a call of many fork
     * batches costs a few statements per fork.
     */
    commit(batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, _context: Context): Promise<CommitResult>;
    private readMetadata;
    private writeMetadata;
    /**
     * Durable's own checks of one batch, against what the batches before it left: its document actions, or its refusal.
     * Only these checks refuse; a failure of a database call rejects. A copy reads its source from the database, so the
     * batches before it are written first.
     */
    private checkBatch;
    mintId<I extends Id<string>>(): Promise<I>;
    conversation(id: ConversationId, _context: Context): Promise<ConversationRecord | undefined>;
    scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<ConversationRecord, Cursor>>;
    entry(id: EntryId, context: Context): Promise<{
        readonly entry: EntryRecord;
        readonly commitSeq: Seq;
    } | undefined>;
    entry(conversationId: ConversationId, id: EntryId, context: Context): Promise<{
        readonly entry: EntryRecord;
        readonly commitSeq: Seq;
    } | undefined>;
    findLatestHeadMarker(conversationId: ConversationId, atOrBeforeEntryId: EntryId | undefined, _context: Context): Promise<(EntryRecord & {
        readonly head: EntryId;
    }) | undefined>;
    scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<EntryRecord, Cursor>>;
    private readEntry;
    private readLatestHeadMarker;
    private readEntries;
    /** Oldest first: the fork chain's segments from the root conversation forward, each up to its fork point. */
    private readEntriesAscending;
    task(id: TaskId, _context: Context): Promise<StoredTask | undefined>;
    scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<StoredTask, Cursor>>;
    submission(id: SubmissionId, _context: Context): Promise<SubmissionRecord | undefined>;
    scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<SubmissionRecord, Cursor>>;
    submissionByRequest(conversationId: ConversationId, requestId: string, _context: Context): Promise<SubmissionRecord | undefined>;
    findDocument(address: DocumentAddress, at: DocumentPoint, _context: Context): Promise<DocumentRecord | undefined>;
    document(id: DocumentId, at: DocumentPoint, _context: Context): Promise<StoredDocument | undefined>;
    scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<DocumentRecord, Cursor>>;
    close(_context: Context): Promise<void>;
    private closeDatabase;
    /**
     * Run a read that issues several queries. Close waits for admitted reads, so their later queries never reach a
     * closed database. Single-query reads and transactions are already ordered before close by the database.
     */
    private admitRead;
    private readConversation;
    private materializeDocument;
    private candidateNextId;
    /** Resolve each copy to a base of its source's state before this batch, which may not change the source. */
    private resolveCopies;
    private assertOpen;
}
export {};
//# sourceMappingURL=storage.d.ts.map