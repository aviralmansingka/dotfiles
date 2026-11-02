#!/usr/bin/env node
// evals/professor/summarize.mjs — table of scores for a set of runs.
//
// Usage: summarize.mjs evals/professor/runs/<dir> ...

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
	console.error("usage: summarize.mjs <run-dir>...");
	process.exit(2);
}

const rows = [];
for (const dir of dirs) {
	const p = join(dir, "score.json");
	if (!existsSync(p)) continue;
	const r = JSON.parse(readFileSync(p, "utf8"));
	rows.push(r);
}

const byScenario = new Map();
for (const r of rows) {
	const list = byScenario.get(r.scenario) ?? [];
	list.push(r);
	byScenario.set(r.scenario, list);
}

for (const [scenario, list] of byScenario) {
	const scores = list.map((r) => Number(r.score.split("/")[0]));
	const max = list[0].score.split("/")[1];
	console.log(`\n${scenario}  n=${list.length}  scores=${scores.join(",")}  best=${Math.max(...scores)}/${max}`);
	for (const key of Object.keys(list[0].checks)) {
		const pass = list.filter((r) => r.checks[key]).length;
		console.log(`  ${key.padEnd(22)} ${pass}/${list.length}`);
	}
	const titles = list.filter((r) => r.metadata?.titlesOk).length;
	const ctx = list.filter((r) => r.metadata?.contextOk).length;
	console.log(`  titles ok ${titles}/${list.length}   context ok ${ctx}/${list.length}`);
}
