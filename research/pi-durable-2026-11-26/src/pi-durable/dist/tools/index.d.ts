import { type ReadToolOptions } from "./read.ts";
export { type BashExecution, type BashPrepare, type BashToolInput, type BashToolOptions, createBashTool, createPowerShellTool, type PowerShellToolInput, type PowerShellToolOptions, } from "./bash.ts";
export { createEditTool, type EditToolDetails, type EditToolInput } from "./edit.ts";
export { DEFAULT_IMAGE_LIMITS, type ImageLimits, type ImageProcessor, imageLimits, type PreparedImage, } from "./image-processor.ts";
export { createReadTool, type ReadToolDetails, type ReadToolInput, type ReadToolOptions } from "./read.ts";
export { createWriteTool, type WriteToolInput } from "./write.ts";
/**
 * The `coding-tools` extension: `read`, `write`, `edit`, and `bash`; nothing installs it automatically.
 * `createPowerShellTool()` adds `powershell`. `images` prepares the images `read` returns (see `ReadToolOptions`).
 */
export declare function createCodingTools(options?: ReadToolOptions): import("../index.ts").Extension<import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    path: string;
    content: string;
}>> | import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    command: string;
    timeout?: number | undefined;
}>> | import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}>, import("./read.ts").ReadToolDetails> | import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    path: string;
    edits: {
        oldText: string;
        newText: string;
    }[];
}>, import("./edit.ts").EditToolDetails>>;
/** `createCodingTools()` without an image processor. */
export declare const CodingTools: import("../index.ts").Extension<import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    path: string;
    content: string;
}>> | import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    command: string;
    timeout?: number | undefined;
}>> | import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}>, import("./read.ts").ReadToolDetails> | import("../index.ts").ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    path: string;
    edits: {
        oldText: string;
        newText: string;
    }[];
}>, import("./edit.ts").EditToolDetails>>;
//# sourceMappingURL=index.d.ts.map