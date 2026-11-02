# Round 10 — collision-free group hue families

Round 09 handed four verdict-level collisions to the name-derived hash. They reproduce on the
round-09 tree with one spec (`tests/colors.rs::ansi_dump_group_borders`):

| group | before | after |
| --- | --- | --- |
| `compute` | `211;134;155` (purple) | `115;161;206` (blue) |
| `fabric` | `125;174;163` (aqua) | `115;206;115` (green) |
| `control` | `211;134;155` (purple) | `206;115;138` (pink) |
| `orchestration` | `125;160;184` (blue) | `206;161;115` (tan) |
| `app` | `125;174;163` (aqua) | `206;115;206` (magenta) |
| `storage` | `125;160;184` (blue) | `183;206;115` (yellow-green) |

Before: three RGBs for six groups — the pipeline pair, the network pair, and the runtime pair.
After: six families, minimum pairwise hue gap 45°.

## What changed

- **A group wheel, not a bucket.** `GROUP_FAMILIES = 8` hues, 45° apart, from
  `GROUP_HUE_START = 30` in HSL at one saturation (0.48) and lightness (0.63), converted by
  `hsl_to_rgb`. Even spacing is the point: any two families a spec uses are 45°–180° apart,
  which the old six-entry table could not promise (`aqua` `125;174;163` and `blue`
  `125;160;184` read as the same teal 20° apart).
- **`group_families` runs the collision pass** over the spec's declared names: names sorted,
  each keeps its name-derived family unless an earlier name took it, else it takes the free
  family farthest in hue from the taken ones (ties: closer to its own family, then lower index).
  The answer depends on the name SET only — not declaration order — so two runs agree, and two
  views of one case that declare the same groups paint them the same.
- **`group_family` now uses the real FNV-1a 64 prime.** The old literal `0x1000_0000_01b3` was
  an extra nibble off (16x-ish) and spread names badly; `0x0100_0000_01b3` is the family hint the
  pass starts from, no longer the final answer.
- **Shades stay inside the family.** `group_family_color(family, member)` keeps the family hue
  and varies lightness (`[0.0, +0.10, −0.10, +0.19]`, drifting darker per wrap), so members of a
  group still differ node from node and still read as one family.
- **Layer colors are untouched**: `FAMILIES`, `layer_color`, and the regionless contract (no box,
  border, or title for a group) are unchanged; only the group hue source moved.

## Capacity

Up to eight groups per spec get eight distinct families; past that a family repeats, chosen at
the far end of the wheel, deterministically (`groups_past_the_wheel_capacity_stay_deterministic`).
The largest real case so far (machine-manager) declares six.
