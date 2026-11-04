#!/usr/bin/env bash
# Capture reproducible rataflow-view evidence for one spec and one view
#
# Usage:
#   scripts/viz-evidence.sh --spec SPEC.json --bin /abs/path/rataflow-view \
#       --out OUTDIR --label v1 [--frames 5] [--step-ms 100] [--no-select]
#       [--pinned-frames 12] [--pinned-size 77x47] [--no-pinned]
#
# Writes into OUTDIR:
#   bin.sha256                 absolute binary path + sha256 actually executed
#   check.txt                  --check stdout+stderr
#   LABEL-text.txt             visible pane text at natural zoom
#   LABEL-ansi.ansi            visible pane ANSI (colors, borders)
#   LABEL-selected.ansi        every node selected, ANSI
#   LABEL-frames.txt           timestamped animation frames (with --frames)
#   LABEL-77x47-frames.txt     pinned exact-size dump: the fit proof, and the
#                              frames capture to audit when the pane is smaller
#   manifest.json              hashes, pane ids, measured size, spec form,
#                              per-diagram titles/descriptions, cleanup proof
#
# A multi-diagram spec (`{"diagrams": [{id, title, description, nodes, edges}]}`)
# is one spec and one render, so it produces one bundle: the manifest records
# spec_form "canvas" plus every diagram's title and description, and the
# validator reads the check's per-diagram extents in place of a 77x47 fit.
#
# record mode wraps any rataflow-view invocation (probe, rejected draft,
# calibration) and appends a reproducible record to a JSONL log:
#   scripts/viz-evidence.sh record --to LOG.jsonl --label probe-3 -- BIN ARGS
# Each record: command, exit status, window, binary sha256, raw stdout and
# stderr paths + sha256s. The log is what viz-validate.py checks for
# attempts completeness, so wrap every probe and rejected candidate.
set -euo pipefail

die() { printf 'viz-evidence: %s\n' "$*" >&2; exit 1; }

