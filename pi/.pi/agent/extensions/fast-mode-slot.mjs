// Shared fast-mode switch — the single owner of the process-wide fast-mode
// state.
//
// Extensions do NOT share module instances: the loader builds jiti with
// moduleCache: false, so importing fast-mode.ts from another extension (or an
// extension reload) yields a copy with its OWN closure state. The payload hook,
// the `/fast` command, and the prompt-bubble bolt would then each read a
// different flag — toggling fast mode would never move the other two. This
// module keeps the flag in ONE null-prototype holder on globalThis under a
// well-known symbol, so every copy shares one value (the keep-open-slot.mjs
// pattern).
//
// Plain .mjs on purpose: the loader auto-discovers and jiti-imports `*.ts`
// only, so this file is never mistaken for an extension. No imports, no side
// effects beyond the holder.

export const FAST_MODE_SLOT = Symbol.for("pi/fast-mode-slot");

const OFF_VALUES = new Set(["0", "off", "false", "no"]);

/** Startup default: PI_FAST_MODE in {0, off, false, no} (trimmed, any case) is off. */
export function resolveFastModeDefault(env = process.env) {
	return !OFF_VALUES.has((env.PI_FAST_MODE ?? "").trim().toLowerCase());
}

/** The process-wide holder, created lazily on first use: a later copy of this
 *  module (extension reload, a second jiti instance) adopts the existing holder
 *  instead of resetting `enabled` back to the startup default. A foreign or
 *  broken value on the key is replaced, exactly like keep-open-slot.mjs. */
export function fastModeSlot() {
	const existing = globalThis[FAST_MODE_SLOT];
	if (existing && typeof existing.getEnabled === "function") return existing;

	// Null prototype: no __proto__/constructor lookup can shadow a member.
	const slot = Object.create(null);
	const listeners = new Set();
	slot.default = resolveFastModeDefault();
	slot.enabled = slot.default;
	slot.getEnabled = () => slot.enabled;
	slot.setEnabled = (value) => {
		slot.enabled = Boolean(value);
		return slot.enabled;
	};
	slot.onChange = (listener) => {
		if (typeof listener !== "function") return () => {};
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
	slot.notify = () => {
		for (const listener of [...listeners]) {
			try {
				listener(slot.enabled);
			} catch {
				// A broken listener must not block the others (or the toggle).
			}
		}
	};
	globalThis[FAST_MODE_SLOT] = slot;
	return slot;
}

/** Current fast-mode state. */
export function fastModeEnabled() {
	return fastModeSlot().getEnabled();
}

/** Write the shared state; returns the new value. */
export function setFastModeEnabled(value) {
	return fastModeSlot().setEnabled(value);
}

/** Repaint hook: registers a listener, returns its unsubscribe. */
export function onFastModeChange(listener) {
	return fastModeSlot().onChange(listener);
}

/** Fire every listener (call after writing the state). */
export function notifyFastModeChange() {
	fastModeSlot().notify();
}
