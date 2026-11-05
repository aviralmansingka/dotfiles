# Fleet secrets — runbook

Four operations on the sops-managed fleet secrets, each with the commands, the
expected output, and the proof that it worked. Read the architecture section
first: the runbooks assume it.

The design is recorded in the mission artifacts. This file is the operator's
copy: what is true now, and what to type.

## The architecture, as it is

| Piece | Where it is |
| --- | --- |
| Ciphertext | `secrets/homelab.yaml`, `secrets/probe.yaml` — tracked, one sops file per host |
| Recipients | `.sops.yaml`, one `creation_rules` entry per file, `path_regex` anchored at the file name |
| admin identity | this Mac, `~/.config/sops/age/keys.txt`, 189 bytes, mode 0400, recipient `age1pnuqwh5esr7cfz6q7re5xf8rjch47twtrmfpgxtgsgclf9h50edshlf3hg` |
| lab identity | the homelab, `~/.config/sops/age/keys.txt`, 189 bytes, mode 0400, `avirus:avirus`, recipient `age12yxjvnql2ecdrsd9jz465zhs3n6expd79jzksjf2ntjhxmsry90qmv85my` |
| probe identity | minted by cloud-init on first boot (`ops/terraform/probe.tf`), `~/.config/sops/age/keys.txt`, 0600, owner `ubuntu`; its recipient is not in `.sops.yaml` yet |
| Consumer secrets | `pi-stt-worker.env` (229 B), `pi-telegram.env` (1448 B), `pi-whatsapp.env` (390 B) — keys of `secrets/homelab.yaml`, declared in `nix/modules/remote/homelab.nix` with `mode = "0400"` |
| Guard | `just secrets-check` — offline, key-free, no sops binary |
| CI guard | `scripts/test-sops-secrets.py` (see `docs/ci-tests/sops-secrets.md`) |

The admin recipient is on every rule. It is the only identity that can read
the whole fleet from a machine that is not a member, so losing it loses the
fleet. Its 1Password backup is **still outstanding** (see open items).

### How a host reads its secrets

sops-nix's Home Manager module installs one user oneshot, `sops-nix.service`.
It runs `sops-install-secrets` as the login user, writes each declared secret
into `$XDG_RUNTIME_DIR/secrets.d/<generation>/<name>` with the declared mode,
and `~/.config/sops-nix/secrets/<name>` is a symlink into it. The three
migrated units carry `After=` and `Wants=` on `sops-nix.service`, so they never
race the decryption at login, and a missing file is now a loud failure rather
than a silently empty environment.

`secrets.d` is tmpfs: it is gone at reboot and republished by the next
activation.

Two consequences the runbooks rely on:

- A host decrypts with the key file its profile names. The remote profile
  names `~/.config/sops/age/keys.txt` for every Linux host
  (`nix/modules/remote/default.nix`), the MacBook names the same path for the
  admin key (`nix/modules/macbook/home.nix`). The SSH host key is **not** fleet
  identity any more.
- **Editing a secrets file changes nothing on a host** until the next
  activation. The value reaches the host at `just deploy`, and the running
  process picks it up only at a `systemctl --user restart`.

### What not to type on this Mac

Lab commands and Mac commands look alike and are not. This block was written
for the homelab and ran on the Mac; it destroyed the admin identity:

```sh
rm -f ~/.config/sops/age/keys.txt
nix run nixpkgs#ssh-to-age -- -private-key -i ~/.tmp-hostkey > ~/hostkey.age   # 0 bytes on macOS
install -m 400 ~/hostkey.age ~/.config/sops/age/keys.txt.new
mv -f ~/.config/sops/age/keys.txt.new ~/.config/sops/age/keys.txt
```

macOS has no `/etc/ssh/ssh_host_ed25519_key`, so the conversion yields an empty
file, and an empty 0400 file satisfies every mode-and-owner check. The guard
that catches it is `age-keygen -y <file>`: it must print the recipient on the
rule. An empty file prints `no identities found`.

## Runbook 1 — add a host

A host joins when an identity on that host is a recipient of the file it
decrypts. The fleet mints identities per machine; host-key derivation is
retired (`.sops.yaml` says why).

**1. Mint the identity on the host.** This runs on the host, not here:

```sh
install -d -m 700 ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 400 ~/.config/sops/age/keys.txt
stat -c '%s bytes, %a, %U: %n' ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt
```

