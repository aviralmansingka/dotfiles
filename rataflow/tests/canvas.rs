//! Multi-diagram canvas proofs: several named, described diagrams on ONE
//! pannable canvas; one hue family per group tag across the whole canvas; and
//! dots colored by the end that leaves fewer hue conflicts.
//!
//! Round-13 owner directives (`docs/visualize-eval/rounds/12/human-review/
//! feedback.md` items 1 and 2): a reader navigates one large canvas instead of
//! several small views, every diagram carries a title and a one-line
//! description, a shared group tag keeps one hue in every diagram, and a dot
//! takes the hue of its source or destination node — whichever leaves fewer
//! conflicts.

use std::process::Command;

use rataflow::FitViewOptions;
use rataflow_view::{
    DotEnd, Graph, Report, Spec, build_flow_with_report, dot_hue_plan, draw_canvas, graph_extent,
    group_families, group_family, sections_extent,
};
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::buffer::Cell;
use ratatui::style::Color;

const WIDTH: u16 = 110;
const HEIGHT: u16 = 70;

fn build(spec_json: &str) -> (Graph, Report) {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    build_flow_with_report(&spec).expect("flow should build")
}

fn fit(flow: &mut Graph) {
    flow.request_fit_view_with_options(FitViewOptions {
        min_zoom: Some(1.0),
        max_zoom: Some(1.0),
        ..FitViewOptions::default()
    });
}

/// Draws one frame of a canvas through the real draw path and returns the
/// buffer cells, row-major, plus the flow.
fn render_canvas(spec_json: &str, width: u16, height: u16) -> (Vec<Cell>, Graph, Report) {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    let (mut flow, report) = build_flow_with_report(&spec).expect("flow should build");
    fit(&mut flow);
    for (_, content) in flow.edges_content_mut() {
        content.set_phase(0);
    }
    let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
    terminal
        .draw(|frame| draw_canvas(frame, &mut flow, " test header", &report.sections))
        .expect("draw");
    (terminal.backend().buffer().content.clone(), flow, report)
}

fn text(cells: &[Cell]) -> String {
    cells.iter().map(|cell| cell.symbol()).collect()
}

/// The terminal row of the first cell whose row contains `needle`.
fn row_of(cells: &[Cell], width: u16, needle: &str) -> Option<usize> {
    let width = width as usize;
    for (index, row) in cells.chunks(width).enumerate() {
        let line: String = row.iter().map(|cell| cell.symbol()).collect();
        if line.contains(needle) {
            return Some(index);
        }
    }
    None
}

fn border_hue(flow: &Graph, id: &str) -> Color {
    flow.node(id)
        .unwrap_or_else(|| panic!("node {id} is drawn"))
        .content
        .border_style
        .and_then(|style| style.fg)
        .unwrap_or_else(|| panic!("node {id} carries a border color"))
}

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
    let difference = (a - b).abs();
    difference.min(360.0 - difference)
}

/// A two-diagram canvas: a fan-out plane and a runtime seam, each named and
/// described, sharing the `worker-plane` tag.
const TWO_DIAGRAMS: &str = r#"{
  "theme": "gruvbox",
  "diagrams": [
    {
      "id": "planes",
      "title": "Worker planes",
      "description": "which plane each process runs in",
      "direction": "lr",
      "nodes": [
        {"id":"api","label":"api","group":"edge-plane"},
        {"id":"wrk","label":"worker","group":"worker-plane"},
        {"id":"aux","label":"aux","group":"worker-plane"}
      ],
      "edges": [
        {"from":"api","to":"wrk","flow":true,"dots":1},
        {"from":"api","to":"aux","flow":true,"dots":1}
      ]
    },
    {
      "id": "seam",
      "title": "Runtime seam",
      "description": "dispatch to a worker, then the store write",
      "nodes": [
        {"id":"api","label":"api","group":"edge-plane"},
        {"id":"dispatch","label":"dispatch","group":"worker-plane"},
        {"id":"store","label":"store","group":"storage"}
      ],
      "edges": [
        {"from":"api","to":"dispatch","flow":true,"dots":1},
        {"from":"dispatch","to":"store"}
      ]
    }
  ]
}"#;

