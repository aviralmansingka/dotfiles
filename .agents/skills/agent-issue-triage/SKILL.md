---
name: agent-issue-triage
description: Discover and display ordinary open vault issues grouped by Project and Feature. Use for a read-only dry triage of Neovim and Pi Agent issues.
compatibility: Requires Python 3 and a vault using the 1_projects hierarchy.
allowed-tools: Bash
---

# Agent Issue Triage

Run the `triage.py` helper beside this file for the shared discovery path:

```sh
python3 triage.py --vault /Users/aviral/vault --projects neovim,pi-agent
```

When invoked as `/skill:agent-issue-triage triage`, accept optional `--vault` and
`--projects` arguments and pass them to that helper. Default to
`/Users/aviral/vault` and `neovim,pi-agent`.

This V01 slice is dry triage only. It must remain read-only: do not edit issue
notes, create issues, perform interactive triage, run weekly review, or infer
Telegram capture policy.

The helper scans only ordinary Markdown files directly under project-level or
feature-local `issues/` directories. It excludes `status: done`, reports bad or
missing status metadata, derives Project from the path, and uses path ownership
before project-level `feature:` metadata. Missing outcome and next action are
`Unresolved`; missing disposition is `Untriaged`.
