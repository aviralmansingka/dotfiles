import { StorageRequestError } from "../errors.js";
/**
 * Resolve a scan's order and position. A cursor continues in the order it was created with, whether the query repeats
 * that order or omits it; a different `order` throws. A cursor without an order, written before scans had one,
 * continues in the scan's default order.
 */
export function scanStart(requested, cursor, fallback) {
    if (requested !== undefined && requested !== "ascending" && requested !== "descending") {
        throw new StorageRequestError(`Invalid scan order: ${String(requested)}`);
    }
    if (cursor === undefined)
        return { order: requested ?? fallback, after: undefined };
    const { after, order: stored } = cursor;
    if (typeof after !== "number" || !Number.isSafeInteger(after))
        throw new StorageRequestError("Invalid storage cursor");
    if (stored !== undefined && stored !== "ascending" && stored !== "descending") {
        throw new StorageRequestError("Invalid storage cursor");
    }
    const order = stored ?? fallback;
    if (requested !== undefined && requested !== order) {
        throw new StorageRequestError(`The cursor continues a ${order} scan; the query asks for ${requested}`);
    }
    return { order, after };
}
/** The continuation of a scan whose last returned item has `id`. */
export function nextCursor(id, order) {
    return { after: id, order };
}
//# sourceMappingURL=scan.js.map