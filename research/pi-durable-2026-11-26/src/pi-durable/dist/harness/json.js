import { appendText } from "@earendil-works/chord/delta";
/**
 * Assign `value` at `target[key]` leaf by leaf. Chord records a container assignment as one full set and only emits an
 * append when a string leaf is reassigned with a longer string, so writing the partial whole would store and publish the
 * complete message on every flush. That append costs a compare of the whole string, though; where `plan` says what a
 * string member grew by, and the committed string plus that text has the new string's length, the text is appended
 * with `appendText()` instead.
 */
export function assignJson(target, key, value, plan) {
    if (plan?.kind === "keep")
        return;
    // Every target is a document container: JSON members or items, whatever its declared type names them.
    const slots = target;
    // A `__proto__` member the target lacks reads through to Object.prototype; merging into that would pollute every
    // object in the process. Other inherited members are functions, which are not merged into.
    const current = key === "__proto__" && !Object.hasOwn(slots, key) ? undefined : slots[key];
    const fields = plan?.kind === "fields" ? plan.fields : undefined;
    if (isRecord(current) && isRecord(value)) {
        for (const name of Object.keys(current))
            if (!Object.hasOwn(value, name))
                delete current[name];
        for (const [name, child] of Object.entries(value))
            assignJson(current, name, child, fields?.get(name));
        return;
    }
    if (Array.isArray(current) && Array.isArray(value) && current.length <= value.length) {
        const items = current;
        for (let index = 0; index < value.length; index++) {
            if (index < items.length)
                assignJson(items, index, value[index], fields?.get(index));
            else
                items.push(value[index]);
        }
        return;
    }
    if (plan?.kind === "append" &&
        typeof current === "string" &&
        typeof value === "string" &&
        !Array.isArray(target) &&
        current.length + plan.text.length === value.length) {
        // The cast names what the checks above established: `target[key]` is a string.
        appendText(target, String(key), plan.text);
        return;
    }
    if (current !== value)
        slots[key] = value;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=json.js.map