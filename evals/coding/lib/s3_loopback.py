"""Minimal S3-ish loopback server for rack-bench behaviour checks.

Counts TCP accepts (so a check can prove connection reuse), records every
request line and header, and answers the handful of operations the client
issues: PutObject, GetObject, DeleteObject, and the multipart calls.

Only the public surfaces named in rack-bench's own docs are involved:
`rack_bench.bench.internet.s3client.S3Client` and its endpoint seam.
"""
from __future__ import annotations

import http.server
import sys
import threading


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.accepts = 0
        self.requests: list[dict] = []

    def get_request(self):
        sock, addr = super().get_request()
        self.accepts += 1
        return sock, addr


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep check output readable
        pass

    def _record(self) -> int:
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b""
        self.server.requests.append(
            {
                "method": self.command,
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body_length": len(body),
            }
        )
        return length

    def _reply(self, status: int, headers: dict[str, str] | None = None, body: bytes = b"") -> None:
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_PUT(self):
        self._record()
        crc = self.headers.get("x-amz-checksum-crc32", "")
        self._reply(200, {"etag": '"loopback-etag"', "x-amz-checksum-crc32": crc})

    def do_POST(self):
        self._record()
        if "uploads" in self.path:
            body = b'<?xml version="1.0"?><InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>'
            self._reply(200, {"content-type": "application/xml"}, body)
        else:
            self._reply(200, {"etag": '"done"'}, b"")

    def do_GET(self):
        self._record()
        self._reply(200, {"etag": '"loopback-etag"'})

    def do_HEAD(self):
        self._record()
        self._reply(200, {"etag": '"loopback-etag"'})

    def do_DELETE(self):
        self._record()
        self._reply(204)


class Loopback:
    """Context manager: `with Loopback() as loop: ...`"""

    def __enter__(self):
        self.server = _Server(("127.0.0.1", 0), _Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
        return False

    @property
    def port(self) -> int:
        return self.server.server_address[1]

    @property
    def accepts(self) -> int:
        return self.server.accepts

    @property
    def requests(self) -> list[dict]:
        return self.server.requests


def client_for(loop: Loopback):
    """An S3Client pointed at the loopback port, with dummy credentials."""
    import os

    os.environ.setdefault("AWS_ACCESS_KEY_ID", "loopback-key")
    # The check runs from the repo root; make the package importable there.
    if os.getcwd() not in sys.path:
        sys.path.insert(0, os.getcwd())
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "loopback-secret")
    from rack_bench.bench.internet import s3client as s3

    endpoint = s3.Endpoint("127.0.0.1", "us-east-1", True, port=loop.port, tls=False)
    return s3.S3Client("bench-bucket", "us-east-1", provider="s3", endpoint=endpoint), s3
