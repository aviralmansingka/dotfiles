#!/usr/bin/env python3
"""Verify declarative Pi deployment-isolation fixtures."""

import argparse
import json
import sys
from pathlib import Path

V01_GOAL = "T02.V01"
V01_KINDS = {
    "pi_process",
    "file_boundary",
    "session",
    "credential",
    "integration",
    "transport_bridge",
    "lifecycle_resource",
}
V01_VIOLATIONS = {"unowned", "multiply_owned", "shared", "peer_accessible"}
V01_RULE = {
    "id": "exclusive_deployment_ownership",
    "owner_count": 1,
    "shared_application_state": False,
    "peer_application_state_access": False,
}

V02_GOAL = "T02.V02"
V02_EDGE_MODES = {
    "peer_control": {"control"},
    "peer_awareness": {"discovery"},
    "runtime_dependency": {"provisioning", "routing", "monitoring"},
    "peer_failure_propagation": {"availability"},
}
V02_EDGE_KINDS = set(V02_EDGE_MODES)
V02_DEPENDENCY_MODES = set().union(*V02_EDGE_MODES.values())
V02_RULE = {
    "id": "peer_deployment_independence",
    "runtime_discovery_dependency": False,
    "runtime_provisioning_dependency": False,
    "runtime_routing_dependency": False,
    "runtime_monitoring_dependency": False,
    "peer_control": False,
    "peer_availability_dependency": False,
}

V03_GOAL = "T02.V03"
V03_ALLOWED_AUTHORITIES = {
    "host_vm_lifecycle",
    "host_vm_network",
    "host_vm_storage",
    "host_vm_device",
    "libvirt_vm_lifecycle",
    "libvirt_vm_network",
    "libvirt_vm_storage",
    "libvirt_vm_device",
    "stt_request_transcription",
    "stt_result_transcription",
    "shared_model_access",
    "shared_model_billing",
    "transient_provisioning",
}
V03_REJECTED_AUTHORITIES = {
    "normal_operation_pi_application_state_inspection",
    "retained_deployment_credentials",
    "pi_administration_path",
    "cross_deployment_control",
}
V03_AUTHORITIES = V03_ALLOWED_AUTHORITIES | V03_REJECTED_AUTHORITIES
V03_RULE = {
    "id": "shared_boundary_authority_confinement",
    "host_libvirt_vm_authority": True,
    "stt_transcription_authority": True,
    "shared_model_authority": True,
    "transient_provisioning_authority": True,
    "privileged_host_root_technical_access_is_violation": False,
    "normal_operation_pi_application_state_inspection": False,
    "retained_deployment_credentials": False,
    "pi_administration_paths": False,
    "cross_deployment_control": False,
}


class FixtureError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise FixtureError(message)


def object_with_keys(value, keys, where):
    require(type(value) is dict, f"{where} must be an object")
    actual = set(value)
    unknown = actual - keys
    missing = keys - actual
    require(not unknown, f"{where} has unknown fields: {', '.join(sorted(unknown))}")
    require(not missing, f"{where} is missing fields: {', '.join(sorted(missing))}")


def exact_object(value, expected, where, message):
    object_with_keys(value, set(expected), where)
    require(
        all(
            type(value[key]) is type(expected[key]) and value[key] == expected[key]
            for key in expected
        ),
        message,
    )


def string_list(value, where, allow_empty=True):
    require(type(value) is list, f"{where} must be an array")
    require(allow_empty or value, f"{where} must not be empty")
    require(
        all(type(item) is str and item for item in value),
        f"{where} must contain non-empty strings",
    )
    require(len(value) == len(set(value)), f"{where} must not contain duplicates")
    return value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate object field: {key}")
        result[key] = value
    return result


