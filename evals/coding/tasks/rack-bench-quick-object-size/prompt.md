Quick-profile download windows always SKIP. Downloads verify ranges from *this run's* completed uploads, and 1 GiB multipart objects never finish inside a quick window. Fix the workload, not the download check.

## What to change

- Quick profile uploads 32 MiB objects (`LIGHT_SIZE`) for full bands too; certify keeps the ~1 GiB sustained streams.
- Add a `--object-size MIB` knob that overrides the profile default for lab work (positive integer, MiB).
- Update the README workload paragraph and the `docs/bench-internet.md` sustained-upload step to state the per-profile object size.

## Verification

- `.venv/bin/python -m unittest discover -s tests -q`.
- Report: files changed, the defaults you chose, and how a quick download window now finds completed objects.
