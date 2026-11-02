"""Behaviour check for per-thread keep-alive pooling.

Counts TCP accepts at a loopback server: a pooled client must reuse one
connection for sequential requests on a thread, and open one per thread, not
one per request. No helper name is imported.
"""
import pathlib
import sys
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "lib"))
from s3_loopback import Loopback, client_for  # noqa: E402


def fail(message):
    print(f"CHECK FAIL: {message}")
    sys.exit(1)


with Loopback() as loop:
    client, s3 = client_for(loop)

    for index in range(3):
        client.put_object(f"obj/{index}", s3.SeededPayload("seed", 2048))
    sequential = loop.accepts
    if sequential != 1:
        fail(f"3 sequential requests opened {sequential} connections, expected 1 (no keep-alive reuse)")

    per_thread = []

    def worker(name):
        for index in range(2):
            client.put_object(f"obj/{name}/{index}", s3.SeededPayload("seed", 2048))
        per_thread.append(loop.accepts)

    threads = [threading.Thread(target=worker, args=(f"t{i}",)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    total = loop.accepts
    if total != 3:
        fail(f"3 connections expected after two more threads (1 shared + 1 per thread), saw {total}")

    client.close()
    client.put_object("obj/after-close", s3.SeededPayload("seed", 2048))
    if loop.accepts != 4:
        fail(f"a request after close() did not open a fresh connection (accepts={loop.accepts})")

print(f"CHECK PASS: 1 connection for 3 sequential requests, 1 per thread, fresh connection after close ({total} -> {loop.accepts})")
