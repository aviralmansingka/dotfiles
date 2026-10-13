//! rataflow-view — turn a small JSON graph spec into a live rataflow graph.
//!
//! The library half (this target) owns the spec schema and the graph
//! construction, so both stay testable headlessly through ratatui's
//! `TestBackend`. The binary half (`rataflow-view`) owns the terminal event
//! loop that renders the graph for a human in a herdr pane.
//!
//! Rendering contract: a plain background (no dot grid), node boxes filled
//! with the canvas color so their rounded borders sit flush, gruvbox
//! accents cycled onto node borders, and optional live dots flowing along
//! edges that carry movement.

pub mod flow_edge;

pub use flow_edge::{FlowEdge, Route};

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{Context, Result, bail};
use rataflow::{Controls, Edge, Flow, HandlePosition, MiniMap, Node, Position, Sugiyama, TextContent, Theme};
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
use serde::Deserialize;

/// Milliseconds per animation step — the wall-clock base for flow dots.
/// One dot at `flow: 1` travels 10 cells per second; `flow: n` travels
/// `10 × n`.
pub const ANIMATION_STEP_MS: u64 = 100;

/// The graph type this crate builds and renders.
pub type Graph = Flow<TextContent, FlowEdge>;

/// Graph flow direction, from the spec's `direction` field (`"tb"`/`"lr"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    TopToBottom,
    LeftToRight,
}

/// Visual theme, from the spec's `theme` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeKind {
    Gruvbox,
    Dark,
    Light,
}

/// One node. `label` defaults to `id` when omitted.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecNode {
    pub id: String,
    pub label: Option<String>,
}

/// One edge. `label` renders on the edge; `flow` animates it — `true`
/// means dots at the base speed, a positive number means dots at that
/// speed (cells per [`ANIMATION_STEP_MS`]).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecEdge {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
    #[serde(default)]
    flow: Option<RawFlow>,
}

impl SpecEdge {
    /// The resolved flow speed: `None` for a static edge, `Some(1.0)` for
    /// `flow: true`, `Some(n)` for `flow: n`.
    pub fn flow_speed(&self) -> Option<f64> {
        match self.flow {
            None | Some(RawFlow::Flag(false)) => None,
            Some(RawFlow::Flag(true)) => Some(1.0),
            Some(RawFlow::Speed(speed)) => Some(speed),
        }
    }
}

/// `flow` accepts a boolean flag or a speed number.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(untagged)]
enum RawFlow {
    Flag(bool),
    Speed(f64),
}