Expected: `189 bytes, 400, avirus: …` and one `age1…` recipient on stdout.
`age-generate` arrives with the host's first switch (`sops` and `ssh-to-age` are
in `home.packages`); on a box with no Nix yet, prefix the command with
`nix shell nixpkgs#age -c`. If the size is not 189 bytes, or `age-keygen -y`
prints `no identities found`, delete the file and mint again — do not install
an unproven key.

**2. Add the recipient to the right rule.** One rule per secrets file:

- the homelab: append the recipient to the `secrets/homelab.yaml` rule in
  `.sops.yaml`, keeping the admin recipient;
- the probe: `just secrets-probe-recipient` prints its recipient and
  `just secrets-probe-add` writes it into the rule, then re-wraps the file.
  `--dry-run` prints the plan and changes nothing;
- a new host that needs its own file: add a `creation_rules` entry whose
  `path_regex` is anchored at the file name, **and** the file itself, **and**
  the module that names it (`sops.defaultSopsFile`, plus `sops.secrets` with
  `mode = "0400"`). A rule with no file fails the guard, by design.

**3. Re-wrap the file for the new recipient set.** From the repo root, where a
recipient identity is available — this Mac, with the admin key:

```sh
cd ~/.herdr/worktrees/dotfiles/mission-sops-secrets
sops updatekeys -y secrets/homelab.yaml
just secrets-check
grep -o 'recipient: age1[a-z0-9]*' secrets/homelab.yaml | sort -u
```

`updatekeys` re-wraps the existing data key; no value is touched. Expected:
sops reports the file updated, `just secrets-check` prints
`ok secrets/homelab.yaml`, `ok secrets/probe.yaml` and the admin recipient
line, and the grep lists exactly the recipients the rule now carries — the new
one included. If the grep is missing it, the rule was edited and the file was
not re-wrapped; the guard fails with the same message.

`-y` is not cosmetic: without it sops asks `Is this okay? (y/n)` and a
non-interactive caller reads that as a failure.

**4. Deploy.**

```sh
just deploy remote <host>
```

Expected: `==> switch complete on <host>` and exit 0. A new host needs the
`secrets/` directory in the staged tree — it is, `secrets` is in the deploy
tree.

**5. Prove it on the host.** A `0400` secret is the acceptance item; sizes are
the three migrated env files.

```sh
ssh <host> 'systemctl --user show sops-nix -p Result -p ExecMainStatus'
ssh <host> 'for s in pi-stt-worker pi-telegram pi-whatsapp; do
  stat -c "%a %U %s %n" "$(readlink -f ~/.config/sops-nix/secrets/$s.env)"; done'
```

Expected: `Result=success`, `ExecMainStatus=0`; then three lines reading
`400 avirus 229 …`, `400 avirus 1448 …`, `400 avirus 390 …`. A host with no
declared secrets proves the identity instead, without printing a value:

```sh
ssh <host> 'cd ~/dotfiles && sops decrypt --extract "[\"pi-telegram.env\"]" secrets/homelab.yaml | wc -c'
```

Expected: `1448`. `no identity matched any of the recipients` means the
recipient and the key file disagree — step 1 was not the key that is on the
rule.

## Runbook 2 — rotate a value

**1. Edit through sops.** Never open the file with an editor directly — that is
how plaintext lands on disk and in git history.

```sh
cd ~/.herdr/worktrees/dotfiles/mission-sops-secrets
just secrets-edit secrets/homelab.yaml
```

This runs `sops secrets/homelab.yaml`, decrypts into `$EDITOR`, and re-encrypts
on save; the file is ciphertext on disk the whole time. Needs `sops` on PATH
and a TTY; press nothing but the value edit, because a merge conflict in a
`sops:` block is unrecoverable.

A migrated key holds a whole env file as one value, so the edit replaces the
block of `KEY=value` lines. Keep every key the unit reads — a missing line
restarts the daemon with a gap.

**2. Verify the decrypt-back digest.** Do not trust the editor save; read the
value back and compare a digest, never the text:

```sh
sha256sum /path/to/new-value.env                       # the plaintext you pasted
sops decrypt --extract '["pi-telegram.env"]' secrets/homelab.yaml | sha256sum
sops decrypt --extract '["pi-telegram.env"]' secrets/homelab.yaml | wc -c
```

Expected: the two digests are identical, and `wc -c` prints the new byte count
against the 1448 the old value had. A digest mismatch means the editor saved
something else — reopen with `just secrets-edit` and fix it before committing.

