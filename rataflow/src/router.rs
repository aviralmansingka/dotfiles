//! Layer-aware orthogonal router for `rataflow-view`.
//!
//! The library's step router gives every edge the same centre handles and
//! draws each one independently, so parallel edges merge into one corridor
//! and crossings become fake junctions. This module owns the geometry
//! instead: it gives every edge its own port on each node side, routes it
//! over the character grid with A*, and reports how much of the route is
//! shared with another edge.
//!
//! The route cost deliberately prefers a longer, cleaner path over a short
//! one that runs beside or through another edge — readability beats length.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

use rataflow::HandlePosition;

/// One side of a node box.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Side {
    #[default]
    Top,
    Right,
    Bottom,
    Left,
}

impl Side {
    /// Direction index used by the router: 0 up, 1 right, 2 down, 3 left.
    fn dir(self) -> usize {
        match self {
            Side::Top => 0,
            Side::Right => 1,
            Side::Bottom => 2,
            Side::Left => 3,
        }
    }

    /// The library handle that sits on this side.
    pub fn handle(self) -> HandlePosition {
        match self {
            Side::Top => HandlePosition::Top,
            Side::Right => HandlePosition::Right,
            Side::Bottom => HandlePosition::Bottom,
            Side::Left => HandlePosition::Left,
        }
    }

    /// True when the side runs along x (top and bottom).
    fn horizontal(self) -> bool {
        matches!(self, Side::Top | Side::Bottom)
    }
}

/// A node box in cell coordinates. `x`/`y` are the top-left border cell.
#[derive(Debug, Clone)]
pub struct NodeBox {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub layer: usize,
}

impl NodeBox {
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }

    fn center(&self) -> (i32, i32) {
        (self.x + self.w / 2, self.y + self.h / 2)
    }
}

/// What one route is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// A plain spec edge: its own corridor, its own port pair.
    Edge,
    /// A trunk's corridor: routed once, from the trunk's `from` to `to`.
    Corridor { trunk: usize },
    /// One trunk branch spur: it leaves a corridor cell and enters `to`
    /// through its own port. Its start is not on a node border.
    Spur { trunk: usize, slot: usize },
}

impl Role {
    fn is_spur(self) -> bool {
        matches!(self, Role::Spur { .. })
    }
}

/// The space the layout reserved for one edge label: the anchor cell its
/// text is centred on, and how many cells wide that text is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LabelSlot {
    pub anchor: (i32, i32),
    pub width: i32,
}

impl LabelSlot {
    /// The cells the text itself covers.
    pub fn cells(&self) -> Vec<(i32, i32)> {
        let len = self.width.max(1);
        let lo = self.anchor.0 - len / 2;
        (lo..lo + len).map(|x| (x, self.anchor.1)).collect()
    }
}

/// One route to plan.
#[derive(Debug, Clone)]
pub struct EdgeSpec {
    pub from: usize,
    pub to: usize,
    pub label: Option<String>,
    /// The label slot the layout reserved, when the edge has a label and
    /// space for it. Routing keeps every other route out of it.
    pub label_slot: Option<LabelSlot>,
    pub role: Role,
}

impl EdgeSpec {
    /// A plain edge between two boxes.
    pub fn new(from: usize, to: usize) -> Self {
        Self {
            from,
            to,
            label: None,
            label_slot: None,
            role: Role::Edge,
        }
    }

    /// Attaches the label slot the layout reserved for this edge.
    pub fn with_label_slot(mut self, slot: LabelSlot) -> Self {
        self.label_slot = Some(slot);
        self
    }

    /// Attaches the edge label.
    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// Marks what this route is for.
    pub fn with_role(mut self, role: Role) -> Self {
        self.role = role;
        self
    }
}

/// A routed edge, in cell coordinates.
#[derive(Debug, Clone, Default)]
pub struct Planned {
    /// Polyline from the cell outside the source border to the cell
    /// outside the target border. Every segment is axis-aligned.
    pub points: Vec<(i32, i32)>,
    /// Side the edge leaves the source on.
    pub src: Side,
    /// Side the edge enters the target on.
    pub tgt: Side,
    /// Centre cell for the edge label, when one fits.
    pub label: Option<(i32, i32)>,
    /// Cells of this route that carry a junction glyph: a spur leaves the
    /// corridor here, so the two strokes connect instead of bridging.
    pub junctions: Vec<(i32, i32)>,
    /// Cells a single dot may sit on, in travel order: straight, unshared,
    /// and never a corner, junction, or arrowhead.
    pub dot_cells: Vec<(i32, i32)>,
    /// True for a spur: the route starts on the corridor, not on a node.
    pub detached_src: bool,
}

/// A routed trunk: one corridor, one spur per branch, and the cells where
/// the spurs leave the corridor.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrunkRoute {
    /// Index into [`Plan::routes`] of the corridor, when it routed.
    pub corridor: Option<usize>,
    /// Indices into [`Plan::routes`] of the branch spurs, in slot order.
    pub spurs: Vec<usize>,
    /// Corridor cells where a spur leaves: drawn as a junction, never a
    /// bridge, and never covered by a dot.
    pub junctions: Vec<(i32, i32)>,
}

/// Result of one routing pass.
#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub routes: Vec<Option<Planned>>,
    /// Longest same-axis overlap, including ports. Zero means no shared run.
    pub shared_run: usize,
    /// How many edge labels had no free slot and were dropped.
    pub labels_skipped: usize,
    /// Labels that were placed, out of `labels_total` requested.
    pub labels_placed: usize,
    /// Labels requested by the spec.
    pub labels_total: usize,
    /// Placed labels that still land on a route cell: always zero for a
    /// correct build, reported so a regression is visible.
    pub labels_on_route: usize,
    /// `(route index, label)` for every dropped label.
    pub skipped_labels: Vec<(usize, String)>,
    /// Edges for which no obstacle-safe route exists.
    pub unrouted: Vec<usize>,
    /// Width and height of the graph in cells, including ports.
    pub extent: (i32, i32),
    /// Cells where two routes cross at right angles: every one is an
    /// independent crossing, drawn as one bridge cell.
    pub crossings: usize,
    /// Of those bridges, the ones drawn one cell against a bend of either
    /// route, where a reader can misread the contact as a join.
    pub touching_bends: usize,
    /// Placed labels another route is at least as close to as its own: 0
    /// when every edge owns a reserved slot.
    pub labels_ambiguous: usize,
    /// Indexed by trunk index; empty for a spec without trunks.
    pub trunks: Vec<TrunkRoute>,
    /// Every junction cell in the plan.
    pub junctions: Vec<(i32, i32)>,
}

const DIRS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// A reservation owner that matches no route: cells marked with it are off
/// limits to every edge (a label's own cells).
const NOBODY: usize = usize::MAX;

fn edge_forward(src: &NodeBox, tgt: &NodeBox, axis: FlowAxis) -> bool {
    match axis {
        FlowAxis::TopToBottom => tgt.y > src.y,
        FlowAxis::LeftToRight => tgt.x > src.x,
    }
}

fn edge_backward(src: &NodeBox, tgt: &NodeBox, axis: FlowAxis) -> bool {
    match axis {
        FlowAxis::TopToBottom => tgt.y < src.y,
        FlowAxis::LeftToRight => tgt.x < src.x,
    }
}

const U_BIT: u8 = 1;
const R_BIT: u8 = 2;
const D_BIT: u8 = 4;
const L_BIT: u8 = 8;

/// Cost of one grid step.
const STEP_COST: i64 = 10;
/// Cost of a turn: fewer bends read better.
const TURN_COST: i64 = 8;
/// Cost of crossing another route at right angles, which the renderer draws
/// as a bridge (`⌒`). Allowed, because some crossings are unavoidable, but
/// priced far above a detour: a two-cell detour costs about two steps and
/// two bends (≈36), a bridge costs 150 — so A* walks around a crossing
/// whenever a free corridor exists and only crosses when it cannot.
const CROSSING_COST: i64 = 150;
/// Cost of running in a cell adjacent (perpendicular) to another edge, so
/// parallel runs keep one blank cell between them.
const ADJACENT_COST: i64 = 14;
/// Cost of a cell that touches a node border: edges should not hug boxes.
const HUG_COST: i64 = 6;
/// Cost of one step against the flow. A forward edge should not jog
/// backward and come straight back; a return edge should not do the
/// mirror image. Priced above a turn, below a crossing.
const AGAINST_FLOW_COST: i64 = 90;

/// Which way a layered layout flows. Forward edges leave the far side in
/// the flow direction regardless of how far apart the boxes sit; only
/// same-layer and back edges fall back to geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlowAxis {
    TopToBottom,
    LeftToRight,
}