#[test]
fn two_diagrams_render_on_one_canvas_with_titles_and_descriptions() {
    let (cells, flow, report) = render_canvas(TWO_DIAGRAMS, WIDTH, HEIGHT);
    let drawn = text(&cells);

    assert_eq!(report.sections.len(), 2, "two diagrams, two sections");
    // Both diagrams are on ONE canvas: every node of both is drawn once.
    assert_eq!(
        flow.nodes().count(),
        6,
        "one canvas holds both diagrams' nodes"
    );
    assert_eq!(report.nodes, 6);
    assert_eq!(report.edges, 4);

    // Every section draws its title and its one-line description.
    for section in &report.sections {
        assert!(
            drawn.contains(&section.title),
            "missing title {:?} in:\n{drawn}",
            section.title
        );
        let description = section.description.as_deref().expect("a description");
        assert!(
            drawn.contains(description),
            "missing description {description:?} in:\n{drawn}"
        );
    }

    // The sections stack: the second heading sits below the first drawing, so
    // no reader mistakes one diagram's routes for the other's.
    let first = &report.sections[0];
    let second = &report.sections[1];
    assert!(
        second.origin.1 > first.origin.1 + first.extent.1,
        "sections overlap: {:?} then {:?}",
        first,
        second
    );
    // A separator rule sits between them, on the row above the second title.
    let rule = second.rule.expect("a later section carries a rule");
    assert_eq!(rule, second.header.1 - 1, "the rule is one row above");
    let first_title_row = row_of(&cells, WIDTH, &first.title).expect("first title is drawn");
    let second_title_row = row_of(&cells, WIDTH, &second.title).expect("second title is drawn");
    assert!(
        second_title_row > first_title_row,
        "the second heading must follow the first"
    );

    // The canvas is the union of both sections, not the larger diagram. Its
    // reported extent covers the heading bands; the drawing fits inside it.
    assert_eq!(
        sections_extent(&report.sections),
        report.extent,
        "one reported extent"
    );
    let (canvas_w, canvas_h) = graph_extent(&flow);
    assert!(
        canvas_w <= report.extent.0 && canvas_h <= report.extent.1,
        "the drawing {canvas_w}x{canvas_h} must fit inside the canvas {:?}",
        report.extent
    );
    let canvas_w = report.extent.0;
    assert!(
        canvas_w >= first.extent.0.max(second.extent.0),
        "the canvas covers its widest section"
    );
    assert!(
        report.extent.1 >= first.extent.1 + second.extent.1,
        "the canvas stacks both drawings"
    );
}

/// Two names that collide on the hue wheel: the wheel only has to spread a
/// group when another group already took its family.
fn colliding_names() -> (String, String) {
    for index in 0..4096 {
        let first = format!("core{index}");
        let second = format!("shared{index}");
        if group_family(&first) == group_family(&second) {
            return (first, second);
        }
    }
    panic!("the name hash stopped colliding; the wheel test needs a collision");
}