# --- record mode: wrap one command, capture a reproducibility record ---
if [ "${1:-}" = "record" ]; then
  shift
  rto='' rlabel='probe' rdir=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --to) rto=${2:?}; shift 2 ;;
      --label) rlabel=${2:?}; shift 2 ;;
      --raw-dir) rdir=${2:?}; shift 2 ;;
      --) shift; break ;;
      *) die "record: unknown argument: $1" ;;
    esac
  done
  [ -n "$rto" ] || die "record: --to LOG.jsonl is required"
  [ $# -gt 0 ] || die "record: a command is required after --"
  case "$1" in /*) [ -x "$1" ] || die "record: command not executable: $1" ;; esac
  rto_dir=$(dirname "$rto"); mkdir -p "$rto_dir"
  rto_abs=$(cd "$rto_dir" && pwd)/$(basename "$rto")
  rdir=${rdir:-"$rto_dir/recorded"}; mkdir -p "$rdir"
  # Unique raw filenames: a re-run label must never overwrite an earlier
  # record's bytes (round-09 gb300 lost a record to exactly that).
  rbase=$rlabel; n=1
  while [ -e "$rdir/$rbase.stdout" ] || [ -e "$rdir/$rbase.stderr" ]; do
    rbase="$rlabel-$n"; n=$((n+1))
  done
  # Cryptographic binding of the executed command to the spec it ran on:
  # hash the first .json argument that exists on disk (round-09 datacenter
  # was blocked because the executed spec was not bound to its snapshot).
  rspec=''
  for a in "$@"; do
    case "$a" in
      *.json) [ -f "$a" ] && { rspec=$(cd "$(dirname "$a")" && pwd)/$(basename "$a"); break; } ;;
    esac
  done
  rspec_h=$(shasum -a 256 "$rspec" 2>/dev/null | awk '{print $1}' || true)
  r0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  set +e
  "$@" > "$rdir/$rbase.stdout" 2> "$rdir/$rbase.stderr"
  rstatus=$?
  set -e
  r1=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  rbin_h=$(shasum -a 256 "$1" 2>/dev/null | awk '{print $1}' || true)
  rout_h=$(shasum -a 256 "$rdir/$rbase.stdout" | awk '{print $1}')
  rerr_h=$(shasum -a 256 "$rdir/$rbase.stderr" | awk '{print $1}')
  jq -nc \
    --arg label "$rlabel" --arg cmd "$*" --argjson status "$rstatus" \
    --arg t0 "$r0" --arg t1 "$r1" \
    --arg out_p "$rdir/$rbase.stdout" --arg out_h "$rout_h" \
    --arg err_p "$rdir/$rbase.stderr" --arg err_h "$rerr_h" \
    --arg bin "$1" --arg bin_h "$rbin_h" \
    --arg spec "$rspec" --arg spec_h "$rspec_h" \
    '{label:$label, command:$cmd, exit_status:$status, window:[$t0,$t1],
      binary_path:$bin, binary_sha256:(if $bin_h == "" then null else $bin_h end),
      spec_path:(if $spec == "" then null else $spec end),
      spec_sha256:(if $spec_h == "" then null else $spec_h end),
      stdout_path:$out_p, stdout_sha256:$out_h,
      stderr_path:$err_p, stderr_sha256:$err_h}' >> "$rto_abs"
  printf 'viz-evidence record: %s exit %s -> %s\n' "$rlabel" "$rstatus" "$rto_abs"
  exit "$rstatus"
fi

spec='' bin='' out='' label='v1' frames='' step_ms='100' select=1
pinned_frames=12 pinned_cols=77 pinned_rows=47
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) spec=${2:?}; shift 2 ;;
    --bin) bin=${2:?}; shift 2 ;;
    --out) out=${2:?}; shift 2 ;;
    --label) label=${2:?}; shift 2 ;;
    --frames) frames=${2:?}; shift 2 ;;
    --step-ms) step_ms=${2:?}; shift 2 ;;
    --no-select) select=0; shift ;;
    --pinned-frames) pinned_frames=${2:?}; shift 2 ;;
    --pinned-size) pinned_cols=${2%%x*}; pinned_rows=${2##*x}; shift 2 ;;
    --no-pinned) pinned_frames=0; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$spec" ] || die "--spec is required"
[ -n "$bin" ] || die "--bin is required"
[ -n "$out" ] || die "--out is required"
[ -f "$spec" ] || die "spec not found: $spec"
case "$bin" in /*) ;; *) die "--bin must be an absolute path, got: $bin" ;; esac
[ -x "$bin" ] || die "binary not executable: $bin"
[ "${HERDR_ENV:-}" = 1 ] || die "HERDR_ENV is not 1; this script needs Herdr panes"
command -v herdr >/dev/null || die "herdr is not on PATH"
command -v jq >/dev/null || die "jq is not on PATH"

spec_abs=$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")
out_abs=$(mkdir -p "$out" && cd "$out" && pwd)

# Spec form: one graph, or a multi-diagram canvas ({"diagrams": [...]}). Both
# forms are captured exactly the same way — one spec file, one pane render, one
# bundle — so this only records what the bundle is and what each diagram claims
# to show. A canvas needs a title + description per diagram (the owner navigates
# a large canvas by those headings), so a missing description is called out here
# rather than after a pane has already been spent.
spec_form=$(jq -r 'if (.diagrams | type) == "array" and (.diagrams | length) > 0
  then "canvas" else "graph" end' "$spec_abs" 2>/dev/null || echo graph)
diagrams_json='[]'
if [ "$spec_form" = canvas ]; then
  diagrams_json=$(jq -c '[.diagrams[] | {id: (.id // null), title: (.title // null),
    description: (.description // null)}]' "$spec_abs")
  undescribed=$(jq -r '[.diagrams[] | select((.description // "") | length == 0) | .id]
    | join(", ")' "$spec_abs")
  if [ -n "$undescribed" ]; then
    printf 'viz-evidence: warning: diagram(s) %s carry no description; a reader cannot navigate the canvas without a title + what-it-shows line\n' \
      "$undescribed" >&2
  fi
fi

# 1. Bind the evidence to the executable bytes and the spec bytes.
bin_sha=$(shasum -a 256 "$bin" | awk '{print $1}')
spec_sha=$(shasum -a 256 "$spec_abs" | awk '{print $1}')
printf '%s  %s\n' "$bin_sha" "$bin" > "$out_abs/bin.sha256"

check_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
set +e
"$bin" --check "$spec_abs" > "$out_abs/check.txt" 2>&1
check_status=$?
set -e
check_end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[ "$check_status" -eq 0 ] || die "--check failed (exit $check_status); read $out_abs/check.txt"

pane=''
cleanup() {
  [ -n "$pane" ] || return 0
  herdr pane close "$pane" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 2. Split a half pane beside the caller, unfocused, and measure it.
split_json=$(herdr pane split --current --direction right --ratio 0.5 \
  --cwd "$(pwd)" --no-focus)
pane=$(jq -r '.result.pane.pane_id // empty' <<<"$split_json")
[ -n "$pane" ] || die "could not read the new pane id from: $split_json"

rect=$(herdr pane layout | jq -c --arg p "$pane" \
  '.. | objects | select(.pane_id? == $p) | .rect' | head -1)
rect_w=$(jq -r '.width // empty' <<<"$rect")
rect_h=$(jq -r '.height // empty' <<<"$rect")
viewport_rows=$(herdr pane get "$pane" | jq -r '.result.pane.scroll.viewport_rows // empty')
# Herdr draws a 1-cell border around the pane, so the app sees rect minus 2.
cols=''; rows=''
if [ -n "$rect_w" ] && [ -n "$rect_h" ]; then
  cols=$((rect_w - 2)); rows=$((rect_h - 2))
fi

wait_for_header() {
  # Poll for the app's OWN header line (` rataflow-view · 82x51 @100% · …`).
  # Matching the plain string 'rataflow-view' instead also matches the echo of
  # the command line that pane run types, which returns before the app paints:
  # every capture then lands on a bare prompt (and the follow-up `q` is
  # buffered into the tty and kills the app as soon as it starts). Bounded so a
  # viewer that never paints fails loudly instead of yielding an empty frame.
  local waited=0
  while [ "$waited" -lt 60 ]; do
    if herdr pane read "$pane" --source visible --format text 2>/dev/null \
        | grep -q 'rataflow-view · '; then
      sleep 0.3
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  printf 'viz-evidence: no "rataflow-view · " header in pane %s after %ss — the viewer never painted, refusing to capture an empty frame\n' \
    "$pane" "$waited" >&2
  return 1
}

# 3. Natural-zoom frame, plain text and ANSI.
launch_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
herdr pane run "$pane" "$bin" "$spec_abs" >/dev/null
wait_for_header
herdr pane read "$pane" --source visible --format text > "$out_abs/$label-text.txt"
herdr pane read "$pane" --source visible --format ansi > "$out_abs/$label-ansi.ansi"
herdr pane send-keys "$pane" q >/dev/null 2>&1 || true
sleep 0.4

# 4. Every-node selected frame (proves each node's own selected border).
if [ "$select" -eq 1 ]; then
  herdr pane run "$pane" "$bin" "$spec_abs" --select-all >/dev/null
  wait_for_header
  herdr pane read "$pane" --source visible --format ansi > "$out_abs/$label-selected.ansi"
  herdr pane send-keys "$pane" q >/dev/null 2>&1 || true
  sleep 0.4
fi

# 5. Timestamped animation frames (deterministic, no alias ambiguity).
if [ -n "$frames" ]; then
  herdr pane run "$pane" "$bin" "$spec_abs" --frames "$frames" --step-ms "$step_ms" >/dev/null
  # Same paint-latency bug as wait_for_header: a flat second is not enough for
  # the viewer to start and print its last frame, so poll for that line too.
  last_frame=$((frames - 1))
  want_frame="frame $last_frame at $((last_frame * step_ms))ms"
  waited=0
  while [ "$waited" -lt 60 ]; do
    if herdr pane read "$pane" --source recent --lines 4000 --format text 2>/dev/null \
        | grep -qF "$want_frame"; then
      sleep 0.3
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if [ "$waited" -ge 60 ]; then
    printf 'viz-evidence: frames never printed in pane %s after %ss (wanted "%s"); refusing an empty frames capture\n' \
      "$pane" "$waited" "$want_frame" >&2
    exit 1
  fi
  herdr pane read "$pane" --source recent --lines 4000 --format text \
    > "$out_abs/$label-frames.txt"
  herdr pane read "$pane" --source recent --lines 4000 --format ansi \
    > "$out_abs/$label-frames.ansi"
fi
launch_end=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 6. Pinned exact-size dump: the fit proof (a drawing that fits 77x47 prints no
# `canvas WxH` extent) and, for a canvas larger than the pane, the capture the
# frame audit needs. Runs its own pty, so it is independent of the pane above.
pinned_line='' pinned_file=''
if [ "$pinned_frames" -gt 0 ]; then
  command -v python3 >/dev/null || die "python3 is required for the pinned dump (or pass --no-pinned)"
  pinned_file="$label-${pinned_cols}x${pinned_rows}-frames.txt"
  pinned_status=0
  python3 "$(dirname "$0")/viz-pinned-dump.py" --bin "$bin" --spec "$spec_abs" \
      --cols "$pinned_cols" --rows "$pinned_rows" --frames "$pinned_frames" \
      --step-ms "$step_ms" > "$out_abs/$pinned_file" 2> "$out_abs/$label-pinned.stderr" \
    || pinned_status=$?
  if [ "$pinned_status" -ne 0 ]; then
    printf 'viz-evidence: warning: pinned %sx%s dump did not report that viewport (see %s)\n' \
      "$pinned_cols" "$pinned_rows" "$out_abs/$label-pinned.stderr" >&2
  fi
  pinned_line=$(grep -m1 '^viewport: ' "$out_abs/$pinned_file" 2>/dev/null || true)
fi

# 7. The proof of fit and zoom: the app's own startup line, else its header
# token (the alternate screen erases the startup line in a live pane).
applied_viewport=$(grep -m1 '^viewport: ' "$out_abs/$label-text.txt" 2>/dev/null || true)
viewport_token=$(grep -om1 '[0-9]\+x[0-9]\+ @100%' "$out_abs/$label-text.txt" 2>/dev/null || true)

# 8. Close the pane and prove it is gone.
closed='still_present'
herdr pane close "$pane" >/dev/null 2>&1 || true
sleep 0.3
if ! herdr pane get "$pane" >/dev/null 2>&1; then
  closed='confirmed_closed'
fi
closed_pane=$pane
pane=''

# 9. Assemble the manifest.
artifacts='{}'
for f in "$out_abs"/*; do
  name=$(basename "$f")
  [ "$name" = manifest.json ] || [ -d "$f" ] && continue
  hash=$(shasum -a 256 "$f" | awk '{print $1}')
  artifacts=$(jq -c --arg n "$name" --arg h "$hash" '. + {($n): $h}' <<<"$artifacts")
done

jq -n \
  --arg spec "$spec_abs" --arg spec_sha "$spec_sha" \
  --arg bin "$bin" --arg bin_sha "$bin_sha" \
  --arg form "$spec_form" --argjson diagrams "$diagrams_json" \
  --arg pane "$closed_pane" --arg rect "$rect" \
  --arg cols "$cols" --arg rows "$rows" \
  --arg vp_rows "$viewport_rows" --arg viewport_line "$applied_viewport" \
  --arg viewport_token "$viewport_token" \
  --arg cleanup "$closed" --arg c0 "$check_start" --arg c1 "$check_end" \
  --arg l0 "$launch_start" --arg l1 "$launch_end" \
  --arg frames "${frames:-}" --arg step "$step_ms" \
  --arg pinned "$pinned_line" --arg pinned_file "$pinned_file" \
  --argjson check_exit "$check_status" \
  --argjson select_all "$([ "$select" -eq 1 ] && echo true || echo false)" \
  --argjson artifacts "$artifacts" \
  '{
     spec_path: $spec, spec_sha256: $spec_sha,
     spec_form: $form, diagrams: $diagrams,
     binary_path: $bin, binary_sha256: $bin_sha,
     pane_id: $pane, pane_rect: ($rect | fromjson? // null),
     pane_cols: ($cols | tonumber? // null),
     pane_rows: (($rows | tonumber?) // ($vp_rows | tonumber?) // null),
     viewport_line: (if $viewport_line == "" then null else $viewport_line end),
     viewport_token: (if $viewport_token == "" then null else $viewport_token end),
     check_exit: $check_exit, check_window: [$c0, $c1],
     capture_window: [$l0, $l1],
     cleanup: $cleanup, select_all_frame: $select_all,
     frames: (if $frames == "" then null else ($frames | tonumber) end),
     frame_step_ms: ($step | tonumber),
     pinned_frames: (if $pinned_file == "" then null
       else {file: $pinned_file,
             viewport_line: (if $pinned == "" then null else $pinned end)} end),
     artifacts: $artifacts
   }' > "$out_abs/manifest.json"

printf 'viz-evidence: %s -> %s (%sx%s, %s)\n' "$label" "$out_abs" "$cols" "$rows" "$closed"
