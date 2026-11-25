# build the SLA schedule as a docx in the Mohzi Company Overview house style
import re, pathlib
from docx import Document
from docx.shared import Pt, RGBColor, Twips
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

TEAL, NAVY, GREY, RULE, MUTE = "0F4C5C", "111827", "6B7280", "D1D5DB", "6B7280"
MD = pathlib.Path("/Users/aviral/mohzi/reference/sla-clauses/service-level-schedule.md").read_text()
MD = MD.split("## INTERNAL")[0]
MD = "## Standing and scope" + MD.split("## Standing and scope", 1)[1]

# ---------------- low level helpers ----------------
def run_fmt(run, size, color, bold=False, track=None, font="Inter"):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = font
    run.font.color.rgb = RGBColor.from_string(color)
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts"); rpr.append(rf)
    for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rf.set(qn(a), font)
    if track is not None:
        sp = OxmlElement("w:spacing"); sp.set(qn("w:val"), str(track)); rpr.append(sp)

def para_fmt(p, before=0, after=0, line=None, rule="auto", keep=False):
    pf = p.paragraph_format
    pf.space_before = Twips(before)
    pf.space_after = Twips(after)
    if keep:
        p._element.get_or_add_pPr().append(OxmlElement("w:keepNext"))
    if line is not None:
        sp = p._element.get_or_add_pPr().find(qn("w:spacing"))
        if sp is None:
            sp = OxmlElement("w:spacing"); p._element.get_or_add_pPr().append(sp)
        if rule == "auto":
            sp.set(qn("w:line"), str(line)); sp.set(qn("w:lineRule"), "auto")
        else:
            sp.set(qn("w:line"), str(line)); sp.set(qn("w:lineRule"), "exact")

def para_border(p, **sides):
    ppr = p._element.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    for side in ("top", "left", "bottom", "right"):
        if side in sides:
            color, sz, space = sides[side]
            e = OxmlElement(f"w:{side}")
            e.set(qn("w:val"), "single"); e.set(qn("w:color"), color)
            e.set(qn("w:sz"), str(sz)); e.set(qn("w:space"), str(space))
            bdr.append(e)
    ppr.append(bdr)

def para_text(p, parts):
    """parts: list of (text, size, color, bold, track)"""
    for i, (txt, size, color, bold, track) in enumerate(parts):
        r = p.add_run(txt)
        run_fmt(r, size, color, bold, track)

# ---------------- document shell ----------------
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Twips(12240), Twips(15840)
sec.top_margin, sec.right_margin = Twips(1150), Twips(1300)
sec.bottom_margin, sec.left_margin = Twips(1100), Twips(1300)
sec.header_distance, sec.footer_distance = Twips(708), Twips(708)
style = doc.styles["Normal"]
style.font.name = "Inter"
style.font.size = Pt(10)
style.paragraph_format.space_after = Twips(0)

def footer():
    f = sec.footer
    p = f.paragraphs[0]
    p.style = doc.styles["Normal"]
    para_fmt(p, before=0, after=0)
    para_border(p, top=(RULE, 4, 6))
    ts = p.paragraph_format.tab_stops
    for pos in (4680, 9360):
        ts.add_tab_stop(Twips(pos), WD_TAB_ALIGNMENT.CLEAR)
    ts.add_tab_stop(Twips(9620), WD_TAB_ALIGNMENT.RIGHT)
    r = p.add_run("Mohzi  \u00b7  Service Level Schedule  \u00b7  Confidential")
    run_fmt(r, 7.5, GREY)
    r = p.add_run("\t")
    run_fmt(r, 7.5, GREY)
    for xml in ('<w:fldChar w:fldCharType="begin"/>', '<w:instrText xml:space="preserve"> PAGE </w:instrText>',
                '<w:fldChar w:fldCharType="end"/>'):
        pass
    fld = p.add_run()
    run_fmt(fld, 7.5, GREY)
    b = OxmlElement("w:fldChar"); b.set(qn("w:fldCharType"), "begin")
    it = OxmlElement("w:instrText"); it.set(qn("xml:space"), "preserve"); it.text = " PAGE "
    e = OxmlElement("w:fldChar"); e.set(qn("w:fldCharType"), "end")
    fld._element.append(b); fld._element.append(it); fld._element.append(e)

