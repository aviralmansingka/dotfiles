import type { Context } from "@earendil-works/chord/context";
import type { TaskRuntime } from "../types.ts";
/** Stable provider-facing identity of one conversation. */
export type ProviderState = {
    sessionId: string;
};
/** Built-in provider state; every fork starts with a fresh identity instead of copying its parent. */
export declare const ProviderDoc: import("../types.ts").ConversationDocToken<ProviderState>;
/** Provider session IDs used by each task runtime's Harness. */
export declare const providerSessionsByRuntime: WeakMap<object, Set<string>>;
/**
 * Return and record the persisted provider identity without writing in the normal path. A legacy conversation without
 * `pi.provider` gets one migration commit whose `tx.doc()` runs `initial()` before the provider request starts.
 */
export declare function ensureProviderSessionId<I, S, R, H extends object>(runtime: TaskRuntime<I, S, R, H>, context: Context): Promise<string>;
//# sourceMappingURL=provider.d.ts.map