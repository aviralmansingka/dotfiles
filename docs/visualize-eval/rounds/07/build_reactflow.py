#!/usr/bin/env python3
"""Round-07 pilot: build the React Flow twins of the round-05 rataflow final specs.

Reads only the frozen round-05 bundles (specs + evidence ANSI) and writes one
self-contained HTML per pilot case under rounds/07/<case>/reactflow.html.

Node border colours are lifted from the round-05 rataflow ANSI captures so the
React Flow twin keeps the same hue per group as the rendering it is compared to.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
R05 = os.path.normpath(os.path.join(ROOT, "..", "05"))

CASES = {
    "modal-machine-manager": [
        ("v1", "v1.json", "evidence/v1/v1-ansi.ansi", "ingress + jobs + confirm (e1-e4, e13, e14, e21)"),
        ("v2", "v2.json", "evidence/v2/v2-ansi.ansi", "provisioning chain: q -> registry -> providers -> machines -> boot (e5-e9)"),
        ("v3", "v3.json", "evidence/v3/v3-ansi.ansi", "in-host agent, object store, public gRPC -> Postgres (e10-e12, e17, e18)"),
        ("v4", "v4.json", "evidence/v4/v4-ansi.ansi", "bounded autonomy: audit reimage, janitor proposals (e15, e16, e19, e20)"),
    ],
    "datacenter-redundancy": [
        ("v1", "v1-wan-mux-core.json", "evidence/v1/v1-ansi.ansi", "ISP tier -> MUX tier -> core tier"),
        ("v2", "v2-fw-border-spine.json", "evidence/v2/v2-ansi.ansi", "core tier -> active/passive firewall pair -> border leaves -> spines"),
        ("v3", "v3-fabric-leaves-racks.json", "evidence/v3/v3-ansi.ansi", "spines -> rack leaves -> racks"),
    ],
    "gb300-rack-software": [
        ("v1", "v1-oob-rail.json", "evidence/v1/v1-ansi.ansi", "off-rack management on the OOB rail (physical reach)"),
        ("v2", "v2-rms-apis.json", "evidence/v2/v2-ansi.ansi", "nv-rms southbound APIs into rack hardware"),
        ("v3", "v3-nvswitch-sw.json", "evidence/v3/v3-ansi.ansi", "NVSwitch tray software (NVOS hosts NMX-C/T)"),
        ("v4", "v4-inband-compute.json", "evidence/v4/v4-ansi.ansi", "in-band Kubernetes stack on the compute hosts"),
    ],
}

# Which case animates: machine-manager yes (one dot per edge), the other two no.
ANIMATED = {"modal-machine-manager"}

# dagre parameters (recorded in notes.md)
DAGRE = {
    "rankdir": "from spec direction (tb unless the spec says lr)",
    "ranksep": 120,
    "nodesep": 62,
    "edgesep": 20,
    "marginx": 0,
    "marginy": 0,
    "node": "168x42",
    "subflow_pad": "x14 top24 bottom8",
    "engine": "@dagrejs/dagre@1.1.5, two-stage (inner per subflow, then meta-graph of subflows)",
}


# ---------------------------------------------------------------- ANSI parsing
def parse_ansi(path):
    """Return grid rows of (char, fg_rgb, cell_bg_rgb)."""
    data = open(path, encoding="utf-8", errors="replace").read()
    grid = []
    for row in data.split("\n"):
        if row.endswith("\r"):
            row = row[:-1]
        cells = []
        i = 0
        fg = bg = None
        while i < len(row):
            m = re.match(r"\x1b\[([0-9;]*)m", row[i:])
            if m:
                if m.group(1) in ("0", ""):
                    fg = bg = None
                else:
                    ps = m.group(1).split(";")
                    j = 0
                    while j < len(ps) - 2:
                        if ps[j] == "38" and ps[j + 1] == "2":
                            fg = tuple(int(x) for x in ps[j + 2:j + 5])
                            j += 5
                        elif ps[j] == "48" and ps[j + 1] == "2":
                            bg = tuple(int(x) for x in ps[j + 2:j + 5])
                            j += 5
                        else:
                            j += 1
                i += m.end()
                continue
            cells.append((row[i], fg, bg))
            i += 1
        grid.append(cells)
    return grid


def hexs(t):
    return "#%02x%02x%02x" % t if t else None


def label_colors(grid):
    """Map drawn box label -> top-border colour.

    A box is '╭───╮' on row r, the label on row r+2 (rataflow draws a 5-row box
    with a blank padding row above and below the label).
    """
    out = {}
    for r, cells in enumerate(grid):
        text = "".join(c[0] for c in cells)
        for m in re.finditer(r"[╭┌╔]", text):
            c0 = m.start()
            for c in range(c0 + 1, len(cells)):
                if cells[c][0] in "╮┐╗":
                    colors = Counter()
                    for cc in range(c0, c + 1):
                        if cells[cc][0] in "─╭╮┌┐":
                            colors[cells[cc][1]] += 1
                    label = ""
                    for rr in (r + 1, r + 2):
                        if rr < len(grid) and not label:
                            seg = "".join(ch for ch, _, _ in grid[rr][c0 : c + 1])
                            seg = seg.strip("│║ ")
                            if seg.strip():
                                label = seg.strip()
                    top = colors.most_common(1)
                    if label and top and top[0][0]:
                        out[label] = hexs(top[0][0])
                    break
    return out


# ------------------------------------------------------------------- view data
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def build_views(case):
    gen = json.load(open(os.path.join(R05, case, "generation.json")))
    gen_views = {v["view"]: v for v in gen["views"]}
    views = []
    for vid, specname, ansiname, title in CASES[case]:
        spec_path = os.path.join(R05, case, "specs", specname)
        digest = sha256(spec_path)
        recorded = gen_views[vid]["spec_sha256"]
        if digest != recorded:
            sys.exit(f"hash mismatch {case}/{specname}: {digest} != {recorded}")
        spec = json.load(open(spec_path))
        colors = label_colors(parse_ansi(os.path.join(R05, case, ansiname)))

        nodes = []
        for n in spec["nodes"]:
            color = colors.get(n["label"])
            if not color:
                print(f"  WARN no colour for {case}/{vid} {n['id']} {n['label']!r}")
            nodes.append(
                {
                    "id": n["id"],
                    "label": n["label"],
                    "group": n.get("group"),
                    "color": color or "#a89984",
                }
            )

        edges = []
        for e in spec.get("edges", []):
            edges.append(
                {
                    "id": f'{e["from"]}->{e["to"]}',
                    "from": e["from"],
                    "to": e["to"],
                    "label": e.get("label", ""),
                    "dashed": e.get("style") == "dashed",
                    "animated": bool(e.get("flow")) and case in ANIMATED,
                }
            )
        # rataflow trunks: one bus that splits into branches. React Flow has no
        # trunk primitive, so the bus becomes the labelled primary edge and the
        # branch destinations hang off the same source as unlabelled edges.
        for t in spec.get("trunks", []):
            edges.append(
                {
                    "id": f'trunk:{t["id"]}',
                    "from": t["from"],
                    "to": t["to"],
                    "label": t.get("label", ""),
                    "dashed": False,
                    "animated": case in ANIMATED,
                    "trunk": t["id"],
                }
            )
            for b in t.get("branches", []):
                edges.append(
                    {
                        "id": f'trunk:{t["id"]}:{b}',
                        "from": t["from"],
                        "to": b,
                        "label": "",
                        "dashed": False,
                        "animated": False,
                        "trunk": t["id"],
                        "branch": True,
                    }
                )

        groups = []
        for n in nodes:
            if n["group"] and n["group"] not in [g["name"] for g in groups]:
                groups.append({"name": n["group"], "color": n["color"]})

        views.append(
            {
                "view": vid,
                "title": title,
                "spec": f"rounds/05/{case}/specs/{specname}",
                "spec_sha256": digest,
                "direction": spec.get("direction", "tb"),
                "nodes": nodes,
                "edges": edges,
                "groups": groups,
            }
        )
    return views


# ----------------------------------------------------------------------- HTML
HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>__TITLE__ — React Flow twin (round 07)</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xyflow/react@12.3.5/dist/style.css">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #282828; color: #ebdbb2;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
  .page { padding: 14px 0 26px 24px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 12px; color: #ebdbb2; letter-spacing: .02em; }
  .view { margin: 0 0 22px; }
  .caption { font-size: 11px; color: #a89984; margin: 0 0 6px; white-space: nowrap; }
  .caption b { color: #d79921; font-weight: 600; }
  .caption .hash { color: #665c54; }
  .canvas { width: 1100px; height: 700px; background: #1d2021; border: 1px solid #3c3836; }
  .rf-node { font-size: 12.5px; line-height: 1.1; text-align: center; padding: 0 8px; }
  .rf-group-label { position: absolute; top: -9px; left: 10px; font-size: 10px;
    letter-spacing: .08em; text-transform: uppercase; background: #1d2021;
    padding: 0 5px; border-radius: 3px; line-height: 1.6; }
  .react-flow__handle { opacity: 0; width: 1px; height: 1px; min-width: 0; min-height: 0;
    border: 0; background: transparent; pointer-events: none; }
  .rf-edge-label { position: absolute; background: #282828; color: #a89984; border: 1px solid #504945;
    border-radius: 3px; padding: 0 5px; font-size: 10.5px; line-height: 1.5;
    white-space: nowrap; pointer-events: none; }
  __CSS__
</style>
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react/": "https://esm.sh/react@18.3.1/",
    "react-dom": "https://esm.sh/react-dom@18.3.1?deps=react@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1",
    "@xyflow/react": "https://esm.sh/@xyflow/react@12.3.5?external=react,react-dom",
    "@dagrejs/dagre": "https://esm.sh/@dagrejs/dagre@1.1.5"
  }
}
</script>
</head>
<body>
<div id="root"></div>
<script type="module">
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow, Background, BaseEdge, EdgeLabelRenderer, Handle, Position, getSmoothStepPath,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';

const VIEWS = __VIEWS__;

const NODE_W = 168, NODE_H = 42;
const PAD_X = 14, PAD_TOP = 24, PAD_BOTTOM = 8;
const DAGRE = __DAGRE__;
const INNER = { ranksep: 58, nodesep: 38, edgesep: 18 };
const META = { ranksep: DAGRE.ranksep, nodesep: DAGRE.nodesep, edgesep: DAGRE.edgesep };

// Two-stage dagre layout.
// 1. every group is laid out on its own (its members + the edges inside it),
//    which yields the subflow block size and the intra-subflow positions;
// 2. the blocks plus the ungrouped nodes are laid out again, with one edge per
//    crossing pair, which yields the subflow positions in the whole graph.
// Deterministic: same spec + same constants -> same coordinates.
function innerLayout(members, edges, rankdir) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir, ranksep: INNER.ranksep, nodesep: INNER.nodesep,
    edgesep: INNER.edgesep, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  members.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e, i) => g.setEdge(e.from, e.to, {}, 'i' + i));
  dagre.layout(g);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pos = {};
  members.forEach((n) => {
    const p = g.node(n.id);
    const x = p.x - NODE_W / 2, y = p.y - NODE_H / 2;
    pos[n.id] = { x, y };
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + NODE_W); maxY = Math.max(maxY, y + NODE_H);
  });
  Object.keys(pos).forEach((k) => { pos[k].x -= minX; pos[k].y -= minY; });
  return { pos, w: maxX - minX, h: maxY - minY };
}

function layout(view) {
  const rankdir = view.direction === 'lr' ? 'LR' : 'TB';
  const inner = {};
  view.groups.forEach((grp) => {
    const members = view.nodes.filter((n) => n.group === grp.name);
    const ids = new Set(members.map((n) => n.id));
    const edges = view.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    inner[grp.name] = innerLayout(members, edges, rankdir);
  });
  const owner = {};
  view.nodes.forEach((n) => { owner[n.id] = n.group || ('solo:' + n.id); });

  const meta = new dagre.graphlib.Graph({ multigraph: true });
  meta.setGraph({ rankdir, ranksep: META.ranksep, nodesep: META.nodesep,
    edgesep: META.edgesep, marginx: 0, marginy: 0 });
  meta.setDefaultEdgeLabel(() => ({}));
  view.groups.forEach((grp) => {
    meta.setNode(grp.name, {
      width: inner[grp.name].w + 2 * PAD_X,
      height: inner[grp.name].h + PAD_TOP + PAD_BOTTOM,
    });
  });
  view.nodes.filter((n) => !n.group).forEach((n) => {
    meta.setNode('solo:' + n.id, { width: NODE_W, height: NODE_H });
  });
  view.edges.forEach((e, i) => {
    const a = owner[e.from], b = owner[e.to];
    if (a === b) return;
    meta.setEdge(a, b, {}, 'm' + i);
  });
  dagre.layout(meta);

  const groupRects = {};
  const rfNodes = [];
  view.groups.forEach((grp) => {
    const m = meta.node(grp.name);
    groupRects[grp.name] = {
      x: m.x - m.width / 2,
      y: m.y - m.height / 2,
      w: m.width,
      h: m.height,
    };
  });
  view.groups.forEach((grp) => {
    const r = groupRects[grp.name];
    rfNodes.push({
      id: 'grp::' + grp.name,
      type: 'groupBox',
      position: { x: r.x, y: r.y },
      data: { label: grp.name, color: grp.color },
      style: { width: r.w, height: r.h },
      draggable: false,
      selectable: false,
      zIndex: 0,
    });
  });
  view.nodes.forEach((n) => {
    if (n.group) {
      const r = groupRects[n.group];
      const p = inner[n.group].pos[n.id];
      rfNodes.push({
        id: n.id,
        type: 'plain',
        // child positions are RELATIVE to the parent subflow node
        position: { x: PAD_X + p.x, y: PAD_TOP + p.y },
        data: { label: n.label, color: n.color },
        parentId: 'grp::' + n.group,
        extent: 'parent',
        draggable: false,
        zIndex: 1,
      });
    } else {
      const m = meta.node('solo:' + n.id);
      rfNodes.push({
        id: n.id,
        type: 'plain',
        position: { x: m.x - NODE_W / 2, y: m.y - NODE_H / 2 },
        data: { label: n.label, color: n.color },
        draggable: false,
        zIndex: 1,
      });
    }
  });

  const ax = view.direction === 'lr' ? 'lr' : 'tb';
  const nodeAbs = {};
  view.nodes.forEach((n) => {
    if (n.group) {
      const r = groupRects[n.group];
      const p = inner[n.group].pos[n.id];
      nodeAbs[n.id] = { x: r.x + PAD_X + p.x, y: r.y + PAD_TOP + p.y };
    } else {
      const m = meta.node('solo:' + n.id);
      nodeAbs[n.id] = { x: m.x - NODE_W / 2, y: m.y - NODE_H / 2 };
    }
  });
  const labelPos = {};
  view.edges.forEach((e) => {
    const a = owner[e.from], b = owner[e.to];
    if (a === b) return;                     // intra-subflow: keep the path midpoint
    // cross-subflow labels sit in the middle of the gutter between blocks, so
    // they never straddle a subflow border or sit under a block's fill
    const half = META.ranksep / 2;
    const src = nodeAbs[e.from];
    const blk = groupRects[a];
    labelPos[e.id] = ax === 'tb'
      ? { x: src.x + NODE_W / 2, y: (blk ? blk.y + blk.h : src.y + NODE_H) + half }
      : { x: (blk ? blk.x + blk.w : src.x + NODE_W) + half, y: src.y + NODE_H / 2 };
  });

  // labels that resolve to the same gutter point (several edges leaving one
  // node, or several nodes leaving one subflow at the same x/y) would hide each
  // other; fan them out along the perpendicular axis instead
  const buckets = {};
  Object.keys(labelPos).forEach((id) => {
    const p = labelPos[id];
    const key = Math.round(p.x / 6) + '|' + Math.round(p.y / 6);
    (buckets[key] = buckets[key] || []).push(id);
  });
  Object.keys(buckets).forEach((key) => {
    const ids = buckets[key];
    if (ids.length < 2) return;
    // stack along y: label boxes are wide and short, so a vertical stack never
    // collides, while a horizontal fan would just overlap the same text
    const other = ax === 'tb' ? 'x' : 'y';
    ids.sort((a, b) => {
      const ta = nodeAbs[view.edges.find((x) => x.id === a).to];
      const tb = nodeAbs[view.edges.find((x) => x.id === b).to];
      return ta[other] - tb[other];
    });
    ids.forEach((id, i) => {
      labelPos[id].y += (i - (ids.length - 1) / 2) * 22;
    });
  });

  const rfEdges = view.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    sourceHandle: 's-' + ax,
    targetHandle: 't-' + ax,
    type: 'labeled',
    data: { label: e.label, dot: e.animated, labelPos: labelPos[e.id] || null,
      branch: !!e.branch, trunk: e.trunk || null },
    style: {
      stroke: '#7c6f64',
      strokeWidth: 1.4,
      ...(e.dashed ? { strokeDasharray: '6 4' } : {}),
    },
    markerEnd: { type: 'arrowclosed', color: '#a89984', width: 14, height: 14 },
  }));

  return { rfNodes, rfEdges };
}

// ------------------------------------------------------------------- nodes
function PlainNode({ data }) {
  return React.createElement(
    'div',
    {
      className: 'rf-node',
      style: {
        width: NODE_W,
        height: NODE_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#32302f',
        color: '#ebdbb2',
        border: '1.5px solid ' + data.color,
        borderRadius: 6,
        boxSizing: 'border-box',
      },
    },
    React.createElement(Handle, { type: 'target', position: Position.Top, id: 't-tb' }),
    React.createElement(Handle, { type: 'source', position: Position.Bottom, id: 's-tb' }),
    React.createElement(Handle, { type: 'target', position: Position.Left, id: 't-lr' }),
    React.createElement(Handle, { type: 'source', position: Position.Right, id: 's-lr' }),
    data.label
  );
}

function GroupBox({ data, style }) {
  const bg = data.color + '1f';
  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: '1px solid ' + data.color,
        borderRadius: 9,
        background: bg,
      },
    },
    React.createElement(
      'div',
      { className: 'rf-group-label', style: { color: data.color } },
      data.label
    )
  );
}

// ------------------------------------------------------------------- edges
function LabeledEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
          data, markerEnd, style } = props;
  const [path, pathLabelX, pathLabelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0,
  });
  const labelX = data && data.labelPos ? data.labelPos.x : pathLabelX;
  const labelY = data && data.labelPos ? data.labelPos.y : pathLabelY;
  const pathRef = useRef(null);
  const [dur, setDur] = useState('3s');
  useEffect(() => {
    if (!data || !data.dot || !pathRef.current) return;
    const len = pathRef.current.getTotalLength();
    // constant pixel speed: 55 px/s keeps one dot per edge and every dot moving
    setDur((len / 55).toFixed(3) + 's');
  }, [data, path]);
  const children = [
    React.createElement(BaseEdge, { key: 'e', id, path, markerEnd, style }),
  ];
  if (data && data.dot) {
    children.push(
      React.createElement(
        'circle',
        { key: 'd', r: 3.6, fill: '#fabd2f' },
        React.createElement('animateMotion', {
          dur, repeatCount: 'indefinite', path,
        })
      )
    );
  }
  if (data && data.label) {
    children.push(
      React.createElement(
        EdgeLabelRenderer,
        { key: 'l' },
        React.createElement(
          'div',
          {
            className: 'rf-edge-label',
            style: { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` },
          },
          data.label
        )
      )
    );
  }
  if (data && data.dot) {
    // path ref must exist for getTotalLength: render a hidden copy under the dot
    children.push(
      React.createElement('path', { key: 'p', ref: pathRef, d: path, fill: 'none',
        stroke: 'none', pointerEvents: 'none' })
    );
  }
  return React.createElement('g', null, children);
}

const nodeTypes = { plain: PlainNode, groupBox: GroupBox };
const edgeTypes = { labeled: LabeledEdge };

function View({ view, index }) {
  const { rfNodes, rfEdges } = useMemo(() => layout(view), [view]);
  const nodeCount = view.nodes.length;
  const edgeCount = view.edges.length;
  return React.createElement(
    'section',
    { className: 'view', id: 'view-' + view.view },
    React.createElement(
      'div',
      { className: 'caption' },
      React.createElement('b', null, view.view),
      ' — ' + view.title + '   ·   ' + nodeCount + ' nodes / ' + edgeCount + ' edges' +
        '   ·   direction ' + view.direction +
        (view.groups.length ? '   ·   subflows: ' + view.groups.map((g) => g.name).join(', ') : ''),
      React.createElement('span', { className: 'hash' }, '   ·   spec ' + view.spec_sha256.slice(0, 12))
    ),
    React.createElement(
      'div',
      { className: 'canvas' },
      React.createElement(
        ReactFlow,
        {
          nodes: rfNodes,
          edges: rfEdges,
          nodeTypes,
          edgeTypes,
          fitView: true,
          fitViewOptions: { padding: 0.10, maxZoom: 1.2, minZoom: 0.15 },
          nodesDraggable: false,
          nodesConnectable: false,
          elementsSelectable: false,
          panOnDrag: false,
          zoomOnScroll: false,
          zoomOnPinch: false,
          zoomOnDoubleClick: false,
          preventScrolling: false,
          minZoom: 0.15,
          maxZoom: 1.2,
          proOptions: { hideAttribution: false },
        },
        React.createElement(Background, { variant: 'dots', gap: 26, size: 1, color: '#3c3836' })
      )
    )
  );
}

function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      window.__rfReady = true;
      window.__rfFacts = VIEWS.map((v) => ({
        view: v.view,
        nodes: v.nodes.length,
        edges: v.edges.length,
        groups: v.groups.map((g) => g.name),
        direction: v.direction,
        spec_sha256: v.spec_sha256,
      }));
      setReady(true);
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  return React.createElement(
    'div',
    { className: 'page' },
    React.createElement('h1', null, '__TITLE__ — React Flow twin (round 07 pilot, dagre __DAGRE_SHORT__)'),
    VIEWS.map((v, i) => React.createElement(View, { key: v.view, view: v, index: i })),
    ready ? null : React.createElement('div', { style: { fontSize: 11, color: '#665c54' } }, 'laying out…')
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
</script>
</body>
</html>
"""


