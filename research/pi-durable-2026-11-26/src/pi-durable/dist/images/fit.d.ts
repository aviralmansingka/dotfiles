import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { Extension } from "../harness/types.ts";
import { type ImageLimits, type ImageProcessor } from "../tools/image-processor.ts";
/** One image fitted by `fitImage`, with notes for the model saying what changed; or why it was left out. */
export type FittedImage = {
    readonly kind: "fitted";
    readonly image: ImageContent;
    readonly notes: readonly string[];
} | {
    readonly kind: "omitted";
    readonly note: string;
};
/** What `fitImages` did: nothing, or the content with its images fitted and notes for the model. */
export type FittedImages = {
    readonly kind: "unchanged";
} | {
    readonly kind: "fitted";
    readonly content: (TextContent | ImageContent)[];
    readonly notes: readonly string[];
};
/**
 * The image in `bytes`, declared as `mimeType`, prepared by `processor` to fit `limits`. Every image is decoded, as the
 * coding agent's are: one the provider would reject (damaged, or too large) never reaches the transcript, where it would
 * fail every later request. Its type is read from its bytes, since providers reject a declared type that differs. An
 * image the processor cannot prepare, or fails on, is left out with a note.
 */
export declare function fitImage(bytes: Uint8Array, mimeType: string, limits: ImageLimits, processor: ImageProcessor): Promise<FittedImage>;
/**
 * `content` with each image fitted by `fitImage` (malformed base64 is left out as an image that cannot be prepared);
 * text stays where it is. `unchanged` when every image came back as it was.
 */
export declare function fitImages(content: readonly (TextContent | ImageContent)[], limits: ImageLimits, processor: ImageProcessor): Promise<FittedImages>;
/**
 * The `fit-images` extension: an `afterTool` hook that fits the images of every result the model gets to the
 * conversation model's current limits (`fitImages`) before it is committed, whichever tool made them (an MCP tool, code
 * mode's `image()`), and says what changed in an `info` diagnostic (code `image`). Hooks of extensions installed before
 * it see the images unfitted. Nested calls' results are left as they are: the program that made the call gets them, not
 * the model.
 */
export declare function createFitImagesExtension(processor: ImageProcessor): Extension;
//# sourceMappingURL=fit.d.ts.map