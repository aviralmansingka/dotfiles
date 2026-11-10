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
| Ink | `#111827` | Titles, body, table text |
| Teal | `#0F4C5C` | Kicker, section numerals, accents |
| Muted | `#6B7280` | Deck, labels, footer |
| Rule | `#D1D5DB` | Section and table rules |
| Card | `#F3F4F6` | Card fills only |

Use Inter for every run: ascii, hAnsi, cs and eastAsia.
Do not mix a second typeface. Do not use Georgia, Arial or Calibri.

| Element | Size | Weight | Colour | Leading |
| --- | --- | --- | --- | --- |
| Kicker | 8 pt | bold | teal | 1.0 |
| Label | 7 pt | bold | muted | 1.0 |
| Meta value | 8.5 pt | regular | ink | 1.0 |
| Body | 10 pt | regular | ink | 1.25 |
| Deck | 12 pt | regular | muted | 1.25 |
| Section head | 15 pt | bold | ink and teal | 1.0 |
| Title | 26 pt | bold | ink | 1.15 |
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
   Values are 8.5 pt ink: `DATE`, `PREPARED BY`, and one status field only.
5. **Summary.** Section 1. One bold sentence, 10 pt.
6. **Scope.** Section 2. What the document covers and what it leaves out.
7. **Body sections.** Numbered 3 upward, in reading order.
8. **Open items.** A three-column table: item, owner, how it closes.
9. **Figure or plan.** Last, on its own page if it is tall.
10. **Footer.** Real footer, not a body paragraph.

Do not add a table of contents. Do not add a cover page.
Do not add a revision table, a version log or an approval block.

## 4. Sections

- Number sections `1` to `n`, continuously.
- Put two spaces between the numeral and the title.
- Make the numeral teal and the title ink. Both are 15 pt bold.
- Add a 0.75 pt rule `#D1D5DB` below the head, 6 pt space.
- Use 18 pt before the head and 8 pt after. Use 12 pt before section 1.
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

| Property | Value |
| --- | --- |
| Width | 482 pt (9640 twips), fixed layout |
| Outer border | none |
| Row rules | 0.5 pt `#D1D5DB`, top and bottom of every cell |
| Vertical rules | none |
| Cell padding | 4 pt top and bottom, 6 to 8 pt at the sides |
| Vertical align | top |
| Header | 7 pt bold muted, uppercase, 1 pt tracking |
| Body | 10 pt ink; first column bold |
| Row split | not allowed |
| Header repeat | on every page |

- Use 2 to 4 columns. Split wider tables into two tables.
- Put the unit in the header, not in every cell.
- Left-align text and numbers. Do not centre cells.
- Do not merge cells. Do not shade cells except in a card row.
- Use this table for failure behaviour: `Failure | Effect | Action`.
- Use this table for open items: `Item | Owner | How it closes`.

## 7. Cards

Use a card row for 3 headline facts at the top of a document.

- One table row, three content cells, two narrow spacer cells.
- Fill `#F3F4F6`. Add a 2.25 pt teal left border to each content cell.
- Pad 7 pt top and bottom, 8 pt left, 7 pt right.
- Stack: 7 pt muted label, 12 pt bold statement, 8.5 pt body.
- Do not use cards for more than three facts or for long text.

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
- Do not use HTML, emoji, coloured callouts or decorative rules.
- Do not use blockquotes for the deck. They add a vertical bar the house
  style does not have.
- Do not use a table of contents or anchor links.

## 11. Content order

Organise every document the same way.

1. **Summary.** The finding in one sentence. Bold it.
2. **Scope.** What is in, what is out, and where the out-of-scope work lives.
3. **The subject, layer by layer.** Rack, fabric, border, management.
4. **Failure behaviour.** What breaks, what the effect is, what to do.
5. **What the document does not show.** Name the gaps.
6. **Open items.** Item, owner, how it closes.
7. **The plan.** Scale, phases and the next decision.

Content rules:

- Put the most important number in the first paragraph.
- Keep one decision per sentence. Keep one topic per section.
- State the mechanism, then the number that proves it.
- Attribute every open item to a named owner and a closing action.
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

## 13. Checklist

- [ ] US Letter, correct margins, 482 pt measure.
- [ ] Inter everywhere, five colours only.
- [ ] Kicker, title, deck, date band in order.
- [ ] Sections numbered without gaps, 15 pt, hairline rule.
- [ ] Summary is one bold sentence. Scope names what is out.
- [ ] Tables have 0.5 pt row rules, 7 pt headers and a bold first column.
- [ ] Header row repeats across pages. No row splits.
- [ ] Figure fits, is legible and does not strand a page.
- [ ] Footer has the rule, the document name and a page field.
- [ ] Markdown uses one H1 and numbered H2 sections that match the Word file.
- [ ] No version, status, negotiation or uncleared name in the text.
