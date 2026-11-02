//! Group hue assignment: collision-free inside one spec, deterministic across
//! runs, and stable across the views of one case.
//!
//! A group is a logical tag. It orders sibling blocks and picks a hue family
//! for its members' borders; it never draws a box, a border, or a title (that
//! contract lives in `tests/render.rs`).

use rataflow_view::{
    GROUP_FAMILIES, Spec, build_flow_with_report, group_families, group_family, group_family_color,
    group_family_hue,
};
use ratatui::style::Color;
use std::collections::BTreeSet;

/// The round-09 verdict collisions, as one spec: `compute` and `control` once
/// shared RGB 211;134;155, `fabric` and `app` 125;174;163, and
/// `orchestration`/`storage` 125;160;184.
const ADVERSARIAL_SPEC: &str = r#"{
  "direction": "tb",
  "nodes": [
    {"id":"c1","label":"a","group":"compute"},
    {"id":"c2","label":"b","group":"fabric"},
    {"id":"c3","label":"c","group":"control"},
    {"id":"c4","label":"d","group":"orchestration"},
    {"id":"app","label":"e","group":"app"},
    {"id":"st","label":"f","group":"storage"}
  ],
  "edges": [
    {"from":"c1","to":"c2"},
    {"from":"c3","to":"c4"},
    {"from":"app","to":"st"}
  ]
}"#;

/// The same six groups, declared in another order, with different nodes and
/// edges: two views of one case.
const SAME_GROUPS_OTHER_VIEW: &str = r#"{
  "direction": "lr",
  "nodes": [
    {"id":"s1","label":"a","group":"storage"},
    {"id":"s2","label":"b","group":"app"},
    {"id":"s3","label":"c","group":"orchestration"},
    {"id":"s4","label":"d","group":"control"},
    {"id":"s5","label":"e","group":"compute"},
    {"id":"s6","label":"f","group":"fabric"},
    {"id":"s7","label":"g","group":"compute"}
  ],
  "edges": [
    {"from":"s1","to":"s2"},
    {"from":"s3","to":"s4"},
    {"from":"s5","to":"s6"},
    {"from":"s6","to":"s7"}
  ]
}"#;

/// The mission's adversarial names, as declared in that spec.
const ADVERSARIAL_NAMES: [&str; 6] = [
    "compute",
    "fabric",
    "control",
    "orchestration",
    "app",
    "storage",
];

/// Renders one spec and returns `(node id, border color)` in spec order.
fn borders(spec_json: &str) -> Vec<(String, Color)> {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    let (flow, _) = build_flow_with_report(&spec).expect("flow should build");
    spec.nodes
        .iter()
        .map(|node| {
            let painted = flow.node(&node.id).expect("every declared node is drawn");
            let color = painted
                .content
                .border_style
                .expect("every node carries a border style")
                .fg
                .expect("the border carries a color");
            (node.id.clone(), color)
        })
        .collect()
}

/// The hue of an RGB color, in degrees.
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

/// The names a spec declares as groups, in declaration order.
fn declared_groups(spec_json: &str) -> Vec<String> {
    let spec = Spec::from_json(spec_json).expect("spec should parse");
    let mut names: Vec<String> = Vec::new();
    for node in &spec.nodes {
        let Some(group) = node.group.as_deref() else {
            continue;
        };
        if !names.iter().any(|name| name == group) {
            names.push(group.to_string());
        }
    }
    names
}

/// The round-09 collision set: its names collide in the name hash, and the
/// per-spec pass must still give every group its own family.
#[test]
fn adversarial_group_names_get_pairwise_distinct_families() {
    // The precondition, so this test fails loudly if the hash ever stops
    // colliding here and the set stops being adversarial.
    assert_eq!(
        group_family("compute"),
        group_family("fabric"),
        "compute and fabric should still collide in the name hash"
    );
    assert_eq!(
        group_family("control"),
        group_family("orchestration"),
        "control and orchestration should still collide in the name hash"
    );

    let families = group_families(declared_groups(ADVERSARIAL_SPEC));
    assert_eq!(families.len(), ADVERSARIAL_NAMES.len());
    let distinct: BTreeSet<usize> = families.values().copied().collect();
    assert_eq!(
        distinct.len(),
        ADVERSARIAL_NAMES.len(),
        "every declared group needs its own family, got {families:?}"
    );

    // And the painting agrees: six distinct border colors, all hue-separated.
    let colors = borders(ADVERSARIAL_SPEC);
    let distinct_colors: BTreeSet<(u8, u8, u8)> = colors
        .iter()
        .map(|(_, color)| match color {
            Color::Rgb(r, g, b) => (*r, *g, *b),
            other => panic!("group colors are RGB, got {other:?}"),
        })
        .collect();
    assert_eq!(
        distinct_colors.len(),
        colors.len(),
        "no two groups may share a border color: {colors:?}"
    );
    for (index, (id, color)) in colors.iter().enumerate() {
        for (other_id, other) in colors.iter().skip(index + 1) {
            assert!(
                hue_gap(hue(*color), hue(*other)) > 40.0,
                "{id} and {other_id} are {:.0} degrees apart, too close: {color:?} {other:?}",
                hue_gap(hue(*color), hue(*other))
            );
        }
    }
}

/// Same spec, same groups, same hues: run to run and view to view.
#[test]
fn group_hues_are_deterministic_across_runs() {
    for spec in [ADVERSARIAL_SPEC, SAME_GROUPS_OTHER_VIEW] {
        assert_eq!(
            borders(spec),
            borders(spec),
            "two renders of one spec must agree, cell for cell"
        );
        assert_eq!(
            group_families(declared_groups(spec)),
            group_families(declared_groups(spec)),
            "two assignment passes over one group set must agree"
        );
    }
}

