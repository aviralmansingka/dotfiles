import type { JsonValue } from "@earendil-works/chord/json";
/** How `assignJson()` writes one value instead of assigning it leaf by leaf. */
export type AssignPlan = 
/** The string grew by `text` since it was last assigned: append it, when the lengths agree. */
{
    readonly kind: "append";
    readonly text: string;
}
/** Leave the value as it is; the caller writes it. */
 | {
    readonly kind: "keep";
}
/** Plans for some members or items of a container. */
 | {
    readonly kind: "fields";
    readonly fields: ReadonlyMap<string | number, AssignPlan>;
};
/**
 * Assign `value` at `target[key]` leaf by leaf. Chord records a container assignment as one full set and only emits an
 * append when a string leaf is reassigned with a longer string, so writing the partial whole would store and publish the
 * complete message on every flush. That append costs a compare of the whole string, though; where `plan` says what a
 * string member grew by, and the committed string plus that text has the new string's length, the text is appended
 * with `appendText()` instead.
 */
export declare function assignJson<T extends object, K extends keyof T & (string | number)>(target: T, key: K, value: T[K] & JsonValue, plan?: AssignPlan): void;
//# sourceMappingURL=json.d.ts.map