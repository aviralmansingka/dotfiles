// Wrangler's default `CompiledWasm` rule turns this import into a `WebAssembly.Module`; Workers cannot compile
// WebAssembly from bytes at runtime. Other bundlers do not support it: use `createPhotonImages()` there.
import photonWasm from "@silvia-odwyer/photon/photon_rs_bg.wasm";
import { createPhotonImages } from "./index.js";
/** `createPhotonImages()` for Cloudflare Workers and Durable Objects, built with Wrangler. */
export function createCloudflarePhotonImages() {
    return createPhotonImages(photonWasm);
}
//# sourceMappingURL=cloudflare.js.map