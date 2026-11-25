import { copyJson } from "@earendil-works/chord/json";
import { defineDoc } from "../documents.js";
import { UserEntry } from "../entries.js";
export const InboxDoc = defineDoc({
    kind: "pi.inbox",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ items: [] }),
    checkpointWhen: (value) => value.items.length === 0,
});
/**
 * Read what a boundary needs. Table reads must precede the commit's first table write, so callers prepare the
 * boundary at the start of their commit.
 */
export async function prepareBoundary(tx, conversationId, modes) {
    const head = (await tx.latestHeadMarker(conversationId))?.head;
    const inbox = await tx.doc(InboxDoc, conversationId);
    return {
        conversationId,
        inbox,
        steeringMode: modes.steeringMode,
        followUpMode: modes.followUpMode,
        head,
    };
}
/**
 * Place the queued items a boundary selects (spec §6): every write, the first or all steers, and at `final` the first
 * or all follow-ups. A selected reset turns a `postTools` boundary into `final`. Writes are placed first and user
 * items after them, each in ID order, so user items queued before a reset run in the new context. A write whose head
 * targets an entry before the active range, including a range started earlier in this commit, is stale. Selected and
 * stale items are removed positionally.
 */
export async function applyBoundary(tx, boundary, at, now) {
    const { conversationId, inbox } = boundary;
    const items = inbox.items;
    const reset = hasQueuedReset(items);
    const final = at === "final" || reset;
    const pick = (mode, queueMode) => {
        const indexes = items.flatMap((item, index) => (item.mode === mode ? [index] : []));
        return queueMode === "all" ? indexes : indexes.slice(0, 1);
    };
    const writes = items.flatMap((item, index) => (item.mode === "write" ? [index] : []));
    const users = [...pick("steer", boundary.steeringMode), ...(final ? pick("followUp", boundary.followUpMode) : [])];
    users.sort((a, b) => a - b);
    // `appendEntry()` copies the drafts' values; the items are removed only afterwards.
    let first;
    for (const index of writes) {
        const item = items[index];
        const draft = item.entry;
        if (isStale(boundary, draft)) {
            tx.settleSubmission(item.id, { status: "unanswered", reason: "stale" });
            continue;
        }
        const entry = await tx.appendEntry(conversationId, draft);
        if (draft.head !== undefined)
            boundary.head = draft.head === "self" ? entry.id : draft.head;
        tx.placeSubmission(item.id, entry.id);
        first ??= entry.id;
    }
    const placed = [];
    for (const index of users) {
        const item = items[index];
        const entry = await appendInput(tx, conversationId, item.content, item.entry, now);
        tx.placeSubmission(item.id, entry.id);
        placed.push(item.id);
        first ??= entry.id;
    }
    const removed = [...writes, ...users].sort((a, b) => b - a);
    for (const index of removed)
        items.splice(index, 1);
    return { users: placed, first, reset };
}
/** Append the entry an input is placed as: `entry`'s kind and data, or `pi.user`, with the user message of `content`. */
export function appendInput(tx, conversationId, content, entry, now) {
    const message = { role: "user", content, timestamp: now };
    if (entry === undefined)
        return tx.appendEntry(UserEntry, conversationId, { model: [message] });
    return tx.appendEntry(conversationId, { ...pickInputEntry(entry), model: [message] });
}
/** The kind and data of an input's entry as strict JSON, without other fields an untyped caller might pass. */
export function pickInputEntry({ kind, data }) {
    const picked = data === undefined ? { kind } : { kind, data };
    return copyJson(picked, { omitUndefinedProperties: true });
}
/**
 * Whether a write is display-only: it has no `model`, `head`, or `edits` (present counts, even if empty), so it changes
 * nothing the model sees and needs no boundary.
 */
export function isDisplayOnly(entry) {
    return entry.model === undefined && entry.head === undefined && entry.edits === undefined;
}
/** Whether a reset (`head: "self"` write) is queued; entries appended before it leave the active range when it lands. */
export function hasQueuedReset(items) {
    return items.some((item) => item.mode === "write" && item.entry.head === "self");
}
/** Whether a head write targets an entry before the active range, so placing it would bring back cut history. */
export function isStale(boundary, entry) {
    return typeof entry.head === "number" && boundary.head !== undefined && entry.head < boundary.head;
}
/** Remove a withdrawn submission's item; the caller settles the submission. */
export async function removeInboxItem(tx, conversationId, id) {
    const items = (await tx.doc(InboxDoc, conversationId)).items;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0)
        items.splice(index, 1);
}
/**
 * Withdraw the queued inputs of a conversation as `Conversation.abort()` and abort cascades do: each settles
 * `unanswered` with reason `aborted` and leaves the inbox, except those submitted with `onAbort: "keep"`; queued writes
 * stay for later placement.
 */
export function withdrawAbortedInputs(tx, conversationId) {
    return withdrawInputs(tx, conversationId, "aborted", (item) => item.onAbort !== "keep");
}
/**
 * Withdraw every queued input of a conversation, as a failed run does under `afterFailedRun: "withdraw"`: each settles
 * `unanswered` with `reason` and leaves the inbox; queued writes stay for later placement.
 */
export function withdrawQueuedInputs(tx, conversationId, reason) {
    return withdrawInputs(tx, conversationId, reason, () => true);
}
/** Settle and remove the queued inputs `withdraws` selects, keeping the order of the items that stay. */
async function withdrawInputs(tx, conversationId, reason, withdraws) {
    const items = (await tx.doc(InboxDoc, conversationId)).items;
    for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index];
        if (item.mode === "write" || !withdraws(item))
            continue;
        tx.settleSubmission(item.id, { status: "unanswered", reason });
        items.splice(index, 1);
    }
}
//# sourceMappingURL=inbox.js.map