/// Two views of one case, declaring the same groups in other orders and
/// shapes: each group keeps its family, so a reader who learned the colors in
/// one view reads the other without relearning them.
#[test]
fn a_group_keeps_its_family_across_the_views_of_one_case() {
    let first = group_families(declared_groups(ADVERSARIAL_SPEC));
    let second = group_families(declared_groups(SAME_GROUPS_OTHER_VIEW));
    assert_eq!(
        first, second,
        "the same group names must resolve to the same families in both views"
    );

    // The paint agrees: each group's first member carries the family's own
    // hue in both views.
    let family_hue = |spec_json: &str, group: &str| -> f64 {
        let spec = Spec::from_json(spec_json).expect("spec");
        let id = spec
            .nodes
            .iter()
            .find(|node| node.group.as_deref() == Some(group))
            .map(|node| node.id.clone())
            .expect("each group has a member");
        let color = borders(spec_json)
            .into_iter()
            .find(|(painted, _)| *painted == id)
            .map(|(_, color)| color)
            .expect("the member is painted");
        hue(color)
    };
    for group in ADVERSARIAL_NAMES {
        let family = first[group];
        assert!(
            hue_gap(
                family_hue(ADVERSARIAL_SPEC, group),
                group_family_hue(family)
            ) < 4.0,
            "{group} must paint its family's hue in the first view"
        );
        assert!(
            hue_gap(
                family_hue(SAME_GROUPS_OTHER_VIEW, group),
                group_family_hue(family)
            ) < 4.0,
            "{group} must paint its family's hue in the second view too"
        );
    }
}

/// The wheel is evenly spaced, so any two families of a spec are at least
/// this far apart: eight groups take all eight families.
#[test]
fn the_family_wheel_is_evenly_spaced() {
    let hues: Vec<f64> = (0..GROUP_FAMILIES).map(group_family_hue).collect();
    assert!(
        hues.len() >= 6,
        "the wheel must seat a dense spec, seats {}",
        hues.len()
    );
    for (index, hue) in hues.iter().enumerate() {
        for (offset, other) in hues.iter().enumerate().skip(index + 1) {
            let gap = hue_gap(*hue, *other);
            assert!(
                gap > 40.0,
                "families {index} and {offset} are only {gap:.1} degrees apart"
            );
        }
        assert!((0.0..360.0).contains(hue), "hue {hue} is on the wheel");
    }
    let step = 360.0 / GROUP_FAMILIES as f64;
    assert!(
        (hue_gap(hues[0], hues[1]) - step).abs() < 1e-9,
        "the wheel steps {step} degrees"
    );

    // Members share their family's hue and differ by shade.
    let shades: Vec<Color> = (0..4).map(|member| group_family_color(3, member)).collect();
    for (member, color) in shades.iter().enumerate() {
        assert!(
            hue_gap(hue(*color), group_family_hue(3)) < 4.0,
            "shade {member} left the family hue: {color:?}"
        );
    }
    for (index, color) in shades.iter().enumerate() {
        for other in shades.iter().skip(index + 1) {
            assert_ne!(color, other, "members of one group need distinct shades");
        }
    }
}

/// A spec with more groups than families stays deterministic: the eighth
/// family is reused at the far end of the wheel, never at a neighbour's hue.
#[test]
fn groups_past_the_wheel_capacity_stay_deterministic() {
    let names: Vec<String> = (0..GROUP_FAMILIES + 3)
        .map(|index| format!("g{index:02}"))
        .collect();
    let nodes: Vec<String> = names
        .iter()
        .enumerate()
        .map(|(index, name)| format!(r#"{{"id":"n{index}","label":"n{index}","group":"{name}"}}"#))
        .collect();
    let spec_json = format!(
        r#"{{"nodes":[{}],"edges":[{{"from":"n0","to":"n1"}},{{"from":"n1","to":"n2"}}]}}"#,
        nodes.join(",")
    );
    let spec = Spec::from_json(&spec_json).expect("spec");
    let declared: Vec<&str> = spec
        .nodes
        .iter()
        .filter_map(|node| node.group.as_deref())
        .collect();
    let resolved = {
        // Names arrive in an order the pass must not depend on.
        let mut reversed: Vec<&str> = declared.clone();
        reversed.reverse();
        let forward = group_families(declared);
        let backward = group_families(reversed);
        assert_eq!(
            forward, backward,
            "the assignment must depend on the name set, not its order"
        );
        forward
    };
    let distinct: BTreeSet<usize> = resolved.values().copied().collect();
    assert_eq!(
        distinct.len(),
        GROUP_FAMILIES,
        "every family is used before one repeats: {resolved:?}"
    );
    // Rendering twice agrees, so the repeated family is chosen the same way
    // every run.
    assert_eq!(borders(&spec_json), borders(&spec_json));
}

/// Prints one truecolor swatch per node border. A manual harness, not an
/// assertion: run it with `--ignored --nocapture` to eyeball, or to record,
/// the palette a set of group names resolves to.
#[test]
#[ignore]
fn ansi_dump_group_borders() {
    for (id, color) in borders(ADVERSARIAL_SPEC) {
        let Color::Rgb(r, g, b) = color else {
            panic!("group colors are RGB, got {color:?}");
        };
        println!(
            "{id:4} rgb {r:3};{g:3};{b:3}  \x1b[38;2;{r};{g};{b}m██████\x1b[0m \
             \x1b[38;2;{r};{g};{b}m╭────╮\x1b[0m"
        );
    }
}
