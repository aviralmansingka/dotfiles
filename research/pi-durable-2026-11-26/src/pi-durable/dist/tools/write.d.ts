import { type Static } from "@earendil-works/pi-schema";
import type { ToolRegistration } from "../harness/types.ts";
declare const writeSchema: import("@earendil-works/pi-schema").Schema<{
    path: string;
    content: string;
}>;
export type WriteToolInput = Static<typeof writeSchema>;
export declare function createWriteTool(): ToolRegistration<typeof writeSchema>;
export {};
//# sourceMappingURL=write.d.ts.map