#!/usr/bin/env python3
import glob, json, os, sys

def pi_calls(session_dir):
    turns = calls = 0
    for p in glob.glob(os.path.join(session_dir, '*.jsonl')):
        for line in open(p, encoding='utf-8', errors='replace'):
            try: r = json.loads(line)
            except Exception: continue
            m = r.get('message') or {}
            if m.get('role') != 'assistant': continue
            turns += 1
            c = m.get('content')
            if isinstance(c, list):
                calls += sum(1 for b in c if isinstance(b, dict) and b.get('type') == 'toolCall')
    return turns, calls

def codex_calls(worktree):
    for p in glob.glob(os.path.expanduser('~/.codex/sessions/**/*.jsonl'), recursive=True) + \
             glob.glob('/tmp/fc-*/sessions/**/*.jsonl', recursive=True):
        cwd = None; turns = calls = 0
        for line in open(p, encoding='utf-8', errors='replace'):
            try: r = json.loads(line)
            except Exception: continue
            t = r.get('type'); pl = r.get('payload') or {}
            if t == 'session_meta':
                cwd = pl.get('cwd')
                if cwd != worktree: break
            elif t == 'response_item':
                if pl.get('type') == 'message' and pl.get('role') == 'assistant': turns += 1
                elif pl.get('type') in ('function_call', 'custom_tool_call'): calls += 1
        if cwd == worktree: return turns, calls
    return None

def claude_calls(config_dir, worktree):
    best = (0, 0)
    for p in glob.glob(os.path.join(config_dir, 'projects', '*', '*.jsonl')):
        turns = calls = 0; cwd = None
        for line in open(p, encoding='utf-8', errors='replace'):
            try: r = json.loads(line)
            except Exception: continue
            cwd = cwd or r.get('cwd')
            m = r.get('message') or {}
            if isinstance(m, dict) and m.get('role') == 'assistant':
                turns += 1
                c = m.get('content')
                if isinstance(c, list):
                    calls += sum(1 for b in c if isinstance(b, dict) and b.get('type') == 'tool_use')
        if cwd and os.path.realpath(cwd) == os.path.realpath(worktree) and turns > best[0]:
            best = (turns, calls)
    return best if best[0] else None

for spec in sys.argv[1:]:
    kind, path = spec.split('=', 1)
    if kind.startswith('pi'): print(kind, pi_calls(path))
    elif kind.startswith('codex'): print(kind, codex_calls(path))
    else: print(kind, claude_calls(path.split('|')[0], path.split('|')[1]))
