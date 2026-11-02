import re, sys, json
def parse(path):
    data = open(path, 'rb').read().decode('utf-8', 'replace')
    grid = []
    for raw in data.split('\n'):
        raw = raw.rstrip('\r')
        fg = bg = None
        row = []
        for m in re.finditer(r'\x1b\[([0-9;]*)m|([^\x1b])', raw):
            if m.group(2) is not None:
                row.append([m.group(2), fg, bg])
            else:
                params = [int(p) for p in m.group(1).split(';') if p != ''] or [0]
                i = 0
                while i < len(params):
                    p = params[i]
                    if p == 0:
                        fg = bg = None
                    elif p in (38, 48) and i + 4 < len(params) and params[i+1] == 2:
                        val = tuple(params[i+2:i+5])
                        if p == 38: fg = val
                        else: bg = val
                        i += 4
                    elif p == 39:
                        fg = None
                    elif p == 49:
                        bg = None
                    i += 1
        grid.append(row)
    return grid
path = sys.argv[1]
g = parse(path)
print("grid rows:", len(g), "max cols:", max(len(r) for r in g))
bgs = {}
for r in g:
    for ch, fg, bg in r:
        bgs[bg] = bgs.get(bg, 0) + 1
print("bg colors:", bgs)
fgs = {}
for r in g:
    for ch, fg, bg in r:
        if ch.strip():
            fgs[fg] = fgs.get(fg, 0) + 1
print("fg colors (non-space):")
for k, v in sorted(fgs.items(), key=lambda kv: -kv[1]):
    print("  ", k, v)
if len(sys.argv) > 2:
    out = sys.argv[2]
    lines = []
    for i, r in enumerate(g):
        lines.append("row %02d: " % i + " ".join("%s%s" % (ch, ("@"+ "%02x%02x%02x" % fg) if fg else "") for ch, fg, bg in r if ch.strip()))
    open(out, 'w').write("\n".join(lines) + "\n")
    print("wrote", out)
