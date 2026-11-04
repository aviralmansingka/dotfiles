# Bring up a bare EC2 Ubuntu host

## What this gives you

The profile half is deterministic: `remote` for `probe` carries 23 owned tools,
six unit files, and generated state files. The lock decides the result.

The file half needs the checkout: `install.sh --stow-only` links the file packages
into `$HOME`. Secrets and host data stay behind, as the last section lists.

## Prerequisites

- An AWS account with CLI access and working credentials.
- An SSH key pair that exists in the region.
- A flake checkout on the Mac, with `just` and `git` available.
- The region. This recipe uses `ap-south-1` (Mumbai).

## Step 1 — Make the instance

```sh
# 1. newest Ubuntu 24.04 amd64 server image
aws ec2 describe-images --region ap-south-1 --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-amd64-server-*" --query 'sort_by(Images,&CreationDate)[-1].[ImageId,Name]' --output text
# 2. default VPC, then one of its subnets
aws ec2 describe-vpcs --region ap-south-1 --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text
# If that prints None, the account has no default VPC. List what exists and use
# its VPC id and a subnet in it:
aws ec2 describe-vpcs --region ap-south-1 --query 'Vpcs[].[VpcId,CidrBlock]' --output text
aws ec2 describe-subnets --region ap-south-1 --query 'Subnets[].[SubnetId,VpcId,AvailabilityZone]' --output text
aws ec2 describe-subnets --region ap-south-1 --filters "Name=vpc-id,Values=<vpc-id>" --query 'Subnets[0].SubnetId' --output text
# The default image root volume is 8 GiB. The block-device mapping above makes
# it 30 GiB, which the Nix store needs.
# 3. security group, SSH from your own address only
aws ec2 create-security-group --region ap-south-1 --group-name probe-ssh --vpc-id <vpc-id>
aws ec2 authorize-security-group-ingress --region ap-south-1 --group-id <group-id> \
  --protocol tcp --port 22 --cidr "$(curl -s https://checkip.amazonaws.com)/32"
# 4. start the instance
aws ec2 run-instances --region ap-south-1 --image-id <ami-id> --instance-type t3.micro \
  --key-name <key-pair> --subnet-id <subnet-id> --security-group-ids <group-id> \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=nix-fleet-probe}]' \
  --query 'Instances[0].[InstanceId,PublicDnsName]' --output text
# 5. wait, then read the public DNS name
aws ec2 wait instance-running --region ap-south-1 --instance-ids <instance-id>
aws ec2 describe-instances --region ap-south-1 --instance-ids <instance-id> \
  --query 'Reservations[0].Instances[0].PublicDnsName' --output text
# 6. note the instance id and the DNS name. The box has no Nix and no checkout
```

## Step 2 — Name it like the flake does

```sh
ssh ubuntu@<public-dns> sudo hostnamectl set-hostname probe
```
The deploy script chooses between a local switch and a remote deploy from
`hostname -s`, so the hostname must equal the target name.

## Step 2b — Add swap on a 1 GiB instance

`t3.micro` has 909 MiB of usable RAM. A Nix switch needs more, so add a swapfile
before the first build:

```sh
ssh ubuntu@<public-dns> 'set -e
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap -q /swapfile >/dev/null && sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  free -m | grep Swap'
```

## Step 3 — Install Nix

```sh
# Two installers work. `install.sh` on this branch runs the Determinate one:
#   curl -fsSL https://install.determinate.systems/nix | sh -s -- install linux --init none --no-confirm
# The recorded run used upstream's multi-user installer instead:
ssh ubuntu@<public-dns> 'sh <(curl -sL https://nixos.org/nix/install) --daemon --yes'
# Either way, the flake features for the daemon:
ssh ubuntu@<public-dns> 'echo "experimental-features = nix-command flakes" | sudo tee -a /etc/nix/nix.conf'
ssh ubuntu@<public-dns> 'sudo systemctl restart nix-daemon'
# the two checks
ssh ubuntu@<public-dns> 'nix --version'                   # a version string
ssh ubuntu@<public-dns> 'systemctl is-active nix-daemon' # active
```
A new login shell puts `nix` on the PATH; `/etc/profile.d/nix.sh` owns that line.

## Step 4 — Point ssh at it

Put this in `~/.ssh/config` on the Mac. The deploy script resolves the target
`probe` through this alias.

```
Host probe
  HostName <public-dns>
  User ubuntu
  IdentityFile ~/.ssh/<key-pair>.pem
```

## Step 5 — Deploy the profile

From the Mac, in the flake checkout:

```sh
just deploy remote probe
```
The script stages `~/.cache/nix-fleet-deploy/remote-remote-probe` on the box and
switches there. Four checks show the result:

