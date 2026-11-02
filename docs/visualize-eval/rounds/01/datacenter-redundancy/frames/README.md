# Animation frames

The source turned the flow dots off ("remove the dots flowing for now", source line 134), and no later
message asked for them back. Every spec therefore has `flows = 0`, and the viewer header in every capture
reads `0 flows`.

Animation frames are consequently not applicable. As static evidence, each view stores two timestamped
frames under `captures/`: `<tag>-<ts>-visible.txt` and `<tag>-<ts>-frame2.txt`, taken a Tab round-trip apart.
The two files are byte-identical (per view), which proves the render is stable and nothing moves. The
selected state is stored separately as `<tag>-<ts>-selected.txt` / `.ansi`.
