import { SystemEntry } from "../entries.js";
import { idFromNumber } from "../ids.js";
const SCAN_PAGE_SIZE = 256;
const EXCLUDED_STOP_REASONS = new Set(["aborted", "error", "deferred"]);
const MISSING_RESULT_TEXT = "Tool result unavailable: history ends before this call completed.";
/**
 * Capture the bounds of the current context, or of the context cut off at the visible entry `at`. The newest entry
 * and head marker are known from the Session's commits, so the current bounds usually cost no Storage read. Run this
 * on the Session line; entries at or below the tail are immutable, so `deriveContext()` can then scan them off the
 * line.
 */
export async function captureContextBounds(session, storage, conversationId, context, at, 
/** Set when `at` is known to be visible, as an entry of a range of the conversation is. */
visible = false) {
    let tail;
    if (at === undefined) {
        tail = await session.latestEntryId(conversationId, context);
        if (tail === undefined)
            return undefined;
    }
    else {
        if (!visible && (await storage.entry(conversationId, at, context)) === undefined) {
            throw new Error(`Entry ${at} is not visible from conversation ${conversationId}`);
        }
        tail = at;
    }
    return { head: await session.latestHeadMarker(conversationId, tail, context), tail };
}
/**
 * `readContext()` that reuses `previous`, an earlier range of the same conversation: with the same head marker, only
 * entries after its tail are scanned. Returns the view and the range to pass to the next read. A range outlives the
 * read, so its entries are frozen like `MemoryStorage` records, and the returned view has its own arrays. A caller that
 * keeps the range for `advanceRange()` checks `current` again, synchronously where it installs it: a commit can be
 * published between this function's return and the caller's continuation.
 */
export async function readContextFrom(session, storage, conversationId, context, at, previous) {
    const visible = at !== undefined && previous !== undefined && rangeEntry(previous, at) !== undefined;
    const bounds = await session.readOnLine((line) => captureContextBounds(session, line, conversationId, context, at, visible));
    if (bounds === undefined)
        return { view: emptyView(), range: undefined };
    freezeJson(bounds.head);
    const current = at === undefined;
    let range;
    if (previous === undefined || previous.bounds.head?.id !== bounds.head?.id) {
        const entries = freezeJson(await scanRange(storage, conversationId, rangeQuery(bounds), context));
        range = deriveRange(bounds, entries, current);
    }
    else if (bounds.tail === previous.bounds.tail) {
        range = previous;
    }
    else if (bounds.tail < previous.bounds.tail) {
        range = deriveRange(bounds, previous.entries.filter((entry) => entry.id <= bounds.tail), false);
    }
    else {
        const minEntryId = idFromNumber(previous.bounds.tail + 1);
        const added = await scanRange(storage, conversationId, { minEntryId, maxEntryId: bounds.tail }, context);
        range = extendRange(previous, bounds, freezeJson(added), current);
    }
    // Entries committed while the scan ran off the line are not in the range: it is current only if none was.
    if (range.current && session.knownLatestEntryId(conversationId) !== range.bounds.tail) {
        range = { ...range, current: false };
    }
    const { view } = range;
    return {
        view: {
            ...view,
            entries: [...view.entries],
            contributions: [...view.contributions],
            messages: [...view.messages],
        },
        range,
    };
}
/** Committed context of one conversation: bounds captured on the Session line, entries derived off it. */
export async function readContext(session, storage, conversationId, context, at) {
    const bounds = await session.readOnLine((line) => captureContextBounds(session, line, conversationId, context, at));
    return deriveContext(storage, conversationId, bounds, context);
}
/**
 * Derive the active transcript and model context of one conversation within captured bounds.
 *
 * H = newest visible head marker; the range runs from `H.head` (or transcript start) through the tail. Per target,
 * the newest edit in the range wins. Context entries are H followed by the range's non-head entries.
 */
