// evals/professor/stubs.ts — scripted learner instruments for the professor eval.
//
// Replaces the interactive tools with deterministic versions that answer from a
// scenario profile. The learner knows what the scenario says it knows, holds the
// planted misconception until a lesson teaches the correcting claim, and never
// pretends to know more. Every call is logged as JSONL so score.mjs can audit
// the run without reading the transcript.
//
// Load with: pi --no-extensions -e evals/professor/stubs.ts

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { Type } from "typebox";

interface KnownFact {
	id: string;
	claim: string;
	keywords: string[];
}

interface Gap {
	id: string;
	wrong: string;
	right: string;
	keywords: string[];
}

interface Scenario {
	id: string;
	topic: string;
	goal: string;
	known: KnownFact[];
	gap: Gap;
	grill: string[];
	teachGroups: string[][];
	commandOutput?: string;
}

const scenarioPath = process.env.EVAL_SCENARIO ?? "";
const logPath = process.env.EVAL_LOG ?? "/tmp/professor-eval.jsonl";
const statePath = process.env.EVAL_STATE ?? "/tmp/professor-eval-state.json";

const scenario: Scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));

interface LearnerState {
	taught: boolean;
	lessons: number;
	quiz: number;
	explain: number;
	grill: number;
	unrecognised: number;
	afterFlip: number;
	state: "misconception" | "correct";
}

const state: LearnerState = {
	taught: false,
	lessons: 0,
	quiz: 0,
	explain: 0,
	grill: 0,
	unrecognised: 0,
	afterFlip: 0,
	state: "misconception",
};

// After the learner has seen the correction and answered twice, they leave.
// Instrument calls return a closing notice instead of a question, so a run
// ends without an external kill.
const CLOSING = "The learner has left the session. Stop asking questions and give the closing summary.";
const closing = (): boolean => state.taught && state.afterFlip >= 3;

function persist(): void {
	writeFileSync(statePath, JSON.stringify({ scenario: scenario.id, ...state }, null, 2));
}

function log(row: Record<string, unknown>): void {
	appendFileSync(logPath, `${JSON.stringify({ scenario: scenario.id, ...row })}\n`);
}

const STOP = new Set(
	("the a an of to in on for and or is are be it this that with as by from at " +
		"into than then when what which who how why does do can could should would " +
		"not no yes if but so we you your our their its").split(" "),
);

function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 3 && !STOP.has(w));
}

function overlap(haystack: string, needles: string[]): number {
	const h = new Set(tokens(haystack));
	return needles.reduce((n, k) => n + (h.has(k.toLowerCase()) ? 1 : 0), 0);
}

function matches(text: string, keywords: string[]): boolean {
	return overlap(text, keywords) >= Math.min(2, keywords.length);
}

function bestOption(options: { label?: string; value?: string }[], target: string): number {
	const targetTokens = new Set(tokens(target));
	let best = 0;
	let bestScore = -1;
	options.forEach((o, i) => {
		const text = `${o.label ?? ""} ${o.value ?? ""}`;
		let score = 0;
		for (const t of tokens(text)) if (targetTokens.has(t)) score += 1;
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	});
	return best;
}

function answer(text: string): { pick: string; why: string } {
	const gapMatch = matches(text, scenario.gap.keywords);
	if (gapMatch && state.taught) return { pick: scenario.gap.right, why: "gap-known" };
	if (gapMatch) return { pick: scenario.gap.wrong, why: "misconception" };
	for (const fact of scenario.known) {
		if (matches(text, fact.keywords)) return { pick: fact.claim, why: `known:${fact.id}` };
	}
	state.unrecognised += 1;
	return { pick: scenario.gap.wrong, why: "unrecognised" };
}

