# Vault Hunter Atlas crew timeline

Atlas observe and browser run previews select a compact vertical crew timeline. The underlying `JournalModel` retains the complete recorded Journal projection by default; callers must opt into the crew timeline with `WithCrewTimeline`. The connected Parent, Verifier, Convergence, Delivery, and Parent closure stages each expose one deliverable and use `●`, `⟳`, `○`, or `×` for complete, active, waiting, and failed state.

Verifier progress comes from canonical Task `VNN` checkboxes, falling back to normalized Registry verifier evidence when the Task cannot provide them. Delivery completes only from an implementation pull-request field or the Task's Pull Request Evidence section, and closure follows canonical Task status. Compatibility `crew_role` metadata takes precedence. Otherwise, recognized original participant roles are retained and marked `≈` as inferred v1 projections; roles outside Verifier Builder, Convergence Engineer, and Delivery Steward remain Unassigned.

Rendering remains read-only, foreground-only Gruvbox ANSI. Stripping SGR sequences preserves the plain frame, and the existing terminal-size, sanitization, refresh, quit, and machine-output contracts are unchanged.
