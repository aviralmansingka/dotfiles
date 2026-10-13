//! Headless render proof: a built flow draws its node and edge labels into
//! a ratatui buffer through `TestBackend`, without a real terminal.

use rataflow::Background;
use rataflow_view::{Spec, build_flow};
use ratatui::Terminal;
use ratatui::backend::TestBackend;

fn rendered_text(spec_json: &str) -> String {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    let mut flow = build_flow(&spec).expect("flow should build");
    flow.request_fit_view();

    let mut terminal = Terminal::new(TestBackend::new(90, 30)).expect("terminal");
    terminal
        .draw(|frame| {
            let area = frame.area();
            frame.render_widget(Background::new(&flow), area);
            frame.render_widget(&mut flow, area);
        })
        .expect("draw");
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect()
}

#[test]
fn renders_node_labels_into_the_buffer() {
    let text = rendered_text(
        r#"{"direction":"lr",
            "nodes":[{"id":"ingest","label":"Ingest"},
                     {"id":"serve","label":"Serving shard"}],
            "edges":[{"from":"ingest","to":"serve","label":"grpc"}]}"#,
    );
    assert!(text.contains("Ingest"), "node label missing from buffer");
    assert!(
        text.contains("Serving shard"),
        "long node label missing from buffer"
    );
}

#[test]
fn renders_a_top_to_bottom_graph_without_a_nodes_block() {
    let text = rendered_text(r#"{"edges":[{"from":"start","to":"end"}]}"#);
    assert!(text.contains("start"), "implicit node missing from buffer");
    assert!(text.contains("end"), "implicit node missing from buffer");
}