/// A validated spec. Build one with [`Spec::from_json`].
#[derive(Debug, Clone)]
pub struct Spec {
    pub direction: Direction,
    pub theme: ThemeKind,
    pub nodes: Vec<SpecNode>,
    /// Explicit layer placement: each inner array is one layer, ids in
    /// declared order. Empty when absent — sugiyama ranks the graph then.
    pub layers: Vec<Vec<String>>,
    pub edges: Vec<SpecEdge>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSpec {
    direction: Option<String>,
    theme: Option<String>,
    #[serde(default)]
    nodes: Vec<SpecNode>,
    /// Optional explicit placement: each inner array is one layer, ids in
    /// left-to-right (tb) or top-to-bottom (lr) order; "" reserves a slot.
    #[serde(default)]
    layers: Option<Vec<Vec<String>>>,
    edges: Vec<SpecEdge>,
}

impl Spec {
    /// Parse and validate a spec file. Rejections carry a message that
    /// names the problem: unknown fields, unknown `direction` or `theme`
    /// values, duplicate node ids, empty ids, empty edge lists, and
    /// non-positive `flow` speeds.
    pub fn from_json(text: &str) -> Result<Spec> {
        let raw: RawSpec = serde_json::from_str(text)
            .with_context(|| "parsing the spec (fields: direction, theme, nodes, edges)")?;

        if raw.edges.is_empty() {
            bail!("the spec needs at least one edge, e.g. {{\"from\": \"a\", \"to\": \"b\"}}");
        }
        for (index, edge) in raw.edges.iter().enumerate() {
            if edge.from.trim().is_empty() || edge.to.trim().is_empty() {
                bail!("edge {index} has an empty \"from\" or \"to\" id");
            }
            if let Some(speed) = edge.flow_speed()
                && (!speed.is_finite() || speed <= 0.0)
            {
                bail!(
                    "edge {index} has a non-positive \"flow\" speed {speed} \
                     (use true or a positive number)"
                );
            }
        }

        let mut seen: HashSet<&str> = HashSet::new();
        for node in &raw.nodes {
            if node.id.trim().is_empty() {
                bail!("a node has an empty \"id\"");
            }
            if !seen.insert(node.id.as_str()) {
                bail!("duplicate node id \"{}\"", node.id);
            }
        }

        let layers = raw.layers.unwrap_or_default();
        if !layers.is_empty() {
            // Every placed id must be a known node, each node may occupy
            // one slot only, and every node must be placed — sugiyama is
            // skipped entirely when layers are given.
            let mut known: HashSet<&str> = raw.nodes.iter().map(|n| n.id.as_str()).collect();
            for edge in &raw.edges {
                known.insert(edge.from.as_str());
                known.insert(edge.to.as_str());
            }
            let mut placed: HashSet<&str> = HashSet::new();
            for (layer_index, layer) in layers.iter().enumerate() {
                for id in layer {
                    if id.is_empty() {
                        continue; // "" reserves a slot without placing a node
                    }
                    if !known.contains(id.as_str()) {
                        bail!(
                            "layer {layer_index} places \"{id}\", which is not a node in this spec"
                        );
                    }
                    if !placed.insert(id.as_str()) {
                        bail!("node \"{id}\" appears in more than one layer slot");
                    }
                }
            }
            let unplaced: Vec<&str> = known
                .iter()
                .copied()
                .filter(|id| !placed.contains(id))
                .collect();
            if !unplaced.is_empty() {
                bail!("layers must place every node; unplaced: {unplaced:?}");
            }
        }

        let direction = match raw.direction.as_deref() {
            None | Some("tb") => Direction::TopToBottom,
            Some("lr") => Direction::LeftToRight,
            Some(other) => bail!("unknown direction \"{other}\" (expected \"tb\" or \"lr\")"),
        };
        let theme = match raw.theme.as_deref() {
            None | Some("gruvbox") => ThemeKind::Gruvbox,
            Some("dark") => ThemeKind::Dark,
            Some("light") => ThemeKind::Light,
            Some(other) => {
                bail!("unknown theme \"{other}\" (expected \"gruvbox\", \"dark\", or \"light\")")
            }
        };

        Ok(Spec {
            direction,
            theme,
            nodes: raw.nodes,
            layers,
            edges: raw.edges,
        })
    }

    /// The resolved [`Theme`] to hand to the flow.
    pub fn theme(&self) -> Theme {
        match self.theme {
            ThemeKind::Gruvbox => gruvbox_theme(),
            ThemeKind::Dark => Theme::Dark,
            ThemeKind::Light => Theme::Light,
        }
    }

    /// Lowercase theme name, for the header line.
    pub fn theme_label(&self) -> &'static str {
        match self.theme {
            ThemeKind::Gruvbox => "gruvbox",
            ThemeKind::Dark => "dark",
            ThemeKind::Light => "light",
        }
    }

    /// How many edges carry an animated flow.
    pub fn flow_count(&self) -> usize {
        self.edges
            .iter()
            .filter(|edge| edge.flow_speed().is_some())
            .count()
    }
}

/// The gruvbox-material (medium) palette this setup uses everywhere:
/// ghostty, tmux, and nvim all run gruvbox-material, so a pane rendered
/// with this theme matches its neighbors.
///
/// `surface` deliberately equals `canvas_bg`: node boxes share the canvas
/// color so their rounded borders sit flush against the background instead
/// of reading as blocky filled rectangles.
pub fn gruvbox_theme() -> Theme {
    let mut palette = Theme::Dark.palette();
    palette.canvas_bg = Color::Rgb(40, 40, 40); // #282828 bg0
    palette.surface = Color::Rgb(40, 40, 40); // #282828 bg0 — same as the canvas
    palette.muted = Color::Rgb(168, 153, 104); // #a89968 gray — edge lines
    palette.subtle = Color::Rgb(102, 92, 84); // #665c54 bg3 — header, minimap
    palette.accent = Color::Rgb(216, 166, 87); // #d8a657 yellow — dots, selection
    palette.text = Color::Rgb(235, 219, 178); // #ebdbb2 fg
    palette.success = Color::Rgb(169, 182, 101); // #a9b665 green
    palette.error = Color::Rgb(234, 105, 92); // #ea6962 red
    Theme::Custom(palette)
}