/// Routes every edge, in a deterministic order, then places labels.
pub fn plan(nodes: &[NodeBox], edges: &[EdgeSpec], axis: FlowAxis) -> Plan {
    if nodes.is_empty() {
        return Plan::default();
    }
    let mut grid = Grid::new(nodes, edges.len() as i32 + 3);
    let (ports, mut used) = assign_ports(nodes, edges, axis);
    // Reserve every endpoint and its outward stem BEFORE routing any edge.
    // Otherwise an early route can steal a later edge's departure or head.
    for (index, edge) in edges.iter().enumerate() {
        if edge.role.is_spur() {
            continue; // a spur starts on the corridor, not on a node border
        }
        let (src, tgt) = sides_for(&nodes[edge.from], &nodes[edge.to], axis);
        for (port, side) in [(ports[index].0, src), (ports[index].1, tgt)] {
            reserve_stem(&mut grid, port, side, index);
        }
    }
    // A label slot the layout reserved is off limits to every other route:
    // the label's own route may come up to it, nothing may cross it.
    for (index, edge) in edges.iter().enumerate() {
        if let Some(slot) = edge.label_slot.as_ref() {
            reserve_label_slot(&mut grid, index, slot);
        }
    }

    let mut routes: Vec<Option<Planned>> = vec![None; edges.len()];
    let mut unrouted = Vec::new();
    let trunk_count = edges
        .iter()
        .filter_map(|edge| match edge.role {
            Role::Corridor { trunk } | Role::Spur { trunk, .. } => Some(trunk + 1),
            Role::Edge => None,
        })
        .max()
        .unwrap_or(0);
    let mut trunks = vec![TrunkRoute::default(); trunk_count];

    // Corridors first, in trunk order: a trunk owns its corridor, so it
    // gets the clean path before plain edges take the space around it.
    let mut corridors: Vec<usize> = (0..edges.len())
        .filter(|&index| matches!(edges[index].role, Role::Corridor { .. }))
        .collect();
    corridors.sort_by_key(|&index| match edges[index].role {
        Role::Corridor { trunk } => trunk,
        _ => usize::MAX,
    });
    for index in corridors {
        let edge = &edges[index];
        let (src, tgt) = sides_for(&nodes[edge.from], &nodes[edge.to], axis);
        match route_edge(&mut grid, nodes, edges, ports[index], index, axis) {
            Some(points) => {
                grid.claim(&points);
                if let Role::Corridor { trunk } = edge.role {
                    trunks[trunk].corridor = Some(index);
                }
                routes[index] = Some(Planned {
                    points,
                    src,
                    tgt,
                    ..Planned::default()
                });
            }
            None => unrouted.push(index),
        }
    }

    // A trunk with up to two branches gets ONE split point on its corridor:
    // one junction cell with an arm per branch, so the bus reads as a single
    // split. Trunks with more branches keep a tap per branch and honestly
    // report one junction each.
    let mut hubbed = vec![false; trunk_count];
    for (trunk, hub) in hubbed.iter_mut().enumerate() {
        let mut spurs: Vec<(usize, usize)> = edges
            .iter()
            .enumerate()
            .filter_map(|(index, edge)| match edge.role {
                Role::Spur { trunk: t, slot } if t == trunk => Some((slot, index)),
                _ => None,
            })
            .collect();
        spurs.sort_unstable();
        let spurs: Vec<usize> = spurs.into_iter().map(|(_, index)| index).collect();
        if spurs.len() <= 2 {
            *hub = try_hub(
                &mut grid,
                nodes,
                edges,
                &spurs,
                axis,
                trunk,
                &mut routes,
                &mut trunks,
                &mut used,
            );
        }
    }

    // Trunk spurs that need their own tap: each branch gets one corridor
    // cell and its own port. The primary cells are reserved now, so the
    // plain edges routed next give way to the bus instead of stealing its
    // departures.
    let spur_base = edges.len() + 1;
    let mut spur_jobs: Vec<SpurJob> = Vec::new();
    for (trunk, trunk_route) in trunks.iter_mut().enumerate() {
        if hubbed[trunk] {
            continue;
        }
        let mut spurs: Vec<(usize, usize)> = edges
            .iter()
            .enumerate()
            .filter_map(|(index, edge)| match edge.role {
                Role::Spur { trunk: t, slot } if t == trunk => Some((slot, index)),
                _ => None,
            })
            .collect();
        if spurs.is_empty() {
            continue;
        }
        spurs.sort_unstable();
        let Some(corridor) = trunk_route.corridor else {
            unrouted.extend(spurs.iter().map(|&(_, index)| index));
            continue;
        };
        let candidates = routes[corridor]
            .as_ref()
            .map(|route| tap_candidates(&route.points))
            .unwrap_or_default();
        for (_, index) in spurs {
            let center = nodes[edges[index].to].center();
            spur_jobs.push(SpurJob {
                index,
                trunk,
                branch: edges[index].to,
                taps: order_taps(&candidates, center),
            });
        }
    }
    // Hold the primary tap of every spur for that spur before plain edges
    // route, so a passing edge cannot sit down on it.
    for job in &spur_jobs {
        if let Some(&(tap, across)) = job.taps.first()
            && grid.tap_ready(tap, job.index)
        {
            let dir = departure(across, tap, nodes[job.branch].center());
            grid.reserve_cell(tap, job.index);
            if let Some(cell) = grid.index(tap.0 + DIRS[dir].0, tap.1 + DIRS[dir].1) {
                grid.reserved[cell].push(job.index);
            }
        }
    }

    // Deterministic routing order: upper layers first, then left to right,
    // then spec order. The order decides who gets the clean corridor.
    let mut order: Vec<usize> = (0..edges.len())
        .filter(|&index| matches!(edges[index].role, Role::Edge))
        .collect();
    order.sort_by_key(|&index| {
        let edge = &edges[index];
        let (s, t) = (&nodes[edge.from], &nodes[edge.to]);
        (s.layer, t.layer, s.x, t.x, index)
    });
    for index in order {
        let (src, tgt) = sides_for(&nodes[edges[index].from], &nodes[edges[index].to], axis);
        match route_edge(&mut grid, nodes, edges, ports[index], index, axis) {
            Some(points) => {
                grid.claim(&points);
                routes[index] = Some(Planned {
                    points,
                    src,
                    tgt,
                    ..Planned::default()
                });
            }
            None => unrouted.push(index),
        }
    }

    // Spurs last: they detour around everything already routed, and each
    // one claims its cells exclusively so two spurs never share a run. A
    // spur that cannot leave a tap tries the next tap, then the next side of
    // its branch, before it is reported unrouted.
    for job in spur_jobs {
        let branch = &nodes[job.branch];
        let mut routed = false;
        'taps: for &(tap, across) in &job.taps {
            if !grid.tap_ready(tap, job.index) {
                continue;
            }
            let preferred = departure(across, tap, branch.center());
            for dir in [preferred, (preferred + 2) % 4] {
                if !grid.step_is_free(tap, dir, job.index) {
                    continue;
                }
                for side in side_order(branch, tap) {
                    let slot = used.get(&(job.branch, side)).copied().unwrap_or(0);
                    let port = port_cell(branch, side, slot as i32);
                    if !valid_port(branch, side, port) {
                        continue;
                    }
                    reserve_stem(&mut grid, port, side, job.index);
                    let arrive = (side.dir() + 2) % 4;
                    let search = Search {
                        against: None,
                        straight_stem: true,
                    };
                    let attempt = grid
                        .route(tap, dir, port, arrive, search, job.index)
                        .or_else(|| {
                            grid.route(
                                tap,
                                dir,
                                port,
                                arrive,
                                Search {
                                    straight_stem: false,
                                    ..search
                                },
                                job.index,
                            )
                        });
                    match attempt {
                        Some(points) => {
                            used.insert((job.branch, side), slot + 1);
                            grid.claim(&points);
                            grid.reserve_route(&points, spur_base + job.index);
                            routes[job.index] = Some(Planned {
                                points,
                                src: side_of(dir),
                                tgt: side,
                                detached_src: true,
                                ..Planned::default()
                            });
                            trunks[job.trunk].spurs.push(job.index);
                            trunks[job.trunk].junctions.push(tap);
                            routed = true;
                            break 'taps;
                        }
                        None => release_stem(&mut grid, port, side, job.index),
                    }
                }
            }
        }
        if !routed {
            unrouted.push(job.index);
        }
    }
    // Junction cells belong to the corridor and to the spur that leaves it:
    // both draw the same merged glyph instead of a bridge.
    for trunk_route in &trunks {
        if let Some(corridor) = trunk_route.corridor
            && let Some(route) = routes[corridor].as_mut()
        {
            route.junctions = trunk_route.junctions.clone();
        }
        for &spur in &trunk_route.spurs {
            if let Some(route) = routes[spur].as_mut()
                && let Some(&tap) = route.points.first()
            {
                route.junctions = vec![tap];
            }
        }
    }
    let junctions: Vec<(i32, i32)> = trunks
        .iter()
        .flat_map(|trunk| trunk.junctions.iter().copied())
        .collect();
    let junction_set: HashSet<(i32, i32)> = junctions.iter().copied().collect();

    // A single dot may only sit on a straight, unshared cell of its route,
    // and always on the first drawn cell after its source port.
    for route in routes.iter_mut().flatten() {
        route.dot_cells = dot_cells(&route.points, &grid, &route.junctions);
    }

    let axes: Vec<Vec<((i32, i32), u8)>> = routes
        .iter()
        .map(|route| expand_axes(route.as_ref().map(|r| r.points.as_slice()).unwrap_or(&[])))
        .collect();
    let drawn: HashSet<(i32, i32)> = routes
        .iter()
        .flatten()
        .flat_map(|route| route_cells(&route.points))
        .collect();
    let max_x = nodes.iter().map(|n| n.x + n.w).max().unwrap_or(0);
    let max_y = nodes.iter().map(|n| n.y + n.h).max().unwrap_or(0);
    let extent = nodes
        .iter()
        .map(|node| (node.x + node.w, node.y + node.h))
        .chain(drawn.iter().map(|&(x, y)| (x + 1, y + 1)))
        .fold((max_x, max_y), |acc, cur| {
            (acc.0.max(cur.0), acc.1.max(cur.1))
        });
    let min_x = nodes
        .iter()
        .map(|n| n.x)
        .chain(drawn.iter().map(|cell| cell.0))
        .min()
        .unwrap_or(0)
        .min(0);
    let min_y = nodes
        .iter()
        .map(|n| n.y)
        .chain(drawn.iter().map(|cell| cell.1))
        .min()
        .unwrap_or(0)
        .min(0);
    let extent = (extent.0 - min_x, extent.1 - min_y);

    // Every route's cells, kept so a label can prove which route owns it.
    let route_cell_list: Vec<Vec<(i32, i32)>> = routes
        .iter()
        .map(|route| {
            route
                .as_ref()
                .map(|route| route_cells(&route.points))
                .unwrap_or_default()
        })
        .collect();
    let mut labels: Vec<(i32, i32, i32)> = Vec::new();
    let (mut labels_placed, mut labels_total, mut labels_skipped) = (0, 0, 0);
    let mut labels_ambiguous = 0;
    let mut skipped_labels: Vec<(usize, String)> = Vec::new();
    for index in 0..edges.len() {
        let Some(label) = edges[index].label.as_deref() else {
            continue;
        };
        labels_total += 1;
        let len = label.chars().count() as i32;
        let Some(route) = routes[index].as_mut() else {
            labels_skipped += 1;
            skipped_labels.push((index, label.to_string()));
            continue;
        };
        // A reserved slot is the label's own space: the layout sized it, no
        // other route may enter it, and the owner's route runs beside it, so
        // ownership is structural rather than guessed.
        if let Some(slot) = edges[index].label_slot.as_ref()
            && clear(
                nodes,
                &drawn,
                &labels,
                slot.anchor.0,
                slot.anchor.1,
                len,
                extent,
            )
        {
            labels.push((slot.anchor.0, slot.anchor.1, len));
            route.label = Some(slot.anchor);
            labels_placed += 1;
            continue;
        }
        let others: Vec<(i32, i32)> = route_cell_list
            .iter()
            .enumerate()
            .filter(|(other, _)| *other != index)
            .flat_map(|(_, cells)| cells.iter().copied())
            .collect();
        match place_label(
            nodes,
            &drawn,
            &labels,
            &route.points,
            &route_cell_list[index],
            &others,
            len,
            extent,
        ) {
            Some((anchor, ambiguous)) => {
                labels.push((anchor.0, anchor.1, len));
                route.label = Some(anchor);
                labels_placed += 1;
                if ambiguous {
                    labels_ambiguous += 1;
                }
            }
            None => {
                labels_skipped += 1;
                skipped_labels.push((index, label.to_string()));
            }
        }
    }

    // Re-check every placed label against the drawn cells: the search is
    // supposed to guarantee this, so a non-zero count is a real regression.
    let mut labels_on_route = 0;
    for index in 0..routes.len() {
        let Some(route) = routes[index].as_ref() else {
            continue;
        };
        let Some((cx, cy)) = route.label else {
            continue;
        };
        let len = edges[index]
            .label
            .as_deref()
            .map(|label| label.chars().count() as i32)
            .unwrap_or(0);
        // The span is `len` cells wide, starting one half-length left of
        // the centre — the same span `place_label` cleared.
        let lo = cx - len / 2;
        if (lo..lo + len).any(|x| drawn.contains(&(x, cy))) {
            labels_on_route += 1;
        }
    }

    let shared_run = longest_shared_run(&axes);
    let (crossings, touching_bends) = count_crossings(&axes, &junction_set);

    Plan {
        routes,
        shared_run,
        crossings,
        touching_bends,
        labels_skipped,
        labels_placed,
        labels_total,
        labels_on_route,
        labels_ambiguous,
        skipped_labels,
        unrouted,
        extent,
        trunks,
        junctions,
    }
}

