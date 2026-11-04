# Title: Reproduce frozen-viewer checks and timestamped unselected/selected captures
import datetime
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import time

ROOT = Path(__file__).resolve().parent
BINARY = Path('/tmp/visualize-eval/round-00/bin/rataflow-view')
SKILL = ROOT.parent / 'SKILL.md'
NAMES = ['requests', 'provisioning', 'boot-heartbeat', 'diagnostics']
LOG = []


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(argv, allow_failure=False):
    started = stamp()
    result = subprocess.run(argv, capture_output=True, text=True)
    LOG.append({'argv': argv, 'shell_display': shlex.join(argv), 'started_at': started,
                'finished_at': stamp(), 'exit': result.returncode,
                'stdout': result.stdout, 'stderr': result.stderr})
    (ROOT / 'execution.json').write_text(json.dumps(LOG, indent=2) + '\n')
    if result.returncode and not allow_failure:
        raise RuntimeError(f'{argv}: {result.stderr}')
    return result


def capture(pane, directory, stem, state):
    started = stamp()
    text = run(['herdr', 'pane', 'read', pane, '--source', 'visible']).stdout
    if 'rataflow-view · spec.json' not in text:
        raise RuntimeError('Viewer header absent')
    (directory / (stem + '.txt')).write_text(text)
    ansi = run(['herdr', 'pane', 'read', pane, '--source', 'visible', '--format', 'ansi']).stdout
    (directory / (stem + '.ansi')).write_text(ansi)
    return {'state': state, 'started_at': started, 'finished_at': stamp(),
            'text': stem + '.txt', 'ansi': stem + '.ansi',
            'header_verified': True, 'dots_in_text': text.count('●')}


for name in NAMES:
    directory = ROOT / name
    checked = run([str(BINARY), '--check', str(directory / 'spec.json')], allow_failure=True)
    (directory / 'check.stdout').write_text(checked.stdout)
    (directory / 'check.stderr').write_text(checked.stderr)
    (directory / 'check.txt').write_text(checked.stdout + checked.stderr)
    (directory / 'check.exit').write_text(str(checked.returncode) + '\n')
    split = json.loads(run(['herdr', 'pane', 'split', '--current', '--direction', 'right',
                           '--ratio', '0.5', '--cwd', str(Path.cwd()), '--no-focus']).stdout)
    pane = split['result']['pane']['pane_id']
    frames = []
    try:
        command = (f'stty size > {shlex.quote(str(directory / "dimensions.txt"))}; '
                   f'{BINARY} {shlex.quote(str(directory / "spec.json"))}; '
                   f'herdr pane close {pane}')
        run(['herdr', 'pane', 'run', pane, command])
        time.sleep(1.5)
        rows, cols = map(int, (directory / 'dimensions.txt').read_text().split())
        dimensions = {'rows': rows, 'cols': cols, 'target_rows': 47, 'target_cols': 77,
                      'pane_id': pane, 'tab_id': split['result']['pane']['tab_id'],
                      'natural_zoom': 1, 'manual_zoom_or_pan': False,
                      'measurement': 'stty size in viewer pane immediately before binary',
                      'recorded_at': stamp()}
        (directory / 'dimensions.json').write_text(json.dumps(dimensions, indent=2) + '\n')
        for stem in ['visible', 'visible-phase2', 'visible-phase3', 'visible-phase4']:
            frames.append(capture(pane, directory, stem, 'unselected; no input since launch'))
            time.sleep(1.3)
        run(['herdr', 'pane', 'send-keys', pane, 'Tab'])
        time.sleep(0.4)
        frames.append(capture(pane, directory, 'selected', 'after one Tab; no zoom/pan'))
        time.sleep(1.3)
        frames.append(capture(pane, directory, 'selected-phase2', 'after one Tab; no zoom/pan'))
        (directory / 'captures.json').write_text(json.dumps(frames, indent=2) + '\n')
        print(name, pane, f'{cols}x{rows}', 'dots', [f['dots_in_text'] for f in frames])
    finally:
        run(['herdr', 'pane', 'close', pane], allow_failure=True)

hashes = {str(BINARY): hashlib.sha256(BINARY.read_bytes()).hexdigest(),
          str(SKILL): hashlib.sha256(SKILL.read_bytes()).hexdigest()}
for path in ROOT.rglob('*'):
    if path.is_file() and path.name != 'hashes.json':
        hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
(ROOT / 'hashes.json').write_text(json.dumps({'recorded_at': stamp(), 'sha256': hashes}, indent=2) + '\n')
