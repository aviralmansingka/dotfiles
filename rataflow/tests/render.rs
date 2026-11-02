//! Headless render proofs: the real `draw` path paints node labels, edge
//! lines, and flow dots into a ratatui buffer through `TestBackend`,
//! without a real terminal. These tests pin the readability contract: one
//! uniform layer-colored borders, one muted stroke, no handle dots, no labels lost,
//! and deterministic output.

use rataflow::FitViewOptions;
use rataflow_view::flow_edge::edge_stroke;
use rataflow_view::{Graph, Spec, build_flow_with_report, draw, node_border};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::buffer::Cell;
use ratatui::style::Color;

const WIDTH: u16 = 90;
const HEIGHT: u16 = 40;

/// Renders one frame at the given animation phase (pushed into every edge
/// the way the event loop does) and returns the buffer and the graph.
fn render_full(spec_json: &str, phase: usize) -> (Vec<Cell>, Graph) {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    let (mut flow, _) = build_flow_with_report(&spec).expect("flow should build");
    flow.request_fit_view_with_options(FitViewOptions {
        min_zoom: Some(1.0),
        max_zoom: Some(1.0),
        ..FitViewOptions::default()
    });
    for (_, content) in flow.edges_content_mut() {
        content.set_phase(phase);
    }

    let mut terminal = Terminal::new(TestBackend::new(WIDTH, HEIGHT)).expect("terminal");
    terminal
        .draw(|frame| draw(frame, &mut flow, " test header"))
        .expect("draw");
    (terminal.backend().buffer().content.clone(), flow)
}

fn render(spec_json: &str, phase: usize) -> Vec<Cell> {
    render_full(spec_json, phase).0
}

fn rendered_text(cells: &[Cell]) -> String {
    cells.iter().map(|cell| cell.symbol()).collect()
}

fn dot_positions(cells: &[Cell]) -> Vec<(u16, u16, Color)> {
    cells
        .iter()
        .enumerate()
        .filter(|(_, cell)| cell.symbol() == "●")
        .map(|(index, cell)| {
            (
                (index % WIDTH as usize) as u16,
                (index / WIDTH as usize) as u16,
                cell.fg,
            )
        })
        .collect()
}

fn positions(dots: &[(u16, u16, Color)]) -> Vec<(u16, u16)> {
    dots.iter().map(|(x, y, _)| (*x, *y)).collect()
}

/// Positions of the dots that MOVE — the flowing dots, not any static
/// glyph.
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
    let canvas = rataflow_view::gruvbox_theme().palette().canvas_bg;

    let old_surface = Color::Rgb(60, 56, 54);
    assert!(
        cells.iter().all(|cell| cell.bg != old_surface),
        "the old box fill color is still in use"
    );

    let label_cell = cells
        .iter()
        .find(|cell| cell.symbol() == "N")
        .expect("label glyph missing");
    assert_eq!(label_cell.bg, canvas, "node fill must equal the canvas bg");
}

#[test]
fn each_layer_gets_its_own_color_family() {
    // A chain renders one node per layer, so the three box corners must
    // carry three different families — never the old alphabetical cycle.
    let cells = render(
        r#"{"edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}"#,
        0,
    );
    let mut corners: Vec<Color> = cells
        .iter()
        .filter(|cell| cell.symbol() == "╭" && cell.fg != edge_stroke())
        .map(|cell| cell.fg)
        .collect();
    corners.sort_by_key(|color| format!("{color:?}"));
    corners.dedup();
    assert_eq!(
        corners.len(),
        3,
        "expected three layer colors, got {corners:?}"
    );
    assert!(
        corners.iter().all(|&color| color != node_border()),
        "the neutral border must not be used when layers exist"
    );
}

#[test]
fn handles_leave_no_dots_on_node_borders() {
    let cells = render(
        r#"{"nodes":[{"id":"a"},{"id":"b"}],
            "edges":[{"from":"a","to":"b"}]}"#,
        0,
    );
    assert!(
        cells.iter().all(|cell| cell.symbol() != "●"),
        "a static graph must carry no dots at all"
    );
}

#[test]
fn flow_dots_ride_a_solid_line_in_theme_colors() {
    let spec = r#"{"nodes":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],
                  "layers":[["a"],["b"],["c"],["d"]],
                  "edges":[{"from":"a","to":"d","flow":1},
                           {"from":"b","to":"c"}]}"#;
    let cells = render(spec, 0);
    let palette = rataflow_view::gruvbox_theme().palette();

    let line_cells = cells
        .iter()
        .filter(|cell| cell.symbol() == "│" && cell.fg == edge_stroke())
        .count();
    assert!(line_cells > 0, "no edge line between the nodes");

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
    // A four-layer chain is long enough that the dot spacing stays at the
    // nominal 7 cells, so phase 7 lands exactly on phase 0.
    let spec = r#"{"nodes":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],
                  "layers":[["a"],["b"],["c"],["d"]],
                  "edges":[{"from":"a","to":"d","flow":1},
                           {"from":"b","to":"c"}]}"#;

    let phase0 = positions(&dot_positions(&render(spec, 0)));
    let phase1 = positions(&dot_positions(&render(spec, 1)));
    let phase7 = positions(&dot_positions(&render(spec, 7)));

    assert!(!phase0.is_empty(), "no dots at phase 0");
    assert_ne!(phase0, phase1, "dots must move with the phase");
    assert_eq!(phase0, phase7, "phase 7 must repeat phase 0 at speed 1");
}

#[test]
fn every_speed_keeps_the_dots_moving() {
    let spec_for = |speed: &str| {
        format!(
            r#"{{"nodes":[{{"id":"a"}},{{"id":"b"}},{{"id":"c"}},{{"id":"d"}}],
                "layers":[["a"],["b"],["c"],["d"]],
                "edges":[{{"from":"a","to":"d","flow":{speed}}},
                         {{"from":"b","to":"c"}}]}}"#
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
    let spec = r#"{"nodes":[{"id":"a"},{"id":"b"}],
            "edges":[{"from":"a","to":"b"}]}"#;
    assert!(
        moving_dot_positions(spec).is_empty(),
        "an edge without flow must not grow live dots"
    );
}

#[test]
fn a_fan_out_keeps_edges_out_of_one_corridor() {
    let spec = r#"{"edges":[{"from":"root","to":"a"},{"from":"root","to":"b"},
                             {"from":"root","to":"c"},{"from":"root","to":"d"}],
                  "layers":[["root"],["a","b","c","d"]]}"#;
    let parsed = Spec::from_json(spec).expect("spec");
    let (_, report) = build_flow_with_report(&parsed).expect("flow");
    assert!(
        report.shared_run == 0,
        "edges share a {} cell corridor",
        report.shared_run
    );
    assert_eq!(report.labels_skipped, 0);
}

#[test]
fn the_same_spec_renders_identically_twice() {
    let spec = r#"{"nodes":[{"id":"a","label":"Alpha"},{"id":"b","label":"Beta"},
                             {"id":"c","label":"Gamma"},{"id":"d","label":"Delta"}],
                  "edges":[{"from":"a","to":"b","label":"one"},
                           {"from":"a","to":"c","label":"two"},
                           {"from":"b","to":"d","label":"three"}]}"#;
    let first: String = render(spec, 0).iter().map(|cell| cell.symbol()).collect();
    let second: String = render(spec, 0).iter().map(|cell| cell.symbol()).collect();
    assert_eq!(first, second, "the renderer must be deterministic");
}

fn normal(side: rataflow::HandlePosition) -> (i32, i32) {
    use rataflow::HandlePosition::*;
    match side {
        Top => (0, -1),
        Right => (1, 0),
        Bottom => (0, 1),
        Left => (-1, 0),
    }
}

/// Check geometry independently of the router's own overlap metric.
fn assert_geometry(flow: &Graph) -> Vec<(i32, i32)> {
    use std::collections::HashMap;
    let mut occupied: HashMap<(i32, i32), Vec<(usize, u8)>> = HashMap::new();
    let mut protected = Vec::new();
    for (index, edge) in flow.edges().iter().enumerate() {
        let route = edge.content.planned().expect("every edge must be routed");
        let points: Vec<_> = route
            .points
            .iter()
            .map(|&(x, y)| (x as i32, y as i32))
            .collect();
        let first = points[0];
        let last = *points.last().unwrap();
        let direction = |a: (i32, i32), b: (i32, i32)| ((b.0 - a.0).signum(), (b.1 - a.1).signum());
        let src = normal(route.src);
        let tgt = normal(route.tgt);
        assert_eq!(direction(first, points[1]), src, "{} departure", edge.id);
        assert_eq!(
            direction(points[points.len() - 2], last),
            (-tgt.0, -tgt.1),
            "{} arrival",
            edge.id
        );
        protected.extend([
            (index, first),
            (index, (first.0 + src.0, first.1 + src.1)),
            (index, last),
            (index, (last.0 + tgt.0, last.1 + tgt.1)),
        ]);
        let mut cells: HashMap<(i32, i32), u8> = HashMap::new();
        for segment in points.windows(2) {
            let (a, b) = (segment[0], segment[1]);
            assert!(a.0 == b.0 || a.1 == b.1);
            let (dx, dy) = direction(a, b);
            for step in 0..=(b.0 - a.0).abs() + (b.1 - a.1).abs() {
                *cells.entry((a.0 + dx * step, a.1 + dy * step)).or_default() |=
                    if dx == 0 { 2 } else { 1 };
            }
        }
        for (cell, axis) in cells {
            for node in flow.nodes() {
                let b = node.bounds();
                let (x, y, w, h) = (
                    b.position.x.round() as i32,
                    b.position.y.round() as i32,
                    b.dimensions.width.round() as i32,
                    b.dimensions.height.round() as i32,
                );
                assert!(
                    !(cell.0 >= x && cell.0 < x + w && cell.1 >= y && cell.1 < y + h),
                    "{} runs through {} at {cell:?}",
                    edge.id,
                    node.id
                );
                if cell.0 >= x - 1 && cell.0 <= x + w && cell.1 >= y - 1 && cell.1 <= y + h {
                    assert!(
                        (cell == first && node.id == edge.source)
                            || (cell == last && node.id == edge.target),
                        "{} touches unrelated border {} at {cell:?}",
                        edge.id,
                        node.id
                    );
                }
            }
            occupied.entry(cell).or_default().push((index, axis));
        }
    }
    for (edge, cell) in protected {
        assert_eq!(
            occupied[&cell].len(),
            1,
            "edge {edge} stem stolen at {cell:?}"
        );
    }
    occupied
        .into_iter()
        .filter_map(|(cell, uses)| {
            if uses.len() == 1 {
                return None;
            }
            assert_eq!(uses.len(), 2, "more than two routes at {cell:?}");
            assert_eq!(uses[0].1 | uses[1].1, 3);
            assert_ne!(uses[0].1, uses[1].1);
            assert!(
                uses.iter().all(|(_, axis)| *axis == 1 || *axis == 2),
                "bend used as crossing"
            );
            Some(cell)
        })
        .collect()
}

