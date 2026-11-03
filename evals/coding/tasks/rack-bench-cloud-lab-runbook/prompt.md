Write the cloud-lab practice guide and restore the profile-schema draft as repo docs. Simplified Technical English, house style, docs only.

## `docs/cloud-lab.md`

A practice guide for running `audit` and `bench internet` on cloud machines before touching real racks. Cover: the machine matrix, the work loop, a read-and-fix table (symptom → action), five experiments, SKIP triage, and the limits of cloud-hosted results.

## `docs/profile-schema.md`

Restore the MVP design draft for the `--config` grading schema: what a profile config contains, how a run is graded, and what is deliberately out of scope.

## Constraints

- Docs only: no code, no test changes.
- Every command you quote must be runnable from the repo as it stands.
- Keep tables and headings consistent with the existing docs.

## Verification

- Re-read both files for STE style and working commands.
- Report: files added, sections covered, anything you cannot verify offline.
