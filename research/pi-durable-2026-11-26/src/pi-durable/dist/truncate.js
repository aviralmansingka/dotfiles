import { utf8ByteLength } from "@earendil-works/chord/output";
/**
 * Shared truncation utilities for tool outputs.
 *
 * Truncation is based on two independent limits - whichever is hit first wins:
 * - Line limit (default: 2000 lines)
 * - Byte limit (default: 50KB)
 *
 * Never returns partial lines. Tool output streams are bounded by `OutputBuffer` from `@earendil-works/chord/output` instead.
 */
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
// One implementation, shared with the output buffer.
export { utf8ByteLength };
function splitLinesForCounting(content) {
    if (content.length === 0)
        return [];
    const lines = content.split("\n");
    if (content.endsWith("\n"))
        lines.pop();
    return lines;
}
/**
 * Format bytes as human-readable size.
 */
export function formatSize(bytes) {
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    else if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`;
    }
    else {
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
}
/**
 * Truncate content from the head (keep first N lines/bytes).
 * Suitable for file reads where you want to see the beginning.
 *
 * Never returns partial lines. If first line exceeds byte limit,
 * returns empty content with firstLineExceedsLimit=true.
 */
export function truncateHead(content, options = {}) {
    return truncateHeadOf(content, { lines: splitLinesForCounting(content).length, bytes: utf8ByteLength(content) }, options);
}
/**
 * `truncateHead` of a text known by a prefix and its totals (`lines` counted like `truncateHead`, ignoring a trailing
 * newline). The prefix must be the whole text, or longer than `maxBytes + 1` UTF-8 bytes, or hold at least `maxLines`
 * newlines; then the result equals `truncateHead` of the whole text.
 */
export function truncateHeadOf(prefix, totals, options = {}) {
    const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const totalBytes = totals.bytes;
    const lines = splitLinesForCounting(prefix);
    const totalLines = totals.lines;
    // Check if no truncation needed
    if (totalLines <= maxLines && totalBytes <= maxBytes) {
        return {
            content: prefix,
            truncated: false,
            truncatedBy: null,
            totalLines,
            totalBytes,
            outputLines: totalLines,
            outputBytes: totalBytes,
            lastLinePartial: false,
            firstLineExceedsLimit: false,
            maxLines,
            maxBytes,
        };
    }
    // Check if first line alone exceeds byte limit
    const firstLineBytes = utf8ByteLength(lines[0]);
    if (firstLineBytes > maxBytes) {
        return {
            content: "",
            truncated: true,
            truncatedBy: "bytes",
            totalLines,
            totalBytes,
            outputLines: 0,
            outputBytes: 0,
            lastLinePartial: false,
            firstLineExceedsLimit: true,
            maxLines,
            maxBytes,
        };
    }
    // Collect complete lines that fit
    const outputLinesArr = [];
    let outputBytesCount = 0;
    let truncatedBy = "lines";
    for (let i = 0; i < lines.length && i < maxLines; i++) {
        const line = lines[i];
        const lineBytes = utf8ByteLength(line) + (i > 0 ? 1 : 0); // +1 for newline
        if (outputBytesCount + lineBytes > maxBytes) {
            truncatedBy = "bytes";
            break;
        }
        outputLinesArr.push(line);
        outputBytesCount += lineBytes;
    }
    // Without a byte break, only omitted lines prove the line limit was reached; otherwise a trailing newline exceeded bytes.
    if (truncatedBy !== "bytes")
        truncatedBy = outputLinesArr.length < totalLines ? "lines" : "bytes";
    const outputContent = outputLinesArr.join("\n");
    const finalOutputBytes = utf8ByteLength(outputContent);
    return {
        content: outputContent,
        truncated: true,
        truncatedBy,
        totalLines,
        totalBytes,
        outputLines: outputLinesArr.length,
        outputBytes: finalOutputBytes,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines,
        maxBytes,
    };
}
//# sourceMappingURL=truncate.js.map