import type { SqliteExecutor } from "@earendil-works/chord/sqlite";
import type { Cell } from "./rows.ts";
/** The rows `sql` reads for `values`, given as its one JSON array parameter (`json_each(?)`): one statement per chunk. */
export declare function readRows<T extends object>(executor: SqliteExecutor, sql: string, values: readonly (Cell | readonly Cell[])[]): Promise<T[]>;
/** Runs `sql` (a deletion) for `values`, given as its one JSON array parameter: one statement per chunk. */
export declare function runForEach(executor: SqliteExecutor, sql: string, values: readonly Cell[]): Promise<void>;
/**
 * Inserts `rows` (one cell per column, in order) into `table`, then `conflict` (an upsert's clause): the rows of little
 * text from one JSON array parameter per chunk, the same SQL text whatever their number; the large ones bound column by
 * column.
 */
export declare function insertRows(executor: SqliteExecutor, table: string, columns: readonly string[], rows: readonly (readonly Cell[])[], conflict?: string): Promise<void>;
//# sourceMappingURL=statements.d.ts.map