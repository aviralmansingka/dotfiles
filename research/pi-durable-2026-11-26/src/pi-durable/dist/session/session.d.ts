import { type Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import { type WatchEnd } from "@earendil-works/chord/watch";
import type { CommitChange, CommitObservation, CommitObserver, CommitOptions, ConversationDocFamilyToken, ConversationDocToken, ConversationId, ConversationRecord, DocumentCommitChange, DocumentRecord, DocumentWatch, EntryId, JsonObject, Observation, Observer, ReportInfo, RewindableConversationDocFamilyToken, RewindableConversationDocToken, Seq, Session, SessionDocFamilyToken, SessionDocToken, SessionEnd, SetTimer, Storage, StorageWrite, TaskDocFamilyToken, TaskDocToken, TaskId, Tx } from "../types.ts";
import { type HeadMarker } from "./conversation-tails.ts";
import { Transaction, type TransactionScope } from "./transaction.ts";
/**
 * What the Session's own components observe of one commit (`followCommits()`): a stored commit with its own changes, or
 * a deferred one adopted in memory only (`CommitPersistence`), which changes documents only. Memory is never behind:
 * a later store of held changes is not observed again.
 */
export type ObservedCommit = {
    readonly kind: "stored";
    readonly seq: Seq;
    readonly changes: readonly CommitChange[];
} | {
    readonly kind: "memory";
    readonly changes: readonly DocumentCommitChange[];
};
/**
 * Open a Session kernel over one storage backend. `now` is the wall clock for task times; default `Date.now`.
 * `setTimer` arms the timers that evict idle documents; default `setTimeout` (see `HarnessOptions.setTimer`). The first
 * error a Storage method throws fails the Session (`SessionFailed`); see `SessionImpl`.
 */
export declare function createSession(storage: Storage, options?: {
    readonly now?: () => number;
    readonly documentRetentionMs?: number;
    readonly setTimer?: SetTimer;
    /** Default `withinMs` of a deferred commit (`CommitPersistence`); default 1,000. */
    readonly persistWithinMs?: number;
}): Session;
/** Internal, for tests: the retention of every Session that keeps the default, as a suite run with eviction at once. */
export declare function setDefaultDocumentRetention(ms: number): void;
/**
 * A retention as given, when it is a number of milliseconds, `0` or more (`Infinity` keeps documents); otherwise the
 * default.
 */
export declare function documentRetention(ms: number | undefined): number;
/**
 * A deferred commit's default window as given, when it is a number of milliseconds, `0` or more (`Infinity` waits for a
 * reading or writing commit or close); otherwise the default.
 */
export declare function persistWithin(ms: number | undefined): number;
/**
 * Session kernel: one mutation line, the loaded document tracker cache, and committed publication.
 *
 * The cache is bounded by use: a document with no watch attached leaves it once it was not read or
 * written for the retention period, and the next access loads it from Storage. Eviction runs as a job on the mutation
 * line, so no transaction ever holds a tracker that leaves.
 *
 * Only committed state is observable. A deferred commit (`CommitPersistence`) is committed in memory first: it is
 * adopted and shown to the Session's own observers, and its changes wait, folded per document and pinned in the cache,
 * for the first commit that reads or writes the document, the document's deadline, a drop of its tracker, or close,
 * which store them.
 *
 * Group commit: the line runs one job at a time, a commit's callback and settlement; a commit with writes then joins
 * the writer's pending batch (logical admission, `Writer`) and the line goes on. The writer stores every commit admitted
 * while no call is in flight in one `commit()` call, off the line, and publishes them one by one, in line order, a
 * macrotask apart: the read caches, adoption, telemetry events, the Session's own observers, and one microtask later
 * `observeCommits()` observers, before every wait the commit resolves and every abort it queues. Host listeners and
 * watch listeners have no order. A deferred commit is published when the commits before it are. A job's every read
 * touches its key (`touch()`); while an unpublished commit writes that key, the job waits for its publication, so no
 * job observes state that is not stored. Outcomes are delivered in line order (`#enqueue()`).
 *
 * Storage failures are final. Every Storage call goes through one guard: the first error a Storage method throws, other
 * than for a cancelled caller, fails the Session, as does a commit it cannot adopt. That call gets the error; every later
 * call and every Storage call still underway gets `SessionFailed`; close listeners run at once with the error, and the
 * Session then closes itself, Storage included, and `closed` settles. Nothing retries: transient errors are the
 * Storage's to retry. Reopening recovers from what was committed.
 */
export declare class SessionImpl implements Session {
    #private;
    get closed(): Promise<SessionEnd>;
    /** Internal: the error that failed the Session, if one did. */
    get failure(): {
        readonly error: unknown;
    } | undefined;
    /** Internal: rejects with `SessionFailed` the moment the Session fails, before work underway has ended; never resolves. */
    get failed(): Promise<never>;
    constructor(storage: Storage, now?: () => number, documentRetentionMs?: () => number | undefined, setTimer?: SetTimer, readOnly?: boolean, persistWithinMs?: () => number | undefined);
    /** The Storage behind the failure guard; every component reads and writes through it. */
    protected get storage(): Storage;
    /**
     * Internal, on the Session line: the newest entry ID visible from `conversationId`. Known from the Session's own
     * commits when it owns its Storage, so it costs no Storage read after the first.
     */
    latestEntryId(conversationId: ConversationId, context: Context): Promise<EntryId | undefined>;
    /**
     * Internal: the newest entry ID of `conversationId` as known from the Session's commits right now, without reading;
     * `undefined` when not known (and always for a read-only Session).
     */
    knownLatestEntryId(conversationId: ConversationId): EntryId | null | undefined;
    /**
     * Internal, on the Session line: the newest visible head marker of `conversationId` at or before `atOrBefore`, any
     * when `undefined`; known from the Session's own commits as `latestEntryId()` is.
     */
    latestHeadMarker(conversationId: ConversationId, atOrBefore: EntryId | undefined, context: Context): Promise<HeadMarker | undefined>;
    /**
     * Internal, on the line: wait, while `key` has an unpublished writer (for `ALL_KEYS`, while anything is unpublished),
     * until it is published, then check that the Session is healthy; `undefined` when there is nothing to wait for. A
     * job's every read touches its key first, so it never observes state an earlier job admitted and the writer has not
     * published.
     */
    touch(key: string): Promise<void> | undefined;
    commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context, options?: CommitOptions): Promise<T>;
    /**
     * Internal: fail the Session with `error`, the first wins, and report it once. Admission ends, and close listeners run
     * now; they read the error from `failure`. The Storage guard calls this; the Harness also calls it for a throw in its
     * scheduler's own commits. `at` is the line index of the job whose outcome the failure is, by default the job on the
     * line: later jobs' outcomes become `SessionFailed`.
     */
    fail(error: unknown, context?: Context, at?: number, own?: readonly number[]): void;
    /**
     * Internal commit exposing the concrete transaction and its internal operations, such as the reserved-ID root
     * bootstrap and task replacement. `scope` sets the default `tx.createTask()` conversation and the task attributed to
     * appended entries.
     */
    commitWith<T>(change: (tx: Transaction) => T | Promise<T>, context: Context, scope?: TransactionScope, options?: CommitOptions): Promise<T>;
    /**
     * Internal: `commitWith()` for a commit of the scheduler's own whose outcome goes only to scheduler code. When it
     * writes nothing and waited at no gate, it is equivalent to having run before every unpublished commit, so its
     * outcome is delivered at once, ahead of theirs. One that writes is never exempt: its outcome waits for its own
     * publication and every earlier outcome, so no invocation starts on a reservation that is not durable.
     */
    commitInternal<T>(change: (tx: Transaction) => T | Promise<T>, context: Context): Promise<T>;
    /**
     * Internal, on the line: call `end` once the outcome of the job on the line settles, its commit published or never to
     * be; at once off the line.
     */
    onJobEnd(end: () => void): void;
    /** Internal: the Storage jobs on the line read through (`touch()`); off the line, use the plain one. */
    get lineStorage(): Storage;
    /** Internal: whether `tx` is the transaction of one of this Session's commits. */
    ownsTransaction(tx: Tx): tx is Transaction;
    /**
     * Internal: run a read-only job on the mutation line so multi-read derivations observe one committed state. It reads
     * through `storage`, whose reads wait for the publication of what the line admitted before; its outcome comes after
     * theirs.
     */
    readOnLine<T>(job: (storage: Storage) => Promise<T>): Promise<T>;
    /**
     * Internal: a conversation document's current incarnation and value, for a job already running on the line (see
     * `readOnLine()`). Absent documents are `undefined`.
     */
    conversationDocumentOnLine(token: ConversationDocToken<JsonObject>, conversationId: ConversationId, context: Context): Promise<{
        readonly record: DocumentRecord;
        readonly version: number;
        readonly value: JsonObject;
    } | undefined>;
    snapshot<T extends JsonObject>(token: SessionDocToken<T>, context: Context): Promise<Readonly<T> | undefined>;
    snapshot<T extends JsonObject>(token: ConversationDocToken<T>, conversationId: ConversationId, context: Context): Promise<Readonly<T> | undefined>;
    snapshot<T extends JsonObject>(token: TaskDocToken<T>, taskId: TaskId, context: Context): Promise<Readonly<T> | undefined>;
    snapshot<T extends JsonObject, I extends JsonValue>(token: SessionDocFamilyToken<T, I>, key: string, context: Context): Promise<Readonly<T> | undefined>;
    snapshot<T extends JsonObject, I extends JsonValue>(token: ConversationDocFamilyToken<T, I>, conversationId: ConversationId, key: string, context: Context): Promise<Readonly<T> | undefined>;
    snapshot<T extends JsonObject, I extends JsonValue>(token: TaskDocFamilyToken<T, I>, taskId: TaskId, key: string, context: Context): Promise<Readonly<T> | undefined>;
    watchDoc<T extends JsonObject>(token: SessionDocToken<T>, context: Context): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends JsonObject>(token: ConversationDocToken<T>, conversationId: ConversationId, context: Context): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends JsonObject>(token: TaskDocToken<T>, taskId: TaskId, context: Context): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends JsonObject, I extends JsonValue>(token: SessionDocFamilyToken<T, I>, key: string, context: Context): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends JsonObject, I extends JsonValue>(token: ConversationDocFamilyToken<T, I>, conversationId: ConversationId, key: string, context: Context): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends JsonObject, I extends JsonValue>(token: TaskDocFamilyToken<T, I>, taskId: TaskId, key: string, context: Context): Promise<DocumentWatch<T> | undefined>;
    observeDoc<T extends JsonObject>(token: SessionDocToken<T>, observer: Observer<Readonly<T>>, context: Context): Promise<Observation<Readonly<T>> | undefined>;
    observeDoc<T extends JsonObject>(token: ConversationDocToken<T>, conversationId: ConversationId, observer: Observer<Readonly<T>>, context: Context): Promise<Observation<Readonly<T>> | undefined>;
    observeDoc<T extends JsonObject>(token: TaskDocToken<T>, taskId: TaskId, observer: Observer<Readonly<T>>, context: Context): Promise<Observation<Readonly<T>> | undefined>;
    observeDoc<T extends JsonObject, I extends JsonValue>(token: SessionDocFamilyToken<T, I>, key: string, observer: Observer<Readonly<T>>, context: Context): Promise<Observation<Readonly<T>> | undefined>;
    observeDoc<T extends JsonObject, I extends JsonValue>(token: ConversationDocFamilyToken<T, I>, conversationId: ConversationId, key: string, observer: Observer<Readonly<T>>, context: Context): Promise<Observation<Readonly<T>> | undefined>;
    observeDoc<T extends JsonObject, I extends JsonValue>(token: TaskDocFamilyToken<T, I>, taskId: TaskId, key: string, observer: Observer<Readonly<T>>, context: Context): Promise<Observation<Readonly<T>> | undefined>;
    snapshotAsOf<T extends JsonObject>(token: RewindableConversationDocToken<T>, conversationId: ConversationId, at: EntryId, context: Context): Promise<Readonly<T> | undefined>;
    snapshotAsOf<T extends JsonObject, I extends JsonValue>(token: RewindableConversationDocFamilyToken<T, I>, conversationId: ConversationId, key: string, at: EntryId, context: Context): Promise<Readonly<T> | undefined>;
    close(context: Context): Promise<void>;
    /**
     * Internal: the Session's failure, and errors of listeners, which never fail what ran them; `info` defaults to a
     * listener. A plain Session drops them.
     */
    report(_error: unknown, _info?: ReportInfo, _context?: Context): void;
    /**
     * Runs inside every transaction that creates or forks a conversation, after the conversation record is staged. A
     * plain Session stages nothing; a Harness stages its built-in documents.
     */
    protected conversationCreated(_tx: Transaction, _record: ConversationRecord): Promise<void>;
    /**
     * Internal, for `beforeClose()`: on the line, after every commit admitted before the seal has settled, write what
     * `writes()` returns then straight to Storage. Nothing is published, since the Session is closing; a failed Session
     * writes nothing.
     */
    protected writeAtClose(writes: () => readonly StorageWrite[]): Promise<void>;
    /**
     * Keys a commit writes besides its records' (`Transaction.writeKeys()`), at its admission, on the line: a Harness
     * adds the ownership memberships its task changes write. A plain Session adds none.
     */
    protected membershipKeys(_tx: Transaction): readonly string[] | Promise<readonly string[]>;
    /** Runs after close seals admission and before the line closes Storage; must not reject. */
    protected beforeClose(): Promise<void>;
    /**
     * Attach a synchronous observer of every stored commit, with exactly what it stored (`CommitPublication`). Its
     * `advance` runs one microtask after the commit's publication, which follows its storage call, in line order, before
     * every wait the commit resolves and every abort it queues (in no order with watch listeners); it must not block or
     * call Session operations. A throw is reported, detaches it, and ends it `listener_error`; `end` gets the Session's
     * close after its last publication.
     */
    observeCommits(observer: CommitObserver): CommitObservation;
    /**
     * Internal: follow every commit as memory adopts it (`ObservedCommit`), for the Session's own components, whose state
     * follows memory. A throw leaves that state behind, so it fails the Session instead of being reported. They run at
     * the commit's publication, synchronously, so they call no Storage method, run no task code, and contain every host
     * callback; the waits they resolve and the aborts they queue run after host observers.
     */
    followCommits(listener: (publication: ObservedCommit, context: Context) => void): () => void;
    /**
     * Register a listener called synchronously when close begins, also when a failure closes the Session (`failure` is
     * then set). It must not block or call Session operations; a throw is reported.
     */
    subscribeClose(listener: () => void): () => void;
    /** Drop every loaded tracker on the mutation line, held changes stored first; later access cold-loads from Storage. */
    unloadDocuments(): Promise<void>;
    /**
     * Internal, for tests: how many documents the cache holds, how many are idle, how many incarnations are pinned, how
     * many sweep jobs were queued on the line so far, how many documents have held changes, how many live tasks have
     * their documents indexed, and how many conversations have their newest entry kept.
     */
    get documentCacheSizes(): {
        readonly cached: number;
        readonly idle: number;
        readonly attached: number;
        readonly sweeps: number;
        readonly held: number;
        readonly taskDocuments: number;
        readonly tails: number;
    };
    /**
     * Internal, for tests that bound memory: jobs whose outcome is not delivered yet, keys with an unpublished writer,
     * and record reads in flight in the cache. All three are 0 once the line is idle.
     */
    get lineSizes(): {
        readonly outstanding: number;
        readonly unpublished: number;
        readonly reads: number;
    };
    /** Internal: throw `SessionFailed` when failed, else an error when closing. */
    assertUsable(): void;
}
/**
 * Run a host callback that must not fail its caller: a throw, or a promise it returns that rejects, goes to `onError`,
 * which is not awaited.
 */
