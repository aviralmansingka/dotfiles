Two request-signing bugs in `rack_bench/bench/internet/s3client.py` break real S3/R2 traffic while the loopback tests stay green. Fix both.

## Bug 1 — two checksums on one PUT

`checksum_headers` sends `content-md5` together with `x-amz-checksum-crc32`. S3 and R2 reject that combination with `InvalidRequest` ("You can only specify one non-default checksum at a time"). Uploads must carry CRC32 only, and must keep both server-side verification and the returned-checksum comparison.

## Bug 2 — signed `content-length`

`content-length` is part of `SignedHeaders`, so GET and DELETE sign `content-length: 0`. R2 canonicalizes a zero-length body as an empty value, so every read and delete fails with `SignatureDoesNotMatch`. Send `content-length` but leave it unsigned, matching the aws cli / botocore behaviour.

## Constraints

- stdlib only.
- No other change to the signed request; signatures must stay byte-identical to botocore for the same request.
- Update the loopback tests so the fake server rejects a combined or absent-checksum PUT and asserts `content-md5` is never sent.

## Verification

- `.venv/bin/python -m unittest discover -s tests -q` — full suite green, ideally also under `-W error::ResourceWarning`.
- Report: files changed, what a signed PUT/GET now carries, test count before and after.
