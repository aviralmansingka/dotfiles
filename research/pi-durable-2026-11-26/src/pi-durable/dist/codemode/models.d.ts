/**
 * `models.*` for code mode scripts, copied from the coding agent's code mode: the model catalog, and classifier and
 * image model calls.
 *
 * The catalog functions are host globals, journaled like any global. `models.classify()` and `models.generateImages()`
 * are paid effects, so each runs as an internal tool (`callers: ["tools"]`, a reserved name, hidden from scripts'
 * tool listings): a nested durable call with its own task, live row, abort, usage accounting, and replay policy. The
 * code mode tool turns a script's call of the global into a call of that tool.
 */
import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import type { Models } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "../harness/types.ts";
/** Reserved names of code mode's internal tools; they are never listed to scripts or the model. */
export declare const CODEMODE_INTERNAL_PREFIX = "pi.codemode.";
export declare const CLASSIFY_TOOL = "pi.codemode.models.classify";
export declare const GENERATE_IMAGES_TOOL = "pi.codemode.models.generateImages";
/** The global a script calls, by internal tool. */
export declare const MODEL_CALLS: Readonly<Record<string, string>>;
/** The catalog functions, host globals of the `models` namespace. */
export declare const CATALOG_GLOBALS: readonly ["models.getModelsOfType", "models.getAvailableOfType", "models.getModelOfType"];
/** `models.classify()` and `models.generateImages()` calls one script may have in flight; the rest wait. */
export declare const MAX_CONCURRENT_MODEL_CALLS = 4;
export declare const MODELS_DESCRIPTION: string;
/** The catalog functions: what a script's call of `name` with `args` (the argument list) resolves to. */
export declare function catalogCall(name: string, args: unknown, models: Models, context: Context): Promise<JsonValue | undefined>;
/** The internal tools behind `models.classify()` and `models.generateImages()`. */
export declare function createModelTools(): ToolRegistration[];
//# sourceMappingURL=models.d.ts.map