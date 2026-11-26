"""Server and client: one JSON line in, one span row out."""

from __future__ import annotations

import json
import socket
import uuid
from pathlib import Path

import pytest

from tasktrace.client import Client, ClientError, send
from tasktrace.schema import build
from tasktrace.server import Collector


@pytest.fixture()
def collector(tmp_path):
    sock = Path(f"/tmp/tt-{uuid.uuid4().hex[:10]}.sock")
    running = Collector(tmp_path, sock).start()
    try:
        yield running
    finally:
        running.stop()
        running.store.close()


def test_one_line_one_row(collector):
    answer = send({"kind": "app", "app": "Ghostty", "ws": "A"}, collector.socket_path)
    assert answer == {"ok": True, "id": 1, "kind": "app"}
    rows = collector.store.rows()
    assert len(rows) == 1
    assert rows[0]["app"] == "Ghostty"
    assert rows[0]["ws"] == "A"
    assert rows[0]["source"] is None
    assert rows[0]["ts"].count(":") >= 2


def test_many_lines_on_one_connection(collector):
    with Client(collector.socket_path) as client:
        for kind in ("app", "ws", "rex"):
            assert client.send_line(build({"kind": kind}))["ok"] is True
    assert [row["kind"] for row in collector.store.rows()] == ["app", "ws", "rex"]


def test_several_lines_arrive_in_one_packet(collector):
    lines = (
        json.dumps({"kind": "app", "app": "one"})
        + "\n"
        + json.dumps({"kind": "app", "app": "two"})
        + "\n"
    )
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as raw:
        raw.settimeout(2)
        raw.connect(str(collector.socket_path))
        raw.sendall(lines.encode())
        received = b""
        while received.count(b"\n") < 2:
            received += raw.recv(4096)
    answers = [json.loads(line) for line in received.splitlines()]
    assert [answer["id"] for answer in answers] == [1, 2]
    assert collector.store.count() == 2


def test_bad_line_is_refused_without_killing_the_server(collector):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as raw:
        raw.settimeout(2)
        raw.connect(str(collector.socket_path))
        raw.sendall(b'{"kind": "nope"}\n{"kind": "ws", "ws": "B"}\n')
        received = b""
        while received.count(b"\n") < 2:
            received += raw.recv(4096)
    first, second = (json.loads(line) for line in received.splitlines())
    assert first["ok"] is False
    assert "unknown kind" in first["error"]
    assert second["ok"] is True
    assert collector.store.count() == 1


def test_connection_without_server_fails_cleanly(tmp_path):
    with pytest.raises(ClientError):
        send({"kind": "app"}, tmp_path / "missing.sock")


def test_stop_unlinks_the_socket(tmp_path):
    sock = Path(f"/tmp/tt-{uuid.uuid4().hex[:10]}.sock")
    running = Collector(tmp_path, sock).start()
    assert sock.exists()
    running.stop()
    assert not sock.exists()
    running.store.close()


def test_stale_socket_file_is_replaced(tmp_path):
    sock = Path(f"/tmp/tt-{uuid.uuid4().hex[:10]}.sock")
    stale = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    stale.bind(str(sock))
    stale.close()  # leaves the file behind, like a crashed collector

    running = Collector(tmp_path, sock).start()
    try:
        assert send({"kind": "boot"}, sock)["ok"] is True
    finally:
        running.stop()
        running.store.close()
