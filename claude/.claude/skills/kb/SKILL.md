---
name: kb
description: Inject context from the Modal knowledge base. Use when user types /kb followed by a topic like "/kb instance manager" or "/kb scheduler".
allowed-tools: Glob, Grep, Read
---

# Modal Knowledge Base Context Injection

Quickly retrieve and inject context from `~/obsidian/personal/5_modal`.

## Instructions

1. Take the user's topic (e.g., "instance manager", "scheduler", "week 32")

2. Find matching files:
   - Search file names first with Glob: `**/*{topic}*.md`
   - If no matches, use Grep to search content for the topic

3. Read and output the content directly - do not summarize. The goal is to inject raw context.

4. If multiple files match, read the most relevant one (prefer system-cards over logs).

## File Locations

Base path: `/Users/aviralmansingka/obsidian/personal/5_modal`

| Topic Pattern | Likely Location |
|---------------|-----------------|
| system/component names | `system-cards/**/*.md` |
| week + number | `logs/week_NNN/summary.md` |
| proto/protobuf | `kb/modal_proto.md` |
| deal names | `deals/*.md` |
| concepts | `concepts.md` |

## Examples

- `/kb instance manager` -> Read `system-cards/cloud-capacity/instance-manager.md`
- `/kb scheduler` -> Read `system-cards/cloud-capacity/scheduler-system.md`
- `/kb week 32` -> Read `logs/week_032/summary.md`
- `/kb cognition` -> Read `deals/cognition.md`
