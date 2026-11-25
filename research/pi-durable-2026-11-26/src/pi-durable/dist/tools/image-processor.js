export const DEFAULT_IMAGE_LIMITS = { maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 * 1024 * 1024 };
/** The limits of images sent to `model`: its `inputLimits.images.resize`, each absent one `DEFAULT_IMAGE_LIMITS`'s. */
export function imageLimits(model) {
    const resize = model?.inputLimits?.images?.resize;
    return {
        maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
        maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
        maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
    };
}
/** What preparing changed, for the model: the format, and the size with the factor that maps coordinates back. */
export function preparedNotes(image) {
    const notes = [];
    if (image.convertedFrom !== undefined)
        notes.push(`Converted from ${image.convertedFrom} to ${image.mimeType}.`);
    if (image.resized !== undefined) {
        const { from, to } = image.resized;
        const scale = (from.width / to.width).toFixed(2);
        notes.push(`Resized from ${from.width}x${from.height} to ${to.width}x${to.height}. Multiply coordinates by ${scale} to map them to the original.`);
    }
    return notes;
}
/** Formats every provider takes inline; others, such as BMP, need converting. */
export const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/**
 * Standard base64 of `bytes`. `btoa` takes a binary string, built 8 KiB at a time: a single `String.fromCharCode`
 * call with megabytes of arguments overflows the stack.
 */
export function toBase64(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += 8192) {
        // `apply` takes any array-like, though its type asks for an array.
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
    }
    return btoa(parts.join(""));
}
/** The bytes of standard base64 `data`. */
export function fromBase64(data) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
        bytes[index] = binary.charCodeAt(index);
    return bytes;
}
/** The length of the base64 of `byteLength` bytes. */
export function base64Length(byteLength) {
    return Math.ceil(byteLength / 3) * 4;
}
//# sourceMappingURL=image-processor.js.map