/// The gruvbox-material bright accents cycled onto node borders, in
/// declaration order. Red is reserved for errors, so it never cycles.
pub fn gruvbox_accents() -> [Color; 6] {
    [
        Color::Rgb(216, 166, 87),  // #d8a657 yellow
        Color::Rgb(231, 138, 78),  // #e78a4e orange
        Color::Rgb(137, 180, 130), // #89b482 aqua
        Color::Rgb(125, 174, 163), // #7daea3 blue
        Color::Rgb(211, 134, 155), // #d3869b purple
        Color::Rgb(169, 182, 101), // #a9b665 green
    ]
}

/// Build a laid-out, themed [`Graph`] from a validated spec. Nodes are
/// auto-sized from their labels and their borders cycle the gruvbox
/// accents; the Sugiyama layout positions them. Edges with a `flow` speed
/// come back animated, with dots flowing source → target.
pub fn build_flow(spec: &Spec) -> Result<Graph> {
    // id -> label: declared nodes first, then edge endpoints (label = id).
    let mut labels: BTreeMap<String, String> = BTreeMap::new();
    for node in &spec.nodes {
        labels.insert(
            node.id.clone(),
            node.label.clone().unwrap_or_else(|| node.id.clone()),
        );
    }
    for edge in &spec.edges {
        for id in [&edge.from, &edge.to] {
            labels.entry(id.clone()).or_insert_with(|| id.clone());
        }
    }

    let accents = gruvbox_accents();
    let mut nodes: Vec<Node<TextContent>> = labels
        .iter()
        .enumerate()
        .map(|(index, (id, label))| {
            let mut node = Node::from_text(id.clone(), (0.0, 0.0), label.as_str());
            node.content = node
                .content
                .clone()
                .with_border_style(Style::default().fg(accents[index % accents.len()]));
            node
        })
        .collect();

    // Explicit layers pin each node's rank. Sugiyama ranks purely by edge
    // direction, so it cannot put two differently-wired nodes — a border
    // leaf and a rack leaf — on the same line.
    let mut placed_by_layers = false;
    let mut routes: Vec<Route> = Vec::new();
    if !spec.layers.is_empty() {
        // Pass 1 fixes the columns (horizontal placement is gap-independent).
        // The route planner then measures spans, and pass 2 re-places with
        // gaps sized to fit the lane count each gap must carry.
        nodes = place_by_layers(nodes, spec, &HashMap::new());
        let (planned, gap_lanes) = plan_routes(&nodes, spec);
        nodes = place_by_layers(nodes, spec, &gap_lanes);
        routes = planned;
        placed_by_layers = true;
    }
    let edges: Vec<Edge<FlowEdge>> = spec
        .edges
        .iter()
        .enumerate()
        .map(|(index, spec_edge)| {
            let mut built = Edge::new(
                format!("e{index}"),
                spec_edge.from.clone(),
                spec_edge.to.clone(),
            );
            if let Some(label) = &spec_edge.label {
                built = built.with_label(label.clone());
            }
            let mut content = match spec_edge.flow_speed() {
                Some(speed) => FlowEdge::flowing(speed),
                None => FlowEdge::plain(),
            };
            if let Some(route) = routes.get(index) {
                content = content.with_route(*route);
            }
            let mut built = built.with_content(content);
            if spec_edge.flow_speed().is_some() {
                built = built.with_animated(true);
            }
            built
        })
        .collect();

    let mut flow = Flow::with_graph(nodes, edges)?;
    if !placed_by_layers {
        let layout = match spec.direction {
            Direction::TopToBottom => Sugiyama::vertical(),
            Direction::LeftToRight => Sugiyama::horizontal(),
        };
        flow.apply_layout(layout);
    }
    flow = flow.with_theme(spec.theme());
    Ok(flow)
}

