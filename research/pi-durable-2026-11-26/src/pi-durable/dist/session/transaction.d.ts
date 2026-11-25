import { type Context } from "@earendil-works/chord/context";
import { type Draft, type Op, type PendingOps, type Tracker } from "@earendil-works/chord/delta";
import { type JsonValue } from "@earendil-works/chord/json";
import { type AnyDocDefinition } from "../documents.ts";
import { type SignalResult, type SignalToken } from "../signals.ts";
import type { ConversationDocFamilyToken, ConversationDocToken, ConversationId, ConversationOwnership, ConversationQuery, ConversationRecord, Cursor, DocumentAddress, DocumentCommitChange, DocumentContent, DocumentId, DocumentRecord, Entry, EntryDraft, EntryId, EntryQuery, EntryRecord, JsonObject, Seq, SessionDocFamilyToken, SessionDocToken, Storage, StorageWrite, SubmissionCreate, SubmissionId, SubmissionRecord, SubmissionSettlement, Task, TaskDocFamilyToken, TaskDocToken, TaskId, TaskOptions, TaskQuery, TaskRecord, Tx, TypedEntry, TypedEntryDraft } from "../types.ts";
type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;
/** One committed document incarnation owned by the Session tracker cache. */
export type LoadedDocument = {
    readonly addressId: string;
    readonly record: DocumentRecord;
    /** Persisted definition version; older while the tracked value is migrated only in memory. */
    storedVersion: number;
    /** Definition version whose shape the tracked value has; access with another version reloads from Storage. */
    readonly valueVersion: number;
    /** Stored deltas after the newest base; advanced by adoption so the next predicate call needs no read. */
    deltasSinceBase: number;
    readonly tracker: Tracker<JsonObject>;
};
/**
 * The changes of a cached incarnation that deferred commits adopted in memory and the Session has not stored yet
 * (`CommitPersistence`), folded. The Session owns it; a commit that stores them takes them.
 */
export type HeldDocument = {
    readonly loaded: LoadedDocument;
    readonly pending: PendingOps;
    /** Set when a held commit selected a base (`checkpointWhen`): their store writes the whole value. */
    base: boolean;
};
/** What adoption publishes: to the Session's own observers, and the stored changes to `observeCommits()`. */
export type AdoptedDocuments = {
    /** This commit's own changes, as memory adopted them. */
    readonly observed: readonly DocumentCommitChange[];
    /** What Storage got: `observed`, unless the commit also stored held changes, which precede its own. */
    readonly stored: readonly DocumentCommitChange[];
};
/** Session services used by a transaction while it holds the mutation line. */
export interface TransactionHost {
    /** Reads wait while their key has an unpublished writer (`GatedStorage`). */
    readonly storage: Storage;
    /** Wait while `key` has an unpublished writer; `undefined` when it has none. */
    touch(key: string): Promise<void> | undefined;
    /** Wall clock for task lifecycle times. */
    now(): number;
    /** Return the cached current incarnation without loading. */
    cached(addressId: string): LoadedDocument | undefined;
    /** Return the cached current incarnation, cold-loading and migrating it when necessary. */
    load(definition: AnyDocDefinition, addressId: string, address: DocumentAddress, context: Context): Promise<LoadedDocument | undefined>;
    /** Install a newly committed incarnation. */
    install(document: LoadedDocument): void;
    /** Remove a retired incarnation if it is still the cached occupant of its address. */
    evict(addressId: string, recordId: DocumentId): void;
    /** Stage writes that belong to every newly created or forked conversation, in its creating transaction. */
    conversationCreated(tx: Transaction, record: ConversationRecord): Promise<void>;
    /** The newest entry ID visible from a conversation, known from the Session's commits. */
    latestEntryId(conversationId: ConversationId, context: Context): Promise<EntryId | undefined>;
    /**
     * The current documents of a live task when the Session knows all of them (it created the task), else `undefined`.
     */
    taskDocuments(taskId: TaskId): Iterable<DocumentRecord> | undefined;
    /** The newest visible head marker of a conversation, known from the Session's commits. */
    latestHeadMarker(conversationId: ConversationId, context: Context): Promise<(EntryRecord & {
        readonly head: EntryId;
    }) | undefined>;
}
/** Internal run creation resolves submission carriers against staged records before reading storage. */
export type TaskCreationOptions = TaskOptions & {
    readonly submissionIds?: readonly SubmissionId[];
};
/** Defaults a commit binds to: `tx.createTask()` conversation and the task attributed to appended entries. */
export type TransactionScope = {
    readonly conversationId?: ConversationId;
    /** Task whose runtime commit this is; stamped as `byTaskId` on appended entries. */
    readonly taskId?: TaskId;
};
/**
 * Transaction for one Session commit callback.
 *
 * Every asynchronous operation is tracked so callback settlement can reject and drain unfinished work. Session calls
 * one settlement method, then either discards prepared changes or adopts them once after Storage succeeds.
 */
