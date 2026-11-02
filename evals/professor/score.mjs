#!/usr/bin/env node
// evals/professor/score.mjs — score one professor eval run.
//
// Reads <dir>/calls.jsonl and <dir>/state.json, then prints a human summary.
// The checks are policy checks, not taste checks: did the professor agree a
// goal before probing, probe before teaching, teach the planted correction,
// verify it afterwards, and avoid asking more than two questions in a row.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: score.mjs <run-dir>");
	process.exit(2);
}

const callsPath = join(dir, "calls.jsonl");
const statePath = join(dir, "state.json");
const calls = existsSync(callsPath)
	? readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
	: [];
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};

const isQuestion = (c) => c.t === "quiz" || c.t === "explain";
const firstAsk = calls.findIndex((c) => c.t === "ask_user_question");
const firstQuestion = calls.findIndex(isQuestion);
const firstLesson = calls.findIndex((c) => c.t === "lesson");
const flipAt = calls.findIndex((c) => c.t === "lesson" && c.flipped);
const approved = calls.some((c) => c.t === "ask_user_question" && /approve/i.test(c.reply || ""));

const contractFirst = firstAsk !== -1 && (firstQuestion === -1 || firstAsk < firstQuestion);
const probeFirst = firstQuestion !== -1 && (firstLesson === -1 || firstQuestion < firstLesson);
const taught = Boolean(state.taught) || flipAt !== -1;
const verifiedAfter = flipAt !== -1 && calls.slice(flipAt + 1).some((c) => isQuestion(c) && c.right);

let run = 0;
let maxRun = 0;
for (const c of calls) {
	if (c.t === "lesson") run = 0;
	else if (isQuestion(c) && c.stage !== "probe") {
		run += 1;
		maxRun = Math.max(maxRun, run);
	}
}

const quizzes = calls.filter((c) => c.t === "quiz");
const titled = calls.filter((c) => isQuestion(c) && c.title).length;
const withContext = quizzes.filter((c) => c.hasContext).length;
const questions = calls.filter(isQuestion).length;

const checks = {
	contractBeforeProbe: contractFirst,
	probeBeforeTeach: probeFirst,
	taughtCorrection: taught,
	verifiedAfterTeach: verifiedAfter,
	questionRunOk: maxRun <= 2,
};

const score = Object.values(checks).filter(Boolean).length;
const report = {
	run: dir,
	scenario: state.scenario ?? null,
	learnerFinal: state.state ?? null,
	calls: calls.length,
	questions,
	lessons: calls.filter((c) => c.t === "lesson").length,
	asks: calls.filter((c) => c.t === "ask_user_question").length,
	checks,
	score: `${score}/5`,
	metrics: {
		approved,
		maxQuestionRun: maxRun,
		titleCoverage: `${titled}/${questions}`,
		contextCoverage: `${withContext}/${quizzes.length}`,
		unrecognised: state.unrecognised ?? 0,
		flipAtCall: flipAt,
	},
};

console.log(`professor eval — ${dir}`);
console.log(`  learner: ${report.learnerFinal}   calls=${report.calls} questions=${report.questions} lessons=${report.lessons} asks=${report.asks}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
console.log(`  max question run: ${maxRun}   titles: ${report.metrics.titleCoverage}   context: ${report.metrics.contextCoverage}   unrecognised: ${report.metrics.unrecognised}`);
console.log(`  SCORE ${report.score}`);

writeFileSync(join(dir, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