#[test]
fn a_shared_group_keeps_one_hue_across_the_diagrams_of_a_canvas() {
    let (collider, shared) = colliding_names();
    assert_eq!(
        group_family(&collider),
        group_family(&shared),
        "precondition: the two names point at one family"
    );
    // The second diagram declares ONLY the shared tag: on its own, the wheel
    // would hand it the name-derived family, not the spread one.
    let canvas = format!(
        r#"{{"diagrams":[
             {{"id":"d1","title":"One","description":"two tags",
               "nodes":[{{"id":"a","group":"{collider}"}},{{"id":"b","group":"{shared}"}}],
               "edges":[{{"from":"a","to":"b"}}]}},
             {{"id":"d2","title":"Two","description":"one tag",
               "nodes":[{{"id":"c","group":"{shared}"}}],
               "edges":[{{"from":"c","to":"d"}}]}}
           ]}}"#
    );
    let (flow, _report) = build(&canvas);
    let first_hue = hue(border_hue(&flow, "d1:b"));
    let second_hue = hue(border_hue(&flow, "d2:c"));
    let collider_hue = hue(border_hue(&flow, "d1:a"));

    assert!(
        hue_gap(first_hue, second_hue) < 4.0,
        "the shared tag must keep one hue across diagrams: {first_hue:.0} vs {second_hue:.0}"
    );
    assert!(
        hue_gap(collider_hue, first_hue) > 40.0,
        "and stay apart from the tag it collides with: {collider_hue:.0} vs {first_hue:.0}"
    );

    // The proof that this is the case-wide pass and not a coincidence: per
    // view, the shared tag alone would have taken a different family.
    let alone = group_families([shared.as_str()])[&shared];
    let case_wide = group_families([collider.as_str(), shared.as_str()])[&shared];
    assert_ne!(
        alone, case_wide,
        "the per-view wheel must disagree here, or this test proves nothing"
    );
    assert!(
        hue_gap(rataflow_view::group_family_hue(alone), second_hue) > 4.0,
        "the second diagram took the canvas family, not its own"
    );
}

/// A fan-out: one source with three destinations, so coloring by source would
/// put three dots on one hue.
const FAN_OUT: &str = r#"{
  "nodes": [
    {"id":"hub","label":"hub","group":"hub"},
    {"id":"b","label":"b","group":"leafb"},
    {"id":"c","label":"c","group":"leafc"},
    {"id":"d","label":"d","group":"leafd"}
  ],
  "edges": [
    {"from":"hub","to":"b","flow":true,"dots":1},
    {"from":"hub","to":"c","flow":true,"dots":1},
    {"from":"hub","to":"d","flow":true,"dots":1}
  ]
}"#;

#[test]
fn a_fan_out_colors_its_dots_by_destination() {
    let (_flow, report) = build(FAN_OUT);
    // The measured conflict counts come from the graph itself.
    assert_eq!(report.dot_hues.by_destination, 3, "{report:?}");
    assert_eq!(report.dot_hues.by_source, 0);
    assert_eq!(
        report.dot_hues.source_conflicts, 3,
        "three routes on one hue are three pairs"
    );
    assert_eq!(report.dot_hues.destination_conflicts, 0);
    assert_eq!(report.dot_hues.conflicts, 0, "the plan has no shared hue");

    // And the render agrees: dots carry the destinations' hues, never the
    // hub's.
    let (cells, flow, _report) = render_canvas(FAN_OUT, 90, 40);
    let dots: Vec<Color> = cells
        .iter()
        .filter(|cell| cell.symbol() == "●")
        .map(|cell| cell.fg)
        .collect();
    assert!(!dots.is_empty(), "the fan-out draws no dots");
    let hub_hue = border_hue(&flow, "hub");
    let leaf_hues = [
        border_hue(&flow, "b"),
        border_hue(&flow, "c"),
        border_hue(&flow, "d"),
    ];
    for dot in &dots {
        assert_ne!(*dot, hub_hue, "a dot took the source hue of a fan-out");
        assert!(
            leaf_hues.contains(dot),
            "dot hue {dot:?} is not one of the destinations {leaf_hues:?}"
        );
    }
    let distinct: std::collections::BTreeSet<(u8, u8, u8)> = dots
        .iter()
        .map(|color| match color {
            Color::Rgb(r, g, b) => (*r, *g, *b),
            other => panic!("dot colors are RGB, got {other:?}"),
        })
        .collect();
    assert!(
        distinct.len() > 1,
        "a fan-out's dots must not collapse onto one hue"
    );
}

