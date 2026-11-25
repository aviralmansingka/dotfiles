import { type Static } from "@earendil-works/pi-schema";
import type { ToolRegistration } from "../harness/types.ts";
declare const editSchema: import("@earendil-works/pi-schema").Schema<{
    path: string;
    edits: {
        oldText: string;
        newText: string;
    }[];
}>;
export type EditToolInput = Static<typeof editSchema>;
export type EditToolDetails = {
    diff: string;
    patch: string;
    firstChangedLine?: number;
};
export declare function createEditTool(): ToolRegistration<typeof editSchema, EditToolDetails>;
export {};
//# sourceMappingURL=edit.d.ts.map