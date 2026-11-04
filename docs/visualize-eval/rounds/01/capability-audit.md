# Frozen renderer capability audit — round 01

This is a source audit, not a diagram verdict or a new skill candidate.
The captain inspected the frozen source copy after generation finished.
All diagram reviews still use the executed captures as their visual evidence.

Binary SHA-256:
`4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8`

Frozen source root:
`/tmp/visualize-eval/round-01/renderer-source/`

Source file hashes are in `metadata.json#renderer_source_hashes`.
Do not substitute a later working-tree version for this source.

## Intentional shared trunk

`src/lib.rs:58-122` accepts node ID/label, edge endpoints/label/flow,
direction, theme, and layers. Unknown fields are rejected.
There is no junction, bus, shared-port, or shared-trunk declaration.

`src/router.rs:352-424` assigns a separate port to each edge. Slots advance
by two cells and retain a blank cell between stems. The routing contract
separates independent edges rather than declaring shared relationships.

Thus the documented schema has no supported representation for the requested
single outgoing OOB trunk with one explicit split. Adding a visible box named
junction changes the visual object; silently merging independent strokes would
reintroduce the false-connection defect. Neither establishes the requested bus.
This is a renderer capability issue, not an instruction to relax the rubric.

## One live dot per edge

`src/lib.rs:68-95` accepts only a boolean or speed number for `flow`.
There is no dot-count or density field.

`src/flow_edge.rs:392-447` emits a periodic dot pattern along route distance.
Its nominal spacing is `max(7, 3 * speed)`. It reduces spacing on short routes
to approximately half their length. It does not limit the live-dot count to one.
Increasing speed also changes spacing; it does not provide independent slow
motion and one-dot control. Slowing the current samples does not fix density.

The source therefore does not support a general one-live-dot-per-edge mode.
A particular short path might happen to show one dot in one frame; that is not
proof that it satisfies the requested count over time.

The drawing pass also allows dots to replace ordinary corner glyphs. It protects
crossing bridges and multi-direction junction glyphs, but not two-direction bends.
This explains why independent paths can become harder to trace during animation.

## Conceptual groups independent of layout

`src/lib.rs:343-378` groups nodes by rounded x/y position along the flow axis.
It assigns hue families to those geometric bands, then shades their siblings.
The node schema contains no semantic-group or color-family field.

A generator can sometimes align conceptual groups with layout bands. The API does
not independently express a conceptual family across different geometric ranks,
or preserve a repeated node's hue across independently laid-out views.
This is a control limitation, not proof that every alternative layout will fail.

## Borders

`src/lib.rs:381-386` now gives handles an empty explicit style. This preserves
the node border foreground and selected styling instead of repainting gray cells.
Actual captures independently support improved border continuity in observed states.
Missing selected-state coverage must remain an evidence gap; it is not a claim
that an unobserved border is broken.

## Scope of conclusions

No renderer changes, new layout trials, installs, or new captures were made for
this audit. The fixed rubric and source expectations remain unchanged. The
all-eight-critique barrier still governs any skill proposal or stop decision.
