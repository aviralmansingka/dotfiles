# apply the four Astra layout fixes to the schedule doc
import json, pathlib, urllib.request, urllib.error

TOK = open("/tmp/gw_token").read().strip()
DOC = pathlib.Path("/tmp/doc_id").read_text().strip()

def get():
    r = urllib.request.Request(f"https://docs.googleapis.com/v1/documents/{DOC}",
                               headers={"Authorization": "Bearer " + TOK})
    return json.load(urllib.request.urlopen(r))

def post(payload):
    r = urllib.request.Request(f"https://docs.googleapis.com/v1/documents/{DOC}:batchUpdate", method="POST",
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{e.code}: {e.read().decode()[:500]}")

d = get()
reqs = []

def ptext(el):
    return "".join(x.get("textRun", {}).get("content", "") for x in el.get("paragraph", {}).get("elements", []))

# 1. keep headings with their text, and cover spacing
for el in d["body"]["content"]:
    if "paragraph" not in el:
        continue
    s = ptext(el).strip()
    st = el["paragraph"].get("paragraphStyle", {}).get("namedStyleType", "NORMAL_TEXT")
    rng = {"startIndex": el["startIndex"], "endIndex": el["endIndex"] - 1}
    if st in ("HEADING_1", "HEADING_2"):
        reqs.append({"updateParagraphStyle": {"range": rng,
            "paragraphStyle": {"keepWithNext": True, "keepLinesTogether": True},
            "fields": "keepWithNext,keepLinesTogether"}})
        continue
    if el["startIndex"] == 1:
        p = {"spaceBelow": {"magnitude": 12, "unit": "PT"}}
    elif s == "Service Level Schedule":
        p = {"lineSpacing": 110, "spaceBelow": {"magnitude": 6, "unit": "PT"}}
    elif s.startswith("Service levels for delivered"):
        p = {"lineSpacing": 125, "spaceBelow": {"magnitude": 12, "unit": "PT"}}
    elif s.startswith(("D\u2009A\u2009T\u2009E", "P\u2009R\u2009E\u2009P\u2009A\u2009R\u2009E\u2009D", "S\u2009T\u2009A\u2009T\u2009U\u2009S")):
        p = {"lineSpacing": 155, "spaceBelow": {"magnitude": 4, "unit": "PT"}}
    elif s.startswith("S\u2009U\u2009M\u2009M\u2009A\u2009R\u2009Y"):
        p = {"lineSpacing": 155, "spaceBelow": {"magnitude": 12, "unit": "PT"}}
    else:
        continue
    reqs.append({"updateParagraphStyle": {"range": rng, "paragraphStyle": p, "fields": ",".join(p)}})

# 2. no split rows, and repeat header rows
for el in d["body"]["content"]:
    if "table" not in el:
        continue
    nrows = len(el["table"]["tableRows"])
    for r in range(nrows):
        reqs.append({"updateTableRowStyle": {
            "tableStartLocation": {"index": el["startIndex"]},
            "rowIndices": [r], "tableRowStyle": {"preventOverflow": True}, "fields": "preventOverflow"}})
    reqs.append({"pinTableHeaderRows": {"tableStartLocation": {"index": el["startIndex"]},
                                       "pinnedHeaderRowsCount": 1}})

# 3. margins, right and bottom corrected
reqs.append({"updateDocumentStyle": {"documentStyle": {
    "marginTop": {"magnitude": 59, "unit": "PT"}, "marginRight": {"magnitude": 64, "unit": "PT"},
    "marginBottom": {"magnitude": 54, "unit": "PT"}, "marginLeft": {"magnitude": 65, "unit": "PT"}},
    "fields": "marginTop,marginRight,marginBottom,marginLeft"}})

print("requests:", len(reqs))
post({"requests": reqs})
print("applied")

pdf = urllib.request.urlopen(urllib.request.Request(
    f"https://www.googleapis.com/drive/v3/files/{DOC}/export?mimeType=application/pdf",
    headers={"Authorization": "Bearer " + TOK})).read()
pathlib.Path("/tmp/schedule.pdf").write_bytes(pdf)
print("pdf bytes:", len(pdf))
