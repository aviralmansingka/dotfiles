# Round 10 review — gb300-rack-software (FAIL)

Categories: semantic FAIL · arrows PASS · layout FAIL · grouping PASS ·
category_fit FAIL · borders PASS · workflow BLOCKED · animation N/A.

The requested single-split OOB bus is visible and traceable. The principal
semantic defect remains: the direct nv-rms API paths to the compute BMC,
NVSwitch BMC, and power shelf are absent — the OOB client edge and the
physical bus do not substitute for those controller relationships (round-09
defect, repeated). Split-view coverage is incomplete (layout/category_fit).
Workflow is blocked (see reviewer-result).

NOTE: the judge session expired after delivering its verdict; this file
and reviewer-result.json were reconstructed verbatim from the verdict by
the captain. The blind record (`observed-first.md`, sha256 d665c9ac…) is
the judge's own artifact.
