// evals/professor/stubs.ts — user simulator instruments for the professor eval.
//
// The simulator holds a set of facts. Each fact is known from the start, or
// unlocked when a lesson carries its teach keywords. A fact may also carry a
// wrong claim: the simulator asserts it until the fact unlocks. Questions are
// matched against fact keywords, so the learner can answer about any node it
// holds, not just the planted misconception.
//
// Load with: pi --no-extensions -e evals/professor/stubs.ts

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { Type } from "typebox";

interface Fact {
	id: string;
	claim: string;
	keywords: string[];
	known?: boolean;
	wrong?: string;
	teachGroups?: string[][];
}

interface Task {
	id: string;
	topic: string;
	goal: string;
	target: string;
	grill: string[];
	facts: Fact[];
	commandOutput?: string;
}

const taskPath = process.env.EVAL_TASK ?? "";
const logPath = process.env.EVAL_LOG ?? "/tmp/professor-eval.jsonl";
const statePath = process.env.EVAL_STATE ?? "/tmp/professor-eval-state.json";
const maxCalls = Number(process.env.EVAL_MAX_CALLS ?? 80);

const task: Task = JSON.parse(readFileSync(taskPath, "utf8"));
const target = task.facts.find((f) => f.id === task.target);

interface LearnerState {
	taught: boolean;
	lessons: number;
	quiz: number;
	explain: number;
	grill: number;
	unrecognised: number;
	afterFlip: number;
	calls: number;
	unlocked: string[];
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
	calls: 0,
	unlocked: task.facts.filter((f) => f.known).map((f) => f.id),
	state: "misconception",
};

// A learner who already holds the target starts in the correct state.
if (target?.known) state.state = "correct";

function persist(): void {
	writeFileSync(statePath, JSON.stringify({ task: task.id, ...state }, null, 2));
}

