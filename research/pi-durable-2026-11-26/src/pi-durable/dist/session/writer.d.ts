import type { Context } from "@earendil-works/chord/context";
import type { CommitResult, Seq, StorageWrite } from "../types.ts";
/** A part's own failure at publication: memory could not adopt it, or one of the Session's own observers threw. */
export type PublishFailure = {
    readonly kind: "adoption" | "listener";
    readonly error: unknown;
};
/** One logical commit the line admitted: stored (`writes`, never empty), or held in memory only (no `writes`). */
export type PartSpec = {
    /** Line index of the job that admitted it: a failure it causes makes only later jobs' outcomes `SessionFailed`. */
    readonly index: number;
    readonly writes: readonly StorageWrite[] | undefined;
    /** Keys it writes: a read of one waits for its publication. */
    readonly keys: readonly string[];
    readonly context: Context;
    /** Publish it in memory, in line order, once it is durable (with its seq) or, held, once the parts before it are. */
    readonly publish: (seq: Seq | undefined) => PublishFailure | undefined;
    /** It will never be published: abort what it prepared. */
    readonly discard: () => void;
};
/** An admitted part and its outcome. */
export type Part = PartSpec & {
    /**
     * Resolves once it is published; rejects once it never will be, and also after publication when its storage call
     * rejected or the Session failed meanwhile. Always handled, so a part nobody awaits rejects silently.
     */
    readonly outcome: Promise<void>;
};
/** What the writer needs of its Session. */
export type WriterHost = {
    commit(batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, context: Context): Promise<CommitResult>;
    /** Apply a stored batch to the Session's read caches, right before it is published. */
    stored(writes: readonly StorageWrite[]): void;
    /**
     * Run one part's publication inside the Storage's own scope (`Storage.publishing`); `undefined` when it ran at once,
     * else settles once it ran.
     */
    publishing(publish: () => void, context: Context): Promise<void> | undefined;
    /** The Session's failure, if it failed. */
    failure(): {
        readonly error: unknown;
    } | undefined;
    /**
     * Fail the Session; `at` is the line index of the first job whose outcome the failure is, and `own` the jobs after it
     * whose outcome is still their own error (the other parts of a call that rejected), not `SessionFailed`.
     */
    fail(error: unknown, at: number, own: readonly number[]): void;
    /** Report an own observer's throw that cannot fail the Session, as it fails with a storage error. */
    report(error: unknown, context: Context): void;
};
/**
 * The writer of one Session. The line admits each commit as a part once its callback and settlement succeeded; the
 * writer sends every part admitted while no call is in flight as one `commit()` call, off the line, and publishes
 * the parts of a call one by one, in line order, with a macrotask between two, so the continuations of the waits one
 * resolves start before the next is published. Held commits are parts without writes, published when the parts before
 * them are.
 *
 * Each part registers the keys it writes; until it is published, it is the newest unpublished writer of each, and a
 * job that touches one waits for its gate. A key leaves when its newest writer is published, so the map holds one entry
 * per key with an unpublished writer.
 */
export declare class Writer {
    #private;
    constructor(host: WriterHost);
    /** Admit a part: register its keys, queue it, and send it at once unless a call is in flight. */
    admit(spec: PartSpec): Part;
    /** The gate of the newest unpublished writer of `key`, or `undefined` when it has none. */
    gate(key: string): Promise<void> | undefined;
    /** Opens once every part admitted so far is published or never will be. */
    drained(): Promise<void> | undefined;
    /** Keys with an unpublished writer, for tests that bound memory. */
    get unpublished(): number;
}
//# sourceMappingURL=writer.d.ts.map