export declare class Transaction implements Tx {
    #private;
    constructor(host: TransactionHost, context: Context, scope?: TransactionScope);
    /** Internal: the context of the commit this transaction belongs to. */
    get context(): Context;
    /** Internal: whether a table write was staged, after which table reads throw `ReadAfterWrite`. */
    get hasTableWrite(): boolean;
    /**
     * Internal: whether `tx` is a transaction of a commit of the Session behind `host`. A brand check, so a proxy or
     * another wrapper of a transaction is not one.
     */
    static ownedBy(tx: Tx, host: TransactionHost): tx is Transaction;
    conversation(id: ConversationId): Promise<ConversationRecord | undefined>;
    entry(id: EntryId): Promise<EntryRecord | undefined>;
    entry<D extends JsonValue>(token: Entry<D>, id: EntryId): Promise<TypedEntry<D> | undefined>;
    task(id: TaskId): Promise<AnyTaskRecord | undefined>;
    scanConversations(query: ConversationQuery, limit: number, cursor?: Cursor): Promise<import("../types.ts").Page<ConversationRecord, Readonly<Record<string, JsonValue>>>>;
    scanEntries(query: EntryQuery, limit: number, cursor?: Cursor): Promise<import("../types.ts").Page<EntryRecord, Readonly<Record<string, JsonValue>>>>;
    latestHeadMarker(conversationId: ConversationId): Promise<(EntryRecord & {
        readonly head: EntryId;
    }) | undefined>;
    latestEntryId(conversationId: ConversationId): Promise<EntryId | undefined>;
    scanTasks(query: TaskQuery, limit: number, cursor?: Cursor): Promise<import("../types.ts").Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Readonly<Record<string, JsonValue>>>>;
    /** Committed submission record. */
    submission(id: SubmissionId): Promise<SubmissionRecord | undefined>;
    /** Committed submission with a conversation-scoped request ID. */
    submissionByRequest(conversationId: ConversationId, requestId: string): Promise<SubmissionRecord | undefined>;
    createConversation(options: {
        readonly ownership: ConversationOwnership;
    }): Promise<ConversationRecord>;
    /** Internal final-form bootstrap path for the reserved root identity. */
    createRootConversation(): Promise<ConversationRecord>;
    forkConversation(parentConversationId: ConversationId, at: EntryId, options: {
        readonly ownership: ConversationOwnership;
    }): Promise<ConversationRecord>;
    appendEntry(conversationId: ConversationId, value: EntryDraft): Promise<EntryRecord>;
    appendEntry<D extends JsonValue>(token: Entry<D>, conversationId: ConversationId, value: TypedEntryDraft<NoInfer<D>>): Promise<TypedEntry<D>>;
    createTask<I, S extends {
        phase: string;
    }, R, H extends object>(task: Task<I, S, R, H>, input: I, options: TaskCreationOptions): Promise<TaskId<R>>;
    /** Create a raw submission record with a fresh ID; no admission rules apply. */
    createSubmission(create: SubmissionCreate): Promise<SubmissionRecord>;
    /**
     * Settle a submission. Resolved during assembly against the transaction's latest candidate record, falling back to
     * committed state, so it is not a caller table read and works after the first table write.
     */
    settleSubmission(id: SubmissionId, settlement: SubmissionSettlement): void;
    /** Place a queued submission at `entry`; resolved during assembly like `settleSubmission()`. */
    placeSubmission(id: SubmissionId, entry: EntryId): void;
    /** Deliver a signal to a task (spec suspendable §3.2): a read of the task, then a write of it when the key changes. */
    signal<T>(taskId: TaskId, token: SignalToken<T>, key: string, value: T): Promise<SignalResult>;
    /**
     * Internal: replace one task record. Tasks change their own state through their runtime. A live replacement keeps the
     * memos an earlier write of this transaction staged, so no write erases another.
     */
    setTask(value: AnyTaskRecord): void;
    /** Internal: candidate records of the tasks this transaction created or replaced so far. */
    stagedTasks(): AnyTaskRecord[];
    /** Internal: IDs of the tasks this transaction creates. */
    createdTaskIds(): TaskId[];
    /** Internal: conversations this transaction created or forked so far. */
    stagedConversations(): ConversationRecord[];
    doc<T extends JsonObject>(token: SessionDocToken<T>): Promise<Draft<T>>;
    doc<T extends JsonObject>(token: ConversationDocToken<T>, conversationId: ConversationId): Promise<Draft<T>>;
    doc<T extends JsonObject>(token: TaskDocToken<T>, taskId: TaskId): Promise<Draft<T>>;
    doc<T extends JsonObject, I extends JsonValue>(token: SessionDocFamilyToken<T, I>, key: string, seed: I): Promise<Draft<T>>;
    doc<T extends JsonObject, I extends JsonValue>(token: ConversationDocFamilyToken<T, I>, conversationId: ConversationId, key: string, seed: I): Promise<Draft<T>>;
    doc<T extends JsonObject, I extends JsonValue>(token: TaskDocFamilyToken<T, I>, taskId: TaskId, key: string, seed: I): Promise<Draft<T>>;
    retireDoc<T extends JsonObject>(token: SessionDocToken<T>): Promise<void>;
    retireDoc<T extends JsonObject>(token: ConversationDocToken<T>, conversationId: ConversationId): Promise<void>;
    retireDoc<T extends JsonObject>(token: TaskDocToken<T>, taskId: TaskId): Promise<void>;
    retireDoc<T extends JsonObject, I extends JsonValue>(token: SessionDocFamilyToken<T, I>, key: string): Promise<void>;
    retireDoc<T extends JsonObject, I extends JsonValue>(token: ConversationDocFamilyToken<T, I>, conversationId: ConversationId, key: string): Promise<void>;
    retireDoc<T extends JsonObject, I extends JsonValue>(token: TaskDocFamilyToken<T, I>, taskId: TaskId, key: string): Promise<void>;
    /** Seal after callback failure: abort every change and observe every pending operation. */
    settleFailure(): Promise<void>;
    /**
     * Seal after callback success, prepare every open change, and assemble the atomic batch.
     * Any failure aborts every change before Storage admission.
     */
    settleSuccess(): Promise<readonly StorageWrite[]>;
    /** Abort every prepared change after Storage failure or when no write is required. */
    discard(): void;
    /**
     * Internal: what a deferred commit holds in memory instead of storing (`CommitPersistence`), each changed incarnation
     * with its operations and whether they selected a base; `undefined` when the commit must be stored. It may be held
     * only when every write changes an existing `latest`, `initial`-fork conversation document at its stored version.
     */
    holdable(): {
        readonly loaded: LoadedDocument;
        readonly ops: readonly Op[];
        readonly base: boolean;
    }[] | undefined;
    /**
     * Internal: adopt a held commit (`holdable()`) in memory only. Trackers advance by pointer swap; stored versions and
     * delta counts stay, as nothing was stored. Returns its publication for the Session's own observers.
     */
    adoptHeld(): DocumentCommitChange[];
    /**
     * Internal: store the held changes of every incarnation this commit reads or writes in front of its own, so a stored
     * document never misses an operation its later ones build on. Called right before Storage admission, after every
     * fallible step, because it empties the holds: a failure earlier keeps them. Returns the holds it took.
     */
    takeHeld<H extends HeldDocument>(held: (id: DocumentId) => H | undefined): H[];
    /**
     * Internal: the keys this commit writes, once settled (and after `takeHeld()`), for the Session's unpublished write
     * set: its table records, and the address and incarnation of every document it creates, changes, or retires, with
     * the scope of every incarnation it creates or retires.
     */
    writeKeys(): string[];
    /** Adopt every prepared change by pointer swap after Storage success and describe the publication. */
    adopt(seq: Seq): AdoptedDocuments;
}
/**
 * Take a hold's changes after `ops`, a commit's own on top of them, as one stored content for an incarnation now at
 * `value`, and the operations a reader of the stored state applies to reach it: the folded ones, or a root replacement
 * after the queue overflowed, which stores a base, as does a hold whose commits selected one.
 */
export declare function storeHeld(hold: HeldDocument, ops: readonly Op[], value: JsonObject, version: number): {
    readonly content: DocumentContent;
    readonly ops: readonly Op[];
};
export {};
//# sourceMappingURL=transaction.d.ts.map