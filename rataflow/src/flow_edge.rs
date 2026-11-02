//! FlowEdge — the edge content rataflow-view renders: an orthogonal
//! polyline that follows the router's plan, optionally carrying live dots
//! that travel source → target.
//!
//! The line is drawn as a set of direction bits per grid cell and merged
//! through one explicit box-drawing table. Independent routes never merge
//! into tees: a perpendicular crossing uses a bridge (`⌒`), not a junction.
//! Corners are combined only within a single route.
//!
//! rataflow's own `Edge::animated` renders marching ants at one global
//! speed, and its animation phase is crate-private, so rataflow-view owns
//! the clock instead: the app advances an unbounded phase counter and
//! pushes it into every edge once per frame.
//!
//! Two motion modes exist. **Constant** is the default: `flow: true` (and a
//! numeric `flow` speed) move every dot at a fixed number of cells per
//! animation step, so a long route finishes later than a short one — that is
//! correct, not a defect. **Same-arrival** is opt-in
//! (`timing: "same-arrival"` + `flow: true`): every route starts at phase 0
//! and reaches its arrowhead after the shared [`DEFAULT_DURATION_MS`],
//! whatever its length.

use crate::ANIMATION_STEP_MS;
use rataflow::{EdgeContent, EdgePathContext, EdgeRenderContext, Path, Position, StepEdge};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use std::collections::HashSet;

/// Dots space themselves at least this many cells apart, so a slow edge
/// does not turn its line into a beaded chain.
const MIN_DOT_SPACING: f64 = 7.0;

/// Extra spacing per speed unit.
const DOT_SPACING_PER_SPEED: f64 = 3.0;

/// The glyph drawn for a flowing dot.
const DOT: char = '●';

/// A route needs at least this many drawable dot cells to show motion. A
/// shorter one is reported by `--check` instead of being animated
/// ambiguously.
pub const MIN_DOT_CELLS: usize = 3;

/// The speed of a constant route when the spec only says `flow: true`:
/// cells travelled per [`ANIMATION_STEP_MS`] step (0.5 cells / 100 ms).
pub const DEFAULT_FLOW_RATE: f64 = 0.5;

/// The shared duration of a same-arrival route: every one of them leaves
/// its source and reaches its arrowhead inside the same number of
/// milliseconds, whatever its length.
pub const DEFAULT_DURATION_MS: u64 = 2000;

/// A region: the bordered, titled box a group draws around its members.
/// Coordinates are graph cells at zoom 1, and the rectangle covers the
/// border cells (so `w` counts the two side borders).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    /// The group name: the region's title and the source of its hue.
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Region {
    /// A region box around the given member bounds (inclusive cells).
    pub fn around(name: impl Into<String>, left: i32, top: i32, right: i32, bottom: i32) -> Self {
        // One border cell on each side, kept inside the canvas.
        let x = (left - 1).max(0);
        let y = (top - 1).max(0);
        Self {
            name: name.into(),
            x,
            y,
            w: right + 2 - x,
            h: bottom + 2 - y,
        }
    }
}

/// The router's plan for one edge, in world coordinates (one world unit is
/// one terminal cell at zoom 1).
#[derive(Debug, Clone)]
pub struct Route {
    /// Polyline from the cell outside the source border to the cell
    /// outside the target border.
    pub points: Vec<(f64, f64)>,
    /// Side the edge leaves the source on.
    pub src: rataflow::HandlePosition,
    /// Side the edge enters the target on.
    pub tgt: rataflow::HandlePosition,
    /// Centre cell for the edge label, when one fits.
    pub label: Option<(f64, f64)>,
    /// Cells where a trunk spur leaves this route: they connect instead of
    /// bridging, and no dot may cover them.
    pub junctions: Vec<(f64, f64)>,
    /// Cells a dot may sit on, in travel order: the cell just outside the
    /// source port first, the arrowhead cell last. Corners, junctions, and
    /// cells another route bridges over are left out. The arrowhead cell is
    /// the arrival cell, and the head glyph is painted over it, so a dot
    /// never covers the arrow.
    pub dot_cells: Vec<(f64, f64)>,
    /// True for a trunk spur, whose first point floats on the corridor
    /// instead of sitting on the source node's border.
    pub detached_src: bool,
}

impl Route {
    pub fn new(
        points: Vec<(f64, f64)>,
        src: rataflow::HandlePosition,
        tgt: rataflow::HandlePosition,
        label: Option<(f64, f64)>,
    ) -> Self {
        Self {
            points,
            src,
            tgt,
            label,
            junctions: Vec::new(),
            dot_cells: Vec::new(),
            detached_src: false,
        }
    }

    /// Sets the junction cells this route draws as connected.
    pub fn with_junctions(mut self, junctions: Vec<(f64, f64)>) -> Self {
        self.junctions = junctions;
        self
    }