/// Position nodes by the spec's `layers`. Each inner array is one layer,
/// in declared order across the perpendicular axis; the layer index runs
/// along the flow axis. `""` reserves a slot, so a layer can align its
/// nodes under another layer's columns. `gap_lanes` maps each inter-layer
/// gap (indexed by its upper layer) to the lane count it must fit; the
/// gap grows beyond the default node height when lanes need the room.
fn place_by_layers(
    mut nodes: Vec<Node<TextContent>>,
    spec: &Spec,
    gap_lanes: &HashMap<usize, usize>,
) -> Vec<Node<TextContent>> {
    let max_w = nodes.iter().map(|n| n.width).fold(0.0_f64, f64::max);
    let max_h = nodes.iter().map(|n| n.height).fold(0.0_f64, f64::max);
    let col_gap = max_h.max(1.0);
    let margin = max_w.min(max_h).max(1.0);

    // Row baselines: each layer's boxes plus the sized gap below them.
    // One spare row beyond the lanes keeps the runs clear of the boxes.
    let gap = |index: usize| {
        let lanes = gap_lanes.get(&index).copied().unwrap_or(0);
        max_h.max((lanes + 1) as f64)
    };
    let mut row_y = Vec::with_capacity(spec.layers.len());
    let mut y = margin;
    for index in 0..spec.layers.len() {
        row_y.push(y);
        y += max_h + gap(index);
    }

    let mut slots: HashMap<&str, (usize, usize)> = HashMap::new();
    for (layer_index, layer) in spec.layers.iter().enumerate() {
        for (col, id) in layer.iter().enumerate() {
            if !id.is_empty() {
                slots.insert(id.as_str(), (layer_index, col));
            }
        }
    }

    // Columns are as wide as their widest node, so narrow columns stay
    // narrow and wide graphs fit the pane.
    let col_count = slots.values().map(|&(_, col)| col + 1).max().unwrap_or(1);
    let mut col_width = vec![0.0_f64; col_count];
    for node in &nodes {
        if let Some(&(_, col)) = slots.get(node.id.as_str()) {
            col_width[col] = col_width[col].max(node.width);
        }
    }
    let mut col_x = vec![0.0_f64; col_count];
    let mut x = margin;
    for col in 0..col_count {
        col_x[col] = x;
        x += col_width[col] + col_gap;
    }

    for node in &mut nodes {
        let Some(&(layer, col)) = slots.get(node.id.as_str()) else {
            continue; // from_json rejects unplaced nodes; defensive only
        };
        let along = row_y[layer];
        let across = col_x[col];
        let (x, y, source, target) = match spec.direction {
            Direction::TopToBottom => (
                across,
                along,
                HandlePosition::Bottom,
                HandlePosition::Top,
            ),
            Direction::LeftToRight => (
                along,
                across,
                HandlePosition::Right,
                HandlePosition::Left,
            ),
        };
        node.position = Position::new(x, y);
        node.source_position = source;
        node.target_position = target;
    }
    nodes
}

