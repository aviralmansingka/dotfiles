import { applyImmutableBatches } from "@earendil-works/chord/delta";
import { StorageRequestError } from "../errors.js";
import { idFromNumber, seqFromNumber } from "../ids.js";
import { nextCursor, scanStart } from "./scan.js";
function* documentDeltaBatches(id, version, revisions, start) {
    for (let index = start; index < revisions.length; index++) {
        const revision = revisions[index];
        if (revision.kind !== "delta" || revision.version !== version) {
            throw new Error(`Document ${id} crosses a stored version boundary without a base`);
        }
        yield revision.ops;
    }
}
const clone = (value) => {
    if (value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map((item) => clone(item));
    const source = value;
    const nullPrototype = Object.getPrototypeOf(value) === null;
    const result = (nullPrototype ? Object.create(null) : {});
    for (const key of Object.keys(source)) {
        const copied = clone(source[key]);
        if (!nullPrototype && key in result) {
            Object.defineProperty(result, key, {
                value: copied,
                writable: true,
                enumerable: true,
                configurable: true,
            });
        }
        else {
            result[key] = copied;
        }
    }
    return result;
};
const freeze = (value) => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        freeze(child);
    return Object.freeze(value);
};
const cursorId = (cursor) => {
    const after = cursor?.after;
    if (after === undefined)
        return undefined;
    if (typeof after !== "number" || !Number.isSafeInteger(after))
        throw new StorageRequestError("Invalid storage cursor");
    return idFromNumber(after);
};
const lowerBound = (ids, target) => {
    let low = 0;
    let high = ids.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (ids[middle] < target)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
};
const upperBound = (ids, target) => {
    let low = 0;
    let high = ids.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (ids[middle] <= target)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
};
const insertSorted = (ids, id) => {
    if (ids.length === 0 || ids[ids.length - 1] < id)
        ids.push(id);
    else
        ids.splice(lowerBound(ids, id), 0, id);
};
const removeSorted = (ids, id) => {
    const index = lowerBound(ids, id);
    if (ids[index] === id)
        ids.splice(index, 1);
};
const insertMapId = (index, key, id) => {
    let ids = index.get(key);
    if (ids === undefined) {
        ids = [];
        index.set(key, ids);
    }
    insertSorted(ids, id);
};
const scopeKey = (scope) => {
    switch (scope.kind) {
        case "session":
            return JSON.stringify(["session"]);
        case "conversation":
            return JSON.stringify(["conversation", scope.conversationId]);
        case "task":
            return JSON.stringify(["task", scope.taskId]);
    }
};
const addressKey = (address) => JSON.stringify([
    address.kind,
    scopeKey(address.scope),
    address.key === undefined ? ["singleton"] : ["family", address.key],
]);
const recordAddressKey = (record) => addressKey({ kind: record.kind, scope: record.scope, key: record.key });
const isAliveAt = (record, at) => {
    if (at === "current")
        return record.retiredAt === undefined;
    return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
};
const isCurrentOnly = (record) => record.scope.kind !== "conversation" || record.history === "latest";
const tableContaining = (state, id) => state.recordTypes.get(id);
const page = (values, limit, order = "ascending") => {
    const items = values.slice(0, limit);
    if (values.length <= limit)
        return { items: clone(items) };
    return { items: clone(items), next: nextCursor(items.at(-1).id, order) };
};
/** Indexes of sorted `ids` in scan order, after the cursor's ID when there is one. */
function* scanIndexes(ids, start) {
    if (start.order === "ascending") {
        const first = start.after === undefined ? 0 : upperBound(ids, start.after);
        for (let index = first; index < ids.length; index++)
            yield index;
    }
    else {
        const end = start.after === undefined ? ids.length : lowerBound(ids, start.after);
        for (let index = end - 1; index >= 0; index--)
            yield index;
    }
}
/**
 * Detached in-memory reference implementation of `Storage`.
 *
 * Reads and retained writes are cloned intentionally to match the ownership boundary
 * of serialization-backed stores. This is backend conformance, not validation.
 */
