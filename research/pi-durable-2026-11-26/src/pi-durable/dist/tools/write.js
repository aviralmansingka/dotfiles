import { obj, str } from "@earendil-works/pi-schema";
import { getOrThrow } from "../env/index.js";
import { defineTool } from "../harness/define.js";
import { requireEnv } from "./env.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { resolveToolPath } from "./path-utils.js";
const writeSchema = obj({
    path: str({ description: "Path to the file to write (relative or absolute)" }),
    content: str({ description: "Content to write to the file" }),
}, { open: true });
export function createWriteTool() {
    return defineTool({
        name: "write",
        description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
        parameters: writeSchema,
        async execute(args, api, context) {
            const { path, content } = args;
            const env = requireEnv(api);
            const absolutePath = await resolveToolPath(env, path, context);
            return withFileMutationQueue(env, absolutePath, async () => {
                if (context.abortSignal?.aborted)
                    throw new Error("Operation aborted");
                getOrThrow(await env.writeFile(absolutePath, content, context));
                if (context.abortSignal?.aborted)
                    throw new Error("Operation aborted");
                return { output: [{ type: "text", text: `Successfully wrote to ${path}` }] };
            }, context);
        },
    });
}
//# sourceMappingURL=write.js.map