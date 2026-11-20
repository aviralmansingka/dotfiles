---
name: format
description: >-
  Apply the Mohzi house format to a document: US Letter geometry, Inter type
  scale, teal kicker, numbered sections, rule-lined tables, real footer, plus
  the Markdown structure and content order that match it. Use when writing,
  restyling, or reviewing a data-room document, memo, report, or proposal, or
  when the user types /format.
user-invocable: true
---

# format

Apply one house style to every external Mohzi document.
The style has two outputs: a Word or PDF file, and a Markdown file.
The rules below cover both.
Formatting never overrides the content. It makes the content easy to scan.

## The short version

- US Letter, Inter, ink `#111827`, one teal accent `#0F4C5C`.
- Kicker, title, deck, date band, then numbered sections.
- Section heads are 15 pt and carry a hairline rule.
- Tables are borderless except for horizontal rules.
- A real footer carries the document name and the page number.
- Markdown uses one H1, numbered H2 sections, and tables for parallel facts.

## 1. Page geometry

| Property | Value |
| --- | --- |
| Page | US Letter, 612 × 792 pt |
| Top margin | 57.5 pt |
| Right margin | 65 pt |
| Bottom margin | 55 pt |
| Left margin | 65 pt |
| Header distance | 35.4 pt |
| Footer distance | 35.4 pt |
| Measure | 482 pt, one column |
| Header | none |

Use the same geometry in Word and in the PDF export.

## 2. Colour and type

Use five colours only.

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#111827` | Titles, body, table text, numeric header fill |
| Teal | `#0F4C5C` | Kicker and section numerals only |
| Muted | `#6B7280` | Deck, labels, table labels, footer |
| Rule | `#D1D5DB` | Section and table rules |
| Zebra | `#F3F4F6` | Every second body row of a numeric table |
| Callout fill | `#F0F9FF` | Callout background |
| Callout accent | `#0369A1` | Callout bar and callout title |

Use Inter for every run: ascii, hAnsi, cs and eastAsia.
Do not mix a second typeface. Do not use Georgia, Arial or Calibri.

| Element | Size | Weight | Colour | Leading |
| --- | --- | --- | --- | --- |
| Kicker | 8 pt | bold | teal | 1.0 |
| Label | 7 pt | bold | muted | 1.0 |
| Meta value | 8.5 pt | regular | ink | 1.0 |
| Body | 10 pt | regular | ink | 1.25 |
| Deck | 12 pt | regular | muted | 1.25 |
| Section numeral | 15 pt | bold | teal | 1.0 |
| Section title | 15 pt | bold | ink | 1.0 |
| Title | 26 pt | bold | ink | 1.15 |
| Table caption | 11 pt | bold | ink | 1.0 |
| Table header | 8 pt | bold | white on ink | 1.0 |
| Table cell | 9 pt | regular | ink | 1.0 |
| Table label | 9 pt | bold | muted | 1.0 |
| Callout title | 8.5 pt | bold | callout accent | 1.0 |
| Callout body | 9 pt | regular | ink | 1.0 |
| Footer | 7.5 pt | regular | muted | 1.0 |

## 3. Document anatomy

Build every document in this order.

1. **Kicker.** 8 pt bold teal, uppercase, tracking 2 pt, 5 pt after.
   Pattern: `MOHZI · CAPACITY PARTNER DATA ROOM · 05 NETWORK`.
2. **Title.** 26 pt bold ink, 1.15 leading, 3 pt before, 5 pt after.
   Sentence case. No terminal full stop.
3. **Deck.** One sentence, 12 pt muted, 1.25 leading, 11 pt after.
   State the subject, the place and the scope.
4. **Date band.** 1 pt ink rule above and below, 8 pt space.
   Labels are 7 pt bold muted with 1 pt tracking.
   Values are 8.5 pt ink: `DATE` and `PREPARED BY`. Do not add a status field.
5. **Summary.** Section 1. One bold sentence, 10 pt.
6. **Scope.** Section 2. What the document covers and what it leaves out.
7. **Body sections.** Numbered 3 upward, in reading order.
8. **Items to close.** A three-column table: item, owner, how it closes.
9. **Figure or plan.** Last, on its own page if it is tall.
10. **Footer.** Real footer, not a body paragraph.

Do not add a table of contents. Do not add a cover page.
Do not add a revision table, a version log or an approval block.

## 4. Sections

- Number sections `1` to `n`, continuously.
- Put two spaces between the numeral and the title.
- Make the numeral teal and the title ink. Both are 15 pt bold.
- Add a 0.75 pt rule `#D1D5DB` across the measure, 8 pt below the head and
  4 pt above the body. Keep the gap under the rule tight.
- Use 18 pt before the head and 4 pt after the rule.
- In Google Docs the border padding sits below the head and `spaceBelow` is
  added after the rule, so the two stack. Set `spaceBelow` to 2 pt and let
  the 8 pt padding carry the rest. A `spaceBelow` of 8 pt doubles the gap.
