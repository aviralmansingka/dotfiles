import { type DocumentEntry, type DocumentHistory, type DocumentAddress as EngineAddress, type DocumentRecord as EngineRecord } from "@earendil-works/chord";
import type { SqliteExecutor } from "@earendil-works/chord/sqlite";
import type { DocumentAddress, DocumentCreate, DocumentId, DocumentPoint, DocumentRecord, StoredDocument } from "../../types.ts";
/** The namespaces a storage claims under its owner: Durable's scopes (Chord's namespaces never contain a `:`). */
export declare const SCOPE_NAMESPACES: readonly ["session", "conversation:", "task:"];
/** The engine namespace of a Durable scope: `session`, `conversation:<id>`, `task:<id>`. */
export declare function namespaceOf(scope: DocumentRecord["scope"]): string;
/** The engine address of a Durable address under `owner`. */
export declare function addressOf(address: DocumentAddress | DocumentCreate, owner: string): EngineAddress;
/** What a record of `scope` keeps: session and task documents and latest conversation ones their latest state. */
export declare function historyOf(record: DocumentCreate | DocumentRecord): DocumentHistory;
/**
 * The engine record of a Durable creation at `seq` (retired at once for an empty lifetime): the Durable record itself,
 * its creation seq included, in `meta`, so a read of a live record parses one JSON text from one column, as
 * `SqliteStorage`'s does (a retirement later sets only the engine's `retired_at`).
 */
export declare function engineRecord(create: DocumentCreate, owner: string, version: number, seq: number, retired: boolean): EngineRecord;
/**
 * The Durable record of an engine record of this storage's owner and scopes, `undefined` for anyone else's (a Chord
 * document, another owner's): its id is unknown to this storage.
 */
export declare function durableRecord(record: EngineRecord, owner: string): DocumentRecord | undefined;
/** The Durable record of an engine entry read at one of this storage's addresses or scopes (the record in `meta`). */
export declare function recordOfEntry(entry: DocumentEntry): DocumentRecord;
/** Whether a document is alive at `at` (the half-open lifetime). */
export declare function aliveAt(record: DocumentRecord, at: DocumentPoint): boolean;
/**
 * A document read at a point, as a tagged result: request errors are told after the guarded read (slice 6b §1.4),
 * never thrown inside it.
 */
export type DocumentRead = {
    readonly kind: "found";
    readonly document: StoredDocument | undefined;
} | {
    readonly kind: "current_only";
    readonly id: DocumentId;
};
/**
 * Document `id` of `owner` at `at`: absent (unknown, someone else's, not alive at `at`), a record whose history does
 * not reach back to `at`, or its value from the base at or below `at` and the deltas up to it.
 */
export declare function readAt(executor: Pick<SqliteExecutor, "get" | "all">, id: DocumentId, at: DocumentPoint, owner: string): Promise<DocumentRead>;
//# sourceMappingURL=documents.d.ts.map