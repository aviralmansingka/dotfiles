import type { OwnerTable } from "@earendil-works/chord";
import type { Context } from "@earendil-works/chord/context";
import type { SqliteExecutor, SqliteValue } from "@earendil-works/chord/sqlite";
import type { CommitTables } from "./commit.ts";
/**
 * A stored row as a query selects it: the record cell, its version (selected only once the column has versions past
 * 1), and an entry's commit seq.
 */
type RecordRow = {
    readonly record: string;
    readonly record$v?: number;
    readonly commit_seq?: number;
};
/** One condition of a read: a column, how it compares, its value; a call site keeps one order of them. */
export type Condition = readonly [string, "eq" | "gt" | "lt" | "gte" | "lte", SqliteValue];
/**
 * One table's compiled reads: by id (with the `byIdExtra` columns), and by shape (conditions in binding order, an
 * order; the record only), each shape compiled at its first use.
 */
export declare class TableQueries {
    #private;
    constructor(table: OwnerTable, byIdExtra?: readonly string[]);
    /** The row with `id`, `undefined` when absent. */
    byId(executor: Pick<SqliteExecutor, "get">, id: number): Promise<RecordRow | undefined>;
    /** Up to `limit` rows whose `conditions` hold, by id in `direction`. */
    select(executor: Pick<SqliteExecutor, "all">, conditions: readonly Condition[], direction: "ascending" | "descending", limit: number): Promise<RecordRow[]>;
    /** The first row whose `conditions` hold, by id in `direction`; `undefined` when none does. */
    first(executor: Pick<SqliteExecutor, "get">, conditions: readonly Condition[], direction: "ascending" | "descending"): Promise<RecordRow | undefined>;
    /** A row's record, read as its column's (version checked, migrated on access). */
    record<T>(row: RecordRow, context: Context): T;
    /** Appends the records of `rows` to `into`, in order, each read as `record` reads it (one check per call). */
    records<T>(rows: readonly RecordRow[], into: T[], context: Context): void;
}
/** The compiled reads of the storage's tables. */
export type StorageQueries = {
    readonly conversations: TableQueries;
    readonly entries: TableQueries;
    /** The id of a conversation's newest entry with a head marker: any, or at or before an id (bound second). */
    readonly latestHead: {
        readonly any: string;
        readonly atOrBefore: string;
    };
    readonly tasks: TableQueries;
    readonly submissions: TableQueries;
};
/** The reads of `tables`. */
export declare function storageQueries(tables: CommitTables): StorageQueries;
export {};
//# sourceMappingURL=queries.d.ts.map