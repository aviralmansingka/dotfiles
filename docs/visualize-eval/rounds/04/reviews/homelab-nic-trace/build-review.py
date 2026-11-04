"""Intent: assemble this independent review from frozen evidence; never run the viewer or edit inputs."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path.cwd()
ROUND = Path('docs/visualize-eval/rounds/04')
CASE = ROUND / 'homelab-nic-trace'
OUT = ROUND / 'reviews/homelab-nic-trace'
SOURCE = Path('docs/visualize-eval/cases/homelab-nic-trace/source.md')
EXPECTED = SOURCE.with_name('expected.json')
VARIANTS = SOURCE.with_name('historical-variants.json')
BLIND = OUT / 'observed-first.md'
BLIND_HASH = 'a498a2866ade2b442dee4eb4a1049f952722f7e9fa52cc7521706786aabf1216'

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

assert sha(BLIND) == BLIND_HASH
metadata = json.loads((ROUND / 'metadata.json').read_text())
generation = json.loads((CASE / 'generation.json').read_text())
attempts = json.loads((CASE / 'attempts.json').read_text())
spec_paths = sorted((CASE / 'specs').glob('*.json'))
manifest_path = OUT / 'spec-manifest.json'
save_json(manifest_path, [{'path': p.as_posix(), 'sha256': sha(p)} for p in spec_paths])

# Intent: verify actual bytes against the frozen input identities, not generator opinions.
verified = [
    (ROUND / 'SKILL.md', metadata['skill_sha256']),
    (ROUND / 'rubric.json', metadata['rubric_sha256']),
    (Path('docs/visualize-eval/cases.json'), metadata['cases_sha256']),
    (Path(metadata['renderer_path']), metadata['renderer_sha256']),
    (SOURCE, metadata['case_hashes']['homelab-nic-trace']['source_sha256']),
    (EXPECTED, metadata['case_hashes']['homelab-nic-trace']['expected_sha256']),
    (VARIANTS, metadata['case_hashes']['homelab-nic-trace']['variants_sha256']),
]
for path, expected_hash in verified:
    assert sha(path) == expected_hash, path
for view in generation['views']:
    folder = CASE / 'evidence' / view
    m = json.loads((folder / 'manifest.json').read_text())
    assert sha(CASE / 'specs' / f'{view}.json') == m['spec_sha256']
    assert m['binary_sha256'] == metadata['renderer_sha256']
    for filename, expected_hash in m['artifacts'].items():
        assert sha(folder / filename) == expected_hash, filename
    if view != 'v1':
        assert sha(folder / f'{view}-frames-pinned.txt') == generation['views'][view]['captures']['frames_pinned_sha256']
for group in attempts['views'] + attempts['superseded_probes']:
    for attempt in group['attempts']:
        assert sha(CASE / attempt['spec']) == attempt['spec_sha256']
        assert (CASE / attempt['check_output']).exists()

inventory = []
path_ids = {}

def evidence(path, description, capture=None, identity=None):
    path = Path(path)
    identity = identity or re.sub(r'[^a-zA-Z0-9]+', '_', path.as_posix()).strip('_')
    inventory.append({'id': identity, 'path': path.as_posix(), 'sha256': sha(path), 'description': description, 'capture': capture})
    path_ids.setdefault(path.as_posix(), identity)
    return identity

for path, label in [
    (ROUND / 'metadata.json', 'Frozen round identities and input hashes'),
    (ROUND / 'rubric.json', 'All seven fixed category gates and result schema'),
    (ROUND / 'SKILL.md', 'Frozen candidate skill, not the mutable current skill'),
    (Path('docs/visualize-eval/cases.json'), 'Frozen dataset manifest; only this case reviewed'),
    (SOURCE, 'Revealed historical source excerpts and qualification constraints'),
    (EXPECTED, 'Revealed historical relation reference, subject to source corrections'),
    (VARIANTS, 'Historical generated graph; not independent factual verification'),
    (BLIND, 'Immutable blind stage-A record, saved before expectations were revealed'),
    (manifest_path, 'Deterministic sorted repository-relative final-spec path / SHA-256 pairs'),
]:
    evidence(path, label, identity={str(BLIND): 'observed_first', str(SOURCE): 'source', str(EXPECTED): 'expected', str(manifest_path): 'spec_manifest'}.get(str(path)))
for path in sorted(CASE.rglob('*')):
    if not path.is_file():
        continue
    description = 'Frozen candidate workflow / attempt artifact'
    capture = None
    relative = path.relative_to(CASE).parts
    identity = None
    if relative[0] == 'specs':
        description = 'Final spec; hash independently checked against capture manifest'
        identity = path.stem + '_spec'
    elif relative[0] == 'evidence':
        view = relative[1]
        leaf = path.name
        if leaf == f'{view}-text.txt' or leaf == f'{view}-ansi.ansi' or leaf == f'{view}-selected.ansi':
            state = 'all nodes selected' if 'selected' in leaf else 'normal captured view'
            fmt = 'ansi' if leaf.endswith('.ansi') else 'text'
            capture = {
                'dimensions': {'columns': 77, 'rows': 47}, 'view': view,
                'frame': 'standalone captured viewport',
                'timestamp': ' to '.join(json.loads((path.parent / 'manifest.json').read_text())['capture_window']),
                'state': state, 'format': fmt,
            }
            identity = view + ('_selected' if 'selected' in leaf else '_ansi' if fmt == 'ansi' else '_text')
            description = 'Actual app header proves 77x47 @100%; ANSI states decode to 47 rows of 77 cells'
        elif leaf == f'{view}-frames-pinned.txt':
            capture = {
                'dimensions': {'columns': 77, 'rows': 47}, 'view': view,
                'frame': '0..20', 'timestamp': 'relative 0..2000 ms, 100 ms step; absolute recapture timestamp not preserved',
                'state': 'pinned constant-speed motion; no same-arrival request', 'format': 'text',
            }
            identity = view + '_frames'
            description = 'Complete pinned timestamped 77x47 motion dump; independently verified late-added hash in generation.json'
        elif leaf in (f'{view}-frames.txt', f'{view}-frames.ansi'):
            description = 'Original in-pane motion stream, leading frame-0 fragment truncated by 1000-line scrollback; not full frame-0 evidence'
        elif leaf == 'check.txt':
            identity = view + '_check'
            description = 'Captured raw final --check output; exit 0 and timing recorded in adjacent manifest'
        elif leaf == 'manifest.json':
            identity = view + '_manifest'
            description = 'Original artifact hashes, capture/check windows, pane ID, approved measured header token, and confirmed-close record'
        elif leaf == 'validator.txt':
            identity = view + '_validator'
            description = 'Generator-run validator output, not independent visual proof'
    elif path.name == 'generation.json':
        identity = 'generation'
        description = 'Generator identity alias viz-ds04-3, coverage ledger, declared drops/defects, late pinned hashes; stale round 03 field explicitly explained as round-04 output'
    elif path.name == 'generation.md':
        identity = 'generation_notes'
        description = 'Generator narrative, including recorded qualifier and palette defects; coordinates use zero-based indexing'
    elif path.name == 'attempts.json':
        identity = 'attempts'
        description = 'Four final-view attempt groups plus three superseded probes: 14 distinct specs with raw check files and three verification reruns'
    evidence(path, description, capture, identity)

# Intent: make frame-specific locations unambiguous while retaining the original recording bytes.
for view in ('v2-lan', 'v3-overlay', 'v4-wan'):
    for frame in (0, 2, 10, 20):
        evidence(CASE / 'evidence' / view / f'{view}-frames-pinned.txt',
                 f'Frame-specific reference into existing pinned capture, frame {frame}; no new rendering',
                 {'dimensions': {'columns': 77, 'rows': 47}, 'view': view, 'frame': str(frame),
                  'timestamp': f'{frame * 100} ms relative; absolute recapture timestamp not preserved',
                  'state': 'constant-speed animation', 'format': 'text'},
                 f'{view}_frame_{frame}')

def loc(eid, x, y, width=1, height=1):
    return {'evidence_id': eid, 'region': [x, y, width, height]}

def finding(fid, category, edges, severity, description, refs, locations):
    return {'id': fid, 'category': category, 'edge_ids': edges, 'severity': severity,
            'description': description, 'source_refs': refs, 'locations': locations}

src = SOURCE.as_posix()
exp = EXPECTED.as_posix()
rub = (ROUND / 'rubric.json').as_posix()
skill = (ROUND / 'SKILL.md').as_posix()
animated = ['e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e13', 'e14', 'x2']
findings = [
    finding('F01', 'semantic_fidelity', ['e11', 'e12', 'e13', 'e14'], 'critical',
            'DEFECT: the WAN view presents a solid router/ONT/aggregation/backbone/Cloudflare chain without a visible historical-traceroute qualification. The ONT has claimed, but that does not qualify all downstream relations, and the WAN router drops the claimed marker visible in the separate LAN view. A prose-only generator assertion that no physical topology is asserted is not visible uncertainty in the graph. The source expressly says these are historical interpretations, not verified physical topology; dashed uncertainty plus a qualifier/legend or equivalent visible qualification is required, not necessarily one exact styling choice.',
            [src + '#Fixed constraints', exp + '#constraints/0'],
            [loc('v4-wan_text', 34, 8, 19), loc('v4-wan_text', 9, 16, 23), loc('v4-wan_text', 8, 19, 20, 24), loc('v2-lan_text', 29, 28, 22)]),
    finding('F02', 'semantic_fidelity', [], 'high',
            'DEFECT: source identifiers/qualifiers are not all readable in captures. homelab ASUS/Linux7 does not state bare metal or the exact Linux 7.0 version; the source MAC-vendor evidence identifier WNC OUI is absent; wlp8s0 .213 failover never explicitly says Wi-Fi. ASUS plus Linux is not proof of bare-metal residency. The ledger acknowledges the first and WNC omissions, but recording a required omission does not preserve it. Address-prefix shorthand .213 itself is source-backed and is not a defect.',
            [src + '#What the probes found', exp + '#historical_reference/nodes'],
            [loc('v2-lan_text', 29, 12, 19), loc('v2-lan_text', 53, 20, 20), loc('v2-lan_text', 29, 28, 22)]),
    finding('F03', 'semantic_fidelity', [], 'critical',
            'DEFECT: source-stated role mappings are absent: the router as collapsed ToR/spine/border/firewall, and the ONT as demarc/MMR analog. The 1 ISP summary preserves the single-provider fact but not those source role meanings. These can be annotations on real nodes; preserving them does not require inventing physical ToR/spine/MMR nodes. The generator expressly drops these concepts. The Oct 11 run-accounting date and comparison design are recorded as absent background, not separate topology failures.',
            [src + '#Mapped onto the datacenter model'],
            [loc('v2-lan_text', 29, 28, 22), loc('v2-lan_text', 29, 36, 16), loc('v4-wan_text', 34, 8, 19), loc('v4-wan_text', 9, 16, 23)]),
    finding('F04', 'arrow_traceability', ['x2'], 'medium',
            'DEFECT, recorded rather than silently dropped: no committed rate is readable at [31,32,17,1], but its midpoint (39,32) is 10 cells from its own route at (29,32) and 7 cells from the competing Wi-Fi-to-router run at (39,25). Its left edge is only 2 cells from its own route, so intended ownership is locally recoverable, not fully clear. Generation records this and two overflowing rewrites; that honesty preserves the qualifier but does not turn an acknowledged placement defect into a green gate. The narrow no-unambiguous-placement exception is not established by two node-label rewrites that overflowed: the evidence does not prove no unambiguous layout/split was available.',
            [src + '#Mapped onto the datacenter model', rub + '#categories/arrow_traceability', skill + '#Step 7'],
            [loc('v2-lan_text', 31, 32, 17), loc('v2-lan_text', 29, 31, 1, 4), loc('v2-lan_text', 31, 25, 23)]),
    finding('F05', 'arrow_traceability', animated, 'high',
            'DEFECT affecting arrow_traceability and animation: all 11 frame-0 dots start on the second exterior route cell, not the first drawn cell after their source port. LAN examples: actual origin (29,15), dot (29,16); overlay origins (35,21)/(35,23), dots (36,21)/(36,23); WAN ONT origin (9,19), dot (9,20). The full 11-row table is in the immutable blind record. Captured checks report origins 5/5, 2/2, 4/4 and 0 dot violations; those internal counters do not satisfy the actual-origin rubric. All static arrowheads remain traceable, but the rubric explicitly makes an away-from-origin dot fail animated arrow-direction proof.',
            [rub + '#categories/arrow_traceability', rub + '#categories/animation', skill + '#Step 6'],
            [loc('v2-lan_frame_0', 29, 15, 3, 2), loc('v2-lan_frame_0', 5, 23, 1, 2), loc('v2-lan_frame_0', 53, 23, 1, 2), loc('v2-lan_frame_0', 29, 31, 1, 2), loc('v3-overlay_frame_0', 35, 21, 2, 3), loc('v4-wan_frame_0', 34, 11, 1, 2), loc('v4-wan_frame_0', 9, 19, 1, 2), loc('v4-wan_frame_0', 9, 27, 1, 2), loc('v4-wan_frame_0', 9, 35, 1, 2)]),
    finding('F06', 'animation', ['e5'], 'medium',
            'DEFECT: in v3-overlay pinned frame 20 at 2000 ms, the upper dot occupies (46,22), replacing the route bend whose standalone glyph is a lower-left rounded corner. This is one observed route/frame corner-contact event; the check and generator claim zero such violations. It is not an arrowhead arrival and is not excused by default constant-speed timing.',
            [rub + '#categories/animation', skill + '#Step 6'],
            [loc('v3-overlay_frame_20', 46, 22), loc('v3-overlay_text', 46, 22)]),
    finding('F07', 'border_integrity', ['e14'], 'medium',
            'DEFECT affecting border_integrity and layout_fit: the control palette intersects the Cloudflare box in [8,41,3,2] and overwrites three perimeter cells: (8,41) is palette horizontal line rather than node vertical side, (8,42) is the control label closing bracket rather than bottom-left corner, and (10,42) is palette vertical line rather than node bottom edge. Top/right sides and the row-40 node label remain readable. ANSI proves the palette colors replace node RGB (169,182,101), and selected ANSI proves the same three cells fail to become the node selected accent. Thus 19/19 occurrences have selected-border evidence but only 18/19 have complete visible selected outlines.',
            [rub + '#categories/layout_fit', rub + '#categories/border_integrity', skill + '#Step 7'],
            [loc('v4-wan_ansi', 8, 39, 20, 4), loc('v4-wan_selected', 8, 41, 3, 2)]),
    finding('F08', 'workflow_evidence', [], 'high',
            'EVIDENCE GAP / BLOCKER: the frozen case bundle contains specs, raw check stdout, manifests with final check_exit=0 and capture windows, hashes, validators and recorded cleanup, but no exact executed invocation log, separate stderr/combined-stream declaration, or process exit-status records for the rejected/probe checks. Do not reconstruct exact commands from SKILL.md templates or the current harness. The verification-rerun index also references missing specs/v2.json; the corresponding archived v2-combined-a3 spec and matching raw check are preserved, so this is a stale index path, not a lost final view. Workflow reproducibility remains blocked rather than passed.',
            [rub + '#categories/workflow_evidence', (CASE / 'attempts.json').as_posix(), (CASE / 'generation.json').as_posix()],
            [loc('v1_text', 2, 1, 66), loc('v2-lan_text', 2, 1, 70), loc('v3-overlay_text', 2, 1, 74), loc('v4-wan_text', 2, 1, 70)]),
    finding('F09', 'animation', ['e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11'], 'high',
            'EVIDENCE GAP / BLOCKER: all complete pinned dumps end at 2000 ms, before the seven long-route dots have crossed their routes; no full default-speed cycle is captured. In particular, LAN host-to-bond0 is still at (19,17) with its arrowhead at (5,18), and WAN router-to-ONT is still at (24,13) with head at (9,14). The short routes reset every few frames. The generator constant-speed proof selects only long LAN routes and omits its short router-to-Fios route. Thus complete per-route full-cycle speed/corner behavior remains unverified. Unequal arrivals and absence of same-arrival timing are not defects: the source requests neither animation nor synchronized arrival.',
            [rub + '#categories/animation', skill + '#Step 8', 'docs/visualize-eval/cases.json#homelab-nic-trace/animation'],
            [loc('v2-lan_frame_20', 5, 15, 49, 20), loc('v3-overlay_frame_20', 35, 21, 13, 7), loc('v4-wan_frame_20', 9, 11, 26, 4)]),
]

# Intent: audit all 14 source edges plus both extra source-backed apparent relations.
rows = [
    ('e1', 'v1', 'vm', 'virbr', '192.168.122.x segment', [(53,19),(53,22)], [55,20,13,1], [53,16,8,1], [53,24,17,1]),
    ('e2', 'v1', 'virbr', 'box', 'libvirt NAT bridge', [(53,27),(53,29),(33,29),(33,30)], [38,28,11,1], [53,24,17,1], [31,32,20,1]),
    ('e3', 'v1', 'ctr', 'dkbr', '172.18.2.x segment', [(9,19),(9,22)], [11,20,10,1], [9,16,8,1], [9,24,15,1]),
    ('e4', 'v1', 'dkbr', 'box', 'Docker bridge', [(9,27),(9,29),(31,29),(31,30)], [14,28,13,1], [9,24,15,1], [31,32,20,1]),
    ('e5', 'v3-overlay', 'ts', 'box', 'Tailscale overlay', [(35,21),(46,21),(46,22),(47,22)], [37,20,7,1], [9,22,25,1], [49,22,20,1]),
    ('e6', 'v3-overlay', 'ts', 'bond0', 'UDP encapsulation over the wired path', [(35,23),(45,23),(45,27),(47,27)], [36,24,9,1], [9,22,25,1], [49,27,19,1]),
    ('e7', 'v2-lan', 'box', 'bond0', 'eno1 2.5 GbE wired primary', [(29,15),(29,17),(5,17),(5,18)], [11,16,12,1], [29,12,19,1], [5,20,22,1]),
    ('e8', 'v2-lan', 'box', 'wlp', 'Wi-Fi backup path', [(31,15),(31,17),(53,17),(53,18)], [37,16,11,1], [29,12,19,1], [53,20,20,1]),
    ('e9', 'v2-lan', 'bond0', 'rtr', 'default gateway 192.168.1.1 at 0.5 ms, claimed router role', [(5,23),(5,25),(29,25),(29,26)], [12,24,11,1], [5,20,22,1], [29,28,22,1]),
    ('e10', 'v2-lan', 'wlp', 'rtr', 'metric-600 failover, not ECMP', [(53,23),(53,25),(31,25),(31,26)], [32,24,20,1], [53,20,20,1], [29,28,22,1]),
    ('e11', 'v4-wan', 'rtr', 'ont', 'NAT egress / shared pool 71.251.12.240, historically interpreted roles', [(34,11),(34,13),(9,13),(9,14)], [13,12,18,1], [34,8,19,1], [9,16,23,1]),
    ('e12', 'v4-wan', 'ont', 'vzagg', 'historical traceroute 4.5 ms hop', [(9,19),(9,22)], [11,20,5,1], [9,16,23,1], [9,24,15,1]),
    ('e13', 'v4-wan', 'vzagg', 'vzbb', 'historical traceroute 6.6 ms hop', [(9,27),(9,30)], [11,28,5,1], [9,24,15,1], [9,32,14,1]),
    ('e14', 'v4-wan', 'vzbb', 'cf', 'historical traceroute 6-9 ms hop', [(9,35),(9,38)], [11,36,5,1], [9,32,14,1], [9,40,18,1]),
    ('x1', 'v4-wan', 'rtr', 'v6', 'source-derived negative relation: ULA only, no global IPv6 / internet route', [(36,11),(36,13),(59,13),(59,14)], [38,12,18,1], [34,8,19,1], [59,16,11,1]),
    ('x2', 'v2-lan', 'rtr', 'fios', 'source-derived summary of bench internet Fios path, 1 ISP, no committed rate', [(29,31),(29,34)], [31,32,17,1], [29,28,22,1], [29,36,16,1]),
]
specs = {p.stem: json.loads(p.read_text()) for p in spec_paths}
audit = []
for eid, view, origin, target, meaning, route, label_box, source_box, target_box in rows:
    from_id = 'h' if origin == 'box' else origin
    to_id = 'h' if target == 'box' else target
    edge = next(e for e in specs[view]['edges'] if e['from'] == from_id and e['to'] == to_id)
    nodes = {n['id']: n['label'] for n in specs[view]['nodes']}
    fids = [f['id'] for f in findings if eid in f['edge_ids'] and not f['description'].startswith('EVIDENCE GAP')]
    if eid == 'e8':
        fids.append('F02')
    status = 'fail' if fids else 'pass'
    coordinates = ' → '.join(f'({x},{y})' for x,y in route)
    direction = 'rightward ▶' if view == 'v3-overlay' else 'downward ▼'
    observed = f"Readable {nodes[from_id]!r} → {nodes[to_id]!r}; label {edge['label']!r}. First exterior stem / bends / head: {coordinates}; unique {direction} head; whole static route traceable; 0 crossings, 0 bridges, 0 touching bends, no junction or shared run. "
    if eid == 'e9':
        observed += 'The gateway address is on this edge and 0.5ms is on the target node, preserving the combined label meaning. '
    if eid == 'e11':
        observed += 'NAT/DHCP is on the source and pool address on the edge; source router role is unqualified in this view and full path lacks historical qualification. '
    if eid in ('e12', 'e13', 'e14'):
        observed += 'Solid RTT-bearing arrow preserves order but omits historical-traceroute qualification. '
    if eid == 'x1':
        observed += 'Dashed with explicit negative label, so not read as an available global-v6 route; no dot. This apparent extra relation is source-backed, not invented connectivity. '
    if eid == 'x2':
        observed += 'Extra summary relation is source-backed, not a new physical hop. Label has the independently measured 10-versus-7 midpoint-owner defect; retained rather than silently dropped. '
    if eid in animated:
        observed += 'Frame-0 dot starts on second exterior cell rather than the first: static head is readable, but animated direction proof fails the fixed origin rule. '
    if eid == 'e5':
        observed += 'Frame 20 also places dot on the lower-left bend at (46,22). '
    if eid == 'e14':
        observed += 'The destination label/head stay visible, but its node lower-left outline is palette-obscured in normal and selected states. '
    references = [src + '#Relationship facts from the historical attempt', exp + '#historical_reference/edges'] if eid.startswith('e') else [src + ('#What the probes found/IPv6' if eid == 'x1' else '#Mapped onto the datacenter model')]
    xmin, xmax = min(x for x,y in route), max(x for x,y in route)
    ymin, ymax = min(y for x,y in route), max(y for x,y in route)
    locations = [loc(view + '_text', *source_box), loc(view + '_text', *target_box), loc(view + '_text', *label_box), loc(view + '_text', xmin, ymin, xmax-xmin+1, ymax-ymin+1)]
    if eid in animated:
        locations.append(loc(view + '_frame_0', route[0][0], route[0][1], 2 if view == 'v3-overlay' else 1, 1 if view == 'v3-overlay' else 2))
    audit.append({'edge_id': eid, 'kind': 'independent_link', 'source_refs': references,
                  'expected': f'{origin} → {target}: {meaning}', 'observed': observed,
                  'status': status, 'locations': locations, 'finding_ids': list(dict.fromkeys(fids))})

view_text_ids = [v + '_text' for v in generation['views']]
view_ansi_ids = [v + '_ansi' for v in generation['views']]
view_selected_ids = [v + '_selected' for v in generation['views']]
frame_ids = [v + '_frames' for v in generation['views'] if v != 'v1']

def category(status, reason, refs, eids):
    return {'applicable': True, 'status': status, 'reason': reason, 'source_refs': refs, 'evidence_ids': eids}

categories = {
    'semantic_fidelity': category('fail', 'F01-F03: all 14 historical endpoint relations and all key IP/AS identifiers are present across the four views, but WAN historical uncertainty and the WAN router claim qualification are not visible; source host/link qualifiers and collapsed-fabric/demarc roles are omitted. Ledger acknowledgment is not semantic preservation. No reversed required relation; .213 is source-backed shorthand. Extra negative-v6 and Fios-summary relations are source-backed, not inventions.', [src, exp, rub + '#categories/semantic_fidelity'], ['source','expected','observed_first','generation'] + view_text_ids),
    'arrow_traceability': category('fail', 'F05: all 16 static stem-to-head routes can be followed, with 0 crossings/bridges/touching bends and no detours or fake branches, but all 11 animated relations fail actual frame-0 origin proof. F04: no committed rate is a recorded ownership defect, not a silently dropped qualifier; two overflowing rewrites do not demonstrate the no-unambiguous-layout exception.', [src, rub + '#categories/arrow_traceability'], ['observed_first','generation','attempts'] + view_text_ids + frame_ids),
    'layout_fit': category('fail', 'F07: app headers and ANSI grids prove 77x47 @100% on every view, with no viewport clipping or pan/zoom rescue, but the WAN control palette obscures three cells of the Cloudflare outline. All split views must show complete boxes without overlay occlusion; 67x40 headless extent and passing validator do not waive that defect.', [rub + '#categories/layout_fit'], view_text_ids + view_ansi_ids + ['v4-wan_selected']),
    'conceptual_grouping_color': category('pass', 'ANSI shows related hue families and appropriate proximity: v1 local virtual attachments share gold-family hues against teal host; v2 wired/Wi-Fi interfaces share teal versus pink edge nodes; v4 Verizon/ONT nodes share teal with separate router, IPv6 and Cloudflare concepts. First node accent is selection chrome, not arbitrary concept assignment. No source-defined tier is reordered; the source leaves independent virtual attachment order free. Cross-view per-node hue stability is not a gate.', [src + '#Task', src + '#What the probes found', rub + '#categories/conceptual_grouping_color'], view_ansi_ids + view_selected_ids),
    'border_integrity': category('fail', 'F07: 18/19 normal and selected node outlines are complete and color-continuous; all 19 node occurrences have their own selected border represented, but Cloudflare has three palette-overwritten perimeter cells and a missing lower-left corner. Normal and selected ANSI prove the color discontinuity, not just plain text.', [rub + '#categories/border_integrity'], view_ansi_ids + view_selected_ids + ['observed_first']),
    'workflow_evidence': category('blocked', 'F08/F09: actual frozen skill, renderer, rubric, dataset, source/expected/variant and final-spec hashes verify; blind record predates reveal; generator and Sol identities are separate; all 14 attempted specs/raw stdout records and recorded final-pane cleanup are present. Approved live header tokens prove geometry despite null rectangles. Missing exact executed command/status/stderr records and incomplete full-cycle motion prevent complete workflow proof. Stale generation round 03 is explicitly explained as round 04; missing specs/v2.json is a stale rerun-index path with an archived equivalent, not lost final content.', [rub + '#categories/workflow_evidence'], ['observed_first','generation','attempts','spec_manifest'] + [v+'_manifest' for v in generation['views']] + frame_ids),
    'animation': category('fail', 'Applicable because the generator enabled 11 routes despite source-optional animation. F05: all 11 frame-0 dots start one exterior cell late. F06: overlay frame 20 dot occupies a corner. Counts are correct (5/2/4 one-dot routes each frame); long straight runs support shared default speed and no labels/borders are dotted, but F09 full-cycle evidence is incomplete. Unequal arrival times are correct for constant mode; same-arrival was not requested. Static v1 has no motion dump by documented source-permitted decision: not an animation requirement failure for that view.', [src, 'docs/visualize-eval/cases.json#homelab-nic-trace/animation', rub + '#categories/animation'], ['observed_first','generation'] + frame_ids),
}

panes = [generation['views'][view]['pane']['pane_id'] for view in generation['views']]
result = {
    'protocol_version': 1, 'round': 4, 'case_id': 'homelab-nic-trace',
    'candidate_sha256': metadata['skill_sha256'], 'renderer_sha256': metadata['renderer_sha256'],
    'rubric_sha256': metadata['rubric_sha256'], 'dataset_sha256': metadata['cases_sha256'],
    'spec_sha256': sha(manifest_path),
    'generator': {'worker_id': 'viz-ds04-homelab-nic-trace', 'model': 'fireworks/accounts/fireworks/routers/deepseek-flash-latest'},
    'reviewer': {'worker_id': 'viz-judge04-homelab-nic-trace', 'model': 'openai/gpt-6.1-sol'},
    'viewport': {'columns': 77, 'rows': 47, 'zoom_percent': 100, 'verified': True},
    'live_pane': {'columns': 77, 'rows': 47},
    'evidence': inventory,
    'observed_first': {'evidence_id': 'observed_first', 'saved_before_expected_reveal': True},
    'categories': categories, 'edge_audit': audit, 'findings': findings,
    'blockers': [
        'Evidence gap F08: exact executed commands, stderr/combined-stream provenance, and rejected/probe process exit statuses are not preserved. Templates and current scripts cannot substitute for frozen invocation records.',
        'Evidence gap F09: 0..2000 ms pinned dumps do not cover a full default-speed cycle of the seven long routes. Future motion and full-cycle all-route equal-speed behavior are unproven; known origin/corner failures remain failures.',
    ],
    'cleanup': {'owned_pane_ids': panes, 'closed_pane_ids': panes, 'status': 'done',
                'reason': 'All four original manifests and generation cleanup record confirmed_closed for w7E:pD0, w7E:pE1, w7E:pE2 and w7E:pE3. No failed live pane is listed; rejected attempts are preserved headless check records. The judge created no panes or sessions and did not replay cleanup.'},
    'overall': 'fail',
}
save_json(OUT / 'reviewer-result.json', result)
assert sha(BLIND) == BLIND_HASH
print(json.dumps({'spec_manifest_sha256': result['spec_sha256'], 'evidence_items': len(inventory), 'edge_audit': {s: sum(e['status']==s for e in audit) for s in ('pass','fail','blocked')}, 'categories': {k:v['status'] for k,v in categories.items()}, 'blind_sha256_unchanged': sha(BLIND)}, indent=2))
