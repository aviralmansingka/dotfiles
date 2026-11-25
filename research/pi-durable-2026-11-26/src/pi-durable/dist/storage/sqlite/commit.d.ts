import type { SqliteExecutor } from "@earendil-works/chord/sqlite";
import type { DocumentContent, DocumentCreate, DocumentId, DocumentRecord, Id, Seq, StorageWrite } from "../../types.ts";
import type { SqliteSchema } from "./schema.ts";
/** The table a record ID belongs to, as `record_ids` stores it. */
export type TableName = "conversation" | "entry" | "task" | "submission" | "document";
/** What one batch does to one document: its creation or copy, its new content, its retirement. */
export type DocumentAction = {
    create?: DocumentCreate;
    copy?: Extract<StorageWrite, {
        readonly type: "document.copy";
    }>["source"];
    content?: DocumentContent;
    retire: boolean;
};
type Tables = SqliteSchema["tables"];
/** The record ID a write claims and its table, if it claims one. */
export declare const claimOf: (write: StorageWrite) => {
    readonly id: Id<string>;
    readonly table: TableName;
} | undefined;
/** One batch's writes per document; throws when a document gets two content commands or two retirements. */
export declare function prepareDocumentActions(writes: readonly StorageWrite[]): Map<DocumentId, DocumentAction>;
/**
 * What the checks of one call's batches read: the stored state of every ID, document and address the batches touch,
 * read in a few statements when the call starts, then advanced in memory by each accepted batch.
 */
export declare class CommitState {
    #private;
    private constructor();
    /** Reads the stored state the checks of `batches` need: one statement per kind of state (split only by size). */
    static read(executor: SqliteExecutor, tables: Tables, batches: readonly (readonly StorageWrite[])[]): Promise<CommitState>;
    /** Durable's own checks of one batch that need no copy source: throws the refusal. */
    check(writes: readonly StorageWrite[], actions: ReadonlyMap<DocumentId, DocumentAction>): void;
    /** Advances the state past an accepted batch stored at `seq`, its copies resolved to their content. */
    apply(writes: readonly StorageWrite[], actions: ReadonlyMap<DocumentId, DocumentAction>, seq: Seq): void;
    /** A document's record as the accepted batches left it. */
    document(id: DocumentId): DocumentRecord | undefined;
}
/**
 * The writes of the accepted batches not yet written, per table, as their net effect: a task or submission written
 * twice is written once, as last written; a current-only document's revisions before its latest base or retirement
 * are dropped (and its stored ones deleted).
 */
export declare class PendingWrites {
    #private;
    /** Adds a batch stored at `seq`, after `state` applied it. */
    add(writes: readonly StorageWrite[], actions: ReadonlyMap<DocumentId, DocumentAction>, seq: Seq, state: CommitState): void;
    /** Writes everything pending, a few statements per table (`insertRows`), and forgets it. */
    flush(executor: SqliteExecutor, tables: Tables): Promise<void>;
}
export {};
//# sourceMappingURL=commit.d.ts.map