/// How many corridor cells a trunk tries as its single split point.
const HUB_CANDIDATES: usize = 24;

/// One branch arm accepted by [`try_hub`], waiting to be installed.
struct PlacedSpur {
    edge: usize,
    points: Vec<(i32, i32)>,
    src: Side,
    tgt: Side,
}

/// A routed arm of a split point: its cells, the sides it leaves and enters,
/// its port cell, that port's side, and the port slot it took.
struct SpurRoute {
    points: Vec<(i32, i32)>,
    src: Side,
    tgt: Side,
    port: (i32, i32),
    side: Side,
    slot: usize,
}

/// Gives one trunk a single split point: the corridor keeps its own path,
/// one cell on it becomes the junction, and every branch leaves that cell on
/// its own arm. A grid cell has four sides and the corridor uses two, so one
/// junction serves two branches; the caller only asks when there are at most
/// two.
///
/// Returns false — with the grid restored — when no corridor cell can carry
/// the split, so the caller falls back to a tap per branch.
#[allow(clippy::too_many_arguments)]
fn try_hub(
    grid: &mut Grid,
    nodes: &[NodeBox],
    edges: &[EdgeSpec],
    spur_edges: &[usize],
    axis: FlowAxis,
    trunk: usize,
    routes: &mut [Option<Planned>],
    trunks: &mut [TrunkRoute],
    used: &mut SlotUse,
) -> bool {
    if spur_edges.is_empty() {
        return false;
    }
    let Some(corridor_index) = trunks[trunk].corridor else {
        return false;
    };
    let Some(corridor) = routes[corridor_index]
        .as_ref()
        .map(|route| route.points.clone())
    else {
        return false;
    };
    if corridor.len() < 3 {
        return false;
    }
    let (src_side, tgt_side) = sides_for(
        &nodes[edges[corridor_index].from],
        &nodes[edges[corridor_index].to],
        axis,
    );
    // The junction sits near the middle of its branches, and on the run that
    // follows the flow when it can: the arms then open where the branches
    // sit. Bends are never candidates.
    let centers: Vec<(i32, i32)> = spur_edges
        .iter()
        .map(|&index| nodes[edges[index].to].center())
        .collect();
    let (sx, sy) = centers
        .iter()
        .fold((0, 0), |acc, &(x, y)| (acc.0 + x, acc.1 + y));
    let count = centers.len().max(1) as i32;
    let centroid = (sx / count, sy / count);
    let flow_axis = if axis == FlowAxis::TopToBottom { 2 } else { 1 };
    let cells = route_cells(&corridor);
    let mut candidates: Vec<(u8, i32, (i32, i32))> = (1..cells.len().saturating_sub(1))
        .map(|k| {
            let cell = cells[k];
            let run_axis = if cells[k - 1].1 == cell.1 { 1 } else { 2 };
            (
                u8::from(run_axis != flow_axis),
                (cell.0 - centroid.0).abs() + (cell.1 - centroid.1).abs(),
                cell,
            )
        })
        .collect();
    candidates.sort_unstable();
    let candidates: Vec<(i32, i32)> = candidates
        .into_iter()
        .take(HUB_CANDIDATES)
        .map(|(_, _, cell)| cell)
        .collect();

    // The corridor was claimed by the caller; a candidate junction can only
    // be judged on free canvas, so give it back while we look.
    grid.unclaim(&corridor);
    for junction in candidates {
        if !grid.can_hold_junction(junction) {
            continue;
        }
        let mut placed: Vec<PlacedSpur> = Vec::new();
        let mut bordered: Vec<((i32, i32), Side, usize)> = Vec::new();
        let mut ok = true;
        for &index in spur_edges {
            let owner = edges.len() + 1 + index;
            match route_spur(grid, nodes, &junction, edges[index].to, owner, used) {
                Some(spur) => {
                    bordered.push((spur.port, spur.side, owner));
                    placed.push(PlacedSpur {
                        edge: index,
                        points: spur.points,
                        src: spur.src,
                        tgt: spur.tgt,
                    });
                }
                None => {
                    // Rewind: the arms already claimed must go.
                    for (port, side, owner) in bordered.drain(..) {
                        release_stem(grid, port, side, owner);
                    }
                    for placed in placed.drain(..) {
                        grid.unclaim(&placed.points);
                    }
                    ok = false;
                    break;
                }
            }
        }
        if !ok {
            continue;
        }
        grid.claim(&corridor);
        routes[corridor_index] = Some(Planned {
            points: corridor.clone(),
            src: src_side,
            tgt: tgt_side,
            junctions: vec![junction],
            ..Planned::default()
        });
        trunks[trunk].corridor = Some(corridor_index);
        trunks[trunk].junctions = vec![junction];
        for PlacedSpur {
            edge: index,
            points,
            src,
            tgt,
        } in placed
        {
            // The bus mouth stays the bus's: no plain edge may bridge the
            // first cell of an arm.
            for cell in points.iter().take(2) {
                grid.reserve_cell(*cell, edges.len() + 1 + index);
            }
            routes[index] = Some(Planned {
                points,
                src,
                tgt,
                junctions: vec![junction],
                detached_src: true,
                ..Planned::default()
            });
            trunks[trunk].spurs.push(index);
        }
        return true;
    }
    // No split point fits: put the corridor back exactly as the caller left
    // it and let the tap fallback take over.
    grid.claim(&corridor);
    false
}

