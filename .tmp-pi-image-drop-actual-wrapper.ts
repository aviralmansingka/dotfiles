import imageDrop from "./pi/.pi/agent/extensions/image-drop.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, writeFileSync } from "node:fs";

export default function (pi: ExtensionAPI) {
  imageDrop(pi);
  pi.on("session_start", (_event, ctx) => {
    appendFileSync(process.env.PI_IMAGE_DROP_DEBUG!, `session_start:${ctx.mode}\n`);
    ctx.ui.onTerminalInput((data) => {
      appendFileSync(process.env.PI_IMAGE_DROP_DEBUG!, `terminal:${JSON.stringify(data)}\n`);
      return undefined;
    });
  });
  pi.on("input", (event) => {
    writeFileSync(
      process.env.PI_IMAGE_DROP_PROBE!,
      JSON.stringify({
        text: event.text,
        images: event.images?.map(({ type, mimeType, data }) => ({
          type,
          mimeType,
          bytes: Buffer.from(data, "base64").length,
        })),
      }),
    );
    return { action: "handled" };
  });
}
