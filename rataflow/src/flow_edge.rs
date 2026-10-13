//! FlowEdge — the edge content rataflow-view renders: a stepped line like
//! [`StepEdge`], optionally carrying live dots that flow from source to
//! target. The dot speed is per-edge, set by the spec's `flow` field.
//!
//! rataflow's own `Edge::animated` renders marching ants at one global
//! speed, and its animation phase is crate-private, so rataflow-view owns
//! the clock instead: the app advances an unbounded phase counter and
//! pushes it into every edge once per frame (`set_phase` through
//! `Flow::edges_content_mut`). `FlowEdge` keeps the line solid and walks
//! its own dot train from that phase — direction is always source →
//! target, speed is cells per step, and the dots ride a line that looks
//! identical to a static edge.

use std::collections::HashSet;

use rataflow::{EdgeContent, EdgePathContext, EdgeRenderContext, HandlePosition, Path, Position, StepEdge};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::symbols::merge::MergeStrategy;

/// Dots space themselves `3 × speed` cells apart: fast edges carry a
/// sparser train than slow ones, and every step moves each dot a full
/// `speed` cells forward (no aliasing — the phase counter never wraps).
const SPACING_FACTOR: f64 = 3.0;

/// The glyph drawn for a flowing dot.
const DOT: char = '●';

/// Explicit routing for layered top-to-bottom specs, computed by
/// [`build_flow`](crate::build_flow). `src_off`/`tgt_off` place the attach
/// points along the source's bottom and the target's top so parallel
/// edges never share a handle, `lane` gives the horizontal run its own
/// rows above the target so parallel runs never share a corridor, and
/// `via` names a detour column for edges that cross intermediate layers.
#[derive(Debug, Clone, Copy)]
pub struct Route {
    /// Attach point across the source width, 0.0..=1.0.
    pub src_off: f64,
    /// Attach point across the target width, 0.0..=1.0.
    pub tgt_off: f64,
    /// Horizontal lane index, counted upward from the row above the target.
    pub lane: usize,
    /// Detour column (world x) for edges that cross intermediate layers.
    pub via: Option<f64>,
}

/// An edge that renders exactly like a [`StepEdge`] and, when flowing,
/// draws animated dots along the line from source to target.
///
/// Construct one per edge in [`build_flow`](crate::build_flow): `plain()`
/// for structural edges, `flowing(speed)` for edges where something
/// travels. `speed` is in cells per animation step — see
/// [`ANIMATION_STEP_MS`](crate::ANIMATION_STEP_MS) for the wall-clock rate.
#[derive(Debug, Clone, Default)]
pub struct FlowEdge {
    step: StepEdge,
    speed: Option<f64>,
    phase: usize,
    route: Option<Route>,
    color: Option<Color>,
}

impl FlowEdge {
    /// A static edge — renders identically to a plain `StepEdge`.
    pub fn plain() -> Self {
        Self::default()
    }

    /// An edge with dots flowing source → target at `speed` cells per
    /// animation step. The app must advance the phase each frame via
    /// [`FlowEdge::set_phase`]; until then the dots hold at their phase-0
    /// positions.
    pub fn flowing(speed: f64) -> Self {
        Self {
            step: StepEdge::default(),
            speed: Some(speed),
            phase: 0,
            route: None,
            color: None,
        }
    }

    /// Attaches an explicit route computed by `build_flow` for layered
    /// specs; without one the library's step router draws the edge.
    pub fn with_route(mut self, route: Route) -> Self {
        self.route = Some(route);
        self
    }

    /// Paints the edge with its own accent so parallel arrows can be told
    /// apart at crossings. Without one the edge stays muted gray.
    pub fn with_color(mut self, color: Color) -> Self {
        self.color = Some(color);
        self
    }

    /// Sets the animation phase. The event loop advances it every
    /// [`ANIMATION_STEP_MS`](crate::ANIMATION_STEP_MS) and pushes it into
    /// every edge once per frame; dot positions derive from it.
    pub fn set_phase(&mut self, phase: usize) {
        self.phase = phase;
    }

