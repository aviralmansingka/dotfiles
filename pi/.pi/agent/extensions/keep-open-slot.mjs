// Shared keep-open slot — the single owner of the well-known
// Symbol.for("pi-subagents/keep-open-count") composition (#286 / finding C28).
//
// Multiple extensions publish their "keep this session open" count under the
// same slot (tuicr.ts's watcher, no-mistakes-pane.ts's run tracking; the
// nm-orchestrator loads both in one session). The historical fix had each
// writer capture the previous owner's function and publish an additive
// wrapper. That is symmetric only while both sides keep doing it, and it is
// idempotent only by accident: a module re-load (extension reload, a second
// jiti instance with moduleCache:false) captures ITS OWN previous wrapper and
// stacks another layer, silently doubling its own count.
//
// This module makes the composition symmetric and idempotent BY CONSTRUCTION:
//   - Composition state lives in ONE null-prototype holder on globalThis
//     (shared across every jiti/native copy of this file), keyed per owner.
//     Publishing twice for the same owner key REPLACES the entry — repeated
//     loads never stack.
//   - The published slot function is the holder's reader: it sums every
//     owner's count. A broken or non-function owner reads as 0 and never
//     masks the others.
//   - When the slot value is NOT this holder's reader (never published, or
//     clobbered by a foreign/legacy writer), publishing starts a FRESH
//     composition: the current slot value, if it is a function, becomes the
//     single foreign previous owner and its count survives — the exact
//     compose-with-previous-owner contract (3 → 4 → 3) both suites pin.
//
// Plain .mjs on purpose (the loader smoke only jiti-imports .ts files): no
// imports, no side effects beyond the globalThis holder, trivially loadable
// from both .ts publishers under jiti and from native ESM.

export const KEEP_OPEN_COUNT_KEY = Symbol.for("pi-subagents/keep-open-count");
const HOLDER_KEY = Symbol.for("pi-subagents/keep-open-slot-holder");

/** The process-wide composition holder: null-prototype so no __proto__
 *  lookup can ever shadow or pollute the owner entries. Recreated if a
 *  foreign value sits on the key (same recovery as a clobbered slot). */
function keepOpenHolder() {
	let holder = globalThis[HOLDER_KEY];
	if (holder === null || typeof holder !== "object") holder = null;
	if (!holder) {
		holder = Object.create(null);
		globalThis[HOLDER_KEY] = holder;
	}
	return holder;
}

const OWN_KEYS = ["foreign", "reader"];

/** A previous/foreign owner's count: broken, non-function, or non-positive
 *  values read as 0 so one bad writer can never mask the others. */
function safeCount(fn) {
	if (typeof fn !== "function") return 0;
	try {
		const value = fn();
		return typeof value === "number" && value > 0 ? value : 0;
	} catch {
		return 0;
	}
}

/** Publish this owner's count function into the shared slot. Idempotent:
 *  re-publishing the same owner key replaces its entry and never re-wraps
 *  the slot. Returns the slot's reader function. */
export function publishKeepOpenCount(ownerKey, countFn) {
	const holder = keepOpenHolder();
	if (typeof holder.reader !== "function" || globalThis[KEEP_OPEN_COUNT_KEY] !== holder.reader) {
		// Never published, or a foreign writer clobbered the slot: start a
		// fresh composition with the current value (when callable) as the
		// sole foreign previous owner — its count survives ours loading.
		for (const key of Object.keys(holder)) delete holder[key];
		const foreign = globalThis[KEEP_OPEN_COUNT_KEY];
		holder.foreign = typeof foreign === "function" ? foreign : null;
		holder.reader = () => {
			let total = safeCount(holder.foreign);
			for (const key of Object.keys(holder)) {
				if (OWN_KEYS.includes(key)) continue;
				total += safeCount(holder[key]);
			}
			return total;
		};
		globalThis[KEEP_OPEN_COUNT_KEY] = holder.reader;
	}
	holder[ownerKey] = countFn;
	return holder.reader;
}

/** Release this owner's entry entirely (idempotent; an owner that merely
 *  drops to zero can keep its entry — the reader sums it as 0). */
export function releaseKeepOpenCount(ownerKey) {
	const holder = keepOpenHolder();
	delete holder[ownerKey];
}

/** Safe read of the published slot: a missing, non-function, broken, or
 *  non-positive slot reads as 0. */
export function readKeepOpenCount() {
	return safeCount(globalThis[KEEP_OPEN_COUNT_KEY]);
}
