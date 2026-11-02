//! The layered layout engine: a Sugiyama/dagre pipeline over a plain directed
//! graph, so a spec never has to say where anything goes.
//!
//! The five passes are the ones Mermaid's dagre prints use, in order:
//!
//! 1. **Break cycles.** A DFS reverses only true back edges, so the ranking
//!    sees a DAG while the renderer still draws the arrow the author wrote.
//! 2. **Rank.** Longest-path ranking puts every node in a row; a balancing
//!    sweep then moves each node to the feasible rank that shortens its
//!    edges.
//! 3. **Order.** Nodes are reordered *within* their rank by barycenter
//!    sweeps (median of the adjacent rank, down then up), the best order is
//!    kept, and the search stops after four sweeps without improvement.
//!    Crossings are counted with an accumulator tree (Barth–Jünger–Mutzel),
//!    and the objective charges bends above crossings: a path nobody can
//!    follow is worse than a tidy diagram with intersections.
//! 4. **Coordinates.** Every rank is laid out independently, sized by its
//!    own contents, and the ranks are centred on one axis. Long edges get a
//!    dummy slot per rank they cross, so they run straight instead of
//!    wandering; a labelled edge gets a slot sized to its label, so the
//!    label owns its space instead of fighting for it afterwards.
//! 5. **Reserve.** The control palette's corner is kept free of node boxes,
//!    so the legend never paints over a border.
//!
//! A `group` is a logical tag, never a drawn box: it costs no cells and no
//! border. It drives two things only. Group blocks are the one constraint
//! ordering may not break: the members of a group stay contiguous in every
//! rank and sibling groups keep one stable left-to-right order, so a group
//! reads as one block wherever it appears. And a group's hue derives from its
//! NAME, so it keeps its color in every view of a case.
//!
//! Two declarative constraints ride on top of the automatic passes:
//!
//! - **Rank pins.** A node may declare its rank. A pin is a hard boundary:
//!   the ranking never moves a pinned node, and it treats the pin as a wall
//!   that unpinned nodes rank around. Ordering inside a rank stays
//!   automatic, so a pinned tier keeps its own order free.
//! - **`minlen` gaps.** An edge may ask for more than one rank of
//!   separation, which widens the channel a label or a trunk corridor needs.
//!   When declared pins cannot give an edge its gap, the conflict is
//!   reported instead of the pin being silently overruled.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::Direction;

/// Cells the control palette covers at the bottom-left of the canvas,
/// including its one-cell margin. The layout keeps node boxes out of this
/// rectangle so the legend can never paint over a border.
pub const PALETTE_W: i32 = 10;
pub const PALETTE_H: i32 = 6;

/// Blank cells between two slots of one rank, across the flow. A `tb` rank is
/// a row, and neighbours need room for their ports and arrows.
const ACROSS_GAP_TB: f64 = 3.0;
/// In `lr` a rank is a column, and neighbours only need one blank cell.
const ACROSS_GAP_LR: f64 = 1.0;
/// Smallest channel between two ranks, along the flow.
const ALONG_GAP_MIN: i32 = 3;
/// Extra channel per pair of edges crossing a gap.
const ALONG_GAP_PER_EDGE: i32 = 1;
/// How many sweeps the ordering may run at most.
const MAX_SWEEPS: usize = 24;
/// How many sweeps without improvement before the search stops.
const SWEEP_PATIENCE: usize = 4;
/// Bend penalties: 0, 0, 5, 12, 30, then doubling. A bend costs more than a
/// crossing, and the curve makes two bends much worse than one.
const BEND_PENALTY: [i64; 8] = [0, 0, 5, 12, 30, 60, 120, 240];
/// One node the layout must place.
#[derive(Debug, Clone)]
pub struct LayoutNode {
    pub id: String,
    /// Box size in cells: width and height.
    pub w: f64,
    pub h: f64,
    /// Semantic group name, when the spec declares one.
    pub group: Option<String>,
}

/// One relationship the layout must route around.
#[derive(Debug, Clone)]
pub struct LayoutEdge {
    pub from: String,
    pub to: String,
    /// Width of the edge label in cells, when it has one.
    pub label_width: Option<usize>,
    /// True when the label asks for a horizontal gutter band beside its own
    /// run (`label_slot`) instead of a rank gap as tall as the text is wide.
    pub label_gutter: bool,
    /// Rank gaps this edge needs at least: 1 (the default) means the ends
    /// sit in consecutive ranks, 2 leaves one empty rank between them.
    pub minlen: usize,
}

impl LayoutEdge {
    /// An edge that asks only for the default one-rank separation.
    pub fn new(from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            label_width: None,
            label_gutter: false,
            minlen: 1,
        }
    }

    /// Attaches a label width, which buys the edge its own slot on the rank
    /// it spans.
    pub fn with_label_width(mut self, width: usize) -> Self {
        self.label_width = Some(width);
        self
    }

    /// Asks for `minlen` rank gaps. A value below 1 means the default.
    pub fn with_minlen(mut self, minlen: usize) -> Self {
        self.minlen = minlen.max(1);
        self
    }
}

/// Declarative constraints the engine must honor, one optional pin per node
/// (same order as the `nodes` slice).
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Declared rank per node. `None` leaves the node to the ranking pass.
    pub pins: Vec<Option<usize>>,
}

impl Options {
    /// Pins some nodes; the rest rank automatically.
    pub fn with_pins(pins: Vec<Option<usize>>) -> Self {
        Self { pins }
    }
}

/// An edge whose declared pins cannot give it the rank gap it asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinConflict {
    pub from: String,
    pub to: String,
    /// Rank gaps the edge declared through `minlen`.
    pub minlen: usize,
    /// Rank gaps the pins actually leave between the two ends.
    pub available: usize,
}

impl PinConflict {
    /// The `--check` line for this conflict: the exact numbers, so the spec
    /// author can fix the tiers instead of guessing.
    pub fn line(&self) -> String {
        format!(
            "pins-conflict: edge {} -> {} needs {} rank gaps, the declared ranks give {}",
            self.from, self.to, self.minlen, self.available
        )
    }
}

