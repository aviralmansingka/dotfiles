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

pub use flow_edge::FlowEdge;

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, bail};
use rataflow::{Controls, Edge, Flow, MiniMap, Node, Sugiyama, TextContent, Theme};
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
    pub edges: Vec<SpecEdge>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSpec {
    direction: Option<String>,
    theme: Option<String>,
    #[serde(default)]
    nodes: Vec<SpecNode>,
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
    let nodes: Vec<Node<TextContent>> = labels
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
            if let Some(speed) = spec_edge.flow_speed() {
                built = built
                    .with_animated(true)
                    .with_content(FlowEdge::flowing(speed));
            }
            built
        })
        .collect();

    let mut flow = Flow::with_graph(nodes, edges)?;
    let layout = match spec.direction {
        Direction::TopToBottom => Sugiyama::vertical(),
        Direction::LeftToRight => Sugiyama::horizontal(),
    };
    flow.apply_layout(layout);
    flow = flow.with_theme(spec.theme());
    Ok(flow)
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
    frame.render_widget(MiniMap::new(flow), canvas);
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