    fn render_flowing(&self, ctx: &EdgeRenderContext, speed: f64, phase: usize, buf: &mut Buffer) {
        let palette = ctx.theme.palette();
        let stroke_style = Style::default().fg(match (self.color, ctx.selected) {
            // A colored edge keeps its own hue; selection wins either way;
            // plain edges stay muted gray.
            (Some(color), false) => color,
            (_, true) => palette.accent,
            (None, false) => palette.muted,
        });
        let dot_style = Style::default().fg(self.color.unwrap_or(palette.accent));
        let label_style = Style::default().fg(palette.text);

        // Terminal-space polyline, endpoints shifted so the markers sit on
        // the side the line actually leaves and enters — the same offsets
        // rataflow's own renderer applies. Non-orthogonal paths fall back
        // to the library renderer.
        let Some(points) = edge_points(ctx) else {
            self.step.render(ctx, buf);
            return;
        };
        draw_edge(&points, ctx, stroke_style, label_style, buf);

        let area = buf.area;

        // The flowing dots. Distance from the source decides which cells
        // carry a dot, so the train always moves source → target. The
        // phase counter is unbounded, so the offset never wraps and the
        // motion never aliases — each step advances every dot exactly
        // `speed` cells along the line.
        let offset = phase as f64 * speed;
        let spacing = SPACING_FACTOR * speed;
        let first = points[0];
        let last = *points.last().expect("checked len >= 2");
        let mut traveled: i32 = 0;
        for w in points.windows(2) {
            let (from, to) = (w[0], w[1]);
            let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
            let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
            for step in 0..len {
                let cell = (from.0 + dx * step, from.1 + dy * step);
                let distance = traveled + step;
                // Skip the endpoint cells: the start sits on the source
                // border, the end carries the arrow marker.
                if cell == first || cell == last {
                    continue;
                }
                if (distance as f64 - offset).rem_euclid(spacing) < 1.0
                    && point_in_area(area, cell.0, cell.1)
                {
                    buf[(cell.0 as u16, cell.1 as u16)]
                        .set_char(DOT)
                        .set_style(dot_style);
                }
            }
            traveled += len;
        }

        // End marker: the closed arrow rotated to point into the target —
        // the default `StepEdge` marker, replicated because rataflow keeps
        // its char-for-position helper crate-private.
        let arrow = match ctx.path.target_position.opposite() {
            HandlePosition::Left => '◀',
            HandlePosition::Right => '▶',
            HandlePosition::Top => '▲',
            HandlePosition::Bottom => '▼',
        };
        if point_in_area(area, last.0, last.1) {
            buf[(last.0 as u16, last.1 as u16)]
                .set_char(arrow)
                .set_style(stroke_style);
        }

        // Label, centered on the path's label position — same placement
        // rule as rataflow's renderer.
        if let Some(label) = ctx.label {
            let (lx, ly) = ctx.world_to_terminal(ctx.path.label_position);
            draw_label(label, lx, ly, label_style, area, buf);
        }
    }

    /// The same polyline as `render_flowing` minus the dots — the static
    /// form of a colored edge.
    fn render_static(&self, ctx: &EdgeRenderContext, buf: &mut Buffer) {
        let palette = ctx.theme.palette();
        let stroke_style = Style::default().fg(match (self.color, ctx.selected) {
            (Some(color), false) => color,
            (_, true) => palette.accent,
            (None, false) => palette.muted,
        });
        let label_style = Style::default().fg(palette.text);
        let Some(points) = edge_points(ctx) else {
            self.step.render(ctx, buf);
            return;
        };
        draw_edge(&points, ctx, stroke_style, label_style, buf);
    }
}

