import type { Context } from "@earendil-works/chord/context";
import type { Seq, Storage, StorageWrite } from "../types.ts";
/** Commits `writes` as one batch and resolves with its seq; rejects with the refusal if the storage refused it. */
export declare function commitWrites(storage: Storage, writes: readonly StorageWrite[], context: Context): Promise<Seq>;
//# sourceMappingURL=commit-writes.d.ts.map