**3. Commit, deploy, restart the consumer.** The change is inert until both
halves run:

```sh
git add secrets/homelab.yaml && git commit -m "sops: rotate <name>"
just deploy remote homelab
ssh homelab 'systemctl --user restart pi-telegram; sleep 5;
  systemctl --user is-active pi-telegram;
  stat -c "%a %U %s" "$(readlink -f ~/.config/sops-nix/secrets/pi-telegram.env)";
  journalctl --user -u pi-telegram --since "-2 min" --no-pager | tail -5'
```

Expected: `==> switch complete on homelab`; `restart` exit 0; `active`; the
`400 avirus <new size>` line; and a journal whose last lines include
`Started pi-telegram.service - Pi over Telegram daemon.` with no
`Failed to load environment file`.

`Restart=always` restarts the process, not its environment: a rotation without
the restart leaves the daemon running on the old value. The module sets no
`restartUnits`, so the restart is the operator's line.

**4. If the value must not sit in the data key any longer** — a suspected leak
of the old value rather than a routine change — use `sops rotate --in-place`
instead, which gives the file a fresh data key:

```sh
SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt just secrets-rotate secrets/homelab.yaml
just secrets-check
```

Expected: `ok secrets/homelab.yaml`, then the same deploy and restart as step 3.
Rotating needs a recipient identity on the machine that runs it; the admin key
is that identity here.

## Runbook 3 — rotate access

Replace a recipient, retire the old one, and prove no consumer broke. Work in
this order: the new recipient goes in before the old one comes out, so there is
never a moment when a file cannot be read.

**1. Find every rule that holds the recipient.**

```sh
grep -n 'age1' .sops.yaml
```

Expected: `age1pnuq…` on both rules (it is the admin key), `age12yxjv…` on the
homelab rule only. That listing is the scope: every file whose rule holds the
recipient must be re-wrapped.

**2. Get the replacement recipient** — see runbook 1 step 1. Verify it with
`age-keygen -y`.

**3. Replace it in `.sops.yaml`,** in every rule from step 1. Keep the admin
recipient on every rule: `just secrets-check` fails with
`no recipient is on every rule, so no single admin key can read the whole fleet`
if it is dropped.

**4. Re-wrap every affected file.**

```sh
sops updatekeys -y secrets/homelab.yaml
sops updatekeys -y secrets/probe.yaml      # only if its rule held the old key
just secrets-check
grep -o 'recipient: age1[a-z0-9]*' secrets/homelab.yaml | sort -u
```

Expected: `just secrets-check` is green, and the grep output is exactly the new
recipient set: no line for the retired key. A rule edited without `updatekeys`
still decrypts for the old key and fails the guard with
`rule recipients missing from the file (age1…)`.

**5. Prove the retired identity is out,** on a machine that still holds it:

```sh
sops decrypt secrets/homelab.yaml
```

Expected: a failure —
`Recovery failed because no master key was able to decrypt the file.` — and
nothing on stdout. If it decrypts, that file was not re-wrapped in step 4.

**6. Prove no consumer broke.** Deploy and check every consumer, because a
re-wrap that missed one file leaves that host unable to decrypt at activation:

```sh
just deploy remote homelab
ssh homelab 'systemctl --user show sops-nix -p Result -p ExecMainStatus;
  systemctl --user is-active pi-stt-worker pi-telegram pi-whatsapp;
  for s in pi-stt-worker pi-telegram pi-whatsapp; do
    stat -c "%a %U %s" "$(readlink -f ~/.config/sops-nix/secrets/$s.env)"; done'
```

Expected: `Result=success`, `ExecMainStatus=0`; three `active`; three
`400 avirus` lines with the sizes 229 / 1448 / 390. Any
`Failed to decrypt` or `no identity matched` line in the switch output means
the host's own recipient left the rule before its file was re-wrapped.

**7. Retire the key material last.** Delete the old key file on the host that
held it only after step 6 is green, and re-mint that host's identity through
runbook 1 if it still needs access.

## Runbook 4 — recover from a lost key

The S02 incident, as a procedure: the Mac identity was destroyed by a
lab-intended command block that ran on the wrong machine, and an empty 0400 key
file satisfied every check until a decrypt failed.

**1. Establish what is lost.** Do not re-run anything that writes the key path.

```sh
ls -l ~/.config/sops/age/keys.txt
stat -c '%s bytes' ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt
```