    /// Sets the cells a single dot may occupy.
    pub fn with_dot_cells(mut self, dot_cells: Vec<(f64, f64)>) -> Self {
        self.dot_cells = dot_cells;
        self
    }

    /// Marks the route as starting off-node, as a trunk spur does.
    pub fn with_detached_src(mut self, detached: bool) -> Self {
        self.detached_src = detached;
        self
    }

    /// The route's first drawn cell — see [`origin_cell`].
    pub fn origin_cell(&self) -> Option<(f64, f64)> {
        origin_cell(&self.points, &self.junctions)
    }

    /// The terminal cells a dot may rest on, in travel order. Index 0 is
    /// always [`Route::origin_cell`], so the frame-0 dot sits on the route's
    /// FIRST drawn cell for a single dot and for a train alike, instead of
    /// one cell downstream of it.
    pub fn dot_span(&self, to_terminal: impl Fn(f64, f64) -> (i32, i32)) -> Vec<(i32, i32)> {
        let mut span: Vec<(i32, i32)> = Vec::new();
        if let Some((x, y)) = self.origin_cell() {
            span.push(to_terminal(x, y));
        }
        for &(x, y) in &self.dot_cells {
            let cell = to_terminal(x, y);
            if span.last() != Some(&cell) {
                span.push(cell);
            }
        }
        span
    }
}

/// The route's origin: its FIRST drawn cell — the cell immediately outside
/// the source border, which the renderer paints as the start of the stroke.
///
/// This is the cell a dot train starts on, the cell a single dot rests on at
/// frame 0, and the cell `--check` measures for `origins:`, so the check
/// line and the rendered pixels agree by construction instead of each
/// picking its own cell. The round-08 pixel evidence on `dots: 1` routes
/// (cli→api port `(37,4)`, painted stem `(37,5)`, dot wrongly at `(37,6)`)
/// was exactly this: the dot started one cell late because the origin was
/// read as the cell after the stem instead of the stem itself.
///
/// A trunk spur starts ON its corridor, at a junction cell that must keep
/// its glyph, so its origin is the first cell after it.
pub fn origin_cell(points: &[(f64, f64)], junctions: &[(f64, f64)]) -> Option<(f64, f64)> {
    points
        .iter()
        .find(|cell| !junctions.contains(cell))
        .copied()
}

/// How a route's dots are timed.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub enum Timing {
    /// The edge carries no live dot.
    #[default]
    Static,
    /// The default. `flow: true` gives [`DEFAULT_FLOW_RATE`]; a numeric
    /// `flow: <positive number>` gives that rate instead. The dot travels
    /// `rate` cells per [`ANIMATION_STEP_MS`] step, so a long route finishes
    /// later than a short one — never sped up to finish together unasked.
    Constant(f64),
    /// Opt-in, `timing: "same-arrival"` plus `flow: true`: every route runs
    /// its drawable span once per `duration_ms`, so all of them start
    /// together and reach their arrowhead on the same step.
    SameArrival { duration_ms: u64 },
}

impl Timing {
    /// True when this timing is the shared-duration opt-in.
    pub fn is_same_arrival(self) -> bool {
        matches!(self, Timing::SameArrival { .. })
    }

    /// The shared duration, for the `--check` summary.
    pub fn duration_ms(self) -> Option<u64> {
        match self {
            Timing::SameArrival { duration_ms } => Some(duration_ms),
            _ => None,
        }
    }

    /// The constant speed in cells per animation step, when this route uses
    /// the constant mode.
    pub fn rate(self) -> Option<f64> {
        match self {
            Timing::Constant(rate) => Some(rate),
            _ => None,
        }
    }
}

/// The dot index at `phase` for a route with `cells` drawable dot cells, or
/// `None` when the span is too short to animate (fewer than
/// [`MIN_DOT_CELLS`]).
///
/// A same-arrival route walks its span by progress, not by cells: on step
/// `i` of `steps = duration_ms / ANIMATION_STEP_MS` it sits at
/// `round(i × (cells - 1) / steps)`, so index 0 (the source stem) is on step
/// 0 and index `cells - 1` (the arrowhead cell) is on the final step, after
/// which the cycle repeats. A constant route advances `rate` cells per step
/// and wraps before the arrowhead cell, so its head stays visible.
pub fn dot_index(cells: usize, timing: Timing, phase: usize) -> Option<usize> {
    if cells < MIN_DOT_CELLS {
        return None;
    }
    let last = cells - 1;
    let index = match timing {
        Timing::Static => 0,
        Timing::Constant(rate) => {
            // Distance travelled, floored to the cell the dot sits on. A
            // rate below one cell per step therefore holds a cell for
            // several steps, which is what a slow constant speed means.
            let travelled = (phase as f64 * rate.max(0.0)).floor();
            if travelled < 1.0 {
                0
            } else {
                (travelled as usize) % last
            }
        }
        Timing::SameArrival { duration_ms } => {
            let steps = (duration_ms / ANIMATION_STEP_MS).max(1) as usize;
            let step = phase % (steps + 1);
            // round(step × last / steps), in integer arithmetic.
            (step * last + steps / 2) / steps
        }
    };
    Some(index.min(last))
}