fn assert_perimeters(flow: &Graph, buf: &ratatui::buffer::Buffer) {
    for node in flow.nodes() {
        let (l, t, r, b) = flow.node_terminal_rect(&node.id).unwrap();
        assert!(
            l >= 0 && t >= 1 && r <= buf.area.width as i32 && b <= buf.area.height as i32,
            "{} clipped: {l},{t}..{r},{b}",
            node.id
        );
        let color = buf[(l as u16, t as u16)].fg;
        let modifier = buf[(l as u16, t as u16)].modifier;
        if node.selected {
            assert_eq!(color, flow.theme.palette().accent);
        }
        for y in t..b {
            for x in l..r {
                let expected = match (x == l, x == r - 1, y == t, y == b - 1) {
                    (true, _, true, _) => "╭",
                    (_, true, true, _) => "╮",
                    (true, _, _, true) => "╰",
                    (_, true, _, true) => "╯",
                    (_, _, true, _) | (_, _, _, true) => "─",
                    (true, _, _, _) | (_, true, _, _) => "│",
                    _ => continue,
                };
                let cell = &buf[(x as u16, y as u16)];
                assert_eq!(cell.symbol(), expected, "{} perimeter at {x},{y}", node.id);
                assert_eq!(cell.fg, color, "{} nonuniform border at {x},{y}", node.id);
                assert_eq!(
                    cell.modifier, modifier,
                    "{} border emphasis at {x},{y}",
                    node.id
                );
            }
        }
    }
}

fn assert_endpoints_and_labels(flow: &Graph, buf: &ratatui::buffer::Buffer) {
    for edge in flow.edges() {
        let route = edge.content.planned().unwrap();
        let screen = |p: (f64, f64)| flow.world_to_terminal(rataflow::Position::new(p.0, p.1));
        let (x, y) = screen(route.points[0]);
        let source = if normal(route.src).0 == 0 {
            "│"
        } else {
            "─"
        };
        assert_eq!(
            buf[(x as u16, y as u16)].symbol(),
            source,
            "{} source",
            edge.id
        );
        let (x, y) = screen(*route.points.last().unwrap());
        let head = match normal(route.tgt) {
            (0, -1) => "▼",
            (0, 1) => "▲",
            (-1, 0) => "▶",
            _ => "◀",
        };
        assert_eq!(buf[(x as u16, y as u16)].symbol(), head, "{} head", edge.id);
        if let Some(label) = &edge.label {
            let (x, y) = screen(route.label.expect("no relationship label may disappear"));
            let left = x - label.chars().count() as i32 / 2;
            let actual: String = (left..left + label.chars().count() as i32)
                .map(|x| buf[(x as u16, y as u16)].symbol())
                .collect();
            assert_eq!(&actual, label, "{} label", edge.id);
        }
    }
}

#[test]
fn modal_lifecycle_preserves_relationships_ports_heads_labels_and_borders() {
    let spec = Spec::from_json(include_str!("fixtures/modal-machine-lifecycle.json")).unwrap();
    let (mut flow, report) = build_flow_with_report(&spec).unwrap();
    assert_eq!((report.nodes, report.edges), (10, 13));
    assert_eq!(report.shared_run, 0);
    assert_eq!(report.labels_skipped, 0);
    let crossings = assert_geometry(&flow);
    flow.request_fit_view_with_options(FitViewOptions {
        min_zoom: Some(1.0),
        max_zoom: Some(1.0),
        ..Default::default()
    });
    let mut terminal = Terminal::new(TestBackend::new(77, 47)).unwrap();
    for selected in [false, true] {
        if selected {
            flow.select_all_nodes();
        }
        terminal
            .draw(|f| draw(f, &mut flow, "Modal lifecycle"))
            .unwrap();
        let buf = terminal.backend().buffer();
        let text = rendered_text(&buf.content);
        for node in &spec.nodes {
            assert!(
                text.contains(node.label.as_deref().unwrap_or(&node.id)),
                "{} label missing",
                node.id
            );
        }
        assert_perimeters(&flow, buf);
        assert_endpoints_and_labels(&flow, buf);
        for &(x, y) in &crossings {
            let (x, y) = flow.world_to_terminal(rataflow::Position::new(x as f64, y as f64));
            assert_eq!(
                buf[(x as u16, y as u16)].symbol(),
                "⌒",
                "crossing must not imply connection"
            );
        }
        assert!(
            !buf.content
                .iter()
                .any(|c| matches!(c.symbol(), "┼" | "┬" | "┴" | "├" | "┤"))
        );
        if !selected && std::env::var_os("RATAFLOW_CAPTURE").is_some() {
            let text = buf
                .content
                .chunks(77)
                .map(|row| row.iter().map(|c| c.symbol()).collect::<String>())
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write("/tmp/rataflow-modal-77x47.txt", text).unwrap();
        }
        // Reverse only the draw order: geometry and label positions stay frozen.
        let mut edges = flow.edges().to_vec();
        edges.reverse();
        flow.set_edges(edges).unwrap();
    }
}

#[test]
fn small_odd_and_even_boxes_keep_corners_at_fractional_pan() {
    for direction in ["tb", "lr"] {
        let spec = Spec::from_json(&format!(
            r#"{{"direction":"{direction}",
            "layers":[["a"],["odd"]],"edges":[{{"from":"a","to":"odd"}}]}}"#
        ))
        .unwrap();
        let (mut flow, _) = build_flow_with_report(&spec).unwrap();
        let mut terminal = Terminal::new(TestBackend::new(90, 40)).unwrap();
        for pan in [0.0, 0.5] {
            flow.viewport.x = pan;
            flow.viewport.y = pan;
            for selected in [false, true] {
                if selected {
                    flow.select_all_nodes();
                } else {
                    flow.clear_selection();
                }
                terminal.draw(|f| draw(f, &mut flow, "test")).unwrap();
                assert_perimeters(&flow, terminal.backend().buffer());
            }
        }
    }
}

#[test]
fn fanout_same_layer_and_return_edges_work_on_both_axes() {
    for direction in ["tb", "lr"] {
        let spec = Spec::from_json(&format!(
            r#"{{"direction":"{direction}",
            "layers":[["root"],["a","b","c"],["end"]],
            "edges":[{{"from":"root","to":"a"}},{{"from":"root","to":"b"}},
                     {{"from":"root","to":"c"}},{{"from":"a","to":"b"}},
                     {{"from":"c","to":"end"}},{{"from":"end","to":"root"}}]}}"#
        ))
        .unwrap();
        let (mut flow, report) = build_flow_with_report(&spec).unwrap();
        assert_eq!(report.shared_run, 0);
        assert_geometry(&flow);
        flow.request_fit_view_with_options(FitViewOptions {
            min_zoom: Some(1.0),
            max_zoom: Some(1.0),
            ..Default::default()
        });
        let mut terminal = Terminal::new(TestBackend::new(120, 70)).unwrap();
        terminal.draw(|f| draw(f, &mut flow, "test")).unwrap();
        assert_perimeters(&flow, terminal.backend().buffer());
        assert_endpoints_and_labels(&flow, terminal.backend().buffer());
    }
}

// ---------------------------------------------------------------------------
// Trunks, dot modes, dashed routes, node groups, label ownership, CLI frames
// ---------------------------------------------------------------------------

use rataflow::Position;
use rataflow_view::{Report, dot_stats};
use ratatui::style::Modifier;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::process::Command;

/// A shared bus: one corridor from `oob-switch` to `nvos`, one spur per branch.
const TRUNK_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [
    {"id":"oob-switch","label":"OOB switch"},
    {"id":"nvos","label":"NV-OS"},
    {"id":"c1","label":"c1"},{"id":"c2","label":"c2"},{"id":"c3","label":"c3"}
  ],
  "layers": [["", "oob-switch", ""], ["c1", "", "c2", "", "c3"], ["", "nvos", ""]],
  "edges": [{"from":"oob-switch","to":"nvos","label":"trunk","flow":1,"dots":1}],
  "trunks": [{"id":"oob","label":"OOB LAN","from":"oob-switch","to":"nvos",
              "branches":["c1","c2","c3"]}]
}"#;

