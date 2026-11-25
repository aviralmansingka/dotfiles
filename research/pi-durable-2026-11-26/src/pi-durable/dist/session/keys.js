import { addressId } from "../documents.js";
/** A task record. */
export function taskKey(id) {
    return `task:${id}`;
}
/** A conversation record. */
export function conversationKey(id) {
    return `conv:${id}`;
}
/** An entry record. */
export function entryKey(id) {
    return `entry:${id}`;
}
/** The newest entries of a conversation: appended blind, read by scans, the newest entry, and head markers. */
export function appendKey(id) {
    return `entry-append:${id}`;
}
/** A submission record. */
export function submissionKey(id) {
    return `sub:${id}`;
}
/** The submission a conversation's request ID names. */
export function requestKey(conversationId, requestId) {
    return `req:${conversationId}:${requestId}`;
}
/** A document address (`addressId()`): its current incarnation, value, and held changes. */
export function documentKey(addressId) {
    return `doc:${addressId}`;
}
/** A document incarnation, for reads by its ID. */
export function incarnationKey(id) {
    return `docid:${id}`;
}
/** The incarnations alive in a scope: created and retired blind, read by scans and the task-document index. */
export function scopeKey(scope) {
    switch (scope.kind) {
        case "session":
            return "docscope:session";
        case "conversation":
            return `docscope:c${scope.conversationId}`;
        case "task":
            return `docscope:t${scope.taskId}`;
    }
}
/**
 * A node of the scheduler's ownership tree (a task ID, or `c<conversation ID>`): the live work listed below it. Written
 * by task creation and a task becoming terminal for every node from the task's parent up to and including the nearest
 * live task or the root conversation; read by every walk that expands the node.
 */
export function ownedKey(node) {
    return `owned:${node}`;
}
/** The ownerless conversations with live work below them, which global idle walks from. */
export const ROOTS_KEY = "roots";
/** The live tasks with cancellation intent: abort marks, and held outcomes other than `completed`. */
export const INTENT_KEY = "intent";
/** Every unpublished write: what a read that cannot be keyed, such as a scan, touches. */
export const ALL_KEYS = "*";
/** The keys of the table records in `writes`; document writes are keyed by the transaction, which knows addresses. */
export function tableKeys(writes, keys) {
    for (const write of writes) {
        switch (write.type) {
            case "conversation":
                keys.push(conversationKey(write.value.id));
                break;
            case "entry":
                keys.push(entryKey(write.value.id), appendKey(write.value.conversationId));
                break;
            case "task":
                keys.push(taskKey(write.value.id));
                break;
            case "submission":
                keys.push(submissionKey(write.value.id));
                if (write.value.requestId !== undefined) {
                    keys.push(requestKey(write.value.conversationId, write.value.requestId));
                }
                break;
        }
    }
}
/**
 * The Storage a job on the line reads through: every read first touches its key (`touch`), which waits while the key
 * has an unpublished writer, so the read sees what the line admitted before it. Scans that cannot be keyed touch
 * `ALL_KEYS`. Commits and `close()` pass through; the line never commits through it.
 */
export class GatedStorage {
    #storage;
    #touch;
    constructor(storage, touch) {
        this.#storage = storage;
        this.#touch = touch;
    }
    commit(batches, receive, context) {
        return this.#storage.commit(batches, receive, context);
    }
    mintId() {
        return this.#storage.mintId();
    }
    conversation(id, context) {
        return this.#after(conversationKey(id), () => this.#storage.conversation(id, context));
    }
    scanConversations(query, limit, cursor, context) {
        return this.#after(ALL_KEYS, () => this.#storage.scanConversations(query, limit, cursor, context));
    }
    entry(first, second, third) {
        if (third === undefined) {
            const id = first;
            return this.#after(entryKey(id), () => this.#storage.entry(id, second));
        }
        const conversationId = first;
        const id = second;
        // Visibility follows the conversation's immutable ancestry; the conversation may be unpublished itself.
        return this.#after(conversationKey(conversationId), () => this.#after(entryKey(id), () => this.#storage.entry(conversationId, id, third)));
    }
    findLatestHeadMarker(conversationId, atOrBeforeEntryId, context) {
        return this.#afterEntries(conversationId, () => this.#storage.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context));
    }
    scanEntries(query, limit, cursor, context) {
        return this.#afterEntries(query.conversationId, () => this.#storage.scanEntries(query, limit, cursor, context));
    }
    task(id, context) {
        return this.#after(taskKey(id), () => this.#storage.task(id, context));
    }
    scanTasks(query, limit, cursor, context) {
        return this.#after(ALL_KEYS, () => this.#storage.scanTasks(query, limit, cursor, context));
    }
    submission(id, context) {
        return this.#after(submissionKey(id), () => this.#storage.submission(id, context));
    }
    scanSubmissions(query, limit, cursor, context) {
        return this.#after(ALL_KEYS, () => this.#storage.scanSubmissions(query, limit, cursor, context));
    }
    submissionByRequest(conversationId, requestId, context) {
        return this.#after(requestKey(conversationId, requestId), () => this.#storage.submissionByRequest(conversationId, requestId, context));
    }
    findDocument(address, at, context) {
        return this.#after(documentKey(addressId(address)), () => this.#storage.findDocument(address, at, context));
    }
    document(id, at, context) {
        return this.#after(incarnationKey(id), () => this.#storage.document(id, at, context));
    }
    scanDocuments(query, limit, cursor, context) {
        return this.#after(scopeKey(query.scope), () => this.#storage.scanDocuments(query, limit, cursor, context));
    }
    close(context) {
        return this.#storage.close(context);
    }
    /**
     * Run a read of a conversation's entries once neither its appends nor its creation has an unpublished writer: Storage
     * refuses the read of a conversation it does not have yet.
     */
    #afterEntries(conversationId, read) {
        return this.#after(conversationKey(conversationId), () => this.#after(appendKey(conversationId), read));
    }
    /** Run `read` once `key` has no unpublished writer. */
    #after(key, read) {
        const gate = this.#touch(key);
        return gate === undefined ? read() : gate.then(read);
    }
}
//# sourceMappingURL=keys.js.map