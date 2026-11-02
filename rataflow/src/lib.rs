//! rataflow-view — turn a small JSON graph spec into a live rataflow graph.
//!
//! The library half (this target) owns the spec schema and the graph
//! construction, so both stay testable headlessly through ratatui's
//! `TestBackend`. The binary half (`rataflow-view`) owns the terminal event
//! loop that renders the graph for a human in a herdr pane.
//!
//! Rendering contract: a plain background (no dot grid), neutral node
//! borders, one muted stroke for every edge, accent only for selection and
//! flow dots, and optional live dots flowing along edges that carry
//! movement. Edges follow the router's plan, so each one owns its own
//! corridor.

pub mod flow_edge;
pub mod layout;
pub mod router;

pub use flow_edge::{
    DEFAULT_DURATION_MS, DEFAULT_FLOW_RATE, DotMode, FlowEdge, MIN_DOT_CELLS, Route, Timing,
    dot_index,
};

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{Context, Result, bail};
use rataflow::{
    Controls, Edge, FitViewOptions, Flow, HandlePosition, HandleStyle, MiniMap, Node, Position,
    TextContent, Theme,
};
use ratatui::Frame;
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
use serde::Deserialize;

/// Milliseconds per animation step — the wall-clock base for flow dots.
/// One dot at `flow: 1` travels 10 cells per second; `flow: n` travels
/// `10 × n`.
pub const ANIMATION_STEP_MS: u64 = 100;

/// Most rank gaps one edge may declare with `minlen`. Past this the drawing
/// is taller than any pane, so the spec is rejected by name.
pub const MAX_MINLEN: usize = 8;

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

/// One node. `label` defaults to `id` when omitted. `group` is a logical
/// tag: it keeps the group's members in one contiguous block and gives them
/// one name-derived color family. Nothing is drawn around them.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecNode {
    pub id: String,
    pub label: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
}

/// One edge. `label` renders on the edge; `flow` animates it: `true` runs
/// the dot at the default constant rate ([`DEFAULT_FLOW_RATE`] cells per
/// [`ANIMATION_STEP_MS`] step), a positive number runs it at that constant
/// rate instead.
///
/// `timing` picks the motion mode: `"constant"` (the default) keeps one
/// speed for every route, `"same-arrival"` makes every such route leave at
/// phase 0 and reach its arrowhead after `duration_ms`. Same-arrival needs
/// `flow: true`; a numeric `flow` is rejected with it.
///
/// `duration_ms` is the shared arrival time, a positive whole number of
/// milliseconds, default [`DEFAULT_DURATION_MS`]. It is valid **only** with
/// `"timing": "same-arrival"` and `"flow": true`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecEdge {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
    #[serde(default)]
    flow: Option<RawFlow>,
    /// `"constant"` (default) or `"same-arrival"`.
    #[serde(default)]
    timing: Option<String>,
    /// Shared arrival time in milliseconds: a positive whole number. Absent
    /// means [`DEFAULT_DURATION_MS`].
    #[serde(default)]
    duration_ms: Option<serde_json::Value>,
    /// `0` draws no dot even when `flow` is set; `1` keeps exactly one dot
    /// on the route at any instant. Absent keeps the periodic spacing.
    #[serde(default)]
    dots: Option<u8>,
    /// `"solid"` (default) or `"dashed"`: a dashed route marks an
    /// unconfirmed relationship.
    #[serde(default)]
    style: Option<String>,
    /// Rank gaps this edge needs at least: `1` (default) puts the ends in
    /// consecutive ranks, `2` leaves one empty rank between them, so a label
    /// or a trunk corridor gets its own channel.
    #[serde(default)]
    minlen: Option<usize>,
    /// `true` reserves a horizontal gutter band for this edge's label, in the
    /// channel beside the edge's own run, instead of widening the rank gap to
    /// the label's length. Needs a `label`.
    #[serde(default)]
    label_slot: bool,
}

impl SpecEdge {
    /// The constant rate this edge asks for: `None` for a static edge,
    /// `Some(DEFAULT_FLOW_RATE)` for `flow: true`, `Some(n)` for `flow: n`.
    /// A rate is cells per [`ANIMATION_STEP_MS`] step, so a long route
    /// finishes later than a short one.
    pub fn flow_rate(&self) -> Option<f64> {
        match self.flow {
            None | Some(RawFlow::Flag(false)) => None,
            Some(RawFlow::Flag(true)) => Some(DEFAULT_FLOW_RATE),
            Some(RawFlow::Speed(rate)) => Some(rate),
        }
    }

    /// The declared motion mode. [`Spec::from_json`] rejects every value but
    /// `"constant"` and `"same-arrival"`, so an unparsable spec cannot reach
    /// here.
    pub fn timing_mode(&self) -> TimingMode {
        match self.timing.as_deref() {
            Some("same-arrival") => TimingMode::SameArrival,
            _ => TimingMode::Constant,
        }
    }

    /// How this edge's dots are timed. `flow: true` with
    /// `timing: "same-arrival"` shares the arrival time; `flow: true` or a
    /// numeric `flow` runs at a constant rate; everything else is static.
    pub fn timing(&self) -> Timing {
        match self.flow {
            None | Some(RawFlow::Flag(false)) => Timing::Static,
            Some(RawFlow::Speed(rate)) => Timing::Constant(rate),
            Some(RawFlow::Flag(true)) => match self.timing_mode() {
                TimingMode::Constant => Timing::Constant(DEFAULT_FLOW_RATE),
                TimingMode::SameArrival => Timing::SameArrival {
                    duration_ms: self.duration_ms(),
                },
            },
        }
    }

    /// The shared animation duration this edge asks for, in milliseconds
    /// (validated by [`Spec::from_json`]).
    pub fn duration_ms(&self) -> u64 {
        self.duration_ms
            .as_ref()
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(DEFAULT_DURATION_MS)
    }

    /// Rank gaps this edge needs at least: `1` (the default) for consecutive
    /// ranks, more to reserve a channel between them.
    pub fn minlen(&self) -> usize {
        self.minlen.unwrap_or(1)
    }

    /// True when the label asks for a horizontal gutter band beside the run
    /// instead of a rank gap as tall as the text is wide. A slot without a
    /// label has nothing to place, so it is ignored.
    pub fn wants_label_slot(&self) -> bool {
        self.label_slot && self.label.is_some()
    }

    /// How many dots this route draws at once.
    pub fn dots_mode(&self) -> DotMode {
        match self.dots {
            Some(0) => DotMode::None,
            Some(1) => DotMode::Single,
            _ => DotMode::Periodic,
        }
    }

    /// True when the route draws with dashed line glyphs.
    pub fn dashed(&self) -> bool {
        self.style.as_deref() == Some("dashed")
    }
}

/// The motion mode of one edge: constant speed (the default) or a shared
/// arrival time (opt-in).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimingMode {
    /// One speed for every route: `flow: true` is [`DEFAULT_FLOW_RATE`],
    /// `flow: n` is that rate.
    #[default]
    Constant,
    /// Every such route leaves at phase 0 and reaches its arrowhead after
    /// its `duration_ms`.
    SameArrival,
}

/// One trunk: a single declared corridor from `from` to `to`, plus one
/// branch spur from that corridor to each node in `branches`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecTrunk {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    pub from: String,
    pub to: String,
    pub branches: Vec<String>,
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
    /// Shared buses: one corridor each, with one spur per branch.
    pub trunks: Vec<SpecTrunk>,
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
    /// Optional shared buses. A trunk routes one corridor and then one spur
    /// to each branch, so branches never become parallel independent routes.
    #[serde(default)]
    trunks: Vec<SpecTrunk>,
}