/// Per-edge routing for layered specs, computed after a first placement
/// pass fixes the columns. Attach points spread across each node's
/// outgoing and incoming edges; every horizontal run gets its own lane
/// above the target row so parallel runs never share a corridor; edges
/// that cross intermediate layers detour around boxes through a free
/// column. Returns the routes in spec-edge order and, per inter-layer
/// gap, the lane count that gap must fit.
fn plan_routes(
    nodes: &[Node<TextContent>],
    spec: &Spec,
) -> (Vec<Route>, HashMap<usize, usize>) {
    let fallback = Route {
        src_off: 0.5,
        tgt_off: 0.5,
        lane: 0,
        via: None,
    };

    // id -> (x, width, layer) from the placed nodes.
    let mut geom: HashMap<&str, (f64, f64, usize)> = HashMap::new();
    for node in nodes {
        geom.insert(node.id.as_str(), (node.position.x, node.width, 0));
    }
    for (layer, ids) in spec.layers.iter().enumerate() {
        for id in ids {
            if id.is_empty() {
                continue;
            }
            if let Some(entry) = geom.get_mut(id.as_str()) {
                entry.2 = layer;
            }
        }
    }

    // Out/in degrees drive the attach-point spread.
    let mut out_count: HashMap<&str, usize> = HashMap::new();
    let mut in_count: HashMap<&str, usize> = HashMap::new();
    for edge in &spec.edges {
        *out_count.entry(edge.from.as_str()).or_insert(0) += 1;
        *in_count.entry(edge.to.as_str()).or_insert(0) += 1;
    }
    let mut out_slot: HashMap<&str, usize> = HashMap::new();
    let mut in_slot: HashMap<&str, usize> = HashMap::new();

    // Columns claimed by vertical runs; vias stay clear of them.
    let mut columns: Vec<f64> = Vec::new();

    // Pass A: geometry per edge — attach points, vias, and the horizontal
    // spans each edge claims in its gaps.
    struct Claim {
        edge: usize,
        gap: usize,
        span: (f64, f64),
    }
    let mut claims: Vec<Claim> = Vec::new();
    let mut lanes_needed: HashMap<usize, usize> = HashMap::new();

    let mut routes = Vec::with_capacity(spec.edges.len());
    for (index, edge) in spec.edges.iter().enumerate() {
        let (Some(&(sx0, sw, s_layer)), Some(&(tx0, tw, t_layer))) =
            (geom.get(edge.from.as_str()), geom.get(edge.to.as_str()))
        else {
            routes.push(fallback);
            continue;
        };
        // Only downward, cross-layer edges get custom routes; anything
        // else falls back to the library router.
        if s_layer >= t_layer {
            routes.push(fallback);
            continue;
        }
        let n_out = out_count.get(edge.from.as_str()).copied().unwrap_or(1).max(1) as f64;
        let n_in = in_count.get(edge.to.as_str()).copied().unwrap_or(1).max(1) as f64;
        let k_out = {
            let slot = out_slot.entry(edge.from.as_str()).or_insert(0);
            let value = *slot;
            *slot += 1;
            value
        };
        let k_in = {
            let slot = in_slot.entry(edge.to.as_str()).or_insert(0);
            let value = *slot;
            *slot += 1;
            value
        };
        let src_off = (k_out + 1) as f64 / (n_out + 1.0);
        let tgt_off = (k_in + 1) as f64 / (n_in + 1.0);
        let sx = sx0 + sw * src_off;
        let tx = tx0 + tw * tgt_off;
        columns.push(sx);
        columns.push(tx);

        // Box x-spans in the layers strictly between source and target.
        let mut blocked: Vec<(f64, f64)> = Vec::new();
        for layer in spec.layers.iter().take(t_layer).skip(s_layer + 1) {
            for id in layer {
                if id.is_empty() {
                    continue;
                }
                if let Some(&(bx, bw, _)) = geom.get(id.as_str()) {
                    blocked.push((bx, bx + bw));
                }
            }
        }
        let needs_via = blocked.iter().any(|&(lo, hi)| sx >= lo && sx <= hi);
        let via = if needs_via {
            pick_via(&blocked, &columns, sx)
        } else {
            None
        };
        if let Some(v) = via {
            columns.push(v);
        }

        if let Some(vx) = via {
            claims.push(Claim {
                edge: index,
                gap: s_layer,
                span: (sx.min(vx), sx.max(vx)),
            });
            claims.push(Claim {
                edge: index,
                gap: t_layer - 1,
                span: (vx.min(tx), vx.max(tx)),
            });
        } else {
            claims.push(Claim {
                edge: index,
                gap: t_layer - 1,
                span: (sx.min(tx), sx.max(tx)),
            });
        }
        routes.push(Route {
            src_off,
            tgt_off,
            lane: 0,
            via,
        });
    }

    // Pass B: first-fit-decreasing — longest spans claim a lane first, so
    // narrow spans slot into leftover space and the gap stays shallow.
    let mut by_gap: HashMap<usize, Vec<(usize, (f64, f64))>> = HashMap::new();
    for claim in claims {
        if claim.span.0 == claim.span.1 {
            continue; // degenerate: no horizontal run, no lane needed
        }
        by_gap.entry(claim.gap).or_default().push((claim.edge, claim.span));
    }
    for (gap_index, mut entries) in by_gap {
        entries.sort_by(|a, b| {
            let wa = (a.1 .1 - a.1 .0).partial_cmp(&(b.1 .1 - b.1 .0)).unwrap_or(std::cmp::Ordering::Equal);
            wa.reverse()
        });
        let mut rows: Vec<Vec<(f64, f64)>> = Vec::new();
        for (edge_index, span) in entries {
            let lane = {
                let mut chosen = rows.len();
                for (index, claimed) in rows.iter_mut().enumerate() {
                    if claimed.iter().all(|&(lo, hi)| span.1 <= lo || span.0 >= hi) {
                        claimed.push(span);
                        chosen = index;
                        break;
                    }
                }
                if chosen == rows.len() {
                    rows.push(vec![span]);
                }
                chosen
            };
            let route = &mut routes[edge_index];
            route.lane = route.lane.max(lane);
            lanes_needed.insert(gap_index, lanes_needed.get(&gap_index).copied().unwrap_or(0).max(route.lane + 1));
        }
    }

    (routes, lanes_needed)
}