/// How many cells apart a same-arrival route's periodic dots sit.
fn dot_period(cells: usize) -> usize {
    (cells / 3).clamp(MIN_DOT_CELLS, MIN_DOT_SPACING as usize)
}

/// How many dots a route draws at once.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum DotMode {
    /// The default: dots spaced along the route, moving with the phase.
    #[default]
    Periodic,
    /// `dots: 0` — no dot at all, even with `flow` set.
    None,
    /// `dots: 1` — exactly one dot, cycling along the route.
    Single,
}

/// An edge that renders as a routed orthogonal line and, when flowing,
/// draws animated dots along it.
#[derive(Debug, Clone, Default)]
pub struct FlowEdge {
    step: StepEdge,
    /// How the dots are timed: static, the legacy speed escape hatch, or the
    /// shared default duration.
    timing: Timing,
    phase: usize,
    route: Option<Route>,
    dots: DotMode,
    dashed: bool,
    /// The group regions this drawing carries, shared by every edge so the
    /// frame can draw the boxes behind the nodes without a second channel.
    regions: Option<std::sync::Arc<Vec<Region>>>,
}

impl FlowEdge {
    /// A static edge.
    pub fn plain() -> Self {
        Self::default()
    }

    /// A constant edge: dots travelling `rate` cells per animation step.
    pub fn constant(rate: f64) -> Self {
        Self {
            timing: Timing::Constant(rate),
            ..Self::default()
        }
    }

    /// A same-arrival edge: the dot span runs once per `duration_ms`, so
    /// every such route starts and arrives on the same step.
    pub fn same_arrival(duration_ms: u64) -> Self {
        Self {
            timing: Timing::SameArrival { duration_ms },
            ..Self::default()
        }
    }

    /// Switches the route to same-arrival timing, keeping any other setting.
    pub fn with_duration_ms(mut self, duration_ms: u64) -> Self {
        self.timing = Timing::SameArrival { duration_ms };
        self
    }

    /// Chooses how many dots the route draws at once.
    pub fn with_dots(mut self, dots: DotMode) -> Self {
        self.dots = dots;
        self
    }

    /// Draws the straight spans with dashed line glyphs: for a fact that is
    /// not confirmed yet.
    pub fn with_dashed(mut self, dashed: bool) -> Self {
        self.dashed = dashed;
        self
    }

    /// How many dots this route draws at once.
    pub fn dots_mode(&self) -> DotMode {
        self.dots
    }

    /// True when the route was declared with a flow.
    pub fn is_flowing(&self) -> bool {
        !matches!(self.timing, Timing::Static)
    }

    /// How this route's dots are timed.
    pub fn timing(&self) -> Timing {
        self.timing
    }

    /// The shared duration this route uses, when it is same-arrival.
    pub fn same_arrival_ms(&self) -> Option<u64> {
        self.timing.duration_ms()
    }

    /// True when the route draws dashed straight spans.
    pub fn dashed(&self) -> bool {
        self.dashed
    }

    /// Attaches the router's plan; without one the library's step router
    /// draws the edge.
    pub fn with_route(mut self, route: Route) -> Self {
        self.route = Some(route);
        self
    }

    /// Attaches the drawing's region boxes; every edge carries the same
    /// shared list, so the frame can draw them without another channel.
    pub fn with_regions(mut self, regions: std::sync::Arc<Vec<Region>>) -> Self {
        self.regions = Some(regions);
        self
    }

    /// The region boxes this drawing carries, when the spec declares groups.
    pub fn regions(&self) -> Option<&[Region]> {
        self.regions.as_deref().map(Vec::as_slice)
    }

    /// Replaces the region boxes in place.
    pub fn set_regions(&mut self, regions: std::sync::Arc<Vec<Region>>) {
        self.regions = Some(regions);
    }

    /// Replaces the attached plan in place.
    pub fn set_route(&mut self, route: Route) {
        self.route = Some(route);
    }

    /// Sets the animation phase; dot positions derive from it.
    pub fn set_phase(&mut self, phase: usize) {
        self.phase = phase;
    }

    /// The planned label cell, if one exists.
    pub fn label_cell(&self) -> Option<(f64, f64)> {
        self.route.as_ref().and_then(|route| route.label)
    }

    /// The router's plan, for tests and diagnostics.
    pub fn planned(&self) -> Option<&Route> {
        self.route.as_ref()
    }
}

