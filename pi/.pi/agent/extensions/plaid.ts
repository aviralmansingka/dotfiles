import { Type, StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";

const PLAID_CLI = process.env.PLAID_CLI ?? `${process.env.HOME}/.local/bin/plaid-cli`;

function runPlaid(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(PLAID_CLI, args, { env: process.env });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(stdout.trim() || stderr.trim());
			else reject(new Error((stderr || stdout || `plaid-cli exited ${code}`).trim()));
		});
	});
}

const plaidTransactions = defineTool({
	name: "plaid_transactions",
	label: "Plaid Transactions",
	description: "Retrieve banking and/or investment transactions from linked Plaid institutions.",
	promptSnippet: "Retrieve personal financial transactions through the configured Plaid CLI",
	promptGuidelines: [
		"Use plaid_transactions for Chase, Bilt, E-Trade, Wells Fargo, Fidelity, and Human401K transaction retrieval when the user asks for personal finance transaction data.",
		"If the Plaid item is not linked yet, tell the user to run plaid-cli link <name> on homelab; do not ask for bank passwords in chat.",
	],
	parameters: Type.Object({
		kind: StringEnum(["banking", "investments", "both"] as const, {
			description: "Transaction type to retrieve. Use both unless the user asks for one type.",
			default: "both",
		}),
		item: Type.Optional(Type.String({ description: "Optional Plaid item nickname, e.g. chase, bilt, etrade, wells-fargo, fidelity, human401k." })),
		start_date: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD. Defaults to 90 days ago." })),
		end_date: Type.Optional(Type.String({ description: "End date YYYY-MM-DD. Defaults to today." })),
	}),
	async execute(_toolCallId, params) {
		const base = (command: string) => {
			const args = [command, "--json"];
			if (params.item) args.push("--item", params.item);
			if (params.start_date) args.push("--start-date", params.start_date);
			if (params.end_date) args.push("--end-date", params.end_date);
			return args;
		};

		if (params.kind === "banking") {
			const text = await runPlaid(base("transactions"));
			return { content: [{ type: "text", text }], details: JSON.parse(text) };
		}
		if (params.kind === "investments") {
			const text = await runPlaid(base("investment-transactions"));
			return { content: [{ type: "text", text }], details: JSON.parse(text) };
		}

		const [banking, investments] = await Promise.all([
			runPlaid(base("transactions")).then(JSON.parse).catch((error) => ({ errors: [String(error)] })),
			runPlaid(base("investment-transactions")).then(JSON.parse).catch((error) => ({ errors: [String(error)] })),
		]);
		const result = { banking, investments };
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
	},
});

const plaidStatus = defineTool({
	name: "plaid_status",
	label: "Plaid Status",
	description: "Show Plaid CLI credential and linked-institution status.",
	promptSnippet: "Check configured Plaid CLI credentials and linked institutions",
	parameters: Type.Object({}),
	async execute() {
		const text = await runPlaid(["status", "--json"]);
		return { content: [{ type: "text", text }], details: JSON.parse(text) };
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(plaidTransactions);
	pi.registerTool(plaidStatus);
	pi.registerCommand("plaid-status", {
		description: "Show Plaid CLI status",
		handler: async (_args, ctx) => ctx.ui.notify(await runPlaid(["status"]), "info"),
	});
}