/// World cells of a planned route, in travel order.
fn route_cells(route: &rataflow_view::Route) -> Vec<(i32, i32)> {
    let mut cells = Vec::new();
    for window in route.points.windows(2) {
        let (from, to) = (window[0], window[1]);
        let delta = |a: f64, b: f64| -> i32 {
            if (a - b).abs() < 0.5 {
                0
            } else if b > a {
                1
            } else {
                -1
            }
        };
        let (dx, dy) = (delta(from.0, to.0), delta(from.1, to.1));
        let len = (to.0 - from.0).abs().round() as i32 + (to.1 - from.1).abs().round() as i32;
        for step in 0..=len {
            cells.push((
                from.0.round() as i32 + dx * step,
                from.1.round() as i32 + dy * step,
            ));
        }
    }
    cells
}

fn terminal_cell(flow: &Graph, cell: (f64, f64)) -> (i32, i32) {
    flow.world_to_terminal(Position::new(cell.0, cell.1))
}

fn build(spec_json: &str) -> (Graph, Report) {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    build_flow_with_report(&spec).expect("flow should build")
}

#[test]
fn a_trunk_routes_one_corridor_with_a_junction_per_branch() {
    let (flow, report) = build(TRUNK_SPEC);

    // `--check` has to name the trunk and its branch count.
    assert_eq!(report.trunks.len(), 1, "the trunk must be reported");
    let trunk = &report.trunks[0];
    assert_eq!(
        (
            trunk.id.as_str(),
            trunk.from.as_str(),
            trunk.to.as_str(),
            trunk.branches
        ),
        ("oob", "oob-switch", "nvos", 3)
    );

    // One corridor plus one spur per branch, and no extra route.
    let routes: Vec<&rataflow_view::Route> = flow
        .edges()
        .iter()
        .map(|edge| edge.content.planned().expect("every route is planned"))
        .collect();
    let corridors: Vec<&&rataflow_view::Route> =
        routes.iter().filter(|route| !route.detached_src).collect();
    let spurs: Vec<&&rataflow_view::Route> =
        routes.iter().filter(|route| route.detached_src).collect();
    assert_eq!(corridors.len(), 2, "the spec edge and the trunk corridor");
    assert_eq!(spurs.len(), 3, "one spur per branch");

    // The corridor has one port at each end and passes through every junction.
    let corridor = routes
        .iter()
        .find(|route| route.junctions.len() == 3)
        .expect("the corridor owns the junctions");
    let junctions: Vec<(i32, i32)> = corridor
        .junctions
        .iter()
        .map(|&cell| (cell.0 as i32, cell.1 as i32))
        .collect();
    assert_eq!(junctions.len(), 3, "N branches, N junctions");
    let corridor_cells: HashSet<(i32, i32)> = route_cells(corridor).into_iter().collect();
    for junction in &junctions {
        assert!(
            corridor_cells.contains(junction),
            "junction {junction:?} must sit on the corridor"
        );
    }

    // No two spurs share a cell, and each starts on its own junction.
    let mut seen: HashSet<(i32, i32)> = HashSet::new();
    let mut starts: Vec<(i32, i32)> = Vec::new();
    for spur in &spurs {
        let cells: HashSet<(i32, i32)> = route_cells(spur).into_iter().collect();
        let start = route_cells(spur)[0];
        starts.push(start);
        assert!(
            junctions.contains(&start),
            "spur {start:?} must leave a corridor junction"
        );
        let shared: Vec<&(i32, i32)> = cells.intersection(&seen).collect();
        assert!(shared.is_empty(), "two spurs share {shared:?}");
        seen.extend(cells);
    }
    starts.sort_unstable();
    starts.dedup();
    assert_eq!(starts.len(), 3, "each spur needs its own corridor cell");

    // Every branch got its own distinct port on its own border.
    let mut ports: Vec<(i32, i32)> = Vec::new();
    for spur in &spurs {
        let last = *spur.points.last().expect("a spur has an end");
        let (x, y) = (last.0.round() as i32, last.1.round() as i32);
        let touches = flow.nodes().any(|node| {
            let bounds = node.bounds();
            let (l, t) = (
                bounds.position.x.round() as i32,
                bounds.position.y.round() as i32,
            );
            let (r, b) = (
                l + bounds.dimensions.width.round() as i32 - 1,
                t + bounds.dimensions.height.round() as i32 - 1,
            );
            ((x == l - 1 || x == r + 1) && y >= t && y <= b)
                || ((y == t - 1 || y == b + 1) && x >= l && x <= r)
        });
        assert!(touches, "spur must end on a branch border at {x},{y}");
        ports.push((x, y));
    }
    ports.sort_unstable();
    ports.dedup();
    assert_eq!(ports.len(), 3, "each branch port must be its own cell");
}

/// Rebuild a `Buffer` view from the flat cell vector a render returns.
fn cells_from(cells: &[Cell]) -> ratatui::buffer::Buffer {
    let mut buffer =
        ratatui::buffer::Buffer::empty(ratatui::layout::Rect::new(0, 0, WIDTH, HEIGHT));
    for (index, cell) in cells.iter().enumerate() {
        let (x, y) = (
            (index % WIDTH as usize) as u16,
            (index / WIDTH as usize) as u16,
        );
        buffer[(x, y)] = cell.clone();
    }
    buffer
}

#[test]
fn trunk_junctions_draw_junction_glyphs_on_every_frame() {
    // A dotted edge runs beside the bus, so a dot, a bridge, and a junction
    // all compete for cells: the junction glyph must survive every frame.
    for phase in 0..8 {
        // The buffer is rendered from this very graph, so world_to_terminal
        // carries the real canvas offset.
        let (cells, flow) = render_full(TRUNK_SPEC, phase);
        let buffer = cells_from(&cells);
        let corridor = flow
            .edges()
            .iter()
            .map(|edge| edge.content.planned().expect("planned"))
            .find(|route| route.junctions.len() == 3)
            .expect("corridor");
        for &cell in &corridor.junctions {
            let (x, y) = terminal_cell(&flow, cell);
            let symbol = buffer[(x as u16, y as u16)].symbol();
            assert!(
                matches!(symbol, "┬" | "┴" | "├" | "┤"),
                "frame {phase}: junction at {x},{y} rendered as {symbol:?}"
            );
        }
        if phase == 0 && std::env::var_os("RATAFLOW_CAPTURE").is_some() {
            let text = cells
                .chunks(WIDTH as usize)
                .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write("/tmp/rataflow-trunk.txt", text).expect("capture the trunk frame");
        }
    }
    let (mut flow, report) = build(TRUNK_SPEC);
    let stats = dot_stats(&mut flow, report.extent, 24);
    assert_eq!(stats.single, 1, "the plain edge keeps one dot");
    assert_eq!(stats.violations, 0, "junctions and bridges stay dot-free");
}

/// One single-dot route, crossed by a second, static route.
const SINGLE_DOT_SPEC: &str = r#"{
  "nodes": [{"id":"a","label":"Alpha"},{"id":"b","label":"Bravo"},
            {"id":"c","label":"Charlie"},{"id":"d","label":"Delta"}],
  "layers": [["", "a", ""], ["c", "", "d"], ["", "b", ""]],
  "edges": [{"from":"a","to":"b","flow":1,"dots":1,"label":"one"},
            {"from":"c","to":"d"}]
}"#;

#[test]
fn a_single_dot_route_shows_exactly_one_dot_on_every_frame() {
    let (flow, report) = build(SINGLE_DOT_SPEC);
    // Cells of the static route: a dot may never share them (that is a
    // crossing, drawn as a bridge).
    let others: HashSet<(i32, i32)> = route_cells(
        flow.edges()[1]
            .content
            .planned()
            .expect("the crossing edge must be routed"),
    )
    .into_iter()
    .collect();
    assert!(!others.is_empty(), "the crossing edge must be routed");

    let route = flow.edges()[0].content.planned().expect("the dotted route");
    let corners: Vec<(i32, i32)> = route.points[1..route.points.len() - 1]
        .iter()
        .map(|point| (point.0 as i32, point.1 as i32))
        .collect();
    let ends = [
        (route.points[0].0 as i32, route.points[0].1 as i32),
        (
            route.points.last().expect("end").0 as i32,
            route.points.last().expect("end").1 as i32,
        ),
    ];

    for phase in 0..12 {
        let cells = render(SINGLE_DOT_SPEC, phase);
        let dots = positions(&dot_positions(&cells));
        assert_eq!(dots.len(), 1, "phase {phase} shows {} dots", dots.len());
        let (_, drawn) = render_full(SINGLE_DOT_SPEC, phase);
        let (x, y) = drawn.world_to_terminal(Position::new(dots[0].0 as f64, dots[0].1 as f64));
        let world = (x, y);
        assert!(
            !others.contains(&world),
            "phase {phase}: dot on another route"
        );
        assert!(!corners.contains(&world), "phase {phase}: dot on a corner");
        assert!(
            !ends.contains(&world),
            "phase {phase}: dot on a port or arrowhead"
        );
    }

    let (mut flow, _) = build(SINGLE_DOT_SPEC);
    let stats = dot_stats(&mut flow, report.extent, 24);
    assert_eq!(stats.single, 1, "one single-dot route");
    assert_eq!(
        stats.violations, 0,
        "single-dot rules must hold every frame"
    );
}