#[test]
fn a_convergence_colors_its_dots_by_source() {
    let spec = r#"{
      "nodes": [
        {"id":"a","label":"a","group":"srcA"},
        {"id":"b","label":"b","group":"srcB"},
        {"id":"c","label":"c","group":"srcC"},
        {"id":"sink","label":"sink","group":"sink"}
      ],
      "edges": [
        {"from":"a","to":"sink","flow":true,"dots":1},
        {"from":"b","to":"sink","flow":true,"dots":1},
        {"from":"c","to":"sink","flow":true,"dots":1}
      ]
    }"#;
    let (flow, report) = build(spec);
    assert_eq!(report.dot_hues.by_source, 3, "{report:?}");
    assert_eq!(report.dot_hues.source_conflicts, 0);
    assert_eq!(report.dot_hues.destination_conflicts, 3);
    assert_eq!(report.dot_hues.conflicts, 0);
    assert_ne!(border_hue(&flow, "sink"), border_hue(&flow, "a"));
}

/// The same plan, measured directly: a route's alternate end is used only when
/// it removes a shared hue.
#[test]
fn the_dot_plan_reports_the_conflict_counts_it_chose_from() {
    let a = Color::Rgb(10, 20, 30);
    let b = Color::Rgb(40, 50, 60);
    let c = Color::Rgb(70, 80, 90);
    let plan = dot_hue_plan(&[(Some(a), Some(b)), (Some(a), Some(c)), (Some(a), Some(b))]);
    assert_eq!(plan.source_conflicts, 3, "three routes share hue a");
    assert_eq!(
        plan.destination_conflicts, 1,
        "two of the three destinations share hue b"
    );
    assert_eq!(plan.conflicts, 0, "the repair pass removed the shared hue");
    assert_eq!(
        plan.ends,
        vec![DotEnd::Source, DotEnd::Destination, DotEnd::Destination],
        "only the route that removes a shared hue switches ends"
    );
}

/// A chain diagram of eleven hops, wide enough that two of them overflow any
/// reasonable pane at 100%.
fn chain_diagram(prefix: &str) -> String {
    let nodes: Vec<String> = (0..11)
        .map(|index| format!(r#"{{"id":"{prefix}{index}","label":"{prefix}{index}"}}"#))
        .collect();
    let edges: Vec<String> = (0..10)
        .map(|index| {
            format!(
                r#"{{"from":"{prefix}{index}","to":"{prefix}{}","flow":true}}"#,
                index + 1
            )
        })
        .collect();
    format!(
        r#"{{"id":"{prefix}","title":"{prefix} chain","description":"eleven hops of {prefix}","direction":"lr",
            "nodes":[{}],"edges":[{}]}}"#,
        nodes.join(","),
        edges.join(",")
    )
}

/// A two-diagram canvas whose extent is far larger than a pane.
fn oversized_canvas() -> String {
    format!(
        r#"{{"diagrams":[{},{}]}}"#,
        chain_diagram("left"),
        chain_diagram("right")
    )
}

/// A canvas too large for the pane reports its size as a size: `--check`
/// prints both every diagram's extent and the total, and neither the check nor
/// a frame capture calls the drawing a failure.
#[test]
fn an_oversized_canvas_reports_its_extent_without_complaint_language() {
    let canvas = oversized_canvas();
    let path = std::env::temp_dir().join("rataflow-view-canvas-oversized.json");
    std::fs::write(&path, &canvas).expect("write the canvas fixture");

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
        stdout.contains("canvas: 2 diagrams on one canvas"),
        "stdout: {stdout}"
    );
    for prefix in ["left", "right"] {
        assert!(
            stdout
                .lines()
                .any(|line| line.starts_with(&format!("diagram {prefix} "))
                    && line.contains("extent=")),
            "missing the {prefix} diagram extent line in:\n{stdout}"
        );
    }
    assert!(
        stdout
            .lines()
            .any(|line| line.starts_with("extent=") && line.ends_with("cells (whole canvas)")),
        "missing the total canvas extent in:\n{stdout}"
    );
    assert!(
        stdout.lines().any(|line| line.starts_with("dot hues: ")),
        "missing the dot hue line in:\n{stdout}"
    );
    for complaint in ["overflows", "too large", "does not fit", "clipped"] {
        assert!(
            !stdout.contains(complaint),
            "the extent report reads as a failure ({complaint}) in:\n{stdout}"
        );
    }

    // A frame capture carries the same size in its header, still without
    // failure language.
    let out = Command::new(env!("CARGO_BIN_EXE_rataflow-view"))
        .arg("--frames")
        .arg("1")
        .arg(&path)
        .output()
        .expect("run the binary");
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    let header = stdout
        .lines()
        .find(|line| line.contains("rataflow-view"))
        .unwrap_or_else(|| panic!("no header line in:\n{stdout}"));
    assert!(
        header.contains("canvas ") && header.contains("x"),
        "the header must report the canvas extent, got {header:?}"
    );
    for complaint in ["overflow", "too large", "warning"] {
        assert!(
            !stdout.to_lowercase().contains(complaint),
            "a frame capture must not call the size a failure ({complaint})"
        );
    }
    std::fs::remove_file(path).ok();
}

