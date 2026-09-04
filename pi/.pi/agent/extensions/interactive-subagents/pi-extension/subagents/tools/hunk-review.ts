import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { runHunkReview } from "./hunk-review-core.mjs";

const Comment = Type.Object({
	filePath: Type.String(),
	summary: Type.String(),
	rationale: Type.Optional(Type.String()),
	hunk: Type.Optional(Type.Number()),
	hunkNumber: Type.Optional(Type.Number()),
	oldLine: Type.Optional(Type.Number()),
	newLine: Type.Optional(Type.Number()),
});

export default function hunkReviewTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "hunk_review",
		label: "Hunk Review",
		description:
			"Inspect the active Hunk session or add line-anchored review comments. This tool cannot edit or apply source code.",
		parameters: Type.Object({
			operation: StringEnum(["review", "comment_apply"] as const),
			includePatch: Type.Optional(Type.Boolean()),
			includeNotes: Type.Optional(Type.Boolean()),
			comments: Type.Optional(Type.Array(Comment)),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return {
				content: [{
					type: "text" as const,
					text: runHunkReview(
						ctx.cwd,
						params,
						(output: string) => truncateHead(output).content,
					),
				}],
			};
		},
	});
}
