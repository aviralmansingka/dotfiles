import { type SyncInitInput } from "@silvia-odwyer/photon/photon_rs.js";
import type { ImageProcessor } from "../tools/image-processor.ts";
/**
 * An `ImageProcessor` on Photon (Rust compiled to WebAssembly), for `createCodingTools({ images })`. `wasm` is
 * Photon's `photon_rs_bg.wasm` as bytes or as a compiled module: `@earendil-works/pi-durable/images/node` reads it from
 * the installed package, `@earendil-works/pi-durable/images/cloudflare` imports it as a Workers module. Elsewhere, such
 * as a browser, fetch the file and pass its bytes. Photon loads once per process; later calls reuse the first `wasm`.
 *
 * An image already upright, in a format providers take inline, and within the limits is returned as it is, once it
 * decodes. Otherwise it is turned upright by its EXIF orientation, scaled to the
 * maximum width and height, and encoded as PNG or JPEG at falling qualities (JPEG first for JPEG sources), then at
 * smaller dimensions, 3/4 at a time, until the base64 fits. Formats providers do not take inline (BMP) become PNG.
 *
 * The work runs on the calling thread: about a second and a half for a 12-megapixel photo. Decoding takes the image's
 * RGBA size in WebAssembly memory, which does not shrink again; leave the processor out on memory-constrained hosts.
 */
export declare function createPhotonImages(wasm: SyncInitInput): ImageProcessor;
//# sourceMappingURL=index.d.ts.map