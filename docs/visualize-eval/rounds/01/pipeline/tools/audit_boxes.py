import re, sys
def parse(path):
    data = open(path,'rb').read().decode('utf-8','replace')
    grid=[]
    for raw in data.split('\n'):
        raw=raw.rstrip('\r'); fg=bg=None; row=[]
        for m in re.finditer(r'\x1b\[([0-9;]*)m|([^\x1b])', raw):
            if m.group(2) is not None: row.append([m.group(2),fg,bg])
            else:
                ps=[int(p) for p in m.group(1).split(';') if p!=''] or [0]; i=0
                while i<len(ps):
                    p=ps[i]
                    if p==0: fg=bg=None
                    elif p in (38,48) and i+4<len(ps) and ps[i+1]==2:
                        v=tuple(ps[i+2:i+5])
                        if p==38: fg=v
                        else: bg=v
                        i+=4
                    i+=1
        grid.append(row)
    return grid
g=parse(sys.argv[1])
H=len(g); W=max(len(r) for r in g)
def cell(r,c):
    if r<0 or c<0 or r>=H or c>=len(g[r]): return (' ', None, None)
    return tuple(g[r][c])
# find boxes by top-left corner glyphs
boxes=[]
for r in range(H):
    for c in range(len(g[r])):
        ch=cell(r,c)[0]
        if ch=='╭':
            # find matching ╮ on same row
            c2=None
            for cc in range(c+1, len(g[r])):
                if cell(r,cc)[0]=='╮': c2=cc; break
            if c2 is None: continue
            # find matching ╰ on column c
            r2=None
            for rr in range(r+1, H):
                if cell(rr,c)[0]=='╰': r2=rr; break
            if r2 is None: continue
            boxes.append((r,c,r2,c2))
print("boxes found:", len(boxes))
bad=0
for (r,c,r2,c2) in boxes:
    label=''.join(cell(r+1,cc)[0] for cc in range(c+1,c2)).strip()
    cols=set()
    for cc in range(c,c2+1):
        for rr in (r,r2):
            ch,fg,bg=cell(rr,cc)
            cols.add(fg)
    for rr in range(r,r2+1):
        for cc in (c,c2):
            ch,fg,bg=cell(rr,cc)
            cols.add(fg)
    # sides complete?
    ok=True
    for cc in range(c+1,c2):
        if cell(r,cc)[0] not in '─┬┴┼': ok=False
        if cell(r2,cc)[0] not in '─┬┴┼': ok=False
    for rr in range(r+1,r2):
        if cell(rr,c)[0] not in '│├┤┼': ok=False
        if cell(rr,c2)[0] not in '│├┤┼': ok=False
    if cell(r,c)[0]!='╭' or cell(r,c2)[0]!='╮' or cell(r2,c)[0]!='╰' or cell(r2,c2)[0]!='╯': ok=False
    # dots on border?
    dots=[(rr,cc) for rr in range(r,r2+1) for cc in range(c,c2+1)
          if (rr in (r,r2) or cc in (c,c2)) and cell(rr,cc)[0] in '●▼▲◀▶']
    interior_bg=set(); interior_dots=[]
    for rr in range(r+1,r2):
        for cc in range(c+1,c2):
            ch,fg,bg=cell(rr,cc); interior_bg.add(bg)
            if ch in '●▼': interior_dots.append((rr,cc,ch))
    if None in cols:
        print(f"SKIP (no-fg border cell) rows{r}-{r2} cols{c}-{c2} border_fgs={[x for x in sorted(cols, key=lambda v: (v is None, v))]}")
        continue
    print(f"box rows{r}-{r2} cols{c}-{c2} label={label!r} w={c2-c+1} h={r2-r+1} border_fgs={[x for x in sorted(cols, key=lambda v: (v is None, v))]} sides_ok={ok} border_dots={dots} interior_bgs={interior_bg} interior_dots={interior_dots}")
print("global bg set:", set(bg for row in g for ch,fg,bg in row))