impl Spec {
    /// Parse and validate a spec file. Rejections carry a message that
    /// names the problem: unknown fields, unknown `direction`, `theme`, or
    /// edge `style` values, duplicate node ids, empty ids, empty edge lists,
    /// non-positive `flow` speeds, a `duration_ms` that is not a positive
    /// whole number, a `duration_ms` next to a `flow` flag or speed that
    /// contradicts it, `dots` other than 0 or 1, and every trunk fault (an
    /// id that is not a node, `from == to`, no branches, a repeated branch,
    /// or a branch equal to the trunk's ends).
    ///
    /// A trunk may only name declared nodes, so a bed of branch hosts needs
    /// `nodes` entries even when no edge touches them.
    pub fn from_json(text: &str) -> Result<Spec> {
        let raw: RawSpec = serde_json::from_str(text).with_context(
            || "parsing the spec (fields: direction, theme, nodes, layers, edges, trunks)",
        )?;

        if raw.edges.is_empty() {
            bail!("the spec needs at least one edge, e.g. {{\"from\": \"a\", \"to\": \"b\"}}");
        }
        for (index, edge) in raw.edges.iter().enumerate() {
            if edge.from.trim().is_empty() || edge.to.trim().is_empty() {
                bail!("edge {index} has an empty \"from\" or \"to\" id");
            }
            if let Some(rate) = edge.flow_rate()
                && (!rate.is_finite() || rate <= 0.0)
            {
                bail!(
                    "edge {index} has a non-positive \"flow\" rate {rate} \
                     (use true or a positive number)"
                );
            }
            if let Some(mode) = edge.timing.as_deref()
                && mode != "constant"
                && mode != "same-arrival"
            {
                bail!(
                    "edge {index} has unknown \"timing\" \"{mode}\" \
                     (expected \"constant\" or \"same-arrival\")"
                );
            }
            // Same-arrival is the opt-in shared clock: it owns the pace, so
            // a numeric speed would contradict it.
            if edge.timing_mode() == TimingMode::SameArrival {
                match edge.flow {
                    Some(RawFlow::Flag(true)) => {}
                    Some(RawFlow::Speed(rate)) => bail!(
                        "edge {index} sets \"timing\": \"same-arrival\" and a numeric \
                         \"flow\" rate ({rate}); same-arrival needs \"flow\": true because it \
                         sets the pace itself"
                    ),
                    _ => bail!(
                        "edge {index} sets \"timing\": \"same-arrival\" without \"flow\": true; \
                         add \"flow\": true or drop the timing"
                    ),
                }
            }
            if let Some(raw) = edge.duration_ms.as_ref() {
                let ms = match raw.as_u64() {
                    Some(0) => bail!(
                        "edge {index} has \"duration_ms\": 0; it must be a positive whole \
                         number of milliseconds (the default is {DEFAULT_DURATION_MS})"
                    ),
                    Some(ms) => ms,
                    None => bail!(
                        "edge {index} has \"duration_ms\": {raw}; it must be a positive whole \
                         number of milliseconds (the default is {DEFAULT_DURATION_MS})"
                    ),
                };
                // `duration_ms` names the shared arrival time, so it only
                // means something in the one mode that has one.
                if !matches!(edge.flow, Some(RawFlow::Flag(true))) {
                    bail!(
                        "edge {index} sets \"duration_ms\": {ms} without \"flow\": true; \
                         a shared duration needs \"flow\": true and \
                         \"timing\": \"same-arrival\""
                    );
                }
                if edge.timing_mode() != TimingMode::SameArrival {
                    bail!(
                        "edge {index} sets \"duration_ms\": {ms} with \"timing\": \"constant\"; \
                         a shared duration is only valid with \"timing\": \"same-arrival\" and \
                         \"flow\": true"
                    );
                }
            }
            if let Some(dots) = edge.dots
                && dots > 1
            {
                bail!(
                    "edge {index} has \"dots\": {dots}; only 0 (no dot) and 1 (one dot on the \
                     route) are supported"
                );
            }
            if let Some(minlen) = edge.minlen
                && !(1..=MAX_MINLEN).contains(&minlen)
            {
                bail!(
                    "edge {index} has \"minlen\": {minlen}; it must be between 1 (consecutive \
                     ranks) and {MAX_MINLEN} (that many rank gaps)"
                );
            }
            if edge.label_slot && edge.label.is_none() {
                bail!(
                    "edge {index} sets \"label_slot\": true without a \"label\"; \
                     the slot exists to place that label"
                );
            }
            if let Some(style) = edge.style.as_deref()
                && style != "solid"
                && style != "dashed"
            {
                bail!(
                    "edge {index} has unknown \"style\" \"{style}\" (expected \"solid\" or \"dashed\")"
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
            if node
                .group
                .as_deref()
                .is_some_and(|group| group.trim().is_empty())
            {
                bail!("node \"{}\" has an empty \"group\"", node.id);
            }
        }

        // Declared nodes are the ids a trunk may name: a branch host that no
        // edge touches still needs its own `nodes` entry, or the trunk would
        // be wiring a node the spec never described.
        let declared: HashSet<&str> = raw.nodes.iter().map(|n| n.id.as_str()).collect();
        let mut known: HashSet<&str> = declared.clone();
        for edge in &raw.edges {
            known.insert(edge.from.as_str());
            known.insert(edge.to.as_str());
        }
        let mut trunk_ids: HashSet<&str> = HashSet::new();
        for (index, trunk) in raw.trunks.iter().enumerate() {
            if trunk.id.trim().is_empty() {
                bail!("trunk {index} has an empty \"id\"");
            }
            if !trunk_ids.insert(trunk.id.as_str()) {
                bail!("duplicate trunk id \"{}\"", trunk.id);
            }
            if trunk.from == trunk.to {
                bail!(
                    "trunk \"{}\" routes \"{}\" to itself; a corridor needs two different nodes",
                    trunk.id,
                    trunk.from
                );
            }
            for id in [&trunk.from, &trunk.to] {
                if !declared.contains(id.as_str()) {
                    bail!(
                        "trunk \"{}\" names \"{id}\", which is not a declared node in this spec",
                        trunk.id
                    );
                }
            }
            if trunk.branches.is_empty() {
                bail!(
                    "trunk \"{}\" needs at least one branch (branches: [\"id\", ...])",
                    trunk.id
                );
            }
            let mut branches: HashSet<&str> = HashSet::new();
            for branch in &trunk.branches {
                if !declared.contains(branch.as_str()) {
                    bail!(
                        "trunk \"{}\" has branch \"{branch}\", which is not a declared node in \
                         this spec",
                        trunk.id
                    );
                }
                if branch == &trunk.from || branch == &trunk.to {
                    bail!(
                        "trunk \"{}\" has branch \"{branch}\", which is already the trunk's \
                         from or to node",
                        trunk.id
                    );
                }
                if !branches.insert(branch.as_str()) {
                    bail!("trunk \"{}\" lists branch \"{branch}\" twice", trunk.id);
                }
            }
        }

        let layers = raw.layers.unwrap_or_default();
        if !layers.is_empty() {
            // Every named id must be a known node and each node may be
            // pinned to one rank only. A node the spec leaves out is not an
            // error: it ranks automatically around the pins.
            let mut placed: HashSet<&str> = HashSet::new();
            for (layer_index, layer) in layers.iter().enumerate() {
                for id in layer {
                    if id.is_empty() {
                        continue; // "" reserves a slot without pinning a node
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
            trunks: raw.trunks,
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

    /// How many edges carry an animated flow, in either motion mode.
    pub fn flow_count(&self) -> usize {
        self.edges
            .iter()
            .filter(|edge| !matches!(edge.timing(), Timing::Static))
            .count()
    }

    /// How many edges use the shared arrival time.
    pub fn same_arrival_count(&self) -> usize {
        self.edges
            .iter()
            .filter(|edge| edge.timing().is_same_arrival())
            .count()
    }

    /// Node groups in declaration order of first appearance, with how many
    /// declared nodes belong to each. Purely a count of the logical tags: a
    /// group owns ordering and hue, never a drawn box.
    pub fn groups(&self) -> Vec<(String, usize)> {
        let mut out: Vec<(String, usize)> = Vec::new();
        for node in &self.nodes {
            let Some(group) = node.group.as_deref() else {
                continue;
            };
            match out.iter_mut().find(|(name, _)| name == group) {
                Some((_, count)) => *count += 1,
                None => out.push((group.to_string(), 1)),
            }
        }
        out
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

/// One hue family per layer. Siblings inside a layer take different
/// shades of the family, so they read as related without becoming one
/// block. Adjacent layers never share a family, so depth stays legible.
///
/// These are gruvbox-material tones: desaturated, so a dense graph stays
/// calm and the muted edges still recede. Node GROUPS do not use this table:
/// their hues come from the collision-free wheel below.
const FAMILIES: [[Color; 4]; 6] = [
    // yellow — entry side of the flow
    [
        Color::Rgb(216, 166, 87),
        Color::Rgb(228, 184, 111),
        Color::Rgb(200, 147, 68),
        Color::Rgb(239, 202, 138),
    ],
    // aqua
    [
        Color::Rgb(125, 174, 163),
        Color::Rgb(147, 194, 183),
        Color::Rgb(99, 151, 141),
        Color::Rgb(168, 211, 200),
    ],
    // purple
    [
        Color::Rgb(211, 134, 155),
        Color::Rgb(226, 156, 175),
        Color::Rgb(187, 108, 131),
        Color::Rgb(238, 180, 196),
    ],
    // green
    [
        Color::Rgb(169, 182, 101),
        Color::Rgb(189, 201, 124),
        Color::Rgb(143, 157, 79),
        Color::Rgb(208, 217, 150),
    ],
    // blue
    [
        Color::Rgb(125, 160, 184),
        Color::Rgb(151, 184, 206),
        Color::Rgb(98, 132, 156),
        Color::Rgb(176, 205, 224),
    ],
    // orange — exit side of the flow
    [
        Color::Rgb(231, 138, 78),
        Color::Rgb(241, 164, 108),
        Color::Rgb(210, 116, 56),
        Color::Rgb(248, 188, 140),
    ],
];

/// The border color for the `slot`-th node of layer `band`. Past the last
/// family the assignment wraps, and each wrap darkens a step so a deep
/// graph still separates layer 5 from layer 0.
pub fn layer_color(band: usize, slot: usize) -> Color {
    let family = FAMILIES[band % FAMILIES.len()];
    let mut color = family[slot % family.len()];
    for _ in 0..(band / FAMILIES.len()) {
        color = darken(color, 0.18);
    }
    color
}

fn darken(color: Color, amount: f64) -> Color {
    let Color::Rgb(r, g, b) = color else {
        return color;
    };
    let f = |v: u8| (v as f64 * (1.0 - amount)).round() as u8;
    Color::Rgb(f(r), f(g), f(b))
}

/// The neutral border, kept for graphs whose nodes do not form layers.
pub fn node_border() -> Color {
    Color::Rgb(146, 131, 116)
}

// ---------------------------------------------------------------------------
// Group hue families
// ---------------------------------------------------------------------------
//
// A group is a logical tag: it orders sibling blocks and picks a hue family
// for its members' borders, and nothing is drawn around them. A pure
// name-derived bucket (round 09) did not hold up: `compute` and `control`
// shared one RGB, `fabric` and `app` shared another, `orchestration` and
// `storage` were indistinguishable, and machine-manager's four tags read as
// three families. So the family is now chosen per spec, over a fixed wheel of
// evenly spaced hues, and no two groups of one spec share a family.

/// How many hue families the group wheel offers: eight hues, 45 degrees
/// apart, all at one saturation and lightness so only the hue tells them
/// apart. A spec that declares more groups than this repeats a family, the
/// repeat taken as far from the others as the wheel allows.
pub const GROUP_FAMILIES: usize = 8;

/// The wheel starts in the warm mid-tones: it keeps the palette's yellow on
/// the first family and stays off the theme's error red.
const GROUP_HUE_START: f64 = 30.0;
const GROUP_SATURATION: f64 = 0.48;
const GROUP_LIGHTNESS: f64 = 0.63;

/// Lightness offsets that give a group's members their shades. Members keep
/// the family hue and differ by lightness, so siblings read as related
/// without merging into one block.
const GROUP_SHADES: [f64; 4] = [0.0, 0.10, -0.10, 0.19];

/// The hue, in degrees, of group family `family`.
pub fn group_family_hue(family: usize) -> f64 {
    let step = 360.0 / GROUP_FAMILIES as f64;
    (GROUP_HUE_START + step * (family % GROUP_FAMILIES) as f64).rem_euclid(360.0)
}

/// The shorter arc between two hue angles, in degrees (0..=180).
fn hue_gap(a: f64, b: f64) -> f64 {
    let difference = (a - b).abs() % 360.0;
    difference.min(360.0 - difference)
}

/// HSL to the RGB the terminal paints: `hue` in degrees, `saturation` and
/// `lightness` in `0..=1`.
fn hsl_to_rgb(hue: f64, saturation: f64, lightness: f64) -> Color {
    let sector = hue.rem_euclid(360.0) / 60.0;
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let second = chroma * (1.0 - (sector % 2.0 - 1.0).abs());
    let (red, green, blue) = match sector as u8 {
        0 => (chroma, second, 0.0),
        1 => (second, chroma, 0.0),
        2 => (0.0, chroma, second),
        3 => (0.0, second, chroma),
        4 => (second, 0.0, chroma),
        _ => (chroma, 0.0, second),
    };
    let floor = lightness - chroma / 2.0;
    let channel = |value: f64| ((value + floor) * 255.0).round().clamp(0.0, 255.0) as u8;
    Color::Rgb(channel(red), channel(green), channel(blue))
}

/// The border color for the `member`-th node of a group that took `family`.
pub fn group_family_color(family: usize, member: usize) -> Color {
    let wrap = member / GROUP_SHADES.len();
    let offset = GROUP_SHADES[member % GROUP_SHADES.len()];
    // Past the declared shades a member drifts darker per wrap, so a large
    // group still separates node from node.
    let lightness = (GROUP_LIGHTNESS + offset - 0.07 * wrap as f64).clamp(0.30, 0.90);
    hsl_to_rgb(group_family_hue(family), GROUP_SATURATION, lightness)
}

/// One hue family per declared group, with no two groups sharing a family.
///
/// The answer depends only on the SET of names, never on the order a spec
/// declares them in: names are visited in sorted order, and each keeps its
/// name-derived family ([`group_family`]) unless an earlier name already took
/// it — then it takes the free family farthest in hue from the ones taken,
/// breaking ties toward its own family and then the lower index. So the same
/// names always resolve to the same families, across runs and across the
/// views of one case, and a group keeps its color when unrelated groups come
/// and go.
pub fn group_families<I, S>(groups: I) -> BTreeMap<String, usize>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut names: Vec<String> = groups
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    names.sort_unstable();
    names.dedup();
    let mut taken: Vec<usize> = Vec::new();
    let mut resolved: BTreeMap<String, usize> = BTreeMap::new();
    for name in names {
        let family = assign_family(group_family(&name), &taken);
        taken.push(family);
        resolved.insert(name, family);
    }
    resolved
}

/// The family for a group whose name points at `preferred`: that one when it
/// is still free, else the free family farthest in hue from every taken one.
fn assign_family(preferred: usize, taken: &[usize]) -> usize {
    if !taken.contains(&preferred) {
        return preferred;
    }
    let mut best: Option<(usize, f64)> = None;
    for family in 0..GROUP_FAMILIES {
        if taken.contains(&family) {
            continue;
        }
        let spread = taken
            .iter()
            .map(|taken| hue_gap(group_family_hue(family), group_family_hue(*taken)))
            .fold(360.0, f64::min);
        let better = match best {
            None => true,
            Some((current, current_spread)) => {
                let closer = |candidate: usize| {
                    hue_gap(group_family_hue(candidate), group_family_hue(preferred))
                };
                match spread.total_cmp(&current_spread) {
                    std::cmp::Ordering::Greater => true,
                    std::cmp::Ordering::Less => false,
                    std::cmp::Ordering::Equal => match closer(family).total_cmp(&closer(current)) {
                        std::cmp::Ordering::Less => true,
                        std::cmp::Ordering::Greater => false,
                        std::cmp::Ordering::Equal => family < current,
                    },
                }
            }
        };
        if better {
            best = Some((family, spread));
        }
    }
    // Every family is taken: the name's own keeps the choice deterministic.
    best.map_or(preferred, |(family, _)| family)
}

/// The family index a group NAME points at, before the per-spec pass in
/// [`group_families`] spreads the declared names apart.
pub fn group_family(group: &str) -> usize {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in group.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3); // the FNV-1a 64 prime
    }
    // SplitMix64 finalizer: without it, names that differ in one late byte
    // land in neighbouring buckets.
    let mut mixed = hash;
    mixed ^= mixed >> 30;
    mixed = mixed.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    mixed ^= mixed >> 27;
    mixed = mixed.wrapping_mul(0x94d0_49bb_1331_11eb);
    mixed ^= mixed >> 31;
    (mixed % GROUP_FAMILIES as u64) as usize
}

/// The border color for the `member`-th node of group `group`, on its own:
/// the name-derived family, before any spec's collision pass. Painting uses
/// [`group_families`] with [`group_family_color`], so one spec never gives
/// two groups the same family.
pub fn group_color(group: &str, member: usize) -> Color {
    group_family_color(group_family(group), member)
}

/// Paints every node by its layer. Layers are read from the layout itself:
/// nodes that sit on the same axis position belong to the same layer, so
/// this works for explicit `layers` and for Sugiyama output alike. A node
/// that names a `group` takes that group's color family instead, whatever
/// layer it sits on.
fn paint_nodes(flow: &mut Graph, spec: &Spec) -> Result<()> {
    let mut bands: BTreeMap<i32, Vec<(f64, f64, String)>> = BTreeMap::new();
    for node in flow.nodes() {
        let bounds = node.bounds();
        let (along, across) = match spec.direction {
            Direction::TopToBottom => (bounds.position.y, bounds.position.x),
            Direction::LeftToRight => (bounds.position.x, bounds.position.y),
        };
        bands
            .entry(along.round() as i32)
            .or_default()
            .push((across, along, node.id.clone()));
    }

    let mut colors: BTreeMap<String, Color> = BTreeMap::new();
    for (band, (_along, mut members)) in bands.into_iter().enumerate() {
        members.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        for (slot, (_, _, id)) in members.into_iter().enumerate() {
            colors.insert(id, layer_color(band, slot));
        }
    }

    // Grouped nodes: one family per declared group, collision-free for this
    // spec, then a shade per member. The family comes from the group NAME,
    // so it does not move when the spec declares groups in another order.
    let families = group_families(spec.nodes.iter().filter_map(|node| node.group.as_deref()));
    let mut members: HashMap<&str, usize> = HashMap::new();
    let mut grouped: HashMap<&str, (&str, usize)> = HashMap::new();
    for node in &spec.nodes {
        let Some(group) = node.group.as_deref() else {
            continue;
        };
        let member = members.entry(group).or_insert(0);
        grouped.insert(node.id.as_str(), (group, *member));
        *member += 1;
    }
    for (id, (group, member)) in grouped {
        let family = families
            .get(group)
            .copied()
            .unwrap_or_else(|| group_family(group));
        colors.insert(id.to_string(), group_family_color(family, member));
    }

    let mut nodes: Vec<Node<TextContent>> = flow.nodes().cloned().collect();
    for node in &mut nodes {
        if let Some(color) = colors.get(&node.id) {
            node.content = node
                .content
                .clone()
                .with_border_style(Style::default().fg(*color));
        }
    }
    flow.set_nodes(nodes)?;
    Ok(())
}

/// Handles are drag targets, not decoration. Drawing each one as the
/// border glyph it replaces keeps node boxes unbroken and removes the ring
/// of `●` that the library paints by default.
fn border_handle_style() -> HandleStyle {
    // Some(default) suppresses the handle's accent fallback while preserving
    // the border cell's existing foreground, including selection styling.
    HandleStyle::directional('─', '│', '─', '│').with_char_style(Style::default())
}

/// Build a laid-out, themed [`Graph`] from a validated spec.
pub fn build_flow(spec: &Spec) -> Result<Graph> {
    build_flow_with_report(spec).map(|(flow, _)| flow)
}

/// What `--check` can report without a terminal: the graph's size in
/// cells, how much two edges share or cross, and how the labels, groups,
/// and trunks came out.
#[derive(Debug, Clone, Default)]
pub struct Report {
    pub nodes: usize,
    pub edges: usize,
    /// Every drawn route: spec edges plus trunk corridors and spurs.
    pub routes: usize,
    pub extent: (i32, i32),
    pub shared_run: usize,
    /// Cells where two routes cross at right angles. Each independent
    /// crossing is one bridge cell, drawn as `⌒` so it never reads as a
    /// junction.
    pub crossings: usize,
    /// Of those bridges, the ones drawn one cell against a bend of either
    /// route: a reader can misread that contact as a join.
    pub touching_bends: usize,
    pub labels_skipped: usize,
    /// Labels placed out of the labels the spec asked for.
    pub labels_placed: usize,
    pub labels_total: usize,
    /// Placed labels that still sit on a drawn route cell: 0 when correct.
    pub labels_on_route: usize,
    /// Placed labels another route is at least as close to as its own. The
    /// layout reserves a slot per labelled edge, so this is 0 by
    /// construction; a non-zero count means the slot reservation failed.
    pub labels_ambiguous: usize,
    /// `(edge id, label)` for every dropped label.
    pub skipped_labels: Vec<(String, String)>,
    /// Node groups in declaration order, with their member counts. A group
    /// is a logical tag: it orders sibling blocks and picks a hue family,
    /// and nothing is drawn around its members.
    pub groups: Vec<(String, usize)>,
    /// Nodes the spec pinned to a declared rank through `layers`.
    pub pinned: usize,
    /// Edges whose declared `minlen` the pins cannot honor. Every entry is
    /// reported, so a pin is never silently overruled.
    pub pins: Vec<layout::PinConflict>,
    pub trunks: Vec<TrunkReport>,
    /// How many junction cells the plan draws.
    pub junctions: usize,
    /// Animated routes whose drawable dot span is too short to show motion
    /// (fewer than [`MIN_DOT_CELLS`]). They are reported instead of being
    /// animated ambiguously, and `--check` names each one.
    pub short_routes: Vec<ShortRoute>,
}

/// One animated route that cannot show motion: it has fewer drawable dot
/// cells than [`MIN_DOT_CELLS`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShortRoute {
    /// Route id, as `--check` names it (`e<index>`).
    pub route: String,
    pub from: String,
    pub to: String,
    /// Drawable dot cells, always below [`MIN_DOT_CELLS`].
    pub dot_cells: usize,
}

/// One trunk as `--check` reports it.
#[derive(Debug, Clone, Default)]
pub struct TrunkReport {
    pub id: String,
    pub from: String,
    pub to: String,
    pub branches: usize,
    /// Junction cells the bus draws. Two or fewer branches share ONE split
    /// point; more keep a tap per branch, so this is the honest count.
    pub junctions: usize,
}

/// Builds the graph and the routing report. Nodes are auto-sized from
/// their labels, layered specs are placed by `layers` (Sugiyama
/// otherwise), and every edge gets its own routed corridor.
pub fn build_flow_with_report(spec: &Spec) -> Result<(Graph, Report)> {
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

    // Every route the renderer draws, in draw order: the spec's edges, then
    // each trunk's single corridor followed by its branch spurs.
    let routes_spec = routed_edges(spec);

    let mut nodes: Vec<Node<TextContent>> = labels
        .iter()
        .map(|(id, label)| {
            let mut node = Node::from_text(id.clone(), (0.0, 0.0), label.as_str());
            // A fractional fit/pan can round a 3-cell box's centre handle
            // onto its far corner. Four cells keep it inside the perimeter.
            node.width = node.width.max(4.0);
            node.height = node.height.max(4.0);
            node.content = node
                .content
                .clone()
                .with_border_style(Style::default().fg(node_border()));
            node
        })
        .collect();

    // A node needs one border cell per route on its busiest side, plus the
    // corners. Sizing for its degree keeps fan-out ports apart instead of
    // stacking them in one column.
    let mut out_deg: BTreeMap<&str, usize> = BTreeMap::new();
    let mut in_deg: BTreeMap<&str, usize> = BTreeMap::new();
    let mut spur_deg: BTreeMap<&str, usize> = BTreeMap::new();
    for route in &routes_spec {
        if matches!(route.role, router::Role::Spur { .. }) {
            // A spur enters its branch across the flow, on its own port.
            *spur_deg.entry(route.to.as_str()).or_insert(0) += 1;
            continue;
        }
        *out_deg.entry(route.from.as_str()).or_insert(0) += 1;
        *in_deg.entry(route.to.as_str()).or_insert(0) += 1;
    }
    for node in &mut nodes {
        let busiest = out_deg
            .get(node.id.as_str())
            .copied()
            .unwrap_or(0)
            .max(in_deg.get(node.id.as_str()).copied().unwrap_or(0));
        let need = (2 * busiest + 1) as f64;
        let spur_need = (2 * spur_deg.get(node.id.as_str()).copied().unwrap_or(0) + 1) as f64;
        match spec.direction {
            Direction::TopToBottom => {
                node.width = node.width.max(need).max(spur_need);
                node.height = node.height.max(spur_need);
            }
            Direction::LeftToRight => {
                node.height = node.height.max(need).max(spur_need);
                node.width = node.width.max(spur_need);
            }
        }
    }

    // The engine places every spec, auto or pinned. `layers` pins ranks;
    // within a rank the barycenter pass still chooses the order.
    let pins = rank_pins(&nodes, spec);
    // Structural specs (groups, minlen gaps, partial pins) go through the
    // engine; a fully pinned grid with none of those keeps its declared grid.
    // A `label_slot` also needs the engine, because the gutter band it
    // reserves is chosen from the engine's own label placement.
    let structured = !spec.groups().is_empty()
        || spec.edges.iter().any(|edge| edge.minlen() > 1)
        || spec.edges.iter().any(|edge| edge.wants_label_slot())
        || pins.iter().any(Option::is_none);
    let mut conflicts: Vec<layout::PinConflict> = Vec::new();
    nodes = place_nodes(nodes, spec, &pins, structured, &mut conflicts).0;

    let edges: Vec<Edge<FlowEdge>> = routes_spec
        .iter()
        .enumerate()
        .map(|(index, route)| {
            let mut built = Edge::new(format!("e{index}"), route.from.clone(), route.to.clone());
            if let Some(label) = &route.label {
                built = built.with_label(label.clone());
            }
            let content = match route.timing {
                Timing::Static => FlowEdge::plain(),
                Timing::Constant(rate) => FlowEdge::constant(rate),
                Timing::SameArrival { duration_ms } => FlowEdge::same_arrival(duration_ms),
            }
            .with_dots(route.dots)
            .with_dashed(route.dashed);
            let animated = !matches!(route.timing, Timing::Static) && route.dots != DotMode::None;
            built.with_content(content).with_animated(animated)
        })
        .collect();

    let mut flow = Flow::with_graph(nodes, edges)?;
    // Same-layer, return and self edges can use the other pair of sides.
    // Size those borders too, then place again so enlarged boxes never overlap.
    let boxes = node_boxes(&flow, spec);
    let axis = match spec.direction {
        Direction::TopToBottom => router::FlowAxis::TopToBottom,
        Direction::LeftToRight => router::FlowAxis::LeftToRight,
    };
    let mut side_counts: HashMap<(&str, router::Side), usize> = HashMap::new();
    for route in &routes_spec {
        let src = boxes.iter().find(|n| n.id == route.from).expect("source");
        let tgt = boxes.iter().find(|n| n.id == route.to).expect("target");
        if matches!(route.role, router::Role::Spur { .. }) {
            // A spur may enter any side of its branch: size all four, so its
            // port always has a cell.
            for side in [
                router::Side::Top,
                router::Side::Bottom,
                router::Side::Left,
                router::Side::Right,
            ] {
                *side_counts.entry((tgt.id.as_str(), side)).or_insert(0) += 1;
            }
            continue;
        }
        let (source_side, target_side) = router::sides_for(src, tgt, axis);
        *side_counts
            .entry((src.id.as_str(), source_side))
            .or_insert(0) += 1;
        *side_counts
            .entry((tgt.id.as_str(), target_side))
            .or_insert(0) += 1;
    }
    let mut nodes: Vec<_> = flow.nodes().cloned().collect();
    for node in &mut nodes {
        for side in [
            router::Side::Top,
            router::Side::Bottom,
            router::Side::Left,
            router::Side::Right,
        ] {
            let need = (2 * side_counts
                .get(&(node.id.as_str(), side))
                .copied()
                .unwrap_or(0)
                + 1) as f64;
            match side {
                router::Side::Top | router::Side::Bottom => node.width = node.width.max(need),
                router::Side::Left | router::Side::Right => node.height = node.height.max(need),
            }
        }
    }
    let (nodes, label_anchors) = place_nodes(nodes, spec, &pins, structured, &mut conflicts);
    flow.set_nodes(nodes)?;
    flow = flow.with_theme(spec.theme());
    paint_nodes(&mut flow, spec)?;

    // Route every edge on the character grid, then hand each plan to its
    // edge content by id.
    let boxes = node_boxes(&flow, spec);
    let index_of = |id: &str| boxes.iter().position(|b| b.id == id).unwrap_or(0);
    let edge_specs: Vec<router::EdgeSpec> = routes_spec
        .iter()
        .enumerate()
        .map(|(index, route)| router::EdgeSpec {
            from: index_of(&route.from),
            to: index_of(&route.to),
            label: route.label.clone(),
            // A `label_slot` label is placed by the layout as a horizontal
            // gutter band beside the run; the router reserves those cells so
            // no other route may cross the text.
            label_slot: gutter_label(index, route, &label_anchors),
            role: route.role,
        })
        .collect();
    let plan = router::plan(&boxes, &edge_specs, axis);
    if !plan.unrouted.is_empty() {
        let failed: Vec<_> = plan
            .unrouted
            .iter()
            .map(|&index| format!("{} -> {}", routes_spec[index].from, routes_spec[index].to))
            .collect();
        bail!(
            "no obstacle-safe route for {}; increase node/layer spacing",
            failed.join(", ")
        );
    }
    let routes: BTreeMap<String, Route> = plan
        .routes
        .iter()
        .enumerate()
        .filter_map(|(index, planned)| {
            planned
                .as_ref()
                .map(|planned| (format!("e{index}"), route_from(planned)))
        })
        .collect();
    for (id, content) in flow.edges_content_mut() {
        if let Some(route) = routes.get(id) {
            content.set_route(route.clone());
        }
    }
    for node in &boxes {
        flow.set_handle_styles(&node.id, Some(border_handle_style()));
    }

    let report = Report {
        nodes: boxes.len(),
        edges: spec.edges.len(),
        routes: routes_spec.len(),
        extent: plan.extent,
        shared_run: plan.shared_run,
        crossings: plan.crossings,
        touching_bends: plan.touching_bends,
        labels_skipped: plan.labels_skipped,
        labels_placed: plan.labels_placed,
        labels_total: plan.labels_total,
        labels_on_route: plan.labels_on_route,
        labels_ambiguous: plan.labels_ambiguous,
        skipped_labels: plan
            .skipped_labels
            .iter()
            .map(|(index, label)| (format!("e{index}"), label.clone()))
            .collect(),
        groups: spec.groups(),
        pinned: pins.iter().filter(|pin| pin.is_some()).count(),
        pins: conflicts,
        trunks: spec
            .trunks
            .iter()
            .enumerate()
            .map(|(index, trunk)| TrunkReport {
                id: trunk.id.clone(),
                from: trunk.from.clone(),
                to: trunk.to.clone(),
                branches: trunk.branches.len(),
                junctions: plan
                    .trunks
                    .get(index)
                    .map(|routed| routed.junctions.len())
                    .unwrap_or(0),
            })
            .collect(),
        junctions: plan.junctions.len(),
        // A route whose dot span is shorter than the minimum cannot show
        // motion: name it instead of animating it ambiguously.
        short_routes: routes_spec
            .iter()
            .enumerate()
            .filter(|(_, route)| {
                !matches!(route.timing, Timing::Static) && route.dots != DotMode::None
            })
            .filter_map(|(index, route)| {
                let cells = plan.routes.get(index)?.as_ref()?.dot_cells.len();
                (cells < MIN_DOT_CELLS).then(|| ShortRoute {
                    route: format!("e{index}"),
                    from: route.from.clone(),
                    to: route.to.clone(),
                    dot_cells: cells,
                })
            })
            .collect(),
    };
    Ok((flow, report))
}

/// One route the build hands to the router.
struct RoutedEdge {
    from: String,
    to: String,
    label: Option<String>,
    /// True when the spec asked for a horizontal gutter band for this
    /// label (`label_slot`).
    label_slot: bool,
    dots: DotMode,
    dashed: bool,
    timing: Timing,
    role: router::Role,
}

/// Expands the spec into drawable routes: the plain edges, then one corridor
/// plus one spur per branch for every trunk.
fn routed_edges(spec: &Spec) -> Vec<RoutedEdge> {
    let mut out: Vec<RoutedEdge> = spec
        .edges
        .iter()
        .map(|edge| RoutedEdge {
            from: edge.from.clone(),
            to: edge.to.clone(),
            label: edge.label.clone(),
            label_slot: edge.wants_label_slot(),
            dots: edge.dots_mode(),
            dashed: edge.dashed(),
            timing: edge.timing(),
            role: router::Role::Edge,
        })
        .collect();
    for (trunk, spec_trunk) in spec.trunks.iter().enumerate() {
        out.push(RoutedEdge {
            from: spec_trunk.from.clone(),
            to: spec_trunk.to.clone(),
            label: spec_trunk.label.clone(),
            label_slot: false,
            dots: DotMode::None,
            dashed: false,
            timing: Timing::Static,
            role: router::Role::Corridor { trunk },
        });
        for (slot, branch) in spec_trunk.branches.iter().enumerate() {
            out.push(RoutedEdge {
                from: spec_trunk.from.clone(),
                to: branch.clone(),
                label: None,
                label_slot: false,
                dots: DotMode::None,
                dashed: false,
                timing: Timing::Static,
                role: router::Role::Spur { trunk, slot },
            });
        }
    }
    out
}

/// Node geometry in cell units, plus the declared layer (0 when the spec
/// has no explicit layers).
fn node_boxes(flow: &Graph, spec: &Spec) -> Vec<router::NodeBox> {
    let mut layer_of: BTreeMap<&str, usize> = BTreeMap::new();
    for (index, layer) in spec.layers.iter().enumerate() {
        for id in layer {
            if !id.is_empty() {
                layer_of.insert(id.as_str(), index);
            }
        }
    }
    let mut positions: Vec<_> = flow
        .nodes()
        .map(|node| {
            let bounds = node.bounds();
            match spec.direction {
                Direction::TopToBottom => bounds.position.y.round() as i32,
                Direction::LeftToRight => bounds.position.x.round() as i32,
            }
        })
        .collect();
    positions.sort_unstable();
    positions.dedup();
    flow.nodes()
        .map(|node| {
            let bounds = node.bounds();
            let along = match spec.direction {
                Direction::TopToBottom => bounds.position.y,
                Direction::LeftToRight => bounds.position.x,
            }
            .round() as i32;
            router::NodeBox {
                id: node.id.clone(),
                x: bounds.position.x.round() as i32,
                y: bounds.position.y.round() as i32,
                w: bounds.dimensions.width.round() as i32,
                h: bounds.dimensions.height.round() as i32,
                layer: layer_of
                    .get(node.id.as_str())
                    .copied()
                    .unwrap_or_else(|| positions.binary_search(&along).expect("layer")),
            }
        })
        .collect()
}

fn route_from(planned: &router::Planned) -> Route {
    Route::new(
        planned
            .points
            .iter()
            .map(|&(x, y)| (x as f64, y as f64))
            .collect(),
        planned.src.handle(),
        planned.tgt.handle(),
        planned.label.map(|(x, y)| (x as f64, y as f64)),
    )
    .with_junctions(
        planned
            .junctions
            .iter()
            .map(|&(x, y)| (x as f64, y as f64))
            .collect(),
    )
    .with_dot_cells(
        planned
            .dot_cells
            .iter()
            .map(|&(x, y)| (x as f64, y as f64))
            .collect(),
    )
    .with_detached_src(planned.detached_src)
}

/// Position nodes by the spec's `layers` as an explicit grid: each inner
/// array is one layer in declared order, columns are shared across layers,
/// and `""` reserves a slot. This is the round-05 path for a spec that pins
/// every node and asks for nothing structural — a grid is what it declared.
fn place_by_layers(mut nodes: Vec<Node<TextContent>>, spec: &Spec) -> Vec<Node<TextContent>> {
    let max_h = nodes.iter().map(|n| n.height).fold(0.0_f64, f64::max);
    let margin = 1.0;

    let mut slots: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    for (layer_index, layer) in spec.layers.iter().enumerate() {
        for (col, id) in layer.iter().enumerate() {
            if !id.is_empty() {
                slots.insert(id.as_str(), (layer_index, col));
            }
        }
    }

    let tb = matches!(spec.direction, Direction::TopToBottom);
    let col_count = slots.values().map(|&(_, col)| col + 1).max().unwrap_or(1);
    let mut col_size = vec![0.0_f64; col_count];
    for node in &nodes {
        if let Some(&(_, col)) = slots.get(node.id.as_str()) {
            let size = if tb { node.width } else { node.height };
            col_size[col] = col_size[col].max(size);
        }
    }
    let across_gap = if tb { 4.0 } else { 1.0 };
    let mut col_pos = vec![0.0_f64; col_count];
    let mut cursor = margin;
    for col in 0..col_count {
        col_pos[col] = cursor;
        cursor += col_size[col] + across_gap;
    }

    let mut crossing = vec![0usize; spec.layers.len().saturating_sub(1)];
    for edge in &spec.edges {
        if let (Some(&(s, _)), Some(&(t, _))) =
            (slots.get(edge.from.as_str()), slots.get(edge.to.as_str()))
            && s != t
        {
            let (lo, hi) = (s.min(t), s.max(t));
            for gap in lo..hi {
                if gap < crossing.len() {
                    crossing[gap] += 1;
                }
            }
        }
    }
    let max_w = nodes.iter().map(|n| n.width).fold(0.0_f64, f64::max);
    let along_step = if tb { max_h } else { max_w };
    let mut gap_label = vec![0usize; spec.layers.len().saturating_sub(1)];
    for edge in &spec.edges {
        let Some(label) = edge.label.as_deref() else {
            continue;
        };
        if let (Some(&(s, _)), Some(&(t, _))) =
            (slots.get(edge.from.as_str()), slots.get(edge.to.as_str()))
            && s != t
        {
            let (lo, hi) = (s.min(t), s.max(t));
            for gap in lo..hi {
                if gap < gap_label.len() {
                    gap_label[gap] = gap_label[gap].max(label.chars().count());
                }
            }
        }
    }
    let mut along = vec![margin; spec.layers.len()];
    for index in 1..spec.layers.len() {
        let base = 3.0 + (crossing[index - 1] as f64 / 2.0).ceil();
        let channel = if tb {
            base
        } else {
            base.max(gap_label[index - 1] as f64 + 4.0)
        };
        along[index] = along[index - 1] + along_step + channel;
    }

    for node in &mut nodes {
        let Some(&(layer, col)) = slots.get(node.id.as_str()) else {
            continue;
        };
        let span = if tb { node.width } else { node.height };
        let across = (col_pos[col] + (col_size[col] - span) / 2.0).round();
        let (x, y, source, target) = match spec.direction {
            Direction::TopToBottom => (
                across,
                along[layer],
                HandlePosition::Bottom,
                HandlePosition::Top,
            ),
            Direction::LeftToRight => (
                along[layer],
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

/// Places nodes: the engine for anything structural, the round-05 grid for a
/// Places nodes: the engine for anything structural, the round-05 grid for a
/// spec that pins every node and declares no group or `minlen`. Returns the
/// label anchors the engine reserved, keyed by route index, so a
/// `label_slot` label can hand its gutter band to the router.
fn place_nodes(
    nodes: Vec<Node<TextContent>>,
    spec: &Spec,
    pins: &[Option<usize>],
    structured: bool,
    conflicts: &mut Vec<layout::PinConflict>,
) -> (Vec<Node<TextContent>>, LabelAnchors) {
    if structured || spec.layers.is_empty() {
        place_with_engine(nodes, spec, pins, conflicts)
    } else {
        (place_by_layers(nodes, spec), BTreeMap::new())
    }
}

/// The label anchor cells the layout reserved, keyed by route index.
type LabelAnchors = BTreeMap<usize, (i32, i32)>;

/// The label slot the layout reserved for one route, when its spec edge asked
/// for a gutter band. `None` keeps today's behavior: the router finds the
/// label a cell itself.
fn gutter_label(
    index: usize,
    route: &RoutedEdge,
    anchors: &LabelAnchors,
) -> Option<router::LabelSlot> {
    if !route.label_slot {
        return None;
    }
    let label = route.label.as_deref()?;
    let anchor = *anchors.get(&index)?;
    Some(router::LabelSlot {
        anchor,
        width: label.chars().count() as i32,
    })
}

/// Declared rank per node, from the spec's `layers`. A node the spec does
/// not name is left free, so it ranks around the pins instead of being
/// dragged to one.
fn rank_pins(nodes: &[Node<TextContent>], spec: &Spec) -> Vec<Option<usize>> {
    let mut pins = vec![None; nodes.len()];
    for (rank_index, layer) in spec.layers.iter().enumerate() {
        for id in layer {
            if id.is_empty() {
                continue; // "" reserves a slot without pinning a node
            }
            if let Some(index) = nodes.iter().position(|node| node.id == *id) {
                pins[index] = Some(rank_index);
            }
        }
    }
    pins
}

/// Places every node with the layout engine: ranks from `minlen` and the
/// pins, order from the barycenter sweep, then coordinates. Returns the label
/// anchors the engine reserved, per route index.
fn place_with_engine(
    mut nodes: Vec<Node<TextContent>>,
    spec: &Spec,
    pins: &[Option<usize>],
    conflicts: &mut Vec<layout::PinConflict>,
) -> (Vec<Node<TextContent>>, LabelAnchors) {
    let group_of: HashMap<&str, &str> = spec
        .nodes
        .iter()
        .filter_map(|node| Some((node.id.as_str(), node.group.as_deref()?)))
        .collect();
    let layout_nodes: Vec<layout::LayoutNode> = nodes
        .iter()
        .map(|node| layout::LayoutNode {
            id: node.id.clone(),
            w: node.width,
            h: node.height,
            group: group_of
                .get(node.id.as_str())
                .map(|group| group.to_string()),
        })
        .collect();
    // Every drawn route ranks: the spec's edges carry their `minlen`, a
    // trunk's bus and spurs need the default one gap.
    let routes = routed_edges(spec);
    let layout_edges: Vec<layout::LayoutEdge> = routes
        .iter()
        .enumerate()
        .map(|(index, route)| {
            let minlen = match route.role {
                router::Role::Edge => spec.edges.get(index).map(|edge| edge.minlen()).unwrap_or(1),
                router::Role::Corridor { .. } | router::Role::Spur { .. } => 1,
            };
            layout::LayoutEdge {
                from: route.from.clone(),
                to: route.to.clone(),
                label_width: route.label.as_ref().map(|label| label.chars().count()),
                label_gutter: route.label_slot,
                minlen,
            }
        })
        .collect();
    let placement = layout::layout_with(
        &layout_nodes,
        &layout_edges,
        spec.direction,
        &layout::Options::with_pins(pins.to_vec()),
    );
    conflicts.clear();
    conflicts.extend(placement.conflicts.iter().cloned());
    for node in &mut nodes {
        if let Some(&(x, y)) = placement.positions.get(&node.id) {
            node.position = Position::new(x, y);
        }
        match spec.direction {
            Direction::TopToBottom => {
                node.source_position = HandlePosition::Bottom;
                node.target_position = HandlePosition::Top;
            }
            Direction::LeftToRight => {
                node.source_position = HandlePosition::Right;
                node.target_position = HandlePosition::Left;
            }
        }
    }
    (nodes, placement.labels)
}

/// Rows the viewer reserves above the canvas for its header line.
pub const HEADER_HEIGHT: u16 = 1;

/// The zoom every capture proves: the fit is pinned at 100%, so a node box
/// is never shrunk under its own label.
pub const ZOOM_LABEL: &str = "zoom: 1.00 natural";

/// The one-line viewport proof: the drawing area the app measured for
/// itself, chrome already removed, plus the fixed zoom.
pub fn viewport_line(cols: u16, rows: u16) -> String {
    format!("viewport: {cols}x{rows} {ZOOM_LABEL}")
}

/// The same line when no terminal can be measured (`--check`).
pub fn viewport_unknown() -> String {
    format!("viewport: unknown {ZOOM_LABEL}")
}

/// Fits the graph at exactly 100%. Zooming below 1 shrinks a box under its
/// label width and truncates the text, which is worse than letting the human
/// pan; an overflowing graph gets a badge instead.
pub fn fit_natural(flow: &mut Graph) {
    flow.request_fit_view_with_options(FitViewOptions {
        min_zoom: Some(1.0),
        max_zoom: Some(1.0),
        ..FitViewOptions::default()
    });
}

/// How many dots the routes draw, and whether any frame breaks a dot rule.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DotStats {
    /// Routes that keep exactly one dot live (`dots: 1`) and are long enough
    /// to animate.
    pub single: usize,
    /// Routes that draw periodic dots (the default for `flow`) and are long
    /// enough to animate.
    pub periodic: usize,
    /// Routes that broke a rule at least once: not exactly one dot on a
    /// single-dot route, a dot on a corner, junction, crossing, port, or
    /// arrowhead cell, or a dot that does not start at the arrow's origin.
    pub violations: usize,
    /// Animated routes running at a constant rate.
    pub constant: usize,
    /// The rate those routes share, in cells per animation step.
    pub constant_rate: f64,
    /// Animated routes timed by the shared arrival time.
    pub same_arrival: usize,
    /// The arrival time those routes share, in milliseconds.
    pub same_arrival_ms: u64,
    /// Routes whose first dot cell is the first drawn cell after the source
    /// port — including a route whose first drawn cell is a corner glyph.
    pub origins_ok: usize,
    /// Animated routes the origin check looked at.
    pub origins_total: usize,
    /// Same-arrival routes whose dot sits on its arrowhead cell on the final
    /// step, with the head glyph still intact.
    pub arrivals_ok: usize,
    /// Same-arrival routes the arrival check looked at.
    pub arrivals_total: usize,
}

impl Default for DotStats {
    fn default() -> Self {
        Self {
            single: 0,
            periodic: 0,
            violations: 0,
            constant: 0,
            constant_rate: DEFAULT_FLOW_RATE,
            same_arrival: 0,
            same_arrival_ms: DEFAULT_DURATION_MS,
            origins_ok: 0,
            origins_total: 0,
            arrivals_ok: 0,
            arrivals_total: 0,
        }
    }
}

/// Counts dots over `frames` animation steps of the real draw path, at the
/// fixed natural zoom. A dot is attributed to the route whose cells carry
/// it, so a single-dot route that loses its dot to a bridge, or lands it on
/// a forbidden cell, is reported instead of hidden.
///
/// The origin check is real, not decorative: a route whose first dot cell is
/// not the first drawn cell after its source port is counted in
/// [`DotStats::violations`] as well. A span shorter than [`MIN_DOT_CELLS`]
/// cannot animate, so it is neither counted as a single-dot nor as a
/// periodic route; [`Report::short_routes`] names it instead.
pub fn dot_stats(flow: &mut Graph, extent: (i32, i32), frames: usize) -> DotStats {
    fit_natural(flow);
    let width = (extent.0 + 2).max(24) as u16;
    let height = (extent.1 + 2).max(12) as u16;
    let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("headless terminal");
    // One warm-up draw: the pending fit is applied while rendering, and the
    // world-to-terminal mapping is only final afterwards.
    terminal
        .draw(|frame| draw_frame(frame, flow, " ", false))
        .expect("headless draw");

    struct Info {
        single: bool,
        /// Drawable dot cells, for the per-frame expected position.
        dot_len: usize,
        timing: Timing,
        cells: HashSet<(i32, i32)>,
        forbidden: HashSet<(i32, i32)>,
        /// The arrowhead cell, where a same-arrival route must arrive.
        head: Option<(i32, i32)>,
        /// The phase at which this route reaches its arrowhead.
        final_step: Option<usize>,
    }

    let mut infos: Vec<Option<Info>> = Vec::with_capacity(flow.edges().len());
    let mut owners: HashMap<(i32, i32), usize> = HashMap::new();
    let mut violations: HashSet<usize> = HashSet::new();
    let (mut single, mut periodic) = (0, 0);
    let (mut origins_ok, mut origins_total) = (0, 0);
    let (mut arrivals_ok, mut arrivals_total) = (0, 0);
    let mut durations: Vec<u64> = Vec::new();
    let mut rates: Vec<f64> = Vec::new();
    let mut final_phases: HashSet<usize> = HashSet::new();
    for (index, edge) in flow.edges().iter().enumerate() {
        let mode = edge.content.dots_mode();
        let timing = edge.content.timing();
        let Some(route) = edge.content.planned() else {
            infos.push(None);
            continue;
        };
        let terminal_cell = |(x, y): (f64, f64)| flow.world_to_terminal(Position::new(x, y));
        let points: Vec<(i32, i32)> = route
            .points
            .iter()
            .map(|&point| terminal_cell(point))
            .collect();
        let mut cells: HashSet<(i32, i32)> = HashSet::new();
        for window in points.windows(2) {
            let (from, to) = (window[0], window[1]);
            let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
            let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
            for step in 0..=len {
                cells.insert((from.0 + dx * step, from.1 + dy * step));
            }
        }
        let mut forbidden: HashSet<(i32, i32)> = route
            .junctions
            .iter()
            .map(|&junction| terminal_cell(junction))
            .collect();
        // The route's origin is where its dot must start, even when it is a
        // corner glyph, so it is never a forbidden cell.
        let origin = route.origin_cell().map(terminal_cell);
        if let Some(origin) = origin {
            forbidden.remove(&origin);
        }
        // Ports are ends, every other vertex is a corner, the last cell is
        // the arrowhead.
        if let (Some(first), Some(last)) = (points.first(), points.last()) {
            forbidden.insert(*first);
            forbidden.insert(*last);
        }
        if points.len() > 2 {
            for point in &points[1..points.len() - 1] {
                forbidden.insert(*point);
            }
        }
        if let Some(origin) = origin {
            forbidden.remove(&origin);
        }
        for &cell in &cells {
            *owners.entry(cell).or_insert(0) += 1;
        }

        let dot_len = route.dot_cells.len();
        let animating = !matches!(timing, Timing::Static) && mode != DotMode::None;
        if animating && route.points.len() >= 2 {
            // The origin is the first drawn cell after the source port: the
            // very cell the dot train anchors on, measured through the same
            // helper the renderer uses. A dot that starts anywhere else
            // skips its own stem, so it is a violation.
            origins_total += 1;
            let origin = route.origin_cell();
            if origin.is_some() && route.dot_cells.first().copied() == origin {
                origins_ok += 1;
            } else {
                violations.insert(index);
            }
            if dot_len >= MIN_DOT_CELLS {
                match mode {
                    DotMode::Single => single += 1,
                    DotMode::Periodic => periodic += 1,
                    DotMode::None => {}
                }
                match timing {
                    Timing::SameArrival { duration_ms } => durations.push(duration_ms),
                    Timing::Constant(rate) => rates.push(rate),
                    Timing::Static => {}
                }
            }
        }

        // A same-arrival route proves its arrival on the step where its dot
        // index reaches the arrowhead cell: the dot is there, and the head
        // glyph must still be drawn over it.
        let final_step = match timing {
            Timing::SameArrival { duration_ms } if animating && dot_len >= MIN_DOT_CELLS => {
                let steps = (duration_ms / ANIMATION_STEP_MS).max(1) as usize;
                let lands = dot_index(dot_len, timing, steps) == Some(dot_len.saturating_sub(1));
                if lands {
                    arrivals_total += 1;
                }
                lands.then_some(steps)
            }
            _ => None,
        };
        if let Some(step) = final_step {
            final_phases.insert(step);
        }

        infos.push(Some(Info {
            single: mode == DotMode::Single && dot_len >= MIN_DOT_CELLS,
            dot_len,
            timing,
            cells,
            forbidden,
            head: points.last().copied(),
            final_step,
        }));
    }

    // The arrival frames join the ordinary ones: a duration longer than the
    // frame count still gets its final step drawn.
    let mut phases: Vec<usize> = (0..frames).collect();
    for step in final_phases {
        if step >= frames {
            phases.push(step);
        }
    }
    let mut arrived: HashSet<usize> = HashSet::new();
    for phase in phases {
        for (_, content) in flow.edges_content_mut() {
            content.set_phase(phase);
        }
        terminal
            .draw(|frame| draw_frame(frame, flow, " ", false))
            .expect("headless draw");
        let buffer = terminal.backend().buffer();
        let row = buffer.area.width as usize;
        let mut hits: HashMap<usize, usize> = HashMap::new();
        for (index, cell) in buffer.content.iter().enumerate() {
            if cell.symbol() != "●" {
                continue;
            }
            let at = ((index % row) as i32, (index / row) as i32);
            for (edge, info) in infos.iter().enumerate() {
                let Some(info) = info else {
                    continue;
                };
                if !info.cells.contains(&at) {
                    continue;
                }
                *hits.entry(edge).or_insert(0) += 1;
                if info.forbidden.contains(&at) || owners.get(&at).copied().unwrap_or(0) > 1 {
                    violations.insert(edge);
                }
            }
        }
        for (edge, info) in infos.iter().enumerate() {
            let Some(info) = info else {
                continue;
            };
            if !info.single {
                continue;
            }
            // On the step where the dot reaches the arrowhead cell the head
            // glyph covers it, so no visible dot is the correct frame.
            let at_arrow =
                dot_index(info.dot_len, info.timing, phase) == Some(info.dot_len.saturating_sub(1));
            let visible = hits.get(&edge).copied().unwrap_or(0);
            if if at_arrow { visible > 1 } else { visible != 1 } {
                violations.insert(edge);
            }
        }
        // Arrival proof at the render level: on the final step the route's
        // arrowhead cell still carries its direction glyph (the dot sits
        // under it, never erasing it).
        for (edge, info) in infos.iter().enumerate() {
            let Some(info) = info else {
                continue;
            };
            if info.final_step != Some(phase) {
                continue;
            }
            let Some((x, y)) = info.head else {
                continue;
            };
            if x < 0 || y < 0 || x as u16 >= buffer.area.width || y as u16 >= buffer.area.height {
                continue;
            }
            let glyph = buffer[(x as u16, y as u16)].symbol();
            if matches!(glyph, "▲" | "▼" | "▶" | "◀") {
                arrived.insert(edge);
            }
        }
    }
    arrivals_ok = arrivals_ok.max(arrived.len());

    // The shared pace actually in use: the value most routes agree on, so a
    // stray override is visible in the summary.
    let most_common = |values: Vec<u64>, default: u64| {
        values
            .iter()
            .copied()
            .max_by_key(|&ms| (values.iter().filter(|&&other| other == ms).count(), ms))
            .unwrap_or(default)
    };
    let same_arrival = durations.len();
    let same_arrival_ms = most_common(durations, DEFAULT_DURATION_MS);
    let constant_rate = rates
        .iter()
        .copied()
        .reduce(|a, b| if (a - b).abs() < f64::EPSILON { a } else { b })
        .unwrap_or(DEFAULT_FLOW_RATE);

    DotStats {
        single,
        periodic,
        violations: violations.len(),
        constant: rates.len(),
        constant_rate,
        same_arrival,
        same_arrival_ms,
        origins_ok,
        origins_total,
        arrivals_ok,
        arrivals_total,
    }
}

/// Draw one frame: a one-line header, then the graph on a plain canvas.
/// The canvas is a flat fill of the theme background — no dot grid — and
/// node boxes carry the same fill, so borders read as clean lines.
pub fn draw(frame: &mut Frame, flow: &mut Graph, header: &str) {
    draw_frame(frame, flow, header, true);
}

/// Draw one frame without the interaction legend. The legend sits over the
/// bottom-left of the canvas, so a headless measurement of dots must leave
/// it out or it can hide the very dot it is counting.
fn draw_frame(frame: &mut Frame, flow: &mut Graph, header: &str, controls: bool) {
    let areas = Layout::vertical([Constraint::Length(HEADER_HEIGHT), Constraint::Min(0)])
        .split(frame.area());
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
    if controls {
        frame.render_widget(Controls::new(flow), canvas);
    }
    // The minimap earns its corner only when the graph overflows the
    // canvas. When everything fits at the capped zoom it only covers the
    // bottom-right nodes. The fit is capped at 100% so labels never shrink;
    // an overflowing graph says so instead of silently truncating text.
    let (span_x, span_y) = flow.nodes().fold((0.0_f64, 0.0_f64), |acc, node| {
        let bounds = node.bounds();
        (
            acc.0.max(bounds.position.x + bounds.dimensions.width),
            acc.1.max(bounds.position.y + bounds.dimensions.height),
        )
    });
    let overflows = span_x > canvas.width as f64 || span_y > canvas.height as f64;
    if overflows {
        frame.render_widget(MiniMap::new(flow), canvas);
        let warning = "graph overflows · drag to pan";
        let width = warning.chars().count() as u16;
        if canvas.width > width + 2 {
            let area = Rect::new(canvas.x + canvas.width - width - 1, canvas.y, width, 1);
            frame.render_widget(
                Paragraph::new(warning)
                    .style(Style::default().fg(palette.accent).bg(palette.canvas_bg))
                    .alignment(Alignment::Right),
                area,
            );
        }
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
        assert_eq!(s.edges[0].flow_rate(), Some(DEFAULT_FLOW_RATE));
        assert_eq!(DEFAULT_FLOW_RATE, 0.5, "the constant default rate");
        assert_eq!(s.edges[1].flow_rate(), Some(2.5));
        assert_eq!(s.edges[2].flow_rate(), None);
        assert_eq!(s.edges[3].flow_rate(), None);
        assert_eq!(s.flow_count(), 2);
        assert_eq!(
            s.edges[0].timing(),
            Timing::Constant(DEFAULT_FLOW_RATE),
            "flow: true is the constant mode"
        );
        assert_eq!(s.edges[1].timing(), Timing::Constant(2.5));
    }

    #[test]
    fn flow_rejects_zero_and_negative_speeds() {
        let err = Spec::from_json(r#"{"edges":[{"from":"a","to":"b","flow":0}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("flow"), "got: {err:#}");

        let err = Spec::from_json(r#"{"edges":[{"from":"a","to":"b","flow":-1.5}]}"#).unwrap_err();
        assert!(format!("{err:#}").contains("flow"), "got: {err:#}");
    }

    #[test]
    fn a_label_slot_needs_a_label_and_is_parsed_as_a_request() {
        let s = spec(
            r#"{"edges":[{"from":"a","to":"b","label":"wide label","label_slot":true},
                                  {"from":"b","to":"c","label":"plain"},
                                  {"from":"c","to":"d"}]}"#,
        );
        assert!(s.edges[0].wants_label_slot());
        assert!(!s.edges[1].wants_label_slot(), "absent is the default");
        assert!(!s.edges[2].wants_label_slot());

        // A slot with nothing to place is refused instead of becoming a
        // silent no-op field.
        let err = Spec::from_json(r#"{"edges":[{"from":"a","to":"b","label_slot":true}]}"#)
            .expect_err("a slot needs a label");
        let message = format!("{err:#}");
        assert!(message.contains("label_slot"), "got: {message}");
    }

    #[test]
    fn duration_ms_must_be_a_positive_whole_number() {
        let cases = [
            r#"{"edges":[{"from":"a","to":"b","flow":true,"duration_ms":0}]}"#,
            r#"{"edges":[{"from":"a","to":"b","flow":true,"duration_ms":-200}]}"#,
            r#"{"edges":[{"from":"a","to":"b","flow":true,"duration_ms":600.5}]}"#,
            r#"{"edges":[{"from":"a","to":"b","flow":true,"duration_ms":"600"}]}"#,
            // A numeric speed is the unsynchronized escape hatch, so it
            // cannot be combined with a shared duration.
            r#"{"edges":[{"from":"a","to":"b","flow":0.5,"duration_ms":600}]}"#,
            r#"{"edges":[{"from":"a","to":"b","flow":false,"duration_ms":600}]}"#,
        ];
        for json in cases {
            let err = Spec::from_json(json).expect_err(&format!("must reject: {json}"));
            let message = format!("{err:#}");
            assert!(
                message.contains("duration_ms"),
                "message {message:?} does not name the field for {json}"
            );
        }
    }

    #[test]
    fn flow_true_is_constant_and_same_arrival_is_the_opt_in() {
        let err =
            Spec::from_json(r#"{"edges":[{"from":"a","to":"b","duration_ms":750}]}"#).unwrap_err();
        assert!(
            format!("{err:#}").contains("duration_ms"),
            "a bare duration_ms must be rejected by name: {err:#}"
        );
        let s = spec(
            r#"{"edges":[{"from":"a","to":"b","flow":true},
                         {"from":"b","to":"c"},
                         {"from":"c","to":"d","flow":true,"timing":"same-arrival","duration_ms":750},
                         {"from":"d","to":"e","flow":2}]}"#,
        );
        assert_eq!(s.edges[0].timing(), Timing::Constant(DEFAULT_FLOW_RATE));
        assert_eq!(s.edges[0].duration_ms(), DEFAULT_DURATION_MS);
        assert_eq!(s.edges[1].timing(), Timing::Static);
        assert_eq!(
            s.edges[2].timing(),
            Timing::SameArrival { duration_ms: 750 },
            "same-arrival plus duration_ms animates on the shared clock"
        );
        assert_eq!(s.edges[3].timing(), Timing::Constant(2.0));
        assert_eq!(s.edges[3].flow_rate(), Some(2.0));
        assert_eq!(s.flow_count(), 3);
        assert_eq!(s.same_arrival_count(), 1);
        assert_eq!(DEFAULT_DURATION_MS, 2000);
        // `same-arrival` without a duration uses the documented default.
        let s = spec(
            r#"{"edges":[{"from":"a","to":"b","flow":true,"timing":"same-arrival",
                          "duration_ms":null}]}"#,
        );
        assert_eq!(
            s.edges[0].timing(),
            Timing::SameArrival {
                duration_ms: DEFAULT_DURATION_MS
            }
        );
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