/// A dashed relationship: a fact the spec does not confirm yet.
const DASHED_SPEC: &str = r#"{
  "nodes": [{"id":"a","label":"Alpha"},{"id":"b","label":"Bravo"}],
  "layers": [["a"],["", "", "b"]],
  "edges": [{"from":"a","to":"b","label":"maybe","style":"dashed"}]
}"#;

#[test]
fn dashed_routes_use_dash_glyphs_and_keep_corners_and_arrowheads() {
    let cells = render(DASHED_SPEC, 0);
    let stroke = edge_stroke();
    let symbols: Vec<&str> = cells
        .iter()
        .filter(|cell| cell.fg == stroke)
        .map(|cell| cell.symbol())
        .collect();
    for dashed in ["╌", "╎"] {
        assert!(
            symbols.contains(&dashed),
            "dashed route misses the {dashed} glyph"
        );
    }
    assert!(
        symbols
            .iter()
            .any(|symbol| matches!(*symbol, "╰" | "╮" | "╭" | "╯")),
        "dashed routes keep their corners"
    );
    assert!(
        symbols
            .iter()
            .any(|symbol| matches!(*symbol, "▶" | "◀" | "▼" | "▲")),
        "dashed routes keep their arrowhead"
    );
    assert!(
        !symbols.contains(&"─") && !symbols.contains(&"│"),
        "a dashed route draws no solid straight span: {symbols:?}"
    );
}

/// Two declared groups plus one ungrouped node.
const GROUP_SPEC: &str = r#"{
  "nodes": [{"id":"a","label":"Alpha","group":"management"},
            {"id":"b","label":"Bravo","group":"management"},
            {"id":"c","label":"Charlie","group":"tenants"},
            {"id":"d","label":"Delta","group":"tenants"},
            {"id":"e","label":"Echo"}],
  "layers": [["a","b"],["c","d","e"]],
  "edges": [{"from":"a","to":"c"},{"from":"b","to":"d"},{"from":"b","to":"e"}]
}"#;

/// Hue in degrees, so two shades of one family compare as one family.
fn hue(color: Color) -> f64 {
    let Color::Rgb(r, g, b) = color else {
        panic!("group colors are RGB, got {color:?}");
    };
    let (r, g, b) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    if delta == 0.0 {
        return 0.0;
    }
    let hue = if max == r {
        60.0 * (((g - b) / delta) % 6.0)
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    (hue + 360.0) % 360.0
}

fn hue_gap(a: f64, b: f64) -> f64 {
    let diff = (a - b).abs();
    diff.min(360.0 - diff)
}

/// The same two groups as `GROUP_SPEC`, declared in the opposite order and
/// in a different layout: only the names are shared.
const GROUP_SPEC_REORDERED: &str = r#"{
  "nodes": [{"id":"c","label":"Charlie","group":"tenants"},
            {"id":"d","label":"Delta","group":"tenants"},
            {"id":"a","label":"Alpha","group":"management"},
            {"id":"b","label":"Bravo","group":"management"}],
  "edges": [{"from":"a","to":"c"},{"from":"b","to":"c"}]
}"#;

/// A group's hue comes from its NAME, so the same name paints the same color
/// even when another spec declares its groups in a different order.
#[test]
fn a_group_keeps_its_hue_across_specs() {
    let border = |spec: &str, id: &str| {
        let (flow, _) = build(spec);
        flow.nodes()
            .find(|node| node.id == id)
            .expect("node")
            .content
            .border_style
            .expect("every node has a border style")
            .fg
            .expect("the border has a color")
    };
    for id in ["a", "b", "c", "d"] {
        assert_eq!(
            border(GROUP_SPEC, id),
            border(GROUP_SPEC_REORDERED, id),
            "node {id} must keep its group's hue when the declaration order changes"
        );
    }
}

#[test]
fn nodes_sharing_a_group_share_a_color_family() {
    let (flow, report) = build(GROUP_SPEC);
    assert_eq!(
        report.groups,
        vec![("management".to_string(), 2), ("tenants".to_string(), 2)],
        "--check must list groups and member counts"
    );
    let border = |id: &str| {
        let node = flow.nodes().find(|node| node.id == id).expect("node");
        node.content
            .border_style
            .expect("every node has a border style")
            .fg
            .expect("the border has a color")
    };
    let (a, b) = (border("a"), border("b"));
    let (c, d) = (border("c"), border("d"));
    assert_ne!(a, b, "members of one group differ by shade");
    assert_ne!(c, d, "members of one group differ by shade");
    assert!(
        hue_gap(hue(a), hue(b)) < 10.0,
        "management members must share a hue family: {a:?} {b:?}"
    );
    assert!(
        hue_gap(hue(c), hue(d)) < 10.0,
        "tenants members must share a hue family: {c:?} {d:?}"
    );
    assert!(
        hue_gap(hue(a), hue(c)) > 30.0,
        "different groups must take different families: {a:?} {c:?}"
    );
    assert_ne!(
        border("e"),
        a,
        "an ungrouped node keeps the band-based color"
    );
}

/// Three labelled edges, two of them in one layer gap.
const LABEL_SPEC: &str = r#"{
  "nodes": [{"id":"a","label":"Alpha"},{"id":"b","label":"Bravo"},
            {"id":"c","label":"Charlie"}],
  "layers": [["a"],["","b"],["","","c"]],
  "edges": [{"from":"a","to":"b","label":"alpha one"},
            {"from":"b","to":"c","label":"beta two"},
            {"from":"a","to":"c","label":"gamma"}]
}"#;

#[test]
fn no_label_touches_a_route_or_a_border_and_each_maps_to_one_edge() {
    let (cells, flow) = render_full(LABEL_SPEC, 0);
    let buffer = cells_from(&cells);
    let report = build(LABEL_SPEC).1;
    assert_eq!(
        report.labels_placed, report.labels_total,
        "every label must find a cell"
    );
    assert_eq!(report.labels_on_route, 0, "no label may sit on a route");
    assert!(report.labels_skipped == 0);

    // Every drawn route cell, in world coordinates.
    let mut drawn: HashSet<(i32, i32)> = HashSet::new();
    for edge in flow.edges() {
        let route = edge.content.planned().expect("planned");
        drawn.extend(route_cells(route));
    }

    // Each label cell maps to exactly one edge id.
    let mut owner: HashMap<(i32, i32), BTreeSet<&str>> = HashMap::new();
    for edge in flow.edges() {
        let Some(label) = edge.label.as_deref() else {
            continue;
        };
        let route = edge.content.planned().expect("planned");
        let anchor = route.label.expect("no relationship label may disappear");
        let (lx, ly) = terminal_cell(&flow, anchor);
        let left = lx - label.chars().count() as i32 / 2;
        assert!(ly >= 0, "{} label above the canvas", edge.id);
        for x in left..left + label.chars().count() as i32 {
            owner.entry((x, ly)).or_default().insert(edge.id.as_str());
            assert!(
                !drawn.contains(&(x, ly)),
                "{} label sits on a route cell at {x},{ly}",
                edge.id
            );
        }
        let actual: String = (left..left + label.chars().count() as i32)
            .map(|x| buffer[(x as u16, ly as u16)].symbol())
            .collect();
        assert_eq!(&actual, label, "{} label text", edge.id);
    }
    for (cell, owners) in &owner {
        assert_eq!(owners.len(), 1, "label cell {cell:?} belongs to {owners:?}");
    }
}

