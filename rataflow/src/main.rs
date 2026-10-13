//! The `rataflow-view` binary renders a JSON graph spec as a live,
//! pannable node graph in the current terminal pane. Open it in a herdr
//! pane so the human sees it beside the conversation:
//!
//! ```text
//! herdr pane split --current --direction right --ratio 0.55 --no-focus
//! herdr pane run <pane-id> "rataflow-view graph.json"
//! ```
//!
//! `rataflow-view --check graph.json` validates a spec and prints a
//! summary without needing a terminal — the pre-flight check for agents.

use std::io::stdout;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use rataflow::{Background, Controls, EventResponse, Flow, FlowEvent, MiniMap, StepEdge};
use rataflow_view::{Direction, Spec, build_flow};
use ratatui::crossterm::{
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event as CtEvent, KeyCode, KeyEventKind,
        KeyModifiers,
    },
    execute,
};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
use ratatui::{DefaultTerminal, Frame};

const USAGE: &str = "\
rataflow-view — render a JSON node/edge spec as a live node graph

usage:
  rataflow-view <spec.json>            open the live viewer (needs a real terminal pane)
  rataflow-view --check <spec.json>    validate the spec and print a summary, no terminal needed
  rataflow-view --help                 show this help

spec fields: direction (tb|lr), theme (gruvbox|dark|light),
nodes (id, label?), edges (from, to, label?)
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
            Direction::TopToBottom => "tb",
            Direction::LeftToRight => "lr",
        };
        println!(
            "ok: nodes={} edges={} direction={direction} theme={}",
            flow.nodes().count(),
            spec.edges.len(),
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
fn live(terminal: &mut DefaultTerminal, flow: &mut Flow, header: &str) -> Result<()> {
    flow.request_fit_view();
    let mut last_tick = Instant::now();
    'app: loop {
        let now = Instant::now();
        flow.tick_auto_pan(now - last_tick);
        last_tick = now;

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
                                flow.add_edge_from_connection(connection, StepEdge::default());
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

fn draw(frame: &mut Frame, flow: &mut Flow, header: &str) {
    let areas = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).split(frame.area());
    let (header_area, canvas) = (areas[0], areas[1]);

    frame.render_widget(
        Paragraph::new(header).style(Style::default().fg(Color::Rgb(80, 73, 69))),
        header_area,
    );
    frame.render_widget(Background::new(flow), canvas);
    frame.render_widget(&mut *flow, canvas);
    frame.render_widget(Controls::new(flow), canvas);
    frame.render_widget(MiniMap::new(flow), canvas);
}

fn header_line(spec: &Spec, node_count: usize, path: &str) -> String {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);
    format!(
        " rataflow-view · {name} · {node_count} nodes · {} edges · drag pan · scroll zoom · f fit · q quit · {}",
        spec.edges.len(),
        spec.theme_label(),
    )
}
