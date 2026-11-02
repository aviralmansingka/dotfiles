//! Guard-rail fixtures for structure the engine must never silently give up:
//!
//! - **pins**: a datacenter-style fabric whose two spines are pinned above a
//!   shared leaf row must render the spines strictly above that row.
//! - **trunk**: one bus with two branches must split ONCE, so the drawing
//!   carries exactly one junction glyph.
//!
//! Both are rendered through the real `draw` path, so the guard is on the
//! pixels, not only on the plan.

use rataflow::FitViewOptions;
use rataflow_view::{Graph, Report, Spec, build_flow_with_report, draw};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::buffer::Cell;

const WIDTH: u16 = 90;
const HEIGHT: u16 = 40;

/// Renders one frame at the given animation phase, the way the event loop
/// does: the phase is pushed into every edge, then the graph is drawn.
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
        .draw(|frame| draw(frame, &mut flow, " guards"))
        .expect("draw");
    (terminal.backend().buffer().content.clone(), flow)
}

fn build(spec_json: &str) -> (Graph, Report) {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    build_flow_with_report(&spec).expect("flow should build")
}

/// `(x, y, w, h)` of one node box, in graph cells.
fn node_box(flow: &Graph, id: &str) -> (i32, i32, i32, i32) {
    let bounds = flow
        .nodes()
        .find(|node| node.id == id)
        .unwrap_or_else(|| panic!("node {id} must exist"))
        .bounds();
    (
        bounds.position.x.round() as i32,
        bounds.position.y.round() as i32,
        bounds.dimensions.width.round() as i32,
        bounds.dimensions.height.round() as i32,
    )
}

/// Two spines pinned into one rank above a shared leaf row: the fabric shape
/// a datacenter view declares with `layers`.
const FABRIC_PINS_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [{"id":"spine-a","label":"Spine A"},
            {"id":"spine-b","label":"Spine B"},
            {"id":"leaf","label":"Leaf row"}],
  "layers": [["spine-a","spine-b"],["leaf"]],
  "edges": [{"from":"spine-a","to":"leaf"},
            {"from":"spine-b","to":"leaf"}]
}"#;

#[test]
fn pinned_spines_render_strictly_above_the_shared_leaf_row() {
    let (flow, report) = build(FABRIC_PINS_SPEC);
    assert_eq!(report.pinned, 3, "every node is pinned: {report:?}");
    assert!(
        report.pins.is_empty(),
        "the declared pins must not conflict: {:?}",
        report.pins
    );

    let (sx_a, sy_a, _, sh_a) = node_box(&flow, "spine-a");
    let (sx_b, sy_b, _, sh_b) = node_box(&flow, "spine-b");
    let (_, leaf_y, _, _) = node_box(&flow, "leaf");

    // One pinned rank: both spines share the same row.
    assert_eq!(sy_a, sy_b, "both spines sit in the declared rank");
    // Strictly above: the last spine row is above the leaf's first row, with
    // at least one row of channel between them for the two ports and heads.
    let spine_bottom = sy_a.max(sy_b) + sh_a.max(sh_b) - 1;
    assert!(
        spine_bottom + 1 < leaf_y,
        "spines must end above the leaf row: spine bottom {spine_bottom}, \
         leaf top {leaf_y} (spines at x {sx_a}/{sx_b})"
    );

    // The pixels agree with the boxes: the leaf's label row renders below the
    // spine rank's own rows.
    let (cells, drawn) = render_full(FABRIC_PINS_SPEC, 0);
    let leaf_cell = drawn.world_to_terminal(rataflow::Position::new(0.0, leaf_y as f64));
    let text: String = cells
        .chunks(WIDTH as usize)
        .nth(leaf_cell.1 as usize + 1)
        .map(|row| row.iter().map(Cell::symbol).collect())
        .unwrap_or_default();
    assert!(
        text.contains("Leaf row"),
        "the leaf label must render on its own row {:?}: {text:?}",
        (leaf_cell.0, leaf_cell.1 + 1)
    );
    let spine_row = drawn.world_to_terminal(rataflow::Position::new(0.0, sy_a as f64));
    assert!(
        spine_row.1 < leaf_cell.1,
        "the spine rank renders above the leaf row: {spine_row:?} vs {leaf_cell:?}"
    );
}

/// One bus from `spine` to `gateway` with two branches: the split-once
/// shape the round-08 GB300 case asked for.
const TRUNK_ONE_SPLIT_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [{"id":"spine","label":"Spine"},
            {"id":"leaf-a","label":"Leaf A"},
            {"id":"leaf-b","label":"Leaf B"},
            {"id":"gateway","label":"Gateway"}],
  "layers": [["spine"],["leaf-a","leaf-b"],["gateway"]],
  "edges": [{"from":"spine","to":"gateway"}],
  "trunks": [{"id":"bus","from":"spine","to":"gateway","branches":["leaf-a","leaf-b"]}]
}"#;

/// Glyphs that mean "strokes meet here".
const JUNCTION_GLYPHS: [&str; 5] = ["┬", "┴", "├", "┤", "┼"];

fn junction_cells(cells: &[Cell]) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    for (index, cell) in cells.iter().enumerate() {
        if JUNCTION_GLYPHS.contains(&cell.symbol()) {
            found.push((index % WIDTH as usize, index / WIDTH as usize));
        }
    }
    found
}

#[test]
fn one_bus_with_two_branches_renders_exactly_one_junction() {
    let (flow, report) = build(TRUNK_ONE_SPLIT_SPEC);
    assert_eq!(report.trunks.len(), 1, "one trunk: {report:?}");
    let trunk = &report.trunks[0];
    assert_eq!(
        (trunk.id.as_str(), trunk.branches),
        ("bus", 2),
        "the bus owns two branches"
    );
    assert_eq!(trunk.junctions, 1, "one split point: {report:?}");
    assert_eq!(report.junctions, 1, "one junction cell: {report:?}");

    let corridor = flow
        .edges()
        .iter()
        .filter_map(|edge| edge.content.planned())
        .find(|route| !route.detached_src && !route.junctions.is_empty())
        .expect("the corridor owns the junction");
    let junction = (
        corridor.junctions[0].0 as usize,
        corridor.junctions[0].1 as usize,
    );

    // Every drawn frame carries the junction, and only that one.
    for phase in 0..4 {
        let (cells, drawn) = render_full(TRUNK_ONE_SPLIT_SPEC, phase);
        let found = junction_cells(&cells);
        assert_eq!(
            found.len(),
            1,
            "phase {phase}: one junction glyph, got {found:?}"
        );
        let expected = drawn.world_to_terminal(rataflow::Position::new(
            junction.0 as f64,
            junction.1 as f64,
        ));
        assert_eq!(
            found[0],
            (expected.0 as usize, expected.1 as usize),
            "phase {phase}: the junction sits on the corridor cell the plan reserved"
        );
    }
}
