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
    ANIMATION_STEP_MS, DotStats, FlowEdge, Graph, HEADER_HEIGHT, MIN_DOT_CELLS, Report,
    SectionReport, Spec, anchor_origin, build_flow_with_report, dot_stats, draw, draw_canvas,
    fit_natural, graph_extent, viewport_line, viewport_unknown,
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
  --frames-ansi    print the frames WITH colour escapes (whole-canvas colour proof)

spec fields: direction (tb|lr), theme (gruvbox|dark|light),
nodes (id, label?, group?), edges (from, to, label?, flow?, timing?, duration_ms?, dots?, style?, label_slot?),
trunks (id, label?, from, to, branches)
diagrams: a canvas of several named graphs on ONE pannable canvas, each with
      its title and one-line description drawn above it:
      diagrams: [{ id, title, description?, direction?, nodes, edges, layers?, trunks? }]
      A spec declares either edges (one graph) or diagrams (a canvas), not both
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
label_slot: true reserves a horizontal gutter band for this edge's label
      beside its run, instead of a rank gap as tall as the text is wide
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
    /// Print the frames with SGR colour escapes: a whole-canvas colour
    /// capture for a bundle whose live pane is smaller than the drawing.
    frames_ansi: bool,
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
            &report,
            &cli.path,
            frames,
            cli.step_ms,
            cli.select_all,
            cli.frames_ansi,
        );
    }

    let (cols, area_rows) = measured_area();
    let rows = area_rows + HEADER_HEIGHT;
    let header = header_line(&flow, &spec, &report, &cli.path, cols, rows);
    println!("{}", viewport_line(cols, rows));

    let mut terminal = ratatui::try_init().context("initializing the terminal")?;
    let result = (|| {
        execute!(stdout(), EnableMouseCapture)?;
        let outcome = live(&mut terminal, &mut flow, &header, &report.sections);
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
        frames_ansi: false,
        step_ms: ANIMATION_STEP_MS,
        path: String::new(),
    };
    let mut path: Option<String> = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--check" => cli.check = true,
            "--select-all" => cli.select_all = true,
            "--frames-ansi" => cli.frames_ansi = true,
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
fn check(spec: &Spec, flow: &mut Graph, report: &Report) -> Result<()> {
    println!("{}", viewport_unknown());
    let mut direction = match spec.direction {
        rataflow_view::Direction::TopToBottom => "tb",
        rataflow_view::Direction::LeftToRight => "lr",
    };
    // A canvas whose diagrams flow in different directions says so instead of
    // claiming one of them.
    if spec.is_canvas() {
        let mut directions: Vec<&str> = spec
            .diagrams
            .iter()
            .map(|diagram| match diagram.graph.direction {
                rataflow_view::Direction::TopToBottom => "tb",
                rataflow_view::Direction::LeftToRight => "lr",
            })
            .collect();
        directions.sort_unstable();
        directions.dedup();
        if directions.len() > 1 {
            direction = "mixed";
        } else if let Some(only) = directions.first() {
            direction = only;
        }
    }
    println!(
        "ok: nodes={} edges={} flows={} direction={direction} theme={}",
        flow.nodes().count(),
        spec.edge_count(),
        spec.flow_count(),
        spec.theme_label(),
    );
    if spec.is_canvas() {
        // The reader navigates ONE canvas, so every diagram's own extent and
        // its place on the canvas are reported next to the total: a large
        // canvas is a size the reader pans, not a failure.
        println!(
            "canvas: {} diagrams on one canvas, drawn whole at 100%",
            report.sections.len()
        );
        for section in &report.sections {
            println!("{}", section_line(section));
            if let Some(description) = section.description.as_deref() {
                println!("  description: {description}");
            }
            if !section.enclosures.is_empty() && !section.enclosure_outline {
                println!("  enclosed: {} group(s), boundary not painted (enclosure_outline is off)", section.enclosures.len());
            }
            for &(fx, fy, fw, fh) in &section.frames {
                println!("  enclosed: dotted box={fw}x{fh} at {fx},{fy} (contents of a zoomed-in component)");
            }
            if !section.focus.is_empty() {
                println!(
                    "  double border: {} zoom parent(s) - {}",
                    section.focus.len(),
                    section.focus.join(", ")
                );
            }
        }
        if report.enclosure_crossings > 0 {
            println!(
                "enclosure-crossings: {} cell(s) of a route RUNNING ALONG a dotted boundary (a route may enter the box, never travel on its edge)",
                report.enclosure_crossings
            );
        }
        if report.enclosure_entrances > 0 {
            println!(
                "enclosure-entrances: {} route(s) enter or leave a dotted enclosure",
                report.enclosure_entrances
            );
        }
    } else if !spec.layers.is_empty() {
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
    if spec.is_canvas() {
        println!(
            "extent={}x{} cells (whole canvas)",
            report.extent.0, report.extent.1
        );
    } else {
        println!("extent={}x{} cells", report.extent.0, report.extent.1);
    }
    println!(
        "crossings: {} bridges, {} touching bends",
        report.crossings, report.touching_bends
    );
    // Readability budgets: these do not fail the check, they name the
    // exact change that makes a diagram readable. On a canvas the budget is
    // judged per diagram: a large canvas is the point, a crowded section is
    // not.
    if spec.is_canvas() {
        for section in &report.sections {
            if section.nodes > 12 || section.edges > 16 {
                println!(
                    "warning: diagram {} has {} nodes / {} edges, above the readable budget \
                     (12/16); split it into another described diagram",
                    section.diagram, section.nodes, section.edges
                );
            }
            if section.description.is_none() {
                println!(
                    "warning: diagram {} has no \"description\"; a reader cannot tell what \
                     the section shows",
                    section.diagram
                );
            }
        }
    } else if report.nodes > 12 || report.edges > 16 {
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
    // A route that runs inside the margin of a node it does not serve reads as
    // a relation to that node (the round-13 gb300 defect). The total is named
    // first so a reader can quote one number, then every offending pair.
    let bus_cells: usize = report
        .near_misses
        .iter()
        .filter(|miss| miss.bus)
        .map(|miss| miss.cells)
        .sum();
    println!(
        "near-misses: {} cell(s) inside the {}-cell margin of a node the route does not serve \
         ({} on trunk buses)",
        report.passes_near_unrelated_node,
        rataflow_view::router::NEAR_NODE_MARGIN,
        bus_cells
    );
    println!(
        "passes-near-unrelated-node: {}",
        report.passes_near_unrelated_node
    );
    for miss in &report.near_misses {
        println!("{}", miss.line());
    }
    if report.passes_near_unrelated_node > 0 {
        println!(
            "warning: {} route cell(s) hug a node their relation does not serve; move the \
             affected relations or let them route around",
            report.passes_near_unrelated_node
        );
    }
    println!(
        "labels: {}/{} placed, {} leader-ticked, {} on route, {} skipped, {} ambiguous owners",
        report.labels_placed,
        report.labels_total,
        report.labels_leadered,
        report.labels_on_route,
        report.labels_skipped,
        report.labels_ambiguous
    );
    for (route, label) in &report.ambiguous_labels {
        println!("unowned label: {route} \"{label}\"");
    }
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
    if report.labels_leadered > 0 {
        println!(
            "warning: {} label(s) needed a leader tick: no cell beside the run held the text \
             unambiguously",
            report.labels_leadered
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
    println!("{}", dot_hue_line(report));
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

/// One diagram of a canvas, as `--check` reports it: where it sits on the
/// canvas and how big its own drawing is.
fn section_line(section: &SectionReport) -> String {
    format!(
        "diagram {} \"{}\" at {},{}: extent={}x{} nodes={} edges={} routes={}",
        section.diagram,
        section.title,
        section.origin.0,
        section.origin.1,
        section.extent.0,
        section.extent.1,
        section.nodes,
        section.edges,
        section.routes,
    )
}

/// The dot hue proof: how many routes took their source end's hue, how many
/// their destination's, and how many routes still share one hue. The two
/// whole-graph counts say why the choice was made.
fn dot_hue_line(report: &Report) -> String {
    format!(
        "dot hues: {} by source, {} by destination, {} shared-hue pair(s) \
         (source-only {}, destination-only {})",
        report.dot_hues.by_source,
        report.dot_hues.by_destination,
        report.dot_hues.conflicts,
        report.dot_hues.source_conflicts,
        report.dot_hues.destination_conflicts,
    )
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
/// One SGR sequence for a foreground/background colour pair. Truecolor when
/// the palette is RGB, indexed otherwise; the default colour emits nothing.
fn sgr(fg: ratatui::style::Color, bg: ratatui::style::Color) -> String {
    use ratatui::style::Color;
    fn one(code: &str, color: Color) -> Option<String> {
        match color {
            Color::Rgb(r, g, b) => Some(format!("\x1b[{code};2;{r};{g};{b}m")),
            Color::Indexed(n) => Some(format!("\x1b[{code};5;{n}m")),
            Color::Reset => None,
            Color::Black => Some(format!("\x1b[{code};5;0m")),
            Color::Red => Some(format!("\x1b[{code};5;1m")),
            Color::Green => Some(format!("\x1b[{code};5;2m")),
            Color::Yellow => Some(format!("\x1b[{code};5;3m")),
            Color::Blue => Some(format!("\x1b[{code};5;4m")),
            Color::Magenta => Some(format!("\x1b[{code};5;5m")),
            Color::Cyan => Some(format!("\x1b[{code};5;6m")),
            Color::Gray => Some(format!("\x1b[{code};5;7m")),
            Color::DarkGray => Some(format!("\x1b[{code};5;8m")),
            Color::LightRed => Some(format!("\x1b[{code};5;9m")),
            Color::LightGreen => Some(format!("\x1b[{code};5;10m")),
            Color::LightYellow => Some(format!("\x1b[{code};5;11m")),
            Color::LightBlue => Some(format!("\x1b[{code};5;12m")),
            Color::LightMagenta => Some(format!("\x1b[{code};5;13m")),
            Color::LightCyan => Some(format!("\x1b[{code};5;14m")),
            Color::White => Some(format!("\x1b[{code};5;15m")),
        }
    }
    let mut out = String::new();
    if let Some(f) = one("38", fg) {
        out.push_str(&f);
    }
    if let Some(b) = one("48", bg) {
        out.push_str(&b);
    }
    out
}

fn write_frames(
    flow: &mut Graph,
    spec: &Spec,
    report: &Report,
    path: &str,
    frames: usize,
    step_ms: u64,
    select_all: bool,
    ansi: bool,
) -> Result<()> {
    fit_natural(flow);
    let (cols, area_rows) = measured_area();
    let rows = area_rows + HEADER_HEIGHT;
    println!("{}", viewport_line(cols, rows));
    let header = header_line(flow, spec, report, path, cols, rows);
    let mut terminal = Terminal::new(TestBackend::new(cols, area_rows + HEADER_HEIGHT))
        .context("creating the offscreen frame buffer")?;
    let mut anchor_pending = true;
    for frame_index in 0..frames {
        for (_, content) in flow.edges_content_mut() {
            content.set_phase(frame_index);
        }
        if select_all {
            flow.select_all_nodes();
        }
        terminal
            .draw(|frame| {
                if report.sections.is_empty() {
                    draw(frame, flow, &header)
                } else {
                    draw_canvas(frame, flow, &header, &report.sections)
                }
            })
            .context("drawing a frame")?;
        if anchor_pending {
            // One anchored redraw: a drawing too large for the pane starts at
            // its first cell, in reading order.
            anchor_pending = false;
            if anchor_origin(flow) {
                terminal
                    .draw(|frame| {
                        if report.sections.is_empty() {
                            draw(frame, flow, &header)
                        } else {
                            draw_canvas(frame, flow, &header, &report.sections)
                        }
                    })
                    .context("drawing a frame")?;
            }
        }
        let buffer = terminal.backend().buffer();
        println!("frame {frame_index} at {}ms", frame_index as u64 * step_ms);
        let width = buffer.area.width as usize;
        for row in buffer.content.chunks(width) {
            if ansi {
                // The colour proof: every cell carries its own SGR pair, so a
                // reader can verify group hues and dot binding off-canvas.
                let mut line = String::new();
                let mut last: Option<(ratatui::style::Color, ratatui::style::Color)> = None;
                for cell in row {
                    let pair = (cell.fg, cell.bg);
                    if Some(pair) != last {
                        line.push_str(&sgr(pair.0, pair.1));
                        last = Some(pair);
                    }
                    line.push_str(cell.symbol());
                }
                line.push_str("\x1b[0m");
                println!("{}", line.trim_end());
                continue;
            }
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
fn live(
    terminal: &mut DefaultTerminal,
    flow: &mut Graph,
    header: &str,
    sections: &[SectionReport],
) -> Result<()> {
    fit_natural(flow);
    // A canvas too large for the pane opens at its first cell, so the reader
    // lands on a heading instead of the middle of a drawing.
    let mut anchor_pending = true;
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

        terminal.draw(|frame| {
            if sections.is_empty() {
                draw(frame, flow, header)
            } else {
                draw_canvas(frame, flow, header, sections)
            }
        })?;
        if anchor_pending {
            anchor_pending = false;
            anchor_origin(flow);
        }

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
                    anchor_pending = true;
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
fn header_line(
    flow: &Graph,
    spec: &Spec,
    report: &Report,
    path: &str,
    cols: u16,
    rows: u16,
) -> String {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("spec");
    // A drawing larger than the pane reports its own extent beside the pane
    // size: it is a navigable size, not a failure, and the reader sees both
    // numbers at a glance. A drawing that fits keeps the header unchanged.
    let (canvas_w, canvas_h) = if report.sections.is_empty() {
        graph_extent(flow)
    } else {
        // A canvas extent covers its heading bands too.
        rataflow_view::sections_extent(&report.sections)
    };
    let overflows = canvas_w > cols as i32 || canvas_h > rows.saturating_sub(HEADER_HEIGHT) as i32;
    let extent = if overflows {
        format!(" · canvas {canvas_w}x{canvas_h}")
    } else {
        String::new()
    };
    // The diagram count stays in `--check`: the header is one line on a narrow
    // pane, and every section already carries its own title.
    let node_count = flow.nodes().count();
    format!(
        " rataflow-view · {cols}x{rows} @100%{extent} · {name} · {node_count} nodes \
         · {} edges · q quit",
        spec.edge_count(),
    )
}
