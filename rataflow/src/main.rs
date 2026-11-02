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
//! `rataflow-view --frames 8 --step-ms 100 graph.json` prints eight
//! timestamped frames as plain text, so a harness can count dots per
//! frame without a pane.

use std::io::stdout;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use rataflow::{EventResponse, FlowEvent};
use rataflow_view::{
    ANIMATION_STEP_MS, DotStats, FlowEdge, Graph, HEADER_HEIGHT, MIN_DOT_CELLS, Spec,
    build_flow_with_report, dot_stats, draw, fit_natural, viewport_line, viewport_unknown,
};
use ratatui::DefaultTerminal;
use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::crossterm::{
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event as CtEvent, KeyCode, KeyEventKind,
        KeyModifiers,
    },
    execute, terminal,
};

const USAGE: &str = "\
rataflow-view — render a JSON node/edge spec as a live node graph

usage:
  rataflow-view <spec.json>                       open the live viewer (needs a real terminal pane)
  rataflow-view --check <spec.json>               validate the spec and print a summary, no terminal needed
  rataflow-view --frames <n> <spec.json>          print n timestamped plain-text frames, no pane
  rataflow-view --help                            show this help

options:
  --step-ms <ms>   milliseconds between rendered frames (default 100)
  --select-all     mark every node selected before drawing

spec fields: direction (tb|lr), theme (gruvbox|dark|light),
nodes (id, label?, group?), edges (from, to, label?, flow?, timing?, duration_ms?, dots?, style?),
trunks (id, label?, from, to, branches)
flow: true or a positive rate — animated dots travel from \"from\" to \"to\";
      true runs at the default constant rate (0.5 cells per 100 ms step); a
      number runs at that constant rate instead, so long routes finish later
      than short ones — that is correct, not a defect
timing: \"constant\" (default) or \"same-arrival\". same-arrival makes every
      such route leave at phase 0 and reach its arrowhead after duration_ms,
      and needs \"flow\": true (a numeric flow is rejected)
duration_ms: positive whole milliseconds of shared arrival time (default
      2000); valid ONLY with \"timing\": \"same-arrival\" and \"flow\": true
dots: 0 (no dot) or 1 (exactly one dot on the route); absent keeps the
      periodic dot spacing
style: solid (default) or dashed — dashed marks an unconfirmed fact
trunks: one corridor from \"from\" to \"to\" plus one spur per branch node
";

/// Frames rendered when `--check` looks for dot-rule violations.
const DOT_CHECK_FRAMES: usize = 24;

/// The drawing area used when no terminal can be measured (piped output).
const FALLBACK_COLS: u16 = 100;
const FALLBACK_ROWS: u16 = 40;

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

/// Parsed command line.
struct Cli {
    check: bool,
    select_all: bool,
    frames: Option<usize>,
    step_ms: u64,
    path: String,
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        bail!("{USAGE}");
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print!("{USAGE}");
        return Ok(());
    }
    let cli = parse_args(&args)?;

    let text =
        std::fs::read_to_string(&cli.path).with_context(|| format!("reading {}", cli.path))?;
    let spec = Spec::from_json(&text)?;
    let (mut flow, report) = build_flow_with_report(&spec)?;

    // A dropped label is never silent: name the edge it belongs to.
    for (edge, label) in &report.skipped_labels {
        eprintln!(
            "warning: edge {edge} label \"{label}\" had no clear cell; \
             shorten it or add routing space"
        );
    }
    if cli.select_all {
        flow.select_all_nodes();
    }

    if cli.check {
        return check(&spec, &mut flow, &report);
    }
    if let Some(frames) = cli.frames {
        return write_frames(
            &mut flow,
            &spec,
            &cli.path,
            frames,
            cli.step_ms,
            cli.select_all,
        );
    }

    let (cols, area_rows) = measured_area();
    let rows = area_rows + HEADER_HEIGHT;
    let header = header_line(&spec, flow.nodes().count(), &cli.path, cols, rows);
    println!("{}", viewport_line(cols, rows));

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

