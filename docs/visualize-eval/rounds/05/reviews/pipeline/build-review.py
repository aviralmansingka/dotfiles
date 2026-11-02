"""Build stage-B evidence inventory and result from frozen records; never run the viewer."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path.cwd()
ROUND = Path('docs/visualize-eval/rounds/05')
CASE = ROUND / 'pipeline'
OUT = ROUND / 'reviews/pipeline'
SOURCES = Path('docs/visualize-eval/cases/pipeline')
metadata = json.loads((ROUND / 'metadata.json').read_text())
rubric = json.loads((ROUND / 'rubric.json').read_text())

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

blind_hash = '0ecc05ad42d8884fcb46ce6029688f8de415d975651e1574edd82511881044c1'
assert digest(OUT / 'observed-first.md') == blind_hash
assert digest(CASE / 'spec-v1.json') == 'fdb8c42f6810b541b8a5367d9572d2d47ced3e756598658ff61f1c833a935f2f'
for path, expected in [
    (ROUND / 'SKILL.md', metadata['skill_sha256']),
    (ROUND / 'rubric.json', metadata['rubric_sha256']),
    (Path('docs/visualize-eval/cases.json'), metadata['cases_sha256']),
    (Path(metadata['renderer_path']), metadata['renderer_sha256']),
    *[(SOURCES / name, metadata['case_hashes']['pipeline'][key]) for name, key in [
        ('source.md', 'source_sha256'), ('expected.json', 'expected_sha256'),
        ('historical-variants.json', 'variants_sha256')]],
]:
    assert digest(path) == expected, str(path)

# The original 385 GB log disappeared between read-only inspection and report construction.
# Preserve measured observations from that tool result, not invented raw bytes or a full-file hash.
geometry_path = CASE / 'geometry.txt'
geometry = {
    'source_path': str(geometry_path),
    'source_logical_bytes_at_initial_inspection': 385578044677,
    'source_allocated_bytes_at_initial_inspection': 385578045440,
    'source_present_at_report_construction': geometry_path.exists(),
    'source_full_sha256': None,
    'provenance': 'Derived observations transcribed from the successful reviewer read-only uv/python tool result. Initial read tool rejected geometry.txt over 2 GiB; Python read only first 4096 and last 4096 bytes. The file then disappeared before build-review.py ran, causing FileNotFoundError. Reviewer did not delete, truncate or modify it. This derivative is not a raw source snapshot.',
    'observed_records': {
        'record_timestamp': '2026-11-02T15:55:04Z',
        'parent_pane': 'w7E:pFF',
        'parent_outer_area': {'width': 170, 'height': 53},
        'half_split_probe': 'w7E:pGJ',
        'half_split_outer_rectangles': [{'pane': 'w7E:pFF', 'width': 85, 'height': 53}, {'pane': 'w7E:pGJ', 'width': 85, 'height': 53}],
        'app_header': 'rataflow-view · 83x51 @100% · spec-v1.json · 6 nodes · 6 edges · q quit',
        'probe_viewport_rows': 51,
        'minimum_width_probe_panes': ['w7E:pGK', 'w7E:pGM'],
        'minimum_width_probe_rectangles': {'parent_width': 153, 'probe_width': 17, 'height': 53},
        'vertical_probe': {'pane': 'w7E:pGN', 'parent_height': 48, 'probe_height': 5, 'width': 170},
        'explicit_cleanup_confirmations': ['cleanup: confirmed_closed probe_pane=w7E:pGJ', 'cleanup: confirmed_closed w7E:pGN'],
        'restored_layout_panes': ['w7E:pFF'],
        'restored_layout_area': {'width': 170, 'height': 53},
        'head_and_tail_contained_repeated_geometry_records': True,
        'terminal_error': 'cat: stdout: No space left on device',
    },
}
(OUT / 'geometry-excerpts.json').write_text(json.dumps(geometry, indent=2, ensure_ascii=False) + '\n')

evidence = []
def add(eid, path, description, capture=None):
    evidence.append({'id': eid, 'path': str(path), 'sha256': digest(path), 'description': description, 'capture': capture})
    return eid

def capture(cols, rows, frame, timestamp, state, fmt):
    return {'dimensions': {'columns': cols, 'rows': rows}, 'view': 'v1', 'frame': frame,
            'timestamp': timestamp, 'state': state, 'format': fmt}

add('blind', OUT / 'observed-first.md', 'Immutable stage-A blind record; saved and hashed before expectations were revealed.')
add('metadata', ROUND / 'metadata.json', 'Frozen input hashes and pre-generation harness corrections; not an override of rubric category gates.')
add('skill', ROUND / 'SKILL.md', 'Frozen candidate skill, verified against metadata.')
add('rubric', ROUND / 'rubric.json', 'Frozen revision-6 rubric, verified against metadata.')
add('dataset', Path('docs/visualize-eval/cases.json'), 'Frozen case manifest; only pipeline source material was inspected.')
add('source', SOURCES / 'source.md', 'Qualified historical source facts and human constraints; no unrelated source chat was read.')
add('expected', SOURCES / 'expected.json', 'Six concepts, six required directed relations, four labels, animation required.')
add('variants', SOURCES / 'historical-variants.json', 'Historical rendering intent: five flow-marked edges; Auth-to-Postgres read is not flow-marked. Not independent factual verification.')
add('spec', CASE / 'spec-v1.json', 'Single final spec; six nodes, six edges, flow true and dots 1 on all six edges.')
add('attempts', CASE / 'attempts.json', 'One kept candidate, no rejected spec candidates; rationale for tb orientation.')
add('attempt-spec', CASE / 'attempts/attempt1-tb/spec.json', 'Only attempted spec; byte-identical to final spec.')
add('attempt-check', CASE / 'attempts/attempt1-tb/check.txt', 'Attempt check stdout; no separate stderr/exit transcript in this file.')
add('generation-json', CASE / 'generation.json', 'Captain-assembled recovery record explicitly names actual generator viz-ds05-1 and DeepSeek endpoint; not a raw generator/session transcript.')
add('generation-md', CASE / 'generation.md', 'Disclosed captain reconstruction; includes an unexpanded {spec_h[:16]} placeholder, not an authoritative spec hash.')
add('manifest', CASE / 'evidence/v1/manifest.json', 'Capture window, check_exit 0, 19 short frames, capture pane w7E:pGD and confirmed_closed; null pane columns and rectangle.')
add('binary-hash-record', CASE / 'evidence/v1/bin.sha256', 'Recorded binary identity; actual frozen binary was independently hashed, not executed.')
add('check', CASE / 'evidence/v1/check.txt', 'Check reports 6/6 origins and zero violations; direct frame-0 evidence contradicts origins on six routes.')
window = '2026-11-02T15:54:27Z through 2026-11-02T15:54:31Z; bundle window only, exact frame time not preserved'
add('normal-text', CASE / 'evidence/v1/v1-text.txt', 'Actual live 83x51 normal text capture; trailing padding/final empty row omitted.', capture(83,51,'normal snapshot',window,'normal','text'))
add('normal-ansi', CASE / 'evidence/v1/v1-ansi.ansi', 'Actual 83x51 padded ANSI normal capture proves all six complete, per-node color-continuous borders.', capture(83,51,'normal snapshot',window,'normal','ansi'))
add('selected-ansi', CASE / 'evidence/v1/v1-selected.ansi', 'All six final-view occurrences have their own complete bold-accent perimeter in this one all-selected 83x51 capture; no target-size selected capture.', capture(83,51,'all-selected snapshot',window,'select-all','ansi'))
add('short-frames-text', CASE / 'evidence/v1/v1-frames.txt', '19 timestamped frames at actual live 83x51, 0..1800 ms; insufficient alone for longest lap; command line preserved in wrapper.', capture(83,51,'0..18','relative 0..1800ms in 100ms steps; manifest bundle window above','normal animated','text'))
add('short-frames-ansi', CASE / 'evidence/v1/v1-frames.ansi', 'Terminal-escaped 19-frame capture; graph dot cells have no retained foreground SGR, so this is not moving-dot color proof.', capture(83,51,'0..18','relative 0..1800ms in 100ms steps; manifest bundle window above','normal animated','ansi'))
add('lap', CASE / 'motion/v1-frames-lap-77x47.txt', 'Pinned final-spec 77x47 natural-zoom render dump, 53 timestamped frames covering all laps; not a live target-size pane capture.', capture(77,47,'0..52','relative 0..5200ms in 100ms steps; wall-clock timestamp and exact invocation not preserved','normal animated; pinned direct dump','text'))
add('lap-analysis', CASE / 'motion/lap-analysis.txt', 'Worker coordinate and lap report, (row,column); independently checked. Its word origin denotes frame-0 dot position, not rubric origin.')
add('lap-helper', CASE / 'motion/lap-analysis.py', 'Saved helper used for supplied coordinate analysis; read only, not executed by reviewer.')
add('geometry-excerpts', OUT / 'geometry-excerpts.json', 'Reviewer observation derivative from initial bounded head/tail reads of 385578044677-byte geometry.txt, which disappeared before report construction. Hash identifies these transcribed observations only, NOT original bytes or a raw source snapshot. Records live header, clamp probes, restored layout and ENOSPC.')

src = 'docs/visualize-eval/cases/pipeline/source.md'
exp = 'docs/visualize-eval/cases/pipeline/expected.json'
var = 'docs/visualize-eval/cases/pipeline/historical-variants.json'
ru = 'docs/visualize-eval/rounds/05/rubric.json'
sk = 'docs/visualize-eval/rounds/05/SKILL.md'

def cat(status, reason, refs, ids):
    return {'applicable': True, 'status': status, 'reason': reason, 'source_refs': refs, 'evidence_ids': ids}

categories = {
    'semantic_fidelity': cat('pass', 'All six concepts and all six directed historical relations appear; verify/enqueue/read/write owners are correct and unlabeled links gain no invented protocol. tb preserves causal tiers, not the incidental historical lr orientation. No extra apparent relation or missing cross-view relation.', [src, exp], ['blind','spec','normal-text','normal-ansi','lap']),
    'arrow_traceability': cat('fail', 'All six static stems and unique downward arrowheads are traceable, without crossings, fake branches or avoidable detours. However every animated arrow starts one cell after its true origin. The fixed rubric explicitly treats that as direction unproven; F01 fails all six required-edge audits despite recoverable static meaning.', [src, exp, ru+'#/categories/arrow_traceability'], ['blind','lap','check','normal-ansi']),
    'layout_fit': cat('blocked', 'Pinned final-spec 77x47 dump shows all content at natural 100% and no clipping/occlusion; actual live pane header is 83x51, with a separate 85x53 outer split probe. No actual live 77x47 half-pane capture is preserved. The validator acceptance of pinned dumps in metadata is not proof of the rubric actual-half-pane condition. Missing live target-size evidence blocks, not a claim that this graph overflows.', [src, ru+'#/required_viewport', ru+'#/categories/layout_fit'], ['lap','normal-ansi','manifest','geometry-excerpts','metadata']),
    'conceptual_grouping_color': cat('pass', 'API gateway/Auth are nearby blue-family edge concepts; Job queue/Worker pool are adjacent pink-family work concepts; CLI and Postgres have distinct client/state hues. Source causal tiers are preserved. Plain identical node/background fill, no background dots or decorative border dots; no geometric-depth grouping claim needed.', [src, exp], ['spec','normal-ansi','lap','blind']),
    'border_integrity': cat('pass', 'All four sides and four corners of each of six v1 nodes are complete in normal and selected ANSI, each perimeter color-continuous. All-selected capture covers 6/6 final-view occurrences, not six interactions; no palette overwrite. Pinned text shows complete unobstructed target-size perimeters, but does not prove target-size color/selection independently; target live proof remains layout/workflow blocker, not an invented border defect.', [src, ru+'#/categories/border_integrity'], ['normal-ansi','selected-ansi','lap','blind']),
    'workflow_evidence': cat('blocked', 'Frozen skill, binary, rubric, dataset, source and single spec hashes verified; blind record remains unchanged. Captain recovery is disclosed and useful, not fabricated worker testimony. Exact check/capture/pinned-dump/cleanup command-status provenance, separate check stderr, fresh-isolation/model-routing attestation and saved validator output are not fully preserved. Actual pane is 83x51; live full-lap proof at target is absent. geometry.txt was a 385 GB repeated ENOSPC-ended record, unreadable in full, then disappeared before report construction; a transcribed observation derivative is inventoried honestly. These missing verifications are blockers, not passes and not a reason to waive known origin failures.', [ru+'#/categories/workflow_evidence', sk+'#step-8--check-then-capture'], ['metadata','skill','rubric','dataset','spec','attempts','attempt-check','generation-json','generation-md','manifest','normal-ansi','selected-ansi','short-frames-text','lap','geometry-excerpts','blind']),
    'animation': cat('fail', 'Required slow sparse motion is present, one dot per route, common 200ms visited-cell cadence. F01: all six frame-0 dots miss the first drawn source cell and contradict check origins 6/6. F02: Auth-to-Postgres was not animated in the historical source variant but is animated here, violating round-05 source-only motion scope. Unequal lap times, skipping rather than resting on bends, and no constant-mode arrowhead visits are not separate failures under this rubric. No non-origin corner/bridge/junction/label occupancy.', [src, exp, var, ru+'#/categories/animation'], ['spec','variants','lap','lap-analysis','check','blind']),
}

routes = [
    ('cli-api','CLI','API gateway',None,[37,11,1,4],[37,11],[37,12],[37,14]),
    ('api-auth','API gateway','Auth','verify',[39,19,12,4],[39,19],[39,20],[50,22]),
    ('api-queue','API gateway','Job queue','enqueue',[24,19,14,4],[37,19],[37,20],[24,22]),
    ('queue-worker','Job queue','Worker pool',None,[24,27,1,4],[24,27],[24,28],[24,30]),
    ('worker-db','Worker pool','Postgres','write',[24,35,14,4],[24,35],[24,36],[37,38]),
    ('auth-db','Auth','Postgres','read',[39,27,12,12],[50,27],[50,28],[39,38]),
]

def loc(eid, region): return {'evidence_id': eid, 'region': region}

edge_audit = []
for eid, source, target, label, region, origin, frame0, head in routes:
    edge_audit.append({
        'edge_id': eid, 'kind': 'independent_link',
        'source_refs': [src+'#relationship-facts-from-the-historical-attempt', exp+'#/historical_reference/edges'],
        'expected': f'{source} -> {target}; label '+(repr(label) if label else 'absent; do not invent a protocol')+'; independent directed link, not a shared bus.',
        'observed': f'Both endpoint boxes and correct '+(f'{label} label' if label else 'unlabeled relation')+f' are visible. Unique stem starts at {tuple(origin)}, trace continues to intact downward head {tuple(head)} in pinned 77x47 view. No crossing, shared junction or ambiguous label owner. Route is monotone and obstacle-safe. Frame-0 dot at {tuple(frame0)} is one cell downstream from the true origin {tuple(origin)}. Static semantics pass; prescribed origin-based direction gate fails.'+(' API two-route fanout uses separate ports.' if eid.startswith('api-') else '')+(' Destination convergence uses distinct ports.' if eid.endswith('-db') else '')+(' Additional unrequested source-scope animation: F02.' if eid=='auth-db' else ''),
        'status': 'fail', 'locations': [loc('lap',region)], 'finding_ids': ['F01']+(['F02'] if eid=='auth-db' else []),
    })

findings = [
    {'id':'F01','category':'arrow_traceability','edge_ids':[r[0] for r in routes],'severity':'high',
     'description':'DEFECT (also fails animation): all six frame-0 dots start on the SECOND drawn cell after their source border port, not the FIRST. None visits its true origin over a complete lap. Pinned origins -> observed frame0: CLI/API (37,11)->(37,12); API/Auth (39,19)->(39,20); API/queue (37,19)->(37,20); queue/worker (24,27)->(24,28); worker/DB (24,35)->(24,36); Auth/DB (50,27)->(50,28). check claims origins 6/6 and zero violations, so capture and check disagree. Under the explicit arrow rule these directions are unproven. One root cause affects both gates; do not count a separate defect for each gate.',
     'source_refs':[ru+'#/categories/arrow_traceability',ru+'#/categories/animation',sk+'#step-6--motion-rules'],
     'locations':[loc('lap',[o[0],o[1],1,2]) for _,_,_,_,_,o,_,_ in routes]},
    {'id':'F02','category':'animation','edge_ids':['auth-db'],'severity':'medium',
     'description':'DEFECT: source-only motion scope is widened. The frozen historical variant marks CLI/API, API/Auth, API/queue, queue/worker and worker/DB with flow, but leaves Auth/DB read static. Final spec adds flow:true/dots:1 to Auth/DB and its dot is visible at frame0 (50,28), later descending and moving left. Required case-level motion does not authorize animating an additional source-static route under round-05 wording. No relationship itself is invented, so semantic fidelity remains pass.',
     'source_refs':[var+'#/0/spec/edges/5',ru+'#/categories/animation',sk+'#step-6--motion-rules'],
     'locations':[loc('lap',[39,27,12,12]),loc('normal-ansi',[53,29,1,11])]},
]

blockers = [
    'B01 — layout_fit/workflow_evidence: no actual live 77x47 half-pane capture. Live v1 header measures 83x51; pinned 77x47 text is valid target render/motion evidence, not an actual target-size pane. No target-size selected/ANSI capture or preserved live full-lap target recording exists. metadata validator policy is acknowledged, not substituted for the frozen category.',
    'B02 — workflow_evidence: recovery records lack complete exact check/capture/pinned-dump/cleanup command-status transcripts, separate check stderr evidence, and a raw fresh-isolated worker/model-routing record. generation.json declares actual worker viz-ds05-1; result uses required canonical slot viz-ds05-pipeline with this discrepancy explicitly disclosed, not an assertion that a second generator existed. No saved validator result is present; it is not inferred green.',
    'B03 — workflow_evidence/resource and frozen-record availability: geometry.txt initially measured logical size 385578044677 bytes and allocated size 385578045440 bytes. Read tool refused it over 2 GiB; Python inspected only first/last 4096 bytes, observing repeated records and terminal ENOSPC. Before report construction the file disappeared, causing FileNotFoundError. geometry-excerpts.json preserves transcribed measured observations, not original bytes. No full-file hash, raw snapshot or complete probe audit is claimed. Reviewer did not truncate, delete or repair any source artifact.',
]

result = {
    'protocol_version':1, 'round':5, 'case_id':'pipeline',
    'candidate_sha256':metadata['skill_sha256'], 'renderer_sha256':metadata['renderer_sha256'],
    'rubric_sha256':metadata['rubric_sha256'], 'dataset_sha256':metadata['cases_sha256'],
    'spec_sha256':digest(CASE/'spec-v1.json'),
    'generator':{'worker_id':'viz-ds05-pipeline','model':'fireworks/accounts/fireworks/routers/deepseek-flash-latest'},
    'reviewer':{'worker_id':'viz-judge05-pipeline','model':'openai/gpt-6.1-sol'},
    'viewport':{'columns':77,'rows':47,'zoom_percent':100,'verified':False},
    'live_pane':{'columns':83,'rows':51},
    'evidence':evidence,
    'observed_first':{'evidence_id':'blind','saved_before_expected_reveal':True},
    'categories':categories, 'edge_audit':edge_audit, 'findings':findings, 'blockers':blockers,
    'cleanup':{
        'owned_pane_ids':['w7E:pGD','w7E:pGJ','w7E:pGK','w7E:pGM','w7E:pGN'],
        'closed_pane_ids':['w7E:pGD','w7E:pGJ','w7E:pGK','w7E:pGM','w7E:pGN'],
        'status':'done',
        'reason':'Preserved manifest confirms capture pane w7E:pGD closed. Initial bounded geometry reads explicitly confirmed w7E:pGJ and w7E:pGN closed and showed restored layout containing only parent w7E:pFF, indirectly establishing other probe panes w7E:pGK/w7E:pGM absent. The raw geometry file subsequently disappeared; derivative retains these observations. These are record-based cleanup conclusions, not new live probes. Exact close command/status transcripts remain B02. Reviewer opened no panes.'},
    'overall':'fail',
}

# Validate the embedded schema offline with the subset of JSON Schema keywords it actually uses.
schema = rubric['result_schema']
def check(value, rule, path='$'):
    if '$ref' in rule:
        target=schema
        for part in rule['$ref'].removeprefix('#/').split('/'):
            target=target[part]
        check(value,target,path)
    for sub in rule.get('allOf',[]): check(value,sub,path)
    if 'oneOf' in rule:
        successes=0
        for sub in rule['oneOf']:
            try: check(value,sub,path)
            except AssertionError: pass
            else: successes+=1
        assert successes==1,(path,'oneOf',successes)
    if 'type' in rule:
        types=rule['type'] if isinstance(rule['type'],list) else [rule['type']]
        predicates={'object':lambda v:isinstance(v,dict),'array':lambda v:isinstance(v,list),
                    'string':lambda v:isinstance(v,str),'integer':lambda v:isinstance(v,int) and not isinstance(v,bool),
                    'boolean':lambda v:isinstance(v,bool),'null':lambda v:v is None}
        assert any(predicates[t](value) for t in types),(path,'type',types)
    if 'const' in rule: assert value==rule['const'],(path,'const')
    if 'enum' in rule: assert value in rule['enum'],(path,'enum')
    if isinstance(value,dict):
        assert set(rule.get('required',[]))<=set(value),(path,'required')
        props=rule.get('properties',{})
        if rule.get('additionalProperties') is False: assert set(value)<=set(props),(path,'additionalProperties')
        for key,sub in props.items():
            if key in value: check(value[key],sub,path+'.'+key)
    if isinstance(value,list):
        assert len(value)>=rule.get('minItems',0),(path,'minItems')
        assert len(value)<=rule.get('maxItems',float('inf')),(path,'maxItems')
        if rule.get('uniqueItems'): assert len({json.dumps(v,sort_keys=True) for v in value})==len(value),(path,'uniqueItems')
        if 'items' in rule:
            for i,v in enumerate(value):check(v,rule['items'],f'{path}[{i}]')
    if isinstance(value,str):
        assert len(value)>=rule.get('minLength',0),(path,'minLength')
        if 'pattern' in rule: assert re.search(rule['pattern'],value),(path,'pattern')
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        assert value>=rule.get('minimum',float('-inf')),(path,'minimum')
check(result,schema)
ids={entry['id'] for entry in evidence}
assert len(ids)==len(evidence)
assert all(eid in ids for c in categories.values() for eid in c['evidence_ids'])
assert all(loc['evidence_id'] in ids for f in findings for loc in f['locations'])
assert all(loc['evidence_id'] in ids for e in edge_audit for loc in e['locations'])
assert len(edge_audit)==6
assert all(digest(Path(e['path']))==e['sha256'] for e in evidence)
assert digest(OUT/'observed-first.md')==blind_hash
(OUT/'reviewer-result.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print('Embedded schema validated offline; inventory hashes and all evidence references verified.')
print('Overall:',result['overall'])
print('Categories:',{k:v['status'] for k,v in categories.items()})
print('Blind record remains:',blind_hash)
