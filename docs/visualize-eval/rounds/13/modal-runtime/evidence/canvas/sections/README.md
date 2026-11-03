# Per-diagram captures

Crops of one render, not separate renders. Source frame:
`../canvas-whole-135x48-frames.txt` (`viewport: 135x48 zoom: 1.00 natural`, frame 0), which draws
the whole 133x34 canvas — titles, descriptions and drawings — in one frame.

| file | source rows (1-based) | shows |
|---|---|---|
| `d1-section.txt` | 9–17 | d1 title + description + the anti-parallel pair drawing |
| `d2-section.txt` | 19–28 | d2 rule + title + description + the dispatch chain |
| `d3-section.txt` | 29–41 | d3 rule + title + description + storage/daemon drawing |

Regenerate:

```sh
BIN=/tmp/visualize-eval/round-13/bin/rataflow-view
COLUMNS=135 LINES=48 "$BIN" --frames 3 ../../../specs/modal-runtime-canvas.json > /tmp/whole.txt
awk 'NR>=9 && NR<=17' /tmp/whole.txt > d1-section.txt
awk 'NR>=19 && NR<=28' /tmp/whole.txt > d2-section.txt
awk 'NR>=29 && NR<=41' /tmp/whole.txt > d3-section.txt
```