footer()

# ---------------- cover ----------------
p = doc.add_paragraph(); para_fmt(p, before=0, after=200, line=240)
para_text(p, [("MOHZI  \u00b7  SERVICE LEVEL SCHEDULE  \u00b7  04 COMMERCIAL", 8, TEAL, True, 40)])

p = doc.add_paragraph(); para_fmt(p, before=60, after=100, line=276)
para_text(p, [("Service Level Schedule", 26, NAVY, True, None)])

p = doc.add_paragraph(); para_fmt(p, before=0, after=220, line=300)
para_text(p, [("Service levels for delivered GB300 capacity under a Master Capacity Agreement", 12, GREY, False, None)])

p = doc.add_paragraph(); para_fmt(p, before=0, after=120, line=240)
para_border(p, top=(NAVY, 8, 8), bottom=(NAVY, 8, 8))
para_text(p, [("DATE", 7, GREY, True, 20), ("  10 November 2026", 8.5, NAVY, False, None),
              ("      VERSION", 7, GREY, True, 20), ("  1.0 working draft", 8.5, NAVY, False, None),
              ("      STATUS", 7, GREY, True, 20), ("  Not an offer", 8.5, NAVY, False, None)])

p = doc.add_paragraph(); para_fmt(p, before=0, after=50, line=230)
para_text(p, [("SUMMARY", 7, GREY, True, 30)])
p = doc.add_paragraph(); para_fmt(p, before=0, after=200, line=300)
para_text(p, [("One availability target at 99.5% for each Server", 10, NAVY, True, None),
              (". One credit ladder, one cap per Server, response and restore targets by severity, "
               "and one maintenance window model.", 10, NAVY, False, None)])