/// One arm from a split point to a branch node. Every free arm and every free
/// port side is tried and the shortest result wins, so a branch left of the
/// junction is never reached by wrapping round its right side.
fn route_spur(
    grid: &mut Grid,
    nodes: &[NodeBox],
    junction: &(i32, i32),
    branch: usize,
    owner: usize,
    used: &mut SlotUse,
) -> Option<SpurRoute> {
    let node = &nodes[branch];
    let mut dirs: Vec<usize> = (0..4)
        .filter(|&dir| grid.step_is_free(*junction, dir, owner))
        .collect();
    dirs.sort_by_key(|&dir| {
        let (dx, dy) = DIRS[dir];
        let center = node.center();
        (
            (junction.0 + dx - center.0).abs() + (junction.1 + dy - center.1).abs(),
            dir,
        )
    });
    let mut best: Option<SpurRoute> = None;
    for &dir in &dirs {
        for side in side_order(node, *junction) {
            let slot = used.get(&(branch, side)).copied().unwrap_or(0);
            let port = port_cell(node, side, slot as i32);
            if !valid_port(node, side, port) {
                continue;
            }
            reserve_stem(grid, port, side, owner);
            let arrive = (side.dir() + 2) % 4;
            let points = grid.route(*junction, dir, port, arrive, Search::default(), owner);
            release_stem(grid, port, side, owner);
            let Some(points) = points else {
                continue;
            };
            let score = (route_cells(&points).len(), points.len().saturating_sub(2));
            let better = best
                .as_ref()
                .map(|best| {
                    score
                        < (
                            route_cells(&best.points).len(),
                            best.points.len().saturating_sub(2),
                        )
                })
                .unwrap_or(true);
            if better {
                best = Some(SpurRoute {
                    points,
                    src: side_of(dir),
                    tgt: side,
                    port,
                    side,
                    slot,
                });
            }
        }
    }
    // Claim the winner and its port: the losers left the grid untouched.
    let best = best?;
    reserve_stem(grid, best.port, best.side, owner);
    used.insert((branch, best.side), best.slot + 1);
    grid.claim(&best.points);
    Some(best)
}

/// Marks a reserved label slot: its own cells belong to nobody (no route may
/// cross a label), the one-cell ring around it belongs to the label's route
/// only, so nothing else can come close enough to steal the ownership.
fn reserve_label_slot(grid: &mut Grid, owner: usize, slot: &LabelSlot) {
    let len = slot.width.max(1);
    let lo = slot.anchor.0 - len / 2;
    for x in lo..lo + len {
        grid.block_for_all((x, slot.anchor.1));
    }
    for x in lo - 1..=lo + len {
        for y in [slot.anchor.1 - 1, slot.anchor.1 + 1] {
            grid.reserve_cell((x, y), owner);
        }
    }
    for y in slot.anchor.1 - 1..=slot.anchor.1 + 1 {
        for x in [lo - 1, lo + len] {
            grid.reserve_cell((x, y), owner);
        }
    }
}
type PortPair = ((i32, i32), (i32, i32));

/// Slots already used per `(box, side)`, so a spur can append its own port.
type SlotUse = HashMap<(usize, Side), usize>;

/// One spur waiting for its A* pass, after its cells were reserved.
struct SpurJob {
    index: usize,
    trunk: usize,
    branch: usize,
    /// Corridor cells to try, nearest to the branch first.
    taps: Vec<((i32, i32), [usize; 2])>,
}

/// Reserves a port cell and the cell outside it, so no later route steals
/// an endpoint stem.
fn reserve_stem(grid: &mut Grid, port: (i32, i32), side: Side, owner: usize) {
    for cell in stem_cells(grid, port, side) {
        if !grid.reserved[cell].contains(&owner) {
            grid.reserved[cell].push(owner);
        }
    }
}

/// Gives a port stem back when that side turned out to be unroutable.
fn release_stem(grid: &mut Grid, port: (i32, i32), side: Side, owner: usize) {
    for cell in stem_cells(grid, port, side) {
        grid.reserved[cell].retain(|&id| id != owner);
    }
}

/// The grid cells of a port and its outward stem.
fn stem_cells(grid: &Grid, port: (i32, i32), side: Side) -> Vec<usize> {
    let (dx, dy) = DIRS[side.dir()];
    (0..=1)
        .filter_map(|step| grid.index(port.0 + dx * step, port.1 + dy * step))
        .collect()
}

/// Routes one port pair with the flow-aware penalties both plain edges and
/// trunk corridors use.
fn route_edge(
    grid: &mut Grid,
    nodes: &[NodeBox],
    edges: &[EdgeSpec],
    ports: PortPair,
    index: usize,
    axis: FlowAxis,
) -> Option<Vec<(i32, i32)>> {
    let edge = &edges[index];
    let (src, tgt) = sides_for(&nodes[edge.from], &nodes[edge.to], axis);
    let ((sx, sy), (tx, ty)) = ports;
    if !valid_port(&nodes[edge.from], src, (sx, sy)) || !valid_port(&nodes[edge.to], tgt, (tx, ty))
    {
        return None;
    }
    // Arrive against the target side, so the arrow points into the box
    // instead of sliding along its border.
    let arrive = (tgt.dir() + 2) % 4;
    // Penalize travel against the flow, but permit it when obstacles
    // require a detour (including self-loops).
    let against = if edge_backward(&nodes[edge.from], &nodes[edge.to], axis) {
        Some(match axis {
            FlowAxis::TopToBottom => 2, // no downward step
            FlowAxis::LeftToRight => 1, // no rightward step
        })
    } else if edge_forward(&nodes[edge.from], &nodes[edge.to], axis) {
        Some(match axis {
            FlowAxis::TopToBottom => 0, // no upward step
            FlowAxis::LeftToRight => 3, // no leftward step
        })
    } else {
        None
    };
    let start = (sx, sy);
    // The dot starts on the cell one step out of the port, so the route
    // should leave the port straight for two cells. Prefer that; when the
    // corridor is too tight to allow it, fall back to a bend after one cell
    // so the route still exists (and `--check` reports the origin).
    let search = Search {
        against,
        straight_stem: true,
    };
    grid.route(start, src.dir(), (tx, ty), arrive, search, index)
        .or_else(|| {
            grid.route(
                start,
                src.dir(),
                (tx, ty),
                arrive,
                Search {
                    straight_stem: false,
                    ..search
                },
                index,
            )
        })
}

/// The side a direction index points at.
fn side_of(dir: usize) -> Side {
    match dir {
        0 => Side::Top,
        1 => Side::Right,
        2 => Side::Bottom,
        _ => Side::Left,
    }
}

/// Corridor cells a spur can leave from, with the two perpendicular
/// departure directions: right/left off a vertical run, down/up off a
/// horizontal one.
fn tap_candidates(corridor: &[(i32, i32)]) -> Vec<((i32, i32), [usize; 2])> {
    let mut candidates = Vec::new();
    for window in corridor.windows(2) {
        let (from, to) = (window[0], window[1]);
        let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
        let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
        let across = if dx == 0 { [1usize, 3] } else { [2usize, 0] };
        // Segment ends are corners, so a spur never taps a bend.
        for step in 1..len {
            candidates.push(((from.0 + dx * step, from.1 + dy * step), across));
        }
    }
    candidates
}

/// Orders tap candidates by distance to the branch: a short spur reads as
/// part of the bus, a long one reads as a separate edge.
fn order_taps(
    candidates: &[((i32, i32), [usize; 2])],
    center: (i32, i32),
) -> Vec<((i32, i32), [usize; 2])> {
    let mut ordered: Vec<((i32, i32), [usize; 2])> = candidates.to_vec();
    ordered.sort_by_key(|((x, y), _)| (x - center.0).abs() + (y - center.1).abs());
    ordered
}

/// The departure direction that heads toward the branch.
fn departure(across: [usize; 2], cell: (i32, i32), center: (i32, i32)) -> usize {
    if across[0] == 1 {
        if center.0 >= cell.0 { 1 } else { 3 }
    } else if center.1 >= cell.1 {
        2
    } else {
        0
    }
}