def resource_violations(resource, where):
    object_with_keys(
        resource,
        {"id", "kind", "owners", "shared", "peer_application_state_access"},
        where,
    )
    require(type(resource["id"]) is str and resource["id"], f"{where}.id must be a non-empty string")
    kind = resource["kind"]
    require(type(kind) is str and kind in V01_KINDS, f"{where}.kind is unknown: {kind!r}")
    owners = string_list(resource["owners"], f"{where}.owners")
    require(type(resource["shared"]) is bool, f"{where}.shared must be a boolean")
    require(
        type(resource["peer_application_state_access"]) is bool,
        f"{where}.peer_application_state_access must be a boolean",
    )

    violations = set()
    if not owners:
        violations.add("unowned")
    elif len(owners) > 1:
        violations.add("multiply_owned")
    if resource["shared"]:
        violations.add("shared")
    if resource["peer_application_state_access"]:
        violations.add("peer_accessible")
    return violations


def verify_v01(fixture):
    object_with_keys(fixture, {"goal", "rule", "assertions", "cases"}, "fixture")
    require(fixture["goal"] == V01_GOAL, f"fixture.goal must be {V01_GOAL}")

    exact_object(
        fixture["rule"],
        V01_RULE,
        "fixture.rule",
        "fixture.rule does not define exclusive deployment ownership",
    )

    assertions = fixture["assertions"]
    object_with_keys(
        assertions,
        {"conforming_resource_kinds", "rejected_violations"},
        "fixture.assertions",
    )
    asserted_kinds = set(string_list(
        assertions["conforming_resource_kinds"],
        "fixture.assertions.conforming_resource_kinds",
        allow_empty=False,
    ))
    asserted_violations = set(string_list(
        assertions["rejected_violations"],
        "fixture.assertions.rejected_violations",
        allow_empty=False,
    ))
    require(asserted_kinds == V01_KINDS, "fixture assertions do not require every resource kind")
    require(asserted_violations == V01_VIOLATIONS, "fixture assertions do not require every violation mode")

    cases = fixture["cases"]
    require(type(cases) is list and cases, "fixture.cases must be a non-empty array")
    case_ids = set()
    conforming_kinds = set()
    rejected_violations = set()
    verdicts = set()

    for case_index, case in enumerate(cases):
        where = f"fixture.cases[{case_index}]"
        object_with_keys(case, {"id", "expected", "resources"}, where)
        case_id = case["id"]
        require(type(case_id) is str and case_id, f"{where}.id must be a non-empty string")
        require(case_id not in case_ids, f"duplicate case id: {case_id}")
        case_ids.add(case_id)
        expected = case["expected"]
        require(type(expected) is str and expected in {"conforming", "violating"}, f"{where}.expected is unknown")
        require(type(case["resources"]) is list and case["resources"], f"{where}.resources must be a non-empty array")

        found = set()
        resource_ids = set()
        for resource_index, resource in enumerate(case["resources"]):
            resource_where = f"{where}.resources[{resource_index}]"
            found.update(resource_violations(resource, resource_where))
            resource_id = resource["id"]
            require(resource_id not in resource_ids, f"{where} has duplicate resource id: {resource_id}")
            resource_ids.add(resource_id)

        actual = "violating" if found else "conforming"
        require(
            case["expected"] == actual,
            f"{where} expected {case['expected']} but exclusive ownership is {actual}",
        )
        verdicts.add(actual)
        if actual == "conforming":
            conforming_kinds.update(resource["kind"] for resource in case["resources"])
        else:
            rejected_violations.update(found)

    require(verdicts == {"conforming", "violating"}, "fixture must contain conforming and violating cases")
    require(conforming_kinds >= asserted_kinds, "unmet assertion: conforming cases do not cover every resource kind")
    require(rejected_violations >= asserted_violations, "unmet assertion: violating cases do not reject every violation mode")


def peer_edge(edge, where):
    object_with_keys(edge, {"kind", "mode"}, where)
    kind = edge["kind"]
    mode = edge["mode"]
    require(type(kind) is str and kind in V02_EDGE_KINDS, f"{where}.kind is unknown: {kind!r}")
    require(type(mode) is str and mode in V02_DEPENDENCY_MODES, f"{where}.mode is unknown: {mode!r}")
    require(mode in V02_EDGE_MODES[kind], f"{where} has invalid kind/mode pairing: {kind}/{mode}")
    return kind, mode


