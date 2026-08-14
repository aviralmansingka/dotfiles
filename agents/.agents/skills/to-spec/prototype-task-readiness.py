#!/usr/bin/env python3
"""PROTOTYPE — compare three autonomous Task admission standards."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Proposal:
    name: str
    bounded_outcome: bool
    authority_clear: bool
    decisions_resolved: bool
    prototype_linked: bool
    dependencies_available: bool
    goals_ordered: bool
    verifiers_executable: bool
    baseline_red_defined: bool
    evidence_bound: bool
    pickup_rehearsed: bool
    daily_budget_available: bool


PROPOSALS = (
    Proposal("Small deterministic bug with reproduction", True, True, True, True, True, True, True, True, True, True, True),
    Proposal("T17 before wake transport is selected", True, True, False, True, False, True, True, True, True, False, True),
    Proposal("Explore a better onboarding flow", False, False, False, True, True, False, False, False, False, False, True),
    Proposal("Mechanical rename without a prototype", True, True, True, False, True, True, True, True, True, True, True),
    Proposal("Proved feature waiting for tomorrow's budget", True, True, True, True, True, True, True, True, True, True, False),
)

FIELDS = {
    "bounded_outcome": "one bounded outcome",
    "authority_clear": "owner and write authority are explicit",
    "decisions_resolved": "no product or architecture decision remains",
    "prototype_linked": "a prior prototype or reproduction settled the risky question",
    "dependencies_available": "required dependencies are available",
    "goals_ordered": "execution goals and stop conditions are ordered",
    "verifiers_executable": "every success claim has an executable verifier",
    "baseline_red_defined": "each verifier has an expected pre-change failure",
    "evidence_bound": "evidence is bound to verifier and implementation identity",
    "pickup_rehearsed": "a fresh agent produced a no-question execution plan",
    "daily_budget_available": "today's Task Run has an allocated token budget",
}


def missing(proposal, names):
    return [FIELDS[name] for name in names if not getattr(proposal, name)]


def hard_contract(proposal):
    """A: transparent binary contract; implementation latitude is allowed."""
    required = (
        "bounded_outcome",
        "authority_clear",
        "decisions_resolved",
        "prototype_linked",
        "goals_ordered",
        "verifiers_executable",
        "baseline_red_defined",
        "evidence_bound",
    )
    gaps = missing(proposal, required)
    if gaps:
        return "ISSUE", gaps
    if not proposal.dependencies_available:
        return "BLOCKED TASK", [FIELDS["dependencies_available"]]
    return "READY TASK", []


def confidence_gate(proposal):
    """B: hard safety blockers plus a weighted autonomy score."""
    blockers = missing(proposal, ("bounded_outcome", "authority_clear", "decisions_resolved"))
    weighted = {
        "prototype_linked": 10,
        "goals_ordered": 15,
        "verifiers_executable": 25,
        "baseline_red_defined": 15,
        "evidence_bound": 15,
        "pickup_rehearsed": 10,
    }
    score = 10 + sum(weight for name, weight in weighted.items() if getattr(proposal, name))
    if blockers or score < 80:
        return f"ISSUE ({score}/100)", blockers or missing(proposal, weighted)
    if not proposal.dependencies_available:
        return f"BLOCKED TASK ({score}/100)", [FIELDS["dependencies_available"]]
    return f"READY TASK ({score}/100)", []


def proved_pickup(proposal):
    """C: the hard contract plus an independent no-question pickup rehearsal."""
    state, gaps = hard_contract(proposal)
    if state == "ISSUE":
        return state, gaps
    if not proposal.pickup_rehearsed:
        return "ISSUE", [FIELDS["pickup_rehearsed"]]
    return state, gaps


STANDARDS = (
    ("A — Hard Contract", hard_contract),
    ("B — Confidence Gate", confidence_gate),
    ("C — Proved Pickup", proved_pickup),
)


def show(proposal):
    print(f"\nPROPOSAL: {proposal.name}")
    for label, evaluate in STANDARDS:
        state, gaps = evaluate(proposal)
        print(f"\n{label}: {state}")
        print("  gaps: " + (", ".join(gaps) if gaps else "none"))
    print(
        "\nTODAY'S RUN: "
        + ("FUNDED" if proposal.daily_budget_available else "WAITING FOR TOKEN BUDGET")
    )
    print("\nFULL STATE")
    for name, description in FIELDS.items():
        print(f"  {'yes' if getattr(proposal, name) else 'no ':3}  {description}")


def main():
    print("PROTOTYPE — autonomous Task admission")
    while True:
        print("\nChoose a proposal:")
        for index, proposal in enumerate(PROPOSALS, 1):
            print(f"  {index}. {proposal.name}")
        choice = input("  q. quit\n> ").strip().lower()
        if choice == "q":
            return
        if choice.isdigit() and 1 <= int(choice) <= len(PROPOSALS):
            show(PROPOSALS[int(choice) - 1])


if __name__ == "__main__":
    main()
