//! Headless render proofs: the real `draw` path paints node labels, edge
//! lines, and flow dots into a ratatui buffer through `TestBackend`,
//! without a real terminal. These tests pin the rendering contract: a
//! plain canvas with no dot grid, node fills that match the canvas,
//! gruvbox accents on node borders, and flow dots that move with the
//! animation phase.

use rataflow_view::{Spec, build_flow, draw, gruvbox_accents, gruvbox_theme};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::buffer::Cell;
use ratatui::style::Color;

/// Renders one frame at the given animation phase (pushed into every edge
/// the way the event loop does) and returns the buffer contents. 90×40
/// gives the fitted graph room for its borders — a 30-row terminal clips
/// the top node's top border.
fn render(spec_json: &str, phase: usize) -> Vec<Cell> {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    let mut flow = build_flow(&spec).expect("flow should build");
    flow.request_fit_view();
    for (_, content) in flow.edges_content_mut() {
        content.set_phase(phase);
    }

    let mut terminal = Terminal::new(TestBackend::new(90, 40)).expect("terminal");
    terminal
        .draw(|frame| draw(frame, &mut flow, " test header"))
        .expect("draw");
    terminal.backend().buffer().content.clone()
}

fn rendered_text(cells: &[Cell]) -> String {
    cells.iter().map(|cell| cell.symbol()).collect()
}

fn dot_positions(cells: &[Cell]) -> Vec<(u16, u16, Color)> {
    cells
        .iter()
        .enumerate()
        .filter(|(_, cell)| cell.symbol() == "●")
        .map(|(index, cell)| ((index % 90) as u16, (index / 90) as u16, cell.fg))
        .collect()
}

fn positions(dots: &[(u16, u16, Color)]) -> Vec<(u16, u16)> {
    dots.iter().map(|(x, y, _)| (*x, *y)).collect()
}

/// Positions of the dots that MOVE — the flowing dots. Handle dots sit on
/// node borders and never move, so subtracting the phase-0 positions from
/// the phase-1 positions isolates the moving train.
fn moving_dot_positions(spec_json: &str) -> Vec<(u16, u16)> {
    let still = positions(&dot_positions(&render(spec_json, 0)));
    let moved = positions(&dot_positions(&render(spec_json, 1)));
    moved
        .into_iter()
        .filter(|pos| !still.contains(pos))
        .collect()
}

#[test]
fn renders_node_labels_into_the_buffer() {
    let cells = render(
        r#"{"direction":"lr",
            "nodes":[{"id":"ingest","label":"Ingest"},
                     {"id":"serve","label":"Serving shard"}],
            "edges":[{"from":"ingest","to":"serve","label":"grpc"}]}"#,
        0,
    );
    let text = rendered_text(&cells);
    assert!(text.contains("Ingest"), "node label missing from buffer");
    assert!(
        text.contains("Serving shard"),
        "long node label missing from buffer"
    );
    assert!(text.contains("grpc"), "edge label missing from buffer");
}

#[test]
fn renders_a_top_to_bottom_graph_without_a_nodes_block() {
    let cells = render(r#"{"edges":[{"from":"start","to":"end"}]}"#, 0);
    let text = rendered_text(&cells);
    assert!(text.contains("start"), "implicit node missing from buffer");
    assert!(text.contains("end"), "implicit node missing from buffer");
}

#[test]
fn canvas_is_plain_with_no_dot_grid() {
    let cells = render(r#"{"edges":[{"from":"a","to":"b"}]}"#, 0);
    assert!(
        cells.iter().all(|cell| cell.symbol() != "·"),
        "the background dot grid must be gone"
    );
}

#[test]
fn node_fills_match_the_canvas_background() {
    let cells = render(
        r#"{"nodes":[{"id":"aa","label":"Node"},
                     {"id":"bb","label":"Box"}],
            "edges":[{"from":"aa","to":"bb"}]}"#,
        0,
    );
    let canvas = gruvbox_theme().palette().canvas_bg;

    // The old surface fill (#3c3836) made boxes read as blocky rectangles;
    // it must not appear anywhere.
    let old_surface = Color::Rgb(60, 56, 54);
    assert!(
        cells.iter().all(|cell| cell.bg != old_surface),
        "the old box fill color is still in use"
    );

    // A cell inside a node (a label glyph) shares the canvas background.
    let label_cell = cells
        .iter()
        .find(|cell| cell.symbol() == "N")
        .expect("label glyph missing");
    assert_eq!(label_cell.bg, canvas, "node fill must equal the canvas bg");
}

