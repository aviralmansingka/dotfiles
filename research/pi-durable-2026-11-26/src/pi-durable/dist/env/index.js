export function ok(value) {
    return { ok: true, value };
}
export function err(error) {
    return { ok: false, error };
}
export function getOrThrow(result) {
    if (!result.ok)
        throw result.error;
    return result.value;
}
export function getOrUndefined(result) {
    return result.ok ? result.value : undefined;
}
export function toError(error) {
    if (error instanceof Error)
        return error;
    if (typeof error === "string")
        return new Error(error);
    try {
        return new Error(JSON.stringify(error));
    }
    catch {
        return new Error(String(error));
    }
}
export class FileError extends Error {
    code;
    path;
    constructor(code, message, path, cause) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = "FileError";
        this.code = code;
        this.path = path;
    }
}
export class ExecutionError extends Error {
    code;
    /** Spill file of a command that timed out or was aborted after its output crossed the spill thresholds. */
    spillPath;
    constructor(code, message, cause) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = "ExecutionError";
        this.code = code;
    }
}
export { rangeDecoder, StreamDecoder, startsWithBom } from "./decode.js";
export { LineScanner } from "./line-scan.js";
//# sourceMappingURL=index.js.map