export class MemoryStorage {
    state = {
        recordTypes: new Map(),
        conversations: new Map(),
        conversationIds: [],
        conversationIdsByOwnerConversation: new Map(),
        conversationIdsByOwnerTask: new Map(),
        entries: new Map(),
        entryIds: new Map(),
        headEntryIds: new Map(),
        entryCommitSeqs: new Map(),
        tasks: new Map(),
        taskIds: [],
        taskIdsByStatus: { pending: [], running: [], waiting: [], sleeping: [], completing: [], terminal: [] },
        submissions: new Map(),
        submissionIds: [],
        submissionIdsByStatus: { queued: [], placed: [], done: [], unanswered: [] },
        submissionIdsByRequest: new Map(),
        documents: new Map(),
        documentAddresses: new Map(),
        documentIdsByScope: new Map(),
    };
    nextId = 2;
    nextSeq = 1;
    closed = false;
    /**
     * Apply `batches` one by one, each checked against the state the earlier ones left (`prepareCommit()`, which only
     * checks and detaches, so a batch it refuses changed nothing); stops at the first one refused. Memory is durable at
     * once; the receipts follow the last batch.
     */
    async commit(batches, receive, _context) {
        this.assertOpen();
        const seqs = [];
        let refused;
        try {
            for (const writes of batches) {
                let prepared;
                try {
                    prepared = this.prepareCommit(writes);
                }
                catch (error) {
                    refused = { error };
                    break;
                }
                seqs.push(prepared.apply());
            }
        }
        finally {
            // Also when a batch's apply throws: the batches applied before it are stored, and their receipts stand.
            for (const [index, seq] of seqs.entries())
                receive(index, seq);
        }
        return refused === undefined
            ? { kind: "stored", stored: seqs.length }
            : { kind: "refused", stored: seqs.length, refused: refused.error };
    }
    /** Validate and detach one commit without changing observable state. */
    prepareCommit(writes, seq = seqFromNumber(this.nextSeq)) {
        this.assertOpen();
        if (!Number.isSafeInteger(seq) || seq < this.nextSeq) {
            throw new Error(`Commit sequence ${seq} does not strictly increase`);
        }
        const detachedWrites = freeze(this.resolveDocumentCopies(writes.map((write) => clone(write))));
        this.checkGlobalIds(detachedWrites);
        const documentActions = this.prepareDocumentActions(detachedWrites);
        this.checkDocumentActions(documentActions);
        let applied = false;
        return {
            seq,
            writes: detachedWrites,
            apply: () => {
                if (!applied) {
                    applied = true;
                    this.applyPreparedCommit(detachedWrites, documentActions, seq);
                }
                return seq;
            },
        };
    }
    resolveDocumentCopies(writes) {
        if (!writes.some((write) => write.type === "document.copy"))
            return writes;
        const changedDocumentIds = new Set();
        for (const write of writes) {
            if (write.type === "document.create" || write.type === "document.copy") {
                changedDocumentIds.add(write.record.id);
            }
            else if (write.type === "document.change" || write.type === "document.retire") {
                changedDocumentIds.add(write.id);
            }
        }
        return writes.map((write) => {
            if (write.type !== "document.copy")
                return write;
            try {
                if (changedDocumentIds.has(write.source.id)) {
                    throw new Error(`Fork source document ${write.source.id} is changed in the copy batch`);
                }
                const stored = this.materializeDocument(write.source.id, write.source.at);
                if (stored === undefined)
                    throw new Error(`Fork source document ${write.source.id} cannot be read`);
                if (stored.record.scope.kind !== "conversation" ||
                    write.record.scope.kind !== "conversation" ||
                    stored.record.kind !== write.record.kind ||
                    stored.record.key !== write.record.key ||
                    stored.record.history !== write.record.history ||
                    stored.record.fork !== write.record.fork) {
                    throw new Error(`Fork source document ${write.source.id} does not match the copied record`);
                }
                return {
                    type: "document.create",
                    record: write.record,
                    content: { kind: "base", version: stored.version, value: stored.value },
                };
            }
            catch (error) {
                throw new Error(`Document copy ${write.record.id} was rejected`, { cause: error });
            }
        });
    }
    applyPreparedCommit(prepared, documentActions, seq) {
        for (const write of prepared) {
            switch (write.type) {
                case "conversation": {
                    this.state.recordTypes.set(write.value.id, "conversation");
                    this.state.conversations.set(write.value.id, write.value);
                    insertSorted(this.state.conversationIds, write.value.id);
                    const owner = write.value.owner;
                    if (owner !== undefined) {
                        insertMapId(this.state.conversationIdsByOwnerConversation, owner.conversationId, write.value.id);
                        insertMapId(this.state.conversationIdsByOwnerTask, owner.taskId, write.value.id);
                    }
                    this.nextId = Math.max(this.nextId, write.value.id + 1);
                    break;
                }
                case "entry": {
                    this.state.recordTypes.set(write.value.id, "entry");
                    this.state.entries.set(write.value.id, write.value);
                    this.state.entryCommitSeqs.set(write.value.id, seq);
                    let ids = this.state.entryIds.get(write.value.conversationId);
                    if (ids === undefined) {
                        ids = [];
                        this.state.entryIds.set(write.value.conversationId, ids);
                    }
                    insertSorted(ids, write.value.id);
                    if (write.value.head !== undefined) {
                        let headIds = this.state.headEntryIds.get(write.value.conversationId);
                        if (headIds === undefined) {
                            headIds = [];
                            this.state.headEntryIds.set(write.value.conversationId, headIds);
                        }
                        insertSorted(headIds, write.value.id);
                    }
                    this.nextId = Math.max(this.nextId, write.value.id + 1);
                    break;
                }
                case "task": {
                    this.state.recordTypes.set(write.value.id, "task");
                    const previous = this.state.tasks.get(write.value.id);
                    if (previous === undefined) {
                        insertSorted(this.state.taskIds, write.value.id);
                        insertSorted(this.state.taskIdsByStatus[write.value.state.status], write.value.id);
                    }
                    else if (previous.state.status !== write.value.state.status) {
                        removeSorted(this.state.taskIdsByStatus[previous.state.status], write.value.id);
                        insertSorted(this.state.taskIdsByStatus[write.value.state.status], write.value.id);
                    }
                    this.state.tasks.set(write.value.id, write.value);
                    this.nextId = Math.max(this.nextId, write.value.id + 1);
                    break;
                }
                case "submission": {
                    this.state.recordTypes.set(write.value.id, "submission");
                    const previous = this.state.submissions.get(write.value.id);
                    if (previous === undefined) {
                        insertSorted(this.state.submissionIds, write.value.id);
                        insertSorted(this.state.submissionIdsByStatus[write.value.status], write.value.id);
                    }
                    else if (previous.status !== write.value.status) {
                        removeSorted(this.state.submissionIdsByStatus[previous.status], write.value.id);
                        insertSorted(this.state.submissionIdsByStatus[write.value.status], write.value.id);
                    }
                    if (previous?.requestId !== undefined) {
                        const previousRequests = this.state.submissionIdsByRequest.get(previous.conversationId);
                        if (previousRequests?.get(previous.requestId) === write.value.id) {
                            previousRequests.delete(previous.requestId);
                            if (previousRequests.size === 0)
                                this.state.submissionIdsByRequest.delete(previous.conversationId);
                        }
                    }
                    this.state.submissions.set(write.value.id, write.value);
                    if (write.value.requestId !== undefined) {
                        let requests = this.state.submissionIdsByRequest.get(write.value.conversationId);
                        if (requests === undefined) {
                            requests = new Map();
                            this.state.submissionIdsByRequest.set(write.value.conversationId, requests);
                        }
                        requests.set(write.value.requestId, write.value.id);
                    }
                    this.nextId = Math.max(this.nextId, write.value.id + 1);
                    break;
                }
                case "document.copy":
                    throw new Error("Prepared document copy was not resolved");
                case "document.create":
                case "document.change":
                case "document.retire":
                    break;
            }
        }
        this.applyDocumentActions(documentActions, seq);
        this.nextSeq = seq + 1;
        return seq;
    }
    async mintId() {
        this.assertOpen();
        if (!Number.isSafeInteger(this.nextId))
            throw new Error("ID space is exhausted");
        return idFromNumber(this.nextId++);
    }
    async conversation(id, _context) {
        this.assertOpen();
        const value = this.state.conversations.get(id);
        return value === undefined ? undefined : clone(value);
    }
    async scanConversations(query, limit, cursor, _context) {
        this.assertOpen();
        const ids = query.ownerTaskId !== undefined
            ? (this.state.conversationIdsByOwnerTask.get(query.ownerTaskId) ?? [])
            : query.ownerConversationId !== undefined
                ? (this.state.conversationIdsByOwnerConversation.get(query.ownerConversationId) ?? [])
                : this.state.conversationIds;
        const start = scanStart(query.order, cursor, "ascending");
        const values = [];
        for (const index of scanIndexes(ids, start)) {
            if (values.length > limit)
                break;
            const value = this.state.conversations.get(ids[index]);
            if (query.ownerConversationId !== undefined && value.owner?.conversationId !== query.ownerConversationId) {
                continue;
            }
            values.push(value);
        }
        return page(values, limit, start.order);
    }
    async entry(idOrConversationId, idOrContext, context) {
        this.assertOpen();
        if (context === undefined) {
            const id = idFromNumber(idOrConversationId);
            const entry = this.state.entries.get(id);
            if (entry === undefined)
                return undefined;
            return { entry: clone(entry), commitSeq: this.state.entryCommitSeqs.get(id) };
        }
        if (typeof idOrContext !== "number")
            throw new StorageRequestError("Storage.entry() requires an entry ID");
        const conversationId = idFromNumber(idOrConversationId);
        const id = idFromNumber(idOrContext);
        const entry = this.visibleEntries(conversationId, id, id).next().value;
        if (entry === undefined)
            return undefined;
        return { entry: clone(entry), commitSeq: this.state.entryCommitSeqs.get(id) };
    }
    async findLatestHeadMarker(conversationId, atOrBeforeEntryId, _context) {
        this.assertOpen();
        if (!this.state.conversations.has(conversationId)) {
            throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
        }
        let currentId = conversationId;
        let upperEntryId = atOrBeforeEntryId ?? Number.POSITIVE_INFINITY;
        while (true) {
            const ids = this.state.headEntryIds.get(currentId) ?? [];
            const index = upperBound(ids, upperEntryId) - 1;
            if (index >= 0) {
                const entry = this.state.entries.get(ids[index]);
                return clone({ ...entry, head: entry.head });
            }
            const conversation = this.state.conversations.get(currentId);
            if (conversation.parent === undefined)
                return undefined;
            upperEntryId = Math.min(upperEntryId, conversation.parent.at);
            currentId = conversation.parent.conversationId;
        }
    }
    async scanEntries(query, limit, cursor, _context) {
        this.assertOpen();
        const { order, after } = scanStart(query.order, cursor, "descending");
        // The cursor narrows the bound on the side the scan moves away from.
        let minEntryId = query.minEntryId;
        let maxEntryId = query.maxEntryId;
        if (after !== undefined && order === "descending")
            maxEntryId = Math.min(maxEntryId ?? after, after - 1);
        if (after !== undefined && order === "ascending")
            minEntryId = Math.max(minEntryId ?? after, after + 1);
        const visible = [];
        const entries = order === "descending"
            ? this.visibleEntries(query.conversationId, minEntryId, maxEntryId)
            : this.visibleEntriesAscending(query.conversationId, minEntryId, maxEntryId);
        for (const entry of entries) {
            visible.push(entry);
            if (visible.length > limit)
                break;
        }
        return page(visible, limit, order);
    }
    async task(id, _context) {
        this.assertOpen();
        const value = this.state.tasks.get(id);
        return value === undefined ? undefined : clone(value);
    }
    async scanTasks(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const ids = query.status === undefined ? this.state.taskIds : this.state.taskIdsByStatus[query.status];
        const values = [];
        for (const index of scanIndexes(ids, start)) {
            if (values.length > limit)
                break;
            const value = this.state.tasks.get(ids[index]);
            if (query.conversationId !== undefined && value.conversationId !== query.conversationId)
                continue;
            if (query.kind !== undefined && value.kind !== query.kind)
                continue;
            if (query.abortRequested !== undefined && value.abortRequested !== query.abortRequested)
                continue;
            if (query.background !== undefined && value.background !== query.background)
                continue;
            values.push(value);
        }
        return page(values, limit, start.order);
    }
    async submission(id, _context) {
        this.assertOpen();
        const value = this.state.submissions.get(id);
        return value === undefined ? undefined : clone(value);
    }
    async scanSubmissions(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const ids = query.status === undefined ? this.state.submissionIds : this.state.submissionIdsByStatus[query.status];
        const values = [];
        for (const index of scanIndexes(ids, start)) {
            if (values.length > limit)
                break;
            const value = this.state.submissions.get(ids[index]);
            if (query.conversationId !== undefined && value.conversationId !== query.conversationId)
                continue;
            values.push(value);
        }
        return page(values, limit, start.order);
    }
    async submissionByRequest(conversationId, requestId, _context) {
        this.assertOpen();
        const id = this.state.submissionIdsByRequest.get(conversationId)?.get(requestId);
        if (id === undefined)
            return undefined;
        return clone(this.state.submissions.get(id));
    }
    async findDocument(address, at, _context) {
        this.assertOpen();
        const index = this.state.documentAddresses.get(addressKey(address));
        if (at === "current") {
            return index?.currentId === undefined ? undefined : clone(this.state.documents.get(index.currentId).record);
        }
        for (const id of index?.ids ?? []) {
            const record = this.state.documents.get(id).record;
            if (isAliveAt(record, at))
                return clone(record);
        }
        return undefined;
    }
    async document(id, at, _context) {
        this.assertOpen();
        const stored = this.materializeDocument(id, at);
        return stored === undefined
            ? undefined
            : {
                record: clone(stored.record),
                version: stored.version,
                value: clone(stored.value),
                deltasSinceBase: stored.deltasSinceBase,
            };
    }
    async scanDocuments(query, limit, cursor, _context) {
        this.assertOpen();
        const ids = this.state.documentIdsByScope.get(scopeKey(query.scope)) ?? [];
        const after = cursorId(cursor);
        const start = after === undefined ? 0 : upperBound(ids, after);
        const values = [];
        for (let index = start; index < ids.length && values.length <= limit; index++) {
            const record = this.state.documents.get(ids[index]).record;
            if (query.kind !== undefined && record.kind !== query.kind)
                continue;
            if (isAliveAt(record, query.at))
                values.push(record);
        }
        return page(values, limit);
    }
    async close(_context) {
        this.closed = true;
    }
    materializeDocument(id, at) {
        const stored = this.state.documents.get(id);
        if (stored === undefined)
            return undefined;
        if (at !== "current" && isCurrentOnly(stored.record)) {
            throw new StorageRequestError(`Document ${id} does not retain historical content`);
        }
        if (!isAliveAt(stored.record, at))
            return undefined;
        const revisions = at === "current" ? stored.revisions : stored.revisions.filter((revision) => revision.seq <= at);
        let baseIndex = revisions.length - 1;
        while (baseIndex >= 0 && revisions[baseIndex].kind !== "base")
            baseIndex--;
        const base = revisions[baseIndex];
        if (base?.kind !== "base")
            throw new Error(`Document ${id} is missing a required base`);
        const value = applyImmutableBatches(base.value, documentDeltaBatches(id, base.version, revisions, baseIndex + 1));
        return { record: stored.record, version: base.version, value, deltasSinceBase: revisions.length - baseIndex - 1 };
    }
    *visibleEntries(conversationId, minEntryId = Number.NEGATIVE_INFINITY, maxEntryId = Number.POSITIVE_INFINITY) {
        if (!this.state.conversations.has(conversationId)) {
            throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
        }
        let currentId = conversationId;
        let upperEntryId = maxEntryId;
        while (true) {
            const ids = this.state.entryIds.get(currentId) ?? [];
            for (let index = upperBound(ids, upperEntryId) - 1; index >= 0; index--) {
                const id = ids[index];
                if (id < minEntryId)
                    break;
                yield this.state.entries.get(id);
            }
            const conversation = this.state.conversations.get(currentId);
            if (conversation.parent === undefined)
                break;
            upperEntryId = Math.min(upperEntryId, conversation.parent.at);
            if (upperEntryId < minEntryId)
                break;
            currentId = conversation.parent.conversationId;
        }
    }
    /** Visible entries oldest first: the fork chain's segments from the root conversation forward. */
    *visibleEntriesAscending(conversationId, minEntryId = Number.NEGATIVE_INFINITY, maxEntryId = Number.POSITIVE_INFINITY) {
        if (!this.state.conversations.has(conversationId)) {
            throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
        }
        const segments = [];
        let currentId = conversationId;
        let upperEntryId = maxEntryId;
        while (true) {
            segments.push({ conversationId: currentId, upper: upperEntryId });
            const conversation = this.state.conversations.get(currentId);
            if (conversation.parent === undefined)
                break;
            upperEntryId = Math.min(upperEntryId, conversation.parent.at);
            if (upperEntryId < minEntryId)
                break;
            currentId = conversation.parent.conversationId;
        }
        for (const segment of segments.reverse()) {
            const ids = this.state.entryIds.get(segment.conversationId) ?? [];
            for (let index = lowerBound(ids, minEntryId); index < ids.length; index++) {
                const id = ids[index];
                if (id > segment.upper)
                    break;
                yield this.state.entries.get(id);
            }
        }
    }
    checkGlobalIds(writes) {
        const claimed = new Map();
        for (const write of writes) {
            if (write.type === "document.change" || write.type === "document.retire")
                continue;
            const document = write.type === "document.create" || write.type === "document.copy";
            const table = document ? "document" : write.type;
            const id = document ? write.record.id : write.value.id;
            const existing = tableContaining(this.state, id);
            const earlier = claimed.get(id);
            if (table === "conversation" || table === "entry" || table === "document") {
                if (existing !== undefined)
                    throw new Error(`ID ${id} already belongs to ${existing}`);
                if (earlier !== undefined)
                    throw new Error(`ID ${id} is written more than once`);
            }
            else {
                if (existing !== undefined && existing !== table) {
                    throw new Error(`ID ${id} already belongs to ${existing}`);
                }
                if (earlier !== undefined && earlier !== table)
                    throw new Error(`ID ${id} is written as two record types`);
            }
            claimed.set(id, table);
        }
    }
    prepareDocumentActions(writes) {
        const actions = new Map();
        for (const write of writes) {
            if (write.type !== "document.create" && write.type !== "document.change" && write.type !== "document.retire") {
                continue;
            }
            const id = write.type === "document.create" ? write.record.id : write.id;
            let action = actions.get(id);
            if (action === undefined) {
                action = { retire: false };
                actions.set(id, action);
            }
            switch (write.type) {
                case "document.create":
                    if (action.create !== undefined || action.content !== undefined) {
                        throw new Error(`Document ${id} has more than one content command`);
                    }
                    action.create = write.record;
                    action.content = write.content;
                    break;
                case "document.change":
                    if (action.content !== undefined)
                        throw new Error(`Document ${id} has more than one content command`);
                    action.content = write.content;
                    break;
                case "document.retire":
                    if (action.retire)
                        throw new Error(`Document ${id} is retired more than once`);
                    action.retire = true;
                    break;
            }
        }
        return actions;
    }
    checkDocumentActions(actions) {
        const liveCounts = new Map();
        for (const [id, action] of actions) {
            const existing = this.state.documents.get(id);
            if (action.create === undefined && existing === undefined)
                throw new Error(`Unknown document: ${id}`);
            if (action.create !== undefined && existing !== undefined)
                throw new Error(`Document ${id} already exists`);
            if (existing?.record.retiredAt !== undefined)
                throw new Error(`Document ${id} is retired`);
            const previous = existing?.revisions.at(-1);
            if (action.content?.kind === "delta") {
                if (previous === undefined)
                    throw new Error(`Document ${id} delta has no base`);
                if (previous.version !== action.content.version) {
                    throw new Error(`Document ${id} version transition requires a base`);
                }
            }
            const key = action.create === undefined ? recordAddressKey(existing.record) : recordAddressKey(action.create);
            const currentId = this.state.documentAddresses.get(key)?.currentId;
            let live = liveCounts.get(key);
            if (live === undefined)
                live = currentId === undefined ? 0 : 1;
            if (action.retire && currentId === id)
                live--;
            if (action.create !== undefined && !action.retire)
                live++;
            liveCounts.set(key, live);
        }
        for (const live of liveCounts.values()) {
            if (live > 1)
                throw new Error(`Document address already has a current incarnation`);
        }
    }
    applyDocumentActions(actions, seq) {
        for (const [id, action] of actions) {
            let stored = this.state.documents.get(id);
            if (action.create !== undefined) {
                const record = {
                    ...action.create,
                    createdAt: seq,
                    ...(action.retire ? { retiredAt: seq } : {}),
                };
                stored = { record, revisions: [{ ...action.content, seq }] };
                this.state.recordTypes.set(id, "document");
                this.state.documents.set(id, stored);
                const key = recordAddressKey(record);
                let address = this.state.documentAddresses.get(key);
                if (address === undefined) {
                    address = { ids: [] };
                    this.state.documentAddresses.set(key, address);
                }
                insertSorted(address.ids, id);
                let scopeIds = this.state.documentIdsByScope.get(scopeKey(record.scope));
                if (scopeIds === undefined) {
                    scopeIds = [];
                    this.state.documentIdsByScope.set(scopeKey(record.scope), scopeIds);
                }
                insertSorted(scopeIds, id);
                this.nextId = Math.max(this.nextId, id + 1);
            }
            else if (action.content !== undefined) {
                const revision = { ...action.content, seq };
                if (revision.kind === "base" && isCurrentOnly(stored.record))
                    stored.revisions = [revision];
                else
                    stored.revisions.push(revision);
            }
            if (action.retire && action.create === undefined)
                stored.record = { ...stored.record, retiredAt: seq };
            if (action.retire && isCurrentOnly(stored.record))
                stored.revisions = [];
            if (action.create !== undefined || action.retire) {
                const address = this.state.documentAddresses.get(recordAddressKey(stored.record));
                if (action.retire && address.currentId === id)
                    delete address.currentId;
                if (action.create !== undefined && !action.retire)
                    address.currentId = id;
            }
        }
    }
    assertOpen() {
        if (this.closed)
            throw new Error("MemoryStorage is closed");
    }
}
//# sourceMappingURL=memory.js.map