#!/bin/sh
# Capture one rataflow-view render in a fresh no-focus half pane of THIS tab.
# usage: capture.sh <tag> <spec-abspath>
set -u
TAG="$1"; SPEC="$2"
REPO=/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill
OUT="$REPO/docs/visualize-eval/rounds/01/datacenter-redundancy"
BIN=/tmp/visualize-eval/round-01/bin/rataflow-view
LOG="$OUT/captures/capture-log.jsonl"

# 1. split own tab, no focus
SPLIT=$(herdr pane split --current --direction right --ratio 0.5 --cwd "$REPO" --no-focus)
PANE=$(printf '%s' "$SPLIT" | uv run python -c 'import json,sys;print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
TS=$(date -u +%Y%m%dT%H%M%SZ)
echo "pane=$PANE tag=$TAG ts=$TS"

# 2. actual terminal size of the viewer pane
herdr pane run "$PANE" "stty size > /tmp/vizdim-$TAG.txt" >/dev/null 2>&1
sleep 1
DIM=$(tr -d '\r' < "/tmp/vizdim-$TAG.txt" 2>/dev/null | grep -Eo '^[0-9]+ [0-9]+' | head -1)
echo "stty_size=$DIM"

# 3. launch viewer, self-closing
herdr pane run "$PANE" "$BIN $SPEC; herdr pane close $PANE" >/dev/null 2>&1
sleep 2.5

# 4. header + captures
herdr pane read "$PANE" --source visible --lines 2 > "$OUT/captures/$TAG-$TS-header.txt"
herdr pane read "$PANE" --source visible            > "$OUT/captures/$TAG-$TS-visible.txt"
herdr pane read "$PANE" --source visible --format ansi > "$OUT/captures/$TAG-$TS-visible.ansi"

# 5. selected-node state (Tab cycles selection)
herdr pane send-keys "$PANE" tab >/dev/null 2>&1
sleep 0.7
herdr pane read "$PANE" --source visible            > "$OUT/captures/$TAG-$TS-selected.txt"
herdr pane read "$PANE" --source visible --format ansi > "$OUT/captures/$TAG-$TS-selected.ansi"

# 6. second frame for the unselected state (static render, no flow)
herdr pane send-keys "$PANE" tab >/dev/null 2>&1
sleep 0.7
herdr pane read "$PANE" --source visible            > "$OUT/captures/$TAG-$TS-frame2.txt"

# 7. quit; self-closing command removes the pane
herdr pane send-keys "$PANE" q >/dev/null 2>&1
sleep 1.2
ALIVE=$(herdr pane list | uv run python -c "import json,sys;ids=[p['pane_id'] for p in json.load(sys.stdin)['result']['panes']];print('alive' if '$PANE' in ids else 'closed')")

# 8. record
uv run python - "$TAG" "$TS" "$PANE" "$DIM" "$SPEC" "$ALIVE" "$OUT" <<'PY'
import json,sys,hashlib,os
tag,ts,pane,dim,spec,alive,out=sys.argv[1:8]
def sh(p):
    return hashlib.sha256(open(p,'rb').read()).hexdigest()
rec={"tag":tag,"ts_utc":ts,"pane_id":pane,"stty_size":dim,"spec":os.path.relpath(spec,os.path.dirname(out)),
     "spec_sha256":sh(spec),"pane_after_quit":alive,
     "captures":{}}
for suffix in ["header.txt","visible.txt","visible.ansi","selected.txt","selected.ansi","frame2.txt"]:
    p=f"{out}/captures/{tag}-{ts}-{suffix}"
    rec["captures"][suffix]={"path":os.path.relpath(p,os.path.dirname(out)),"sha256":sh(p) if os.path.exists(p) else None}
with open(f"{out}/captures/capture-log.jsonl","a") as f: f.write(json.dumps(rec)+"\n")
print(json.dumps({"tag":tag,"pane":pane,"stty":dim,"after_quit":alive}))
PY
