#!/usr/bin/env bash
# Terraform checks for ops/terraform and ops/devbox (CI surface X10a/X10b).
#
# Dual-mode pattern (PR #293 rule):
#   default : a missing tool prints SKIP with a message and does not fail.
#   STRICT=1: a missing tool FAILs. Use this mode in CI.
#
# Network-gated opt-in:
#   TF_VALIDATE=1 runs `terraform init -backend=false` + `terraform validate`.
#   init downloads providers, so it needs network. The static checks below
#   are the offline lane and always run (init is never run without
#   -backend=false, so no remote backend is contacted).
#
# Every check prints PASS/FAIL/SKIP with file and reason, plus timing.
# Deterministic: file lists come from git ls-files (sorted), no network,
# no cloud credentials, no state access.

set -uo pipefail

STRICT="${STRICT:-0}"
TF_VALIDATE="${TF_VALIDATE:-0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

now_ms() {
    local t
    t="$(date +%s%N 2>/dev/null || true)"
    # GNU date: seconds+nanoseconds -> divide to ms.
    # BSD date (macOS): no %N, output ends in N or is empty -> seconds -> ms.
    case "$t" in
        *N|'') t="$(( $(date +%s) * 1000 ))" ;;
        *) t="$(( t / 1000000 ))" ;;
    esac
    printf '%s' "$t"
}

report() {
    # $1 status  $2 check name  $3 file  $4 reason  $5 ms
    printf '%s %-24s %s | %s (%s ms)\n' "$1" "$2" "$3" "$4" "$5"
    case "$1" in
        PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
        FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
        SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
    esac
}

tf_files() {
    local files
    files="$(git -C "$REPO_ROOT" ls-files -- 'ops/terraform/*.tf' 'ops/devbox/*.tf' 2>/dev/null | sort)"
    if [ -z "$files" ]; then
        # Fallback for a copy without .git (deterministic: sorted, same set).
        files="$(find "$REPO_ROOT/ops/terraform" "$REPO_ROOT/ops/devbox" \
            -name '*.tf' -type f 2>/dev/null | sed "s|^$REPO_ROOT/||" | sort)"
    fi
    printf '%s\n' "$files"
}

TOTAL_START="$(now_ms)"

echo "== ops/terraform + ops/devbox checks (STRICT=$STRICT TF_VALIDATE=$TF_VALIDATE) =="

# --------------------------------------------------------------------------
# X10a static invariants — offline lane, no terraform binary needed.
# --------------------------------------------------------------------------

# Check 1: no hardcoded `profile =` attribute in any tracked .tf file.
# A hardcoded profile broke env-var/OIDC auth in CI (#7).
while IFS= read -r f; do
    [ -n "$f" ] || continue
    t0="$(now_ms)"
    # Match `profile =` as a whole word, at line start or inline.
    if grep -Eq '(^|[^[:alnum:]_])profile[[:space:]]*=' "$REPO_ROOT/$f"; then
        report FAIL tf-no-profile "$f" "hardcoded profile attribute breaks env-var/OIDC auth (#7)" "$(( $(now_ms) - t0 ))"
    else
        report PASS tf-no-profile "$f" "no profile attribute" "$(( $(now_ms) - t0 ))"
    fi
done < <(tf_files)

