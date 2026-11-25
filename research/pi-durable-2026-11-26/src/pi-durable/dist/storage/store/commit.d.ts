import { type OwnerTable, type SeriesCommit, type StagedWrite, type Step, type StoreWrite } from "@earendil-works/chord";
import type { Context } from "@earendil-works/chord/context";
import type { StorageWrite } from "../../types.ts";
/** Durable's record types, as `record_ids` names them. */
export type RecordType = "conversation" | "entry" | "task" | "submission" | "document";
/** The storage's tables, as a commit writes them. */
export type CommitTables = {
    readonly recordIds: OwnerTable;
    readonly conversations: OwnerTable;
    readonly entries: OwnerTable;
    readonly entryHeads: OwnerTable;
    readonly tasks: OwnerTable;
    readonly submissions: OwnerTable;
};
/** A Durable commit staged for the store's series: its checks, then itself as its one write. */
export declare class DurableCommit implements SeriesCommit, StagedWrite {
    #private;
    readonly order = "write";
    readonly writes: readonly StagedWrite[];
    /**
     * Stages `writes` (rule 8: rows and contents encoded here, before the queue); `raise` makes room above each explicit
     * id. A malformed batch (two content commands for one document, a second retirement) throws Durable's message.
     */
    constructor(writes: readonly StorageWrite[], owner: string, tables: CommitTables, raise: (id: number) => void, context: Context);
    /**
     * Durable's checks against the state the series' earlier commits left, writing nothing: the ids, the documents and
     * the copies; a throw refuses the commit.
     */
    check(step: Step): Promise<void>;
    /** The commit's writes, after its `check` in the same step. */
    apply(step: Step): Promise<readonly StoreWrite[]>;
}
//# sourceMappingURL=commit.d.ts.map