// Shared jiti/typebox resolution for every extension test (findings C26).
//
// Before this helper, each *.test.mjs hand-rolled the same jiti lookup with
// hardcoded host fallbacks (/opt/homebrew/..., nvm node dirs), so suites
// failed instantly on any machine that did not match the author's install —
// the exact "pre-existing red" masking hazard. One contract now:
//
//   1. explicit JITI_PATH env (validated to exist — a stale value fails
//      loudly instead of silently falling through),
//   2. a jiti under any NODE_PATH entry (how CI's prefix install provides
//      it),
//   3. caller-supplied extraFallbacks (host paths a file historically
//      needed — HOMEBREW_JITI / NVM_JITI below), then
//   4. pi's managed install (~/.pi/agent/install/releases/<current-version>),
//      the one local fallback that plausibly exists across the fleet.
//
// Otherwise: throw with the bootstrap command (same one scripts/nm-test.sh
// and the ci.yml pi-tests job use). Deterministic and offline — no installs,
// no network, no guessing.
//
// Plain .mjs on purpose: the extension loader smoke only jiti-imports .ts
// files, and this module stays trivially loadable regardless.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Host fallbacks for callers that historically needed them. NOT part of the
// default resolution order — a caller passes them via extraFallbacks only
// when its old fallback list had no pi-install entry covering that host.
export const HOMEBREW_JITI =
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
export const NVM_JITI =
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";

const BOOTSTRAP =
	"jiti not found; bootstrap it like scripts/nm-test.sh / the ci.yml pi-tests job: " +
	"npm install --prefix /tmp/jiti-root jiti@2 typebox@1.3.27 && " +
	"export JITI_PATH=/tmp/jiti-root/node_modules/jiti/lib/jiti.cjs NODE_PATH=/tmp/jiti-root/node_modules";

const jitiIn = (nodeModulesRoot) =>
	nodeModulesRoot ? join(nodeModulesRoot, "jiti/lib/jiti.cjs") : undefined;

// pi's managed install — the fleet-wide local fallback.
const piInstallJiti = () => {
	const installRoot = join(homedir(), ".pi/agent/install");
	const versionFile = join(installRoot, "current-version");
	if (!existsSync(versionFile)) return undefined;
	const jiti = jitiIn(
		join(installRoot, "releases", readFileSync(versionFile, "utf8").trim(), "node_modules"),
	);
	return jiti && existsSync(jiti) ? jiti : undefined;
};

// ".../node_modules/jiti/lib/jiti.cjs" -> ".../node_modules" — typebox sits
// next to jiti in every install that provides it (the same derivation CI and
// scripts/nm-test.sh use).
const nodeModulesRootOf = (jitiPath) => dirname(dirname(dirname(jitiPath)));

export function resolveJiti({ extraFallbacks = [] } = {}) {
	const explicit = process.env.JITI_PATH;
	if (explicit) {
		if (!existsSync(explicit)) {
			throw new Error(`JITI_PATH is set but does not exist: ${explicit}. ${BOOTSTRAP}`);
		}
		return { jitiPath: explicit, nodePath: nodeModulesRootOf(explicit) };
	}
	const candidates = [
		...(process.env.NODE_PATH || "").split(":").filter(Boolean).map(jitiIn),
		...extraFallbacks,
		piInstallJiti(),
	].filter(Boolean);
	const jitiPath = candidates.find((candidate) => existsSync(candidate));
	if (!jitiPath) throw new Error(BOOTSTRAP);
	return { jitiPath, nodePath: nodeModulesRootOf(jitiPath) };
}

// Env-object form — for spawning child test processes, or for
// `Object.assign(process.env, jitiEnv())` + `require("node:module").Module._initPaths()`.
export function jitiEnv(options) {
	const { jitiPath, nodePath } = resolveJiti(options);
	return { JITI_PATH: jitiPath, NODE_PATH: nodePath };
}
