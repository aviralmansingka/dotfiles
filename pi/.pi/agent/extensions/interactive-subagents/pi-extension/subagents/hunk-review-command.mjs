export function registerHunkReviewCommand(pi, executeSubagent) {
	pi.registerCommand("hunk-review", {
		description: "Review the active Hunk session asynchronously: /hunk-review [focus]",
		handler: async (args, ctx) => {
			const focus = args.trim();
			const task = [
				"Review the active Hunk session for this repository.",
				focus ? `Review focus: ${focus}` : "Review all changed code.",
				"Leave detailed findings as anchored Hunk comments.",
				"Do not edit or apply code. Return only a terse completion summary.",
			].join(" ");

			try {
				const result = await executeSubagent(
					{ agent: "hunk-review", task, cwd: ctx.cwd },
					ctx,
				);
				const details = result.details;
				const text = result.content
					.filter((item) => item.type === "text")
					.map((item) => item.text)
					.join("\n");
				if (details?.error) {
					ctx.ui.notify(text || details.error, "error");
					return;
				}
				ctx.ui.notify(
					`Hunk reviewer "${details?.name ?? "hunk-review"}" launched.`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					`Could not launch Hunk reviewer: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});
}