/// The branch sides a spur may enter, nearest to the tap first.
fn side_order(node: &NodeBox, tap: (i32, i32)) -> [Side; 4] {
    let (x, y, w, h) = (node.x, node.y, node.w, node.h);
    let inside_x = tap.0.clamp(x, x + w - 1);
    let inside_y = tap.1.clamp(y, y + h - 1);
    let mut sides = [
        (
            Side::Left,
            (tap.0 - (x - 1)).abs() + (tap.1 - inside_y).abs(),
        ),
        (
            Side::Right,
            (tap.0 - (x + w)).abs() + (tap.1 - inside_y).abs(),
        ),
        (
            Side::Top,
            (tap.1 - (y - 1)).abs() + (tap.0 - inside_x).abs(),
        ),
        (
            Side::Bottom,
            (tap.1 - (y + h)).abs() + (tap.0 - inside_x).abs(),
        ),
    ];
    sides.sort_by_key(|&(_, cost)| cost);
    sides.map(|(side, _)| side)
}

/// Every cell a polyline covers, endpoints included.
fn route_cells(points: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let mut cells = Vec::new();
    for window in points.windows(2) {
        let (from, to) = (window[0], window[1]);
        let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
        let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
        for step in 0..=len {
            cells.push((from.0 + dx * step, from.1 + dy * step));
        }
    }
    cells
}

/// Cells a dot can sit on, in travel order: the cell just outside the source
/// port first, the arrowhead cell last. Mid-route corners are skipped (a dot
/// on a bend reads as a schematic dot), and so are junctions, bridges and
/// cells shared with another route. The one exception is the FIRST drawn
/// cell after the source port: it is the route's origin, so it stays even
/// when it is a corner glyph — otherwise the dot would start one cell late,
/// which is exactly the defect the `origins:` line exists to catch. The
/// arrowhead stays last because the head glyph paints over it: that is the
/// arrival, not a resting dot.
fn dot_cells(points: &[(i32, i32)], grid: &Grid, junctions: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let Some(&last) = points.last() else {
        return Vec::new();
    };
    let corners: HashSet<(i32, i32)> = points
        .iter()
        .skip(1)
        .take(points.len().saturating_sub(2))
        .copied()
        .collect();
    let mut cells = Vec::new();
    for (segment, window) in points.windows(2).enumerate() {
        let (from, to) = (window[0], window[1]);
        let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
        let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
        // Step 0 is the source port on the first segment and the previous
        // segment's end (a corner) on every later one.
        for step in 1..=len {
            let cell = (from.0 + dx * step, from.1 + dy * step);
            let origin = segment == 0 && step == 1;
            if cell == last {
                cells.push(cell);
                continue;
            }
            if junctions.contains(&cell) {
                continue;
            }
            let shared = match grid.index(cell.0, cell.1) {
                Some(index) => grid.count[index] > 1,
                None => false,
            };
            if origin {
                // The origin never moves, even onto a corner or a cell the
                // route shares with its own port stem.
                cells.push(cell);
                continue;
            }
            if corners.contains(&cell) || shared {
                continue;
            }
            cells.push(cell);
        }
    }
    cells
}

/// Picks the leave/enter sides from the relative position of the two
/// boxes: the dominant axis wins, so a forward edge in a top-to-bottom
/// layout leaves the bottom and enters the top, and a back-edge leaves
/// the side nearest its target.
pub(crate) fn sides_for(src: &NodeBox, tgt: &NodeBox, axis: FlowAxis) -> (Side, Side) {
    if src.id == tgt.id {
        return (Side::Right, Side::Bottom);
    }
    // A forward edge follows the layout's flow, even when the boxes are
    // far apart sideways: a sideways entry in a top-to-bottom chart reads
    // as a different relationship.
    if tgt.layer > src.layer {
        return match axis {
            FlowAxis::TopToBottom => (Side::Bottom, Side::Top),
            FlowAxis::LeftToRight => (Side::Right, Side::Left),
        };
    }
    if tgt.layer < src.layer {
        // A back-edge is a return path. Send it out of the side that faces
        // away from the flow, and let it come back in on the same side:
        // it then runs around the diagram instead of crossing the middle.
        let outward = match axis {
            FlowAxis::TopToBottom if tgt.center().0 <= src.center().0 => Side::Left,
            FlowAxis::TopToBottom => Side::Right,
            FlowAxis::LeftToRight if tgt.center().1 <= src.center().1 => Side::Top,
            FlowAxis::LeftToRight => Side::Bottom,
        };
        return (outward, outward);
    }
    let (sx, sy) = src.center();
    let (tx, ty) = tgt.center();
    let (dx, dy) = (tx - sx, ty - sy);
    if dy.abs() >= dx.abs() {
        if dy >= 0 {
            (Side::Bottom, Side::Top)
        } else {
            (Side::Top, Side::Bottom)
        }
    } else if dx >= 0 {
        (Side::Right, Side::Left)
    } else {
        (Side::Left, Side::Right)
    }
}

/// Gives every edge its own port on each side it uses. Ports spread along
/// the border interior, ordered by the position of the far endpoint so
/// edges from one box fan out without crossing at the port. Node sizing
/// must provide two cells per port; an undersized box fails routing.
///
/// Returns the ports plus how many slots each `(box, side)` already uses,
/// so a trunk spur can append its own port after the planned ones.
fn assign_ports(nodes: &[NodeBox], edges: &[EdgeSpec], axis: FlowAxis) -> (Vec<PortPair>, SlotUse) {
    let mut groups: HashMap<(usize, Side), Vec<(usize, bool)>> = HashMap::new();
    for (index, edge) in edges.iter().enumerate() {
        if edge.role.is_spur() {
            continue; // a spur's start floats on the corridor
        }
        let (src, tgt) = sides_for(&nodes[edge.from], &nodes[edge.to], axis);
        groups
            .entry((edge.from, src))
            .or_default()
            .push((index, true));
        groups
            .entry((edge.to, tgt))
            .or_default()
            .push((index, false));
    }

    let mut used: SlotUse = HashMap::new();
    let mut ports: Vec<PortPair> = vec![((0, 0), (0, 0)); edges.len()];
    for ((node_index, side), mut group) in groups {
        let node = &nodes[node_index];
        group.sort_by_key(|&(index, source)| {
            let edge = &edges[index];
            let other = if source {
                &nodes[edge.to]
            } else {
                &nodes[edge.from]
            };
            let (cx, cy) = other.center();
            let across = if side.horizontal() { cx } else { cy };
            let own = if side.horizontal() {
                node.center().0
            } else {
                node.center().1
            };
            // Long forward edges use outside ports, not ports trapped
            // between the short fan-out stems they must pass on the way out.
            if source && other.layer > node.layer + 1 {
                if across <= own { i32::MIN } else { i32::MAX }
            } else {
                across
            }
        });
        for (slot, &(index, source)) in group.iter().enumerate() {
            let cell = port_cell(node, side, slot as i32);
            if source {
                ports[index].0 = cell;
            } else {
                ports[index].1 = cell;
            }
        }
        used.insert((node_index, side), group.len());
    }
    (ports, used)
}

/// Ports skip corners and leave a blank cell between adjacent stems.
/// The caller sizes boxes for this capacity; never invent detached ports.
fn port_cell(node: &NodeBox, side: Side, slot: i32) -> (i32, i32) {
    if side.horizontal() {
        let along = 1 + 2 * slot;
        let y = match side {
            Side::Top => node.y - 1,
            _ => node.y + node.h,
        };
        (node.x + along, y)
    } else {
        let along = 1 + 2 * slot;
        let x = match side {
            Side::Left => node.x - 1,
            _ => node.x + node.w,
        };
        (x, node.y + along)
    }
}

fn valid_port(node: &NodeBox, side: Side, (x, y): (i32, i32)) -> bool {
    match side {
        Side::Top => y == node.y - 1 && x > node.x && x < node.x + node.w - 1,
        Side::Bottom => y == node.y + node.h && x > node.x && x < node.x + node.w - 1,
        Side::Left => x == node.x - 1 && y > node.y && y < node.y + node.h - 1,
        Side::Right => x == node.x + node.w && y > node.y && y < node.y + node.h - 1,
    }
}

/// The cells a polyline covers, corners included.
/// Every cell a polyline covers, tagged with its travel axis: 1 for a
/// horizontal run, 2 for a vertical one.
fn expand_axes(points: &[(i32, i32)]) -> Vec<((i32, i32), u8)> {
    let mut cells = Vec::new();
    for w in points.windows(2) {
        let (from, to) = (w[0], w[1]);
        if from.1 == to.1 {
            for x in from.0.min(to.0)..=from.0.max(to.0) {
                cells.push(((x, from.1), 1));
            }
        } else {
            for y in from.1.min(to.1)..=from.1.max(to.1) {
                cells.push(((from.0, y), 2));
            }
        }
    }
    cells
}

