#!/usr/bin/env python3
"""Turn an OpenSSH ed25519 private key into an age secret key, with no nix.

`ssh-to-age -private-key` does this in one line, but on a host where the store is
not writable by the login user (`error: creating directory '/nix/store/tmp-…':
Permission denied`) there is no way to *get* that binary: the profile only carries
it after a switch, and building or fetching it needs the store. This script is the
store-free path — Python 3 and the standard library, nothing else — so a host can
mint its own identity before any deploy has reached it.

    python3 scripts/ssh-to-age-key.py /etc/ssh/ssh_host_ed25519_key > host.age

`host.age` then holds one `AGE-SECRET-KEY-1…` line and `--public` prints the
recipient, so the operator can compare it with `.sops.yaml` before trusting the
file. The two transforms are the ones ssh-to-age applies (verified byte-for-byte
against ssh-to-age 1.3.0 on throwaway keys):

  * identity   bech32 of SHA-512 of the ed25519 seed, first 32 bytes, unclamped —
               X25519 clamps on use, and ssh-to-age does not clamp on disk;
  * recipient  bech32 of the Edwards→Montgomery map u = (1+y)/(1-y) mod 2^255-19.

The recipient is not bech32 of the SSH public key itself; encoding the public key
directly produces a plausible, wrong recipient that fails at decryption. The
check that settles it is `age-keygen -y <file>` printing the recipient `.sops.yaml`
carries.

Only unencrypted OpenSSH keys are supported (what `ssh-keygen` writes for a host
key, in its default PEM armour): cipher `none`, kdf `none`. A passphrase-protected
key is refused by name rather than half-parsed.

Exit codes: 0 wrote the key, 1 refused (not a key, encrypted, wrong type, bad
length), 2 usage.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import sys
from pathlib import Path

MAGIC = b"openssh-key-v1\0"
ARMOR_BEGIN = b"-----BEGIN OPENSSH PRIVATE KEY-----"
ARMOR_END = b"-----END OPENSSH PRIVATE KEY-----"

# BIP-173, which is what age uses for its keys (classic checksum, not bech32m).
BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
BECH32_GENERATOR = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]


def fail(message: str) -> None:
    print(f"ssh-to-age-key: {message}", file=sys.stderr, flush=True)
    raise SystemExit(1)


def polymod(values: list[int]) -> int:
    chk = 1
    for value in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ value
        for i, generator in enumerate(BECH32_GENERATOR):
            if (top >> i) & 1:
                chk ^= generator
    return chk


def hrp_expand(hrp: str) -> list[int]:
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def convert_bits(data: bytes, from_bits: int, to_bits: int, pad: bool) -> list[int]:
    acc = 0
    bits = 0
    out: list[int] = []
    maxv = (1 << to_bits) - 1
    for byte in data:
        if byte < 0 or (byte >> from_bits):
            fail("internal: value out of range")
        acc = (acc << from_bits) | byte
        bits += from_bits
        while bits >= to_bits:
            bits -= to_bits
            out.append((acc >> bits) & maxv)
    if pad and bits:
        out.append((acc << (to_bits - bits)) & maxv)
    return out


def bech32_encode(hrp: str, payload: bytes) -> str:
    """age's form: checksum over the lowercase hrp, output uppercased if the hrp is."""
    lower = hrp.lower()
    data = convert_bits(payload, 8, 5, True)
    values = hrp_expand(lower) + data
    checksum = polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    combined = data + [(checksum >> 5 * (5 - i)) & 31 for i in range(6)]
    encoded = lower + "1" + "".join(BECH32_CHARSET[d] for d in combined)
    return encoded.upper() if hrp != lower else encoded


class Reader:
    """The OpenSSH wire encoding: uint32 length, then that many bytes."""

    def __init__(self, data: bytes, offset: int) -> None:
        self.data = data
        self.offset = offset

    def uint32(self) -> int:
        if self.offset + 4 > len(self.data):
            fail("truncated key file")
        value = int.from_bytes(self.data[self.offset : self.offset + 4], "big")
        self.offset += 4
        return value

    def string(self) -> bytes:
        length = self.uint32()
        if self.offset + length > len(self.data):
            fail("truncated key file")
        value = self.data[self.offset : self.offset + length]
        self.offset += length
        return value


def unarmor(raw: bytes, path: Path) -> bytes:
    """ssh-keygen writes PEM armour by default; the openssh-key-v1 magic is inside."""
    if raw.startswith(MAGIC):
        return raw
    if not raw.startswith(ARMOR_BEGIN):
        fail(f"{path} is not an OpenSSH private key (no ARMOR or openssh-key-v1 header)")
    try:
        body = raw.split(ARMOR_BEGIN, 1)[1].split(ARMOR_END, 1)[0]
        return base64.b64decode(b"".join(body.split()), validate=True)
    except Exception as error:  # noqa: BLE001 - any decode failure is the same answer
        fail(f"{path} has an unreadable base64 body ({error})")
    return b""  # unreachable; fail() exits


def parse_ed25519_private_key(path: Path) -> tuple[bytes, bytes]:
    raw = unarmor(path.read_bytes(), path)
    if not raw.startswith(MAGIC):
        fail(f"{path} is not an OpenSSH private key (no openssh-key-v1 header)")
    reader = Reader(raw, len(MAGIC))
    cipher = reader.string()
    kdf = reader.string()
    reader.string()  # kdf options
    if cipher != b"none" or kdf != b"none":
        fail(f"{path} is passphrase-protected (cipher {cipher.decode()}, kdf {kdf.decode()})")
    if reader.uint32() != 1:
        fail(f"{path} holds more than one key")
    reader.string()  # the public half, repeated below
    private = Reader(reader.string(), 0)
    check1 = private.uint32()
    check2 = private.uint32()
    if check1 != check2:
        fail(f"{path} is corrupt (mismatched check integers)")
    if private.string() != b"ssh-ed25519":
        fail(f"{path} is not an ed25519 key")
    public = private.string()
    private_blob = private.string()
    if len(public) != 32:
        fail(f"{path} has a {len(public)}-byte public key, expected 32")
    if len(private_blob) != 64:
        fail(f"{path} has a {len(private_blob)}-byte private key, expected 64")
    seed, public_again = private_blob[:32], private_blob[32:]
    if public_again != public:
        fail(f"{path} is inconsistent (public halves differ)")
    return seed, public


def edwards_to_montgomery(public: bytes) -> bytes:
    """The map ssh-to-age applies to an ed25519 public key: u = (1+y)/(1-y)."""
    prime = 2**255 - 19
    y = int.from_bytes(public, "little") & ((1 << 255) - 1)
    u = (1 + y) * pow(1 - y, prime - 2, prime) % prime
    return u.to_bytes(32, "little")


def identity_from_seed(seed: bytes) -> bytes:
    """The age secret key ssh-to-age derives: SHA-512 of the seed, first 32 bytes."""
    return hashlib.sha512(seed).digest()[:32]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Convert an OpenSSH ed25519 private key to an age secret key.",
    )
    parser.add_argument("key", type=Path, help="the OpenSSH private key to read")
    parser.add_argument(
        "--public",
        action="store_true",
        help="print the age recipient instead of the secret key",
    )
    args = parser.parse_args(argv)

    seed, public = parse_ed25519_private_key(args.key)
    if args.public:
        print(bech32_encode("age", edwards_to_montgomery(public)))
    else:
        print(bech32_encode("AGE-SECRET-KEY-", identity_from_seed(seed)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
