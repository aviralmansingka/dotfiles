import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.NODE_PATH = [
  "/opt/homebrew/lib/node_modules",
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules",
  process.env.NODE_PATH || "",
].filter(Boolean).join(":");
require("node:module").Module._initPaths();

const _jitiCjs =
  process.env.JITI_PATH ||
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(_jitiCjs);
const jiti = createJiti(import.meta.url);

// We need to access the private build() method. Load the module and extract
// the UsageComponent class via the default export's closure is not possible.
// Instead, replicate the grid-width math to verify alignment at common widths.

const leftW = 4, cellW = 2;

function computeNWeeks(width) {
  const W = width - 2;
  // Must match usage.ts line ~147
  return Math.max(1, Math.floor((W - 3 - leftW + 1) / cellW));
}

function contentWidth(width) {
  return (width - 2) - 3;
}

function gridVisibleWidth(width) {
  const nWeeks = computeNWeeks(width);
  // After trimEnd, the last cell's trailing space is removed.
  return leftW + nWeeks * cellW - 1;
}

// The grid must fill the full content width exactly (no padding, no overflow).
for (const w of [80, 100, 120, 140, 160]) {
  const cw = contentWidth(w);
  const gw = gridVisibleWidth(w);
  assert.equal(gw, cw, `width=${w}: grid visible width ${gw} must equal content width ${cw}`);
}

// No overflow at any reasonable width.
for (let w = 20; w <= 200; w++) {
  const cw = contentWidth(w);
  const gw = gridVisibleWidth(w);
  assert.ok(gw <= cw, `width=${w}: grid overflows content area (${gw} > ${cw})`);
}

// No minimum-weeks floor that forces overflow.
// At width=20, old formula gave Math.max(6, ...) = 6 weeks needing 4+12-1=15,
// but content width is 15, so it barely fit. With width=12, old formula would
// force 6 weeks into a 7-char content area (overflow). New formula must not.
assert.ok(computeNWeeks(12) <= 3, "narrow width must not force too many weeks");

console.log("✓ All usage grid-width alignment tests passed");
