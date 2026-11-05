#!/usr/bin/env bash
# Dump every libvirt domain and record its state and the dump's sha256.
#
# The hypervisor is a root system service, so the dumps stay outside the repo:
# they carry host paths, MAC addresses and console settings. The repo keeps only
# nix/lib/libvirt-domains.nix, which pins each dump by sha256.
#
# Usage: scripts/capture-libvirt-domains.sh [--dir DIR] [--write-nix]
#   --dir DIR     dump directory (default: ~/libvirt-dumps/<today>)
#   --write-nix   also rewrite nix/lib/libvirt-domains.nix from the dumps
set -euo pipefail

conn="${LIBVIRT_URI:-qemu:///system}"
dir="$HOME/libvirt-dumps/$(date +%F)"
write_nix=0

while [ $# -gt 0 ]; do
  case "$1" in
  --dir)
    dir="$2"
    shift 2
    ;;
  --write-nix)
    write_nix=1
    shift
    ;;
  -h | --help)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    printf 'unknown argument: %s\n' "$1" >&2
    exit 2
    ;;
  esac
done

mkdir -p "$dir"
: >"$dir/states.txt"

names="$(virsh -c "$conn" list --all --name | sed '/^$/d')"
if [ -z "$names" ]; then
  printf 'no domains on %s\n' "$conn" >&2
  exit 1
fi

while IFS= read -r name; do
  virsh -c "$conn" dumpxml --inactive "$name" >"$dir/$name.xml"
  printf '%s %s\n' "$name" "$(virsh -c "$conn" domstate "$name")" >>"$dir/states.txt"
done <<<"$names"

(cd "$dir" && sha256sum ./*.xml >manifest.txt)

printf 'dumped %s domains to %s\n' "$(wc -l <"$dir/states.txt")" "$dir"
cat "$dir/states.txt"

if [ "$write_nix" -eq 1 ]; then
  python3 - "$dir" "$conn" <<'PYEOF'
import datetime, pathlib, re, subprocess, sys

dump_dir, conn = sys.argv[1], sys.argv[2]
names = [
    n
    for n in subprocess.run(
        ["virsh", "-c", conn, "list", "--all", "--name"],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    if n
]
lines = []
for name in names:
    uuid = subprocess.run(
        ["virsh", "-c", conn, "domuuid", name],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    sha = subprocess.run(
        ["sha256sum", f"{dump_dir}/{name}.xml"],
        check=True, capture_output=True, text=True,
    ).stdout.split()[0]
    lines.append(f'    {{ name = "{name}"; uuid = "{uuid}"; xmlSha256 = "{sha}"; }}')
entries = "\n".join(lines) + "\n"

path = pathlib.Path("nix/lib/libvirt-domains.nix")
text = path.read_text()
begin, end = "    # BEGIN GENERATED\n", "    # END GENERATED\n"
start, stop = text.index(begin), text.index(end)
text = text[:start] + begin + entries + text[stop:]
text = re.sub(r'captured = "[^"]*";', f'captured = "{datetime.date.today().isoformat()}";', text, count=1)
text = re.sub(
    r'dumpDirectory = "[^"]*";',
    f'dumpDirectory = "{dump_dir.replace(str(pathlib.Path.home()), "~")}";',
    text,
    count=1,
)
text = re.sub(r'connection = "[^"]*";', f'connection = "{conn}";', text, count=1)
path.write_text(text)
print(f"wrote {path} with {len(names)} domains")
PYEOF
fi