fn longest_shared_run(cells: &[Vec<((i32, i32), u8)>]) -> usize {
    let mut owner: HashMap<((i32, i32), u8), usize> = HashMap::new();
    let mut shared: HashMap<(i32, i32), u8> = HashMap::new();
    for (index, list) in cells.iter().enumerate() {
        for &(cell, axis) in list {
            match owner.get(&(cell, axis)) {
                // Two edges on the same axis at one cell are running
                // together — that is the corridor this metric hunts.
                // Perpendicular edges merely cross, which is fine.
                Some(&first) if first != index => {
                    *shared.entry(cell).or_insert(0) |= axis;
                }
                Some(_) => {}
                None => {
                    owner.insert((cell, axis), index);
                }
            }
        }
    }
    let mut longest = 0;
    for (&cell, &axes) in &shared {
        for axis in [1, 2] {
            if axes & axis == 0 {
                continue;
            }
            let mut run = 1;
            let (dx, dy) = if axis == 1 { (1, 0) } else { (0, 1) };
            for sign in [-1, 1] {
                let (mut x, mut y) = (cell.0 + dx * sign, cell.1 + dy * sign);
                while shared.get(&(x, y)).is_some_and(|bits| bits & axis != 0) {
                    run += 1;
                    x += dx * sign;
                    y += dy * sign;
                }
            }
            longest = longest.max(run);
        }
    }
    longest
}

/// Cells where two different routes meet, split into what a reader actually
/// sees: bridge cells (drawn `⌒`) and, of those, the ones drawn one cell
/// against a bend of either route, which a reader can misread as a join.
/// Junction cells are skipped — a trunk junction is drawn as a junction, not
/// as a crossing.
///
/// Two routes running along the same axis on one cell is a shared run, which
/// the router forbids and [`longest_shared_run`] hunts instead.
fn count_crossings(
    cells: &[Vec<((i32, i32), u8)>],
    junctions: &HashSet<(i32, i32)>,
) -> (usize, usize) {
    // Per cell, per route: the axes it covers there, so a route with both
    // axes at one cell is known to bend there.
    let mut per_cell: HashMap<(i32, i32), Vec<(usize, u8)>> = HashMap::new();
    for (index, list) in cells.iter().enumerate() {
        for &(cell, axis) in list {
            let entry = per_cell.entry(cell).or_default();
            match entry.iter_mut().find(|(owner, _)| *owner == index) {
                Some((_, bits)) => *bits |= axis,
                None => entry.push((index, axis)),
            }
        }
    }
    let mut bends: HashMap<usize, HashSet<(i32, i32)>> = HashMap::new();
    for (&cell, users) in &per_cell {
        for &(owner, bits) in users {
            if bits == 3 {
                bends.entry(owner).or_default().insert(cell);
            }
        }
    }
    let (mut bridges, mut touching_bends) = (0, 0);
    for (cell, users) in per_cell {
        if users.len() < 2 || junctions.contains(&cell) {
            continue;
        }
        bridges += 1;
        // The router never bends a route on a crossing cell, so the contact a
        // reader can still misread is a bridge drawn against an elbow: one
        // cell away from a bend of either route.
        let touches_bend = users.iter().any(|&(owner, _)| {
            bends.get(&owner).is_some_and(|cells| {
                DIRS.iter()
                    .any(|&(dx, dy)| cells.contains(&(cell.0 + dx, cell.1 + dy)))
            })
        });
        if touches_bend {
            touching_bends += 1;
        }
    }
    (bridges, touching_bends)
}

/// Chooses a clear cell for a label, preferring long straight runs and
/// keeping the label beside — never on — its own route. Returns the label's
/// centre cell and whether the placement is ambiguous, or `None` when every
/// candidate would cover a route cell, a node box, or another label.
///
/// A placement is ambiguous when another route's cells are as close to the
/// anchor as the label's own route's: a reader cannot tell which edge the
/// text belongs to. Unambiguous candidates win first; an ambiguous one is
/// only taken when nothing better exists.
///
/// One straight run of a route, as start, end, and length in cells.
type Segment = ((i32, i32), (i32, i32), i32);

#[allow(clippy::too_many_arguments)]
fn place_label(
    nodes: &[NodeBox],
    drawn: &HashSet<(i32, i32)>,
    labels: &[(i32, i32, i32)],
    points: &[(i32, i32)],
    own_cells: &[(i32, i32)],
    other_cells: &[(i32, i32)],
    len: i32,
    extent: (i32, i32),
) -> Option<((i32, i32), bool)> {
    if len <= 0 {
        return None;
    }
    let mut segments: Vec<Segment> = points
        .windows(2)
        .map(|w| {
            let len = (w[1].0 - w[0].0).abs() + (w[1].1 - w[0].1).abs();
            (w[0], w[1], len)
        })
        .collect();
    segments.sort_by_key(|&(_, _, len)| -len);

    // Candidate anchors, best first: the middle of the longest run, on both
    // sides of the line, then outward along that run. Every drawn cell of
    // every route is an obstacle, so a label only ever sits beside the line:
    // first touching it, and only after that with one blank cell between.
    let mut anchors: Vec<(i32, i32)> = Vec::new();
    for gap in [1, 2, 3] {
        for &(from, to, seg_len) in &segments {
            if seg_len < 1 {
                continue;
            }
            let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
            let mut steps: Vec<i32> = (0..=seg_len).collect();
            steps.sort_by_key(|&step| (2 * step - seg_len).abs());
            for step in steps {
                let cell = (from.0 + step * dx, from.1 + step * dy);
                if dy == 0 {
                    // A horizontal run: the label rides the row above or below.
                    anchors.push((cell.0, cell.1 - gap));
                    anchors.push((cell.0, cell.1 + gap));
                } else {
                    // A vertical run: the label sits beside the column, so the
                    // whole word clears the line.
                    anchors.push((cell.0 + len / 2 + 1 + gap, cell.1));
                    anchors.push((cell.0 - len / 2 - gap, cell.1));
                }
            }
        }
    }

    let candidates: Vec<(i32, i32)> = anchors
        .into_iter()
        .filter(|&(cx, cy)| clear(nodes, drawn, labels, cx, cy, len, extent))
        .collect();
    let unambiguous = candidates
        .iter()
        .copied()
        .find(|&(cx, cy)| nearest(own_cells, cx, cy) < nearest(other_cells, cx, cy));
    match unambiguous {
        Some(anchor) => Some((anchor, false)),
        None => candidates.first().map(|&anchor| (anchor, true)),
    }
}

/// Manhattan distance from `(cx, cy)` to the nearest cell in `cells`, or
/// `i32::MAX` when the list is empty.
fn nearest(cells: &[(i32, i32)], cx: i32, cy: i32) -> i32 {
    cells
        .iter()
        .map(|&(x, y)| (x - cx).abs() + (y - cy).abs())
        .min()
        .unwrap_or(i32::MAX)
}

/// True when a label of `len` cells centred on `(cx, cy)` covers nothing
/// drawn, no node box, and no other label, and stays on the canvas.
fn clear(
    nodes: &[NodeBox],
    drawn: &HashSet<(i32, i32)>,
    labels: &[(i32, i32, i32)],
    cx: i32,
    cy: i32,
    len: i32,
    extent: (i32, i32),
) -> bool {
    let lo = cx - len / 2;
    // A clipped word reads as a different word.
    if lo < 1 || lo + len > extent.0 - 1 || cy < 1 || cy > extent.1 - 1 {
        return false;
    }
    (lo..lo + len).all(|x| {
        !drawn.contains(&(x, cy))
            && !nodes.iter().any(|node| node.contains(x, cy))
            && !labels.iter().any(|&(lx, ly, width)| {
                ly == cy && x >= lx - width / 2 && x < lx - width / 2 + width
            })
    })
}

/// How one A* search is constrained.
#[derive(Debug, Clone, Copy, Default)]
struct Search {
    /// The direction that runs against the flow, penalized but allowed.
    against: Option<usize>,
    /// True when the departure must stay straight for two cells, so the cell
    /// the dot starts on is a stem and not a corner.
    straight_stem: bool,
}

/// The character grid, with the occupancy and direction state the router
/// and the renderer both need.
struct Grid {
    min: (i32, i32),
    w: i32,
    h: i32,
    blocked: Vec<bool>,
    border_band: Vec<bool>,
    count: Vec<u16>,
    dirs: Vec<u8>,
    reserved: Vec<Vec<usize>>,
}

impl Grid {
    fn new(nodes: &[NodeBox], margin: i32) -> Grid {
        let min_x = nodes.iter().map(|n| n.x).min().unwrap_or(0) - margin;
        let min_y = nodes.iter().map(|n| n.y).min().unwrap_or(0) - margin;
        let max_x = nodes.iter().map(|n| n.x + n.w).max().unwrap_or(0) + margin;
        let max_y = nodes.iter().map(|n| n.y + n.h).max().unwrap_or(0) + margin;
        let w = max_x - min_x + 1;
        let h = max_y - min_y + 1;
        let mut blocked = vec![false; (w * h) as usize];
        let mut border_band = blocked.clone();
        for node in nodes {
            for y in node.y - 1..=node.y + node.h {
                for x in node.x - 1..=node.x + node.w {
                    border_band[Grid::index_of(min_x, min_y, w, x, y)] = true;
                }
            }
            for y in node.y..node.y + node.h {
                for x in node.x..node.x + node.w {
                    blocked[Grid::index_of(min_x, min_y, w, x, y)] = true;
                }
            }
        }
        Grid {
            min: (min_x, min_y),
            w,
            h,
            blocked,
            border_band,
            count: vec![0; (w * h) as usize],
            dirs: vec![0; (w * h) as usize],
            reserved: vec![Vec::new(); (w * h) as usize],
        }
    }

