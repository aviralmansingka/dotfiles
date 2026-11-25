import { addressId } from "../documents.js";
const SCAN_PAGE_SIZE = 256;
/** Select every persisted conversation document copied by one fork. */
export async function prepareForkDocumentCopies(storage, parentConversationId, at, childConversationId, context) {
    const entry = await storage.entry(parentConversationId, at, context);
    if (entry === undefined)
        throw new Error(`Entry ${at} is not visible from conversation ${parentConversationId}`);
    const copies = [];
    const copiedAddresses = new Set();
    await collectCopies(storage, { kind: "conversation", conversationId: entry.entry.conversationId }, entry.commitSeq, "asOf", childConversationId, copies, copiedAddresses, context);
    await collectCopies(storage, { kind: "conversation", conversationId: parentConversationId }, "current", "current", childConversationId, copies, copiedAddresses, context);
    return copies;
}
async function collectCopies(storage, scope, at, policy, childConversationId, copies, copiedAddresses, context) {
    let cursor;
    do {
        const page = await storage.scanDocuments({ scope, at }, SCAN_PAGE_SIZE, cursor, context);
        for (const source of page.items) {
            if (source.scope.kind !== "conversation" || source.fork !== policy)
                continue;
            const id = await storage.mintId();
            const identity = {
                id,
                kind: source.kind,
                ...(source.key === undefined ? {} : { key: source.key }),
                scope: { kind: "conversation", conversationId: childConversationId },
            };
            const record = source.history === "latest"
                ? { ...identity, history: "latest", fork: source.fork }
                : { ...identity, history: "rewindable", fork: source.fork };
            const copyAddress = addressId(record);
            if (copiedAddresses.has(copyAddress)) {
                const member = record.key === undefined ? record.kind : `${record.kind}/${record.key}`;
                throw new Error(`Fork selects multiple source documents for ${member}`);
            }
            copiedAddresses.add(copyAddress);
            copies.push({ record, source: { id: source.id, at } });
        }
        cursor = page.next;
    } while (cursor !== undefined);
}
//# sourceMappingURL=forks.js.map