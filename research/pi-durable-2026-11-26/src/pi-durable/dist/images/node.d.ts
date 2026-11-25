import type { ImageProcessor } from "../tools/image-processor.ts";
export type NodePhotonImagesOptions = {
    /**
     * Prepare images in a worker thread, so a large photo does not block the event loop for the second or two Photon
     * takes. Default `true`; `false` prepares them on the calling thread.
     */
    readonly worker?: boolean;
    /**
     * How long the worker stays after its last image before it exits, freeing Photon's WebAssembly memory, which never
     * shrinks while it lives. The next image starts a new one. Default 30 s.
     */
    readonly idleMs?: number;
};
/**
 * `createPhotonImages()` for Node and Bun, with Photon's WebAssembly read from the installed `@silvia-odwyer/photon`,
 * by default in a worker thread that keeps the process alive only while it prepares an image. A worker that cannot
 * start falls back to the calling thread. A single-file binary cannot resolve the package: read its own copy of
 * `photon_rs_bg.wasm` and call `createPhotonImages()`.
 */
export declare function createNodePhotonImages(options?: NodePhotonImagesOptions): Promise<ImageProcessor>;
//# sourceMappingURL=node.d.ts.map