export async function deriveContext(storage, conversationId, bounds, context) {
    if (bounds === undefined)
        return emptyView();
    return deriveRange(bounds, await scanRange(storage, conversationId, rangeQuery(bounds), context), false).view;
}
function emptyView() {
    return { head: undefined, entries: [], contributions: [], messages: [] };
}
/** Entry `id` of `range`, by binary search: a range holds its entries in ID order, every one visible from its conversation. */
export function rangeEntry(range, id) {
    const entries = range.entries;
    let low = 0;
    let high = entries.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const entry = entries[middle];
        if (entry.id === id)
            return entry;
        if (entry.id < id)
            low = middle + 1;
        else
            high = middle - 1;
    }
    return undefined;
}
/**
 * `range` with the entries one commit appended to its conversation, in ID order, without reading Storage: the
 * conversation's own new entries are its newest, and a new head marker's head never lies before the range's start.
 * A range that is not `current` stays as it is; the next read extends it from Storage. `undefined` drops the range.
 */
export function advanceRange(range, appended) {
    if (!range.current || appended.length === 0)
        return range;
    const added = freezeJson(appended);
    let head = range.bounds.head;
    for (const entry of added)
        if (entry.head !== undefined)
            head = entry;
    const bounds = { head, tail: added.at(-1).id };
    if (head?.id === range.bounds.head?.id)
        return extendRange(range, bounds, added, true);
    const start = head.head;
    // Heads only move forward: compaction keeps a later entry, a reset starts at itself, an older head is stale.
    if (range.bounds.head !== undefined && start < range.bounds.head.head)
        return undefined;
    const entries = [...range.entries, ...added].filter((entry) => entry.id >= start);
    return deriveRange(bounds, entries, true);
}
/** Derive the context view from the entries scanned within `bounds`. */
function deriveRange(bounds, entries, current) {
    const edits = new Map();
    // Edits of every entry in the range count, including older head markers that `selectActive()` drops.
    for (const entry of entries)
        for (const edit of entry.edits ?? [])
            edits.set(edit.target, edit);
    const active = selectActive(bounds.head, entries);
    const contributions = active.map((entry) => contribute(entry, edits.get(entry.id)));
    const { settled, open } = settle([], contributions.flat());
    const baseline = findBaseline(bounds.head, active);
    const messages = leadWithSystem([...settled, ...orderToolResults(open)], baseline);
    const view = { head: bounds.head, entries: active, contributions, messages };
    return { bounds, entries, view, edited: new Set(edits.keys()), settled, open, baseline, current };
}
/**
 * `previous` extended by the entries `added` after its tail under the same head marker: only their contributions and
 * the open messages are derived. An added edit can change an earlier entry, so it derives the whole range again.
 */
function extendRange(previous, bounds, added, current) {
    const entries = [...previous.entries, ...added];
    if (added.some((entry) => entry.edits !== undefined || entry.head !== undefined || previous.edited.has(entry.id))) {
        return deriveRange(bounds, entries, current);
    }
    const contributions = added.map((entry) => contribute(entry, undefined));
    const { settled, open } = settle(previous.settled, [...previous.open, ...contributions.flat()]);
    const baseline = previous.baseline !== undefined ? previous.baseline : findBaseline(bounds.head, added);
    const view = {
        head: bounds.head,
        entries: [...previous.view.entries, ...added],
        contributions: [...previous.view.contributions, ...contributions],
        messages: leadWithSystem([...settled, ...orderToolResults(open)], baseline),
    };
    return { bounds, entries, view, edited: previous.edited, settled, open, baseline, current };
}
/**
 * The baseline among `entries`, oldest first: the system message of the first `pi.system` entry after the head
 * marker, or of the transcript without one, when generation wrote it with every section and tool in effect. After a
 * head marker it always does, and omits the retained `pi.system` entries. Without one it does when it saw no system
 * message before, which holds unless an earlier entry carries one, even if an edit omits it later. An edit that targets
 * the baseline contributes other messages, or none, so none leads; a later entry does not take its place.
 */
function findBaseline(head, entries) {
    for (const entry of entries) {
        if (head !== undefined && entry.id <= head.id)
            continue;
        if (SystemEntry.is(entry))
            return entry.model?.find((message) => message.role === "system") ?? null;
        if (head === undefined && carriesSystemMessage(entry))
            return null;
    }
    return undefined;
}
/** Whether an entry's own messages, or the replacement messages of its edits, include a system message. */
function carriesSystemMessage(entry) {
    const isSystem = (message) => message.role === "system";
    return ((entry.model?.some(isSystem) ?? false) ||
        (entry.edits?.some((edit) => edit.action === "replace" && edit.messages.some(isSystem)) ?? false));
}
/**
 * Move the first system message to the front when only user messages precede it, or when it is the baseline's. A run's
 * input is committed before generation renders the system prompt, so a transcript starts with the input followed by
 * the baseline, and the range after a compaction with the kept history, assistant messages included. Providers treat
 * only a leading system message as the initial prompt and tool set; without it, a later tool change rewrites the
 * request's tool list and invalidates the whole prompt cache. Only the first system message moves, so replaying
 * system messages in order gives the same sections and tools. Any other system message, before an assistant message,
 * stays where it was committed: moving it would change what it means to the model.
 */
