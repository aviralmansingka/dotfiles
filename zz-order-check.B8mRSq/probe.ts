import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

export default function (pi: ExtensionAPI) {
  pi.on("input", (event) => {
    writeFileSync(
      process.env.PI_IMAGE_DROP_PROBE!,
      JSON.stringify({
        text: event.text,
        images: event.images?.map(({ mimeType, data }) => ({
          mimeType,
          bytes: Buffer.from(data, "base64").length,
        })),
      }),
    );
    return { action: "handled" };
  });
}
