// StoreStorage's reads as the store's queries (slice 6b D2, §2.4), compiled once from the store's query vocabulary
// into SQL over the declared tables: no SQL is rendered per call, and a read selects only the record cell (by id, an
// entry's commit seq too; each column returned costs) and parses one JSON text per record, as `SqliteStorage`'s do.
const ASCENDING = { columns: ["id"], direction: "asc" };
const DESCENDING = { columns: ["id"], direction: "desc" };
/** The columns of a read of ids only. */
const ID = ["id"];
/** A placeholder value: a query's shape binds its values at each call. */
const ANY = 0;
/**
 * One table's compiled reads: by id (with the `byIdExtra` columns), and by shape (conditions in binding order, an
 * order; the record only), each shape compiled at its first use.
 */
export class TableQueries {
    #table;
    /** The record column's read of a cell at a version past 1; `undefined` while the column is at version 1. */
    #versioned;
    #byId;
    #shapes = new Map();
    #columns;
    constructor(table, byIdExtra = []) {
        this.#table = table;
        const versioned = table.jsonVersion("record") > 1;
        this.#versioned = versioned ? table.reader("record") : undefined;
        this.#columns = versioned ? ["record", "record$v"] : ["record"];
        this.#byId = table.prepareGet([...this.#columns, ...byIdExtra]);
    }
    /** The row with `id`, `undefined` when absent. */
    byId(executor, id) {
        return executor.get(this.#byId, id);
    }
    /** Up to `limit` rows whose `conditions` hold, by id in `direction`. */
    select(executor, conditions, direction, limit) {
        const sql = this.#shape(conditions, direction, "many");
        return executor.all(sql, ...conditions.map(([, , value]) => value), limit);
    }
    /** The first row whose `conditions` hold, by id in `direction`; `undefined` when none does. */
    first(executor, conditions, direction) {
        const sql = this.#shape(conditions, direction, "first");
        return executor.get(sql, ...conditions.map(([, , value]) => value));
    }
    /** A row's record, read as its column's (version checked, migrated on access). */
    record(row, context) {
        const versioned = this.#versioned;
        // The cell holds a record of this table the storage wrote; at version 1 it is that JSON (`OwnerTable.reader`).
        return (versioned === undefined ? JSON.parse(row.record) : versioned(row.record, row.record$v, context));
    }
    /** Appends the records of `rows` to `into`, in order, each read as `record` reads it (one check per call). */
    records(rows, into, context) {
        const versioned = this.#versioned;
        if (versioned === undefined) {
            for (const row of rows)
                into.push(JSON.parse(row.record));
            return;
        }
        for (const row of rows)
            into.push(versioned(row.record, row.record$v, context));
    }
    /** The compiled read of a shape: its conditions' columns and comparisons, the direction, one row or many. */
    #shape(conditions, direction, rows) {
        let key = `${rows} ${direction}`;
        for (const [column, condition] of conditions)
            key += ` ${column} ${condition}`;
        let sql = this.#shapes.get(key);
        if (sql !== undefined)
            return sql;
        // One comparison per condition: the vocabulary's node of that name, its value a placeholder.
        const nodes = conditions.map(([column, condition]) => ({ [condition]: [column, ANY] }));
        const where = nodes.length === 0 ? undefined : { and: nodes };
        const order = direction === "ascending" ? ASCENDING : DESCENDING;
        sql =
            rows === "first"
                ? this.#table.prepareFirst(this.#columns, where, order)
                : this.#table.prepare(this.#columns, where, order);
        this.#shapes.set(key, sql);
        return sql;
    }
}
/** The reads of `tables`. */
export function storageQueries(tables) {
    const heads = tables.entryHeads;
    return {
        conversations: new TableQueries(tables.conversations),
        entries: new TableQueries(tables.entries, ["commit_seq"]),
        latestHead: {
            any: heads.prepareFirst(ID, { eq: ["conversation_id", ANY] }, DESCENDING),
            atOrBefore: heads.prepareFirst(ID, { and: [{ eq: ["conversation_id", ANY] }, { lte: ["id", ANY] }] }, DESCENDING),
        },
        tasks: new TableQueries(tables.tasks),
        submissions: new TableQueries(tables.submissions),
    };
}
//# sourceMappingURL=queries.js.map