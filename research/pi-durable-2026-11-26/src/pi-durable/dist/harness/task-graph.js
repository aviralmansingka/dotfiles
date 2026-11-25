import { BACKGROUND_CONTEXT, withoutAbortSignal } from "@earendil-works/chord/context";
import { applyImmutable } from "@earendil-works/chord/delta";
import { Watch } from "@earendil-works/chord/watch";
import { closeEndOf, closeEnds, contained, guardObserver, observation, } from "../session/session.js";
import { blockedSubject } from "./scheduler.js";
import { closedError, scanAll } from "./util.js";
const LIVE_STATUSES = ["pending", "running", "waiting", "sleeping", "completing"];
const SCAN_PAGE_SIZE = 256;
/**
 * The Harness's task graph mount: built on the Session line by its first observer and dropped with its last. It
 * advances from the Session's commit publications, which are durable.
 */
export class TaskGraphView {
    #session;
    #blocking;
    #mount;
    #closed = false;
    constructor(session, blocking) {
        this.#session = session;
        this.#blocking = blocking;
        session.followCommits((publication, context) => {
            // A commit held in memory changes documents only, which the graph does not show.
            if (this.#mount === undefined || publication.kind === "memory")
                return;
            advance(this.#mount, publication, context, blocking.blocked, (error) => session.report(error));
        });
        blocking.subscribeBlocked(() => this.#refreshBlocked());
        session.subscribeClose(() => {
            this.#closed = true;
            const ends = closeEnds(this.#session.failure);
            for (const observer of [...(this.#mount?.observers ?? [])]) {
                contained(() => observer.end(closeEndOf(observer, ends)), (error) => session.report(error));
            }
            this.#mount = undefined;
        });
    }
    /**
     * Attach a synchronous observer of the graph (`Harness.observeTaskGraph()`), behind `guardObserver()`; `context`
     * governs only the attachment.
     */
    async observe(observer, context) {
        let value;
        const attached = await this.#attach((current, release) => {
            value = current;
            return guardObserver(observer, release, (error) => this.#session.report(error));
        }, context);
        const signal = context.abortSignal;
        if (signal?.aborted) {
            attached.detach();
            throw signal.reason;
        }
        return observation(value, attached.observer);
    }
    /** A serialized watch of the graph, an observer of its mount; aborting `context` ends it `aborted`. */
    async watch(context) {
        const { observer } = await this.#attach((value, release) => new Watch(value, release, (error) => this.#session.report(error)), context);
        const signal = context.abortSignal;
        if (signal?.aborted) {
            observer.abort();
            throw signal.reason;
        }
        if (signal !== undefined)
            observer.observeAbort(signal);
        return observer;
    }
    /** Register an observer created from the current revision, atomically on the Session line. */
    #attach(create, context) {
        return this.#session.readOnLine(async (storage) => {
            const mount = this.#mount ?? {
                ...(await this.#build(storage, context)),
                observers: new Set(),
            };
            const detach = () => {
                mount.observers.delete(observer);
                if (mount.observers.size === 0 && this.#mount === mount)
                    this.#mount = undefined;
            };
            const observer = create(mount.value, detach);
            // Close or cancellation may begin while the mount builds; register nothing then.
            if (this.#closed)
                throw closedError(this.#session);
            context.abortSignal?.throwIfAborted();
            this.#mount = mount;
            mount.observers.add(observer);
            return { observer, detach };
        });
    }
    /** On the Session line: derive every node's blocked reason again, and publish the ones that changed. */
    #refreshBlocked() {
        if (this.#mount === undefined || this.#closed)
            return;
        this.#session
            .readOnLine(async () => {
            const mount = this.#mount;
            if (mount === undefined)
                return;
            const ops = [];
            for (const [key, record] of mount.records) {
                const blocked = this.#blocking.blocked(record);
                if (blocked === mount.value.tasks[key]?.blocked)
                    continue;
                ops.push(blocked === undefined ? ["d", ["tasks", key, "blocked"]] : ["s", ["tasks", key, "blocked"], blocked]);
            }
            publish(mount, ops, BACKGROUND_CONTEXT, (error) => this.#session.report(error));
        })
            // Rejected only once the Session is closing or failed.
            .catch(() => { });
    }
    /** Read the graph on the line, through the line's `storage`. */
    async #build(storage, context) {
        const tasks = {};
        const live = new Map();
        const records = [];
        for (const status of LIVE_STATUSES) {
            records.push(...(await scanAll((cursor) => storage.scanTasks({ status }, SCAN_PAGE_SIZE, cursor, context))));
        }
        records.sort((a, b) => a.id - b.id);
        for (const record of records) {
            const owned = await scanAll((cursor) => storage.scanConversations({ ownerTaskId: record.id }, SCAN_PAGE_SIZE, cursor, context));
            const conversations = owned.map((conversation) => conversation.id).sort((a, b) => a - b);
            const subject = blockedSubject(record);
            tasks[String(record.id)] = nodeOf(record, conversations, this.#blocking.blocked(subject));
            live.set(String(record.id), subject);
        }
        return { value: { tasks }, records: live };
    }
}
/**
 * Derive the mount's operations from one publication, apply them, and hand the revision to every observer; one that
 * throws is reported through `report`, and the others still get it.
 */
function advance(mount, publication, context, blocked, report) {
    const ops = [];
    // Nodes this publication set or deleted, over the mount's value.
    const changed = new Map();
    const node = (key) => changed.has(key) ? changed.get(key) : mount.value.tasks[key];
    for (const change of publication.changes) {
        if (change.type !== "task")
            continue;
        const record = change.value;
        const key = String(record.id);
        const previous = node(key);
        if (record.state.status === "terminal") {
            mount.records.delete(key);
            if (previous === undefined)
                continue;
            ops.push(["d", ["tasks", key]]);
            changed.set(key, undefined);
            continue;
        }
        const subject = blockedSubject(record);
        mount.records.set(key, subject);
        const next = nodeOf(record, previous?.conversations ?? [], blocked(subject));
        if (previous !== undefined && JSON.stringify(next) === JSON.stringify(previous))
            continue;
        ops.push(["s", ["tasks", key], next]);
        changed.set(key, next);
    }
    // After the tasks, so a conversation created with its owner task in one commit finds the owner's node. Change order
    // within a publication is unspecified, so each owner's list is sorted again.
    const created = new Map();
    for (const change of publication.changes) {
        if (change.type !== "conversation" || change.value.owner === undefined)
            continue;
        const key = String(change.value.owner.taskId);
        if (node(key) !== undefined)
            created.set(key, [...(created.get(key) ?? []), change.value.id]);
    }
    for (const [key, ids] of created) {
        const conversations = [...node(key).conversations, ...ids].sort((a, b) => a - b);
        ops.push(["s", ["tasks", key, "conversations"], conversations]);
    }
    publish(mount, ops, context, report);
}
/** Apply `ops` to the mount and hand the revision to every observer; one that throws is reported. */
function publish(mount, ops, context, report) {
    if (ops.length === 0)
        return;
    mount.value = applyImmutable(mount.value, ops);
    const frameContext = withoutAbortSignal(context);
    const call = { kind: "value", value: mount.value, ops, retired: false };
    for (const observer of [...mount.observers])
        contained(() => observer.advance(call, frameContext), report);
}
function nodeOf(record, conversations, blocked) {
    return {
        id: record.id,
        kind: record.kind,
        conversationId: record.conversationId,
        ...(record.owner === undefined ? {} : { owner: record.owner }),
        background: record.background,
        abortRequested: record.abortRequested,
        state: stateOf(record),
        conversations,
        ...(blocked === undefined ? {} : { blocked }),
    };
}
function stateOf(record) {
    const state = record.state;
    switch (state.status) {
        case "pending":
        case "running":
            return { status: state.status, phase: phaseOf(state.checkpoint) };
        case "waiting":
            return { status: "waiting", phase: phaseOf(state.checkpoint), on: [...state.on], policy: state.policy };
        case "sleeping":
            return {
                status: "sleeping",
                phase: phaseOf(state.checkpoint),
                ...(state.until === undefined ? {} : { until: state.until }),
                ...(state.signals === undefined
                    ? {}
                    : { signals: state.signals.map(({ signal, key }) => ({ signal, key })) }),
            };
        // Terminal records never reach here: they leave the graph.
        case "completing":
        case "terminal":
            return { status: "completing", outcome: state.outcome.status };
    }
}
function phaseOf(checkpoint) {
    return checkpoint.phase;
}
//# sourceMappingURL=task-graph.js.map