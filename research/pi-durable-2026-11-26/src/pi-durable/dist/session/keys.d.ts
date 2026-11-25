import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import type { CommitResult, ConversationId, ConversationQuery, ConversationRecord, Cursor, DocumentAddress, DocumentId, DocumentPoint, DocumentQuery, DocumentRecord, EntryId, EntryQuery, EntryRecord, Id, Page, Seq, Storage, StorageWrite, StoredDocument, SubmissionId, SubmissionQuery, SubmissionRecord, TaskId, TaskQuery, TaskRecord } from "../types.ts";
type StoredEntry = {
    readonly entry: EntryRecord;
    readonly commitSeq: Seq;
};
/** A task record. */
export declare function taskKey(id: TaskId): string;
/** A conversation record. */
export declare function conversationKey(id: ConversationId): string;
/** An entry record. */
export declare function entryKey(id: EntryId): string;
/** The newest entries of a conversation: appended blind, read by scans, the newest entry, and head markers. */
export declare function appendKey(id: ConversationId): string;
/** A submission record. */
export declare function submissionKey(id: SubmissionId): string;
/** The submission a conversation's request ID names. */
export declare function requestKey(conversationId: ConversationId, requestId: string): string;
/** A document address (`addressId()`): its current incarnation, value, and held changes. */
export declare function documentKey(addressId: string): string;
/** A document incarnation, for reads by its ID. */
export declare function incarnationKey(id: DocumentId): string;
/** The incarnations alive in a scope: created and retired blind, read by scans and the task-document index. */
export declare function scopeKey(scope: DocumentRecord["scope"]): string;
/**
 * A node of the scheduler's ownership tree (a task ID, or `c<conversation ID>`): the live work listed below it. Written
 * by task creation and a task becoming terminal for every node from the task's parent up to and including the nearest
 * live task or the root conversation; read by every walk that expands the node.
 */
export declare function ownedKey(node: TaskId | string): string;
/** The ownerless conversations with live work below them, which global idle walks from. */
export declare const ROOTS_KEY = "roots";
/** The live tasks with cancellation intent: abort marks, and held outcomes other than `completed`. */
export declare const INTENT_KEY = "intent";
/** Every unpublished write: what a read that cannot be keyed, such as a scan, touches. */
export declare const ALL_KEYS = "*";
/** The keys of the table records in `writes`; document writes are keyed by the transaction, which knows addresses. */
export declare function tableKeys(writes: readonly StorageWrite[], keys: string[]): void;
/**
 * The Storage a job on the line reads through: every read first touches its key (`touch`), which waits while the key
 * has an unpublished writer, so the read sees what the line admitted before it. Scans that cannot be keyed touch
 * `ALL_KEYS`. Commits and `close()` pass through; the line never commits through it.
 */
export declare class GatedStorage implements Storage {
    #private;
    constructor(storage: Storage, touch: (key: string) => Promise<void> | undefined);
    commit(batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, context: Context): Promise<CommitResult>;
    mintId<I extends Id<string>>(): Promise<I>;
    conversation(id: ConversationId, context: Context): Promise<ConversationRecord | undefined>;
    scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<ConversationRecord, Cursor>>;
    entry(id: EntryId, context: Context): Promise<StoredEntry | undefined>;
    entry(conversationId: ConversationId, id: EntryId, context: Context): Promise<StoredEntry | undefined>;
    findLatestHeadMarker(conversationId: ConversationId, atOrBeforeEntryId: EntryId | undefined, context: Context): Promise<(EntryRecord & {
        readonly head: EntryId;
    }) | undefined>;
    scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<EntryRecord, Cursor>>;
    task(id: TaskId, context: Context): Promise<TaskRecord<JsonValue, JsonValue, JsonValue> | undefined>;
    scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Cursor>>;
    submission(id: SubmissionId, context: Context): Promise<SubmissionRecord | undefined>;
    scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<SubmissionRecord, Cursor>>;
    submissionByRequest(conversationId: ConversationId, requestId: string, context: Context): Promise<SubmissionRecord | undefined>;
    findDocument(address: DocumentAddress, at: DocumentPoint, context: Context): Promise<DocumentRecord | undefined>;
    document(id: DocumentId, at: DocumentPoint, context: Context): Promise<StoredDocument | undefined>;
    scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<Page<DocumentRecord, Cursor>>;
    close(context: Context): Promise<void>;
}
export {};
//# sourceMappingURL=keys.d.ts.map