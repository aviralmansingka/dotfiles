import { SessionFailed } from "../errors.js";
/** Pending waits by key. Each settles once: through `resolve`, `rejectAll`, or cancellation of its context. */
export class Waiters {
    #sets = new Map();
    add(key, context) {
        const signal = context.abortSignal;
        const waiter = Promise.withResolvers();
        // Callers may hand the promise out only after later awaits (a job's result on the line): handled now, so a
        // rejection before then is not reported unhandled. The caller still gets it.
        waiter.promise.catch(() => { });
        if (signal?.aborted) {
            waiter.reject(signal.reason);
            return waiter.promise;
        }
        const set = this.#sets.get(key) ?? new Set();
        this.#sets.set(key, set.add(waiter));
        if (signal !== undefined) {
            const onAbort = () => {
                set.delete(waiter);
                if (set.size === 0 && this.#sets.get(key) === set)
                    this.#sets.delete(key);
                waiter.reject(signal.reason);
            };
            signal.addEventListener("abort", onAbort, { once: true });
            const detach = () => signal.removeEventListener("abort", onAbort);
            waiter.promise.then(detach, detach);
        }
        return waiter.promise;
    }
    keys() {
        return [...this.#sets.keys()];
    }
    resolve(key, value) {
        const set = this.#sets.get(key);
        this.#sets.delete(key);
        for (const waiter of set ?? [])
            waiter.resolve(value);
    }
    rejectAll(error) {
        const sets = [...this.#sets.values()];
        this.#sets.clear();
        for (const set of sets)
            for (const waiter of set)
                waiter.reject(error);
    }
}
/** Every item of a paginated scan, in page order. */
export async function scanAll(scan) {
    const items = [];
    let cursor;
    do {
        const page = await scan(cursor);
        items.push(...page.items);
        cursor = page.next;
    } while (cursor !== undefined);
    return items;
}
/** What a closed Harness rejects with: `SessionFailed` with the cause when it closed because the Session failed. */
export function closedError(session) {
    const failure = session.failure;
    return failure === undefined ? new Error("Harness is closed") : new SessionFailed(failure.error);
}
/** `{ extension }` when the extension is known. */
export function optionalExtension(extension) {
    return extension === undefined ? {} : { extension };
}
/** The scan of conversation `conversationId`'s history that `query` asks for, without fields an untyped caller added. */
export function conversationEntries(conversationId, query) {
    return {
        conversationId,
        ...(query.minEntryId === undefined ? {} : { minEntryId: query.minEntryId }),
        ...(query.maxEntryId === undefined ? {} : { maxEntryId: query.maxEntryId }),
        ...(query.order === undefined ? {} : { order: query.order }),
    };
}
//# sourceMappingURL=util.js.map