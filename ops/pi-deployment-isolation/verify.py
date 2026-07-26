#!/usr/bin/env python3
"""Verify the T02.V01 exclusive deployment ownership fixture."""

import argparse
import json
import sys
from pathlib import Path

GOAL = "T02.V01"
KINDS = {
    "pi_process",
    "file_boundary",
    "session",
    "credential",
    "integration",
    "transport_bridge",
    "lifecycle_resource",
}
VIOLATIONS = {"unowned", "multiply_owned", "shared", "peer_accessible"}
RULE = {
    "id": "exclusive_deployment_ownership",
    "owner_count": 1,
    "shared_application_state": False,
    "peer_application_state_access": False,
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
    require(type(kind) is str and kind in KINDS, f"{where}.kind is unknown: {kind!r}")
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


def verify(fixture):
    object_with_keys(fixture, {"goal", "rule", "assertions", "cases"}, "fixture")
    require(fixture["goal"] == GOAL, f"fixture.goal must be {GOAL}")

    object_with_keys(fixture["rule"], set(RULE), "fixture.rule")
    require(fixture["rule"] == RULE, "fixture.rule does not define exclusive deployment ownership")

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
    require(asserted_kinds == KINDS, "fixture assertions do not require every resource kind")
    require(asserted_violations == VIOLATIONS, "fixture assertions do not require every violation mode")

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    args = parser.parse_args()
    try:
        fixture = json.loads(args.fixture.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
        verify(fixture)
    except (FixtureError, OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"FAIL {GOAL}: {error}", file=sys.stderr)
        return 1
    print(f"PASS {GOAL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
