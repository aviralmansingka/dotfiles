#!/bin/sh
set -eu

# PROTOTYPE: Can the official install/init flow remain isolated, generate one
# user-level skill that Pi actually discovers, and select native Pi as runner?

candidate=${NO_MISTAKES_CANDIDATE:-v1.41.2}
probe_root=$(mktemp -d /private/tmp/no-mistakes-p01.XXXXXX)
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
    /private/tmp/no-mistakes-p01.*) find "$probe_root" -depth -delete ;;
    *) return 1 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$probe_home" "$probe_bin" "$probe_install" "$probe_state"
export HOME=$probe_home
export NM_HOME=$probe_state
export NM_TEST_START_DAEMON=1
export NO_MISTAKES_INSTALL_DIR=$probe_install
export NO_MISTAKES_LINK_DIR=$probe_bin
export NO_MISTAKES_TELEMETRY=0
export NO_MISTAKES_NO_UPDATE_CHECK=1
export PATH=$probe_bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh \
  -o "$probe_root/install.sh"
sh "$probe_root/install.sh"
"$no_mistakes" --version | grep "$candidate"

printf 'agent: pi\n' > "$probe_state/config.yaml"
git init -q --bare "$probe_root/origin.git"
git init -q -b main "$probe_repo"
git -C "$probe_repo" config user.name 'No Mistakes P01'
git -C "$probe_repo" config user.email 'p01@example.invalid'
printf 'prototype\n' > "$probe_repo/README.md"
git -C "$probe_repo" add README.md
git -C "$probe_repo" commit -qm 'prototype'
git -C "$probe_repo" switch -qc prototype/p01
git -C "$probe_repo" remote add origin "$probe_root/origin.git"

(cd "$probe_repo" && "$no_mistakes" init)
"$no_mistakes" doctor

pi_package=/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js
node --input-type=module - "$probe_repo" "$pi_package" <<'JS'
import { pathToFileURL } from "node:url";

const [cwd, packagePath] = process.argv.slice(2);
const { DefaultResourceLoader, getAgentDir } = await import(pathToFileURL(packagePath));
const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
await loader.reload();
const skill = loader.getSkills().skills.find(({ name }) => name === "no-mistakes");
if (!skill) throw new Error("Pi did not discover no-mistakes");
console.log(`pi_skill=${skill.name}`);
console.log(`pi_skill_path=${skill.filePath}`);
JS

test -f "$probe_home/.agents/skills/no-mistakes/SKILL.md"
test -f "$probe_home/.claude/skills/no-mistakes/SKILL.md"
test ! -e "$probe_repo/.agents/skills/no-mistakes/SKILL.md"
gate_url=$(git -C "$probe_repo" remote get-url no-mistakes)
case "$gate_url" in
  "$probe_state"/repos/*.git) ;;
  *) exit 1 ;;
esac

printf '%s\n' \
  "binary=$probe_install/no-mistakes" \
  "link=$(readlink "$no_mistakes")" \
  "state=$probe_state" \
  "agent=pi" \
  "repo_local_skill=absent" \
  "skill_sha256=$(shasum -a 256 "$probe_home/.agents/skills/no-mistakes/SKILL.md" | awk '{print $1}')" \
  "cleanup=trap removes the disposable home, daemon, gate, and repository"