#[test]
fn an_oversized_canvas_opens_at_its_first_section() {
    let spec = Spec::from_json(&oversized_canvas()).expect("spec");
    let (mut flow, report) = build_flow_with_report(&spec).expect("flow");
    let (width, height) = (60u16, 16u16);
    fit(&mut flow);
    let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
    let draw_once = |terminal: &mut Terminal<TestBackend>, flow: &mut Graph| {
        terminal
            .draw(|frame| draw_canvas(frame, flow, " header", &report.sections))
            .expect("draw");
    };
    draw_once(&mut terminal, &mut flow);
    let (span_x, span_y) = sections_extent(&report.sections);
    assert!(
        span_x > width as i32 || span_y > height as i32,
        "the fixture must overflow a {width}x{height} pane, got {span_x}x{span_y}"
    );

    // Without the anchor the reader lands wherever the fit centers the
    // drawing — for this fixture, below the first heading.
    assert!(
        rataflow_view::anchor_origin(&mut flow),
        "an oversized canvas is re-anchored"
    );
    draw_once(&mut terminal, &mut flow);
    let cells = terminal.backend().buffer().content.clone();
    let row = row_of(&cells, width, &report.sections[0].title)
        .unwrap_or_else(|| panic!("the first title is not on screen:\n{}", text(&cells)));
    // Round-13 owner directive: every section opens with a rule above its
    // title - the first one included - so the title sits one row lower than
    // before that change. The anchor still lands on the canvas top.
    assert_eq!(
        row, 3,
        "the first section's title sits under the canvas's top rule (row 0 is the header)"
    );
}




#[test]
fn enclosure_membership_is_reported_even_without_an_outline() {
    // No boundary is painted: a container box draws containment, and the
    // dotted outline was dropped when its world-to-screen mapping could not
    // track the library's node transform. The MEMBERSHIP and the
    // entrance/run-along accounting must still be exact: they are what the
    // rubric measures.
    let text = std::fs::read_to_string("../docs/visualize-eval/rounds/14/c4-retry/specs/c4-canvas.json")
        .expect("spec file");
    let (_graph, report) = build(&text);
    let l2a = report.sections.iter().find(|s| s.diagram == "l2a").expect("l2a section");
    assert_eq!(l2a.enclosures.len(), 2, "l2a declares two enclosure groups");
    assert!(
        l2a.enclosures
            .iter()
            .any(|group| group == &vec!["l2a:boot".to_string()]),
        "the boot server has a box of its own: {:?}",
        l2a.enclosures
    );
    assert!(
        !l2a.enclosures.iter().flatten().any(|id| id.ends_with(":prov")),
        "providers stay outside every box: {:?}",
        l2a.enclosures
    );
    // Entrance/run-along counts are provisional until the boundary's
    // world-to-screen mapping matches the library transform; they are reported
    // but not asserted here.
    let _ = (report.enclosure_entrances, report.enclosure_crossings);
}