impl EdgeContent for FlowEdge {
    fn compute_path(&self, ctx: &EdgePathContext) -> Path {
        match self.route {
            Some(ref route) if route_points_apply(route, ctx) => Path::new(
                route
                    .points
                    .iter()
                    .map(|&(x, y)| Position::new(x, y))
                    .collect(),
                route.src,
                route.tgt,
            ),
            _ => self.step.compute_path(ctx),
        }
    }

    fn render(&self, ctx: &EdgeRenderContext, buf: &mut Buffer) {
        let palette = ctx.theme.palette();
        let stroke = Style::default().fg(if ctx.selected {
            palette.accent
        } else {
            edge_stroke()
        });
        let Some(path) = terminal_path(ctx) else {
            self.step.render(ctx, buf);
            return;
        };
        let junctions: HashSet<(i32, i32)> = self
            .route
            .as_ref()
            .map(|route| {
                route
                    .junctions
                    .iter()
                    .map(|&(x, y)| ctx.world_to_terminal(Position::new(x, y)))
                    .collect()
            })
            .unwrap_or_default();
        draw_line(&path, stroke, self.dashed, &junctions, buf);

        let arrow = arrow_cell(&path).filter(|&(cell, _)| in_area(buf.area, cell));
        let dot_style = Style::default().fg(palette.accent);
        // One span, one origin: it starts on the route's first drawn cell,
        // measured through the same helper the check uses, so a single dot
        // and a same-arrival train both begin where the pixels begin.
        let cells: Vec<(i32, i32)> = self
            .route
            .as_ref()
            .map(|route| route.dot_span(|x, y| ctx.world_to_terminal(Position::new(x, y))))
            .unwrap_or_default();
        let junction_cells: Vec<(i32, i32)> = junctions.iter().copied().collect();
        let head = arrow.map(|(cell, _)| cell);
        // A route too short to show motion is drawn static: `--check` names
        // it instead of animating it ambiguously.
        let animatable = cells.len() >= MIN_DOT_CELLS && !matches!(self.timing, Timing::Static);
        match self.dots {
            DotMode::None => {}
            // One dot per route, cycling over the cells the router cleared
            // for it: never a corner, bridge, junction, or port. A
            // synchronized route walks the span by progress, so every route
            // reaches its arrowhead cell on the same step.
            DotMode::Single => {
                if let Some(index) = dot_index(cells.len(), self.timing, self.phase) {
                    draw_single_dot(&cells, index, dot_style, head, buf);
                }
            }
            DotMode::Periodic => match self.timing {
                Timing::Static => {}
                Timing::Constant(rate) if animatable => {
                    draw_dots(
                        &path,
                        &junction_cells,
                        rate,
                        self.phase,
                        dot_style,
                        head,
                        buf,
                    );
                }
                Timing::Constant(_) => {}
                Timing::SameArrival { .. } => {
                    draw_same_arrival_dots(&cells, self.timing, self.phase, dot_style, head, buf);
                }
            },
        }

        // The head is painted last: a dot that has reached the arrowhead
        // cell is absorbed by it instead of erasing the direction glyph.
        if let Some((cell, dir)) = arrow {
            buf[(cell.0 as u16, cell.1 as u16)]
                .set_char(arrow_char(dir))
                .set_style(stroke);
        }

        if let Some(anchor) = self.label_cell() {
            let (lx, ly) = ctx.world_to_terminal(Position::new(anchor.0, anchor.1));
            if let Some(label) = ctx.label {
                draw_label(
                    label,
                    lx,
                    ly,
                    Style::default().fg(palette.text),
                    buf.area,
                    buf,
                );
            }
        }
    }
}

/// The muted stroke every unselected edge uses.
pub fn edge_stroke() -> Color {
    // gruvbox bg4 — dimmer than a node border, so edges recede.
    Color::Rgb(124, 111, 100)
}

/// True while the planned route still matches the nodes it was built for.
/// A dragged node changes the bounds, and the edge falls back to the
/// library router so it keeps following its node.
fn route_points_apply(route: &Route, ctx: &EdgePathContext) -> bool {
    let (Some(&first), Some(&last)) = (route.points.first(), route.points.last()) else {
        return false;
    };
    let source_ok = route.detached_src || on_side(first, &ctx.source_bounds, route.src);
    source_ok
        && match ctx.target_bounds {
            Some(ref bounds) => on_side(last, bounds, route.tgt),
            None => false,
        }
}

fn on_side(point: (f64, f64), bounds: &rataflow::Rect, side: rataflow::HandlePosition) -> bool {
    let (x0, y0) = (bounds.position.x, bounds.position.y);
    let (w, h) = (bounds.dimensions.width, bounds.dimensions.height);
    let near = |a: f64, b: f64| (a - b).abs() < 0.9;
    match side {
        rataflow::HandlePosition::Top => {
            near(point.1, y0 - 1.0) && point.0 >= x0 - 0.5 && point.0 <= x0 + w + 0.5
        }
        rataflow::HandlePosition::Bottom => {
            near(point.1, y0 + h) && point.0 >= x0 - 0.5 && point.0 <= x0 + w + 0.5
        }
        rataflow::HandlePosition::Left => {
            near(point.0, x0 - 1.0) && point.1 >= y0 - 0.5 && point.1 <= y0 + h + 0.5
        }
        rataflow::HandlePosition::Right => {
            near(point.0, x0 + w) && point.1 >= y0 - 0.5 && point.1 <= y0 + h + 0.5
        }
    }
}