/// What the engine produced: node positions, the rank each node landed in,
/// and the label slot every labelled edge owns.
#[derive(Debug, Clone, Default)]
pub struct Placement {
    /// Top-left cell of every node box.
    pub positions: BTreeMap<String, (f64, f64)>,
    /// Node ids per rank, in left-to-right (across) order.
    pub ranks: Vec<Vec<String>>,
    /// Label slot anchor per edge index.
    pub labels: BTreeMap<usize, (i32, i32)>,
    /// Crossings the same graph would draw in declaration order.
    pub crossings_before: usize,
    /// Crossings the ordered layout draws.
    pub crossings_after: usize,
    /// Size of the drawing in cells.
    pub extent: (i32, i32),
    /// The palette rectangle the layout kept clear, in graph coordinates.
    pub palette: (i32, i32, i32, i32),
    /// Edges whose pins cannot satisfy their declared `minlen`, in spec
    /// order. Empty when every declared gap is honored.
    pub conflicts: Vec<PinConflict>,
}

/// One slot of a rank: a real node, a long-edge dummy, or a label dummy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SlotKind {
    Node,
    /// A long edge passing through this rank.
    Dummy,
    /// The label of a long edge, which owns space on this rank.
    Label,
}

#[derive(Debug, Clone)]
struct Slot {
    kind: SlotKind,
    /// Index into the spec's node list, for a real node.
    node: Option<usize>,
    /// Across extent in cells: a node's height in `lr`, its width in `tb`.
    across: f64,
    /// Cells this slot adds along the flow, for a rank that must be wide
    /// enough to hold a label.
    along_pad: i32,
}

/// The graph the passes work on.
struct Engine<'a> {
    nodes: &'a [LayoutNode],
    /// Successors, deduplicated, in the cycle-broken direction.
    down: Vec<Vec<usize>>,
    up: Vec<Vec<usize>>,
    /// Rank gaps an edge asks for, keyed by its cycle-broken ends.
    span: HashMap<(usize, usize), usize>,
}

/// Lays the graph out automatically: ranks, order, coordinates, and label
/// slots.
pub fn layout(nodes: &[LayoutNode], edges: &[LayoutEdge], axis: Direction) -> Placement {
    layout_with(nodes, edges, axis, &Options::default())
}

/// Lays the graph out with declared pins and `minlen` gaps honored.
pub fn layout_with(
    nodes: &[LayoutNode],
    edges: &[LayoutEdge],
    axis: Direction,
    options: &Options,
) -> Placement {
    if nodes.is_empty() {
        return Placement::default();
    }
    let index: HashMap<&str, usize> = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.as_str(), index))
        .collect();
    // Keep only edges whose ends are both known: an unknown id would place a
    // node the spec never declared.
    let edges: Vec<LayoutEdge> = edges
        .iter()
        .filter(|edge| {
            index.contains_key(edge.from.as_str()) && index.contains_key(edge.to.as_str())
        })
        .cloned()
        .collect();
    let engine = Engine::new(nodes, &edges, &index);
    engine.run(nodes, &edges, axis, options)
}

impl<'a> Engine<'a> {
    fn new(nodes: &'a [LayoutNode], edges: &[LayoutEdge], index: &HashMap<&str, usize>) -> Self {
        let n = nodes.len();
        let mut down: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut raw: Vec<Vec<usize>> = vec![Vec::new(); n];
        for edge in edges {
            let (u, v) = (index[edge.from.as_str()], index[edge.to.as_str()]);
            if u == v {
                continue; // a self edge ranks in place
            }
            if !raw[u].contains(&v) {
                raw[u].push(v);
            }
        }
        // Break cycles: a DFS reverses only true back edges, so the ranking
        // sees a DAG. The reversal is a ranking device; the renderer still
        // draws the arrow the author wrote.
        let mut state = vec![0u8; n]; // 0 unvisited, 1 on stack, 2 done
        let mut reversed: HashSet<(usize, usize)> = HashSet::new();
        for start in 0..n {
            if state[start] != 0 {
                continue;
            }
            let mut stack: Vec<(usize, usize)> = vec![(start, 0)];
            state[start] = 1;
            while !stack.is_empty() {
                let (current, next) = match stack.last() {
                    Some(frame) => (frame.0, frame.1),
                    None => break,
                };
                if next < raw[current].len() {
                    stack.last_mut().expect("frame").1 += 1;
                    let target = raw[current][next];
                    match state[target] {
                        0 => {
                            state[target] = 1;
                            stack.push((target, 0));
                        }
                        1 => {
                            reversed.insert((current, target));
                        }
                        _ => {}
                    }
                } else {
                    state[current] = 2;
                    stack.pop();
                }
            }
        }
        let mut span: HashMap<(usize, usize), usize> = HashMap::new();
        for u in 0..n {
            for &v in &raw[u] {
                if reversed.contains(&(u, v)) {
                    down[v].push(u);
                } else {
                    down[u].push(v);
                }
            }
        }
        // The declared gap belongs to the edge's DAG direction: a reversed
        // edge is a ranking device, so its `minlen` follows the reversal.
        for edge in edges {
            let (u, v) = (index[edge.from.as_str()], index[edge.to.as_str()]);
            if u == v {
                continue;
            }
            let key = if reversed.contains(&(u, v)) {
                (v, u)
            } else {
                (u, v)
            };
            let slot = span.entry(key).or_insert(1);
            *slot = (*slot).max(edge.minlen.max(1));
        }
        let mut up: Vec<Vec<usize>> = vec![Vec::new(); n];
        for (u, successors) in down.iter().enumerate() {
            for &v in successors {
                up[v].push(u);
            }
        }
        Engine {
            nodes,
            down,
            up,
            span,
        }
    }

    /// Rank gaps the edge `u -> v` asks for (1 when it declares nothing).
    fn span(&self, u: usize, v: usize) -> usize {
        self.span.get(&(u, v)).copied().unwrap_or(1)
    }

