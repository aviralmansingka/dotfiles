#!/usr/bin/env node
// evals/professor/score.mjs — score one professor eval run.
//
// Reads <dir>/calls.jsonl (the step log), <dir>/state.json (simulator state), <dir>/task.json, and
// <dir>/meta.json, then prints two scorecards:
//
//   policy    five checks on the teaching loop (comparable across runs)
//   metadata  instrument hygiene: titles, contextFiles, explain expectations
//
// A verify counts only on a question about the target fact, so a wrong answer
// on an unrelated node cannot fail the check.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: score.mjs <run-dir>");
	process.exit(2);
}

const readJson = (name, fallback) => {
	const p = join(dir, name);
	return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
};
const readJsonl = (name) => {
	const p = join(dir, name);
	return existsSync(p)
		? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
		: [];
};

const calls = readJsonl("calls.jsonl");
const state = readJson("state.json", {});
const task = readJson("task.json", readJson("scenario.json", { facts: [], target: "" }));
const meta = readJson("meta.json", {});

const STOP = new Set(
	("the a an of to in on for and or is are be it this that with as by from at " +
		"into than then when what which who how why does do can could should would " +
		"not no yes if but so we you your our their its").split(" "),
);
const tokens = (t) =>
	(t ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
		.filter((w) => w.length > 3 && !STOP.has(w));
const target = (task.facts ?? []).find((f) => f.id === task.target) ?? { keywords: [] };
const targetKeys = new Set((target.keywords ?? []).map((k) => k.toLowerCase()));
const onTarget = (c) => tokens(c.question).some((t) => targetKeys.has(t));

const isQuestion = (c) => c.t === "quiz" || c.t === "explain";
const firstAsk = calls.findIndex((c) => c.t === "ask_user_question");
const firstQuestion = calls.findIndex(isQuestion);
const firstLesson = calls.findIndex((c) => c.t === "lesson");
const flipAt = calls.findIndex((c) => c.t === "lesson" && c.flipped);
const approved = calls.some((c) => c.t === "ask_user_question" && /approve/i.test(c.reply || ""));

const contractFirst = firstAsk !== -1 && (firstQuestion === -1 || firstAsk < firstQuestion);
const probeFirst = firstQuestion !== -1 && (firstLesson === -1 || firstQuestion < firstLesson);
const taught = Boolean(state.taught) || flipAt !== -1;
const known = task.mode === "already-known";
const diagnostic = task.mode === "diagnostic";
const lessons = calls.filter((c) => c.t === "lesson").length;
// An already-known target needs no teaching: the check is that the learner
// holds it, and that it was verified on the target at some point.
const targetHeld = known
	? (state.unlocked ?? []).includes(task.target)
	: taught;
const verifiedAfter = known
	? calls.some((c) => isQuestion(c) && c.right && onTarget(c))
	: flipAt !== -1 && calls.slice(flipAt + 1)
		.some((c) => isQuestion(c) && c.right && (c.question ? onTarget(c) : true));

let run = 0;
let maxRun = 0;
for (const c of calls) {
	if (c.t === "lesson") run = 0;
	else if (isQuestion(c) && c.stage !== "probe" && !c.closing) {
		run += 1;
		maxRun = Math.max(maxRun, run);
	}
}

const questions = calls.filter((c) => isQuestion(c) && !c.closing);
const quizzes = questions.filter((c) => c.t === "quiz");
const titlesOk = questions.every((c) => c.title);
const contextOk = quizzes.length === 0 || quizzes.every((c) => c.hasContext);
const expectedOk = questions.filter((c) => c.t === "explain").every((c) => c.hasExpected);
const unneededTeaching =
	task.mode === "already-known" && calls.some((c) => c.t === "lesson" && c.targetTaught);

let checks;
if (diagnostic) {
	checks = {
		contractBeforeProbe: contractFirst,
		probeBeforeTeach: probeFirst,
		noTeaching: lessons === 0,
		questionRunOk: maxRun <= 2,
	};
} else if (known) {
	checks = {
		contractBeforeProbe: contractFirst,
		probeBeforeTeach: probeFirst,
		targetHeld,
		verifiedOnTarget: verifiedAfter,
		questionRunOk: maxRun <= 2,
		noUnneededTeaching: !unneededTeaching,
	};
} else {
	checks = {
		contractBeforeProbe: contractFirst,
		probeBeforeTeach: probeFirst,
		taughtCorrection: taught,
		verifiedAfterTeach: verifiedAfter,
		questionRunOk: maxRun <= 2,
	};
}
if (task.mode === "cold-start") {
	checks.entryQuestion = calls[0]?.t === "ask_user_question";
}
if (task.mode === "already-known") checks.noUnneededTeaching = !unneededTeaching;

// Task-declared feature checks. Each one is opt-in, so a task scores only the
// behaviors it can actually provoke.
const workspace = (rel) => join(dir, "workspace", rel);

if (Array.isArray(task.artifacts)) {
	checks.artifactOk = task.artifacts.every((f) => existsSync(workspace(f)));
}

if (Array.isArray(task.planContains)) {
	const planRel = task.planFile ?? `professor-lessons/${task.id}/session.md`;
	const plan = existsSync(workspace(planRel)) ? readFileSync(workspace(planRel), "utf8") : "";
	checks.planUpdated = plan.length > 0 && task.planContains.every((s) => plan.includes(s));
}

if (Array.isArray(task.bodyChecks)) {
	checks.derivationOk = task.bodyChecks.every((bc) =>
		calls.some((c) => c.t === "lesson" && c.body &&
			bc.groups.every((g) => g.some((w) => c.body.toLowerCase().includes(w.toLowerCase())))),
	);
}

if (task.channelCheck) {
	// The visible text next to a question must stay connective. Teaching goes
	// to the lesson tool, not the transcript.
	const sessions = join(dir, "sessions");
	let maxText = 0;
	if (existsSync(sessions)) {
		for (const name of readdirSync(sessions)) {
			if (!name.endsWith(".jsonl")) continue;
			for (const line of readFileSync(join(sessions, name), "utf8").split("\n")) {
				if (!line.startsWith("{")) continue;
				let o;
				try { o = JSON.parse(line); } catch { continue; }
				if (o.type !== "message") continue;
				const msg = o.message ?? {};
				if (msg.role !== "assistant") continue;
				const items = msg.content ?? [];
				const asks = items.some((i) => i?.type === "toolCall" && (i.name === "quiz" || i.name === "explain"));
				if (!asks) continue;
				const text = items.filter((i) => i?.type === "text").map((i) => i.text ?? "").join(" ").trim();
				maxText = Math.max(maxText, text.length);
			}
		}
	}
	checks.lessonChannel = maxText <= Number(task.channelLimit ?? 700);
}

const interjectionAt = calls.findIndex((c) => c.t === "interjection");
if (interjectionAt !== -1 && task.interjectionCheck) {
	const after = calls.slice(interjectionAt + 1);
	if (task.interjectionCheck === "repair") {
		let questions = 0;
		let taught = false;
		for (const c of after) {
			if (c.t === "lesson") { taught = true; break; }
			if (isQuestion(c) && c.stage !== "probe") questions += 1;
		}
		checks.repairNotVolume = taught && questions <= 1;
	}
	if (task.interjectionCheck === "anchor") {
		const next = after.find((c) => ["quiz", "explain", "lesson", "ask_user_question"].includes(c.t));
		checks.goalAnchored = Boolean(next) && (next.t === "ask_user_question" || next.t === "lesson");
	}
}

if (task.mode === "resume") {
	// A resume skips the goal grill and the probe by design.
	delete checks.contractBeforeProbe;
	delete checks.probeBeforeTeach;
	checks.resumeTeachesFirst = calls[0]?.t === "lesson";
	checks.noRepeatCancelled = !task.cancelledTitle ||
		!calls.some((c) => isQuestion(c) && (c.title ?? "").includes(task.cancelledTitle));
}

const score = Object.values(checks).filter(Boolean).length;
const report = {
	run: dir,
	task: state.task ?? state.scenario ?? task.id ?? null,
	mode: task.mode ?? "default",
	model: meta.model ?? null,
	skillHash: meta.skillHash ?? null,
	gitSha: meta.gitSha ?? null,
	learnerFinal: state.state ?? null,
	calls: calls.length,
	questions: questions.length,
	lessons: calls.filter((c) => c.t === "lesson").length,
	asks: calls.filter((c) => c.t === "ask_user_question").length,
	checks,
	score: `${score}/${Object.keys(checks).length}`,
	metadata: {
		titlesOk,
		contextOk,
		expectedOk,
		titleCoverage: `${questions.filter((c) => c.title).length}/${questions.length}`,
		contextCoverage: `${quizzes.filter((c) => c.hasContext).length}/${quizzes.length}`,
	},
	metrics: {
		approved,
		maxQuestionRun: maxRun,
		unrecognised: state.unrecognised ?? 0,
		flipAtCall: flipAt,
	},
};

console.log(`professor eval — ${dir}`);
console.log(`  model ${report.model ?? "?"}  skill ${(report.skillHash ?? "?").slice(0, 12)}  git ${(report.gitSha ?? "?").slice(0, 8)}`);
console.log(`  learner: ${report.learnerFinal}   calls=${report.calls} questions=${report.questions} lessons=${report.lessons} asks=${report.asks}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
console.log(`  metadata: titles ${titlesOk ? "ok" : "MISSING"} (${report.metadata.titleCoverage})  context ${contextOk ? "ok" : "MISSING"} (${report.metadata.contextCoverage})`);
console.log(`  max question run: ${maxRun}   unrecognised: ${report.metrics.unrecognised}`);
console.log(`  SCORE ${report.score}`);

writeFileSync(join(dir, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
