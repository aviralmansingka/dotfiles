// Pane-state visibility for an active no-mistakes run, through Herdr's
// sanctioned surfaces only.
//
//   - `pane report-metadata --state-label` — display-only labels next to the
//     managed integration's state. Metadata never takes over the managed
//     `herdr:pi` source's idle/working/blocked authority or session restore,
//     so it cannot fight the lifecycle hook. (Verified live: a second
//     reporting source is accepted but never overrides the holder, and
//     impersonating a `herdr:` source seq-locks the managed reporter out for
//     the rest of the session. Both are forbidden here.)
//   - the `herdr:blocked` event — relayed by the managed herdr-agent-state
//     extension into a real `blocked` state, the red state, for the CI phase.
//     Emitted as a balanced active:true/false pair per transition.
//
// Mapping while a run is observable (active, non-terminal):
//   - any phase running → the pane shows `nm: <phase>` as its idle and
//     working state labels
//   - the CI phase active → additionally `herdr:blocked` (red) with the
//     `no-mistakes: ci` label, released when CI settles
//   - run terminal / no observable run → labels cleared, blocked released

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import type { NoMistakesSnapshot } from "./status";

const REPORT_SOURCE = "user:no-mistakes";
const MANAGED_SOURCE = "herdr:pi";
export const CI_BLOCKED_LABEL = "no-mistakes: ci";

/** The label shown for the pane's idle/working states while a run is active:
 *  the current pipeline phase, e.g. `nm: review`. */
export function runPhaseLabel(snapshot: NoMistakesSnapshot): string | undefined {
	const phase = snapshot.currentPhase;
	return phase ? `nm: ${phase}` : undefined;
}

/** True while the CI phase is the active phase (waiting on checks or
 *  repairing them). `merge` (checks-passed monitoring) is deliberately not
 *  CI: the checks already passed, so nothing needs attention. */
export function isCiPhaseActive(snapshot: NoMistakesSnapshot): boolean {
	if (snapshot.currentPhase === "ci") return true;
	return snapshot.phases.some(
		(phase) =>
			phase.name === "ci" &&
			["running", "fixing", "awaiting_approval", "fix_review"].includes(phase.status),
	);
}

function herdrOk(args: string[]): boolean {
	try {
		execFileSync("herdr", args, { encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "ignore", "ignore"] });
		return true;
	} catch {
		return false;
	}
}

/** Show `label` for the pane's idle and working states. Display-only: it
 *  applies to the managed integration's states and clears cleanly. */
export function applyRunPaneLabels(paneId: string, label: string): boolean {
	return herdrOk([
		"pane",
		"report-metadata",
		paneId,
		"--source",
		REPORT_SOURCE,
		"--applies-to-source",
		MANAGED_SOURCE,
		"--state-label",
		`idle=${label}`,
		"--state-label",
		`working=${label}`,
	]);
}

/** Drop the run labels applied by applyRunPaneLabels. */
export function clearRunPaneLabels(paneId: string): boolean {
	return herdrOk([
		"pane",
		"report-metadata",
		paneId,
		"--source",
		REPORT_SOURCE,
		"--applies-to-source",
		MANAGED_SOURCE,
		"--clear-state-labels",
	]);
}

/** Drive the red `blocked` state through the managed extension's event
 *  channel. Callers must emit balanced transitions (true then false). */
export function setCiBlocked(pi: ExtensionAPI, active: boolean): void {
	pi.events.emit("herdr:blocked", { active, label: active ? CI_BLOCKED_LABEL : undefined });
}

/** A pane-state transition PaneReportState emits for one snapshot. */
export interface PaneReportActions {
	label?: string;
	clearLabels?: boolean;
	ciBlocked?: boolean;
}

/** Stateful gate so the wiring only emits label/blocked transitions on
 *  actual changes, never on every 1s status poll. */
export class PaneReportState {
	private label: string | undefined;
	private ciBlocked = false;

	/** Returns the actions to perform for this snapshot, deduped against the
	 *  last actions recorded by confirm(). An action the caller never
	 *  confirms re-emits on the next call, so a failed application is
	 *  retried on the next poll instead of being swallowed. */
	next(snapshot: NoMistakesSnapshot | undefined): PaneReportActions {
		if (snapshot) {
			const label = runPhaseLabel(snapshot);
			const ci = isCiPhaseActive(snapshot);
			const out: PaneReportActions = {};
			if (label !== undefined && label !== this.label) out.label = label;
			if (label === undefined && this.label !== undefined) out.clearLabels = true;
			if (ci !== this.ciBlocked) out.ciBlocked = ci;
			return out;
		}
		const out: PaneReportActions = {};
		if (this.label !== undefined) out.clearLabels = true;
		if (this.ciBlocked) out.ciBlocked = false;
		return out;
	}

	/** Records that the given actions were applied successfully. */
	confirm(actions: PaneReportActions): void {
		if (actions.label !== undefined) this.label = actions.label;
		if (actions.clearLabels) this.label = undefined;
		if (actions.ciBlocked !== undefined) this.ciBlocked = actions.ciBlocked;
	}
}
