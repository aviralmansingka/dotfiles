import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ponytail: check the report contract without a Markdown parser dependency
export function checkReport(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const lessons = [];
  const diagrams = [];
  let fence;
  let diagram;
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined;
        diagram = undefined;
      } else if (diagram) diagram.push(line);
      continue;
    }
    if (marker) {
      fence = marker[1];
      if (marker[2].trim() === "mermaid") diagrams.push(diagram = []);
      continue;
    }
    const heading = line.match(/^## (N\d+):\s+\S/);
    if (heading) lessons.push({ id: heading[1], start: index });
  }
  const errors = [];
  if (fence) errors.push("A code fence is not closed.");
  if (diagrams.length !== 1) errors.push("Use exactly one Mermaid node map.");
  if (!lessons.length) errors.push("The report has no node lessons.");
  const nodes = (diagrams[0] ?? []).flatMap(line => {
    const match = line.match(/^\s*(N\d+)\["[^"\n]+"\]\s*;?\s*$/);
    return match ? [match[1]] : [];
  });
  if (!nodes.length) errors.push("Define each map node on its own line as N01[\"Title\"].");
  const ids = lessons.map(lesson => lesson.id);
  for (const [label, list] of [["Map", nodes], ["Lesson", ids]]) {
    if (new Set(list).size !== list.length) errors.push(`${label} IDs must be unique.`);
  }
  for (const id of new Set([...nodes, ...ids])) {
    if (!nodes.includes(id) || !ids.includes(id)) errors.push(`${id} needs both a map node and a lesson.`);
  }
  for (const [index, lesson] of lessons.entries()) {
    const count = (lessons[index + 1]?.start ?? lines.length) - lesson.start;
    if (count >= 50) errors.push(`${lesson.id} has ${count} lines; the limit is 49.`);
  }
  const edges = (diagrams[0] ?? []).flatMap(line => {
    const match = line.match(/^\s*(N\d+)\s*-->\s*(N\d+)\s*;?\s*$/);
    return match ? [[match[1], match[2]]] : [];
  });
  for (const line of diagrams[0] ?? []) {
    const supported = /^\s*(?:flowchart TD\s*;?|%%.*|N\d+\["[^"\n]+"\]\s*;?|N\d+\s*-->\s*N\d+\s*;?)\s*$/;
    if (line.trim() && !supported.test(line)) errors.push(`Unsupported map line: ${line.trim()}`);
  }
  if (!(diagrams[0] ?? []).some(line => /^\s*flowchart TD\s*;?\s*$/.test(line))) {
    errors.push("Start the map with flowchart TD.");
  }
  for (const [from, to] of edges) {
    if (!nodes.includes(from) || !nodes.includes(to)) errors.push(`Edge ${from} --> ${to} has an unknown node.`);
    else if (ids.indexOf(from) >= ids.indexOf(to)) errors.push(`Put ${from} before ${to}; check the map for cycles.`);
  }
  return { errors, lessons: lessons.length, nodes: nodes.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error("Use: node check-report.mjs research.md");
    process.exitCode = 2;
  } else {
    try {
      const result = checkReport(readFileSync(process.argv[2], "utf8"));
      if (result.errors.length) {
        console.error(result.errors.join("\n"));
        process.exitCode = 1;
      } else console.log(`Passed: ${result.nodes} nodes, ${result.lessons} lessons, each below 50 lines.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
