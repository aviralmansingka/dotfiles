# Commands run (round 08, case pipeline)

All renderer calls use the frozen absolute binary
`/tmp/visualize-eval/round-08/bin/rataflow-view` (sha256 `ea24593b0f80c161…`).
`$C` is `docs/visualize-eval/rounds/08/pipeline`.

```sh
# frozen-input verification
shasum -a 256 docs/visualize-eval/rounds/08/SKILL.md /tmp/visualize-eval/round-08/bin/rataflow-view

# attempt 01 — engine probe: synthetic ids/labels matched to the case's label
# widths, direction lr, three sibling tier groups (does a region contain its members?)
COLUMNS=120 LINES=30 /tmp/visualize-eval/round-08/bin/rataflow-view --frames 1 \
  "$C/attempts/01-lr-synthetic-groups/spec.json" > "$C/attempts/01-lr-synthetic-groups/frames-120x30.txt"
/tmp/visualize-eval/round-08/bin/rataflow-view --check \
  "$C/attempts/01-lr-synthetic-groups/spec.json" > "$C/attempts/01-lr-synthetic-groups/check.txt"

# attempt 02 — the accepted spec (case content, tb)
/tmp/visualize-eval/round-08/bin/rataflow-view --check "$C/specs/pipeline-tb.json" \
  > "$C/attempts/02-tb-final/check.txt"

# attempt 03 — orientation probe of the same content in lr
/tmp/visualize-eval/round-08/bin/rataflow-view --check "$C/attempts/03-lr-case/spec.json" \
  > "$C/attempts/03-lr-case/check.txt"
COLUMNS=77 LINES=47 /tmp/visualize-eval/round-08/bin/rataflow-view --frames 1 \
  "$C/attempts/03-lr-case/spec.json" > "$C/attempts/03-lr-case/pinned77x47-frames.txt"

# final spec: pinned 77x47 full-lap dump (fit + motion proof, frame 0 included)
COLUMNS=77 LINES=47 /tmp/visualize-eval/round-08/bin/rataflow-view --frames 36 --step-ms 100 \
  "$C/specs/pipeline-tb.json" > "$C/evidence/v1/v1-77x47-frames.txt"
# (one provenance comment line was prepended to that dump with printf)

# harness evidence: half pane in this session's own tab, no focus, self-closing
scripts/viz-evidence.sh --spec "$C/specs/pipeline-tb.json" \
  --bin /tmp/visualize-eval/round-08/bin/rataflow-view \
  --out "$C/evidence/v1" --label v1 --frames 36

# validator (full output preserved)
uv run --no-project scripts/viz-validate.py "$C/evidence/v1" \
  --require-select --require-frames --attempts "$C/attempts.json" \
  > "$C/evidence/v1/validator.txt"

# dot-position analysis of the captures (uv, no project)
uv run --no-project python - <<'PY'
# parse "frame N at Mms" blocks out of evidence/v1/v1-77x47-frames.txt and
# compare each '●' cell with the port row and the first drawn route cell
PY
```

Forbidden inputs were not read: `expected.json`, `historical-variants.json`,
other cases, earlier rounds' outputs/critiques, the globally installed skill.
The renderer tree, examples and the installed skill were not modified; nothing
was built, installed or committed.
