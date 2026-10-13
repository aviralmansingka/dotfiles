#!/usr/bin/env node
// Paths: pi/.pi/agent/extensions/thinking-title.ts pi/.pi/agent/extensions/thinking-title.test.mjs pi/.pi/agent/settings.json scripts/test-pi-hidden-thinking-render.py
// Thinking rows render spinner-then-title through the thinking-title
// extension, with no bundle patching: the extension transformer owns the
// assistant-thinking markdown, so `pi update` can no longer drop the fix.
// This guard pins the wiring (settings entries, extension files, retired
// patch artifacts) and checks the live install read-only. The unit rules
// live in thinking-title.test.mjs; the rendered transcript contract lives
// in scripts/test-pi-hidden-thinking-render.py.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoSettings = path.join(checkout, 'pi/.pi/agent/settings.json');
const repoExtension = path.join(checkout, 'pi/.pi/agent/extensions/thinking-title.ts');
const retiredPatch = path.join(checkout, 'scripts/pi-patch-hidden-thinking');
const retiredExtension = path.join(checkout, 'pi/.pi/agent/extensions/thinking-blank.ts');

assert(fs.existsSync(repoExtension), 'pi/.pi/agent/extensions/thinking-title.ts must exist');
assert(!fs.existsSync(retiredPatch), 'scripts/pi-patch-hidden-thinking must stay retired (bundle patching is gone)');
assert(!fs.existsSync(retiredExtension), 'thinking-blank.ts must stay retired (a blank label re-creates the extra-line bug)');

const base = JSON.parse(fs.readFileSync(repoSettings, 'utf8'));
assert(base.extensions.includes('+extensions/thinking-title.ts'),
  'repo settings must enable +extensions/thinking-title.ts');
assert(!base.extensions.some((entry) => entry.includes('thinking-blank')),
  'repo settings must not reference thinking-blank');
assert(base.hideThinkingBlock !== true,
  'repo settings must not hide thinking blocks: the transformer only runs on the visible markdown path');

// Live install, read-only: the deployment failure this suite exists for.
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent');
const versionFile = path.join(agentDir, 'install/current-version');
if (!fs.existsSync(versionFile)) {
  console.log('live checks skipped: no pi install at', agentDir);
} else {
  const version = fs.readFileSync(versionFile, 'utf8').trim();
  const live = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
  assert(live.extensions.includes('+extensions/thinking-title.ts'),
    `live settings must enable +extensions/thinking-title.ts (run scripts/pi-settings-sync after changing the base)`);
  assert(!live.extensions.some((entry) => entry.includes('thinking-blank')),
    'live settings must not reference thinking-blank');
  assert(live.hideThinkingBlock !== true,
    `live settings hideThinkingBlock must not be true: hidden rows render one shared label and cannot show per-block titles`);
  assert(fs.existsSync(path.join(agentDir, 'extensions/thinking-title.ts')),
    'live extensions dir must contain thinking-title.ts (stow pi/ or re-run install.sh)');

  // No patch residue anywhere: a .unpatched backup means someone re-applied
  // the retired bundle patch.
  const releasesDir = path.join(agentDir, 'install/releases');
  const backups = fs.readdirSync(releasesDir).flatMap((release) => {
    const chunks = path.join(releasesDir, release,
      'node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks');
    return fs.existsSync(chunks) ? fs.readdirSync(chunks).filter((n) => n.endsWith('.unpatched')) : [];
  });
  assert.equal(backups.length, 0, `patch backups must not exist (${backups.join(', ') || 'none found'}); the bundle patch is retired`);

  console.log(`live checks passed against pi ${version}`);
}

console.log('pi-hidden-thinking tests passed');