# Checks 2-6 need python3 for HCL block parsing (stdlib only).
if command -v python3 >/dev/null 2>&1; then
    while IFS=$'\t' read -r st nm fl rs ms; do
        [ -n "$st" ] || continue
        report "$st" "$nm" "$fl" "$rs" "$ms"
    done < <(python3 - "$REPO_ROOT" <<'PYEOF'
import os
import re
import sys

repo = sys.argv[1]


def read(rel):
    with open(os.path.join(repo, rel), encoding="utf-8") as fh:
        return fh.read()


def blocks(text, keyword):
    """Yield (type, name, body) for `keyword "type" "name" { ... }` blocks."""
    out = []
    for m in re.finditer(rf'{keyword}\s+"([^"]+)"\s+"([^"]+)"\s*\{{', text):
        i = m.end() - 1
        depth = 0
        j = i
        instr = False
        esc = False
        while j < len(text):
            c = text[j]
            if instr:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    instr = False
            else:
                if c == '"':
                    instr = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        out.append((m.group(1), m.group(2), text[i : j + 1]))
    return out


def emit(status, name, file, reason):
    print(f"{status}\t{name}\t{file}\t{reason}\t0")


# Check 2: the GitHub Actions OIDC trust policy is scoped to this repo (#8).
oidc = read("ops/terraform/oidc.tf")
m = re.search(r'"token\.actions\.githubusercontent\.com:sub"\s*=\s*"([^"]*)"', oidc)
if not m:
    emit("FAIL", "tf-oidc-scope", "ops/terraform/oidc.tf",
         "no sub condition for token.actions.githubusercontent.com")
else:
    sub = m.group(1)
    if re.fullmatch(r"repo:aviralmansingka/dotfiles:\*", sub):
        emit("PASS", "tf-oidc-scope", "ops/terraform/oidc.tf",
             f"sub condition scoped to this repo ({sub})")
    else:
        emit("FAIL", "tf-oidc-scope", "ops/terraform/oidc.tf",
             f"sub condition not scoped to this repo ({sub!r})")

# Check 3: no AdministratorAccess-style broad policy on the CI role (#16).
broad = re.search(r"AdministratorAccess|PowerUserAccess|IAMFullAccess", oidc)
wild = re.search(r'Action\s*=\s*"\*"', oidc)
if broad:
    emit("FAIL", "tf-ci-role-breadth", "ops/terraform/oidc.tf",
         f"CI role references broad managed policy: {broad.group(0)}")
elif wild:
    emit("FAIL", "tf-ci-role-breadth", "ops/terraform/oidc.tf",
         'CI role policy grants Action = "*"')
else:
    emit("PASS", "tf-ci-role-breadth", "ops/terraform/oidc.tf",
         "CI role has no AdministratorAccess-style grant")

# Check 4: every AWS resource in the devbox root is count-gated on
# devbox_enabled so devbox_enabled=false yields a zero-instance plan (#10).
devbox_tf = read("ops/devbox/devbox.tf")
aws_resources = [b for b in blocks(devbox_tf, "resource") if b[0].startswith("aws_")]
ungated = [n for t, n, body in aws_resources
           if not re.search(r"count\s*=\s*var\.devbox_enabled", body)]
if not aws_resources:
    emit("FAIL", "tf-devbox-count-gate", "ops/devbox/devbox.tf",
         "no aws_ resources found; parse drift?")
elif ungated:
    emit("FAIL", "tf-devbox-count-gate", "ops/devbox/devbox.tf",
         "ungated aws_ resources: " + ", ".join(ungated))
else:
    emit("PASS", "tf-devbox-count-gate", "ops/devbox/devbox.tf",
         f"all {len(aws_resources)} aws_ resources gated on var.devbox_enabled")

# Check 5: the name_prefix (branch-scoping) variable exists and is used (#20).
devbox_vars = read("ops/devbox/variables.tf")
has_var = re.search(r'variable\s+"name_prefix"', devbox_vars) is not None
uses = len(re.findall(r"var\.name_prefix", devbox_tf))
if has_var and uses >= 3:
    emit("PASS", "tf-name-prefix", "ops/devbox/variables.tf",
         f"name_prefix variable present, {uses} uses in devbox.tf")
else:
    emit("FAIL", "tf-name-prefix", "ops/devbox/variables.tf",
         f"name_prefix variable present={has_var}, uses in devbox.tf={uses} (need >= 3)")

# Check 6: DNS records reference the VPS IP attribute, not literals (#6).
dns = read("ops/terraform/dns.tf")
records = [b for b in blocks(dns, "resource") if b[0] == "hostinger_dns_record"]
bad = []
for _t, name, body in records:
    vm = re.search(r"^\s*value\s*=\s*(.+)$", body, re.MULTILINE)
    if not vm or not re.match(r"hostinger_vps\.[A-Za-z0-9_.]+", vm.group(1).strip()):
        bad.append(name)
literal = re.search(r'=\s*"\d+\.\d+\.\d+\.\d+"', dns)
if not records:
    emit("FAIL", "tf-dns-ip-attr", "ops/terraform/dns.tf",
         "no hostinger_dns_record resources found; parse drift?")
elif bad or literal:
    emit("FAIL", "tf-dns-ip-attr", "ops/terraform/dns.tf",
         "literal values instead of the VPS IP attribute: " + ", ".join(bad))
else:
    emit("PASS", "tf-dns-ip-attr", "ops/terraform/dns.tf",
         f"all {len(records)} records use hostinger_vps.dev.ipv4_address")
PYEOF
    )
