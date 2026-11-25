import { defineExtension } from "../harness/define.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
export { createBashTool, createPowerShellTool, } from "./bash.js";
export { createEditTool } from "./edit.js";
export { DEFAULT_IMAGE_LIMITS, imageLimits, } from "./image-processor.js";
export { createReadTool } from "./read.js";
export { createWriteTool } from "./write.js";
/**
 * The `coding-tools` extension: `read`, `write`, `edit`, and `bash`; nothing installs it automatically.
 * `createPowerShellTool()` adds `powershell`. `images` prepares the images `read` returns (see `ReadToolOptions`).
 */
export function createCodingTools(options = {}) {
    return defineExtension({
        name: "coding-tools",
        tools: [createReadTool(options), createWriteTool(), createEditTool(), createBashTool()],
    });
}
/** `createCodingTools()` without an image processor. */
export const CodingTools = createCodingTools();
//# sourceMappingURL=index.js.map