// One batch through `Storage.commit()`, for tests and suites that seed or write a storage directly.
/** Commits `writes` as one batch and resolves with its seq; rejects with the refusal if the storage refused it. */
export async function commitWrites(storage, writes, context) {
    let stored;
    const result = await storage.commit([writes], (_index, seq) => {
        stored = seq;
    }, context);
    if (result.kind === "refused")
        throw result.refused;
    return stored;
}
//# sourceMappingURL=commit-writes.js.map