#[test]
fn invalid_trunks_and_dot_counts_are_rejected_by_name() {
    let nodes = r#""nodes":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],"#;
    let edges = r#""edges":[{"from":"a","to":"b"}],"#;
    let cases = [
        (
            format!(
                r#"{{{nodes} {edges} "trunks":[{{"id":"t","from":"a","to":"zz","branches":["c"]}}]}}"#
            ),
            "zz",
        ),
        (
            format!(
                r#"{{{nodes} {edges} "trunks":[{{"id":"t","from":"a","to":"a","branches":["c"]}}]}}"#
            ),
            "itself",
        ),
        (
            format!(
                r#"{{{nodes} {edges} "trunks":[{{"id":"t","from":"a","to":"b","branches":[]}}]}}"#
            ),
            "at least one branch",
        ),
        (
            format!(
                r#"{{{nodes} {edges} "trunks":[{{"id":"t","from":"a","to":"b","branches":["c","c"]}}]}}"#
            ),
            "twice",
        ),
        (
            format!(
                r#"{{{nodes} {edges} "trunks":[{{"id":"t","from":"a","to":"b","branches":["a"]}}]}}"#
            ),
            "already the trunk",
        ),
        (
            format!(r#"{{{nodes} "edges":[{{"from":"a","to":"b","dots":2}}]}}"#),
            "dots",
        ),
        (
            format!(r#"{{{nodes} "edges":[{{"from":"a","to":"b","style":"dotted"}}]}}"#),
            "style",
        ),
    ];
    for (json, needle) in cases {
        let err = Spec::from_json(&json).expect_err(&format!("must reject: {json}"));
        let message = format!("{err:#}");
        assert!(
            message.contains(needle),
            "message {message:?} does not name {needle:?}"
        );
    }

    // The valid shape of the same trunk is accepted.
    let spec = Spec::from_json(&format!(
        r#"{{{nodes} {edges} "trunks":[{{"id":"t","from":"a","to":"b","branches":["c","d"]}}]}}"#
    ))
    .expect("a valid trunk parses");
    assert_eq!(spec.trunks.len(), 1);
    assert_eq!(spec.trunks[0].branches, vec!["c", "d"]);
}

const SELECT_SPEC: &str = r#"{
  "nodes": [{"id":"a","label":"Alpha"},{"id":"b","label":"Bravo"},
            {"id":"c","label":"Charlie"}],
  "layers": [["a"],["b"],["c"]],
  "edges": [{"from":"a","to":"b"},{"from":"b","to":"c"}]
}"#;

#[test]
fn select_all_gives_every_node_the_selected_border_in_one_frame() {
    let spec = Spec::from_json(SELECT_SPEC).expect("spec");
    let (mut flow, _) = build_flow_with_report(&spec).expect("flow");
    flow.request_fit_view_with_options(FitViewOptions {
        min_zoom: Some(1.0),
        max_zoom: Some(1.0),
        ..FitViewOptions::default()
    });
    flow.select_all_nodes();
    assert!(
        flow.nodes().all(|node| node.selected),
        "select-all must select every node"
    );
    let mut terminal = Terminal::new(TestBackend::new(WIDTH, HEIGHT)).expect("terminal");
    terminal
        .draw(|frame| draw(frame, &mut flow, "test"))
        .expect("draw");
    let buffer = terminal.backend().buffer().clone();
    // assert_perimeters pins the accent color and the uniform emphasis of a
    // selected border on every perimeter cell of every node.
    assert_perimeters(&flow, &buffer);
    let accent = flow.theme.palette().accent;
    for node in flow.nodes() {
        let (l, t, _, _) = flow.node_terminal_rect(&node.id).expect("rect");
        let cell = &buffer[(l as u16, t as u16)];
        assert_eq!(
            cell.fg, accent,
            "{} border is not the selected one",
            node.id
        );
        assert!(
            cell.modifier.contains(Modifier::BOLD),
            "{} border is not emphasized as selected",
            node.id
        );
    }
}

/// Writes a throwaway spec file for a CLI test.
fn write_spec(name: &str, body: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("rataflow-view-render-{name}.json"));
    std::fs::write(&path, body).expect("write spec fixture");
    path
}

#[test]
fn check_output_starts_with_the_measured_viewport_line() {
    let path = write_spec("viewport", SELECT_SPEC);
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let first = stdout.lines().next().expect("stdout has lines");
    assert_eq!(
        first, "viewport: unknown zoom: 1.00 natural",
        "check mode cannot measure a terminal, but must still prove the zoom"
    );
    for line in [
        "labels: 0/0 placed, 0 on route cells, 0 skipped",
        "groups:",
        "trunks:",
        "dots: 0 single-dot routes, 0 periodic routes, 0 violations",
    ] {
        assert!(
            stdout.lines().any(|line_out| line_out.starts_with(line)),
            "missing --check line {line:?} in:\n{stdout}"
        );
    }
    std::fs::remove_file(path).ok();
}

/// A clipboard-sized graph: two nodes, one single-dot route.
const FRAME_SPEC: &str = r#"{
  "nodes": [{"id":"a","label":"Alpha"},{"id":"b","label":"Bravo"}],
  "layers": [["a"],["b"]],
  "edges": [{"from":"a","to":"b","flow":1,"dots":1}]
}"#;

#[test]
fn frames_flag_renders_timestamped_frames_with_one_dot_each() {
    let path = write_spec("frames", FRAME_SPEC);
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--frames")
        .arg("5")
        .arg("--step-ms")
        .arg("100")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    assert!(
        lines[0].starts_with("viewport: "),
        "the viewport line must come first, got {:?}",
        lines[0]
    );
    let mut starts: Vec<(usize, usize)> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let Some(rest) = line.strip_prefix("frame ") else {
            continue;
        };
        let (number, at) = rest.split_once(" at ").expect("frame line shape");
        let number: usize = number.parse().expect("frame number");
        assert_eq!(
            number,
            starts.len(),
            "frames must be numbered from zero in order"
        );
        let ms: usize = at.trim_end_matches("ms").parse().expect("frame timestamp");
        starts.push((index, ms));
    }
    assert_eq!(starts.len(), 5, "expected five frames:\n{stdout}");
    for (frame, &(_, ms)) in starts.iter().enumerate() {
        assert_eq!(ms, frame * 100, "frame {frame} timestamp");
    }
    for (index, &(start, _)) in starts.iter().enumerate() {
        let end = starts
            .get(index + 1)
            .map(|&(next, _)| next)
            .unwrap_or(lines.len());
        let dots: usize = lines[start + 1..end]
            .iter()
            .map(|line| line.matches('●').count())
            .sum();
        assert_eq!(dots, 1, "frame {index} shows {dots} dots:\n{stdout}");
    }
    std::fs::remove_file(path).ok();
}

#[test]
fn frames_zero_is_rejected() {
    let path = write_spec("frames-zero", FRAME_SPEC);
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--frames")
        .arg("0")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(!out.status.success(), "--frames 0 must fail");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("--frames must be at least 1"),
        "stderr: {stderr}"
    );
    std::fs::remove_file(path).ok();
}

#[test]
fn select_all_is_accepted_with_check_and_with_frames() {
    let path = write_spec("select-all", SELECT_SPEC);
    let check = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg("--select-all")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(
        check.status.success(),
        "--check must accept --select-all: {}",
        String::from_utf8_lossy(&check.stderr)
    );
    let frames = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--frames")
        .arg("1")
        .arg("--select-all")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(frames.status.success());
    let stdout = String::from_utf8_lossy(&frames.stdout);
    assert!(
        stdout.contains("selected: 3 nodes"),
        "every node must be selected in the frame:\n{stdout}"
    );
    std::fs::remove_file(path).ok();
}

// ---------------------------------------------------------------------------
// Same-arrival dots, dot origins, crossing-aware routing, --check lines
// ---------------------------------------------------------------------------

use rataflow_view::{
    DEFAULT_DURATION_MS, DEFAULT_FLOW_RATE, MIN_DOT_CELLS, ShortRoute, Timing, dot_index,
};

