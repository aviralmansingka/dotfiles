import { type Static } from "@earendil-works/pi-schema";
import type { ToolRegistration } from "../harness/types.ts";
import { type TruncationResult } from "../truncate.ts";
import { type ImageProcessor } from "./image-processor.ts";
declare const readSchema: import("@earendil-works/pi-schema").Schema<{
    path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}>;
export type ReadToolInput = Static<typeof readSchema>;
export type ReadToolDetails = {
    /** How the shown text was cut; the text itself is the result content. */
    truncation?: Omit<TruncationResult, "content">;
    /**
     * Id of the conversation's model when the image was read, if it has no image input. For UIs only: the model gets
     * pi-ai's placeholder per request, so the stored result stays right after a switch to a vision model.
     */
    imageUnsupportedByModel?: string;
};
export type ReadToolOptions = {
    /** Resizes and converts images; without one, images within `DEFAULT_IMAGE_LIMITS.maxBytes` pass through as they are. */
    readonly images?: ImageProcessor;
};
/**
 * Reads text files and images. Remarks about truncation, continuation, and image processing are diagnostics; the content
 * is only file text, or one image. Programs get the text, or the image's `ImageContent`.
 */
export declare function createReadTool(options?: ReadToolOptions): ToolRegistration<typeof readSchema, ReadToolDetails>;
export {};
//# sourceMappingURL=read.d.ts.map