# ---------------- markdown blocks ----------------
lines = MD.split("\n")
blocks, i = [], 0
while i < len(lines):
    ln = lines[i]
    if ln.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].startswith("|"):
            cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
            if not re.fullmatch(r"[\s\-:|]+", "".join(cells)):
                rows.append(cells)
            i += 1
        blocks.append(("table", rows))
    elif ln.startswith("### "):
        blocks.append(("h2", ln[4:].strip())); i += 1
    elif ln.startswith("## "):
        blocks.append(("h1", ln[3:].strip())); i += 1
    elif ln.startswith(">"):
        buf = []
        while i < len(lines) and lines[i].startswith(">"):
            t = lines[i].lstrip(">").strip()
            if t: buf.append(t)
            elif buf: blocks.append(("q", " ".join(buf))); buf = []
            i += 1
        if buf: blocks.append(("q", " ".join(buf)))
    elif not ln.strip():
        i += 1
    elif re.match(r"^\d+\.\s", ln.strip()):
        buf = [ln.strip()]; i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(\d+\.\s|[|>#])", lines[i].strip()):
            buf.append(lines[i].strip()); i += 1
        blocks.append(("li", " ".join(buf)))
    else:
        buf = [ln.strip()]; i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(\d+\.\s|[|>#])", lines[i].strip()):
            buf.append(lines[i].strip()); i += 1
        blocks.append(("p", " ".join(buf)))

INLINE = re.compile(r"\*\*(.+?)\*\*")

def add_inline(p, text, size=10, color=NAVY):
    text = text.replace("`", "")
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            r = p.add_run(text[pos:m.start()]); run_fmt(r, size, color)
        r = p.add_run(m.group(1)); run_fmt(r, size, color, True)
        if m.start() == 0 and text[m.end():m.end() + 1] == ":":
            r.font.underline = True
        pos = m.end()
    if pos < len(text):
        r = p.add_run(text[pos:]); run_fmt(r, size, color)

TW = {0: [3106, 4834, 1700], 1: [2200, 5840, 1600], 2: [2600, 7040], 3: [2600, 2700, 4340]}

def fix_grid(t, widths):
    tbl = t._tbl
    tblPr = tbl.tblPr
    for tag, attrs in (("w:tblW", {"w:w": str(sum(widths)), "w:type": "dxa"}),
                       ("w:tblLayout", {"w:type": "fixed"})):
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(k), v)
        tblPr.append(el)
    grid = tbl.find(qn("w:tblGrid"))
    if grid is None:
        grid = OxmlElement("w:tblGrid"); tbl.insert(1, grid)
    for col, w in zip(grid.findall(qn("w:gridCol")), widths):
        col.set(qn("w:w"), str(w))



def add_callout(text, fill="F2F6F7"):
    t = doc.add_table(rows=1, cols=1)
    t.autofit = False
    tblPr = t._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "none"); e.set(qn("w:sz"), "0"); e.set(qn("w:color"), "FFFFFF")
        borders.append(e)
    tblPr.append(borders)
    cell = t.cell(0, 0)
    tcPr = cell._tc.get_or_add_tcPr()
    tcB = OxmlElement("w:tcBorders")
    for side, (val, sz, col) in (("top", ("none", 0, "FFFFFF")), ("bottom", ("none", 0, "FFFFFF")),
                                  ("right", ("none", 0, "FFFFFF")), ("left", ("single", 18, TEAL))):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), val); e.set(qn("w:sz"), str(sz)); e.set(qn("w:color"), col)
        tcB.append(e)
    tcPr.append(tcB)
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill); tcPr.append(shd)
    mar = OxmlElement("w:tcMar")
    for side, w in (("top", 140), ("bottom", 140), ("left", 220), ("right", 200)):
        e = OxmlElement(f"w:{side}"); e.set(qn("w:w"), str(w)); e.set(qn("w:type"), "dxa"); mar.append(e)
    tcPr.append(mar)
    fix_grid(t, [9640])
    p1 = cell.paragraphs[0]
    para_fmt(p1, before=0, after=0, line=280)
    add_inline(p1, text)
    sp = doc.add_paragraph(); para_fmt(sp, before=0, after=140, line=240)

def add_card(text, fill="F3F4F6"):
    t = doc.add_table(rows=1, cols=1)
    t.autofit = False
    tblPr = t._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "none"); e.set(qn("w:sz"), "0"); e.set(qn("w:color"), "FFFFFF")
        borders.append(e)
    tblPr.append(borders)
    cell = t.cell(0, 0)
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill); tcPr.append(shd)
    mar = OxmlElement("w:tcMar")
    for side, w in (("top", 160), ("bottom", 160), ("left", 200), ("right", 200)):
        e = OxmlElement(f"w:{side}"); e.set(qn("w:w"), str(w)); e.set(qn("w:type"), "dxa"); mar.append(e)
    tcPr.append(mar)
    fix_grid(t, [9640])
    p1 = cell.paragraphs[0]
    para_fmt(p1, before=0, after=0, line=270)
    add_inline(p1, text)
    sp = doc.add_paragraph(); para_fmt(sp, before=0, after=160, line=240)

