# artifacts — the durable record

Read this file during Phase 2, when the first artifact is written, and again
on resume.

Two markdown files per session, written to a location agreed at session start
(default `./professor-lessons/<task-name>/` under the current repo), plus the
session journal maintained by md-log.

## session.md (live)

**Opens with the plan's mermaid DAG at the top**: the dependency map from
Phase 2 is the first thing the learner sees, every time the file is opened.

Below it:

- the goal contract;
- the current position in the DAG, with confirmed nodes marked `[x]`;
- the active interaction;
- the next step.

Re-render only these header sections after every interaction — no per-lesson
recap, commands, or quiz boilerplate. Anything historical goes in the journal,
not here.

## handout.md (static, global)

Authored once during Plan from the researcher pass, under the `/simple` skill's
rules: the full command reference and background for the whole arc.

For every command: its purpose, the flags used, and the kernel construct it
touches (e.g. `ip link set eno1 up` writes the netdev's `IFF_UP` flag via
netlink; `modprobe -r igc` unloads the module, calling the driver's `.remove`
callback). The human types commands to **remember** them, and cannot remember
what he doesn't precisely understand — this reference is what lets him type
with intent. `session.md` links into it; he falls back to it when he wants the
full picture.

## Session journal (`<session>.md`, beside the session file)

The durable teaching transcript, maintained by md-log: every lesson and every
teaching quiz/explain verdict, each entry headed by its own short title.
**Append-only at the bottom**: entries land in the order they happen and are
never reordered, rewritten, or re-rendered. Never edit this file by hand.

Practice entries ride the same journal: a posed problem's submitted working and
a concluded problem's outcome land in the journal too, never in the probe log.

## Probe log (`<session>-probes.md`, beside the session file)

The separate durable record of every Phase-1 cold probe. Pass
`stage: "probe"` on every probe `quiz`/`explain` call; md-log routes those
verdicts here, never into the journal. `/probes` opens it. Never edit this
file by hand.

## Learner-side buffers (in-memory, per node)

Every `lesson` call gets its own buffer (`pi-focus://<session>/<node>`); earlier
nodes persist so the learner can cycle them in nvim (`:bnext`/`:bprev`). `h` and
`ctrl+h` focus the current node's buffer; before the first lesson they show the
**overview buffer** — nodes taught, per-node verdicts, current position,
rebuilt from the journal so a resumed or refreshed session still makes sense.
The whole journal file opens only via `H` or `/lessons`.

**Never dump lesson content into the console.** The console is for:

- brief status (what you're preparing, where to look);
- quiz questions — one at a time;
- interaction prompts (the command to run, the artifact to fix);
- pointing the human to a file or a specific section.

If the human doesn't have the file open, point him to it. If no nvim is
installed, use `less` or `vi` in a display pane. The markdown is the lesson —
the console is the conversation about it.

## Knowledge extraction

`/extract` runs this contract.

**Source.** The session journal only (lessons plus teaching quiz/explain
verdicts). Never the probe log. Never the session transcript.

**Output.** One note per proposition: `<vault>/2_knowledge/propositions/<slug>.md`.
Slug is lowercase a-z, 0-9, hyphens. Created once and permanent.

**Frontmatter on creation:**

```yaml
---
id: <slug>
aliases: ["<verbatim phrasing from the lesson>"]
tags: [proposition, <topic-slug>]
sources: ["[session](../../professor-lessons/<task>/session.md)"]
created: YYYY-MM-DD
review_due: YYYY-MM-DD      # creation date + 1 day
review_streak: 0
review_last: null
review_result: new
demonstrated: []
last_rung: null
needs_teach: false
---
```

**Body:**

```md
# <Short Name>

<The proposition at full precision. One claim. True on its own terms.>

## Chains

- [[premise-a]] + [[premise-b]] → <Short Name of this note>
```

`## Chains` holds only chains whose conclusion is this note; all premises of one
chain stay on one line joined with ` + `. A chain with a single premise is one
link. Omit the section when the note has no incoming chains.

**Procedure.**
1. Read the whole journal.
2. List every proposition the teaching established: one claim each, minimal and
   precise. List every chain: the premises used together, and what they imply.
3. For each proposition, `grep` the propositions directory for its statement and
   aliases before creating anything. On a match, update that note: append the new
   verbatim alias and the new source. Never change its statement, name, id, or
   review fields. Conservative rule: duplicates are acceptable, wrong merges are
   not.
4. Create the missing notes. Create premise notes too when a chain names one that
   does not exist.
5. Report one line: created N notes, updated M.

**Rules.** No learner ratings, no understanding levels, no lesson prose, no quiz
text. The statement is objective; the learner's thinking never enters the note.
Reruns are safe: they only add aliases and sources. Never delete a note.

## Resumption

If resuming after a context reset, read any handoff notes plus `session.md`
(including its `[x]` progress marks) and `handout.md` before continuing. The
journal, probe log, and overview buffer rebuild the same position from
md-log's durable records — `h` shows the learner where the arc stands. Don't
re-teach what's already landed.

**Re-present the active node on resume.** The previous session's node buffers
died with its editor pane. Before you quiz or verify any node after a
resume, deliver that node's content again with one `lesson` call (from the
handout or the prior journal entry) — the node buffer must exist for the
question that follows. Verification of a node the learner cannot see is a
test of memory, not understanding.