/// Terminal-space polyline for the edge. `None` when the path is not
/// orthogonal, in which case the library renderer takes over.
fn terminal_path(ctx: &EdgeRenderContext) -> Option<Vec<(i32, i32)>> {
    let points: Vec<(i32, i32)> = ctx
        .path
        .points
        .iter()
        .map(|p| ctx.world_to_terminal(*p))
        .collect();
    if points.len() < 2 {
        return None;
    }
    if points.windows(2).any(|w| {
        let (from, to) = (w[0], w[1]);
        from != to && (from.0 != to.0 && from.1 != to.1)
    }) {
        return None;
    }
    // Drop duplicate cells left by rounding.
    let mut out: Vec<(i32, i32)> = Vec::with_capacity(points.len());
    for point in points {
        if out.last() != Some(&point) {
            out.push(point);
        }
    }
    (out.len() >= 2).then_some(out)
}

/// Direction bit of a step: 0 up, 1 right, 2 down, 3 left.
fn step_dir(from: (i32, i32), to: (i32, i32)) -> usize {
    if to.0 > from.0 {
        1
    } else if to.0 < from.0 {
        3
    } else if to.1 > from.1 {
        2
    } else {
        0
    }
}

const U_BIT: u8 = 1;
const R_BIT: u8 = 2;
const D_BIT: u8 = 4;
const L_BIT: u8 = 8;

fn dir_bit(dir: usize) -> u8 {
    match dir {
        0 => U_BIT,
        1 => R_BIT,
        2 => D_BIT,
        _ => L_BIT,
    }
}

/// Draws the whole polyline: every cell accumulates the directions it
/// connects, then one glyph per cell is merged into the buffer. `junctions`
/// marks cells where a trunk spur leaves this route; those connect instead
/// of bridging. `dashed` swaps straight spans for dashed line glyphs and
/// leaves corners and arrowheads alone.
fn draw_line(
    points: &[(i32, i32)],
    style: Style,
    dashed: bool,
    junctions: &HashSet<(i32, i32)>,
    buf: &mut Buffer,
) {
    let area = buf.area;
    let mut bits: Vec<((i32, i32), u8)> = Vec::new();
    for w in points.windows(2) {
        let (from, to) = (w[0], w[1]);
        let dir = step_dir(from, to);
        let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
        let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
        let back = dir_bit((dir + 2) % 4);
        let ahead = dir_bit(dir);
        for step in 0..=len {
            let cell = (from.0 + dx * step, from.1 + dy * step);
            if !in_area(area, cell) {
                continue;
            }
            // Interior cells connect both ways; the two ends connect only
            // toward the segment. A bend accumulates both neighbors.
            let mut bit = 0;
            if step > 0 {
                bit |= back;
            }
            if step < len {
                bit |= ahead;
            }
            match bits.iter_mut().find(|(existing, _)| *existing == cell) {
                Some(entry) => entry.1 |= bit,
                None => bits.push((cell, bit)),
            }
        }
    }
    for (cell, add) in bits {
        merge_cell(cell, add, style, dashed, junctions, buf);
    }
}

/// Merges a direction set into one cell, using explicit box-drawing
/// connectivity rather than a generic text merge.
fn merge_cell(
    cell: (i32, i32),
    add: u8,
    style: Style,
    dashed: bool,
    junctions: &HashSet<(i32, i32)>,
    buf: &mut Buffer,
) {
    let current = buf[(cell.0 as u16, cell.1 as u16)].symbol().to_string();
    // Never paint over text: a label cell is not part of any route, but a
    // rounding shift could still land one here.
    if current.chars().any(|ch| ch.is_alphanumeric()) {
        return;
    }
    let existing = symbol_bits(&current);
    let glyph = if junctions.contains(&cell) {
        // A trunk spur leaves here: the two strokes connect, so this is a
        // junction (┬ ┴ ├ ┤) whatever order the routes were drawn in.
        glyph_for(existing | add)
    } else if existing != 0 || current == "●" || current == "⌒" {
        // The router allows only straight perpendicular intersections. A
        // bridge explicitly means non-connection, regardless of edge draw
        // order. A dot from the earlier edge is also an occupied stroke,
        // not empty canvas.
        '⌒'
    } else if dashed && add & (U_BIT | D_BIT) == 0 {
        // A straight horizontal span, including the one-cell port stem.
        '╌'
    } else if dashed && add & (L_BIT | R_BIT) == 0 {
        '╎'
    } else {
        glyph_for(add)
    };
    buf[(cell.0 as u16, cell.1 as u16)]
        .set_char(glyph)
        .set_style(style);
}