def add_table(rows, n):
    cols = max(len(r) for r in rows)
    if len(rows) == 2 and cols == 4:
        t = doc.add_table(rows=1, cols=4)
        t.autofit = False
        tblPr = t._tbl.tblPr
        borders = OxmlElement("w:tblBorders")
        for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
            e = OxmlElement(f"w:{side}")
            e.set(qn("w:val"), "none"); e.set(qn("w:sz"), "0"); e.set(qn("w:color"), "FFFFFF")
            borders.append(e)
        tblPr.append(borders)
        for i in range(4):
            cell = t.cell(0, i)
            cell.width = Twips(2400)
            tcPr = cell._tc.get_or_add_tcPr()
            tcB = OxmlElement("w:tcBorders")
            for side, sz in (("top", 8), ("bottom", 8), ("left", 0), ("right", 0)):
                e = OxmlElement(f"w:{side}")
                e.set(qn("w:val"), "single" if sz else "none")
                e.set(qn("w:sz"), str(sz)); e.set(qn("w:color"), NAVY if sz else "FFFFFF")
                tcB.append(e)
            tcPr.append(tcB)
            p1 = cell.paragraphs[0]; para_fmt(p1, before=140, after=40, line=240)
            r = p1.add_run(rows[0][i]); run_fmt(r, 18, NAVY, True)
            p2 = cell.add_paragraph(); para_fmt(p2, before=0, after=140, line=230)
            r = p2.add_run(rows[1][i].upper()); run_fmt(r, 7, GREY, True, 20)
        fix_grid(t, [2400] * 4)
        sp = doc.add_paragraph(); para_fmt(sp, before=0, after=160, line=240)
        return
    t = doc.add_table(rows=len(rows), cols=cols)
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    t.autofit = False
    tblPr = t._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "none"); e.set(qn("w:sz"), "0"); e.set(qn("w:color"), "FFFFFF")
        borders.append(e)
    tblPr.append(borders)
    head = " ".join(rows[0]).lower()
    if head.startswith("term"):
        widths = [3050, 5350, 1240]
    elif head.startswith(("what is checked", "check")):
        widths = [2400, 2600, 4640]
    elif head.startswith("severity"):
        widths = [1400, 3600, 1500, 1540]
    elif cols == 2:
        widths = [3000, 6640]
    else:
        widths = [2900, 5340, 1400]
    fix_grid(t, [widths[c] if c < len(widths) else 1500 for c in range(cols)])
    for r_i, row in enumerate(rows):
        tr = t.rows[r_i]._tr
        trPr = tr.get_or_add_trPr()
        trPr.append(OxmlElement("w:cantSplit"))
        if r_i == 0:
            trPr.append(OxmlElement("w:tblHeader"))
        for c_i in range(cols):
            cell = t.cell(r_i, c_i)
            cell.width = Twips(widths[c_i] if c_i < len(widths) else 1500)
            tcPr = cell._tc.get_or_add_tcPr()
            tcB = OxmlElement("w:tcBorders")
            for side, (val, sz, col) in (("top", ("none", 0, "FFFFFF")), ("bottom", ("none", 0, "FFFFFF")),
                                          ("right", ("none", 0, "FFFFFF")),
                                          ("left", ("single", 18, TEAL) if c_i == 0 else ("none", 0, "FFFFFF"))):
                e = OxmlElement(f"w:{side}")
                e.set(qn("w:val"), val); e.set(qn("w:sz"), str(sz)); e.set(qn("w:color"), col)
                tcB.append(e)
            tcPr.append(tcB)
            p = cell.paragraphs[0]
            para_fmt(p, before=40, after=40, line=240)
            txt = row[c_i] if c_i < len(row) else ""
            if r_i == 0:
                r = p.add_run(txt.upper()); run_fmt(r, 7, GREY, True, 20)
            else:
                add_inline(p, txt, 8.5, NAVY)
    sp = doc.add_paragraph(); para_fmt(sp, before=0, after=120, line=240)

ti = 0
def next_is_table(idx):
    return idx + 1 < len(blocks) and blocks[idx + 1][0] == "table"