#[test]
fn node_borders_cycle_the_gruvbox_accents() {
    // A straight chain renders one node per row, in id order (a, b, c),
    // so the three ╭ corners carry the first three accents.
    let cells = render(
        r#"{"edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}"#,
        0,
    );
    let accents = gruvbox_accents();
    let corners: Vec<Color> = cells
        .iter()
        .filter(|cell| cell.symbol() == "╭")
        .map(|cell| cell.fg)
        .collect();
    assert_eq!(
        corners.len(),
        3,
        "expected one corner per node, got {corners:?}"
    );
    assert_eq!(corners[0], accents[0], "node a border");
    assert_eq!(corners[1], accents[1], "node b border");
    assert_eq!(corners[2], accents[2], "node c border");
}

#[test]
fn flow_dots_ride_a_solid_line_in_theme_colors() {
    let spec = r#"{"nodes":[{"id":"a"},{"id":"b"}],
                  "edges":[{"from":"a","to":"b","flow":1}]}"#;
    let cells = render(spec, 0);
    let palette = gruvbox_theme().palette();

    // The line is solid: vertical runs painted in the gruvbox edge gray.
    let line_cells = cells
        .iter()
        .filter(|cell| cell.symbol() == "│" && cell.fg == palette.muted)
        .count();
    assert!(line_cells > 0, "no edge line between the nodes");

    // Moving dots exist (handles share the glyph but never move) and the
    // dots use the gruvbox accent color.
    assert!(
        !moving_dot_positions(spec).is_empty(),
        "flow edge shows no moving dots"
    );
    assert!(
        cells
            .iter()
            .any(|cell| cell.symbol() == "●" && cell.fg == palette.accent),
        "dots must use the accent color"
    );
}

#[test]
fn flow_dots_move_with_the_phase_and_repeat_cleanly() {
    let spec = r#"{"nodes":[{"id":"a"},{"id":"b"}],
                  "edges":[{"from":"a","to":"b","flow":1}]}"#;

    let phase0 = positions(&dot_positions(&render(spec, 0)));
    let phase1 = positions(&dot_positions(&render(spec, 1)));
    let phase2 = positions(&dot_positions(&render(spec, 2)));
    let phase3 = positions(&dot_positions(&render(spec, 3)));

    assert!(!phase0.is_empty(), "no dots at phase 0");
    assert_ne!(phase0, phase1, "dots must move with the phase");
    assert_ne!(phase1, phase2, "dots must keep moving");
    // At speed 1 the dot train repeats every spacing/speed = 3 steps, so
    // phase 3 lands exactly on phase 0 — motion that cycles, not jumps.
    assert_eq!(phase0, phase3, "phase 3 must repeat phase 0 at speed 1");
}

#[test]
fn every_speed_keeps_the_dots_moving() {
    // Slow and fast alike must show visible motion after one step; the
    // spacing (3 × speed) never swallows the whole line at once.
    let spec_for = |speed: &str| {
        format!(
            r#"{{"nodes":[{{"id":"a"}},{{"id":"b"}}],
                "edges":[{{"from":"a","to":"b","flow":{speed}}}]}}"#
        )
    };
    for speed in ["0.5", "1", "2", "3"] {
        let spec = spec_for(speed);
        assert!(
            !moving_dot_positions(&spec).is_empty(),
            "speed {speed} shows no moving dots"
        );
    }
}

#[test]
fn static_edges_show_no_live_dots() {
    // Handles paint ● on node borders, but they never move; an edge
    // without flow must show no dots that move with the phase.
    let spec = r#"{"nodes":[{"id":"a"},{"id":"b"}],
            "edges":[{"from":"a","to":"b"}]}"#;
    assert!(
        moving_dot_positions(spec).is_empty(),
        "an edge without flow must not grow live dots"
    );
}
