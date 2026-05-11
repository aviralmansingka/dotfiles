#!/usr/bin/env bash
# Wrapper used as the `python` field in DAP launch configs. Re-exec's the
# debuggee launcher under `inv cloud dev-cluster` so it inherits the
# dev-cluster MODAL_* env (S3 creds, blobnet origin, etc.) without baking
# those into nvim's process env. `inv` cd's to the modal repo root before
# running the command, so we pre-cd back to the cwd debugpy passed us.
set -euo pipefail

INV=/home/ec2-user/modal/.venv/bin/inv
PYTHON=/home/ec2-user/modal/.venv/bin/python

exec "$INV" cloud dev-cluster --no-log -- \
  bash -c 'cd "$1" && shift && exec "$0" "$@"' \
  "$PYTHON" "$(pwd)" "$@"
