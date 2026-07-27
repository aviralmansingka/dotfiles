#!/bin/sh
set -eu

# PROTOTYPE: Can a disposable no-mistakes daemon launch the real native Pi
# runner inside its managed worktree and return a structured AXI outcome?

candidate=${NO_MISTAKES_CANDIDATE:-v1.41.2}
real_pi_dir=${PI_CODING_AGENT_DIR:-/Users/aviral/.pi/agent}
runtime_bin_dir=${PI_RUNTIME_BIN_DIR:-/opt/homebrew/bin}
probe_tmp=${TMPDIR:-/private/tmp}
probe_root=$(mktemp -d "$probe_tmp/no-mistakes-p02.XXXXXX")
probe_home=$probe_root/home
probe_bin=$probe_root/bin
probe_install=$probe_root/install
probe_state=$probe_root/state
probe_repo=$probe_root/repo
no_mistakes=$probe_bin/no-mistakes

cleanup() {
  if [ -x "$no_mistakes" ]; then
    HOME=$probe_home NM_HOME=$probe_state NM_TEST_START_DAEMON=1 \
      "$no_mistakes" daemon stop --force >/dev/null 2>&1 || true
  fi
  case "$probe_root" in
    "$probe_tmp"/no-mistakes-p02.*) find "$probe_root" -depth -delete ;;
    *) return 1 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

test -d "$real_pi_dir"
mkdir -p "$probe_home" "$probe_bin" "$probe_install" "$probe_state"
export HOME=$probe_home
export NM_HOME=$probe_state
export NM_TEST_START_DAEMON=1
export NO_MISTAKES_INSTALL_DIR=$probe_install
export NO_MISTAKES_LINK_DIR=$probe_bin
export NO_MISTAKES_TELEMETRY=0
export NO_MISTAKES_NO_UPDATE_CHECK=1
export PI_CODING_AGENT_DIR=$real_pi_dir
export PATH=$probe_bin:$runtime_bin_dir:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh \
  -o "$probe_root/install.sh"
sh "$probe_root/install.sh"
"$no_mistakes" --version | grep "$candidate"
printf 'agent: pi\n' > "$probe_state/config.yaml"
if [ -n "${PI_PROVIDER:-}" ]; then
  printf 'agent_args_override:\n  pi:\n    - --provider\n    - %s\n' "$PI_PROVIDER" >> "$probe_state/config.yaml"
  if [ -n "${PI_MODEL:-}" ]; then
    printf '    - --model\n    - %s\n' "$PI_MODEL" >> "$probe_state/config.yaml"
  fi
fi

git init -q --bare "$probe_root/origin.git"
git init -q -b main "$probe_repo"
git -C "$probe_repo" config user.name 'No Mistakes P02'
git -C "$probe_repo" config user.email 'p02@example.invalid'
printf 'one\n' > "$probe_repo/value.txt"
git -C "$probe_repo" add value.txt
git -C "$probe_repo" commit -qm 'add initial value'
git -C "$probe_repo" remote add origin "$probe_root/origin.git"
git -C "$probe_repo" push -qu origin main
git -C "$probe_repo" switch -qc prototype/p02
printf 'two\n' >> "$probe_repo/value.txt"
git -C "$probe_repo" commit -qam 'append second value'

(cd "$probe_repo" && "$no_mistakes" init)
(cd "$probe_repo" && "$no_mistakes" axi run --yes \
  --intent 'Append a second line containing two to value.txt while preserving the existing first line.' \
  --skip test,document,lint,push,pr,ci)
(cd "$probe_repo" && "$no_mistakes" axi status)