/// A five-layer chain: one route spans four layer gaps, one spans a single
/// one. Both opt into the shared arrival time, so both must arrive together;
/// `flow: true` alone would run them at the constant default rate instead.
const SYNC_SPEC: &str = r#"{
  "nodes": [{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"},{"id":"e"}],
  "layers": [["a"],["b"],["c"],["d"],["e"]],
  "edges": [{"from":"a","to":"e","flow":true,"timing":"same-arrival"},
            {"from":"b","to":"c","flow":true,"timing":"same-arrival"}]
}"#;

/// The cell one step out of the source port: where a dot must start.
fn stem_cell(route: &rataflow_view::Route) -> (i32, i32) {
    let (from, to) = (route.points[0], route.points[1]);
    let step = |delta: f64| {
        if delta.abs() < 0.5 {
            0.0
        } else {
            delta.signum()
        }
    };
    (
        (from.0 + step(to.0 - from.0)) as i32,
        (from.1 + step(to.1 - from.1)) as i32,
    )
}

fn dot_span(route: &rataflow_view::Route) -> Vec<(i32, i32)> {
    route
        .dot_cells
        .iter()
        .map(|&(x, y)| (x as i32, y as i32))
        .collect()
}

/// Routes paired with their dot span, longest span last.
fn animated_routes(flow: &Graph) -> Vec<&rataflow_view::Route> {
    let mut routes: Vec<&rataflow_view::Route> = flow
        .edges()
        .iter()
        .filter(|edge| edge.content.is_flowing())
        .filter_map(|edge| edge.content.planned())
        .collect();
    routes.sort_by_key(|route| route.dot_cells.len());
    routes
}

#[test]
fn routes_of_different_lengths_reach_their_arrowhead_on_the_same_step() {
    let timing = Timing::SameArrival {
        duration_ms: DEFAULT_DURATION_MS,
    };
    assert_eq!(DEFAULT_DURATION_MS, 2000, "the shared default duration");
    let steps = (DEFAULT_DURATION_MS / 100) as usize;
    assert_eq!(steps, 20);

    let (flow, report) = build(SYNC_SPEC);
    assert!(report.short_routes.is_empty(), "{:?}", report.short_routes);
    let routes = animated_routes(&flow);
    assert_eq!(routes.len(), 2, "two animated routes");
    let (short, long) = (routes[0], routes[1]);
    let (short_n, long_n) = (short.dot_cells.len(), long.dot_cells.len());
    assert!(
        short_n >= MIN_DOT_CELLS && long_n >= MIN_DOT_CELLS,
        "both spans must animate: {short_n} and {long_n}"
    );
    assert!(
        long_n >= 4 * short_n,
        "the spans must differ a lot: {short_n} and {long_n}"
    );

    // Step 0: the first drawable cell (the source stem).
    assert_eq!(dot_index(short_n, timing, 0), Some(0));
    assert_eq!(dot_index(long_n, timing, 0), Some(0));
    // Final step: the arrowhead cell, for both, in the same wall clock.
    assert_eq!(dot_index(short_n, timing, steps), Some(short_n - 1));
    assert_eq!(dot_index(long_n, timing, steps), Some(long_n - 1));
    assert_eq!(dot_span(short)[short_n - 1], route_end(short));
    assert_eq!(dot_span(long)[long_n - 1], route_end(long));
    // The same step is a different place on each route, and the shorter
    // route is not dragged along at the longer one's speed.
    let mid_short = dot_index(short_n, timing, steps / 2).unwrap();
    let mid_long = dot_index(long_n, timing, steps / 2).unwrap();
    assert_ne!(mid_short, mid_long);
    assert_eq!(mid_short, (short_n - 1) / 2);
    assert_eq!(mid_long, (long_n - 1) / 2);

    // On the canvas: the arriving step leaves each arrowhead intact, and the
    // middle step shows each dot on its own route.
    let (cells, drawn) = render_full(SYNC_SPEC, steps / 2);
    let buffer = cells_from(&cells);
    let dot_at = |route: &rataflow_view::Route, index: usize| {
        let (x, y) = drawn.world_to_terminal(Position::new(
            route.dot_cells[index].0,
            route.dot_cells[index].1,
        ));
        buffer[(x as u16, y as u16)].symbol().to_string()
    };
    assert_eq!(dot_at(short, mid_short), "●", "short route mid-step dot");
    assert_eq!(dot_at(long, mid_long), "●", "long route mid-step dot");

    let (cells, drawn) = render_full(SYNC_SPEC, steps);
    let buffer = cells_from(&cells);
    for route in [short, long] {
        let (x, y) = drawn.world_to_terminal(Position::new(
            route.points.last().unwrap().0,
            route.points.last().unwrap().1,
        ));
        let head = buffer[(x as u16, y as u16)].symbol();
        assert!(
            matches!(head, "▲" | "▼" | "▶" | "◀"),
            "the arriving dot must not erase the head, got {head:?}"
        );
    }
}

fn route_end(route: &rataflow_view::Route) -> (i32, i32) {
    let last = *route.points.last().expect("a route has an end");
    (last.0 as i32, last.1 as i32)
}

/// One route leaving downward, one leaving sideways, one return route that
/// wraps around a box, and one long forward route with corners.
const ORIGIN_SPEC: &str = r#"{
  "nodes": [{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],
  "layers": [["a"],["b","c"],["d"]],
  "edges": [{"from":"a","to":"b","flow":true,"dots":1},
            {"from":"b","to":"c","flow":true,"dots":1},
            {"from":"d","to":"b","flow":true,"dots":1},
            {"from":"a","to":"d","flow":true,"dots":1}]
}"#;

#[test]
fn every_animated_route_starts_on_the_cell_after_its_source_port() {
    use rataflow::HandlePosition::*;
    let (flow, report) = build(ORIGIN_SPEC);
    let routes: Vec<&rataflow_view::Route> = flow
        .edges()
        .iter()
        .map(|edge| edge.content.planned().expect("every route is planned"))
        .collect();
    let mut sides = Vec::new();
    for route in &routes {
        let span = dot_span(route);
        assert!(
            span.len() >= MIN_DOT_CELLS,
            "each route must animate, got {}",
            span.len()
        );
        assert_eq!(
            span[0],
            stem_cell(route),
            "the dot must start on the source stem, not mid-route"
        );
        sides.push(route.src);
    }
    assert!(sides.contains(&Bottom), "one route must leave downward");
    assert!(
        sides.contains(&Right) || sides.contains(&Left),
        "one route must leave sideways"
    );
    // A return route leaves sideways and travels up: it wraps around a box
    // instead of starting mid-route on its way back.
    let return_route = routes
        .iter()
        .find(|route| route.tgt == Left && route.src == Left)
        .expect("a return route leaving and entering the left sides");
    let span = dot_span(return_route);
    assert!(
        span[0].0 < return_route.points[0].0 as i32,
        "the return route starts on its outward stem, left of its port"
    );
    assert!(
        report.short_routes.is_empty(),
        "all four routes can animate: {:?}",
        report.short_routes
    );

    // On the canvas at step 0, each single dot sits exactly on its origin.
    let (cells, drawn) = render_full(ORIGIN_SPEC, 0);
    let buffer = cells_from(&cells);
    for route in &routes {
        let (x, y) =
            drawn.world_to_terminal(Position::new(route.dot_cells[0].0, route.dot_cells[0].1));
        assert_eq!(
            buffer[(x as u16, y as u16)].symbol(),
            "●",
            "step 0 dot for {} -> {}",
            route.points[0].0,
            route.points[0].1
        );
    }
    let stats = dot_stats(&mut build(ORIGIN_SPEC).0, report.extent, 24);
    assert_eq!(stats.origins_ok, stats.origins_total, "{stats:?}");
    assert_eq!(stats.origins_total, 4, "{stats:?}");
    assert_eq!(stats.single, 4, "{stats:?}");
    assert_eq!(stats.violations, 0, "{stats:?}");
}

#[test]
fn duration_ms_sets_the_step_count_and_a_numeric_flow_stays_unsynchronized() {
    let quick = r#"{
      "nodes": [{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],
      "layers": [["a"],["b"],["c"],["d"]],
      "edges": [{"from":"a","to":"d","flow":true,"timing":"same-arrival","duration_ms":600,"dots":1},
                {"from":"b","to":"c","flow":0.5,"dots":1}]
    }"#;
    let parsed = Spec::from_json(quick).expect("spec");
    assert_eq!(parsed.edges[0].duration_ms(), 600);
    assert_eq!(
        parsed.edges[0].timing(),
        Timing::SameArrival { duration_ms: 600 }
    );
    assert_eq!(parsed.edges[1].timing(), Timing::Constant(0.5));
    assert_eq!(parsed.same_arrival_count(), 1);
    assert_eq!(parsed.flow_count(), 2);

    let (flow, report) = build(quick);
    let routes: Vec<&rataflow_view::Route> = flow
        .edges()
        .iter()
        .map(|edge| edge.content.planned().expect("planned"))
        .collect();
    let (sync, legacy) = (routes[0], routes[1]);
    let n = sync.dot_cells.len();
    let timing = Timing::SameArrival { duration_ms: 600 };
    // 600 ms is six steps: the dot crosses the whole span in six steps and
    // then wraps, whatever the span's length.
    assert_eq!(dot_index(n, timing, 0), Some(0));
    assert_eq!(
        dot_index(n, timing, 6),
        Some(n - 1),
        "six steps to the head"
    );
    assert_eq!(dot_index(n, timing, 7), Some(0), "then it wraps");
    // A constant route is deliberately not same-arrival: it advances by its
    // own rate, so a long route finishes much later.
    let legacy_n = legacy.dot_cells.len();
    assert_eq!(dot_index(legacy_n, Timing::Constant(0.5), 2), Some(1));
    assert_ne!(
        dot_index(legacy_n, Timing::Constant(0.5), 6),
        Some(legacy_n - 1),
        "a constant route must not arrive with the same-arrival one"
    );
    assert_ne!(
        dot_index(legacy_n, Timing::Constant(0.5), 6),
        dot_index(legacy_n, timing, 6),
        "the two motion modes must behave differently"
    );

    let stats = dot_stats(&mut build(quick).0, report.extent, 24);
    assert_eq!(stats.same_arrival, 1, "{stats:?}");
    assert_eq!(stats.same_arrival_ms, 600, "{stats:?}");
    assert_eq!(stats.constant, 1, "{stats:?}");
    assert_eq!(stats.constant_rate, 0.5, "{stats:?}");
    assert_eq!(
        stats.arrivals_ok, stats.arrivals_total,
        "the same-arrival route must touch its arrowhead on the final step: {stats:?}"
    );
    assert_eq!(stats.arrivals_total, 1, "{stats:?}");
    assert_eq!(stats.single, 2, "{stats:?}");
    assert_eq!(stats.violations, 0, "{stats:?}");
}

/// A fan-out whose first port puts a two-cell route on the canvas: too short
/// to show motion.
const SHORT_SPEC: &str = r#"{
  "nodes": [{"id":"r"},{"id":"a"},{"id":"b"}],
  "layers": [["r"],["a","b"]],
  "edges": [{"from":"r","to":"a","flow":true},
            {"from":"r","to":"b","flow":true}]
}"#;

#[test]
fn a_route_too_short_to_show_motion_is_reported_and_draws_no_dot() {
    let (flow, report) = build(SHORT_SPEC);
    assert_eq!(
        report.short_routes,
        vec![ShortRoute {
            route: "e0".to_string(),
            from: "r".to_string(),
            to: "a".to_string(),
            dot_cells: 2,
        }],
        "the short route must be reported, not animated ambiguously"
    );
    let short = flow.edges()[0].content.planned().expect("planned");
    let long = flow.edges()[1].content.planned().expect("planned");
    assert!(short.dot_cells.len() < MIN_DOT_CELLS);
    assert_eq!(
        dot_index(
            short.dot_cells.len(),
            Timing::Constant(DEFAULT_FLOW_RATE),
            0
        ),
        None
    );
    assert!(long.dot_cells.len() >= MIN_DOT_CELLS);

    // It is not counted as a valid animated route, and it never draws a dot.
    let extent = report.extent;
    let stats = dot_stats(&mut build(SHORT_SPEC).0, extent, 24);
    assert_eq!(stats.periodic, 1, "only the long route animates: {stats:?}");
    assert_eq!(stats.single, 0, "{stats:?}");
    assert_eq!(stats.constant, 1, "{stats:?}");
    assert_eq!(stats.violations, 0, "{stats:?}");

    let short_cells: HashSet<(i32, i32)> = dot_span(short).into_iter().collect();
    for phase in 0..12 {
        let (cells, drawn) = render_full(SHORT_SPEC, phase);
        let buffer = cells_from(&cells);
        for (x, y) in &short_cells {
            let (tx, ty) = drawn.world_to_terminal(Position::new(*x as f64, *y as f64));
            let symbol = buffer[(tx as u16, ty as u16)].symbol();
            assert_ne!(
                symbol, "●",
                "phase {phase}: the too-short route must draw no dot at {x},{y}"
            );
        }
    }
}