    fn index_of(min_x: i32, min_y: i32, w: i32, x: i32, y: i32) -> usize {
        ((y - min_y) * w + (x - min_x)) as usize
    }

    fn index(&self, x: i32, y: i32) -> Option<usize> {
        if x < self.min.0 || y < self.min.1 {
            return None;
        }
        let (dx, dy) = (x - self.min.0, y - self.min.1);
        if dx >= self.w || dy >= self.h {
            return None;
        }
        Some((dy * self.w + dx) as usize)
    }

    fn route(
        &mut self,
        start: (i32, i32),
        start_dir: usize,
        goal: (i32, i32),
        arrive: usize,
        search: Search,
        owner: usize,
    ) -> Option<Vec<(i32, i32)>> {
        if start == goal {
            return None;
        }
        let start_index = self.index(start.0, start.1)?;
        let goal_index = self.index(goal.0, goal.1)?;
        if self.blocked[start_index]
            || self.blocked[goal_index]
            || self.reserved[start_index].iter().any(|&id| id != owner)
            || self.reserved[goal_index].iter().any(|&id| id != owner)
        {
            return None;
        }
        let stem_index = self.index(start.0 + DIRS[start_dir].0, start.1 + DIRS[start_dir].1);
        let states = (self.w * self.h) as usize * 4;
        let mut dist = vec![i64::MAX; states];
        let mut prev = vec![u32::MAX; states];
        let mut heap: BinaryHeap<(Reverse<i64>, Reverse<i64>, Reverse<u32>)> = BinaryHeap::new();

        let start_state = start_index * 4 + start_dir;
        dist[start_state] = 0;
        heap.push((Reverse(0), Reverse(0), Reverse(start_state as u32)));

        while let Some((_, Reverse(cost), Reverse(state))) = heap.pop() {
            let state = state as usize;
            if cost > dist[state] {
                continue;
            }
            let cell = state / 4;
            let dir = state % 4;
            let (x, y) = (
                self.min.0 + (cell as i32 % self.w),
                self.min.1 + (cell as i32 / self.w),
            );
            if cell == goal_index && dir == arrive {
                return Some(self.reconstruct(&prev, state, goal));
            }
            for (next_dir, &(dx, dy)) in DIRS.iter().enumerate() {
                if next_dir == (dir + 2) % 4
                    || (state == start_state && next_dir != start_dir)
                    || (search.straight_stem && Some(cell) == stem_index && next_dir != dir)
                    || (self.count[cell] > 0 && next_dir != dir)
                {
                    continue; // outward departure, no U-turn, no bend on a
                    // stem or on a crossing
                }
                let (nx, ny) = (x + dx, y + dy);
                let Some(next_cell) = self.index(nx, ny) else {
                    continue;
                };
                if self.blocked[next_cell]
                    || (self.border_band[next_cell] && next_cell != goal_index)
                    || self.reserved[next_cell].iter().any(|&id| id != owner)
                    || (next_cell == goal_index && next_dir != arrive)
                {
                    continue;
                }
                if self.count[next_cell] > 0 {
                    let perpendicular = if next_dir.is_multiple_of(2) {
                        L_BIT | R_BIT
                    } else {
                        U_BIT | D_BIT
                    };
                    if self.dirs[next_cell] != perpendicular {
                        continue; // only straight, perpendicular crossings; never shared runs
                    }
                }
                let step = STEP_COST
                    + if next_dir == dir { 0 } else { TURN_COST }
                    + if Some(next_dir) == search.against {
                        AGAINST_FLOW_COST
                    } else {
                        0
                    }
                    + self.cell_penalty(next_cell, next_dir);
                let next_state = next_cell * 4 + next_dir;
                let next_cost = cost + step;
                if next_cost < dist[next_state] {
                    dist[next_state] = next_cost;
                    prev[next_state] = state as u32;
                    let heuristic = ((goal.0 - nx).abs() + (goal.1 - ny).abs()) as i64 * STEP_COST;
                    heap.push((
                        Reverse(next_cost + heuristic),
                        Reverse(next_cost),
                        Reverse(next_state as u32),
                    ));
                }
            }
        }
        None
    }

    fn cell_penalty(&self, cell: usize, dir: usize) -> i64 {
        let x = self.min.0 + (cell as i32 % self.w);
        let y = self.min.1 + (cell as i32 / self.w);
        let mut penalty = 0;
        if self.count[cell] > 0 {
            penalty += CROSSING_COST;
        }
        // Keep one blank cell between parallel runs.
        let (px, py) = if dir.is_multiple_of(2) {
            (1, 0)
        } else {
            (0, 1)
        };
        for (sx, sy) in [(px, py), (-px, -py)] {
            if let Some(index) = self.index(x + sx, y + sy)
                && self.count[index] > 0
            {
                penalty += ADJACENT_COST;
            }
        }
        // Do not hug a node border.
        for (sx, sy) in DIRS {
            if let Some(index) = self.index(x + sx, y + sy)
                && self.blocked[index]
            {
                penalty += HUG_COST;
            }
        }
        penalty
    }

    fn reconstruct(&self, prev: &[u32], state: usize, goal: (i32, i32)) -> Vec<(i32, i32)> {
        let mut cells = Vec::new();
        let mut cursor = state as u32;
        cells.push(goal);
        while cursor != u32::MAX {
            let cell = cursor as usize / 4;
            let x = self.min.0 + (cell as i32 % self.w);
            let y = self.min.1 + (cell as i32 / self.w);
            if cells.last() != Some(&(x, y)) {
                cells.push((x, y));
            }
            cursor = prev[cursor as usize];
        }
        cells.reverse();
        simplify(&cells)
    }

    /// Marks one cell as owned by `owner`: no other route may enter it.
    fn reserve_cell(&mut self, cell: (i32, i32), owner: usize) {
        if let Some(index) = self.index(cell.0, cell.1)
            && !self.reserved[index].contains(&owner)
        {
            self.reserved[index].push(owner);
        }
    }

    /// Reserves every cell of a finished route, so a later route cannot
    /// share a run with it — two trunk spurs must stay apart.
    fn reserve_route(&mut self, points: &[(i32, i32)], owner: usize) {
        for cell in route_cells(points) {
            self.reserve_cell(cell, owner);
        }
    }

    /// True when a corridor cell can still carry a junction: only the
    /// corridor is on it, and nothing has reserved it.
    fn tap_ready(&self, cell: (i32, i32), owner: usize) -> bool {
        let Some(index) = self.index(cell.0, cell.1) else {
            return false;
        };
        self.count[index] == 1
            && !self.border_band[index]
            && self.reserved[index].iter().all(|&id| id == owner)
    }

    /// True when the cell one step from `cell` in direction `dir` is open
    /// canvas: not a node, not hugging a node, unclaimed and unreserved.
    fn step_is_free(&self, cell: (i32, i32), dir: usize, owner: usize) -> bool {
        let (dx, dy) = DIRS[dir];
        let Some(index) = self.index(cell.0 + dx, cell.1 + dy) else {
            return false;
        };
        !self.blocked[index]
            && !self.border_band[index]
            && self.count[index] == 0
            && self.reserved[index].iter().all(|&id| id == owner)
    }

    /// Marks one cell as off limits to everyone: a label's own cells, which
    /// no route may cross. The sentinel owner matches no route.
    fn block_for_all(&mut self, cell: (i32, i32)) {
        if let Some(index) = self.index(cell.0, cell.1)
            && !self.reserved[index].contains(&NOBODY)
        {
            self.reserved[index].push(NOBODY);
        }
    }

    /// True when a corridor cell can still carry a junction: only the
    /// corridor is on it, it hugs no node, and nothing reserved it.
    fn can_hold_junction(&self, cell: (i32, i32)) -> bool {
        let Some(index) = self.index(cell.0, cell.1) else {
            return false;
        };
        !self.blocked[index]
            && !self.border_band[index]
            && self.count[index] == 0
            && self.reserved[index].is_empty()
    }

    /// Marks every cell of a route as claimed, once per cell: a route that
    /// bends on a cell must not look like two routes on it.
    fn claim(&mut self, points: &[(i32, i32)]) {
        let mut claimed: HashSet<(i32, i32)> = HashSet::new();
        for w in points.windows(2) {
            let (from, to) = (w[0], w[1]);
            let (dx, dy) = ((to.0 - from.0).signum(), (to.1 - from.1).signum());
            let len = (to.0 - from.0).abs() + (to.1 - from.1).abs();
            for step in 0..=len {
                let cell = (from.0 + dx * step, from.1 + dy * step);
                if let Some(index) = self.index(cell.0, cell.1) {
                    if claimed.insert(cell) {
                        self.count[index] = self.count[index].saturating_add(1);
                    }
                    let bit = match (dx, dy) {
                        (0, -1) => U_BIT,
                        (1, 0) => R_BIT,
                        (0, 1) => D_BIT,
                        (-1, 0) => L_BIT,
                        _ => 0,
                    };
                    if step < len {
                        self.dirs[index] |= bit;
                    }
                    if step > 0 {
                        let back = match (dx, dy) {
                            (0, -1) => D_BIT,
                            (1, 0) => L_BIT,
                            (0, 1) => U_BIT,
                            (-1, 0) => R_BIT,
                            _ => 0,
                        };
                        self.dirs[index] |= back;
                    }
                }
            }
        }
    }