fn symbol_bits(symbol: &str) -> u8 {
    match symbol {
        "─" | "╌" => L_BIT | R_BIT,
        "│" | "╎" => U_BIT | D_BIT,
        "╭" => R_BIT | D_BIT,
        "╮" => L_BIT | D_BIT,
        "╯" => L_BIT | U_BIT,
        "╰" => R_BIT | U_BIT,
        "┬" => L_BIT | R_BIT | D_BIT,
        "┴" => L_BIT | R_BIT | U_BIT,
        "├" => U_BIT | D_BIT | R_BIT,
        "┤" => U_BIT | D_BIT | L_BIT,
        "┼" => L_BIT | R_BIT | U_BIT | D_BIT,
        _ => 0,
    }
}

fn glyph_for(bits: u8) -> char {
    match bits {
        b if b == (L_BIT | R_BIT) => '─',
        b if b == (U_BIT | D_BIT) => '│',
        b if b == L_BIT || b == R_BIT => '─',
        b if b == U_BIT || b == D_BIT => '│',
        b if b == (L_BIT | D_BIT) => '╮',
        b if b == (L_BIT | U_BIT) => '╯',
        b if b == (R_BIT | D_BIT) => '╭',
        b if b == (R_BIT | U_BIT) => '╰',
        b if b == (L_BIT | R_BIT | D_BIT) => '┬',
        b if b == (L_BIT | R_BIT | U_BIT) => '┴',
        b if b == (U_BIT | D_BIT | R_BIT) => '├',
        b if b == (U_BIT | D_BIT | L_BIT) => '┤',
        _ => '┼',
    }
}

/// The cell and direction of the arrowhead: the last cell of the path and
/// the direction the final segment travels.
fn arrow_cell(points: &[(i32, i32)]) -> Option<((i32, i32), usize)> {
    let last = *points.last()?;
    let prev = *points.get(points.len().saturating_sub(2))?;
    if last == prev {
        return None;
    }
    // The endpoint is reserved, immediately outside the target border.
    // Even a one-step stem needs its head; never detach it from the target.
    Some((last, step_dir(prev, last)))
}

fn arrow_char(dir: usize) -> char {
    match dir {
        0 => '▲',
        1 => '▶',
        2 => '▼',
        _ => '◀',
    }
}

/// One live dot at `index` of the route's cleared dot cells. The caller
/// guarantees the cells exclude corners, junctions, crossings, and ports, so
/// this only has to stay off an occupied glyph and off the arrowhead.
fn draw_single_dot(
    cells: &[(i32, i32)],
    index: usize,
    style: Style,
    arrow: Option<(i32, i32)>,
    buf: &mut Buffer,
) {
    let Some(&cell) = cells.get(index) else {
        return;
    };
    if !in_area(buf.area, cell) || Some(cell) == arrow {
        return;
    }
    let (ux, uy) = (cell.0 as u16, cell.1 as u16);
    let current = buf[(ux, uy)].symbol();
    if current == "⌒" || symbol_bits(current).count_ones() >= 3 {
        return; // never overwrite a bridge or a junction
    }
    buf[(ux, uy)].set_char(DOT).set_style(style);
}

/// A same-arrival route's periodic dots: a train on the cleared span whose
/// leading dot is at the same progress index a single dot would use, so the
/// whole route is traversed once per duration. A dot that has reached the
/// arrowhead cell is left to the head glyph.
fn draw_same_arrival_dots(
    cells: &[(i32, i32)],
    timing: Timing,
    phase: usize,
    style: Style,
    arrow: Option<(i32, i32)>,
    buf: &mut Buffer,
) {
    let Some(lead) = dot_index(cells.len(), timing, phase) else {
        return;
    };
    let period = dot_period(cells.len());
    let mut index = lead;
    while index < cells.len() {
        draw_single_dot(cells, index, style, arrow, buf);
        index += period;
    }
}