for bi, (kind, val) in enumerate(blocks):
    if kind == "h1":
        num, title = "", val
        m = re.match(r"(\d+)\.\s*(.*)", val)
        if m:
            num, title = m.group(1), m.group(2)
        p = doc.add_paragraph(); para_fmt(p, before=200, after=160, line=240, keep=True)
        para_border(p, bottom=(RULE, 6, 6))
        if num:
            para_text(p, [(f"{num}  ", 15, TEAL, True, None), (title, 15, NAVY, True, None)])
        else:
            para_text(p, [(title, 15, NAVY, True, None)])
    elif kind == "h2":
        p = doc.add_paragraph(); para_fmt(p, before=160, after=80, line=270, keep=True)
        para_text(p, [(val, 12, NAVY, True, None)])
    elif kind == "p":
        p = doc.add_paragraph(); para_fmt(p, before=0, after=200, line=300,
                                         keep=next_is_table(bi))
        add_inline(p, val)
    elif kind == "li":
        p = doc.add_paragraph(); para_fmt(p, before=0, after=120, line=300)
        p.paragraph_format.left_indent = Twips(340)
        p.paragraph_format.first_line_indent = Twips(-340)
        add_inline(p, val)
    elif kind == "q":
        if val.startswith("**Worked example.**"):
            add_card(val)
        else:
            add_callout(val)
    elif kind == "table":
        add_table(val, ti); ti += 1

p = doc.add_paragraph(); para_fmt(p, before=200, after=0, line=240)
para_border(p, top=(RULE, 4, 6))
para_text(p, [("Confidential. Prepared for a partner data room.  Standard position, not an offer.",
               8.5, GREY, False, None)])



def fix_grid(t, widths):
    tbl = t._tbl
    tblPr = tbl.tblPr
    for tag, attrs in (("w:tblW", {"w:w": str(sum(widths)), "w:type": "dxa"}),
                       ("w:tblLayout", {"w:type": "fixed"})):
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(k), v)
        tblPr.append(el)
    grid = tbl.find(qn("w:tblGrid"))
    if grid is None:
        grid = OxmlElement("w:tblGrid"); tbl.insert(1, grid)
    for col, w in zip(grid.findall(qn("w:gridCol")), widths):
        col.set(qn("w:w"), str(w))

# ---------------- schema order normaliser ----------------
ORDERS = {
 "pPr": ["pStyle","keepNext","keepLines","pageBreakBefore","framePr","widowControl","numPr","suppressLineNumbers",
         "pBdr","shd","tabs","suppressAutoHyphens","kinsoku","wordWrap","overflowPunct","topLinePunct","autoSpaceDE",
         "autoSpaceDN","bidi","adjustRightInd","snapToGrid","spacing","ind","contextualSpacing","mirrorIndents",
         "suppressOverlap","jc","textDirection","textAlignment","textboxTightWrap","outlineLvl","divId","cnfStyle",
         "rPr","sectPr","pPrChange"],
 "rPr": ["rStyle","rFonts","b","bCs","i","iCs","caps","smallCaps","strike","dstrike","outline","shadow","emboss",
         "imprint","noProof","snapToGrid","vanish","webHidden","color","spacing","w","kern","position","sz","szCs",
         "highlight","u","effect","bdr","shd","fitText","vertAlign","rtl","cs","em","lang","eastAsianLayout",
         "specVanish","oMath"],
 "tblPr": ["tblStyle","tblpPr","tblOverlap","bidiVisual","tblStyleRowBandSize","tblStyleColBandSize","tblW","jc",
           "tblCellSpacing","tblInd","tblBorders","shd","tblLayout","tblCellMar","tblLook"],
}

def normalise(root):
    for tag, order in ORDERS.items():
        for el in root.iter(qn("w:" + tag)):
            kids = list(el)
            def key(k):
                name = k.tag.split("}")[1]
                return order.index(name) if name in order else len(order)
            for k in sorted(kids, key=key):
                el.remove(k); el.append(k)

normalise(doc.element.body)
for s_ in doc.sections:
    normalise(s_.footer._element)

out = "/tmp/sla-schedule.docx"
doc.save(out)
print("saved", out, len(open(out, "rb").read()), "bytes; tables:", ti)
