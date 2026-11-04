#!/usr/bin/env python3
"""Intent: audit frozen case evidence and assemble stage-B review files only.

No viewer invocation, spec changes, live pane probes, installs, or source fixes.
All writes stay in this review directory; the blind record is never written.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path.cwd()
ROUND = Path('docs/visualize-eval/rounds/03')
CASE = ROUND / 'datacenter-redundancy'
REVIEW = ROUND / 'reviews/datacenter-redundancy'
SOURCE = Path('docs/visualize-eval/cases/datacenter-redundancy')
BLIND_HASH = 'fad23e2a7cbb1a760b485737def2f5e7f415ed7dc06bcd092bc30a7ddce13224'
SGR = re.compile(r'\x1b\[([0-9;]*)m')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def save(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def ansi_cells(text):
    rows = []
    for line in text.splitlines():
        cells, fg, bold, pos = [], None, False, 0
        for match in SGR.finditer(line):
            cells.extend((c, fg, bold) for c in line[pos:match.start()])
            values = [int(x) for x in match[1].split(';') if x] or [0]
            i = 0
            while i < len(values):
                value = values[i]
                if value == 0:
                    fg, bold = None, False
                elif value == 1:
                    bold = True
                elif value == 22:
                    bold = False
                elif value in (38, 48) and i + 4 < len(values) and values[i + 1] == 2:
                    if value == 38:
                        fg = tuple(values[i + 2:i + 5])
                    i += 4
                i += 1
            pos = match.end()
        cells.extend((c, fg, bold) for c in line[pos:])
        rows.append(cells)
    return rows


metadata = load(ROUND / 'metadata.json')
rubric = load(ROUND / 'rubric.json')
expected = load(SOURCE / 'expected.json')
generation = load(CASE / 'generation.json')
assert sha(REVIEW / 'observed-first.md') == BLIND_HASH
assert rubric['required_reviewer_model'] == 'openai/gpt-6.1-sol'
assert metadata['worker_labels']['datacenter-redundancy'] == 'viz-ds03-5'
verified_inputs = {}
for path, key in [(ROUND / 'SKILL.md', 'skill_sha256'),
                  (ROUND / 'rubric.json', 'rubric_sha256'),
                  (Path('docs/visualize-eval/cases.json'), 'cases_sha256'),
                  (Path(metadata['renderer_path']), 'renderer_sha256')]:
    actual = sha(path)
    assert actual == metadata[key], str(path)
    verified_inputs[str(path)] = actual
for name, key in [('source.md', 'source_sha256'), ('expected.json', 'expected_sha256'),
                  ('historical-variants.json', 'variants_sha256')]:
    path = SOURCE / name
    assert sha(path) == metadata['case_hashes']['datacenter-redundancy'][key]
    verified_inputs[str(path)] = sha(path)

spec_manifest = [{'path': str(p), 'sha256': sha(p)} for p in sorted((CASE / 'specs').glob('v*.json'))]
save(REVIEW / 'spec-manifest.json', spec_manifest)
for view in load(CASE / 'attempts.json')['views']:
    for attempt in view['attempts']:
        assert sha(CASE / attempt['spec_path']) == attempt['spec_sha256']

DIRECTIONS = {
    '│': [(0, -1), (0, 1)], '╎': [(0, -1), (0, 1)],
    '─': [(-1, 0), (1, 0)], '╌': [(-1, 0), (1, 0)],
    '╭': [(1, 0), (0, 1)], '╮': [(-1, 0), (0, 1)],
    '╰': [(1, 0), (0, -1)], '╯': [(-1, 0), (0, -1)]
}
HEAD_BACK = {'▼': (0, -1), '▲': (0, 1), '▶': (-1, 0), '◀': (1, 0)}
all_routes, view_data, artifact_hashes = {}, {}, {}
for v in ('v1', 'v2', 'v3', 'v4'):
    bundle = CASE / 'evidence' / v
    manifest = load(bundle / 'manifest.json')
    spec = load(CASE / 'specs' / f'{v}.json')
    assert sha(CASE / 'specs' / f'{v}.json') == manifest['spec_sha256']
    assert manifest['binary_sha256'] == metadata['renderer_sha256']
    for filename, digest in manifest['artifacts'].items():
        path = bundle / filename
        assert sha(path) == digest, str(path)
        artifact_hashes[str(path)] = digest
    cells = ansi_cells((bundle / f'{v}-ansi.ansi').read_text())
    selected = ansi_cells((bundle / f'{v}-selected.ansi').read_text())
    grid = [''.join(cell[0] for cell in row) for row in cells]
    assert len(grid) == 47 and all(len(row) == 77 for row in grid)
    boxes = []
    for y, row in enumerate(grid):
        for match in re.finditer('╭─+╮', row):
            x, width = match.start(), len(match[0])
            height = next((yy - y + 1 for yy in range(y + 1, len(grid))
                           if grid[yy][x:x + width] == '╰' + '─' * (width - 2) + '╯'), None)
            if height is None:
                continue
            label = ''.join(grid[yy][x + 1:x + width - 1].strip()
                            for yy in range(y + 1, y + height - 1))
            assert all(grid[yy][xx] == '│' for yy in range(y + 1, y + height - 1)
                       for xx in (x, x + width - 1))
            border = [(xx, yy) for yy in range(y, y + height) for xx in range(x, x + width)
                      if yy in (y, y + height - 1) or xx in (x, x + width - 1)]
            normal_colors = {cells[yy][xx][1] for xx, yy in border}
            assert len(normal_colors) == 1 and None not in normal_colors
            assert all(selected[yy][xx] == (grid[yy][xx], (216, 166, 87), True)
                       for xx, yy in border)
            boxes.append({'label': label, 'region': [x + 1, y + 1, width, height],
                          'normal_rgb': list(next(iter(normal_colors)))})

    def box_at(x, y):
        for box in boxes:
            bx, by, bw, bh = box['region']
            if bx - 1 <= x < bx - 1 + bw and by - 1 <= y < by - 1 + bh:
                return box
        return None

    names = {node['label']: node['id'] for node in spec['nodes']}
    routes = {}
    for y, row in enumerate(grid):
        for x, glyph in enumerate(row):
            if glyph not in HEAD_BACK:
                continue
            dx, dy = HEAD_BACK[glyph]
            target = box_at(x - dx, y - dy)
            assert target
            current, reverse_path, reverse_bends = (x, y), [(x, y)], []
            for _ in range(1000):
                nx, ny = current[0] + dx, current[1] + dy
                source = box_at(nx, ny)
                if source:
                    break
                char = grid[ny][nx]
                reverse_path.append((nx, ny))
                if char != '⌒':
                    options = DIRECTIONS[char]
                    assert (-dx, -dy) in options
                    onward = next(d for d in options if d != (-dx, -dy))
                    if onward != (dx, dy):
                        reverse_bends.append((nx, ny))
                    dx, dy = onward
                current = nx, ny
            else:
                raise AssertionError('unterminated route')
            pair = (names[source['label']], names[target['label']])
            assert pair not in routes and pair not in all_routes
            points = [reverse_path[-1]] + list(reversed(reverse_bends)) + [(x, y)]
            routes[pair] = {
                'view': v, 'source': source, 'target': target, 'head_glyph': glyph,
                'polyline': [[xx + 1, yy + 1] for xx, yy in points],
                'cells': set(reverse_path),
                'bridges': [[xx + 1, yy + 1] for xx, yy in reversed(reverse_path)
                            if grid[yy][xx] == '⌒'],
                'style': 'dashed' if any(grid[yy][xx] in '╎╌' for xx, yy in reverse_path) else 'solid'
            }
            all_routes[pair] = routes[pair]
    assert len(routes) == len(spec['edges'])
    assert set(routes) == {(edge['from'], edge['to']) for edge in spec['edges']}
    bridges = [[x + 1, y + 1] for y, row in enumerate(grid) for x, char in enumerate(row) if char == '⌒']
    for bridge in bridges:
        assert sum(bridge in route['bridges'] for route in routes.values()) == 2
    for ext in ('txt', 'ansi'):
        lines = (bundle / f'{v}-frames.{ext}').read_text().splitlines()
        markers = [(i, re.fullmatch(r'frame (\d+) at (\d+)ms', SGR.sub('', line)))
                   for i, line in enumerate(lines)]
        markers = [(i, match) for i, match in markers if match]
        assert [(int(match[1]), int(match[2])) for _, match in markers] == [(i, i * 200) for i in range(11)]
        bodies = ['\n'.join(lines[i + 1:i + 48]) for i, _ in markers]
        assert len(set(bodies)) == 1
        for body in bodies:
            normalized = [SGR.sub('', line).rstrip() for line in body.splitlines()]
            normalized += [''] * (47 - len(normalized))
            assert normalized == [line.rstrip() for line in grid]
            assert not any(char in body for char in '●•∙⦿')
        assert 'viewport: 77x47 zoom: 1.00 natural' in SGR.sub('', '\n'.join(lines))
    view_data[v] = {'boxes': boxes, 'routes': routes, 'bridges': bridges, 'manifest': manifest}

required_pairs = {(edge['from'], edge['to']) for edge in expected['historical_reference']['edges']}
assert required_pairs == set(all_routes) and len(all_routes) == 28
# Intent: inspect the existing cells only to substantiate the local avoidability argument.
# These are conceptual candidate corridors in memory, not generated specs or viewer runs.
for pair, points in [(('fw2', 'bl2'), [(44, 27), (44, 28), (48, 28), (48, 31)]),
                     (('sp2', 'leaf2'), [(32, 20), (32, 21), (57, 21), (57, 27)])]:
    route = all_routes[pair]
    conceptual_cells = set()
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        assert x1 == x2 or y1 == y2
        conceptual_cells.update((x - 1, y - 1) for x in range(min(x1, x2), max(x1, x2) + 1)
                                 for y in range(min(y1, y2), max(y1, y2) + 1))
    assert conceptual_cells <= route['cells']
    other_routes = [r for r in view_data[route['view']]['routes'].values() if r is not route]
    assert all(not conceptual_cells & r['cells'] for r in other_routes)

verification = {
    'verified_inputs': verified_inputs, 'blind_sha256': BLIND_HASH,
    'manifest_artifact_hashes_verified': len(artifact_hashes),
    'attempt_hashes_verified': 8,
    'source_relation_pairs': 28, 'captured_relation_pairs': 28, 'missing_pairs': [], 'extra_pairs': [],
    'views': {v: {'app_columns': 77, 'app_rows': 47, 'nodes': len(data['boxes']),
                  'edges': len(data['routes']), 'bridges': data['bridges'],
                  'selected_borders_complete': len(data['boxes']),
                  'frame_count': 11, 'distinct_frame_bodies_per_format': 1,
                  'flow_dots_per_frame': [0] * 11,
                  'outer_pane_dimensions_captured': False}
              for v, data in view_data.items()},
    'local_avoidability': 'Two existing routes each contain a shorter corridor that is a subset of their own captured cells and intersects no other captured route. No alternative render or fix was executed.',
    'classification': 'Evidence verification, not a replacement for independent visual judgment.'
}
save(REVIEW / 'verification.json', verification)

inventory = []
def evidence(identifier, path, description, capture=None):
    inventory.append({'id': identifier, 'path': str(path), 'sha256': sha(path),
                      'description': description, 'capture': capture})

for identifier, path, description in [
    ('metadata', ROUND / 'metadata.json', 'Frozen round-03 provenance, hashes, worker map, and identity-correction record.'),
    ('rubric', ROUND / 'rubric.json', 'Full corrected frozen rubric and embedded result schema, revision 4.'),
    ('dataset', Path('docs/visualize-eval/cases.json'), 'Frozen dataset descriptor; only this case was reviewed.'),
    ('skill', ROUND / 'SKILL.md', 'Executed candidate skill snapshot; not the current working skill.'),
    ('source', SOURCE / 'source.md', 'Source excerpts, human corrections, physical-arrow constraint, explicit no-dots request.'),
    ('expected', SOURCE / 'expected.json', 'Qualified source-backed 18-concept/28-relation expectation set.'),
    ('variants', SOURCE / 'historical-variants.json', 'Preserved local historical variants; no external chat was opened.'),
    ('blind', REVIEW / 'observed-first.md', 'Immutable stage-A observations; saved_before_expected_reveal: true; digest reverified before and after stage B.'),
    ('spec-manifest', REVIEW / 'spec-manifest.json', 'Deterministic sorted repository-relative spec path and actual SHA-256 pairs; digest is spec_sha256.'),
    ('generation', CASE / 'generation.json', 'Generator provenance, coverage, commands, reported dimensions and cleanup; self-report is not visual proof.'),
    ('generation-report', CASE / 'generation.md', 'Physical-link arrow convention, source coverage, and admitted presentation/evidence limitations.'),
    ('generation-builder', CASE / 'build-generation.py', 'Process record revealing that reported outer-pane dimensions are literals.'),
    ('attempts', CASE / 'attempts.json', '1/3/3/1 attempted-spec budget and selection rationale.'),
    ('verification', REVIEW / 'verification.json', 'Independent hash/capture/route verification derived only from frozen evidence; no render.'),
    ('review-helper', REVIEW / 'build-review.py', 'Review-only reproducible evidence parser and result assembler; never writes the blind record.')
]:
    evidence(identifier, path, description)
for path in sorted((CASE / 'attempts').glob('*.json')):
    evidence(path.stem, path, 'Preserved local attempt; digest verified against attempts.json; not accepted as a substitute for final captures.')
for v, data in view_data.items():
    bundle = CASE / 'evidence' / v
    manifest = data['manifest']
    evidence(f'{v}-spec', CASE / 'specs' / f'{v}.json', 'Final spec; actual hash matches generation and manifest; relation readability audited in captures.')
    evidence(f'{v}-manifest', bundle / 'manifest.json', 'Capture/check windows, recorded exit status and cleanup, artifact digests; pane_cols/pane_rect are null.')
    evidence(f'{v}-check', bundle / 'check.txt', 'Preserved complete check text; recorded exit 0 in manifest; no warning; not fit or ownership proof.')
    evidence(f'{v}-bin-hash', bundle / 'bin.sha256', 'Frozen absolute binary SHA-256 record; binary independently rehashed at the recorded absolute path.')
    evidence(f'{v}-validator', CASE / 'validator' / f'{v}.txt', 'Preserved all-pass harness output, not substituted for judging.')
    for suffix, fmt, state, frame in [
        ('text.txt', 'text', 'normal', 'normal standalone'),
        ('ansi.ansi', 'ansi', 'normal', 'normal standalone'),
        ('selected.ansi', 'ansi', 'all nodes selected', '--select-all standalone'),
        ('frames.txt', 'text', 'static frame sequence', '0..10; relative 0..2000ms at 200ms steps'),
        ('frames.ansi', 'ansi', 'static frame sequence', '0..10; relative 0..2000ms at 200ms steps')
    ]:
        kind = suffix.split('.')[0]
        capture = {
            'dimensions': {'columns': 77, 'rows': 47}, 'view': v, 'frame': frame,
            'timestamp': 'capture window ' + ' / '.join(manifest['capture_window']) + '; individual UTC frame times not recorded',
            'state': state, 'format': fmt
        }
        evidence(f'{v}-{kind}', bundle / f'{v}-{suffix}', 'Actual pane capture; dimensions denote the app buffer, not an independently measured outer-pane rectangle.', capture)

SRC = str(SOURCE / 'source.md')
EXP = str(SOURCE / 'expected.json')
RUB = str(ROUND / 'rubric.json')
locations = lambda view, regions: [{'evidence_id': f'{view}-ansi', 'region': region} for region in regions]
findings = [
    {'id': 'F1', 'category': 'layout_fit', 'edge_ids': ['e14', 'e16'], 'severity': 'medium',
     'description': 'Defect: v2 e16 makes a down-and-up hairpin and crosses e14 twice at [44,29] and [45,29]. The unchanged stem can turn right on row 28 into its own existing rightward run, retaining all nodes, ports, source group order and heads while avoiding both crossings. No alternative render or fix was executed.',
     'source_refs': [SRC + '#Original line 270 (user)', RUB + '#/categories/layout_fit'],
     'locations': locations('v2', [[44,28,5,3], [44,29,1,1], [45,29,1,1]])},
    {'id': 'F2', 'category': 'layout_fit', 'edge_ids': ['e23', 'e24'], 'severity': 'medium',
     'description': 'Defect: v3 e24 descends below e23, shifts one column, and climbs back above it, adding double bridges at [32,22] and [33,22]. Turning right at [32,21] into the existing row-21 run removes both crossings without moving any box or changing the mandated shared leaf tier or spine-above geometry. Nine crossings is not a demonstrated floor; no alternative render or fix was executed.',
     'source_refs': [SRC + '#Original line 248 (user)', SRC + '#Original line 270 (user)', RUB + '#/categories/layout_fit'],
     'locations': locations('v3', [[32,20,3,5], [32,22,1,1], [33,22,1,1]])},
    {'id': 'F3', 'category': 'layout_fit',
     'edge_ids': ['e5','e6','e7','e8','e9','e10','e11','e12','e13','e14','e15','e16','e17','e18','e19','e20','e21','e22','e23','e24','e25','e26','e27','e28'],
     'severity': 'medium',
     'description': 'Defect: 17 label occurrences have uncertain local owners: 3 stacked/squeezed x-connect words in v1, 4 fused active/standby words in v2, 6 ECMP words in v3, and all 4 dual words in v4. Words are complete, not clipped. This is a layout/readability defect; semantic and arrow gates pass because complete endpoint tracing plus homogeneous per-fan meanings, explicit firewall node roles, and dashed standby paths recover each required relation meaning without spec-only owner assignments. Local word ownership is not claimed uniquely proven.',
     'source_refs': [SRC + '#Original line 158 (user)', SRC + '#Original line 270 (user)', RUB + '#/categories/semantic_fidelity', RUB + '#/categories/arrow_traceability', RUB + '#/categories/layout_fit'],
     'locations': locations('v1', [[23,27,9,2],[22,31,9,1]]) + locations('v2', [[31,18,14,1],[29,28,12,1]]) + locations('v3', [[35,23,8,1],[29,25,4,1],[16,27,4,1],[30,27,4,1],[19,32,4,1]]) + locations('v4', [[33,22,8,1],[35,25,4,1],[38,26,4,1]])},
    {'id': 'G1', 'category': 'workflow_evidence', 'edge_ids': [], 'severity': 'high',
     'description': 'Evidence gap / blocker: all four manifests lack pane_cols and pane_rect. The report builder hardcodes the claimed 79x49 outer dimensions; no raw per-pane/probe measurement accompanies them. App buffers and viewport startup lines independently prove 77x47 natural 100%, but are not separate outer-pane measurement. live_pane remains null. The viewport-title regions identify the evidence that is present; missing manifest fields have no fabricated terminal coordinate.',
     'source_refs': [RUB + '#/categories/workflow_evidence', RUB + '#/categories/layout_fit', str(CASE / 'build-generation.py'), str(CASE / 'generation.json') + '#/known_defects'],
     'locations': sum((locations(v, [[2,1,66,1]]) for v in view_data), [])}
]

all_ansi = [f'{v}-ansi' for v in view_data]
all_selected = [f'{v}-selected' for v in view_data]
all_frames = [f'{v}-frames' for v in view_data]
# Evidence identifiers must be unique even for frames in two serialization formats.
for item in inventory:
    if item['capture'] and item['capture']['state'] == 'static frame sequence':
        item['id'] += '-' + item['capture']['format']
all_frames = [f'{v}-frames-{fmt}' for v in view_data for fmt in ('text','ansi')]

def category(status, reason, refs, ids):
    return {'applicable': True, 'status': status, 'reason': reason, 'source_refs': refs, 'evidence_ids': ids}

categories = {
    'semantic_fidelity': category('pass',
        'All 18 source concepts and 28 required directed physical-link relations are readable in captures, with complete four-view boundary coverage and the corrected same-height leaf tier. 17 local label owners remain uncertain, but required meanings are recovered by full endpoint tracing: x-connect/ECMP/dual fans are homogeneous; v2 firewall role node labels plus dashed standby paths disambiguate active/standby. No instantaneous/unique-per-word-leader gate is added. generation.md states physical connectivity, not proof of one-way traffic; standby? qualifies historical standby without removing links.',
        [SRC, EXP], ['source','expected','generation-report','blind'] + all_ansi),
    'arrow_traceability': category('pass',
        'Every one of 28 captured source stems reaches its unique intact head, including BL-to-spine arrows ending on side ports. All 15 crossings use distinguishable bridges; all independent paths remain separate with no shared runs, invented branch, trunk, missing head or dot-origin issue. Close bends and owner uncertainty slow reading but do not prevent complete endpoint tracing.',
        [SRC + '#Original line 270 (user)', EXP + '#/constraints'], ['blind'] + all_ansi),
    'layout_fit': category('fail',
        'Four measured 77x47 app buffers and startup viewport lines prove complete natural-100% fit, no clipping or overlay occlusion, and source-complete splits. However, captured counts 1/4/9/1 include at least four avoidable crossing cells: the e14/e16 and e23/e24 double hairpins can each be bypassed inside their own existing cells with all boxes, source groups and tiers fixed. Required source geometry does not force these detours. Seventeen locally uncertain label owners are additional layout/readability defects. A new global optimum is not claimed.',
        [RUB + '#/categories/layout_fit', SRC + '#Original line 248 (user)', SRC + '#Original line 270 (user)'], ['blind','verification','attempts'] + all_ansi + all_frames),
    'conceptual_grouping_color': category('pass',
        'Actual ANSI and box proximity show honest equipment-role hue families: WAN ISPs, MUXes, cores, firewall pair, border leaves, spines, rack leaves and racks. v3 leaves share top row 28 below both spine boxes. No source group or tier is reordered in the final views; cross-view hue stability is not a separate rubric gate.',
        [SRC + '#Original line 126 (user)', SRC + '#Original line 248 (user)', RUB + '#/categories/conceptual_grouping_color'], ['source','blind'] + all_ansi),
    'border_integrity': category('pass',
        'Normal ANSI proves all sides/corners complete and one continuous RGB foreground around every node perimeter, including taller port-bearing boxes. Selected ANSI proves bold RGB(216,166,87) throughout each full perimeter: 8/8 + 6/6 + 6/6 + 4/4 = 24/24. Evidence is simultaneous --select-all, not isolated interactive selection; the rubric permits this.',
        [RUB + '#/categories/border_integrity'], ['blind','verification'] + all_ansi + all_selected),
    'workflow_evidence': category('blocked',
        'Frozen skill, binary, corrected rubric, dataset/case hashes, four final specs, manifests and all 28 manifest-listed artifact hashes verify. Separate generator/reviewer identities, unchanged pre-reveal blind record, commands/check exit 0, text/ANSI/selected/frame evidence and cleanup records exist. Reviewer identity is true Sol under clerical revision 4, not stale Astra prose. But separate actual live-pane dimensions are not captured: all pane_cols/pane_rect fields are null and 79x49 in the report builder is literal. App viewport evidence cannot replace the missing raw pane/probe measurement. No new probe may repair this sample.',
        [RUB + '#/categories/workflow_evidence', str(ROUND / 'metadata.json') + '#/frozen_input_corrections'],
        ['metadata','rubric','dataset','skill','source','expected','variants','blind','spec-manifest','generation','generation-builder','verification'] + [f'{v}-manifest' for v in view_data] + all_frames),
    'animation': category('pass',
        'Applicable form is explicit static suppression: source Original line 134 asks to remove flowing dots, and expected.json/cases.json say off. All 44 sampled frame bodies show zero dots, identical across each view at 0,200,...,2000ms; no motion critical violation. Animated origin, travel spacing/direction and synchronized arrival are not claimed or required for these static links. This is not a five-frame alias inference or an animated success metric.',
        [SRC + '#Original line 134 (user)', EXP + '#/animation', 'docs/visualize-eval/cases.json#datacenter-redundancy.animation'], ['source','expected','dataset','blind','verification'] + all_frames)
}

edge_audit = []
for index, edge in enumerate(expected['historical_reference']['edges'], 1):
    pair = (edge['from'], edge['to'])
    route = all_routes[pair]
    view = route['view']
    edge_id = f'e{index}'
    label = edge.get('label')
    source_name, target_name = route['source']['label'], route['target']['label']
    for e in load(CASE / 'specs' / f'{view}.json')['edges']:
        if (e['from'], e['to']) == pair:
            assert e.get('label', '').removesuffix('?') == edge.get('label', '')
            assert route['style'] == e.get('style', 'solid')
            assert e.get('dots') == 0
            break
    if label is None:
        meaning = 'No edge label required or invented; ISP and MUX identities and physical relation visible.'
    elif label == 'standby':
        meaning = 'Visible standby? words qualify historical standby; dashed route and explicit FW2 standby endpoint recover meaning. Local placement is not a uniquely proven word-to-edge assignment.'
    elif label == 'active':
        meaning = 'Visible active words plus the FW1 active endpoint and solid route recover active role. Fused active/standby labels require tracing; exact local word owner is not certified.'
    else:
        meaning = f'Visible {label} words carry the homogeneous source-required meaning across this fan; every endpoint pair is independently traced. Local ownership ambiguity is retained in F3, not erased by the spec.'
    xs = [x + 1 for x, y in route['cells']]
    ys = [y + 1 for x, y in route['cells']]
    bbox = [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]
    cross_descriptions = []
    for bridge in route['bridges']:
        others = [p for p, r in all_routes.items() if r['view'] == view and r is not route and bridge in r['bridges']]
        assert len(others) == 1
        other_index = next(i for i, e in enumerate(expected['historical_reference']['edges'], 1)
                           if (e['from'], e['to']) == others[0])
        cross_descriptions.append(f'{bridge} with e{other_index}')
    finding_ids = []
    if edge_id in ('e14','e16'):
        finding_ids.append('F1')
    if edge_id in ('e23','e24'):
        finding_ids.append('F2')
    if label is not None:
        finding_ids.append('F3')
    edge_audit.append({
        'edge_id': edge_id, 'kind': 'independent_link',
        'source_refs': [EXP + f'#/historical_reference/edges/{index - 1}', SRC + '#Relationship facts from the historical attempt', SRC + '#Fixed constraints'],
        'expected': f'{source_name} -> {target_name}; physical connectivity in audit direction, not proof of one-way traffic; ' + (f'label meaning {label}; ' if label else 'unlabeled, no invented protocol; ') + 'independent redundancy link, never a bus.',
        'observed': f'{view}: {source_name} -> {target_name}, {route["style"]}. First drawn source stem {route["polyline"][0]}; source-to-head polyline {route["polyline"]}; unique intact {route["head_glyph"]} head {route["polyline"][-1]} adjacent to target border. Complete route traced without guessed branch; no shared run or junction. Bridges: ' + ('; '.join(cross_descriptions) if cross_descriptions else 'none') + '. ' + meaning + ' Zero flow dots in all 11 captured frames.',
        'status': 'pass',
        'locations': locations(view, [route['source']['region'], bbox,
                                     [*route['polyline'][0],1,1], [*route['polyline'][-1],1,1],
                                     route['target']['region']]),
        'finding_ids': finding_ids
    })

pane_ids = [view_data[v]['manifest']['pane_id'] for v in view_data]
probe = generation['cleanup']['probe_pane']['pane_id']
result = {
    'protocol_version': 1, 'round': 3, 'case_id': 'datacenter-redundancy',
    'candidate_sha256': metadata['skill_sha256'], 'renderer_sha256': metadata['renderer_sha256'],
    'rubric_sha256': metadata['rubric_sha256'], 'dataset_sha256': metadata['cases_sha256'],
    'spec_sha256': sha(REVIEW / 'spec-manifest.json'),
    'generator': {'worker_id': 'viz-ds03-5', 'model': 'fireworks/accounts/fireworks/routers/deepseek-flash-latest'},
    'reviewer': {'worker_id': 'viz-judge03-datacenter', 'model': 'openai/gpt-6.1-sol'},
    'viewport': {'columns':77, 'rows':47, 'zoom_percent':100, 'verified':True},
    'live_pane': None, 'evidence': inventory,
    'observed_first': {'evidence_id':'blind', 'saved_before_expected_reveal':True},
    'categories': categories, 'edge_audit': edge_audit, 'findings': findings,
    'blockers': ['G1: Missing raw outer-pane geometry for all four owned capture panes; manifests have null pane_cols/pane_rect. Reported 79x49 is hardcoded into the builder, not an independently preserved measurement. Need frozen per-pane/probe dimensions; app 77x47 does not substitute. No required model or renderer capability blocker is established; caption limitation is nonblocking because the arrow convention is stated externally as the source requires.'],
    'cleanup': {
        'owned_pane_ids': pane_ids + [probe], 'closed_pane_ids': pane_ids + [probe], 'status':'done',
        'reason': 'Four capture manifests record confirmed_closed for ' + ', '.join(pane_ids) + '; generation.json separately reports probe ' + probe + ' closed, without raw probe transcript. No cleanup failures are reported. Reviewer owned no panes and ran no new live probes. Recorded cleanup is not a replacement for missing geometry evidence.'
    },
    'overall': 'fail'
}
ids = [item['id'] for item in inventory]
assert len(ids) == len(set(ids)), 'duplicate evidence IDs'
for group in categories.values():
    assert set(group['evidence_ids']) <= set(ids)
for entry in edge_audit + findings:
    assert all(location['evidence_id'] in ids for location in entry['locations'])
    for location in entry['locations']:
        x,y,w,h = location['region']
        assert x >= 1 and y >= 1 and w >= 1 and h >= 1 and x + w - 1 <= 77 and y + h - 1 <= 47
assert sha(REVIEW / 'observed-first.md') == BLIND_HASH
save(REVIEW / 'reviewer-result.json', result)
print('spec manifest SHA-256:', result['spec_sha256'])
print('evidence records:', len(inventory), 'required edge audits:', len(edge_audit))
print('category matrix:', {key:value['status'] for key,value in categories.items()})
print('blind record unchanged:', sha(REVIEW / 'observed-first.md'))