export declare function contained(callback: () => unknown, onError: (error: unknown) => void): void;
/** A synchronous observer as Durable attaches it: `Observer` (`advance` gets a `WatchCall`) or `CommitObserver`. */
type SyncObserver<A> = {
    advance(call: A, context: Context): void;
    end(end: WatchEnd): void;
};
/** A guarded observer (`guardObserver()`) with its observation's detach. */
export type GuardedObserver<A> = SyncObserver<A> & {
    detach(): void;
};
/**
 * `observer`, a host's, behind the rule for observers that run at a commit's publication: one that throws, or whose
 * `advance` returns a promise that rejects, is reported through `report`, detached, and ended `listener_error`, so the
 * throw never reaches `adopt`; nothing reaches it after its detach or end, and from then on the guard references
 * neither it nor its source. `detach` is the source's; the returned `detach()` is the observation's.
 */
export declare function guardObserver<A>(observer: SyncObserver<A>, detach: () => void, report: (error: unknown, context?: Context) => void): GuardedObserver<A>;
/** The end of an observer whose source closed. */
export declare const ENDED: WatchEnd;
/**
 * How a Session's close ends what follows it (decision "Slice 8 S1"), made once per close: an app's watch `ended`; a
 * synchronous observer (an adapter following the Session, which may open it again) `failed` with "session closed", so
 * it follows the next Session; `ended` stays for an observed owner that ended (a task document's task). A failed
 * Session ends both `failed` with its error.
 */
export declare function closeEnds(failure: {
    readonly error: unknown;
} | undefined): {
    readonly watch: WatchEnd;
    readonly observer: WatchEnd;
};
/** The end `ends` give `follower`: a watch's, or an observer's. */
export declare function closeEndOf(follower: unknown, ends: ReturnType<typeof closeEnds>): WatchEnd;
/**
 * The `Observation` of a guarded observer attached at `value`. Built outside the attaching closure, so a detached
 * observation keeps nothing but `value` and the spent guard alive.
 */
export declare function observation<T>(value: T, guarded: {
    detach(): void;
}): Observation<T>;
export {};
//# sourceMappingURL=session.d.ts.map