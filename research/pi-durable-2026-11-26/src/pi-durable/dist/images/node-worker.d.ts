import type { ImageLimits, PreparedImage } from "../tools/image-processor.ts";
/** One request: the image to prepare, and its ID for the reply. */
export type PrepareRequest = {
    readonly id: number;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly limits: ImageLimits;
};
/** The reply to a request: its result, or why it failed. */
export type PrepareReply = {
    readonly kind: "prepared";
    readonly id: number;
    readonly result: PreparedImage | undefined;
} | {
    readonly kind: "failed";
    readonly id: number;
    readonly error: string;
};
//# sourceMappingURL=node-worker.d.ts.map