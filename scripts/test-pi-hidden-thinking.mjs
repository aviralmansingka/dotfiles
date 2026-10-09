#!/usr/bin/env node
// Hidden thinking must render nothing: thinking-blank.ts blanks the label,
// and pi-patch-hidden-thinking guards the bundle's structural spacers out
// of hidden runs. This test drives the patch script against fixture bundles
// (patch, idempotency, half-patched upgrade, restore, changed and non-unique
// anchors) and then checks the live install state read-only. Live checks
// skip where no install exists, e.g. CI runners.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(checkout, 'scripts/pi-patch-hidden-thinking');
const { patches } = createRequire(import.meta.url)(script);

assert.equal(patches.length, 2, 'patch script must ship both anchors');
assert(patches[0].original.length > 100 && patches[1].original.length > 80, 'anchors look like real bundle code');
assert(patches[0].patched.includes('hiddenThinkingLabel.trim()'), 'run guard must key on the blank label');

// A syntactically valid ESM chunk embedding both original anchors as code.
// Built from the script's own patch list, so a changed anchor in the script
// fails here too — the fixture and the script cannot drift apart silently.
const fixture = (lead = patches[1].original, run = patches[0].original) =>
  `export const fixture = 1;\n` +
  `export function updateContent(message) {\n` +
  `  ${lead};\n` +
  `  ${run}\n` +
  `  return 1;\n` +
  `}\n`;

const makeAgentDir = (source) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-hidden-thinking-'));
  const chunks = path.join(root, 'install/releases/9.9.9-fixture/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks');
  fs.mkdirSync(chunks, { recursive: true });
  fs.writeFileSync(path.join(root, 'install/current-version'), '9.9.9-fixture');
  fs.writeFileSync(path.join(chunks, 'chunk-FIXTURE.js'), source);
  return root;
};

const patchRun = (agentDir, args = []) => {
  const result = spawnSync(process.execPath, [script, '--agent-dir', agentDir, ...args], { encoding: 'utf8' });
  return { status: result.status, out: (result.stdout || '') + (result.stderr || '') };
};

try {
  // Full patch from pristine anchors.
  const root = makeAgentDir(fixture());
  const chunk = path.join(root, 'install/releases/9.9.9-fixture/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-FIXTURE.js');
  const pristine = fs.readFileSync(chunk, 'utf8');
  let run = patchRun(root);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /patched chunk-FIXTURE\.js/);
  for (const patch of patches) {
    assert(fs.readFileSync(chunk, 'utf8').includes(patch.patched), `guard applied: ${patch.name}`);
  }
  assert(fs.existsSync(chunk + '.unpatched'), 'backup written');

  // Idempotent: second run changes nothing.
  const patchedOnce = fs.readFileSync(chunk, 'utf8');
  run = patchRun(root);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /already patched/);
  assert.equal(fs.readFileSync(chunk, 'utf8'), patchedOnce);

  // Restore round-trips to pristine and drops the backup.
  run = patchRun(root, ['--restore']);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /restored/);
  assert.equal(fs.readFileSync(chunk, 'utf8'), pristine);
  assert(!fs.existsSync(chunk + '.unpatched'));
  run = patchRun(root, ['--restore']);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /not patched/, 'pristine file with no backup reports not patched');

  // Half-patched release (one guard already spliced) upgrades in place.
  fs.writeFileSync(chunk, pristine.replace(patches[1].original, patches[1].patched));
  run = patchRun(root);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, new RegExp(patches[0].name));
  assert(!run.out.includes(patches[1].name), 'only the missing anchor is applied');
  assert(fs.readFileSync(chunk, 'utf8').includes(patches[0].patched));
  fs.rmSync(root, { recursive: true, force: true });

  // Changed bundle: neither original nor patched anchors — refuse loudly.
  const changed = makeAgentDir(fixture().replaceAll('"click"', '"klick"'));
  run = patchRun(changed);
  assert.equal(run.status, 1);
  assert.match(run.out, /bundle changed; review and update this script/);
  fs.rmSync(changed, { recursive: true, force: true });

  // Non-unique anchor: refuse rather than splice twice.
  const doubled = makeAgentDir(fixture() + fixture());
  run = patchRun(doubled);
  assert.equal(run.status, 1);
  assert.match(run.out, /not unique/);
  fs.rmSync(doubled, { recursive: true, force: true });

  // Live install, read-only: the deployment failure this suite exists for.
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent');
  const versionFile = path.join(agentDir, 'install/current-version');
  if (!fs.existsSync(versionFile)) {
    console.log('live checks skipped: no pi install at', agentDir);
  } else {
    const version = fs.readFileSync(versionFile, 'utf8').trim();
    const chunksDir = path.join(agentDir, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks');
    const sources = fs.readdirSync(chunksDir).filter((name) => name.endsWith('.js'));
    const live = sources.map((name) => fs.readFileSync(path.join(chunksDir, name), 'utf8'));
    for (const patch of patches) {
      assert(live.some((src) => src.includes(patch.patched)), `pi ${version}: live bundle misses guard "${patch.name}" — run scripts/pi-patch-hidden-thinking`);
      assert(live.every((src) => !src.includes(patch.original)), `pi ${version}: live bundle still has unpatched anchor "${patch.name}"`);
    }
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
    assert((settings.extensions || []).includes('+extensions/thinking-blank.ts'), 'live settings must enable thinking-blank.ts');
    assert(fs.existsSync(path.join(agentDir, 'extensions/thinking-blank.ts')), 'live extensions dir must contain thinking-blank.ts');
    console.log(`live checks passed against pi ${version}`);
  }

  console.log('pi-hidden-thinking tests passed');
} finally {
  for (const dir of fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('pi-hidden-thinking-'))) {
    fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true, force: true });
  }
}