export default function stubs(pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "quiz",
		description:
			"Multiple-choice check. Returns the learner's chosen option and grade. Used by the professor eval harness.",
		parameters: Type.Object({
			title: Type.Optional(Type.String()),
			question: Type.String(),
			details: Type.Optional(Type.String()),
			options: Type.Array(
				Type.Object({
					label: Type.String(),
					value: Type.Optional(Type.String()),
					description: Type.Optional(Type.String()),
				}),
			),
			correctAnswer: Type.Optional(Type.String()),
			explanation: Type.Optional(Type.String()),
			contextFiles: Type.Optional(Type.Array(Type.String())),
			stage: Type.Optional(Type.String()),
			multiSelect: Type.Optional(Type.Boolean()),
		}),
		async execute(_id: string, params: any) {
			state.quiz += 1;
			if (closing()) {
				log({ t: "quiz", seq: state.quiz, closing: true });
				return { content: [{ type: "text" as const, text: CLOSING }], details: {} };
			}
			if (state.taught) state.afterFlip += 1;
			const text = `${params.question} ${params.details ?? ""}`;
			const { pick, why } = answer(text);
			const idx = bestOption(params.options ?? [], pick);
			const chosen = params.options?.[idx];
			const correctValue = params.correctAnswer ?? params.options?.[0]?.value;
			const isRight = chosen?.value === correctValue || chosen?.label === correctValue;
			log({
				t: "quiz",
				seq: state.quiz,
				title: params.title ?? null,
				stage: params.stage ?? null,
				hasContext: Array.isArray(params.contextFiles) && params.contextFiles.length > 0,
				rule: why,
				chosen: chosen?.label ?? null,
				right: isRight,
			});
			persist();
			return {
				content: [{
					type: "text" as const,
					text: `Learner picked "${chosen?.label ?? "?"}" (${why}). ${isRight ? "Correct." : "Incorrect."} Correct answer: ${correctValue}.`,
				}],
				details: { chosen, correct: isRight },
			};
		},
	});

	pi.registerTool({
		name: "explain",
		label: "explain",
		description: "Prose retrieval. Returns the learner's free-text answer and a verdict. Used by the professor eval harness.",
		parameters: Type.Object({
			title: Type.Optional(Type.String()),
			question: Type.String(),
			details: Type.Optional(Type.String()),
			expected: Type.Optional(Type.String()),
			contextFiles: Type.Optional(Type.Array(Type.String())),
			stage: Type.Optional(Type.String()),
		}),
		async execute(_id: string, params: any) {
			state.explain += 1;
			if (closing()) {
				log({ t: "explain", seq: state.explain, closing: true });
				return { content: [{ type: "text" as const, text: CLOSING }], details: {} };
			}
			if (state.taught) state.afterFlip += 1;
			const text = `${params.question} ${params.details ?? ""}`;
			const { pick, why } = answer(text);
			const right = why === "gap-known" || why.startsWith("known:");
			log({
				t: "explain",
				seq: state.explain,
				title: params.title ?? null,
				stage: params.stage ?? null,
				hasExpected: Boolean(params.expected),
				rule: why,
				right,
			});
			persist();
			return {
				content: [{
					type: "text" as const,
					text: `Learner answered: "${pick}"\nVerdict: ${right ? "correct" : "incorrect"} (${why}).`,
				}],
				details: { verdict: right ? "correct" : "incorrect" },
			};
		},
	});

	pi.registerTool({
		name: "lesson",
		label: "lesson",
		description: "Deliver one teaching node. Used by the professor eval harness; the body is logged.",
		parameters: Type.Object({ title: Type.String(), body: Type.String() }),
		async execute(_id: string, params: any) {
			state.lessons += 1;
			const body = String(params.body ?? "").toLowerCase();
			const groups = scenario.teachGroups.map((g) => g.some((k) => body.includes(k.toLowerCase())));
			const hit = groups.filter(Boolean).length;
			const taughtNow = hit === groups.length;
			if (taughtNow) {
				state.taught = true;
				state.state = "correct";
			}
			log({
				t: "lesson",
				seq: state.lessons,
				title: params.title ?? null,
				bodyLen: String(params.body ?? "").length,
				teachGroupsHit: hit,
				teachGroupsNeeded: groups.length,
				flipped: taughtNow,
			});
			persist();
			return {
				content: [{ type: "text" as const, text: `Lesson "${params.title}" shown. Learner waits.` }],
				details: { status: "opened" },
			};
		},
	});

	pi.registerTool({
		name: "ask_user_question",
		label: "ask_user_question",
		description: "Ask the learner one question. Scripted answers. Used by the professor eval harness.",
		parameters: Type.Object({
			question: Type.String(),
			details: Type.Optional(Type.String()),
			options: Type.Optional(Type.Array(Type.Object({ label: Type.String(), value: Type.Optional(Type.String()) }))),
			multiSelect: Type.Optional(Type.Boolean()),
		}),
		async execute(_id: string, params: any) {
			state.grill += 1;
			const q = String(params.question ?? "");
			const isApproval = /do you approve|approve this|approve the goal/i.test(q);
			const reply = isApproval
				? "Approve"
				: state.taught
					? "I have to stop now. Give me the summary."
					: scenario.grill.shift() ?? "Go ahead.";
			log({ t: "ask_user_question", seq: state.grill, question: q.slice(0, 200), reply });
			persist();
			return {
				content: [{ type: "text" as const, text: `Learner answered: ${reply}` }],
				details: { answer: reply },
			};
		},
	});

	pi.registerTool({
		name: "run-command",
		label: "run-command",
		description: "Hands-on command check. Returns the scenario's canned output. Used by the professor eval harness.",
		parameters: Type.Object({
			command: Type.String(),
			prediction: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
		}),
		async execute(_id: string, params: any) {
			const out = scenario.commandOutput ?? "(no output)";
			log({ t: "run-command", command: String(params.command).slice(0, 160), hasPrediction: Boolean(params.prediction) });
			return {
				content: [{ type: "text" as const, text: `Command: ${params.command}\nOutput: ${out}` }],
				details: { output: out },
			};
		},
	});
}