function log(row: Record<string, unknown>): void {
	appendFileSync(logPath, `${JSON.stringify({ task: task.id, ...row })}\n`);
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

function hits(text: string, keywords: string[]): number {
	const set = new Set(tokens(text));
	return keywords.reduce((n, k) => n + (set.has(k.toLowerCase()) ? 1 : 0), 0);
}

function bestOption(
	options: { label?: string; value?: string; description?: string }[],
	targetClaim: string,
): number {
	const targetTokens = new Set(tokens(targetClaim));
	let best = 0;
	let bestScore = -1;
	options.forEach((o, i) => {
		// Some models put the claim in `description` and use a bare letter as
		// the label. Match on all three fields; the learner reads them all.
		const text = `${o.label ?? ""} ${o.value ?? ""} ${o.description ?? ""}`;
		let score = 0;
		for (const t of tokens(text)) if (targetTokens.has(t)) score += 1;
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	});
	return best;
}

/** Match a question to the held fact with the most keyword hits. */
function answer(text: string): { claim: string; why: string } {
	let bestFact: Fact | undefined;
	let bestScore = 0;
	let bestUnlocked = false;
	for (const f of task.facts) {
		const score = hits(text, f.keywords);
		if (score === 0) continue;
		const unlocked = state.unlocked.includes(f.id);
		if (
			score > bestScore ||
			(score === bestScore && unlocked && !bestUnlocked)
		) {
			bestFact = f;
			bestScore = score;
			bestUnlocked = unlocked;
		}
	}
	if (bestFact) {
		if (bestUnlocked) {
			return { claim: bestFact.claim, why: `known:${bestFact.id}` };
		}
		state.unrecognised += 1;
		return {
			claim: bestFact.wrong ?? "I do not know.",
			why: `misconception:${bestFact.id}`,
		};
	}
	state.unrecognised += 1;
	if (target && state.unlocked.includes(target.id)) {
		return { claim: target.claim, why: "fallback-taught" };
	}
	return { claim: target?.wrong ?? "I do not know.", why: "fallback" };
}

/** Unlock every fact whose teach groups all appear in a lesson body. */
function learnFromLesson(body: string): string[] {
	const text = body.toLowerCase();
	const unlocked: string[] = [];
	for (const f of task.facts) {
		if (state.unlocked.includes(f.id)) continue;
		if (!f.teachGroups?.length) continue;
		const matched = f.teachGroups.every((g) =>
			g.some((k) => text.includes(k.toLowerCase())),
		);
		if (matched) {
			state.unlocked.push(f.id);
			unlocked.push(f.id);
		}
	}
	if (target && unlocked.includes(target.id)) {
		state.taught = true;
		state.state = "correct";
	}
	return unlocked;
}

const CLOSING = "The learner has left the session. Stop asking questions and give the closing summary.";
const closing = (): boolean =>
	state.calls >= maxCalls || (state.taught && state.afterFlip >= 5);

function overBudget(): boolean {
	if (state.calls < maxCalls) return false;
	log({ t: "budget", calls: state.calls });
	return true;
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
			state.calls += 1;
			if (overBudget() || closing()) {
				log({ t: "quiz", seq: state.quiz, closing: true, question: String(params.question).slice(0, 200) });
				return { content: [{ type: "text" as const, text: CLOSING }], details: {} };
			}
			state.quiz += 1;
			if (state.taught) state.afterFlip += 1;
			const text = `${params.question} ${params.details ?? ""}`;
			const { claim, why } = answer(text);
			const idx = bestOption(params.options ?? [], claim);
			const chosen = params.options?.[idx];
			const correctValue = params.correctAnswer ?? params.options?.[0]?.value;
			const isRight =
				chosen?.value === correctValue ||
				chosen?.label === correctValue ||
				chosen?.description === correctValue;
			log({
				t: "quiz",
				seq: state.quiz,
				title: params.title ?? null,
				stage: params.stage ?? null,
				hasContext: Array.isArray(params.contextFiles) && params.contextFiles.length > 0,
				question: String(params.question).slice(0, 200),
				rule: why,
				chosen: `${chosen?.label ?? ""} ${chosen?.description ?? ""}`.trim().slice(0, 120),
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
			state.calls += 1;
			if (overBudget() || closing()) {
				log({ t: "explain", seq: state.explain, closing: true, question: String(params.question).slice(0, 200) });
				return { content: [{ type: "text" as const, text: CLOSING }], details: {} };
			}
			state.explain += 1;
			if (state.taught) state.afterFlip += 1;
			const text = `${params.question} ${params.details ?? ""}`;
			const { claim, why } = answer(text);
			const right = !why.startsWith("misconception") && why !== "fallback";
			log({
				t: "explain",
				seq: state.explain,
				title: params.title ?? null,
				stage: params.stage ?? null,
				hasExpected: Boolean(params.expected),
				hasContext: Array.isArray(params.contextFiles) && params.contextFiles.length > 0,
				question: String(params.question).slice(0, 200),
				rule: why,
				right,
			});
			persist();
			return {
				content: [{
					type: "text" as const,
					text: `Learner answered: "${claim}"\nVerdict: ${right ? "correct" : "incorrect"} (${why}).`,
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
			state.calls += 1;
			state.lessons += 1;
			const body = String(params.body ?? "");
			const unlocked = learnFromLesson(body);
			const targetTaught =
				target?.teachGroups?.every((g) => g.some((k) => body.toLowerCase().includes(k.toLowerCase()))) ?? false;
			log({
				t: "lesson",
				seq: state.lessons,
				title: params.title ?? null,
				bodyLen: body.length,
				unlocked,
				flipped: unlocked.includes(task.target),
				targetTaught,
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
			state.calls += 1;
			state.grill += 1;
			const q = String(params.question ?? "");
			const isApproval = /approv/i.test(q) || /by the end of this session/i.test(q);
			const reply = isApproval
				? "Approve"
				: state.taught
					? "I have to stop now. Give me the summary."
					: task.grill.shift() ?? "Go ahead.";
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
		description: "Hands-on command check. Returns the task's canned output. Used by the professor eval harness.",
		parameters: Type.Object({
			command: Type.String(),
			prediction: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
		}),
		async execute(_id: string, params: any) {
			state.calls += 1;
			const out = task.commandOutput ?? "(no output)";
			log({ t: "run-command", command: String(params.command).slice(0, 160), hasPrediction: Boolean(params.prediction) });
			return {
				content: [{ type: "text" as const, text: `Command: ${params.command}\nOutput: ${out}` }],
				details: { output: out },
			};
		},
	});
}