- Keep the head with the next paragraph.
- Never skip a number. Never nest numbers such as `3.1`.
- Aim for 6 to 12 sections. Split at 12; merge below 6 if the parts are thin.

In Markdown, an H2 is a section head. Number it: `## 3 The rack and its ports`.
Do not add a horizontal rule under an H2. The heading is the rule.

## 5. Body copy

- Set 10 pt ink, 1.25 leading, 6 pt after, left aligned.
- Do not indent the first line.
- Write 2 to 6 sentences per paragraph. One idea per paragraph.
- Use the active voice, the present tense and short sentences.
- Put a number, a unit, an owner or a date in every factual sentence.
- Use bold only for the summary sentence, table first columns and names.
- Do not use bold for emphasis inside a sentence.
- Do not underline. Do not use italics except for document titles.
- Do not use bullet lists for prose. Use a table for parallel facts.
- Use a list only for a true sequence or a short set of 2 to 6 items.
- Write dates as `6 November 2026`. Write ranges with an en dash.
- Put a space between a value and its unit: `400 Gbps`, `4.5:1`, `25.6 Tbps`.
- Spell out a term at first use, then keep one term for one concept.

## 6. Tables

Two types. Pick by the data, never by taste.

**Type A — numbers.** A traditional table: header band, zebra rows, no rules.
Use it when every cell after the first column carries a value, a unit or a
number. Round trips, throughputs, counts, dates and step tables belong here.

| Property | Value |
| --- | --- |
| Width | 482 pt, fixed layout |
| Caption | 11 pt bold ink, 18 pt above the band |
| Header band | fill `#111827`, 19.5 pt tall, white 8 pt bold text |
| Header align | match the column: left for the first, right for numbers |
| Body rows | 9 pt ink, 3.5 pt padding above and below, 5 pt at the sides |
| Zebra | fill `#F3F4F6` on every second body row |
| Rules | none, outside or inside |
| Vertical rules | none |
| First column | regular weight, ink |
| Total row | bold, with a 0.75 pt `#D1D5DB` rule above it |
| Row split | not allowed |
| Header repeat | on every page |

**Type B — structured prose.** No band and no zebra. Use it when the cells hold
sentences: definitions, at-a-glance sets, method steps, scope in and out,
failure behaviour, items to close.

| Property | Value |
| --- | --- |
| Width | 482 pt, fixed layout |
| Kicker | 7.5 pt muted, spaced caps, 12 pt above the first rule |
| Label column | 9 pt bold muted, 100 pt wide, vertically centred |
| Prose column | 9 pt ink, 12.5 pt leading |
| Rules | 0.5 pt `#D1D5DB` between rows, and one closing the table |
| Fill | none |
| Vertical rules | none |

Rules for both types:

- Use 2 to 4 columns. Split a wider table into two tables.
- Put the unit in the header, not in every cell.
- Right-align numbers and their headers. Left-align text.
- Do not merge cells except in a callout.
- Every table sits under a section head, not under a small-caps label.
- If a table holds one number and one sentence, use prose instead.

## 7. Callouts

One callout to a page at most. Use it for the single caveat the reader must not
miss, or for what the customer configures.

- Fill `#F0F9FF`. Add a 3 pt `#0369A1` bar down the left edge.
- No other border. No shadow. No rounded corners.
- Pad 10 pt above and below, 10.5 pt from the bar, 5 pt at the right.
- Title 8.5 pt bold `#0369A1`, 13.5 pt above the body.
- Body 9 pt ink, 13.5 pt leading.
- Place it directly after the section or table it qualifies.
- Do not stack two callouts. Do not put a table inside one.
- Do not use teal for a callout. Teal marks the kicker and the section
  numerals only; the callout is the one blue element in the document.

## 8. Figures

- Set a maximum width of 466 pt inside the 482 pt measure.
- Do not add a border or a shadow.
- Keep the caption inside the source image. If you add one, use 7 pt muted.
- Refer to the figure in the body before it appears: `The plan below…`.
- If the figure cannot fit the remaining page, break the page before its
  section, not before the image alone. Do not leave a near-empty page.
- Do not scale a diagram below the point where its labels stay legible.

## 9. Footer

- Use the real footer area. Do not set it as the last body line.
- Add a 0.5 pt rule `#D1D5DB` above the line, 6 pt space.
- Set 7.5 pt muted text.
- Put `Mohzi · <document title> · Confidential` on the left.
- Put the page number on the right, at a right tab of 482 pt.
- Use a `PAGE` field for the number. Do not type the number.
- Do not add a header or a running title.

## 10. Markdown structure

Use this skeleton for every Markdown document.

```markdown
# Network topology map

One eight-rack GB300 zone at NxtGen Bidadi: the frontend, the fabric, the
border, the carrier handoffs and the management plane.

**DATE** 6 November 2026 · **PREPARED BY** Mohzi Inc

## 1 Summary

The map reproduces revision 1 of the rack diagram and covers one zone.

## 2 Scope

This document covers the fabric, the border and the management plane.
It leaves out storage, tenant isolation policy, carrier routes and power.

## 3 The rack and its ports

Each rack holds 18 BlueField-3 DPUs, one per tray.
```