def verify_v02(fixture):
    object_with_keys(fixture, {"goal", "rule", "assertions", "cases"}, "fixture")
    require(fixture["goal"] == V02_GOAL, f"fixture.goal must be {V02_GOAL}")

    exact_object(
        fixture["rule"],
        V02_RULE,
        "fixture.rule",
        "fixture.rule does not define peer-deployment independence",
    )

    assertions = fixture["assertions"]
    object_with_keys(
        assertions,
        {"independent_peer_states", "rejected_edge_kinds", "rejected_dependency_modes"},
        "fixture.assertions",
    )
    asserted_states = set(string_list(
        assertions["independent_peer_states"],
        "fixture.assertions.independent_peer_states",
        allow_empty=False,
    ))
    asserted_kinds = set(string_list(
        assertions["rejected_edge_kinds"],
        "fixture.assertions.rejected_edge_kinds",
        allow_empty=False,
    ))
    asserted_modes = set(string_list(
        assertions["rejected_dependency_modes"],
        "fixture.assertions.rejected_dependency_modes",
        allow_empty=False,
    ))
    require(asserted_states == {"absent"}, "fixture assertions must require operation with a peer absent")
    require(asserted_kinds == V02_EDGE_KINDS, "fixture assertions do not reject every peer edge kind")
    require(asserted_modes == V02_DEPENDENCY_MODES, "fixture assertions do not reject every dependency mode")

    cases = fixture["cases"]
    require(type(cases) is list and cases, "fixture.cases must be a non-empty array")
    case_ids = set()
    independent_states = set()
    rejected_kinds = set()
    rejected_modes = set()
    verdicts = set()

    for case_index, case in enumerate(cases):
        where = f"fixture.cases[{case_index}]"
        object_with_keys(
            case,
            {"id", "expected", "subject", "peer", "peer_state", "subject_operational", "peer_edges"},
            where,
        )
        case_id = case["id"]
        require(type(case_id) is str and case_id, f"{where}.id must be a non-empty string")
        require(case_id not in case_ids, f"duplicate case id: {case_id}")
        case_ids.add(case_id)
        expected = case["expected"]
        require(type(expected) is str and expected in {"conforming", "violating"}, f"{where}.expected is unknown")
        subject = case["subject"]
        peer = case["peer"]
        require(type(subject) is str and subject, f"{where}.subject must be a non-empty string")
        require(type(peer) is str and peer, f"{where}.peer must be a non-empty string")
        require(subject != peer, f"{where}.subject and peer must identify different deployments")
        peer_state = case["peer_state"]
        require(
            type(peer_state) is str and peer_state in {"absent", "available", "failed"},
            f"{where}.peer_state is unknown: {peer_state!r}",
        )
        require(type(case["subject_operational"]) is bool, f"{where}.subject_operational must be a boolean")
        edges = case["peer_edges"]
        require(type(edges) is list, f"{where}.peer_edges must be an array")

        found_kinds = set()
        found_modes = set()
        edge_pairs = set()
        for edge_index, edge in enumerate(edges):
            kind, mode = peer_edge(edge, f"{where}.peer_edges[{edge_index}]")
            require((kind, mode) not in edge_pairs, f"{where}.peer_edges must not contain duplicates")
            edge_pairs.add((kind, mode))
            found_kinds.add(kind)
            found_modes.add(mode)

        actual = "violating" if edges else "conforming"
        require(expected == actual, f"{where} expected {expected} but peer independence is {actual}")
        verdicts.add(actual)
        if actual == "conforming" and case["subject_operational"]:
            independent_states.add(peer_state)
        elif actual == "violating":
            rejected_kinds.update(found_kinds)
            rejected_modes.update(found_modes)

    require(verdicts == {"conforming", "violating"}, "fixture must contain conforming and violating cases")
    require(independent_states >= asserted_states, "unmet assertion: no operating deployment with its peer absent")
    require(rejected_kinds >= asserted_kinds, "unmet assertion: violating cases do not reject every peer edge kind")
    require(rejected_modes >= asserted_modes, "unmet assertion: violating cases do not reject every dependency mode")