Expected on a lost key: a 0-byte file, and `age-keygen -y` printing
`no identities found`. A missing file prints `open …: no such file or
directory`. Both mean the same thing: mint a new identity.

**2. Mint the new admin key,** on this Mac only:

```sh
install -d -m 700 ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 400 ~/.config/sops/age/keys.txt
stat -c '%s bytes, %a' ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt
```

Expected: `189 bytes, 400` and one `age1…` recipient. That recipient is the new
admin key. Do not go on until both are true — the last incident installed an
empty file that passed a `stat` check.

**3. Put the new recipient on every rule** in `.sops.yaml`, in place of the
lost one. The lab's recipient (`age12yxjv…`) stays where it is.

**4. Re-wrap both files.** Neither can use the lost key, so the wrap has to
run where a surviving recipient identity lives.

*`secrets/homelab.yaml` — the lab's key still reads it,* so re-wrap on the
homelab:

```sh
ssh homelab 'cd ~/dotfiles && sops updatekeys -y secrets/homelab.yaml'
```

Expected: sops reports the file updated and the local
`grep -o 'recipient: age1[a-z0-9]*' secrets/homelab.yaml | sort -u` now lists
the new admin recipient and the lab's. Copy the file back to this checkout if
the lab ran it on its own copy — the two must be byte-identical, so
`sha256sum` both and compare.

If no recipient identity survives anywhere, the file's data key is gone and the
values are unrecoverable: rebuild it from the plaintext sources with
`sops encrypt --age <recipients>`, as S02 did from the lab's env files, then
confirm every consumer key is present.

*`secrets/probe.yaml` — nothing reads it,* because its rule carried only the
lost admin key. Rebuild the dummy value the record names:

```sh
umask 077
printf 'dummy: probe-rebuilt-after-admin-key-remint\n' > /tmp/probe.plain.yaml
sops encrypt --filename-override secrets/probe.yaml \
  --input-type yaml --output-type yaml /tmp/probe.plain.yaml > secrets/probe.yaml
shred -u /tmp/probe.plain.yaml 2>/dev/null || rm -f /tmp/probe.plain.yaml
```

`--filename-override` matters: `path_regex` matches the tracked path, not the
temporary file. When a probe instance exists, `just secrets-probe-add` gives it
a recipient and the next rebuild is a re-wrap instead.

**5. Verify, then back the new key up before anything uses it.**

```sh
just secrets-check
SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt sops decrypt secrets/probe.yaml
SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt \
  sops decrypt --extract '["pi-telegram.env"]' secrets/homelab.yaml | wc -c
```

Expected: `ok secrets/homelab.yaml`, `ok secrets/probe.yaml` and the new admin
recipient on the guard's last line; `dummy: probe-rebuilt-after-admin-key-remint`;
and `1448` for the lab's file. Then **copy the key file into 1Password**
before the next deploy, before the next secret, before anything else touches
it. One copy on one disk is exactly the state that cost the fleet the previous
identity, and no repository change can fix it.

**6. Deploy and prove the consumers** with runbook 3 step 6.

## Open items

Recorded here because they are the operator's, not the code's:

1. **Four plaintext env files are not migrated.** On the homelab,
   `pi-browserbase.env`, `pi-google-workspace.env`, `pi-slack-mcp.env` and
   `pi-stt-client.env` still sit under `~/.config` as plaintext. `just
   secrets-import NAME=PATH` moves one into `secrets/homelab.yaml` (one key per
   file, named after it, decrypt-back verified); the unit, its
   `EnvironmentFile` and its `sops.secrets` entry then follow. `secrets-import`
   prints the path, byte count and sha256 of a value and never the value.
2. **Two credentials are read by path, not by environment.** `pi-stt-tokens`
   and `pi-semianalysis-cookie` are opened by name from inside the daemons, so
   migrating them needs a script change, not an `EnvironmentFile` line. The
   semianalysis 403 in its journal is that stale cookie.
3. **The deploy's file half still fails on the homelab.** The profile half
   lands (that is what carries the secrets) and the command exits 6 reporting
   that the checkout on the lab has no `profile` package, plus
   `zsh: command not found: git`. `git` is not on the non-interactive ssh PATH
   there either. Owned by the deploy work, not by the secrets work.
4. **The admin key has no backup.** `age1pnuq…` exists once, at
   `~/.config/sops/age/keys.txt` on this Mac. Put it in 1Password before the
   next rotation.