function leadWithSystem(messages, baseline) {
    const index = messages.findIndex((message) => message.role === "system");
    if (index <= 0)
        return messages;
    const system = messages[index];
    if (system !== baseline && messages.slice(0, index).some((message) => message.role !== "user")) {
        return messages;
    }
    return [system, ...messages.slice(0, index), ...messages.slice(index + 1)];
}
/** One active entry's model messages after its edit and excluded stop reasons, before tool result ordering. */
function contribute(entry, edit) {
    if (edit?.action === "omit")
        return Object.freeze([]);
    const contributed = edit?.action === "replace" ? edit.messages : (entry.model ?? []);
    return Object.freeze(contributed.filter((message) => message.role !== "assistant" || !EXCLUDED_STOP_REASONS.has(message.stopReason)));
}
/** Objects `freezeJson()` froze with everything in them. `Object.isFrozen()` holds for shallow freezes too. */
const deeplyFrozen = new WeakSet();
/** Freeze a JSON value and everything in it. */
function freezeJson(value) {
    if (value === null || typeof value !== "object" || deeplyFrozen.has(value))
        return value;
    for (const child of Object.values(value))
        freezeJson(child);
    Object.freeze(value);
    deeplyFrozen.add(value);
    return value;
}
/**
 * Move the ordered messages before the last assistant message of `open` to `settled`. `orderToolResults()` of a
 * sequence equals the concatenation over its parts when each later part starts with an assistant message.
 */
function settle(settled, open) {
    const last = open.findLastIndex((message) => message.role === "assistant");
    if (last <= 0)
        return { settled, open };
    return { settled: [...settled, ...orderToolResults(open.slice(0, last))], open: open.slice(last) };
}
/** The visible range of `bounds`: from the head marker's head, or transcript start, through the tail. */
function rangeQuery(bounds) {
    const head = bounds.head;
    return head === undefined ? { maxEntryId: bounds.tail } : { minEntryId: head.head, maxEntryId: bounds.tail };
}
/** Visible entries within `range`, oldest first. */
async function scanRange(storage, conversationId, range, context) {
    const entries = [];
    let cursor;
    do {
        const page = await storage.scanEntries({ conversationId, ...range }, SCAN_PAGE_SIZE, cursor, context);
        entries.push(...page.items);
        cursor = page.next;
    } while (cursor !== undefined);
    return entries.reverse();
}
/** The head marker followed by the range's non-head entries, or the whole range without a marker. */
function selectActive(head, range) {
    return head === undefined ? range : [head, ...range.filter((entry) => entry.head === undefined)];
}
/**
 * Place each assistant's tool results directly after it in call order. Results are taken from the messages before
 * the next assistant; a missing result is synthesized and unmatched results are dropped.
 */
export function orderToolResults(messages) {
    const ordered = [];
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.role === "toolResult")
            continue;
        ordered.push(message);
        if (message.role !== "assistant")
            continue;
        const calls = message.content.filter((content) => content.type === "toolCall");
        if (calls.length === 0)
            continue;
        const results = new Map();
        for (let next = index + 1; next < messages.length && messages[next].role !== "assistant"; next++) {
            const candidate = messages[next];
            if (candidate.role === "toolResult" && !results.has(candidate.toolCallId)) {
                results.set(candidate.toolCallId, next);
            }
        }
        for (const call of calls) {
            const resultIndex = results.get(call.id);
            ordered.push(resultIndex === undefined ? missingResult(call, message.timestamp) : messages[resultIndex]);
        }
    }
    return ordered;
}
function missingResult(call, timestamp) {
    return freezeJson({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: MISSING_RESULT_TEXT }],
        isError: true,
        details: { reason: "missing_result" },
        timestamp,
    });
}
//# sourceMappingURL=context.js.map