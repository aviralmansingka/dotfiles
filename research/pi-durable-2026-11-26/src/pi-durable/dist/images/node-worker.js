// The worker thread of `createNodePhotonImages()`: Photon prepares images here, off the caller's event loop.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import { createPhotonImages } from "./index.js";
const port = parentPort;
if (port === null)
    throw new Error("The Photon image worker needs a parent thread");
const images = createPhotonImages(readFileSync(createRequire(import.meta.url).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm")));
port.on("message", (request) => {
    void images.prepare(request.bytes, request.mimeType, request.limits).then((result) => port.postMessage({ kind: "prepared", id: request.id, result }), (error) => port.postMessage({
        kind: "failed",
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
    }));
});
//# sourceMappingURL=node-worker.js.map