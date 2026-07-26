#!/usr/bin/env python3
"""Bounded real-PTY contract probe for vault-hunter-status watch."""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

binary, output_path = sys.argv[1:]
started = time.monotonic()
pid, master = pty.fork()
if pid == 0:
    os.execv(binary, [binary, "watch", "run-observe", "--interval=50ms"])

fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
data = bytearray()
interrupted = False
status = None
try:
    deadline = started + 5.0
    while time.monotonic() < deadline:
        readable, _, _ = select.select([master], [], [], 0.05)
        if readable:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                chunk = b""
            if chunk:
                data.extend(chunk)
        if not interrupted and b"\x1b[?25l" in data and data.count(b"run-observe") >= 2:
            os.kill(pid, signal.SIGINT)
            interrupted = True
        waited, candidate = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = candidate
            break
    if status is None:
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
        raise AssertionError("watch did not stop within five seconds")
finally:
    os.close(master)
    with open(output_path, "wb") as handle:
        handle.write(data)

elapsed = time.monotonic() - started
assert interrupted, data[-1000:]
assert elapsed < 5.0, elapsed
assert data.count(b"run-observe") >= 2, data[-1000:]
assert b"SECOND-RUN-ONLY-SENTINEL" not in data, data[-1000:]
hide = data.find(b"\x1b[?25l")
show = data.rfind(b"\x1b[?25h")
assert hide >= 0 and show > hide, (hide, show, data[-1000:])
assert os.WIFEXITED(status) or os.WIFSIGNALED(status), status
print("watch PTY bounded; cursor hide/show restored; refreshes >= 2")