/// A long forward route can either bridge a same-layer run or take a short
/// detour around its end.
const DETOUR_SPEC: &str = r#"{
  "nodes": [{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"},{"id":"e"}],
  "layers": [["a"],["b","c"],["d","e"]],
  "edges": [{"from":"a","to":"e"},{"from":"b","to":"d"},{"from":"a","to":"c"}]
}"#;

/// A fan-out where the middle route has to cross two others.
const FORCED_CROSSING_SPEC: &str = r#"{
  "nodes": [{"id":"root"},{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],
  "layers": [["root"],["a","b","c","d"]],
  "edges": [{"from":"root","to":"a"},{"from":"root","to":"b"},
            {"from":"root","to":"c"},{"from":"root","to":"d"}]
}"#;

#[test]
fn a_short_detour_beats_a_crossing_and_crossings_count_what_remains() {
    // The detour spec: a -> e could bridge the a -> c run, but going around
    // its end costs only a few cells, so the router takes the detour.
    let (flow, report) = build(DETOUR_SPEC);
    assert_eq!(report.shared_run, 0, "no shared runs");
    assert_eq!(
        report.crossings,
        0,
        "the short detour must be chosen over a bridge: {:?}",
        flow.edges()
            .iter()
            .map(|edge| edge.content.planned().map(|r| r.points.clone()))
            .collect::<Vec<_>>()
    );
    let crossing_cells = assert_geometry(&flow);
    assert_eq!(
        crossing_cells.len(),
        report.crossings,
        "the report must agree with the drawn geometry"
    );

    // The long route really did detour: its path is longer than the
    // straight stair between its two ports.
    let long = flow.edges()[0].content.planned().expect("planned");
    let cells = route_cells(long);
    let (from, to) = (cells[0], *cells.last().unwrap());
    let straight = (to.0 - from.0).abs() + (to.1 - from.1).abs() + 1;
    assert!(
        cells.len() > straight as usize,
        "expected a detour, got {} cells for a {straight}-cell stair",
        cells.len()
    );

    // What crossings remain are counted, one per bridge cell.
    let (flow, report) = build(FORCED_CROSSING_SPEC);
    let crossing_cells = assert_geometry(&flow);
    assert!(!crossing_cells.is_empty(), "this fan-out must cross");
    assert_eq!(
        report.crossings,
        crossing_cells.len(),
        "crossings must be the number of bridge cells drawn"
    );

    // A real spec: report and geometry agree there too.
    let spec =
        Spec::from_json(include_str!("fixtures/modal-machine-lifecycle.json")).expect("spec");
    let (flow, report) = build_flow_with_report(&spec).expect("flow");
    assert_eq!(report.shared_run, 0);
    assert_eq!(report.crossings, assert_geometry(&flow).len());
}

#[test]
fn animated_routes_never_place_a_dot_on_a_corner_bridge_junction_or_arrowhead() {
    for spec in [SYNC_SPEC, ORIGIN_SPEC, TRUNK_SPEC, SHORT_SPEC] {
        let (flow, report) = build(spec);
        assert_eq!(report.shared_run, 0, "no shared runs in {spec}");
        // Every other route's cells: a dot may never land on one of them
        // (that is a bridge, and a bridge never carries a dot).
        let mut owners: HashMap<(i32, i32), usize> = HashMap::new();
        for (index, edge) in flow.edges().iter().enumerate() {
            for cell in route_cells(edge.content.planned().expect("planned")) {
                owners.entry(cell).or_insert(index);
            }
        }
        for (index, edge) in flow.edges().iter().enumerate() {
            let route = edge.content.planned().expect("planned");
            if !edge.content.is_flowing() {
                continue;
            }
            let corners: HashSet<(i32, i32)> = route.points[1..route.points.len() - 1]
                .iter()
                .map(|point| (point.0 as i32, point.1 as i32))
                .collect();
            let junctions: HashSet<(i32, i32)> = route
                .junctions
                .iter()
                .map(|&(x, y)| (x as i32, y as i32))
                .collect();
            let arrow = route_end(route);
            for cell in dot_span(route) {
                assert!(
                    !corners.contains(&cell),
                    "dot on a corner at {cell:?} in {spec}"
                );
                assert!(
                    !junctions.contains(&cell),
                    "dot on a junction at {cell:?} in {spec}"
                );
                assert!(
                    owners.get(&cell).copied().unwrap_or(index) == index,
                    "dot on another route's cell at {cell:?} in {spec}"
                );
                if cell != arrow {
                    assert_ne!(cell, route_end(route), "a dot on the head");
                }
            }
            // The arrowhead is the arrival cell: the dot span ends there so
            // the run can finish at the head, and the glyph stays on top.
            assert_eq!(
                dot_span(route).last(),
                Some(&arrow),
                "arrival cell in {spec}"
            );
        }
        let extent = report.extent;
        let stats = dot_stats(&mut build(spec).0, extent, 24);
        assert_eq!(stats.violations, 0, "dot rules in {spec}: {stats:?}");
        assert_eq!(stats.origins_ok, stats.origins_total, "{stats:?}");
    }
}

#[test]
fn check_prints_crossings_both_motion_modes_and_the_origin_proof() {
    let path = write_spec("sync", SYNC_SPEC);
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout
            .lines()
            .any(|line| line.starts_with("crossings: ")
                && line.ends_with(" bridges, 0 touching bends")),
        "missing crossings line in:\n{stdout}"
    );
    assert!(
        stdout.lines().any(|line| line
            == "dots: 0 single-dot routes, 2 periodic routes, 0 violations, 0 constant at 0.5c/step, 2 same-arrival at 2000ms"),
        "missing the same-arrival dots line in:\n{stdout}"
    );
    assert!(
        stdout
            .lines()
            .any(|line| line == "arrivals: 2/2 same-arrival routes show their dot at the arrowhead on the final step"),
        "missing the arrivals line in:\n{stdout}"
    );
    assert!(
        stdout
            .lines()
            .any(|line| line == "origins: 2/2 routes start at their arrow origin"),
        "missing the origins line in:\n{stdout}"
    );
    // The unchanged lines keep their format.
    for line in ["labels:", "groups:", "trunks:", "viewport:"] {
        assert!(
            stdout.lines().any(|out| out.starts_with(line)),
            "missing --check line {line:?} in:\n{stdout}"
        );
    }
    std::fs::remove_file(path).ok();

    // A too-short route is named by --check instead of animated silently.
    let path = write_spec("short", SHORT_SPEC);
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--check")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout
            .lines()
            .any(|line| line.starts_with("warning: route e0 (r -> a) has 2 dot cell")),
        "missing the short-route warning in:\n{stdout}"
    );
    assert!(
        stdout.lines().any(|line| line.contains(
            "1 periodic routes, 0 violations, 1 constant at 0.5c/step, 0 same-arrival at"
        )),
        "the short route must not count as animated in:\n{stdout}"
    );
    assert!(
        stdout
            .lines()
            .any(|line| line == "origins: 2/2 routes start at their arrow origin"),
        "both routes still start at their origin:\n{stdout}"
    );
    std::fs::remove_file(path).ok();
}

// ---------------------------------------------------------------------------
// Round 08: structural merge — regions, rank pins, minlen gaps
// ---------------------------------------------------------------------------

use rataflow_view::group_region_color;

/// Two weakly-connected worlds (off-rack vs in-band) in one spec: each group
/// is one bordered, titled region, side by side in one view.
const TWO_PLANES_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [
    {"id":"oob-switch","label":"oob-switch","group":"off-rack"},
    {"id":"oob-bmc","label":"oob-bmc","group":"off-rack"},
    {"id":"band-leaf","label":"band-leaf","group":"in-band"},
    {"id":"band-core","label":"band-core","group":"in-band"}
  ],
  "edges": [
    {"from":"oob-switch","to":"oob-bmc"},
    {"from":"band-leaf","to":"band-core"}
  ]
}"#;

#[test]
fn two_planes_render_as_two_titled_regions_side_by_side_in_one_view() {
    let spec = Spec::from_json(TWO_PLANES_SPEC).expect("spec");
    let (_flow, report) = build_flow_with_report(&spec).expect("flow");
    assert_eq!(report.regions.len(), 2, "{:?}", report.regions);
    let names: Vec<&str> = report.regions.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["off-rack", "in-band"], "declaration order");

    let (first, second) = (&report.regions[0], &report.regions[1]);
    // Regions sit beside each other, not stacked across the picture.
    let disjoint = first.x + first.w <= second.x || second.x + second.w <= first.x;
    assert!(disjoint, "{first:?} and {second:?} overlap: {report:?}");
    // One drawing: both start on the same top band.
    assert_eq!(first.y, second.y, "sibling regions share one view");

    let text = rendered_text(&render(TWO_PLANES_SPEC, 0));
    for region in &report.regions {
        assert!(
            text.contains(&region.name),
            "region title {:?} missing from the drawing",
            region.name
        );
    }
    assert!(text.contains('╭') && text.contains('╯'), "bordered regions");
    // Hue per region NAME, not per declaration index.
    assert_ne!(
        group_region_color("off-rack"),
        group_region_color("in-band"),
        "sibling regions must not share one hue"
    );
    assert_eq!(
        group_region_color("off-rack"),
        group_region_color("off-rack")
    );
}

