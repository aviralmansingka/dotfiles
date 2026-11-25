import type { Api, Model } from "@earendil-works/pi-ai";
/** Limits an image the model sees must keep; the defaults below are the coding agent's. */
export type ImageLimits = {
    /** Pixels. Default 2000. */
    readonly maxWidth: number;
    /** Pixels. Default 2000. */
    readonly maxHeight: number;
    /** Bytes of base64. Default 4.5 MiB, below Anthropic's 5 MB. */
    readonly maxBytes: number;
};
export declare const DEFAULT_IMAGE_LIMITS: ImageLimits;
/** The limits of images sent to `model`: its `inputLimits.images.resize`, each absent one `DEFAULT_IMAGE_LIMITS`'s. */
export declare function imageLimits(model: Model<Api> | undefined): ImageLimits;
/** An image the model can take: a supported format, within the limits, as base64. */
export type PreparedImage = {
    readonly data: string;
    readonly mimeType: string;
    /** Set when the image was resized: its size before and after, for the model to map coordinates back. */
    readonly resized?: {
        readonly from: {
            readonly width: number;
            readonly height: number;
        };
        readonly to: {
            readonly width: number;
            readonly height: number;
        };
    };
    /** The original format, set when it differs from `mimeType`: BMP becomes PNG, a large PNG may become JPEG. */
    readonly convertedFrom?: string;
};
/**
 * Decodes, orients, resizes, and re-encodes images so the model can take them. `read` uses one when given; without
 * one, it passes supported images within the byte limit through as they are. `@earendil-works/pi-durable/images`
 * provides a Photon-based one.
 */
export type ImageProcessor = {
    /**
     * The image, prepared to fit `limits`, or `undefined` when it cannot be decoded or made to fit. A promise, so a
     * processor can do the work off the event loop.
     */
    prepare(bytes: Uint8Array, mimeType: string, limits: ImageLimits): Promise<PreparedImage | undefined>;
};
/** What preparing changed, for the model: the format, and the size with the factor that maps coordinates back. */
export declare function preparedNotes(image: PreparedImage): string[];
/** Formats every provider takes inline; others, such as BMP, need converting. */
export declare const INLINE_IMAGE_TYPES: ReadonlySet<string>;
/**
 * Standard base64 of `bytes`. `btoa` takes a binary string, built 8 KiB at a time: a single `String.fromCharCode`
 * call with megabytes of arguments overflows the stack.
 */
export declare function toBase64(bytes: Uint8Array): string;
/** The bytes of standard base64 `data`. */
export declare function fromBase64(data: string): Uint8Array;
/** The length of the base64 of `byteLength` bytes. */
export declare function base64Length(byteLength: number): number;
//# sourceMappingURL=image-processor.d.ts.map