def verify_v03(fixture):
    object_with_keys(fixture, {"goal", "rule", "assertions", "cases"}, "fixture")
    require(fixture["goal"] == V03_GOAL, f"fixture.goal must be {V03_GOAL}")

    exact_object(
        fixture["rule"],
        V03_RULE,
        "fixture.rule",
        "fixture.rule does not confine shared-boundary authority",
    )

    assertions = fixture["assertions"]
    object_with_keys(
        assertions,
        {
            "accepted_authorities",
            "rejected_authorities",
            "privileged_host_root_technical_access_accepted",
        },
        "fixture.assertions",
    )
    asserted_allowed = set(string_list(
        assertions["accepted_authorities"],
        "fixture.assertions.accepted_authorities",
        allow_empty=False,
    ))
    asserted_rejected = set(string_list(
        assertions["rejected_authorities"],
        "fixture.assertions.rejected_authorities",
        allow_empty=False,
    ))
    require(
        type(assertions["privileged_host_root_technical_access_accepted"]) is bool,
        "fixture.assertions.privileged_host_root_technical_access_accepted must be a boolean",
    )
    require(asserted_allowed == V03_ALLOWED_AUTHORITIES, "fixture assertions do not accept every confined authority")
    require(asserted_rejected == V03_REJECTED_AUTHORITIES, "fixture assertions do not reject every prohibited authority")
    require(
        assertions["privileged_host_root_technical_access_accepted"],
        "fixture assertions must accept privileged host-root technical access",
    )

    cases = fixture["cases"]
    require(type(cases) is list and cases, "fixture.cases must be a non-empty array")
    case_ids = set()
    accepted_authorities = set()
    rejected_authorities = set()
    accepted_root_access = False
    verdicts = set()

    for case_index, case in enumerate(cases):
        where = f"fixture.cases[{case_index}]"
        object_with_keys(
            case,
            {
                "id",
                "expected",
                "privileged_host_root_technical_access_available",
                "authorities",
            },
            where,
        )
        case_id = case["id"]
        require(type(case_id) is str and case_id, f"{where}.id must be a non-empty string")
        require(case_id not in case_ids, f"duplicate case id: {case_id}")
        case_ids.add(case_id)
        expected = case["expected"]
        require(type(expected) is str and expected in {"conforming", "violating"}, f"{where}.expected is unknown")
        require(
            type(case["privileged_host_root_technical_access_available"]) is bool,
            f"{where}.privileged_host_root_technical_access_available must be a boolean",
        )
        authorities = string_list(case["authorities"], f"{where}.authorities")
        unknown = set(authorities) - V03_AUTHORITIES
        require(not unknown, f"{where}.authorities contains unknown authority: {', '.join(sorted(unknown))}")

        found = set(authorities) & V03_REJECTED_AUTHORITIES
        actual = "violating" if found else "conforming"
        require(expected == actual, f"{where} expected {expected} but authority confinement is {actual}")
        verdicts.add(actual)
        if actual == "conforming":
            accepted_authorities.update(authorities)
            accepted_root_access |= case["privileged_host_root_technical_access_available"]
        else:
            rejected_authorities.update(found)

    require(verdicts == {"conforming", "violating"}, "fixture must contain conforming and violating cases")
    require(
        accepted_authorities >= asserted_allowed,
        "unmet assertion: conforming cases do not cover every confined authority",
    )
    require(
        rejected_authorities >= asserted_rejected,
        "unmet assertion: violating cases do not reject every prohibited authority",
    )
    require(
        accepted_root_access,
        "unmet assertion: no conforming case accepts privileged host-root technical access",
    )


VERIFIERS = {
    V01_GOAL: verify_v01,
    V02_GOAL: verify_v02,
    V03_GOAL: verify_v03,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    args = parser.parse_args()
    goal = "fixture"
    try:
        fixture = json.loads(args.fixture.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
        if type(fixture) is dict:
            fixture_goal = fixture.get("goal")
            require(type(fixture_goal) is str, "fixture.goal must be a string")
            if fixture_goal in VERIFIERS:
                goal = fixture_goal
        require(goal in VERIFIERS, "fixture.goal is unknown")
        VERIFIERS[goal](fixture)
    except (FixtureError, OSError, UnicodeError, json.JSONDecodeError, ValueError, RecursionError) as error:
        print(f"FAIL {goal}: {error}", file=sys.stderr)
        return 1
    print(f"PASS {goal}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
