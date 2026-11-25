/**
 * A script's result as the model reads it, copied from the coding agent's code mode: a "Script completed/failed"
 * header with the wall time, the script's text items (`==> text N/M <==` when there are several), its `console` lines
 * in one `<console_output>` block, the returned value, and on failure the error with the calls already made. Text past
 * the token budget is cut to its start and end, with the complete text in a temp file; images are saved to temp files
 * too, with their path next to them, because a script has no other way to hand their bytes on.
 */
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { CodemodeResult } from "@earendil-works/pi-codemode/portable";
type Item = TextContent | ImageContent;
/** Writes a file of the result under a fixed name; its path, or why it could not be written. */
export type OutputFile = (name: string, data: string | Uint8Array) => Promise<{
    readonly kind: "saved";
    readonly path: string;
} | {
    readonly kind: "failed";
    readonly error: string;
}>;
/** The tool's output limits, which the Harness enforces by cutting without a spill file: results stay inside them. */
type Limits = {
    readonly maxBytes: number;
    readonly maxLines: number;
};
/** Default token budget for script output. */
export declare const DEFAULT_MAX_OUTPUT_TOKENS = 10000;
/** The tool result's content for a script's result, and the path of the complete text when it was cut. */
export declare function formatResult(result: CodemodeResult, options: {
    /** Images `models.generateImages()` returned; when the script showed none, the result says so. */
    readonly generatedImages: number;
    readonly wallMs: number;
    readonly maxOutputTokens: number;
    readonly calls: readonly {
        name: string;
        status: string;
    }[];
    readonly limits: Limits;
    readonly write: OutputFile;
}): Promise<{
    content: Item[];
    fullOutputPath?: string;
}>;
export {};
//# sourceMappingURL=output.d.ts.map