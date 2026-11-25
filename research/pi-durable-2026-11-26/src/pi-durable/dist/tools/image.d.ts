/** Positional reads of a file of `size` bytes. */
export type ByteSource = {
    readonly size: number;
    read(offset: number, length: number): Promise<Uint8Array>;
};
/**
 * `detectSupportedImageMimeType` of a whole file, reading only its header and, for PNG, the chunk headers up to the
 * first `acTL` or `IDAT`.
 */
export declare function detectSupportedImageMimeTypeOf(source: ByteSource): Promise<string | undefined>;
export declare function detectSupportedImageMimeType(buffer: Uint8Array): string | undefined;
/**
 * The width and height an image of `mimeType` declares in its header, without decoding it: PNG's IHDR, GIF's screen,
 * WebP's VP8, VP8L, or VP8X chunk, JPEG's first SOF segment. `undefined` when the header cannot be read.
 */
export declare function imageDimensions(bytes: Uint8Array, mimeType: string): {
    readonly width: number;
    readonly height: number;
} | undefined;
//# sourceMappingURL=image.d.ts.map