/// Reads the flags in any order. Exactly one spec path is required.
fn parse_args(args: &[String]) -> Result<Cli> {
    let mut cli = Cli {
        check: false,
        select_all: false,
        frames: None,
        step_ms: ANIMATION_STEP_MS,
        path: String::new(),
    };
    let mut path: Option<String> = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--check" => cli.check = true,
            "--select-all" => cli.select_all = true,
            "--frames" => {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow!("--frames needs a count, e.g. --frames 5"))?;
                let frames: usize = value
                    .parse()
                    .with_context(|| format!("--frames {value}: expected a positive count"))?;
                if frames == 0 {
                    bail!("--frames must be at least 1 (got 0)");
                }
                cli.frames = Some(frames);
            }
            "--step-ms" => {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow!("--step-ms needs milliseconds, e.g. --step-ms 100"))?;
                let step: u64 = value
                    .parse()
                    .with_context(|| format!("--step-ms {value}: expected milliseconds"))?;
                cli.step_ms = step;
            }
            other if other.starts_with('-') => bail!("unknown option {other}\n\n{USAGE}"),
            other => {
                if path.is_some() {
                    bail!("only one spec file can be rendered at a time\n\n{USAGE}");
                }
                path = Some(other.to_string());
            }
        }
    }
    cli.path = path.ok_or_else(|| anyhow!("no spec file given\n\n{USAGE}"))?;
    Ok(cli)
}

/// The drawing area this app measured for itself, chrome removed. A piped
/// stdout has no measurable terminal, so the documented fallback applies —
/// and the viewport line always reports the numbers actually used.
fn measured_area() -> (u16, u16) {
    match terminal::size() {
        Ok((cols, rows)) if cols >= 20 && rows > HEADER_HEIGHT + 4 => (cols, rows - HEADER_HEIGHT),
        _ => (FALLBACK_COLS, FALLBACK_ROWS - HEADER_HEIGHT),
    }
}

/// `--check`: the machine-readable summary, no terminal needed.
fn check(spec: &Spec, flow: &mut Graph, report: &rataflow_view::Report) -> Result<()> {
    println!("{}", viewport_unknown());
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
    if !spec.layers.is_empty() {
        println!(
            "layers={} ({} pinned, within-rank order automatic)",
            spec.layers.len(),
            report.pinned
        );
    }
    // A declared `minlen` the pins cannot give is a conflict, never a silent
    // rearrangement of the source's tiers.
    if report.pinned > 0 || !report.pins.is_empty() {
        println!(
            "pins: {} pinned, {} conflict(s)",
            report.pinned,
            report.pins.len()
        );
    }
    for conflict in &report.pins {
        println!("{}", conflict.line());
    }
    println!("extent={}x{} cells", report.extent.0, report.extent.1);
    println!(
        "crossings: {} bridges, {} touching bends",
        report.crossings, report.touching_bends
    );
    // Readability budgets: these do not fail the check, they name the
    // exact change that makes the pane readable.
    if report.nodes > 12 || report.edges > 16 {
        println!(
            "warning: {} nodes / {} edges is above the readable budget (12/16); \
             split it into an overview and detail graphs",
            report.nodes, report.edges
        );
    }
    if report.shared_run > 0 {
        println!(
            "warning: two edges share {} cell(s), including ports; increase routing space",
            report.shared_run
        );
    }
    if report.labels_skipped > 0 {
        println!(
            "warning: {} edge label(s) had no free slot; shorten the labels or split the graph",
            report.labels_skipped
        );
    }
    println!(
        "labels: {}/{} placed, {} on route cells, {} skipped, {} ambiguous owners",
        report.labels_placed,
        report.labels_total,
        report.labels_on_route,
        report.labels_skipped,
        report.labels_ambiguous
    );
    if report.labels_on_route > 0 {
        println!(
            "warning: {} label(s) sit on a route cell; the label search lost the guard rail",
            report.labels_on_route
        );
    }
    if report.labels_ambiguous > 0 {
        println!(
            "warning: {} label(s) have an ambiguous owner: another route is as close to the \
             text as its own edge",
            report.labels_ambiguous
        );
    }
    println!("groups:{}", list_suffix(&counted(&report.groups)));
    println!("trunks:{}", list_suffix(&trunk_list(report)));
    // A route too short to show motion is named instead of being animated
    // ambiguously: the spec can lengthen it or drop its dots.
    for short in &report.short_routes {
        println!(
            "warning: route {} ({} -> {}) has {} dot cell(s); fewer than {} cannot show motion",
            short.route, short.from, short.to, short.dot_cells, MIN_DOT_CELLS
        );
    }
    let stats = dot_stats(flow, report.extent, DOT_CHECK_FRAMES);
    println!("{}", dot_line(&stats));
    println!("{}", origin_line(&stats));
    println!("{}", arrival_line(&stats));
    Ok(())
}

fn counted(groups: &[(String, usize)]) -> Vec<String> {
    groups
        .iter()
        .map(|(name, count)| format!("{name}({count})"))
        .collect()
}

