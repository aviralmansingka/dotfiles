"""Behaviour check for the checksum / signed-header fixes.

Drives the real client against a loopback S3 server and inspects what actually
goes on the wire: exactly one non-default checksum per upload, and a
content-length that is sent but never signed. No helper name is imported.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "lib"))
from s3_loopback import Loopback, client_for  # noqa: E402


def fail(message):
    print(f"CHECK FAIL: {message}")
    sys.exit(1)


with Loopback() as loop:
    client, s3 = client_for(loop)
    client.put_object("obj/key", s3.SeededPayload("seed", 1024))
    client.head_object("obj/key")
    client.delete_object("obj/key")

    uploads = [r for r in loop.requests if r["method"] == "PUT"]
    if not uploads:
        fail("the client sent no PUT to the loopback server")

    for request in loop.requests:
        headers = request["headers"]
        if "content-length" not in headers:
            fail(f"{request['method']} sent no content-length header")
        signed = headers.get("authorization", "").split("SignedHeaders=")[-1].split(",")[0]
        if "content-length" in signed:
            fail(f"{request['method']} still signs content-length (breaks R2 zero-length reads and deletes)")

    for request in uploads:
        headers = request["headers"]
        if "x-amz-checksum-crc32" not in headers:
            fail("PUT carries no x-amz-checksum-crc32")
        if "content-md5" in headers:
            fail("PUT sends content-md5 together with x-amz-checksum-crc32 (InvalidRequest on S3/R2)")

    checksums = [k for k in uploads[0]["headers"] if k.startswith("x-amz-checksum-") or k == "content-md5"]
    if len(checksums) != 1:
        fail(f"PUT carries {len(checksums)} checksum headers: {checksums}")

print(f"CHECK PASS: {len(loop.requests)} requests, CRC32-only uploads, content-length sent but unsigned")
