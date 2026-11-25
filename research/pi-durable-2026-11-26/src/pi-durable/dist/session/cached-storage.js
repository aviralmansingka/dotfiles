/**
 * Storage that serves hot record reads from memory: conversations, tasks, and written submissions, each table bounded
 * by a count, the least recently used record leaving first, except live tasks, which are kept until they end, and the
 * ended tasks a task waits on, kept until it moved on from its wait: a task's record is read again at each of its state
 * changes, a waiter reads the outcomes of what it waited on once it resumes (`runtime.outcomes()`), and both are
 * bounded by live work, which the scheduler keeps in memory too. Without that, a burst of more tasks than the count
 * would make each of those reads a Storage read on the line. Every commit goes through it, and one process owns a
 * Storage, so it applies each batch as it is published and never goes stale: `commit()`'s batches when the Session publishes
 * them (`published()`), not at their durability receipts. A read
 * result is kept only when no commit published since the read started wrote its record, as the read may not observe
 * that commit; versions are kept only for records with a read in flight. Cached values are frozen and shared. Entries,
 * scans, and documents pass through: the Session keeps documents and the newest entry per conversation itself, and
 * context ranges hold the entries a run reads.
 *
 * Not for a read-only Session: another process writes its Storage.
 */
export class CachedStorage {
    #storage;
    #conversations = new Lru(4096);
    /** Live (non-terminal) task records, until their task ends. */
    #liveTasks = new Map();
    /**
     * Tasks some task waits on, or waited on until its wait ended and it has not moved on since: how many such waits name
     * each, and its ended record once it ended.
     */
    #awaited = new Map();
    /** Per task that waits, or left its wait and has not changed since: what it waited on, and whether it left. */
    #waits = new Map();
    // Ended task records carry inputs and outcomes, such as a tool call's arguments, so fewer are kept.
    #tasks = new Lru(256);
    #submissions = new Lru(256);
    /** Per record with a read in flight: the reads, and how many published commits wrote it since the first began. */
    #reads = new Map();
    constructor(storage) {
        this.#storage = storage;
    }
    /** The backend's own scope for a publication (`Storage.publishing`), when it has one. */
    get publishing() {
        return scopeOf(this.#storage);
    }
    /** Pass the batches through; the Session applies each one with `published()` when it publishes it. */
    commit(batches, receive, context) {
        return this.#storage.commit(batches, receive, context);
    }
    /**
     * Apply a batch `commit()` stored, when the Session publishes it. Its records are frozen in place and kept as
     * they are, no copies: the Session's components that follow the publication, such as the scheduler's live tasks,
     * hold the same objects, so a live task's record is in memory once.
     */
    published(writes) {
        for (const write of writes) {
            switch (write.type) {
                case "conversation":
                    this.#wrote(write.value.id);
                    this.#conversations.set(write.value.id, freeze(write.value));
                    break;
                case "task":
                    this.#wrote(write.value.id);
                    this.#followWait(write.value);
                    this.#keepTask(freeze(write.value));
                    break;
                case "submission":
                    this.#wrote(write.value.id);
                    this.#submissions.set(write.value.id, freeze(write.value));
                    break;
            }
        }
    }
    mintId() {
        return this.#storage.mintId();
    }
    conversation(id, context) {
        const cached = this.#conversations.get(id);
        if (cached !== undefined)
            return Promise.resolve(cached);
        return this.#keep(id, () => this.#storage.conversation(id, context), (record) => this.#conversations.set(id, record));
    }
    scanConversations(query, limit, cursor, context) {
        return this.#storage.scanConversations(query, limit, cursor, context);
    }
    entry(first, second, third) {
        if (third === undefined)
            return this.#storage.entry(first, second);
        return this.#storage.entry(first, second, third);
    }
    findLatestHeadMarker(conversationId, atOrBeforeEntryId, context) {
        return this.#storage.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context);
    }
    scanEntries(query, limit, cursor, context) {
        return this.#storage.scanEntries(query, limit, cursor, context);
    }
    task(id, context) {
        const cached = this.#liveTasks.get(id) ?? this.#awaited.get(id)?.record ?? this.#tasks.get(id);
        if (cached !== undefined)
            return Promise.resolve(cached);
        return this.#keep(id, () => this.#storage.task(id, context), (record) => this.#keepTask(record));
    }
    scanTasks(query, limit, cursor, context) {
        return this.#storage.scanTasks(query, limit, cursor, context);
    }
    /** Cached as written only: this process writes every submission it settles, and a read one is usually settled. */
    submission(id, context) {
        const cached = this.#submissions.get(id);
        return cached === undefined ? this.#storage.submission(id, context) : Promise.resolve(cached);
    }
    scanSubmissions(query, limit, cursor, context) {
        return this.#storage.scanSubmissions(query, limit, cursor, context);
    }
    submissionByRequest(conversationId, requestId, context) {
        return this.#storage.submissionByRequest(conversationId, requestId, context);
    }
    findDocument(address, at, context) {
        return this.#storage.findDocument(address, at, context);
    }
    document(id, at, context) {
        return this.#storage.document(id, at, context);
    }
    scanDocuments(query, limit, cursor, context) {
        return this.#storage.scanDocuments(query, limit, cursor, context);
    }
    close(context) {
        return this.#storage.close(context);
    }
    /** Records kept per table, for tests that bound memory. */
    get sizes() {
        return {
            conversations: this.#conversations.size,
            tasks: this.#tasks.size,
            liveTasks: this.#liveTasks.size,
            awaited: this.#awaited.size,
            waits: this.#waits.size,
            submissions: this.#submissions.size,
        };
    }
    /** Keep a frozen task record: a live one until its task ends, an ended one in the bounded table. */
    #keepTask(record) {
        if (record.state.status === "terminal") {
            this.#liveTasks.delete(record.id);
            const awaited = this.#awaited.get(record.id);
            if (awaited !== undefined)
                awaited.record = record;
            else
                this.#tasks.set(record.id, record);
            return;
        }
        this.#tasks.delete(record.id);
        this.#liveTasks.set(record.id, record);
    }
    /**
     * Follow a task's waits from its written record: a wait holds the ended records of its `on` until the task, after
     * leaving the wait, changes again (or ends), as the phase that resumes reads their outcomes before its next commit.
     */
    #followWait(record) {
        const wait = this.#waits.get(record.id);
        if (record.state.status === "waiting") {
            if (wait !== undefined)
                this.#release(wait.on);
            const on = record.state.on;
            this.#waits.set(record.id, { on, left: false });
            for (const id of on) {
                let awaited = this.#awaited.get(id);
                if (awaited === undefined) {
                    // One that ended already moves over from the bounded table.
                    const ended = this.#tasks.get(id);
                    this.#tasks.delete(id);
                    awaited = ended === undefined ? { count: 0 } : { count: 0, record: ended };
                    this.#awaited.set(id, awaited);
                }
                awaited.count++;
            }
            return;
        }
        if (wait === undefined)
            return;
        if (!wait.left && record.state.status !== "terminal") {
            wait.left = true;
            return;
        }
        this.#waits.delete(record.id);
        this.#release(wait.on);
    }
    /** A wait on `on` is over: what no other wait names goes back to the bounded table. */
    #release(on) {
        for (const id of on) {
            const awaited = this.#awaited.get(id);
            if (--awaited.count > 0)
                continue;
            this.#awaited.delete(id);
            if (awaited.record !== undefined)
                this.#tasks.set(id, awaited.record);
        }
    }
    /** A published commit wrote record `id`: a read of it in flight may have missed that. */
    #wrote(id) {
        const reads = this.#reads.get(id);
        if (reads !== undefined)
            reads.version++;
    }
    /** Resolve with a read's result, frozen; keep a found record unless a commit published since wrote it. */
    async #keep(id, read, keep) {
        let reads = this.#reads.get(id);
        if (reads === undefined) {
            reads = { count: 0, version: 0 };
            this.#reads.set(id, reads);
        }
        reads.count++;
        const version = reads.version;
        let value;
        try {
            value = await read();
        }
        finally {
            if (--reads.count === 0)
                this.#reads.delete(id);
        }
        if (value === undefined)
            return undefined;
        freeze(value);
        if (reads.version === version)
            keep(value);
        return value;
    }
    /** Records with a read in flight, for tests that bound memory. */
    get readsInFlight() {
        return this.#reads.size;
    }
}
/** `storage`'s publication scope (`Storage.publishing`), for a wrapper to expose as its own; none when it has none. */
export function scopeOf(storage) {
    if (storage.publishing === undefined)
        return undefined;
    return (publish, context) => storage.publishing(publish, context);
}
/** A Map bounded to `capacity` entries that drops the least recently used one. */
class Lru {
    #map = new Map();
    #capacity;
    constructor(capacity) {
        this.#capacity = capacity;
    }
    get(key) {
        const value = this.#map.get(key);
        if (value === undefined)
            return undefined;
        this.#map.delete(key);
        this.#map.set(key, value);
        return value;
    }
    get size() {
        return this.#map.size;
    }
    delete(key) {
        this.#map.delete(key);
    }
    set(key, value) {
        this.#map.delete(key);
        this.#map.set(key, value);
        if (this.#map.size > this.#capacity)
            this.#map.delete(this.#map.keys().next().value);
    }
}
function freeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        freeze(child);
    return Object.freeze(value);
}
//# sourceMappingURL=cached-storage.js.map