    /// Gives a claimed route back, so a trunk can re-plan the corridor it
    /// already routed. Counts drop to zero and the direction bits clear.
    fn unclaim(&mut self, points: &[(i32, i32)]) {
        let mut claimed: HashSet<(i32, i32)> = HashSet::new();
        for cell in route_cells(points) {
            let Some(index) = self.index(cell.0, cell.1) else {
                continue;
            };
            if !claimed.insert(cell) {
                continue;
            }
            self.count[index] = self.count[index].saturating_sub(1);
            if self.count[index] == 0 {
                self.dirs[index] = 0;
            }
        }
    }
}

/// Drops the middle cells of collinear runs, leaving one point per bend.
fn simplify(cells: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let mut out: Vec<(i32, i32)> = Vec::with_capacity(cells.len());
    for (index, &cell) in cells.iter().enumerate() {
        if index > 0 && index + 1 < cells.len() {
            let prev = cells[index - 1];
            let next = cells[index + 1];
            let straight =
                (prev.0 == cell.0 && cell.0 == next.0) || (prev.1 == cell.1 && cell.1 == next.1);
            if straight {
                continue;
            }
        }
        out.push(cell);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, x: i32, y: i32, w: i32, layer: usize) -> NodeBox {
        NodeBox {
            id: id.into(),
            x,
            y,
            w,
            h: 3,
            layer,
        }
    }

    #[test]
    fn fan_out_gets_one_port_per_edge() {
        let nodes = vec![
            node("a", 10, 0, 6, 0),
            node("b", 0, 10, 6, 1),
            node("c", 20, 10, 6, 1),
        ];
        let edges = vec![EdgeSpec::new(0, 1), EdgeSpec::new(0, 2)];
        let (ports, _) = assign_ports(&nodes, &edges, FlowAxis::TopToBottom);
        assert_ne_eq(ports[0].0, ports[1].0);
    }

    #[test]
    fn impossible_routes_are_reported_instead_of_drawing_through_nodes() {
        let nodes = vec![node("a", 0, 0, 7, 0), node("b", 0, 4, 7, 1)];
        let edges = vec![EdgeSpec::new(0, 1).with_label("blocked")];
        let plan = plan(&nodes, &edges, FlowAxis::TopToBottom);
        assert_eq!(plan.unrouted, vec![0]);
        assert!(plan.routes[0].is_none());
        assert_eq!(plan.labels_skipped, 1);
    }

    #[test]
    fn undersized_boxes_do_not_grow_detached_ports() {
        let nodes = vec![
            node("a", 10, 0, 3, 0),
            node("b", 0, 10, 7, 1),
            node("c", 20, 10, 7, 1),
        ];
        let edges = vec![EdgeSpec::new(0, 1), EdgeSpec::new(0, 2)];
        let plan = plan(&nodes, &edges, FlowAxis::TopToBottom);
        assert!(plan.unrouted.contains(&1));
        assert!(plan.routes[1].is_none());
    }

    #[test]
    fn shared_run_counts_ports_and_axes_after_a_crossing() {
        let routes = vec![
            expand_axes(&[(0, 3), (4, 3)]),
            expand_axes(&[(1, 2), (1, 5)]),
            expand_axes(&[(1, 3), (1, 6)]),
        ];
        assert_eq!(longest_shared_run(&routes), 3);
        assert_eq!(
            longest_shared_run(&[
                expand_axes(&[(1, 3), (1, 4)]),
                expand_axes(&[(1, 4), (1, 5)])
            ]),
            1
        );
    }

    fn assert_ne_eq(a: (i32, i32), b: (i32, i32)) {
        assert_ne!(a, b, "parallel edges must not share a port");
    }

    #[test]
    fn routes_do_not_share_a_corridor() {
        let nodes = vec![
            node("a", 20, 0, 7, 0),
            node("b", 0, 8, 6, 1),
            node("c", 20, 8, 6, 1),
            node("d", 40, 8, 6, 1),
        ];
        let edges = vec![
            EdgeSpec::new(0, 1),
            EdgeSpec::new(0, 2),
            EdgeSpec::new(0, 3),
        ];
        let plan = plan(&nodes, &edges, FlowAxis::TopToBottom);
        assert!(plan.unrouted.is_empty(), "{:?}", plan.unrouted);
        assert_eq!(plan.shared_run, 0);
        for route in plan.routes.iter().flatten() {
            assert!(route.points.len() >= 2);
        }
    }

    #[test]
    fn a_two_cell_detour_beats_a_bridge() {
        // Open canvas between two far-apart boxes, crossed by an earlier
        // route: a wall at row 10 covering x = 2..=8. Crossing it at x = 7
        // is one bridge; going around its end costs four extra cells and
        // four bends, which the cost function must prefer.
        // A crossing must cost more than a two-cell detour (four extra
        // cells, four bends); the renderer would rather walk around.
        const { assert!(CROSSING_COST > 4 * STEP_COST + 4 * TURN_COST) };
        let nodes = vec![node("a", 10, 0, 4, 0), node("b", 0, 40, 4, 1)];
        let mut grid = Grid::new(&nodes, 2);
        grid.claim(&[(2, 10), (8, 10)]);
        let route = grid
            .route((7, 5), 2, (7, 15), 2, Search::default(), 99)
            .expect("a route exists around the wall");
        assert!(
            !route.contains(&(7, 10)),
            "the bridge cell must be left alone: {route:?}"
        );
        // The detour passes the wall's end (x = 9) instead.
        assert!(
            route.iter().any(|&(x, _)| x >= 9),
            "expected the route to go around the wall end: {route:?}"
        );
        let cells = route_cells(&route);
        assert!(
            cells.len() > 11,
            "expected a detour, got {} cells for an 11-cell run",
            cells.len()
        );
    }

    #[test]
    fn crossings_are_counted_once_per_bridge_cell() {
        // One perpendicular crossing, one parallel pair (never drawn as a
        // bridge, that is a shared run), and one route meeting itself.
        let crossing = vec![
            expand_axes(&[(0, 3), (4, 3)]),
            expand_axes(&[(1, 2), (1, 5)]),
        ];
        let none: HashSet<(i32, i32)> = HashSet::new();
        assert_eq!(count_crossings(&crossing, &none), (1, 0));
        let parallel = vec![
            expand_axes(&[(0, 3), (4, 3)]),
            expand_axes(&[(0, 4), (4, 4)]),
        ];
        assert_eq!(count_crossings(&parallel, &none), (0, 0));
        let twice = vec![expand_axes(&[(0, 3), (8, 3), (8, 6), (4, 6), (4, 2)])];
        assert_eq!(
            count_crossings(&twice, &none),
            (0, 0),
            "one route cannot bridge itself"
        );
        let two_bridges = vec![
            expand_axes(&[(0, 3), (8, 3)]),
            expand_axes(&[(2, 0), (2, 9)]),
            expand_axes(&[(6, 0), (6, 9)]),
        ];
        assert_eq!(count_crossings(&two_bridges, &none), (2, 0));
    }

    #[test]
    fn ports_follow_the_far_endpoint_order() {
        // Spec order is scrambled on purpose: the ports must be ordered by
        // where each edge is going, so the fan leaves without braiding.
        let nodes = vec![
            node("s", 20, 0, 9, 0),
            node("t1", 0, 10, 4, 1),
            node("t2", 20, 10, 4, 1),
            node("t3", 40, 10, 4, 1),
        ];
        let edges = vec![
            EdgeSpec::new(0, 3),
            EdgeSpec::new(0, 1),
            EdgeSpec::new(0, 2),
        ];
        let (ports, _) = assign_ports(&nodes, &edges, FlowAxis::TopToBottom);
        // Far endpoints left to right are t1, t2, t3, so the source ports
        // must run left to right in that same order.
        assert!(
            ports[1].0.0 < ports[2].0.0 && ports[2].0.0 < ports[0].0.0,
            "source ports braid: {:?}",
            ports.iter().map(|pair| pair.0).collect::<Vec<_>>()
        );
    }

    #[test]
    fn labels_avoid_node_boxes() {
        let nodes = vec![node("a", 10, 0, 8, 0), node("b", 10, 8, 8, 1)];
        let edges = vec![EdgeSpec::new(0, 1).with_label("writes")];
        let plan = plan(&nodes, &edges, FlowAxis::TopToBottom);
        let anchor = plan.routes[0].as_ref().unwrap().label.unwrap();
        let len = "writes".len() as i32;
        for x in anchor.0 - len / 2..=anchor.0 + len / 2 {
            for node in &nodes {
                assert!(!node.contains(x, anchor.1), "label covers a node");
            }
        }
    }
}