Rules for Markdown:

- Use one H1 only. It is the title. Do not number it.
- Put the deck directly below the H1 as a plain paragraph.
- Put the date line next, with bold labels and a middle dot between fields.
- Use numbered H2 sections. Match the Word section titles word for word.
- Use H3 only inside a section, unnumbered, at most one level deep.
- Keep paragraphs to 2 to 6 sentences.
- Wrap prose near 100 characters. Keep a sentence on one line when it fits.
- Put one blank line around headings, tables, lists, code fences and images.
- Use pipe tables with a header row. Keep cells to one fact.
- Use bold for the summary sentence and for the first column of a table.
- Use italic only for document titles and for a term at first use.
- Use descriptive link text. Do not paste a bare URL.
- Use fenced code with a language tag. Use inline code for identifiers.
- Write figures as `![Caption](path)` on their own line.
- Do not use HTML, emoji or decorative rules.
- Do not use a blockquote for the deck.
- Write a callout as a blockquote whose first line is a bold title:
  `> **Configured per customer**` then the body on the next line.
  The quote bar is the callout bar the document type carries.
- Do not use a table of contents or anchor links.

## 11. Content order

Organise every document the same way.

1. **Summary.** The finding in one sentence. Bold it.
2. **Scope.** What is in, what is out, and where the out-of-scope work lives.
3. **The subject, layer by layer.** Rack, fabric, border, management.
4. **Failure behaviour.** What breaks, what the effect is, what to do.
5. **What the document does not show.** Name the gaps.
6. **Items to close.** Item, owner, how it closes.
7. **The plan.** Scale, phases and the next decision.

Content rules:

- Put the most important number in the first paragraph.
- Keep one decision per sentence. Keep one topic per section.
- State the mechanism, then the number that proves it.
- Attribute every item to close to a named owner and a closing action.
- Separate audience editions at the source, not with redactions.
- Keep prices, rates and financing out of the partner edition.
- Use absolute dates. Do not write "next week" or "soon".

House bans for external documents:

- No version numbers, version logs or status lines.
- No "draft", "partial", "open", "T-xx" or "still to come" language.
- No account of a negotiation, a change request or a reconciliation.
- No internal owner name unless the owner has cleared it for external use.
- No file name that carries a version number.

If the source text breaks a ban, fix it in the rebuild and report the change.
Do not carry a violation forward for the sake of fidelity.

## 12. Building the Word file

- Build with `python-docx`, not the Google Docs API.
  The Docs API cannot set paragraph borders, rule colours or character
  tracking. Those three properties define this style.
- Set the document defaults and the `Normal` style to Inter 10 pt ink.
  Set the font on all four script slots.
- Set character tracking with `w:spacing` in `w:rPr`: 40 twips for the
  kicker, 20 twips for labels and table headers.
- Set paragraph rules with `w:pBdr`. Set cell rules with `w:tcBorders`.
- Set cell padding with `w:tcMar`.
- Set `w:cantSplit` on every row and `w:tblHeader` on the header row.
- Set the table to fixed layout and set every `w:gridCol` width.
- Add the page-number field with `w:fldSimple` and a `PAGE` instruction.
  Remove the `Footer` paragraph style before you set the right tab, or the
  inherited centre tab takes the first tab stop.
- Set `page_break_before` on the figure section when the figure will not fit.
- Export a PDF and inspect every page before you ship.
  Check the footer tab, the table header repeat and the figure page.

- Sweep the paragraphs before you style them. A Google Doc can carry an
  inherited `borderTop` on every paragraph. Set `borderTop` and
  `borderBottom` width to 0 on every paragraph first, then add the three
  real rules: the date band, the section heads, the footer.
- The Docs API floors a border width to whole points. A 0.5 pt or 0.75 pt
  rule exports at 1 pt. If the exact weight matters, build with `python-docx`.
- Put the footer in a real footer with `createFooter`, not in the last body
  paragraph. Delete the body line afterwards and clear the border it leaves.
- A table must have a paragraph after it. Keep that paragraph at 1 pt with 0
  space before, and give the paragraph below it 14 pt.

## 13. Checklist

- [ ] US Letter, correct margins, 482 pt measure.
- [ ] Inter everywhere, five colours only.
- [ ] Kicker, title, deck, date band in order.
- [ ] Sections numbered without gaps, 15 pt, hairline rule.
- [ ] Summary is one bold sentence. Scope names what is out.
- [ ] Each table is the right type: A for numbers, B for prose.
- [ ] Type A has an ink header band, white 8 pt headers and a zebra row.
- [ ] Type B has 0.5 pt hairlines and no header band.
- [ ] Table rules and callout fill appear once each, in the right place.
- [ ] Header row repeats across pages. No row splits.
- [ ] Figure fits, is legible and does not strand a page.
- [ ] Footer has the rule, the document name and a page field.
- [ ] Markdown uses one H1 and numbered H2 sections that match the Word file.
- [ ] No version, status, negotiation or uncleared name in the text.