/// Picks a free column near `near` that clears every blocked span and
/// stays at least two cells from every claimed column, so this edge's
/// vertical run never overlaps another edge's.
fn pick_via(blocked: &[(f64, f64)], columns: &[f64], near: f64) -> Option<f64> {
    let mut candidates: Vec<f64> = blocked
        .iter()
        .flat_map(|&(lo, hi)| [lo - 1.0, hi + 1.0])
        .filter(|&x| !blocked.iter().any(|&(lo, hi)| x >= lo && x <= hi))
        .filter(|&x| columns.iter().all(|&c| (c - x).abs() >= 2.0))
        .collect();
    candidates.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    candidates.into_iter().min_by(|a, b| {
        (a - near)
            .abs()
            .partial_cmp(&(b - near).abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}

/// Draw one frame: a one-line header, then the graph on a plain canvas.
/// The canvas is a flat fill of the theme background — no dot grid — and
/// node boxes carry the same fill, so borders read as clean lines.
pub fn draw(frame: &mut Frame, flow: &mut Graph, header: &str) {
    let areas = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).split(frame.area());
    let (header_area, canvas) = (areas[0], areas[1]);

    let palette = flow.theme.palette();
    frame.render_widget(
        Paragraph::new(header).style(Style::default().fg(palette.subtle).bg(palette.canvas_bg)),
        header_area,
    );
    frame
        .buffer_mut()
        .set_style(canvas, Style::default().bg(palette.canvas_bg));
    frame.render_widget(&mut *flow, canvas);
    frame.render_widget(Controls::new(flow), canvas);
    // The minimap earns its corner only when the graph overflows the
    // canvas. When everything fits at the capped zoom it only covers the
    // bottom-right nodes.
    let overflows = flow.nodes().any(|node| {
        node.position.x + node.width > canvas.width as f64
            || node.position.y + node.height > canvas.height as f64
    });
    if overflows {
        frame.render_widget(MiniMap::new(flow), canvas);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(text: &str) -> Spec {
        Spec::from_json(text).expect("spec should parse")
    }

    #[test]
    fn minimal_spec_gets_the_defaults() {
        let s = spec(r#"{"edges":[{"from":"a","to":"b"}]}"#);
        assert_eq!(s.direction, Direction::TopToBottom);
        assert_eq!(s.theme, ThemeKind::Gruvbox);
        assert!(s.nodes.is_empty());
        assert_eq!(s.edges.len(), 1);
        assert_eq!(s.flow_count(), 0);
    }

    #[test]
    fn explicit_direction_and_theme_are_kept() {
        let s = spec(
            r#"{"direction":"lr","theme":"light",
                "edges":[{"from":"a","to":"b","label":"x"}]}"#,
        );
        assert_eq!(s.direction, Direction::LeftToRight);
        assert_eq!(s.theme, ThemeKind::Light);
        assert_eq!(s.edges[0].label.as_deref(), Some("x"));
    }

    #[test]
    fn node_label_defaults_to_id() {
        let s = spec(
            r#"{"nodes":[{"id":"a"},{"id":"b","label":"Bee"}],
                "edges":[{"from":"a","to":"b"}]}"#,
        );
        assert_eq!(s.nodes[0].label, None);
        assert_eq!(s.nodes[1].label.as_deref(), Some("Bee"));
    }

    #[test]
    fn flow_accepts_a_flag_or_a_speed() {
        let s = spec(
            r#"{"edges":[{"from":"a","to":"b","flow":true},
                         {"from":"b","to":"c","flow":2.5},
                         {"from":"c","to":"d","flow":false},
                         {"from":"d","to":"e"}]}"#,
        );
        assert_eq!(s.edges[0].flow_speed(), Some(1.0));
        assert_eq!(s.edges[1].flow_speed(), Some(2.5));
        assert_eq!(s.edges[2].flow_speed(), None);
        assert_eq!(s.edges[3].flow_speed(), None);
        assert_eq!(s.flow_count(), 2);
    }

    #[test]
    fn flow_rejects_zero_and_negative_speeds() {
        let err = Spec::from_json(r#"{"edges":[{"from":"a","to":"b","flow":0}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("flow"), "got: {err:#}");

        let err = Spec::from_json(r#"{"edges":[{"from":"a","to":"b","flow":-1.5}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("flow"), "got: {err:#}");
    }

    #[test]
    fn unknown_field_is_rejected() {
        let err = Spec::from_json(r#"{"egdes":[{"from":"a","to":"b"}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("egdes"), "got: {err:#}");

        let err = Spec::from_json(r#"{"edges":[{"from":"a","to":"b","flwo":1}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("flwo"), "got: {err:#}");
    }

    #[test]
    fn missing_edges_is_rejected() {
        assert!(Spec::from_json(r#"{"nodes":[{"id":"a"}]}"#).is_err());
    }

    #[test]
    fn empty_edge_list_is_rejected() {
        let err = Spec::from_json(r#"{"edges":[]}"#).unwrap_err();
        assert!(err.to_string().contains("edge"), "got: {err:#}");
    }

    #[test]
    fn unknown_direction_and_theme_are_rejected() {
        let err = Spec::from_json(r#"{"direction":"vertical","edges":[{"from":"a","to":"b"}]}"#)
            .unwrap_err();
        assert!(err.to_string().contains("direction"), "got: {err:#}");

        let err =
            Spec::from_json(r#"{"theme":"nord","edges":[{"from":"a","to":"b"}]}"#).unwrap_err();
        assert!(err.to_string().contains("theme"), "got: {err:#}");
    }

    #[test]
    fn duplicate_and_empty_node_ids_are_rejected() {
        let err =
            Spec::from_json(r#"{"nodes":[{"id":"a"},{"id":"a"}],"edges":[{"from":"a","to":"b"}]}"#)
                .unwrap_err();
        assert!(format!("{err:#}").contains("duplicate"), "got: {err:#}");

        let err = Spec::from_json(r#"{"nodes":[{"id":" "}],"edges":[{"from":"a","to":"b"}]}"#)
            .unwrap_err();
        assert!(format!("{err:#}").contains("empty"), "got: {err:#}");
    }

    #[test]
    fn empty_edge_endpoint_is_rejected() {
        let err = Spec::from_json(r#"{"edges":[{"from":"","to":"b"}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("empty"), "got: {err:#}");
    }

    #[test]
    fn build_flow_creates_declared_and_implicit_nodes() {
        let s = spec(
            r#"{"nodes":[{"id":"serve","label":"Serving shard"}],
                "edges":[{"from":"ingest","to":"serve"}]}"#,
        );
        let flow = build_flow(&s).expect("flow should build");
        let mut ids: Vec<String> = flow.nodes().map(|node| node.id.clone()).collect();
        ids.sort();
        assert_eq!(ids, vec!["ingest".to_string(), "serve".to_string()]);
    }

    #[test]
    fn build_flow_marks_flow_edges_animated() {
        let s = spec(
            r#"{"edges":[{"from":"a","to":"b","flow":3},
                         {"from":"b","to":"c"}]}"#,
        );
        let flow = build_flow(&s).expect("flow should build");
        let edges = flow.edges();
        assert!(edges[0].animated, "flow edge must be animated");
        assert!(!edges[1].animated, "static edge must not be animated");
    }

    #[test]
    fn gruvbox_theme_overrides_every_palette_slot() {
        let base = Theme::Dark.palette();
        let gruvbox = gruvbox_theme().palette();
        assert_ne!(base.canvas_bg, gruvbox.canvas_bg);
        assert_ne!(base.surface, gruvbox.surface);
        assert_ne!(base.muted, gruvbox.muted);
        assert_ne!(base.subtle, gruvbox.subtle);
        assert_ne!(base.accent, gruvbox.accent);
        assert_ne!(base.text, gruvbox.text);
        assert_ne!(base.success, gruvbox.success);
        assert_ne!(base.error, gruvbox.error);
    }

    #[test]
    fn gruvbox_node_fill_matches_the_canvas() {
        let palette = gruvbox_theme().palette();
        assert_eq!(
            palette.surface, palette.canvas_bg,
            "node boxes must share the canvas background"
        );
    }
}
