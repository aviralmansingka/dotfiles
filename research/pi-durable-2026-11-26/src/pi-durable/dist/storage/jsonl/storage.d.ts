import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import type { FileSystem } from "../../env/index.ts";
import type { CommitResult, ConversationId, ConversationQuery, Cursor, DocumentAddress, DocumentId, DocumentPoint, DocumentQuery, EntryId, EntryQuery, Id, Seq, Storage, StorageWrite, SubmissionId, SubmissionQuery, TaskId, TaskQuery } from "../../types.ts";
export type JsonlStorageOptions = {
    /** Flush every affected sidecar before appending the main marker. Defaults to false. */
    readonly fsync?: boolean;
    /**
     * Open without writing, for a viewer of a directory another process may be writing: recovery skips torn final lines
     * and unconfirmed sidecar tails in memory instead of truncating them, reclaims nothing, and creates no directory.
     * The storage holds the state committed at open and `commit()` rejects. Defaults to false.
     */
    readonly readOnly?: boolean;
};
export declare class JsonlCorruptionError extends Error {
    constructor(message: string, cause?: Error);
}
/** `commit()` on a storage opened with `readOnly: true`. Nothing was written. */
export declare class JsonlStorageReadOnlyError extends Error {
    constructor();
}
export declare class JsonlStoragePoisonedError extends Error {
    constructor(cause: Error);
}
/** Portable JSONL implementation of the storage contract. */
export declare class JsonlStorage implements Storage {
    private readonly fs;
    private readonly directory;
    private readonly mainPath;
    private readonly fsync;
    private readonly readOnly;
    private readonly memory;
    private readonly currentOnlyDocuments;
    private readonly liveTaskSidecars;
    private closed;
    /** Bytes of `main.jsonl` recovery read (`mainChanged()`). */
    private mainSize;
    private poisonError;
    /** Settles once the batch being appended is; its batches are in memory already (`commit()`). */
    private writing;
    private constructor();
    /**
     * Open or create a JSONL storage directory using the supplied filesystem. With `readOnly`, open an existing one
     * without writing; a recovery that fails while `main.jsonl` changes raced a writer's commit and is retried.
     */
    static open(directory: string, fs: FileSystem, context: Context, options?: JsonlStorageOptions): Promise<JsonlStorage>;
    /**
     * Commit `batches` with one append per affected file: every batch's sidecar records first, then their markers in one
     * write of `main.jsonl`. Each batch is checked against the state the earlier ones left, so memory applies each one
     * as it passes, and reads wait until the appends are done; the first batch refused ends the batch. A torn append of
     * the markers recovers a shorter complete prefix; any failure once a batch applied poisons the storage.
     */
    commit(batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, context: Context): Promise<CommitResult>;
    /** Append the sidecar records of `commits`, flushed with `fsync`, then their markers in one write of `main.jsonl`. */
    private append;
    mintId<I extends Id<string>>(): Promise<I>;
    conversation(id: ConversationId, context: Context): Promise<import("../../types.ts").ConversationRecord | undefined>;
    scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<import("../../types.ts").Page<import("../../types.ts").ConversationRecord, Readonly<Record<string, JsonValue>>>>;
    entry(id: EntryId, context: Context): ReturnType<Storage["entry"]>;
    entry(conversationId: ConversationId, id: EntryId, context: Context): ReturnType<Storage["entry"]>;
    findLatestHeadMarker(conversationId: ConversationId, atOrBeforeEntryId: EntryId | undefined, context: Context): Promise<(import("../../types.ts").EntryRecord & {
        readonly head: EntryId;
    }) | undefined>;
    scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<import("../../types.ts").Page<import("../../types.ts").EntryRecord, Readonly<Record<string, JsonValue>>>>;
    task(id: TaskId, context: Context): Promise<({
        readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
        readonly links?: readonly import("@earendil-works/pi-telemetry").TelemetryCarrier[];
        readonly id: TaskId<JsonValue>;
        readonly conversationId: ConversationId;
        readonly kind: string;
        readonly version: number;
        readonly input: JsonValue;
        readonly owner?: TaskId;
        readonly background: boolean;
        readonly abortRequested: boolean;
        readonly abortReason?: "restart";
        readonly abandonOnRestart?: true;
        readonly startedAt?: number;
        readonly endedAt?: number;
        readonly restarts?: number;
    } & ({
        readonly state: {
            readonly status: "pending";
            readonly checkpoint: JsonValue;
            readonly wake?: import("../../types.ts").WakeReason;
            readonly outcome?: never;
        } | {
            readonly status: "running";
            readonly checkpoint: JsonValue;
            readonly wake?: import("../../types.ts").WakeReason;
            readonly outcome?: never;
        } | {
            readonly status: "waiting";
            readonly checkpoint: JsonValue;
            readonly on: readonly TaskId[];
            readonly policy: import("../../types.ts").JoinPolicy;
            readonly outcome?: never;
        } | {
            readonly status: "sleeping";
            readonly checkpoint: JsonValue;
            readonly until?: number;
            readonly signals?: readonly import("../../signals.ts").SignalKey<unknown>[];
            readonly outcome?: never;
        };
        readonly memos?: Readonly<Record<string, JsonValue>>;
    } | {
        readonly state: {
            readonly status: "completing";
            readonly checkpoint?: never;
            readonly outcome: import("../../types.ts").TaskOutcome<JsonValue>;
        } | {
            readonly status: "terminal";
            readonly checkpoint?: never;
            readonly outcome: import("../../types.ts").TaskOutcome<JsonValue>;
        };
        readonly memos?: never;
    })) | undefined>;
    scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<import("../../types.ts").Page<{
        readonly trace?: import("@earendil-works/pi-telemetry").TelemetryCarrier;
        readonly links?: readonly import("@earendil-works/pi-telemetry").TelemetryCarrier[];
        readonly id: TaskId<JsonValue>;
        readonly conversationId: ConversationId;
        readonly kind: string;
        readonly version: number;
        readonly input: JsonValue;
        readonly owner?: TaskId;
        readonly background: boolean;
        readonly abortRequested: boolean;
        readonly abortReason?: "restart";
        readonly abandonOnRestart?: true;
        readonly startedAt?: number;
        readonly endedAt?: number;
        readonly restarts?: number;
    } & ({
        readonly state: {
            readonly status: "pending";
            readonly checkpoint: JsonValue;
            readonly wake?: import("../../types.ts").WakeReason;
            readonly outcome?: never;
        } | {
            readonly status: "running";
            readonly checkpoint: JsonValue;
            readonly wake?: import("../../types.ts").WakeReason;
            readonly outcome?: never;
        } | {
            readonly status: "waiting";
            readonly checkpoint: JsonValue;
            readonly on: readonly TaskId[];
            readonly policy: import("../../types.ts").JoinPolicy;
            readonly outcome?: never;
        } | {
            readonly status: "sleeping";
            readonly checkpoint: JsonValue;
            readonly until?: number;
            readonly signals?: readonly import("../../signals.ts").SignalKey<unknown>[];
            readonly outcome?: never;
        };
        readonly memos?: Readonly<Record<string, JsonValue>>;
    } | {
        readonly state: {
            readonly status: "completing";
            readonly checkpoint?: never;
            readonly outcome: import("../../types.ts").TaskOutcome<JsonValue>;
        } | {
            readonly status: "terminal";
            readonly checkpoint?: never;
            readonly outcome: import("../../types.ts").TaskOutcome<JsonValue>;
        };
        readonly memos?: never;
    }), Readonly<Record<string, JsonValue>>>>;
    submission(id: SubmissionId, context: Context): Promise<import("../../types.ts").SubmissionRecord | undefined>;
    scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<import("../../types.ts").Page<import("../../types.ts").SubmissionRecord, Readonly<Record<string, JsonValue>>>>;
    submissionByRequest(conversationId: ConversationId, requestId: string, context: Context): Promise<import("../../types.ts").SubmissionRecord | undefined>;
    findDocument(address: DocumentAddress, at: DocumentPoint, context: Context): Promise<import("../../types.ts").DocumentRecord | undefined>;
    document(id: DocumentId, at: DocumentPoint, context: Context): Promise<import("../../types.ts").StoredDocument | undefined>;
    scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, context: Context): Promise<import("../../types.ts").Page<import("../../types.ts").DocumentRecord, Readonly<Record<string, JsonValue>>>>;
    close(context: Context): Promise<void>;
    private encodeCommit;
    private planReclamations;
    private adoptSidecarState;
    /** The marker already published this state, so reclamation is retryable best-effort maintenance. */
    private reclaimSidecars;
    private replaceSidecar;
    /**
     * Load the confirmed state. A writable open also repairs the files: it truncates torn lines and unconfirmed sidecar
     * tails, removes leftover reclaim files, and reclaims sidecar records later commits made unnecessary. A read-only
     * open skips the same records in memory only.
     */
    private recover;
    private static confirmRecord;
    /** Parse the complete lines of `path`; a torn final line is truncated, or only skipped when read-only. */
    private readLines;
    /**
     * Whether `main.jsonl` changed size since recovery read it. A writer reclaims a sidecar only after appending the
     * marker that allows it, so sidecars read while `main.jsonl` stayed the same match its markers; a recovery that
     * failed while it changed may have read a sidecar a newer commit reclaimed.
     */
    private mainChanged;
    private resolveFile;
    private get store();
    /** The state to read once no batch is being appended: memory runs ahead of the file while one is. */
    private readable;
    private poison;
    private assertUsable;
}
//# sourceMappingURL=storage.d.ts.map