"use strict";

const DEFAULT_LINE_LENGTH = 120;
const LINK_TYPES = new Set(["image", "link"]);
const LINE_ENDING_TYPES = new Set(["hardBreakEscape", "hardBreakTrailing", "lineEnding"]);

function walk(tokens, visit) {
  for (const token of tokens || []) {
    visit(token);
    walk(token.children, visit);
  }
}

function visibleLinkLength(token) {
  let labelText;
  walk(token.children, (child) => {
    if (!labelText && child.type === "labelText") {
      labelText = child.text;
    }
  });
  return (labelText || "").length;
}

function visibleTokenLength(token) {
  if (LINK_TYPES.has(token.type)) {
    return visibleLinkLength(token);
  }

  let length = token.text.length;
  const subtractHiddenLinkText = (children) => {
    for (const child of children || []) {
      if (LINK_TYPES.has(child.type)) {
        length -= child.text.length - visibleLinkLength(child);
      } else {
        subtractHiddenLinkText(child.children);
      }
    }
  };
  subtractHiddenLinkText(token.children);
  return length;
}

function continuationPrefix(prefix) {
  return prefix.replace(/[^\s>]/gu, " ");
}

function lineAtoms(line, contentColumn, children, lineNumber) {
  const contentIndex = contentColumn - 1;
  const protectedSpans = children
    .filter(
      (token) =>
        !LINE_ENDING_TYPES.has(token.type) &&
        token.type !== "data" &&
        token.startLine === lineNumber &&
        token.endLine === lineNumber
    )
    .map((token) => ({
      start: token.startColumn - 1,
      end: token.endColumn - 1,
      visibleLength: visibleTokenLength(token),
    }))
    .sort((left, right) => left.start - right.start);

  const atoms = [];
  let current = null;
  const append = (text, visibleLength) => {
    current ||= { text: "", visibleLength: 0 };
    current.text += text;
    current.visibleLength += visibleLength;
  };
  const finish = () => {
    if (current) {
      atoms.push(current);
      current = null;
    }
  };
  let index = contentIndex;
  let spanIndex = 0;
  while (index < line.length) {
    while (spanIndex < protectedSpans.length && protectedSpans[spanIndex].end <= index) {
      spanIndex += 1;
    }

    const span = protectedSpans[spanIndex];
    if (span && span.start === index) {
      append(line.slice(span.start, span.end), span.visibleLength);
      index = span.end;
      spanIndex += 1;
      continue;
    }

    if (/\s/u.test(line[index])) {
      finish();
      index += 1;
      continue;
    }

    const nextProtected = span ? span.start : line.length;
    let end = index;
    while (end < nextProtected && !/\s/u.test(line[end])) {
      end += 1;
    }
    append(line.slice(index, end), end - index);
    index = end;
  }
  finish();
  return atoms;
}

function wrapLine(line, contentColumn, children, lineNumber, lineLength) {
  const prefix = line.slice(0, contentColumn - 1);
  const nextPrefix = continuationPrefix(prefix);
  const atoms = lineAtoms(line, contentColumn, children, lineNumber);
  if (atoms.length < 2) {
    return [line];
  }

  const wrapped = [];
  let current = prefix;
  let currentLength = prefix.length;
  let hasContent = false;
  for (const atom of atoms) {
    const separatorLength = hasContent ? 1 : 0;
    if (hasContent && currentLength + separatorLength + atom.visibleLength > lineLength) {
      wrapped.push(current);
      current = nextPrefix + atom.text;
      currentLength = nextPrefix.length + atom.visibleLength;
      hasContent = true;
    } else {
      current += (hasContent ? " " : "") + atom.text;
      currentLength += separatorLength + atom.visibleLength;
      hasContent = true;
    }
  }
  wrapped.push(current);
  return wrapped;
}

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["AV001", "visual-line-length"],
  description: "Visual line length",
  tags: ["line_length"],
  parser: "micromark",
  function: (params, onError) => {
    const lineLength = Number(params.config.line_length || DEFAULT_LINE_LENGTH);
    const paragraphs = [];
    walk(params.parsers.micromark.tokens, (token) => {
      if (token.type === "paragraph") {
        paragraphs.push(token);
      }
    });

    for (const paragraph of paragraphs) {
      for (let lineNumber = paragraph.startLine; lineNumber <= paragraph.endLine; lineNumber += 1) {
        const line = params.lines[lineNumber - 1];
        if (!line || /(?: {2}|\\)$/u.test(line)) {
          continue;
        }

        const child = paragraph.children.find(
          (token) => !LINE_ENDING_TYPES.has(token.type) && token.startLine === lineNumber
        );
        if (!child) {
          continue;
        }

        const wrapped = wrapLine(line, child.startColumn, paragraph.children, lineNumber, lineLength);
        if (wrapped.length > 1) {
          onError({
            lineNumber,
            detail: `Expected visual line length at most ${lineLength}`,
            range: [lineLength + 1, Math.max(line.length - lineLength, 1)],
            fixInfo: {
              editColumn: 1,
              deleteCount: line.length,
              insertText: wrapped.join("\n"),
            },
          });
        }
      }
    }
  },
};
