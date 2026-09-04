import { execFileSync } from "node:child_process";

export function buildHunkReviewInvocation(params) {
	if (params.operation === "review") {
		const args = ["session", "review", "--repo", "."];
		if (params.includePatch) args.push("--include-patch");
		if (params.includeNotes) args.push("--include-notes");
		args.push("--json");
		return { args };
	}

	if (params.operation !== "comment_apply") {
		throw new Error(`Unsupported Hunk review operation: ${params.operation}`);
	}
	if (!params.comments?.length) {
		throw new Error("comment_apply requires at least one comment");
	}
	return {
		args: ["session", "comment", "apply", "--repo", ".", "--stdin", "--json"],
		input: JSON.stringify({
			comments: params.comments.map((comment) => ({
				...comment,
				author: "Hunk reviewer",
			})),
		}),
	};
}

export function runHunkReview(cwd, params, formatOutput = (output) => output) {
	const invocation = buildHunkReviewInvocation(params);
	try {
		const output = execFileSync("hunk", invocation.args, {
			cwd,
			encoding: "utf8",
			input: invocation.input,
			maxBuffer: 10 * 1024 * 1024,
			timeout: 30_000,
		});
		return formatOutput(output) || "Hunk command completed.";
	} catch (error) {
		const stderr = error.stderr?.toString().trim();
		throw new Error(stderr || error.message);
	}
}
