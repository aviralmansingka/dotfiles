"""Durable sinks: one sqlite row per span, plus a daily JSONL file."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

from .schema import Event

DEFAULT_HOME = Path(
    os.environ.get("TASKTRACE_HOME") or (Path.home() / ".local" / "state" / "tasktrace")
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS spans (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT    NOT NULL,
    mono    REAL    NOT NULL,
    kind    TEXT    NOT NULL,
    app     TEXT,
    bundle  TEXT,
    ws      TEXT,
    idle_s  REAL,
    source  TEXT,
    detail  TEXT
);
CREATE INDEX IF NOT EXISTS spans_ts ON spans(ts);
CREATE INDEX IF NOT EXISTS spans_kind ON spans(kind);
"""

COLUMNS = ("id", "ts", "mono", "kind", "app", "bundle", "ws", "idle_s", "source", "detail")


class Store:
    """Thread-safe sqlite + daily JSONL sink."""

    def __init__(self, home: Path | str = DEFAULT_HOME) -> None:
        self.home = Path(home)
        self.events_dir = self.home / "events"
        self.events_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.home / "spans.sqlite3"
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def append(self, event: Event) -> int:
        row = event.row()
        day = row["ts"][:10]
        payload = json.dumps(row, separators=(",", ":"), ensure_ascii=False)
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO spans (ts, mono, kind, app, bundle, ws, idle_s, source, detail)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row["ts"],
                    row["mono"],
                    row["kind"],
                    row["app"],
                    row["bundle"],
                    row["ws"],
                    row["idle_s"],
                    row["source"],
                    json.dumps(row["detail"], separators=(",", ":"), ensure_ascii=False),
                ),
            )
            self._conn.commit()
            span_id = int(cur.lastrowid or 0)
            with open(self.events_dir / f"{day}.jsonl", "a", encoding="utf-8") as handle:
                handle.write(payload + "\n")
                handle.flush()
        return span_id

    def rows(self, limit: int | None = None, kind: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM spans"
        params: list[Any] = []
        if kind:
            sql += " WHERE kind = ?"
            params.append(kind)
        sql += " ORDER BY id"
        if limit is not None:
            sql += " LIMIT ?"
            params.append(int(limit))
        with self._lock:
            found = self._conn.execute(sql, params).fetchall()
        rows = []
        for found_row in found:
            item = dict(found_row)
            item["detail"] = json.loads(item["detail"] or "{}")
            rows.append(item)
        return rows

    def count(self, kind: str | None = None) -> int:
        sql = "SELECT COUNT(*) AS n FROM spans"
        params: list[Any] = []
        if kind:
            sql += " WHERE kind = ?"
            params.append(kind)
        with self._lock:
            return int(self._conn.execute(sql, params).fetchone()["n"])

    def jsonl_files(self) -> list[Path]:
        return sorted(self.events_dir.glob("*.jsonl"))

    def jsonl_rows(self) -> Iterable[dict[str, Any]]:
        for path in self.jsonl_files():
            with open(path, encoding="utf-8") as handle:
                for line in handle:
                    if line.strip():
                        yield json.loads(line)

    def close(self) -> None:
        with self._lock:
            self._conn.close()