/// A datacenter tier: two spines pinned above a shared leaf rank. The leaves
/// are unpinned, so the barycenter pass still orders them.
const PINNED_TIER_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [
    {"id":"spine-a","label":"spine-a"},
    {"id":"spine-b","label":"spine-b"},
    {"id":"leaf-a","label":"leaf-a"},
    {"id":"leaf-b","label":"leaf-b"}
  ],
  "layers": [["spine-a","spine-b"]],
  "edges": [
    {"from":"spine-a","to":"leaf-a"},
    {"from":"spine-b","to":"leaf-b"}
  ]
}"#;

#[test]
fn declared_rank_pins_are_honored_and_free_nodes_rank_around_them() {
    let spec = Spec::from_json(PINNED_TIER_SPEC).expect("spec");
    let (flow, report) = build_flow_with_report(&spec).expect("flow");
    assert_eq!(report.pinned, 2);
    assert!(report.pins.is_empty(), "{:?}", report.pins);

    let y = |id: &str| flow.node(id).expect(id).position.y;
    assert_eq!(y("spine-a"), y("spine-b"), "pins share rank 0");
    assert!(y("leaf-a") > y("spine-a") && y("leaf-b") > y("spine-b"));
    let x = |id: &str| flow.node(id).expect(id).position.x;
    assert_ne!(x("spine-a"), x("spine-b"), "within-rank order is automatic");
    // Nothing was silently reordered: the pinned tier is the topmost one.
    for leaf in ["leaf-a", "leaf-b"] {
        assert!(y(leaf) > y("spine-a"), "{leaf} must rank below its pin");
    }
}

/// Pins that cannot give an edge its declared `minlen` gap are reported, never
/// repaired by moving the pinned node.
const PIN_CONFLICT_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [{"id":"a"},{"id":"b"},{"id":"c"}],
  "layers": [["a"],["b"]],
  "edges": [{"from":"a","to":"b","minlen":2},{"from":"b","to":"c"}]
}"#;

#[test]
fn a_pin_that_cannot_meet_minlen_is_reported_honestly() {
    let spec = Spec::from_json(PIN_CONFLICT_SPEC).expect("spec");
    let (flow, report) = build_flow_with_report(&spec).expect("flow");
    assert_eq!(report.pinned, 2);
    assert_eq!(report.pins.len(), 1, "{:?}", report.pins);
    let conflict = &report.pins[0];
    assert_eq!((conflict.from.as_str(), conflict.to.as_str()), ("a", "b"));
    assert_eq!((conflict.minlen, conflict.available), (2, 1));
    // The declared tier is untouched; the report names the gap instead.
    assert!(flow.node("b").expect("b").position.y > flow.node("a").expect("a").position.y);
    assert!(
        conflict
            .line()
            .starts_with("pins-conflict: edge a -> b needs 2 rank gaps"),
        "{}",
        conflict.line()
    );
}

#[test]
fn minlen_opens_the_declared_rank_gaps_and_clears_the_label_slot() {
    let spec = Spec::from_json(
        r#"{"direction":"tb",
            "nodes":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}],
            "edges":[{"from":"a","to":"b","minlen":3,"label":"budget"},
                     {"from":"c","to":"d"}]}"#,
    )
    .expect("spec");
    let (flow, report) = build_flow_with_report(&spec).expect("flow");
    let y = |id: &str| flow.node(id).expect(id).position.y;
    // The declared gap is three rank steps, not one.
    let gap = y("b") - y("a");
    let plain = y("d") - y("c");
    assert!(
        gap >= plain * 2.0,
        "minlen 3 must widen the gap: {gap} vs {plain}"
    );
    // The label owns a cell strictly between the two ranks.
    let route = flow
        .edges()
        .iter()
        .find(|edge| edge.id == "e0")
        .and_then(|edge| edge.content.label_cell())
        .expect("the labelled edge owns a label cell");
    assert!(
        route.1 > y("a") && route.1 < y("b") + 4.0,
        "label {route:?} must sit in the opened gap"
    );
    assert_eq!(report.labels_ambiguous, 0);
    assert!(report.pins.is_empty());
}

#[test]
fn a_group_member_stays_inside_its_region_next_to_a_distant_consumer() {
    let spec = Spec::from_json(
        r#"{"direction":"tb",
            "nodes":[
              {"id":"r1","group":"rack"},{"id":"r2","group":"rack"},
              {"id":"r3","group":"rack"},
              {"id":"z1"},{"id":"z2"},{"id":"z3"},{"id":"z4"}],
            "edges":[
              {"from":"r1","to":"r2"},{"from":"r2","to":"r3"},
              {"from":"r1","to":"z1"},{"from":"z1","to":"z2"},
              {"from":"z2","to":"z3"},{"from":"z3","to":"z4"}]}"#,
    )
    .expect("spec");
    let (flow, report) = build_flow_with_report(&spec).expect("flow");
    let region = report
        .regions
        .iter()
        .find(|region| region.name == "rack")
        .expect("rack region");
    // The distant consumer is far below; the region must not stretch to it.
    let far = flow.node("z4").expect("z4").position.y as i32;
    assert!(
        (region.y + region.h) < far,
        "region bottom {:?} must stay above the far consumer {far}",
        region.y + region.h
    );
    // Every member is inside the region box.
    for member in ["r1", "r2", "r3"] {
        let node = flow.node(member).expect(member);
        let (x, y) = (node.position.x as i32, node.position.y as i32);
        assert!(
            x >= region.x && x + node.width as i32 <= region.x + region.w,
            "{member} x escapes the region"
        );
        assert!(
            y >= region.y && y + node.height as i32 <= region.y + region.h,
            "{member} y escapes the region"
        );
    }
}

/// A `tb` graph whose back edge leaves a left-side port with its routing
/// corridor only one cell away, so its first drawn route cell is the corner
/// glyph where the route turns. One route runs at the constant rate, the
/// other on the shared arrival clock: both must start their dot on that
/// first drawn cell.
const CORNER_FIRST_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [{"id":"n00","label":"abcdefgh"},{"id":"n01","label":"abcd"},
            {"id":"n10","label":"abcdef"},{"id":"n11","label":"a"},
            {"id":"n20","label":"abcdef"},{"id":"n21","label":"abcd"}],
  "layers": [["n00","n01"],["n10","n11"],["n20","n21"]],
  "edges": [{"from":"n21","to":"n11","flow":1},
            {"from":"n20","to":"n11","flow":true,"timing":"same-arrival","duration_ms":600}]
}"#;

/// The render-level proof of the origin rule: on frame 0 every animated
/// route draws its dot on the FIRST drawn route cell after the border port —
/// the cell `--check` measures for `origins:`. A dot one cell downstream of
/// it (the old defect) fails here, and so does a dot that skips a stem cell
/// that happens to be a corner glyph.
#[test]
fn frame_zero_puts_every_dot_on_the_first_drawn_route_cell() {
    let mut corner_first_seen = false;
    let mut timings: Vec<Timing> = Vec::new();
    for spec in [
        CORNER_FIRST_SPEC,
        ORIGIN_SPEC,
        SYNC_SPEC,
        TRUNK_SPEC,
        SINGLE_DOT_SPEC,
    ] {
        let (cells, flow) = render_full(spec, 0);
        let dots = positions(&dot_positions(&cells));
        let mut animated = 0;
        for edge in flow.edges().iter() {
            if !edge.content.is_flowing() {
                continue;
            }
            let Some(route) = edge.content.planned() else {
                continue;
            };
            if route.dot_cells.len() < MIN_DOT_CELLS {
                continue;
            }
            animated += 1;
            // The first drawn route cell, read straight off the polyline: one
            // step out of the border port, whatever glyph sits there.
            let (sx, sy) = stem_cell(route);
            let first_drawn = terminal_cell(&flow, (sx as f64, sy as f64));
            assert_eq!(
                terminal_cell(&flow, route.dot_cells[0]),
                first_drawn,
                "the dot span must start on the first drawn cell in {spec}"
            );
            assert!(
                dots.contains(&(first_drawn.0 as u16, first_drawn.1 as u16)),
                "frame 0 must draw the dot on the first drawn route cell \
                 {first_drawn:?}, got {dots:?} in {spec}"
            );
            let corners: Vec<(f64, f64)> =
                route.points[1..route.points.len().saturating_sub(1)].to_vec();
            if corners.first() == route.dot_cells.first() {
                corner_first_seen = true;
            }
            timings.push(edge.content.timing());
        }
        assert!(animated > 0, "no animated route in {spec}");
    }
    assert!(
        corner_first_seen,
        "a route whose first drawn cell is a corner glyph must be covered"
    );
    assert!(
        timings
            .iter()
            .any(|timing| matches!(timing, Timing::Constant(_))),
        "the constant rate must be covered"
    );
    assert!(
        timings
            .iter()
            .any(|timing| matches!(timing, Timing::SameArrival { .. })),
        "the same-arrival clock must be covered"
    );
}
