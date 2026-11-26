"""The recorded sample must prove one row per app activation, workspace switch and rex block change."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

SAMPLES = Path(__file__).resolve().parents[1] / "samples"
COLUMNS = {"ts", "mono", "kind", "app", "bundle", "ws", "idle_s", "source", "detail"}


def sample_dirs() -> list[Path]:
    return sorted(path for path in SAMPLES.glob("*") if (path / "events").is_dir())


def test_a_recorded_sample_is_committed():
    assert sample_dirs(), "no recorded sample under tasktrace/samples"


def test_sample_has_one_row_per_activation_switch_and_block_change():
    for directory in sample_dirs():
        rows = []
        for path in sorted((directory / "events").glob("*.jsonl")):
            rows.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
        kinds = {row["kind"] for row in rows}
        assert {"app", "ws", "rex"} <= kinds, (directory, kinds)

        activations = [row for row in rows if row["kind"] == "app" and row["source"] == "nsworkspace"]
        assert len(activations) >= 2, directory  # at least two real app activations

        switches = [row for row in rows if row["kind"] == "ws"]
        assert len(switches) >= 2, directory
        assert all(row["ws"] for row in switches)
        assert all(row["detail"]["prev_ws"] for row in switches)

        blocks = [row for row in rows if row["kind"] == "rex"]
        assert blocks
        assert all(row["detail"]["rex_type"].startswith("block_") for row in blocks)
        assert {row["detail"]["rex_type"] for row in blocks} >= {"block_created", "block_closed"}


def test_every_sample_row_records_every_field():
    for directory in sample_dirs():
        for path in sorted((directory / "events").glob("*.jsonl")):
            for line in path.read_text().splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                assert set(row) == COLUMNS
                datetime.fromisoformat(row["ts"])
                assert row["mono"] > 0
                assert isinstance(row["detail"], dict)
                if row["kind"] == "app":
                    assert row["bundle"], row
                if row["kind"] == "ws":
                    assert row["ws"], row


def test_sqlite_dump_matches_the_jsonl():
    for directory in sample_dirs():
        tsv = (directory / "spans.tsv").read_text().splitlines()
        assert tsv[0].split("\t") == [
            "id",
            "ts",
            "mono",
            "kind",
            "app",
            "bundle",
            "ws",
            "idle_s",
            "source",
            "detail",
        ]
        dumped = tsv[1:]
        jsonl = [
            json.loads(line)
            for path in sorted((directory / "events").glob("*.jsonl"))
            for line in path.read_text().splitlines()
            if line.strip()
        ]
        assert len(dumped) == len(jsonl)
        for row, line in zip(jsonl, dumped):
            assert line.split("\t")[3] == row["kind"]


def test_the_rex_input_capture_is_raw_rex_output():
    for directory in sample_dirs():
        capture = directory / "input" / "rex-capture.jsonl"
        assert capture.is_file(), directory
        lines = [json.loads(line) for line in capture.read_text().splitlines() if line.strip()]
        assert lines
        assert {line["type"] for line in lines} == {"session_event"}


def test_the_sample_readme_says_what_is_real():
    for directory in sample_dirs():
        text = (directory / "README.md").read_text()
        assert "What is real" in text
        assert "NSWorkspace agent" in text
        assert "AeroSpace hook" in text
        assert "rex bridge" in text