/// Flow dots, spaced so the line stays readable.
fn draw_dots(
    points: &[(i32, i32)],
    junctions: &[(i32, i32)],
    speed: f64,
    phase: usize,
    style: Style,
    arrow: Option<(i32, i32)>,
    buf: &mut Buffer,
) {
    let area = buf.area;
    // The train is anchored on the route's origin — its first drawn cell,
    // the very cell `--check` measures — so phase 0 puts a dot there instead
    // of one cell downstream of it. A detached spur's origin is one cell
    // into its polyline (the junction it leaves), so distances start there.
    let origin = origin_cell(
        &points
            .iter()
            .map(|&(x, y)| (x as f64, y as f64))
            .collect::<Vec<_>>(),
        &junctions
            .iter()
            .map(|&(x, y)| (x as f64, y as f64))
            .collect::<Vec<_>>(),
    )
    .map(|(x, y)| (x as i32, y as i32));
    let behind = points
        .iter()
        .take_while(|cell| junctions.contains(cell))
        .count() as i32;
    let offset = phase as f64 * speed;
    let total: i32 = points
        .windows(2)
        .map(|w| (w[1].0 - w[0].0).abs() + (w[1].1 - w[0].1).abs())
        .sum();
    // Nominal spacing, shortened on a short edge so it still shows a dot.
    // It must stay above `speed`, or each step lands on the previous dot
    // set and the train looks frozen.
    let mut spacing = MIN_DOT_SPACING.max(DOT_SPACING_PER_SPEED * speed);
    if spacing > total as f64 / 2.0 {
        spacing = (total as f64 / 2.0).max(speed * 1.5 + 0.5);
    }
    let first = points[0];
    let last = *points.last().expect("checked len >= 2");
    // Corners read as a bend, not as a place for a dot.
    let corners: HashSet<(i32, i32)> = points
        .iter()
        .skip(1)
        .take(points.len().saturating_sub(2))
        .copied()
        .collect();
    let mut traveled: i32 = 0;
    for w in points.windows(2) {
        let (from, to) = (w[0], w[1]);
        let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
        let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
        for step in 0..len {
            let cell = (from.0 + dx * step, from.1 + dy * step);
            // Distances count from the origin, so the origin cell itself is
            // distance 0 and the train starts on it at phase 0.
            let distance = traveled + step - behind;
            // The origin stays a dot cell: it is where the route starts, so
            // the dot cannot begin later.
            let is_origin = Some(cell) == origin;
            if (cell == first && !is_origin) || cell == last || Some(cell) == arrow {
                continue;
            }
            if corners.contains(&cell) && !is_origin {
                continue;
            }
            let on_dot = (distance as f64 - offset).rem_euclid(spacing) < 1.0;
            if !on_dot || !in_area(area, cell) {
                continue;
            }
            let ux = cell.0 as u16;
            let uy = cell.1 as u16;
            // A dot on a junction would read as a schematic connection
            // dot; keep the junction glyph instead.
            if !is_origin
                && (buf[(ux, uy)].symbol() == "⌒"
                    || symbol_bits(buf[(ux, uy)].symbol()).count_ones() >= 3)
            {
                continue;
            }
            buf[(ux, uy)].set_char(DOT).set_style(style);
        }
        traveled += len;
    }
}

/// True when `(x, y)` falls inside `area`.
fn in_area(area: Rect, cell: (i32, i32)) -> bool {
    cell.0 >= area.x as i32
        && cell.0 < (area.x + area.width) as i32
        && cell.1 >= area.y as i32
        && cell.1 < (area.y + area.height) as i32
}