```sh
ssh probe 'just --version'                           # from the profile
ssh probe 'wc -l < ~/.local/state/fleet-owned-tools' # 23 apt names
ssh probe 'cut -d" " -f2 ~/.local/state/fleet-owned-tools | sort -u | xargs -n1 test -d'
ssh probe 'ls ~/.config/systemd/user/{dotfiles-auto-sync,vault-auto-sync,pi-stt-worker,pi-telegram,pi-whatsapp,whatsapp-bridge}.service'
ssh probe 'ls ~/.config/systemd/user/default.target.wants 2>/dev/null | wc -l'  # 0
ssh probe 'sha256sum ~/.cache/nix-fleet-deploy/remote-remote-probe/flake.lock'
shasum -a 256 flake.lock
```
The third command exits 0 when every store path exists. The fourth names the six
unit files. The last two digests must match: the box then ran the homelab's lock.

## Step 6 — Deploy from the box itself

```sh
ssh probe
cd ~/.cache/nix-fleet-deploy/remote-remote-probe
just deploy remote probe
```
`hostname -s` here equals the target, so the script runs a local switch.

## Step 7 — The file half

```sh
ssh probe 'git clone https://github.com/aviralmansingka/dotfiles ~/dotfiles'
ssh probe '~/dotfiles/install.sh --stow-only'
```
`install.sh` skips the Nix bootstrap when `nix` is already on the PATH, so this
run only adds the file links.

## What still needs a human

- The env files and keys: `~/.config/pi-*.env`, the whatsapp-bridge credentials
  in `~/projects/whatsapp-mcp`, and the semianalysis sync credential.
- `~/vault`: clone the Obsidian vault. Three units work from it.
- `~/projects/whatsapp-mcp`, with the `whatsapp-bridge` binary its unit runs.
- The uv venvs under `~/.local/share/<name>/.venv`. See `docs/nix-profiles.md`.
- `sudo loginctl enable-linger ubuntu` if a unit must run with no login session.

## Teardown

```sh
aws ec2 terminate-instances --region ap-south-1 --instance-ids <instance-id>
# the security group probe-ssh and the key pair stay in the account
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `just deploy` stops with "unknown target" | The target is absent from `nix/lib/fleet.nix` and from the script's target table. Add the host to both, or correct the spelling. |
| The switch stops with "does not match the caller's username" | The profile's `home.username` differs from the ssh user. For `probe` both are `ubuntu`; fix `nix/modules/remote/probe.nix` or the `User` line in `~/.ssh/config`. |
| The switch fails on a missing flake input | The box has no network, or no `nix-command flakes` feature. Check `curl -sI https://cache.nixos.org` and the `experimental-features` line in `/etc/nix/nix.conf`. |
| The six units show as `linked` and inactive | That is the intended state on a fresh box. `probe` sets `fleet.services.enableUnits = false`, so the units ship as files with no enablement. |

## Recorded run (2026-11-05, ap-south-1b)

The steps above were executed once, from a bare instance. The values:

| Fact | Value |
| --- | --- |
| Region, zone | ap-south-1, ap-south-1b |
| AMI | `ami-0fc5120b2d80d4749`, `ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20261023` |
| Instance | `i-020d003e5b82356b6`, t3.micro, 30 GiB gp3, key pair `rack-bench-iperf` |
| VPC, subnet | `vpc-00d2dd5dcd01d0bc5` (no default VPC in this account), `subnet-0facbe1bbe0bdb5d4` |
| Security group | `sg-0572582eda138f317`, SSH from the owner address only |
| Image release | Ubuntu 24.04.5 LTS, x86_64, 2 vCPU, 909 MiB RAM, 29 GB root |
| Nix | 2.35.4, multi-user, `nix-daemon` active |
| Deploy from the Mac | `just deploy remote probe`, 6m27s, `switch complete on probe` |
| Deploy from the box | same script in `~/.cache/nix-fleet-deploy/remote-remote-probe`, `switch complete` |
| Lock | `b7dfd2482e03fde36c5cf18b481a89111ab7f8320bd6a8e69b88473dd93cd040`, equal to the homelab |

Checks after the deploy: `just 1.59.0`; `~/.local/state/fleet-owned-tools` has 23
lines and every store path exists; the six unit files resolve into `/nix/store`
and there is no `default.target.wants`, so all six read `linked`/`inactive`; all
seventeen probed tools resolve from the profile; `zsh -lic` works.

The checkout lands on `main`, which predates this branch, so `install.sh
--stow-only` does not exist there yet. The file half ran as the same stow set by
hand:

```sh
git clone https://github.com/aviralmansingka/dotfiles.git ~/dotfiles
for p in zsh tmux nvim starship ghostty aerospace rex gh-dash tuicr agents pi herdr git; do
  stow -d ~/dotfiles -t ~ "$p"
done
```

After it, `~/.zshrc`, `~/.tmux.conf`, `~/.config/nvim` and 64 files under
`~/.pi/agent/extensions` resolve into the checkout. Once the branch lands, the
same two lines are `./install.sh --stow-only`.

Missing on a bare box, by design: `~/vault`, `~/projects/whatsapp-mcp`, the
`.env` files, the uv venvs, and `Linger=no`. The profile ships the unit files
and leaves them unenabled.