fn trunk_list(report: &rataflow_view::Report) -> Vec<String> {
    report
        .trunks
        .iter()
        .map(|trunk| {
            format!(
                "{} from {} to {}, {} branches, {} junctions",
                trunk.id, trunk.from, trunk.to, trunk.branches, trunk.junctions
            )
        })
        .collect()
}

fn list_suffix(items: &[String]) -> String {
    if items.is_empty() {
        String::new()
    } else {
        format!(" {}", items.join(" "))
    }
}

fn dot_line(stats: &DotStats) -> String {
    format!(
        "dots: {} single-dot routes, {} periodic routes, {} violations, \
         {} constant at {}c/step, {} same-arrival at {}ms",
        stats.single,
        stats.periodic,
        stats.violations,
        stats.constant,
        stats.constant_rate,
        stats.same_arrival,
        stats.same_arrival_ms
    )
}

/// The origin proof: a real check that every animated route's first dot cell
/// is the first drawn cell after its source port. A route that fails is also
/// counted in the `dots` line's violation total.
fn origin_line(stats: &DotStats) -> String {
    format!(
        "origins: {}/{} routes start at their arrow origin",
        stats.origins_ok, stats.origins_total
    )
}

/// The arrival proof, the same-arrival counterpart of the origin line: on the
/// final step every such route's dot sits on its arrowhead cell and the head
/// glyph is still drawn there.
fn arrival_line(stats: &DotStats) -> String {
    format!(
        "arrivals: {}/{} same-arrival routes show their dot at the arrowhead on the final step",
        stats.arrivals_ok, stats.arrivals_total
    )
}

/// `--frames`: successive frames as plain text, no pane and no terminal.
fn write_frames(
    flow: &mut Graph,
    spec: &Spec,
    path: &str,
    frames: usize,
    step_ms: u64,
    select_all: bool,
) -> Result<()> {
    fit_natural(flow);
    let (cols, area_rows) = measured_area();
    let rows = area_rows + HEADER_HEIGHT;
    println!("{}", viewport_line(cols, rows));
    let header = header_line(spec, flow.nodes().count(), path, cols, rows);
    let mut terminal = Terminal::new(TestBackend::new(cols, area_rows + HEADER_HEIGHT))
        .context("creating the offscreen frame buffer")?;
    for frame_index in 0..frames {
        for (_, content) in flow.edges_content_mut() {
            content.set_phase(frame_index);
        }
        if select_all {
            flow.select_all_nodes();
        }
        terminal
            .draw(|frame| draw(frame, flow, &header))
            .context("drawing a frame")?;
        let buffer = terminal.backend().buffer();
        println!("frame {frame_index} at {}ms", frame_index as u64 * step_ms);
        let width = buffer.area.width as usize;
        for row in buffer.content.chunks(width) {
            let line: String = row.iter().map(|cell| cell.symbol()).collect();
            println!("{}", line.trim_end());
        }
        if select_all {
            println!(
                "selected: {} nodes",
                flow.nodes().filter(|n| n.selected).count()
            );
        }
    }
    Ok(())
}

/// The event loop: draw, then drain every pending input event before the
/// next frame (raw mouse streams at up to 1000 Hz and lags visibly if the
/// queue is not drained — the rataflow README's one operational gotcha).
///
/// Each frame also advances the flow-dot clock — a 3-step phase counter
/// stepped every [`ANIMATION_STEP_MS`] — and pushes the phase into every
/// edge, so the dots keep moving even when no input arrives. rataflow's
/// own animation clock stays crate-private, so the phase lives here.
/// Fit capped at zoom 1.0 in both directions: node boxes keep their
/// natural size. Zooming below 1 shrinks a box under its label width and
/// truncates the text, which is worse than letting the human pan. An
/// overflowing graph gets a badge instead.
fn live(terminal: &mut DefaultTerminal, flow: &mut Graph, header: &str) -> Result<()> {
    fit_natural(flow);
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
                    fit_natural(flow);
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

/// The header carries the measured terminal viewport and the fixed zoom, so a
/// pane capture proves both. The startup `viewport:` line is erased by the
/// alternate screen, so the proof must live in the header too.
fn header_line(spec: &Spec, node_count: usize, path: &str, cols: u16, rows: u16) -> String {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("spec");
    format!(
        " rataflow-view · {cols}x{rows} @100% · {name} · {node_count} nodes · {} edges · q quit",
        spec.edges.len(),
    )
}