LABEL_MODE = "final"   # "final" | "source-edge" (rejected attempt 2)
OUTNAME = "reactflow.html"


def main():
    global LABEL_MODE, OUTNAME
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--label-mode":
            LABEL_MODE = args[i + 1]
        if a == "--out":
            OUTNAME = args[i + 1]
    for case, _views in CASES.items():
        outdir = os.path.join(ROOT, case)
        os.makedirs(outdir, exist_ok=True)
        views = build_views(case)
        html = (
            HTML.replace("__TITLE__", case)
            .replace("__VIEWS__", json.dumps(views, indent=1))
            .replace(
                "__DAGRE__",
                json.dumps({k: v for k, v in DAGRE.items() if isinstance(v, (int, float))}, indent=1),
            )
            .replace("__DAGRE_SHORT__", "ranksep 120 / nodesep 62 / edgesep 20")
            .replace("__CSS__", "")
        )
        if LABEL_MODE == "source-edge":
            # rejected attempt 2: label anchored just outside the source subflow,
            # no gutter stacking -> labels straddle borders and hide each other
            html = html.replace("const half = META.ranksep / 2;", "const half = 16;")
            html = html.replace("labelPos[id].y += (i - (ids.length - 1) / 2) * 22;", "")
            html = html.replace("if (ids.length < 2) return;", "return;")
            out = os.path.join(outdir, "attempts", OUTNAME)
            os.makedirs(os.path.dirname(out), exist_ok=True)
        else:
            out = os.path.join(outdir, OUTNAME)
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        tot_nodes = sum(len(v["nodes"]) for v in views)
        tot_edges = sum(len(v["edges"]) for v in views)
        print(f"{case}: {len(views)} views, {tot_nodes} nodes, {tot_edges} edges -> {out}")


if __name__ == "__main__":
    main()
