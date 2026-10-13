//! The `rataflow-view` binary renders a JSON graph spec as a live,
//! pannable node graph in the current terminal pane. Open it in a herdr
//! pane so the human sees it beside the conversation:
//!
//! ```text
//! herdr pane split --current --direction right --ratio 0.5 --no-focus
//! herdr pane run <pane-id> "rataflow-view graph.json"
//! ```
//!
//! `rataflow-view --check graph.json` validates a spec and prints a
//! summary without needing a terminal — the pre-flight check for agents.

use std::io::stdout;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use rataflow::{EventResponse, FlowEvent};
use rataflow_view::{ANIMATION_STEP_MS, FlowEdge, Graph, Spec, build_flow, draw};
use ratatui::DefaultTerminal;
use ratatui::crossterm::{
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event as CtEvent, KeyCode, KeyEventKind,
        KeyModifiers,
    },
    execute,
};

const USAGE: &str = "\
rataflow-view — render a JSON node/edge spec as a live node graph

usage:
  rataflow-view <spec.json>            open the live viewer (needs a real terminal pane)
  rataflow-view --check <spec.json>    validate the spec and print a summary, no terminal needed
  rataflow-view --help                 show this help

spec fields: direction (tb|lr), theme (gruvbox|dark|light),
nodes (id, label?), edges (from, to, label?, flow?)
flow: true or a positive speed — animated dots travel from \"from\" to \"to\";
      the number is the speed (1 = 10 cells/second, 2 = twice that)
";

fn main() {
    let code = match run() {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("rataflow-view: {err:#}");
            1
        }
    };
    std::process::exit(code);
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (check_only, path) = match args.as_slice() {
        [] => bail!("{USAGE}"),
        [flag] if flag == "--help" || flag == "-h" => {
            print!("{USAGE}");
            return Ok(());
        }
        [flag, path] if flag == "--check" => (true, path.clone()),
        [path] => (false, path.clone()),
        _ => bail!("{USAGE}"),
    };

    let text = std::fs::read_to_string(&path).with_context(|| format!("reading {path}"))?;
    let spec = Spec::from_json(&text)?;
    let mut flow = build_flow(&spec)?;

    if check_only {
        let direction = match spec.direction {
            rataflow_view::Direction::TopToBottom => "tb",
            rataflow_view::Direction::LeftToRight => "lr",
        };
        println!(
            "ok: nodes={} edges={} flows={} direction={direction} theme={}",
            flow.nodes().count(),
            spec.edges.len(),
            spec.flow_count(),
            spec.theme_label(),
        );
        return Ok(());
    }

    let header = header_line(&spec, flow.nodes().count(), &path);

    let mut terminal = ratatui::try_init().context("initializing the terminal")?;
    let result = (|| {
        execute!(stdout(), EnableMouseCapture)?;
        let outcome = live(&mut terminal, &mut flow, &header);
        execute!(stdout(), DisableMouseCapture)?;
        outcome
    })();
    ratatui::restore();
    result
}

/// The event loop: draw, then drain every pending input event before the
/// next frame (raw mouse streams at up to 1000 Hz and lags visibly if the
/// queue is not drained — the rataflow README's one operational gotcha).
///
/// Each frame also advances the flow-dot clock — a 3-step phase counter
/// stepped every [`ANIMATION_STEP_MS`] — and pushes the phase into every
/// edge, so the dots keep moving even when no input arrives. rataflow's
/// own animation clock stays crate-private, so the phase lives here.
fn live(terminal: &mut DefaultTerminal, flow: &mut Graph, header: &str) -> Result<()> {
    flow.request_fit_view();
    let mut last_tick = Instant::now();
    let mut anim_leftover_ms: u64 = 0;
    let mut anim_phase: usize = 0;
    'app: loop {
        let now = Instant::now();
        let elapsed = now - last_tick;
        last_tick = now;
        flow.tick_auto_pan(elapsed);

        anim_leftover_ms += elapsed.as_millis() as u64;
        while anim_leftover_ms >= ANIMATION_STEP_MS {
            anim_leftover_ms -= ANIMATION_STEP_MS;
            // Unbounded on purpose: an ever-growing phase keeps dot motion
            // free of wrap seams and aliasing at every speed.
            anim_phase = anim_phase.wrapping_add(1);
        }
        for (_, content) in flow.edges_content_mut() {
            content.set_phase(anim_phase);
        }

        terminal.draw(|frame| draw(frame, flow, header))?;

        if !event::poll(Duration::from_millis(16))? {
            continue;
        }
        loop {
            match event::read()? {
                CtEvent::Key(key) if key.kind == KeyEventKind::Press => {
                    let quitting = key.code == KeyCode::Char('q')
                        || key.code == KeyCode::Esc
                        || (key.code == KeyCode::Char('c')
                            && key.modifiers.contains(KeyModifiers::CONTROL));
                    if quitting {
                        break 'app;
                    }
                    let response = flow.handle_controls_key_event(key);
                    if matches!(response, EventResponse::NotHandled) {
                        flow.handle_key_event(key);
                    }
                }
                CtEvent::Mouse(mouse) => {
                    for event in flow.handle_mouse_event(mouse).into_events() {
                        match event {
                            FlowEvent::ConnectionCompleted(connection) => {
                                flow.add_edge_from_connection(connection, FlowEdge::plain());
                            }
                            FlowEvent::ReconnectionCompleted {
                                edge_id,
                                new_connection,
                                ..
                            } => {
                                flow.reconnect_edge(&edge_id, new_connection);
                            }
                            _ => {}
                        }
                    }
                }
                CtEvent::Resize(..) => {
                    // A resize usually means the human changed the layout:
                    // refit so the whole graph stays visible.
                    flow.request_fit_view();
                }
                _ => {}
            }
            if !event::poll(Duration::ZERO)? {
                break;
            }
        }
    }
    Ok(())
}

fn header_line(spec: &Spec, node_count: usize, path: &str) -> String {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);
    format!(
        " rataflow-view · {name} · {node_count} nodes · {} edges · {} flows · drag pan · scroll zoom · f fit · q quit · {}",
        spec.edges.len(),
        spec.flow_count(),
        spec.theme_label(),
    )
}