/// Terminal-space polyline for the edge in `ctx`, endpoints shifted so the
/// markers sit on the side the line actually leaves and enters — the same
/// offsets rataflow's own renderer applies. `None` when the path is too
/// short or not orthogonal; callers fall back to the library renderer.
fn edge_points(ctx: &EdgeRenderContext) -> Option<Vec<(i32, i32)>> {
    let mut points: Vec<(i32, i32)> = ctx
        .path
        .points
        .iter()
        .map(|p| ctx.world_to_terminal(*p))
        .collect();
    if points.len() < 2 {
        return None;
    }
    let source_offset = ctx.path.source_position.edge_endpoint_render_offset();
    let target_offset = ctx.path.target_position.edge_endpoint_render_offset();
    if let Some(first) = points.first_mut() {
        first.0 += source_offset.0;
        first.1 += source_offset.1;
    }
    if let Some(last) = points.last_mut() {
        last.0 += target_offset.0;
        last.1 += target_offset.1;
    }
    // Step paths are orthogonal by construction; guard anyway.
    if points
        .windows(2)
        .any(|w| w[0].0 != w[1].0 && w[0].1 != w[1].1)
    {
        return None;
    }
    Some(points)
}

/// True when `(x, y)` falls inside `area`.
fn point_in_area(area: Rect, x: i32, y: i32) -> bool {
    x >= area.x as i32
        && x < (area.x + area.width) as i32
        && y >= area.y as i32
        && y < (area.y + area.height) as i32
}

/// Draws one edge polyline: segments, corners, the end arrow, and the
/// label. Corners are collected first so segments can skip them and the
/// corner pass can merge — same two-pass shape as rataflow's step
/// renderer, so crossing edges still combine into junctions.
fn draw_edge(
    points: &[(i32, i32)],
    ctx: &EdgeRenderContext,
    stroke_style: Style,
    label_style: Style,
    buf: &mut Buffer,
) {
    let area = buf.area;

    let mut corners: Vec<((i32, i32), char)> = Vec::new();
    for w in points.windows(3) {
        if let Some(ch) = corner_char(w[0], w[1], w[2]) {
            corners.push(((w[1].0, w[1].1), ch));
        }
    }
    let corner_cells: HashSet<(i32, i32)> = corners.iter().map(|(cell, _)| *cell).collect();

    // Solid line segments.
    for w in points.windows(2) {
        let (from, to) = (w[0], w[1]);
        if from.1 == to.1 {
            let (lo, hi) = (from.0.min(to.0), from.0.max(to.0));
            for x in lo..=hi {
                if corner_cells.contains(&(x, from.1)) || !point_in_area(area, x, from.1) {
                    continue;
                }
                buf[(x as u16, from.1 as u16)]
                    .merge_symbol("─", MergeStrategy::Fuzzy)
                    .set_style(stroke_style);
            }
        } else {
            let (lo, hi) = (from.1.min(to.1), from.1.max(to.1));
            for y in lo..=hi {
                if corner_cells.contains(&(from.0, y)) || !point_in_area(area, from.0, y) {
                    continue;
                }
                buf[(from.0 as u16, y as u16)]
                    .merge_symbol("│", MergeStrategy::Fuzzy)
                    .set_style(stroke_style);
            }
        }
    }

    // Corners on top, merged so crossings with other edges combine.
    for ((x, y), ch) in corners {
        if !point_in_area(area, x, y) {
            continue;
        }
        buf[(x as u16, y as u16)]
            .merge_symbol(&ch.to_string(), MergeStrategy::Fuzzy)
            .set_style(stroke_style);
    }

    // End marker: the closed arrow rotated to point into the target —
    // the default `StepEdge` marker, replicated because rataflow keeps
    // its char-for-position helper crate-private.
    if let Some(&last) = points.last() {
        let arrow = match ctx.path.target_position.opposite() {
            HandlePosition::Left => '◀',
            HandlePosition::Right => '▶',
            HandlePosition::Top => '▲',
            HandlePosition::Bottom => '▼',
        };
        if point_in_area(area, last.0, last.1) {
            buf[(last.0 as u16, last.1 as u16)]
                .set_char(arrow)
                .set_style(stroke_style);
        }
    }

    // Label, centered on the path's label position — same placement
    // rule as rataflow's edge renderer.
    if let Some(label) = ctx.label {
        let (lx, ly) = ctx.world_to_terminal(ctx.path.label_position);
        draw_label(label, lx, ly, label_style, area, buf);
    }
}