    /// Longest-path ranking with `minlen` gaps, then the pins, then the
    /// balancing sweep.
    fn rank(&self, pins: &[Option<usize>]) -> Vec<usize> {
        let n = self.nodes.len();
        // Topological order of the DAG (Kahn), sources first.
        let mut indegree: Vec<usize> = (0..n).map(|v| self.up[v].len()).collect();
        let mut queue: Vec<usize> = (0..n).filter(|&v| indegree[v] == 0).collect();
        let mut order: Vec<usize> = Vec::with_capacity(n);
        while let Some(u) = queue.pop() {
            order.push(u);
            for &v in &self.down[u] {
                indegree[v] -= 1;
                if indegree[v] == 0 {
                    queue.push(v);
                }
            }
        }
        // A cycle the DFS missed (should not happen) keeps its declaration
        // order rather than dropping nodes.
        for v in 0..n {
            if !order.contains(&v) {
                order.push(v);
            }
        }
        let mut rank = vec![0usize; n];
        for &u in &order {
            for &v in &self.down[u] {
                rank[v] = rank[v].max(rank[u] + self.span(u, v));
            }
        }
        // A pin is a wall: the declared rank wins outright, and the unpinned
        // nodes around it move instead. Never the other way round.
        for (v, slot) in rank.iter_mut().enumerate() {
            if let Some(pin) = pin_of(pins, v) {
                *slot = pin;
            }
        }
        for _ in 0..8 {
            let mut changed = false;
            for &u in &order {
                for &v in &self.down[u] {
                    let need = rank[u] + self.span(u, v);
                    if rank[v] >= need {
                        continue;
                    }
                    if pin_of(pins, v).is_none() {
                        rank[v] = need;
                        changed = true;
                    } else if pin_of(pins, u).is_none() {
                        // The target is pinned: pull the free source up as
                        // far as its own predecessors allow.
                        let floor = self.up[u]
                            .iter()
                            .map(|&p| rank[p] + self.span(p, u))
                            .max()
                            .unwrap_or(0);
                        let target = rank[v].saturating_sub(self.span(u, v));
                        if target >= floor && target < rank[u] {
                            rank[u] = target;
                            changed = true;
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }
        self.balance(&mut rank, &order, pins);
        rank
    }

    /// Moves each free node to the feasible rank that shortens its edges. A
    /// pinned node is not a candidate: the spec's tier is not the engine's to
    /// move.
    fn balance(&self, rank: &mut [usize], order: &[usize], pins: &[Option<usize>]) {
        for sweep in 0..8 {
            let mut changed = false;
            let pass: Vec<usize> = if sweep % 2 == 0 {
                order.to_vec()
            } else {
                order.iter().rev().copied().collect()
            };
            for &node in &pass {
                if pin_of(pins, node).is_some() {
                    continue;
                }
                let low = self.up[node]
                    .iter()
                    .map(|&p| rank[p] + self.span(p, node))
                    .max()
                    .unwrap_or(0);
                // A sink has no successor pulling it down, so its own rank is
                // the upper bound: `usize::MAX` here would sweep the whole
                // address space instead of one candidate.
                let high = self.down[node]
                    .iter()
                    .map(|&s| rank[s].saturating_sub(self.span(node, s)))
                    .min()
                    .unwrap_or(low);
                if high < low || low == high {
                    continue;
                }
                let current = rank[node];
                let mut best = current;
                let mut best_cost = i64::MAX;
                for candidate in low..=high {
                    let mut cost = 0i64;
                    for &p in &self.up[node] {
                        cost += (candidate as i64 - rank[p] as i64).abs();
                    }
                    for &s in &self.down[node] {
                        cost += (candidate as i64 - rank[s] as i64).abs();
                    }
                    if cost < best_cost || (cost == best_cost && candidate < best) {
                        best_cost = cost;
                        best = candidate;
                    }
                }
                if best != current {
                    rank[node] = best;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
    }

    /// Runs every pass and returns the placement.
    fn run(
        self,
        nodes: &[LayoutNode],
        edges: &[LayoutEdge],
        axis: Direction,
        options: &Options,
    ) -> Placement {
        let pins = &options.pins;
        let rank = self.rank(pins);
        let rank_count = rank.iter().copied().max().map(|r| r + 1).unwrap_or(1);
        // Edges whose declared gap the pins cannot give. Reported, never
        // repaired by moving a pinned node.
        let mut conflicts: Vec<PinConflict> = Vec::new();
        for edge in edges {
            let Some((u, v)) = edge_ends(nodes, edge) else {
                continue;
            };
            if rank[v] < rank[u] || edge.minlen <= 1 {
                continue;
            }
            let available = rank[v] - rank[u];
            if available < edge.minlen {
                conflicts.push(PinConflict {
                    from: edge.from.clone(),
                    to: edge.to.clone(),
                    minlen: edge.minlen,
                    available,
                });
            }
        }

        // Slots: real nodes first, then one dummy per rank a long edge
        // crosses. A labelled edge's middle dummy carries the label.
        let mut slots: Vec<Slot> = nodes
            .iter()
            .map(|node| Slot {
                kind: SlotKind::Node,
                node: None,
                across: match axis {
                    Direction::TopToBottom => node.w,
                    Direction::LeftToRight => node.h,
                },
                along_pad: 0,
            })
            .collect();
        for (index, slot) in slots.iter_mut().enumerate() {
            slot.node = Some(index);
        }
        // The rank of every slot, real or dummy.
        let mut slot_rank: Vec<usize> = rank.clone();
        // Chains of slot ids per edge, in travel order.
        let mut chains: Vec<Vec<usize>> = Vec::with_capacity(edges.len());
        let mut label_slot_of: Vec<Option<usize>> = vec![None; edges.len()];
        for (index, edge) in edges.iter().enumerate() {
            let index_of = |id: &str| {
                nodes
                    .iter()
                    .position(|node| node.id == id)
                    .unwrap_or_default()
            };
            let (u, v) = (index_of(&edge.from), index_of(&edge.to));
            let mut chain = vec![u];
            if rank[v] > rank[u] + 1 {
                let span = rank[v] - rank[u];
                let label_rank = if edge.label_width.is_some() && span >= 2 && !edge.label_gutter {
                    Some(rank[u] + span / 2)
                } else {
                    None
                };
                for step in 1..span {
                    let at = rank[u] + step;
                    let is_label = label_rank == Some(at);
                    let width = edge.label_width.unwrap_or(0) as f64;
                    let slot = Slot {
                        kind: if is_label {
                            SlotKind::Label
                        } else {
                            SlotKind::Dummy
                        },
                        node: None,
                        across: match axis {
                            Direction::TopToBottom => {
                                if is_label {
                                    width.max(1.0)
                                } else {
                                    1.0
                                }
                            }
                            Direction::LeftToRight => 1.0,
                        },
                        along_pad: if is_label && axis == Direction::LeftToRight {
                            edge.label_width.unwrap_or(0) as i32 + 2
                        } else {
                            0
                        },
                    };
                    slots.push(slot);
                    slot_rank.push(at);
                    if is_label {
                        label_slot_of[index] = Some(slots.len() - 1);
                    }
                    chain.push(slots.len() - 1);
                }
            }
            chain.push(v);
            chains.push(chain);
        }
        // Dummy adjacency: consecutive slots of a chain.
        let mut down_slots: Vec<Vec<usize>> = vec![Vec::new(); slots.len()];
        let mut up_slots: Vec<Vec<usize>> = vec![Vec::new(); slots.len()];
        for chain in &chains {
            for window in chain.windows(2) {
                if !down_slots[window[0]].contains(&window[1]) {
                    down_slots[window[0]].push(window[1]);
                }
                if !up_slots[window[1]].contains(&window[0]) {
                    up_slots[window[1]].push(window[0]);
                }
            }
        }

        // Group blocks: one atomic unit per group, plus one per ungrouped
        // node. Group order is fixed across every rank.
        let mut group_names: Vec<String> = Vec::new();
        for node in nodes {
            if let Some(group) = node.group.as_deref()
                && !group_names.iter().any(|name| name == group)
            {
                group_names.push(group.to_string());
            }
        }
        let group_index: HashMap<&str, usize> = group_names
            .iter()
            .enumerate()
            .map(|(index, name)| (name.as_str(), index))
            .collect();

        // The group of every slot: only a real node can carry one.
        let slot_group: Vec<Option<usize>> = slots
            .iter()
            .map(|slot| {
                slot.node
                    .and_then(|node| nodes[node].group.as_deref())
                    .and_then(|group| group_index.get(group).copied())
            })
            .collect();

        // Initial order: rank 0 by declaration, later ranks by the average
        // position of their predecessors.
        let mut layers: Vec<Vec<usize>> = vec![Vec::new(); rank_count];
        for (id, _) in slots.iter().enumerate() {
            layers[slot_rank[id]].push(id);
        }
        for rank_index in 0..rank_count {
            if rank_index == 0 {
                layers[0].sort_by_key(|&id| slots[id].node.unwrap_or(usize::MAX));
                continue;
            }
            let previous = layers[rank_index - 1].clone();
            let position: HashMap<usize, usize> = previous
                .iter()
                .enumerate()
                .map(|(index, &id)| (id, index))
                .collect();
            let layer = &mut layers[rank_index];
            layer.sort_by_key(|&id| {
                let score: f64 = if up_slots[id].is_empty() {
                    f64::INFINITY
                } else {
                    up_slots[id]
                        .iter()
                        .map(|other| {
                            position
                                .get(other)
                                .map(|&p| p as f64)
                                .unwrap_or(previous.len() as f64)
                        })
                        .sum::<f64>()
                        / up_slots[id].len() as f64
                };
                (Ordered(score), slots[id].node.unwrap_or(usize::MAX), id)
            });
        }

        // Declaration order is the "before" reading: the same graph without
        // the barycenter pass. It is what `--check` compares against.
        let declaration: Vec<Vec<usize>> = {
            let mut layers = vec![Vec::new(); rank_count];
            for (id, _) in slots.iter().enumerate() {
                layers[slot_rank[id]].push(id);
            }
            for layer in layers.iter_mut() {
                layer.sort_by_key(|&id| slots[id].node.unwrap_or(usize::MAX));
            }
            layers
        };
        let crossings_before = self.crossings(&declaration, &up_slots, &down_slots);

        // One global block order, decided once from the members' mean
        // positions across every rank: sibling groups keep this order in
        // every rank, so their blocks can never swap sides.
        let block_order: Vec<usize> = {
            let mut place: HashMap<usize, usize> = HashMap::new();
            for layer in layers.iter() {
                for (index, &id) in layer.iter().enumerate() {
                    place.insert(id, index);
                }
            }
            let mut scored: Vec<(Ordered, usize)> = Vec::new();
            let mut seen = std::collections::BTreeSet::new();
            for group in slot_group.iter().flatten() {
                if seen.insert(*group) {
                    let list: Vec<usize> = (0..slot_group.len())
                        .filter(|&s| slot_group[s] == Some(*group))
                        .collect();
                    let total: f64 = list
                        .iter()
                        .filter_map(|&s| place.get(&s).map(|&p| p as f64))
                        .sum();
                    let count = list.len().max(1) as f64;
                    scored.push((Ordered(total / count), *group));
                }
            }
            scored.sort();
            scored.into_iter().map(|(_, g)| g).collect()
        };

        // Barycenter sweeps, keeping the best order seen.
        let mut best = layers.clone();
        let mut best_cost = self.cost(&layers, &up_slots, &down_slots, &chains);
        let mut stale = 0;
        for sweep in 0..MAX_SWEEPS {
            let downward = sweep % 2 == 0;
            if downward {
                for rank_index in 1..rank_count {
                    let previous = layers[rank_index - 1].clone();
                    layers[rank_index] = reorder(
                        &layers[rank_index],
                        &previous,
                        true,
                        &slot_group,
                        &block_order,
                        &up_slots,
                        &down_slots,
                    );
                }
            } else {
                for rank_index in (0..rank_count.saturating_sub(1)).rev() {
                    let next = layers[rank_index + 1].clone();
                    layers[rank_index] = reorder(
                        &layers[rank_index],
                        &next,
                        false,
                        &slot_group,
                        &block_order,
                        &up_slots,
                        &down_slots,
                    );
                }
            }
            let cost = self.cost(&layers, &up_slots, &down_slots, &chains);
            if cost < best_cost {
                best_cost = cost;
                best = layers.clone();
                stale = 0;
            } else {
                stale += 1;
                if stale >= SWEEP_PATIENCE {
                    break;
                }
            }
        }
        let layers = best;
        let crossings_after = self.crossings(&layers, &up_slots, &down_slots);

        // Across positions per rank, then centre every rank on one axis.
        // This happens before the along positions because a rank gap is
        // sized from the real across distance each crossing edge travels.
        let across_gap = match axis {
            Direction::TopToBottom => ACROSS_GAP_TB,
            Direction::LeftToRight => ACROSS_GAP_LR,
        };
        let mut across_pos: Vec<BTreeMap<usize, f64>> = Vec::new();
        let mut rank_span: Vec<f64> = Vec::new();
        for layer in &layers {
            let mut map = BTreeMap::new();
            let mut cursor = 0.0f64;
            for &id in layer {
                map.insert(id, cursor);
                cursor += slots[id].across + across_gap;
            }
            rank_span.push((cursor - across_gap).max(0.0));
            across_pos.push(map);
        }
        let widest = rank_span.iter().copied().fold(0.0f64, f64::max);
        let mut across = vec![0.0f64; slots.len()];
        for (rank_index, layer) in layers.iter().enumerate() {
            let offset = ((widest - rank_span[rank_index]) / 2.0).round();
            for &id in layer {
                across[id] = offset + across_pos[rank_index][&id];
            }
        }

        // Coordinates.
        let along_gap = |rank_index: usize| -> i32 {
            let crossings = edges
                .iter()
                .filter(|edge| {
                    let Some((u, v)) = edge_ends(nodes, edge) else {
                        return false;
                    };
                    let (low, high) = (rank[u].min(rank[v]), rank[u].max(rank[v]));
                    low <= rank_index && rank_index < high
                })
                .count() as i32;
            let label_room = edges
                .iter()
                .filter_map(|edge| {
                    let (u, v) = (
                        nodes.iter().position(|node| node.id == edge.from)?,
                        nodes.iter().position(|node| node.id == edge.to)?,
                    );
                    let span = rank[u].max(rank[v]) - rank[u].min(rank[v]);
                    (span == 1
                        && rank[u] == rank_index
                        && edge.label_width.is_some()
                        && !edge.label_gutter)
                        .then(|| edge.label_width.unwrap_or(0) as i32 + 3)
                })
                .max()
                .unwrap_or(0);
            gap_lanes(nodes, edges, &rank, &across, &slots, rank_index)
                .max(ALONG_GAP_MIN + (crossings + 1) / 2 * ALONG_GAP_PER_EDGE)
                .max(label_room)
        };

        // Rank size along the flow: the widest slot, or a label's own room.
        let mut rank_along = vec![0i32; rank_count];
        for (rank_index, layer) in layers.iter().enumerate() {
            for &id in layer {
                let slot = &slots[id];
                let own = match (&slot.kind, axis) {
                    (SlotKind::Node, Direction::TopToBottom) => nodes[slot.node.unwrap()].h as i32,
                    (SlotKind::Node, Direction::LeftToRight) => nodes[slot.node.unwrap()].w as i32,
                    _ => 0,
                };
                rank_along[rank_index] = rank_along[rank_index].max(own).max(slot.along_pad);
            }
            rank_along[rank_index] = rank_along[rank_index].max(1);
        }
        let mut along = vec![0i32; rank_count];
        for rank_index in 1..rank_count {
            along[rank_index] =
                along[rank_index - 1] + rank_along[rank_index - 1] + along_gap(rank_index - 1);
        }

        // Real nodes take their own top-left cell.
        let mut positions: BTreeMap<String, (f64, f64)> = BTreeMap::new();
        for (id, slot) in slots.iter().enumerate() {
            let Some(node) = slot.node else {
                continue;
            };
            let (x, y) = match axis {
                Direction::TopToBottom => (
                    across[id],
                    along[slot_rank[id]] as f64
                        + (rank_along[slot_rank[id]] as f64 - nodes[node].h) / 2.0,
                ),
                Direction::LeftToRight => (
                    along[slot_rank[id]] as f64
                        + (rank_along[slot_rank[id]] as f64 - nodes[node].w) / 2.0,
                    across[id],
                ),
            };
            positions.insert(nodes[node].id.clone(), (x.round(), y.round()));
        }

        // Label slots: one reserved rectangle per labelled edge.
        let mut occupied: Vec<(i32, i32, i32)> = Vec::new();
        let mut labels: BTreeMap<usize, (i32, i32)> = BTreeMap::new();
        for (index, edge) in edges.iter().enumerate() {
            let Some(width) = edge.label_width else {
                continue;
            };
            if width == 0 || edge_ends(nodes, edge).is_none_or(|(u, v)| u == v) {
                continue;
            }
            let (u, v) = edge_ends(nodes, edge).expect("ends");
            let Some(anchor) = label_anchor(
                nodes,
                &slots,
                &along,
                &rank_along,
                &across,
                &slot_rank,
                &positions,
                label_slot_of[index],
                (u, v),
                width as i32,
                axis,
                &along_gap,
                &occupied,
            ) else {
                continue;
            };
            let lo = anchor.0 - width as i32 / 2;
            occupied.push((lo, anchor.1, width as i32));
            labels.insert(index, anchor);
        }

        // Extent, then reserve the palette corner.
        let mut extent = (0i32, 0i32);
        for node in nodes {
            if let Some(&(x, y)) = positions.get(&node.id) {
                extent.0 = extent.0.max(x as i32 + node.w as i32 + 1);
                extent.1 = extent.1.max(y as i32 + node.h as i32 + 1);
            }
        }
        for (slot, anchor) in &labels {
            let width = edges[*slot].label_width.unwrap_or(0) as i32;
            extent.0 = extent.0.max(anchor.0 + width / 2 + 2);
            extent.1 = extent.1.max(anchor.1 + 2);
        }
        let palette = (0, (extent.1 - PALETTE_H).max(0), PALETTE_W, PALETTE_H);
        let collides = node_rects(nodes, &positions)
            .iter()
            .any(|&(x, y, w, h)| overlaps(x, y, w, h, palette));
        if collides {
            // Shift the whole graph right by the palette width: the corner
            // of the drawing is then blank, whatever the canvas does.
            let shift = PALETTE_W as f64 + 1.0;
            for position in positions.values_mut() {
                position.0 += shift;
            }
            for anchor in labels.values_mut() {
                anchor.0 += PALETTE_W + 1;
            }
            extent.0 += PALETTE_W + 1;
        }

        let mut ranks: Vec<Vec<String>> = vec![Vec::new(); rank_count];
        for (rank_index, layer) in layers.iter().enumerate() {
            for &id in layer {
                if let Some(node) = slots[id].node {
                    ranks[rank_index].push(nodes[node].id.clone());
                }
            }
        }

        Placement {
            positions,
            ranks,
            labels,
            crossings_before,
            crossings_after,
            extent,
            palette,
            conflicts,
        }
    }

    /// Total crossings + bend penalties for one ordering.
    fn cost(
        &self,
        layers: &[Vec<usize>],
        up: &[Vec<usize>],
        down: &[Vec<usize>],
        chains: &[Vec<usize>],
    ) -> i64 {
        let _ = (up, down);
        let crossings = self.crossings(layers, up, down) as i64;
        let mut position: HashMap<usize, i64> = HashMap::new();
        for layer in layers {
            for (index, &id) in layer.iter().enumerate() {
                position.insert(id, index as i64);
            }
        }
        let mut bends = 0i64;
        for chain in chains {
            let mut last = 0i64;
            let mut previous = 0i64;
            for window in chain.windows(2) {
                let (a, b) = (position[&window[0]], position[&window[1]]);
                let delta = b - a;
                if delta.abs() >= 1 && previous != 0 && delta.signum() != previous.signum() {
                    bends += 1;
                }
                if delta != 0 {
                    previous = delta.signum();
                }
                let _ = &mut last;
            }
        }
        crossings + bend_cost(bends)
    }

    /// Crossings between adjacent ranks, counted with an accumulator tree.
    fn crossings(&self, layers: &[Vec<usize>], _up: &[Vec<usize>], down: &[Vec<usize>]) -> usize {
        let mut position: HashMap<usize, usize> = HashMap::new();
        for layer in layers {
            for (index, &id) in layer.iter().enumerate() {
                position.insert(id, index);
            }
        }
        let mut total = 0;
        for rank_index in 0..layers.len().saturating_sub(1) {
            // Segments from this rank to the next, ordered by the upper end.
            let mut segments: Vec<(usize, usize)> = Vec::new();
            for &u in &layers[rank_index] {
                for &v in &down[u] {
                    if layers[rank_index + 1].contains(&v) {
                        segments.push((position[&u], position[&v]));
                    }
                }
            }
            segments.sort_unstable();
            total += accumulator_crossings(&segments, layers[rank_index + 1].len());
        }
        total
    }
}

/// Crossings of a set of segments sorted by their upper endpoint, counted
/// with an accumulator tree: `tree` sums the lower endpoints already seen
/// greater than the current one.
fn accumulator_crossings(segments: &[(usize, usize)], lower_width: usize) -> usize {
    if segments.len() < 2 {
        return 0;
    }
    let mut tree = vec![0usize; lower_width + 2];
    let add = |tree: &mut Vec<usize>, mut index: usize| {
        index += 1;
        while index < tree.len() {
            tree[index] += 1;
            index += index & index.wrapping_neg();
        }
    };
    let sum = |tree: &[usize], mut index: usize| -> usize {
        let mut total = 0;
        while index > 0 {
            total += tree[index];
            index -= index & index.wrapping_neg();
        }
        total
    };
    let mut crossings = 0;
    for (seen, &(_, lower)) in segments.iter().enumerate() {
        // Everything already placed with a lower endpoint greater than this
        // one crosses it.
        crossings += seen - sum(&tree, lower + 1);
        add(&mut tree, lower);
    }
    crossings
}

/// Bend penalty for `bends` bends: 0, 0, 5, 12, 30, then doubling.
fn bend_cost(bends: i64) -> i64 {
    if bends < 0 {
        return 0;
    }
    let index = bends as usize;
    if index < BEND_PENALTY.len() {
        return BEND_PENALTY[index];
    }
    let mut cost = *BEND_PENALTY.last().expect("non-empty");
    for _ in BEND_PENALTY.len()..=index {
        cost *= 2;
    }
    cost
}

/// A total order over floats that never panics on a NaN.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Ordered(f64);

impl Eq for Ordered {}

impl PartialOrd for Ordered {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Ordered {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0
            .partial_cmp(&other.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    }
}

/// The pinned rank of `node`, when it declares one.
fn pin_of(pins: &[Option<usize>], node: usize) -> Option<usize> {
    pins.get(node).copied().flatten()
}

/// Reorders one rank by barycenter, keeping every group block whole and the
/// group blocks in one stable order.
///
/// The block order comes from the caller's rank order, which is itself the
/// order the blocks appear in every other rank, so sibling groups never swap
/// places: a group reads as the same block wherever it appears.
fn reorder(
    layer: &[usize],
    neighbour_layer: &[usize],
    use_up: bool,
    slot_group: &[Option<usize>],
    block_order: &[usize],
    up: &[Vec<usize>],
    down: &[Vec<usize>],
) -> Vec<usize> {
    let position: HashMap<usize, usize> = neighbour_layer
        .iter()
        .enumerate()
        .map(|(index, &id)| (id, index))
        .collect();
    let barycenter = |slot: usize| -> Option<f64> {
        let neighbours = if use_up { &up[slot] } else { &down[slot] };
        let mut total = 0.0;
        let mut count = 0;
        for other in neighbours {
            if let Some(&place) = position.get(other) {
                total += place as f64;
                count += 1;
            }
        }
        (count > 0).then(|| total / count as f64)
    };
    let order_of = |slot: usize| layer.iter().position(|&id| id == slot).unwrap_or(0);

    // Members by group; singles carry their own barycenter score.
    let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut singles: Vec<(Ordered, usize, usize)> = Vec::new();
    for &slot in layer {
        match slot_group.get(slot).copied().flatten() {
            Some(group) => {
                members.entry(group).or_default().push(slot);
            }
            None => {
                let score = barycenter(slot).unwrap_or(order_of(slot) as f64);
                singles.push((Ordered(score), order_of(slot), slot));
            }
        }
    }
    // Each block keeps only an ANCHOR (its mean barycenter) from this
    // pass. The block SEQUENCE always comes from the caller's global
    // `block_order`, so sibling groups keep one stable left-to-right
    // order in every rank and their blocks can never swap sides.
    let mut anchors: HashMap<usize, Ordered> = HashMap::new();
    for (group, list) in members.iter() {
        let mut total = 0.0;
        for &slot in list {
            total += barycenter(slot).unwrap_or(f64::MAX / 4.0);
        }
        anchors.insert(*group, Ordered(total / list.len() as f64));
    }
    singles.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let present: Vec<usize> = block_order
        .iter()
        .copied()
        .filter(|group| members.contains_key(group))
        .collect();

    // Singles settle into the gap their barycenter points at, counted
    // against the ENFORCED block sequence's anchors; the blocks
    // themselves keep the global `block_order`.
    let mut gaps: Vec<Vec<usize>> = vec![Vec::new(); present.len() + 1];
    for (_, _, slot) in singles {
        let score = barycenter(slot).unwrap_or(f64::MAX / 4.0);
        let mut gap = 0;
        for (index, group) in present.iter().enumerate() {
            let anchor = anchors
                .get(group)
                .copied()
                .unwrap_or(Ordered(f64::MAX / 4.0));
            if anchor.0 < score {
                gap = index + 1;
            }
        }
        gaps[gap.min(present.len())].push(slot);
    }
    let mut out: Vec<usize> = Vec::with_capacity(layer.len());
    for (gap, singles_here) in gaps.iter().enumerate() {
        out.extend(singles_here.iter().copied());
        if let Some(&group) = present.get(gap) {
            let mut list = members.get(&group).cloned().unwrap_or_default();
            list.sort_by(|a, b| {
                match (barycenter(*a), barycenter(*b)) {
                    (Some(x), Some(y)) => Ordered(x).cmp(&Ordered(y)),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                }
                .then(a.cmp(b))
            });
            out.extend(list);
        }
    }
    // Nothing is ever dropped: a slot the pass did not place keeps its rank.
    for &slot in layer {
        if !out.contains(&slot) {
            out.push(slot);
        }
    }
    out
}

/// The `(from, to)` node indexes of one edge.
fn edge_ends(nodes: &[LayoutNode], edge: &LayoutEdge) -> Option<(usize, usize)> {
    let u = nodes.iter().position(|node| node.id == edge.from)?;
    let v = nodes.iter().position(|node| node.id == edge.to)?;
    Some((u, v))
}

/// How wide a rank gap must be to carry every parallel relation that crosses
/// it: two free rows for the ports plus one lane per overlapping across span.
///
/// An edge that only runs straight through a gap needs no lane. An edge that
/// moves sideways needs one row for that run, and two edges whose sideways
/// runs overlap on the across axis cannot share a row without one of them
/// bridging the other: the number of lanes is the deepest overlap of those
/// runs (interval-graph colouring), and an unused gap stays at
/// [`ALONG_GAP_MIN`].
fn gap_lanes(
    nodes: &[LayoutNode],
    edges: &[LayoutEdge],
    rank: &[usize],
    across: &[f64],
    slots: &[Slot],
    gap: usize,
) -> i32 {
    let far_end = |node: usize| (across[node], across[node] + slots[node].across);
    // One sideways run per edge: from the with-flow end it leaves to the one
    // it enters, on the across axis.
    let mut runs: Vec<(f64, f64)> = Vec::new();
    for edge in edges {
        let Some((u, v)) = edge_ends(nodes, edge) else {
            continue;
        };
        let (low, high) = (rank[u].min(rank[v]), rank[u].max(rank[v]));
        if gap < low || gap >= high {
            continue;
        }
        let ((u_lo, u_hi), (v_lo, v_hi)) = (far_end(u), far_end(v));
        let (lo, hi) = (u_lo.min(v_lo), u_hi.max(v_hi));
        if hi - lo >= 1.0 {
            runs.push((lo, hi));
        }
    }
    // Depth of the deepest overlap: a half-open span that ends where another
    // begins still needs its own row, because the far edge's lane cell there
    // is that edge's own port column.
    let mut deepest = 0usize;
    for &(lo, _) in &runs {
        let depth = runs
            .iter()
            .filter(|&&(other_lo, other_hi)| other_lo <= lo && lo < other_hi)
            .count();
        deepest = deepest.max(depth);
    }
    (2 + deepest as i32).max(ALONG_GAP_MIN)
}

/// Chooses the cell one edge label owns, or `None` when no clear cell exists.
#[allow(clippy::too_many_arguments)]
fn label_anchor(
    nodes: &[LayoutNode],
    slots: &[Slot],
    along: &[i32],
    rank_along: &[i32],
    across: &[f64],
    slot_rank: &[usize],
    positions: &BTreeMap<String, (f64, f64)>,
    label_slot: Option<usize>,
    ends: (usize, usize),
    width: i32,
    axis: Direction,
    along_gap: &dyn Fn(usize) -> i32,
    occupied: &[(i32, i32, i32)],
) -> Option<(i32, i32)> {
    let (u, v) = ends;
    let mut candidates: Vec<(i32, i32)> = Vec::new();
    if let Some(slot) = label_slot {
        // A long labelled edge owns its own rank: the label sits inside that
        // rank's band, centred on the slot the ordering reserved for it.
        let rank_index = slot_rank[slot];
        let start = across[slot];
        let centre_across = start + slots[slot].across / 2.0;
        let centre_along = along[rank_index] as f64 + rank_along[rank_index] as f64 / 2.0;
        let (x, y) = match axis {
            Direction::TopToBottom => (centre_across.round() as i32, centre_along.round() as i32),
            Direction::LeftToRight => (centre_along.round() as i32, centre_across.round() as i32),
        };
        candidates.push((x, y));
    }
    // The short span: the label lives in the channel between the two ranks,
    // beside the edge's own run.
    let (rank_u, rank_v) = (slot_rank[u], slot_rank[v]);
    let (low, high) = (rank_u.min(rank_v), rank_u.max(rank_v));
    if high > low {
        let gap = along_gap(low);
        let gap_start = along[low] + rank_along[low];
        for row in 0..(gap - 1).max(1) {
            let along_cell = gap_start + row;
            let source = positions.get(&nodes[u].id).copied().unwrap_or((0.0, 0.0));
            match axis {
                Direction::TopToBottom => {
                    // The text starts two cells right of the vertical run.
                    let run = source.0.round() as i32 + nodes[u].w.round() as i32 / 2;
                    candidates.push((run + 2 + width / 2, along_cell));
                    candidates.push((run - 2 - width / 2, along_cell));
                }
                Direction::LeftToRight => {
                    let centre = along_cell;
                    let run = source.1.round() as i32 + nodes[u].h.round() as i32 / 2;
                    candidates.push((centre, run - 1 - row));
                    candidates.push((centre, run + 1 + row));
                }
            }
        }
    }
    candidates.into_iter().find(|&(cx, cy)| {
        let lo = cx - width / 2;
        if lo < 0 || cy < 0 {
            return false;
        }
        // Off every node box and every other label.
        if node_rects(nodes, positions).iter().any(|&(x, y, w, h)| {
            (lo..lo + width).any(|cell| cell >= x && cell < x + w) && cy >= y && cy < y + h
        }) {
            return false;
        }
        !occupied
            .iter()
            .any(|&(ox, oy, ow)| oy == cy && lo < ox + ow && ox < lo + width)
    })
}

/// `(x, y, w, h)` of every placed node box.
fn node_rects(
    nodes: &[LayoutNode],
    positions: &BTreeMap<String, (f64, f64)>,
) -> Vec<(i32, i32, i32, i32)> {
    nodes
        .iter()
        .filter_map(|node| {
            let &(x, y) = positions.get(&node.id)?;
            Some((x as i32, y as i32, node.w as i32, node.h as i32))
        })
        .collect()
}

fn overlaps(x: i32, y: i32, w: i32, h: i32, rect: (i32, i32, i32, i32)) -> bool {
    let (rx, ry, rw, rh) = rect;
    x < rx + rw && rx < x + w && y < ry + rh && ry < y + h
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, w: f64, h: f64) -> LayoutNode {
        LayoutNode {
            id: id.into(),
            w,
            h,
            group: None,
        }
    }

    fn edge(from: &str, to: &str) -> LayoutEdge {
        LayoutEdge {
            from: from.into(),
            to: to.into(),
            label_width: None,
            label_gutter: false,
            minlen: 1,
        }
    }

    #[test]
    fn a_chain_gets_one_rank_per_node() {
        let nodes = vec![
            node("a", 5.0, 3.0),
            node("b", 5.0, 3.0),
            node("c", 5.0, 3.0),
        ];
        let edges = vec![edge("a", "b"), edge("b", "c")];
        let placed = layout(&nodes, &edges, Direction::TopToBottom);
        assert_eq!(placed.ranks.len(), 3);
        assert_eq!(placed.ranks[0], vec!["a".to_string()]);
        assert_eq!(placed.ranks[2], vec!["c".to_string()]);
        let a = placed.positions["a"];
        let c = placed.positions["c"];
        assert!(c.1 > a.1, "ranks advance downward");
        assert_eq!(placed.crossings_after, 0);
    }

    #[test]
    fn a_back_edge_is_reversed_for_ranking_only() {
        let nodes = vec![node("a", 5.0, 3.0), node("b", 5.0, 3.0)];
        let edges = vec![edge("a", "b"), edge("b", "a")];
        let placed = layout(&nodes, &edges, Direction::TopToBottom);
        assert_ne!(
            placed.positions["a"].1, placed.positions["b"].1,
            "the pair must not collapse onto one rank"
        );
        assert_eq!(placed.ranks.len(), 2);
    }

    #[test]
    fn barycenter_orders_a_braided_fan_better_than_declaration_order() {
        // A fan whose declaration order zig-zags: root -> a, d, b, c.
        let mut nodes = vec![node("root", 6.0, 3.0)];
        for id in ["a", "b", "c", "d"] {
            nodes.push(node(id, 4.0, 3.0));
        }
        let edges = vec![
            edge("root", "d"),
            edge("root", "a"),
            edge("root", "c"),
            edge("root", "b"),
        ];
        let mut placed = layout(&nodes, &edges, Direction::TopToBottom);
        assert_eq!(placed.crossings_before, 0, "a fan cannot braid by itself");
        assert_eq!(placed.crossings_after, 0);
        // A braid needs two ranks: middle -> out, declared out of order.
        let mut nodes = vec![node("root", 6.0, 3.0)];
        for id in ["m1", "m2", "m3", "out1", "out2", "out3"] {
            nodes.push(node(id, 4.0, 3.0));
        }
        let edges = vec![
            edge("root", "m1"),
            edge("root", "m2"),
            edge("root", "m3"),
            edge("m1", "out3"),
            edge("m2", "out2"),
            edge("m3", "out1"),
        ];
        placed = layout(&nodes, &edges, Direction::TopToBottom);
        assert_eq!(
            placed.crossings_before, 3,
            "the declaration order braids every pair"
        );
        assert_eq!(
            placed.crossings_after, 0,
            "the barycenter sweep must untangle the braid"
        );
    }

    #[test]
    fn a_long_edge_gets_a_dummy_slot_on_every_rank_it_crosses() {
        let nodes = vec![
            node("a", 5.0, 3.0),
            node("b", 5.0, 3.0),
            node("c", 5.0, 3.0),
            node("d", 5.0, 3.0),
        ];
        let edges = vec![
            edge("a", "b"),
            edge("b", "c"),
            edge("c", "d"),
            edge("a", "d"),
        ];
        let placed = layout(&nodes, &edges, Direction::TopToBottom);
        assert_eq!(placed.ranks.len(), 4);
        // Every rank still holds exactly one real node.
        for rank in &placed.ranks {
            assert_eq!(rank.len(), 1, "{rank:?}");
        }
        let a = placed.positions["a"];
        let d = placed.positions["d"];
        assert_eq!(
            a.0, d.0,
            "the long edge must run straight through its dummies"
        );
    }

    #[test]
    fn a_labelled_long_edge_owns_a_slot_and_reports_none_ambiguous() {
        let nodes = vec![
            node("a", 5.0, 3.0),
            node("b", 5.0, 3.0),
            node("c", 5.0, 3.0),
            node("d", 5.0, 3.0),
        ];
        let edges = vec![
            edge("a", "b"),
            edge("b", "c"),
            edge("c", "d"),
            LayoutEdge {
                label_width: Some(6),
                ..edge("a", "d")
            },
        ];
        let placed = layout(&nodes, &edges, Direction::LeftToRight);
        let anchor = placed.labels.get(&3).expect("the label owns a slot");
        assert!(anchor.0 > placed.positions["a"].0 as i32, "{anchor:?}");
        assert!(anchor.0 < placed.positions["d"].0 as i32, "{anchor:?}");
    }

    #[test]
    fn a_cycle_still_lays_out() {
        let nodes = vec![
            node("a", 5.0, 3.0),
            node("b", 5.0, 3.0),
            node("c", 5.0, 3.0),
        ];
        let edges = vec![edge("a", "b"), edge("b", "c"), edge("c", "a")];
        let placed = layout(&nodes, &edges, Direction::LeftToRight);
        assert_eq!(placed.positions.len(), 3);
        assert_eq!(placed.ranks.len(), 3);
    }

    #[test]
    fn the_palette_corner_stays_free_of_node_boxes() {
        let nodes = vec![node("a", 8.0, 3.0), node("b", 8.0, 3.0)];
        let edges = vec![edge("a", "b")];
        let placed = layout(&nodes, &edges, Direction::TopToBottom);
        let rects = node_rects(&nodes, &placed.positions);
        let palette = planted_palette(&placed);
        for rect in rects {
            assert!(
                !overlaps(rect.0, rect.1, rect.2, rect.3, palette),
                "{rect:?} collides with the palette"
            );
        }
    }

    /// The palette rectangle in graph coordinates.
    fn planted_palette(placed: &Placement) -> (i32, i32, i32, i32) {
        (
            0,
            (placed.extent.1 - PALETTE_H).max(0),
            PALETTE_W,
            PALETTE_H,
        )
    }

    #[test]
    fn bend_penalties_cost_more_than_crossings() {
        assert_eq!(bend_cost(0), 0);
        assert_eq!(bend_cost(1), 0);
        assert_eq!(bend_cost(2), 5);
        assert_eq!(bend_cost(3), 12);
        assert_eq!(bend_cost(4), 30);
        assert!(bend_cost(5) > bend_cost(4));
        assert!(bend_cost(9) > bend_cost(8));
    }

    #[test]
    fn the_accumulator_tree_counts_inversions() {
        // Segments sorted by their upper end; the lower ends 2,1,0 invert
        // three times.
        let segments = vec![(0, 2), (1, 1), (2, 0)];
        assert_eq!(accumulator_crossings(&segments, 3), 3);
        let parallel = vec![(0, 0), (1, 1), (2, 2)];
        assert_eq!(accumulator_crossings(&parallel, 3), 0);
    }
}
