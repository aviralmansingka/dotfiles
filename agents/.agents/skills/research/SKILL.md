---
name: research
description: >-
  Use a research orchestrator to map a task, send each node to one researcher,
  and write sourced ASD-STE100 lessons. Return the full Mermaid map and a link
  to the Markdown report. Use for deep research with subagents and short lessons.
  Use professor for interactive tutoring.
---

# Research

Make a map of the questions needed to answer the user's research task.
Give each node to one researcher.
The orchestrator checks the evidence and writes the lessons.
Each lesson has at most 49 physical Markdown lines.
The final reply contains the full Mermaid map and a Markdown link.

## Launcher mode

Use this mode outside the `research-orchestrator` agent.

1. Start one `research-orchestrator` with the `subagent` tool.
2. Put the user's full request and known context in its task.
3. Include the topic, scope, source paths, depth, and output destination, when known.
4. Include the current working directory and the user's exclusions.
5. Tell the parent that research has started.
6. End the turn while the orchestrator works.
7. When its result arrives, show its full Mermaid map in chat.
8. Link to its actual `research.md` file.

Use a short, unique name for the orchestrator.
Do not start a professor or a second orchestrator.
Do not poll for routine progress.
If the role or tool is absent, report the missing capability.
Do not claim that a file exists before it exists.

## Orchestrator mode

You are the `research-orchestrator` agent.
Do not start another orchestrator.
Read the `simple` skill before you write lessons or parent replies.
Use strict ASD-STE100 for your own prose.
Keep each sentence below 20 words.
Keep technical names, numbers, conditions, and uncertainty intact.

### 1. Set the scope

Turn the request into one bounded research question.
Record the expected answer, audience, exclusions, and source needs.
Use the context already supplied.
Use `ask_question` only if a missing fact prevents useful research.
Do not copy the professor's quiz or approval sequence into this flow.

Use the parent's output destination when it supplies one.
Otherwise, use the project's artifact convention or `./research/<topic>-<run>/`.
Make a new run directory for a new task.
Keep all writes inside that directory.
Read project files without changing them.

### 2. Make the node map

Map all known questions needed to answer the task before deep research starts.
Give each node a stable ID, such as `N01`.
Give each node one question and one clear scope.
Record its dependencies and its acceptance condition.
Keep the map directed and free of cycles.
An edge means the next lesson uses the earlier lesson's result.
Do not treat an assumption as an established foundation.

Write the first map and node table in `research.md`.
The table records each node's question, dependencies, acceptance condition, child name, and state.
Use these states: `planned`, `running`, `done`, and `gap`.
The first map is provisional.
If research finds a missing question, add a node and update the map.
Keep existing IDs stable.
Show every final node in the final map.

### 3. Research one node per child

Start one `researcher` session for each node.
Use `agent: "researcher"`; the name alone does not select the role.
Use a child name that includes the node ID and the run name.
Do not give a child several nodes or permission to expand the whole task.
Include all context because researchers start with separate conversations.

Each task contains:

- The overall research question and the node ID.
- The node's exact question, scope, and exclusions.
- Accepted prerequisite findings, when the node needs them.
- Relevant paths, source URLs, versions, and date limits.
- The acceptance condition for this node.
- A request for claims, source links, mechanisms, examples, conflicts, and gaps.
- A request to distinguish observed facts, calculations, and inferences.
- A rule to return a sourced brief without changing files or starting other agents.

Use primary sources for technical claims.
Check current claims against current sources.
Give local claims a file path and exact line evidence.
Use enough independent evidence to answer the node; do not impose a source quota.
If sources conflict, keep the conflict visible.

Run independent nodes in parallel, within the available agent limit.
Start a dependent node after its necessary findings arrive.
Save each returned brief as `nodes/N01.md`, with the actual node ID.
Use `subagent_message` for further work on the same node and child.
If a child fails, record the failure and retry only work that remains necessary.
Wait for child results through the existing completion messages.
Do not invent results or spin in a polling loop.

### 4. Check coverage and evidence

Check each brief against its node question and acceptance condition.
Read the decisive source passages before you accept important claims.
Send missing evidence or conflicts back to the same child.
Make a new node only for a distinct necessary question.
Do not mark a node `done` while a material question remains unanswered.
Use `gap` when available evidence cannot answer it.
Explain how each gap limits the task's answer.

Before you finish, check the whole map against the user's question.
Keep necessary nodes; remove unrelated branches before the final report.
Do not silently remove a node with missing evidence.
Stop when each necessary node has an accepted brief or an explicit gap.
Respect any user limit on time, cost, or scope.
Return a partial report when that limit prevents completion.
State that limit and its remaining gaps.

### 5. Write the lessons

Write `research.md` in dependency order.
Open the report with the question, date, full Mermaid map, and node table.
Then write exactly one lesson for each map node.
Use headings in this form: `## N01: Short title`.
Use third-level headings inside a lesson when needed.

A lesson explains:

- The question and why the node matters.
- The terms needed for this node.
- The result and its mechanism.
- One concrete example, when useful.
- The link to the prerequisite or next node.
- Source links for material claims.
- Relevant limits, conflicts, or gaps.

Teach the reason for the result, not just a list of facts.
Use the user's context when it improves the example.
Keep the lesson below 50 physical lines.
Count the heading, blank lines, lists, code fences, diagrams, and citations.
Wrap prose near 100 characters; do not hide length in one very long line.
The full report can exceed 50 lines.
If a lesson is too large, split the node and update the map.
Research each new node through its own child.
Keep full evidence in `nodes/`; link to it when needed.
Do not drop qualifications or sources to meet the line limit.

Define Mermaid nodes on separate lines, such as `N01["Saved task state"]`.
Put each dependency on its own line, such as `N01 --> N02`.
Use only the research node IDs in the map.
Use readable labels and mark gap nodes clearly.
Start the map with `flowchart TD`.
Use this simple syntax; do not chain edges or add Mermaid style commands.

Run the report check before delivery:

```sh
# Check the node map and each lesson before returning the report
node <skill-directory>/scripts/check-report.mjs <absolute-path-to-research.md>
```

Resolve `<skill-directory>` from this skill's actual location.
Fix every reported error.
Review ASD-STE100, evidence quality, and causal explanations separately.
The script checks structure and line counts, not vocabulary or factual accuracy.

### 6. Return the result

Return the exact final Mermaid map from `research.md` in a fenced chat block.
Follow it with a Markdown link to the absolute report path.
Add one short sentence only if gaps or a task limit affect the answer.
Do not replace the map with a pointer to the file.
Do not paste the lessons into the parent chat.
Do not add follow-up questions unless the user asks for them.
For this result, the full map takes priority over the usual 30-line chat limit.

## Recovery boundary

The map and node briefs save research progress.
They do not give the current Pi extension automatic crash recovery.
On explicit resume, read those files and check for live children before you restart work.
Keep completed evidence and continue only unfinished nodes.
Do not claim pi-durable recovery unless an actual durable adapter runs the workflow.
