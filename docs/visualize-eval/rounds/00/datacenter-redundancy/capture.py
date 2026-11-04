# title: Reproduce timestamped unselected and selected live evidence
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time

ROOT = Path(__file__).resolve().parent
BINARY = Path('/tmp/visualize-eval/round-00/bin/rataflow-view')
SKILL = ROOT.parent / 'SKILL.md'
VIEWS = ['01-ingress', '02-security', '03-fabric', '04-racks']


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(args, output=None):
    start = now()
    result = subprocess.run(args, capture_output=True, text=True)
    if output:
        output.write_text(result.stdout)
    entry = {'started_at': start, 'finished_at': now(), 'argv': args,
             'command': shlex.join(args), 'exit': result.returncode,
             'stdout_path': str(output.relative_to(ROOT)) if output else None,
             'stdout': None if output else result.stdout, 'stderr': result.stderr}
    with (ROOT / 'execution.jsonl').open('a') as f:
        f.write(json.dumps(entry) + '\n')
    if result.returncode:
        raise RuntimeError(entry)
    return result


assert os.environ.get('HERDR_ENV') == '1'
identity = {'timestamp': now(), 'generator_pane': os.environ.get('HERDR_PANE_ID'),
            'generator_tab': os.environ.get('HERDR_TAB_ID'),
            'candidate_skill_sha256': hashlib.sha256(SKILL.read_bytes()).hexdigest(),
            'renderer_sha256': hashlib.sha256(BINARY.read_bytes()).hexdigest()}
(ROOT / 'execution-identity.json').write_text(json.dumps(identity, indent=2) + '\n')
assert identity['candidate_skill_sha256'] == '9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92'
assert identity['renderer_sha256'] == 'b6e11b05b4fb79ce969dc2646c667572535a949bd1a396fd711e1a5466298c8f'
for name in VIEWS:
    directory = ROOT / name
    check = run([str(BINARY), '--check', str(directory / 'spec.json')], directory / 'check.stdout')
    (directory / 'check.stderr').write_text(check.stderr)
    (directory / 'check.exit').write_text(str(check.returncode) + '\n')
    (directory / 'check.txt').write_text(check.stdout + check.stderr)
    created = json.loads(run(['herdr', 'pane', 'split', '--current', '--direction', 'right',
                              '--ratio', '0.5', '--cwd', os.getcwd(), '--no-focus']).stdout)
    pane = created['result']['pane']
    pid = pane['pane_id']
    assert pane['tab_id'] == identity['generator_tab']
    launch = (f"stty size > {shlex.quote(str(directory / 'dimensions.txt'))}; "
              f"date -u +%Y-%m-%dT%H:%M:%SZ > {shlex.quote(str(directory / 'dimensions.timestamp'))}; "
              f"{shlex.quote(str(BINARY))} {shlex.quote(str(directory / 'spec.json'))}; "
              f"herdr pane close {shlex.quote(pid)}")
    run(['herdr', 'pane', 'run', pid, launch])
    run(['herdr', 'pane', 'wait-output', pid, '--match', 'rataflow-view ·', '--timeout', '10000'])
    rows, cols = map(int, (directory / 'dimensions.txt').read_text().split())
    metadata = {'pane_id': pid, 'tab_id': pane['tab_id'], 'rows': rows, 'cols': cols,
                'zoom': 'natural initial 1; no zoom/fit input', 'animation': False, 'states': []}
    for state, filename in [('unselected', 'visible'), ('selected', 'visible-selected')]:
        if state == 'selected':
            run(['herdr', 'pane', 'send-keys', pid, 'tab'])
            time.sleep(0.3)  # Let the viewer paint the selection event.
        stamp = now()
        text = run(['herdr', 'pane', 'read', pid, '--source', 'visible'], directory / (filename + '.txt'))
        assert 'rataflow-view ·' in text.stdout
        run(['herdr', 'pane', 'read', pid, '--source', 'visible', '--format', 'ansi'], directory / (filename + '.ansi'))
        metadata['states'].append({'state': state, 'captured_at': stamp,
                                  'text': filename + '.txt', 'ansi': filename + '.ansi'})
    metadata['selection_ansi_changed'] = (directory / 'visible.ansi').read_bytes() != (directory / 'visible-selected.ansi').read_bytes()
    (directory / 'capture.json').write_text(json.dumps(metadata, indent=2) + '\n')
    run(['herdr', 'pane', 'send-text', pid, 'q'])
    # q exits the app; its own trailing command closes only its viewer pane.
    time.sleep(0.3)
    print(name, f'{cols}x{rows}', 'selection changed:', metadata['selection_ansi_changed'])