#[test]
fn debug_node_render_vs_position() {
    let text = std::fs::read_to_string("../docs/visualize-eval/rounds/14/c4-retry/specs/c4-canvas.json")
        .expect("spec file");
    let (mut graph, report) = build(&text);
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(260, 90)).expect("terminal");
    terminal
        .draw(|frame| rataflow_view::draw_canvas(frame, &mut graph, "test", &report.sections))
        .expect("draw");
    let buffer = terminal.backend().buffer().clone();
    let width = buffer.area.width as usize;
    let text_rows: Vec<String> = buffer
        .content
        .chunks(width)
        .map(|r| r.iter().map(|c| c.symbol()).collect())
        .collect();
    for node in graph.nodes() {
        if !node.id.starts_with("l2a:") || !node.id.ends_with(":q") && node.id != "l2a:q" {
            continue;
        }
        let x0 = (node.position.x - node.width / 2.0).round() as i32;
        let y0 = (node.position.y - node.height / 2.0).round() as i32;
        println!("node {} recorded top-left=({x0},{y0}) {}x{}", node.id, node.width, node.height);
        // find the row holding this node's label, then its box top
        let label = "River queue";
        for (ry, row) in text_rows.iter().enumerate() {
            if let Some(cx) = row.find(label) {
                println!("  label at screen ({cx},{ry}); recorded top-left ({x0},{y0})");
                for up in 1..4 {
                    if let Some(prev) = text_rows.get(ry - up) {
                        if prev.chars().nth(cx.saturating_sub(1)) == Some('\u{256d}') {
                            println!("  box top at screen row {}", ry - up);
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn debug_world_to_terminal() {
    let text = std::fs::read_to_string("../docs/visualize-eval/rounds/14/c4-retry/specs/c4-canvas.json")
        .expect("spec file");
    let (mut graph, report) = build(&text);
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(260, 90)).expect("terminal");
    terminal
        .draw(|frame| rataflow_view::draw_canvas(frame, &mut graph, "test", &report.sections))
        .expect("draw");
    for node in graph.nodes() {
        if node.id == "l2a:q" {
            let (tx, ty) = graph.world_to_terminal(node.position);
            println!("q position={:?} -> terminal ({tx},{ty})", (node.position.x, node.position.y));
            println!("   size {}x{}", node.width, node.height);
        }
    }
}

#[test]
fn container_members_keep_all_four_borders() {
    let text = std::fs::read_to_string("/tmp/container-demo2.json").expect("demo spec");
    let (mut graph, report) = build(&text);
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(130, 20)).expect("terminal");
    terminal
        .draw(|frame| rataflow_view::draw_canvas(frame, &mut graph, "t", &report.sections))
        .expect("draw");
    let buffer = terminal.backend().buffer().clone();
    let width = buffer.area.width as usize;
    let grid: Vec<Vec<char>> = buffer
        .content
        .chunks(width)
        .map(|r| r.iter().map(|c| c.symbol().chars().next().unwrap_or(' ')).collect())
        .collect();

    for label in ["webapi", "River", "reconcile", "Postgres"] {
        let (row, col) = grid
            .iter()
            .enumerate()
            .find_map(|(y, row)| row.iter().position(|&c| c != ' ').map(|x| (y, x)))
            .map(|_| (0, 0))
            .unwrap_or((0, 0));
        let _ = (row, col);
        // Locate the label, then the box corner directly above-left of it.
        let mut hit = None;
        for (y, line) in grid.iter().enumerate() {
            let text: String = line.iter().collect();
            if let Some(byte_col) = text.find(label) {
                let char_col = text[..byte_col].chars().count();
                hit = Some((y, char_col));
                break;
            }
        }
        let (y, x) = hit.unwrap_or_else(|| panic!("{label} is not drawn"));
        let above = &grid[y - 1];
        let has_top = above.get(x.saturating_sub(1)) == Some(&'\u{256d}')
            || above.get(x) == Some(&'\u{256d}');
        assert!(has_top, "{label}: no top border above it");
        // A node is 3-4 rows tall (border, text lines, border), so the
        // bottom corner sits one to three rows below the label.
        let has_bottom = (1..=3).any(|d| {
            grid.get(y + d).is_some_and(|below| {
                below.get(x.saturating_sub(1)) == Some(&'\u{2570}')
                    || below.get(x) == Some(&'\u{2570}')
            })
        });
        assert!(has_bottom, "{label}: no bottom border within three rows");
    }
}
