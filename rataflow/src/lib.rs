//! rataflow-view — turn a small JSON graph spec into a live rataflow graph.
//!
//! The library half (this target) owns the spec schema and the graph
//! construction, so both stay testable headlessly through ratatui's
//! `TestBackend`. The binary half (`rataflow-view`) owns the terminal event
//! loop that renders the graph for a human in a herdr pane.

use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, bail};
use rataflow::{Edge, Flow, Node, StepEdge, Sugiyama, TextContent, Theme};
use ratatui::style::Color;
use serde::Deserialize;

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

/// One edge. `label` is optional and renders on the edge.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecEdge {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
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
    /// values, duplicate node ids, empty ids, and empty edge lists.
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
}

/// The gruvbox-material (medium) palette this setup uses everywhere:
/// ghostty, tmux, and nvim all run gruvbox-material, so a pane rendered
/// with this theme matches its neighbors.
pub fn gruvbox_theme() -> Theme {
    let mut palette = Theme::Dark.palette();
    palette.canvas_bg = Color::Rgb(40, 40, 40); // #282828 bg0
    palette.surface = Color::Rgb(60, 56, 54); // #3c3836 bg1
    palette.muted = Color::Rgb(80, 73, 69); // #504945 bg2
    palette.subtle = Color::Rgb(102, 92, 84); // #665c54 bg3
    palette.accent = Color::Rgb(216, 166, 87); // #d8a657 yellow
    palette.text = Color::Rgb(235, 219, 178); // #ebdbb2 fg
    palette.success = Color::Rgb(169, 182, 101); // #a9b665 green
    palette.error = Color::Rgb(234, 105, 92); // #ea6962 red
    Theme::Custom(palette)
}

/// Build a laid-out, themed [`Flow`] from a validated spec. Nodes are
/// auto-sized from their labels; the Sugiyama layout positions them.
pub fn build_flow(spec: &Spec) -> Result<Flow> {
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

    let nodes: Vec<Node<TextContent>> = labels
        .into_iter()
        .map(|(id, label)| Node::from_text(id, (0.0, 0.0), label.as_str()))
        .collect();
    let edges: Vec<Edge<StepEdge>> = spec
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
            built
        })
        .collect();

    let mut flow = Flow::with_graph(nodes, edges)?;
    let layout = match spec.direction {
        Direction::TopToBottom => Sugiyama::vertical(),
        Direction::LeftToRight => Sugiyama::horizontal(),
    };
    flow.apply_layout(layout);
    Ok(flow.with_theme(spec.theme()))
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
    fn unknown_field_is_rejected() {
        let err = Spec::from_json(r#"{"egdes":[{"from":"a","to":"b"}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("egdes"), "got: {err:#}");
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
        assert!(err.to_string().contains("duplicate"), "got: {err:#}");

        let err = Spec::from_json(r#"{"nodes":[{"id":" "}],"edges":[{"from":"a","to":"b"}]}"#)
            .unwrap_err();
        assert!(err.to_string().contains("empty"), "got: {err:#}");
    }

    #[test]
    fn empty_edge_endpoint_is_rejected() {
        let err = Spec::from_json(r#"{"edges":[{"from":"","to":"b"}]}"#).unwrap_err();
        assert!(err.to_string().contains("empty"), "got: {err:#}");
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
}