impl EdgeContent for FlowEdge {
    fn compute_path(&self, ctx: &EdgePathContext) -> Path {
        match (self.route, ctx.target_bounds) {
            // Layered top-to-bottom routing: leave the source's bottom at
            // this edge's own attach point, turn on this edge's own lane
            // above the target, and detour around intermediate-layer boxes
            // via `via` when the straight drop is blocked. Every edge owns
            // its attach points and lanes, so parallel edges never merge
            // into shared corridors.
            (
                Some(route),
                Some(ref tgt),
            ) if ctx.source_position == HandlePosition::Bottom
                && ctx.target_position == HandlePosition::Top =>
            {
                let src = &ctx.source_bounds;
                let sx = src.position.x + src.dimensions.width * route.src_off;
                let tx = tgt.position.x + tgt.dimensions.width * route.tgt_off;
                let sy = src.position.y + src.dimensions.height;
                let ty = tgt.position.y;
                let lane_y = ty - 1.0 - route.lane as f64;
                let mut points = vec![Position::new(sx, sy)];
                if let Some(vx) = route.via {
                    let upper_y = sy + 1.0 + route.lane as f64;
                    points.push(Position::new(sx, upper_y));
                    points.push(Position::new(vx, upper_y));
                    points.push(Position::new(vx, lane_y));
                } else {
                    points.push(Position::new(sx, lane_y));
                }
                points.push(Position::new(tx, lane_y));
                points.push(Position::new(tx, ty));
                // Drop consecutive duplicates so straight drops stay clean.
                points.dedup();
                Path::new(points, ctx.source_position, ctx.target_position)
            }
            _ => self.step.compute_path(ctx),
        }
    }

    fn render(&self, ctx: &EdgeRenderContext, buf: &mut Buffer) {
        match self.speed {
            Some(speed) => self.render_flowing(ctx, speed, self.phase, buf),
            None => self.render_static(ctx, buf),
        }
    }
}

/// The corner glyph at the turning point `b` on an `a → b → c` polyline,
/// or `None` when the path runs straight through. Mirrors rataflow's
/// `corner_kind_at` table (terminal y grows downward).
fn corner_char(a: (i32, i32), b: (i32, i32), c: (i32, i32)) -> Option<char> {
    let (dx1, dy1) = ((b.0 - a.0).signum(), (b.1 - a.1).signum());
    let (dx2, dy2) = ((c.0 - b.0).signum(), (c.1 - b.1).signum());
    if dx1 == dx2 && dy1 == dy2 {
        return None;
    }
    match ((dx1, dy1), (dx2, dy2)) {
        ((1, 0), (0, 1)) | ((0, -1), (-1, 0)) => Some('╮'),
        ((-1, 0), (0, 1)) | ((0, -1), (1, 0)) => Some('╭'),
        ((1, 0), (0, -1)) | ((0, 1), (-1, 0)) => Some('╯'),
        ((-1, 0), (0, -1)) | ((0, 1), (1, 0)) => Some('╰'),
        _ => None,
    }
}

/// Draws a single-line label centered on `(x, y)`, clipped to `area` from
/// the left — the same rule rataflow's edge renderer uses. Spec labels are
/// single-line, so the multi-line handling there is not needed here.
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
    fn corner_char_matches_the_turn_tables() {
        let p = |x: i32, y: i32| (x, y);
        // Right then down: the line enters from the left and leaves
        // downward — a top-right corner.
        assert_eq!(corner_char(p(0, 0), p(2, 0), p(2, 3)), Some('╮'));
        // Down then left: enters from above, leaves leftward — arms up
        // and left.
        assert_eq!(corner_char(p(2, 0), p(2, 3), p(0, 3)), Some('╯'));
        // Up then right.
        assert_eq!(corner_char(p(0, 3), p(0, 0), p(2, 0)), Some('╭'));
        // Left then up: arms reach right and up.
        assert_eq!(corner_char(p(2, 3), p(0, 3), p(0, 0)), Some('╰'));
        // Straight through: no corner.
        assert_eq!(corner_char(p(0, 0), p(2, 0), p(4, 0)), None);
        assert_eq!(corner_char(p(0, 0), p(0, 2), p(0, 4)), None);
    }
}