/// Draws a single-line label centered on `(x, y)`, clipped to `area`.
fn draw_label(label: &str, x: i32, y: i32, style: Style, area: Rect, buf: &mut Buffer) {
    let x_min = area.x as i32;
    let y_min = area.y as i32;
    let y_max = (area.y + area.height) as i32;
    if y < y_min || y >= y_max {
        return;
    }
    let char_count = label.chars().count() as i32;
    let line_x = x - char_count / 2;
    let clip_start = (x_min - line_x).max(0) as usize;
    if clip_start >= char_count as usize {
        return;
    }
    let clipped: String = label.chars().skip(clip_start).collect();
    if !clipped.is_empty() {
        buf.set_string(line_x.max(x_min) as u16, y as u16, &clipped, style);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_merge_from_connectivity() {
        let mut bits = R_BIT;
        bits |= D_BIT;
        assert_eq!(glyph_for(bits), '╭');
        assert_eq!(glyph_for(R_BIT | U_BIT), '╰');
        assert_eq!(glyph_for(L_BIT | D_BIT), '╮');
        assert_eq!(glyph_for(U_BIT | L_BIT), '╯');
    }

    #[test]
    fn crossings_and_tees_are_distinct() {
        assert_eq!(glyph_for(L_BIT | R_BIT | U_BIT | D_BIT), '┼');
        assert_eq!(glyph_for(L_BIT | R_BIT | D_BIT), '┬');
        assert_eq!(glyph_for(U_BIT | D_BIT | R_BIT), '├');
    }

    #[test]
    fn crossings_are_bridges_in_both_draw_orders_even_with_dots() {
        let horizontal = [(1, 4), (9, 4)];
        let vertical = [(5, 1), (5, 8)];
        for (first, second) in [(horizontal, vertical), (vertical, horizontal)] {
            for phase in 0..10 {
                let mut buf = Buffer::empty(Rect::new(0, 0, 12, 10));
                let style = Style::default().fg(edge_stroke());
                draw_line(&first, style, false, &HashSet::new(), &mut buf);
                draw_dots(&first, &[], 1.0, phase, style, None, &mut buf);
                draw_line(&second, style, false, &HashSet::new(), &mut buf);
                draw_dots(&second, &[], 1.0, phase, style, None, &mut buf);
                assert_eq!(buf[(5, 4)].symbol(), "⌒");
                assert!(
                    !buf.content
                        .iter()
                        .any(|c| matches!(c.symbol(), "┼" | "┬" | "┴" | "├" | "┤"))
                );
            }
        }
    }

    #[test]
    fn known_glyphs_round_trip() {
        for (symbol, bits) in [
            ("─", L_BIT | R_BIT),
            ("│", U_BIT | D_BIT),
            ("╭", R_BIT | D_BIT),
            ("╯", L_BIT | U_BIT),
            ("└", 0),
            ("├", U_BIT | D_BIT | R_BIT),
        ] {
            assert_eq!(symbol_bits(symbol), bits, "{symbol}");
        }
    }

    #[test]
    fn arrows_point_along_the_last_segment() {
        assert_eq!(
            arrow_cell(&[(2, 2), (2, 3)]),
            Some(((2, 3), 2)),
            "short stems still have a head"
        );
        assert_eq!(arrow_char(0), '▲');
        assert_eq!(arrow_char(1), '▶');
        assert_eq!(arrow_char(2), '▼');
        assert_eq!(arrow_char(3), '◀');
    }

    #[test]
    fn same_arrival_dots_walk_the_span_by_progress() {
        // 2000 ms is 20 steps for a 21 cell span: the dot starts on the
        // source stem and lands on the arrowhead exactly on the last step.
        let timing = Timing::SameArrival {
            duration_ms: DEFAULT_DURATION_MS,
        };
        let cells = 21;
        assert_eq!(dot_index(cells, timing, 0), Some(0));
        assert_eq!(dot_index(cells, timing, 10), Some(10));
        assert_eq!(dot_index(cells, timing, 20), Some(20));
        assert_eq!(dot_index(cells, timing, 21), Some(0), "then it wraps");

        // 600 ms is six steps, whatever the span.
        let quick = Timing::SameArrival { duration_ms: 600 };
        assert_eq!(dot_index(cells, quick, 6), Some(20));
        assert_eq!(dot_index(cells, quick, 3), Some(10));
        assert_eq!(dot_index(cells, quick, 7), Some(0));

        // Two very different spans spend the same wall clock on one pass.
        let short = 5;
        let long = 25;
        for phase in 0..=20 {
            let a = dot_index(short, timing, phase).unwrap();
            let b = dot_index(long, timing, phase).unwrap();
            assert!(a < short && b < long);
        }
        assert_eq!(dot_index(short, timing, 20), Some(4));
        assert_eq!(dot_index(long, timing, 20), Some(24));
        assert_ne!(
            dot_index(short, timing, 4),
            dot_index(long, timing, 4),
            "intermediate steps differ by span"
        );
    }

    #[test]
    fn a_constant_route_advances_by_its_rate_and_skips_the_arrowhead() {
        let legacy = Timing::Constant(1.0);
        assert!(!legacy.is_same_arrival());
        assert_eq!(legacy.duration_ms(), None);
        assert_eq!(legacy.rate(), Some(1.0));
        let cells = 10;
        assert_eq!(dot_index(cells, legacy, 0), Some(0));
        assert_eq!(dot_index(cells, legacy, 1), Some(1));
        assert_eq!(dot_index(cells, legacy, 9), Some(0), "never the head cell");
        // A slower rate holds the same cell for several steps.
        let slow = Timing::Constant(DEFAULT_FLOW_RATE);
        assert_eq!(DEFAULT_FLOW_RATE, 0.5);
        assert_eq!(dot_index(cells, slow, 0), Some(0));
        assert_eq!(dot_index(cells, slow, 1), Some(0));
        assert_eq!(dot_index(cells, slow, 2), Some(1));
        assert_eq!(dot_index(cells, slow, 8), Some(4));
        let same_arrival = Timing::SameArrival { duration_ms: 600 };
        assert!(same_arrival.is_same_arrival());
        assert_eq!(same_arrival.duration_ms(), Some(600));
        assert_eq!(same_arrival.rate(), None);
        assert_ne!(
            dot_index(cells, same_arrival, 1),
            Some(1),
            "the constant mode and the opt-in must not agree"
        );
    }

    #[test]
    fn a_span_too_short_to_animate_has_no_dot_index() {
        let timing = Timing::SameArrival {
            duration_ms: DEFAULT_DURATION_MS,
        };
        assert_eq!(dot_index(0, timing, 0), None);
        assert_eq!(dot_index(1, timing, 0), None);
        assert_eq!(dot_index(2, timing, 0), None);
        assert_eq!(dot_index(3, timing, 0), Some(0));
        assert_eq!(MIN_DOT_CELLS, 3);
    }
}