else
    for nm in tf-oidc-scope tf-ci-role-breadth tf-devbox-count-gate tf-name-prefix tf-dns-ip-attr; do
        if [ "$STRICT" = "1" ]; then
            report FAIL "$nm" "ops/terraform|ops/devbox" "python3 not found (STRICT=1)" 0
        else
            report SKIP "$nm" "ops/terraform|ops/devbox" "python3 not found; install python3 to run this check" 0
        fi
    done
fi

# --------------------------------------------------------------------------
# X10b tool checks — need the terraform binary (dual mode).
# --------------------------------------------------------------------------

for dir in ops/terraform ops/devbox; do
    t0="$(now_ms)"
    if command -v terraform >/dev/null 2>&1; then
        if terraform -chdir="$REPO_ROOT/$dir" fmt -check -diff >/dev/null 2>&1; then
            report PASS tf-fmt "$dir" "all .tf files formatted" "$(( $(now_ms) - t0 ))"
        else
            report FAIL tf-fmt "$dir" "terraform fmt -check found unformatted files" "$(( $(now_ms) - t0 ))"
        fi
    elif [ "$STRICT" = "1" ]; then
        report FAIL tf-fmt "$dir" "terraform not found (STRICT=1)" "$(( $(now_ms) - t0 ))"
    else
        report SKIP tf-fmt "$dir" "terraform not found; install terraform to run this check" "$(( $(now_ms) - t0 ))"
    fi
done

for dir in ops/terraform ops/devbox; do
    t0="$(now_ms)"
    if [ "$TF_VALIDATE" != "1" ]; then
        report SKIP tf-validate "$dir" "not requested; set TF_VALIDATE=1 (network-gated: init downloads providers)" "$(( $(now_ms) - t0 ))"
    elif ! command -v terraform >/dev/null 2>&1; then
        if [ "$STRICT" = "1" ]; then
            report FAIL tf-validate "$dir" "TF_VALIDATE=1 but terraform not found (STRICT=1)" "$(( $(now_ms) - t0 ))"
        else
            report SKIP tf-validate "$dir" "TF_VALIDATE=1 but terraform not found" "$(( $(now_ms) - t0 ))"
        fi
    else
        # -backend=false: never contact the remote S3 backend.
        if terraform -chdir="$REPO_ROOT/$dir" init -backend=false -input=false >/dev/null 2>&1 \
            && terraform -chdir="$REPO_ROOT/$dir" validate >/dev/null 2>&1; then
            report PASS tf-validate "$dir" "init -backend=false + validate succeeded" "$(( $(now_ms) - t0 ))"
        else
            report FAIL tf-validate "$dir" "init/validate failed; run manually for details" "$(( $(now_ms) - t0 ))"
        fi
    fi
done

TOTAL_MS="$(( $(now_ms) - TOTAL_START ))"
echo "== terraform: $PASS_COUNT pass, $FAIL_COUNT fail, $SKIP_COUNT skip (total ${TOTAL_MS} ms) =="

[ "$FAIL_COUNT" -eq 0 ]
