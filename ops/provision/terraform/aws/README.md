# Per-host AWS entry point (S02)

The compute half of the fleet provisioning API. One API request creates one
owned EC2 host in `ap-south-1`; destroying it cannot affect any other fleet
resource.

The provisioning service does not run `terraform` from this directory. It
**copies these files into a run directory per host** and runs Terraform there.
This directory is the read-only template and the thing `terraform validate`
checks.

## What is here

| File | Content |
| --- | --- |
| `versions.tf` | Pinned provider (`hashicorp/aws` `5.100.0`), a **partial** `s3` backend block with nothing in it, one provider pinned to `ap-south-1` |
| `variables.tf` | Host name, **required `vpc_id` and `subnet_id`**, profile, size key, resolved instance type and disk size, `owner` and test-run tag values, SSH **public** key, an **optional** bootstrap CIDR that is empty by default (= no ingress rule at all), and the enrollment parameter prefix the IAM grant is scoped to |
| `main.tf` | AMI lookup, key pair, security group, SSM role with the scoped enrollment read grant, instance profile, instance, outputs |
| `cloud-init.yaml` | Nix prerequisites, the multi-user Nix daemon, the system `tailscaled` daemon, and the AWS CLI the enrollment script needs. No secrets, no enrollment key, no tailnet tag |

The network this root joins is not here: it is the dedicated fleet VPC in
`ops/provision/terraform/aws-network/` (`10.99.0.0/16`, public subnet
`10.99.1.0/24` in `ap-south-1a`), created once, before any host.

Reused from `ops/terraform` rather than duplicated: the provider-alias shape,
the Canonical Ubuntu 24.04 `hvm-ssd-gp3` AMI filter, the encrypted gp3 root
volume, IMDSv2, and the shared state bucket (as a `-backend-config` value, not
as a literal in the tracked files). It is a separate root on purpose —
`ops/terraform` owns the long-lived Mumbai Rex host and the account-level IAM
and DNS objects, and this root must not be able to reach them.

## Network is required input, never a lookup

`vpc_id` and `subnet_id` are **required variables with no default**:

* `aws_security_group.host` is created in `vpc_id`;
* `aws_instance.host` launches in `subnet_id`;
* nothing in this root discovers a VPC or a subnet (`aws_vpc`, `aws_subnets`,
  `aws_default_vpc`, `aws_default_subnet` appear nowhere), and this root creates
  no VPC, subnet, gateway, or route table of its own.

The values come from the dedicated fleet network root,
`ops/provision/terraform/aws-network/`, which outputs `vpc_id` and `subnet_id`
(VPC `10.99.0.0/16`, subnet `10.99.1.0/24` in `ap-south-1a`). **Network first,
then hosts** — the full two-step operator order, the CIDRs, and the backend forms
for both roots live in [`../aws-network/README.md`](../aws-network/README.md).

An empty or malformed value fails at plan time against the variable by name:

```
$ terraform -chdir=ops/provision/terraform/aws init -backend=false
$ terraform -chdir=ops/provision/terraform/aws plan \
    -var vpc_id= -var subnet_id=subnet-0123456789abcdef0 ...
Error: Invalid value for variable
  on variables.tf line 33, in variable "vpc_id":
  33: variable "vpc_id" {
vpc_id must be a VPC id such as vpc-0123456789abcdef0; it is required and this
root has no default-VPC fallback.
```

The Go adapter refuses the same configuration before it runs Terraform:
`terraform: vpc_id is required: the root creates the host's security group in
vpc_id and has no default-VPC fallback` (`subnet_id` likewise). Both are service
configuration (`providers.aws.terraform.vpc_id` / `subnet_id` in the service
file), so no API request can choose a network.

Why this is explicit: the account this service provisions in has exactly one VPC
in `ap-south-1` and it is **not** the default one (account attribute
`default-vpc` is `none`). A root that omitted these values failed live with
`api error VPCIdNotSpecified: No default VPC for this user`, after already
creating the key pair and IAM objects. The network is the owner's decision: a
dedicated fleet VPC, created by the network root above, never the Mumbai VPC.

## Names and tags

`local.name` in `main.tf` is the only source of an AWS object name: the project
prefix applied to `host_name` **at most once**. A host named `fleet-sm-28e571`
keeps one prefix; `rex-01` becomes `fleet-rex-01`. Key pair, security group, IAM
role, and instance profile all use it.

The 32-character budget is enforced, not truncated: `variables.tf` refuses a
`host_name` longer than 26 characters (or 32 when it already starts with
`fleet-`), and the adapter refuses the same name with a clear message before
Terraform runs. Truncating would let two hosts collide on one name.

Tags on every taggable resource follow the approved policy:

| Key | Value |
| --- | --- |
| `Name` | `host_name` |
| `ManagedBy` | `terraform` |
| `owner` | the `owner` tag value (never `fleet-owner`) |
| `fleet-test-run` | the run id, so a live run can find and destroy exactly its own hosts |
| `fleet-provider` | `aws` |
| `fleet-profile` | the approved profile name |
| `fleet-size` | the approved size key |
| `fleet-state` | this host's state object key, for the teardown audit |

## Backend: partial configuration

The tracked backend block is empty on purpose — no bucket, no key, no region, no
credentials:

```hcl
backend "s3" {}
```

Two supported ways to initialize it. Neither one edits a tracked file.

**1. Real state, one object per host** (what the adapter does; `initArgs` in
`internal/adapters/terraform/aws.go`):

```sh
terraform -chdir=ops/provision/terraform/aws init \
  -backend-config=bucket=aviral-dotfiles-terraform-state \
  -backend-config=key=fleet-hosts/<host>/terraform.tfstate \
  -backend-config=region=us-east-1 \
  -backend-config=encrypt=true
```

**2. Local state for a smoke run, no AWS backend access.** Copy the root
somewhere writable (as the adapter does) and drop one untracked override file
next to it. Terraform merges the override over the partial block, including the
backend type:

```sh
mkdir -p /tmp/fleet-smoke/root
cp ops/provision/terraform/aws/*.tf ops/provision/terraform/aws/cloud-init.yaml /tmp/fleet-smoke/root/

cat > /tmp/fleet-smoke/root/backend_override.tf <<'HCL'
terraform {
  backend "local" {
    path = "/tmp/fleet-smoke/terraform.tfstate"
  }
}
HCL

terraform -chdir=/tmp/fleet-smoke/root init -input=false -reconfigure
terraform -chdir=/tmp/fleet-smoke/root apply -auto-approve -input=false \
  -var vpc_id=<vpc-id> -var subnet_id=<subnet-id> ...
```

`*_override.tf` is gitignored inside this root, so an in-place smoke run leaves
`git status` clean. `-backend=false` initializes providers only; `apply` then
refuses with `Backend initialization required`, which is why the override (or
the `-backend-config` form) is the supported path.

## State isolation

One host name, one state object, one working directory:

```
state object : s3://<state bucket>/fleet-hosts/<host>/terraform.tfstate
working dir  : <run_dir>/<host>/          run_dir defaults to /var/lib/fleet-provision/terraform-runs
backend      : partial — nothing but the backend type is in versions.tf
```

* The adapter derives the state key from the host name with one function
  (`stateKey` in `internal/adapters/terraform/aws.go`); create, destroy, and the
  serialization lock all use it. Two hosts therefore cannot share a state file.
* `terraform init` receives the key as `-backend-config=key=fleet-hosts/<host>/terraform.tfstate`
  inside an argument array. Nothing in this root, or in a variable, can name a
  state path, so a request cannot redirect state.
* The per-host working directory means the `.terraform` cache,
  `.terraform.lock.hcl`, and any local artifacts are per host too. The template
  directory is only ever read.
* `terraform destroy` opens exactly one state object: the one keyed by the host
  in the destroy request. It has no `-target`, no `-state`, and no way to reach
  a sibling host, the Mumbai Rex host, or an account-level resource.

## Tailscaled bootstrap step (S03)

`cloud-init.yaml` installs `tailscaled` as a **system** unit — explicitly not a
Home Manager fragment, because the daemon owns the tun device, the state
directory, and the socket, and it has to be running before any user profile is
deployed:

1. the official Tailscale installer adds the apt repository and installs the
   package;
2. `systemctl enable tailscaled` and `systemctl start tailscaled` bring the
   daemon up at boot;
3. `snap install aws-cli --classic` installs the CLI the host needs to read its
   own enrollment parameter (Ubuntu 24.04 ships it only as a snap);
4. a short readiness probe waits for `/var/run/tailscale/tailscaled.sock`.

The host is **not** enrolled by cloud-init. Enrollment is an explicit step the
worker performs later, over SSM and only over SSM — there is no SSH path, so
`bootstrap_ssh_cidr` can stay empty forever:

```
agent check (SSM)   describe-instance-information for this instance id
                      -> not Online within the window: fail the job, mint nothing, no fallback
mint                single-use, non-ephemeral, preauthorized key, short expiry, tag from the approved profile
handoff (SSM PS)    put-parameter /fleet/enroll/<host_name>/<nonce>
                      SecureString, AWS-managed key alias/aws/ssm, no description, value never in argv
command (SSM RC)    send-command, addressed by instance id, comment = instance id
                      parameters carry the parameter NAME and the nonce, never the key
host script         aws ssm get-parameter --with-decryption > /run/fleet-enroll.key (umask 077, chmod 600)
                      tailscale up --auth-key="file:$KEY" --advertise-tags=tag:aws-host ...
                      rm -f $KEY  (trap on every exit path, then proved absent)
                      tailscale status --json  (device id and tags)
cleanup (SSM PS)    delete-parameter <that path>  (on success and on failure)
```

`ssm send-command` parameters stay in SSM command history, which is why the key
travels as an encrypted parameter and the history holds a parameter path. No
enrollment key is an argv word, an SSM command parameter, an SSM comment, a
command output line, a log field, a workflow payload, or a Terraform variable.

The trust anchor is IAM, not a host key: the control plane authenticates the
instance that ran the command, which is stronger than trusting whatever answers
on port 22, and it removed the last reason for the worker to reach a host on 22.

### No KMS key to create

Every enrollment parameter is encrypted with the **AWS-managed** `alias/aws/ssm`
key. That key exists in every account, AWS owns its key policy and its rotation,
and the host root does not look it up: there is no `aws_kms_key`, no
`aws_kms_alias`, and no key policy in either root.

**No operator key-creation step remains.** The `aws kms create-key` /
`create-alias` commands an earlier revision of this file listed are gone, and so
is the `enrollment.ssm.kms_key_id` service setting that named a fleet key. A
worker with a stale `kms_key_id` in its service file fails to load, because the
yaml field no longer exists.

## Bootstrap policy

* SSH ingress is **opt-in and off by default**: `bootstrap_ssh_cidr` defaults to
  the empty string, and `main.tf` feeds it through `local.bootstrap_cidrs`, so an
  empty value makes the `dynamic "ingress"` block emit **zero rules**. The host
  accepts nothing inbound; the tailnet is the only way in.
* A non-empty value emits **exactly one** rule: port 22, source = that single
  CIDR, nothing else. The variable refuses `0.0.0.0/0`, `::/0`, any mask wider
  than `/8`, and any malformed value, and the failure names
  `bootstrap_ssh_cidr`.
* The service passes the value as `-var bootstrap_ssh_cidr=` on every create and
  destroy, so the empty default is the same empty string on both paths. The
  service configuration field (`providers.aws.bootstrap.ssh_source_cidr`) is
  optional for the same reason: empty means no SSH ingress.
* Egress: TCP 443 only, for `nixos.org`, `cache.nixos.org`, and the SSM
  endpoints. Egress stays open even when ingress is empty, because the first boot
  needs Nix and the Tailscale control plane.
* IAM: an EC2 trust role with the AWS-managed `AmazonSSMManagedInstanceCore`
  policy attached, plus one inline policy that is the enrollment handoff and
  nothing else:
  * `ssm:GetParameter` on
    `arn:aws:ssm:ap-south-1:<account>:parameter/fleet/enroll/<host_name>/*` —
    this host's own prefix only, so a host cannot read another host's key even
    if it knows the path. No `PutParameter`, no `DeleteParameter`, no
    `GetParametersByPath`, no wildcard resource.
  * `kms:Decrypt` with `resources = ["*"]` and
    `kms:ViaService = ssm.ap-south-1.amazonaws.com`. The wildcard resource is
    safe because the via-service condition pins the grant to KMS requests that
    SSM makes on this role's behalf in this region — a host calling
    `aws kms decrypt` directly does not match it — and because the key policy on
    `alias/aws/ssm` is AWS's and admits the account's principals only for SSM's
    use of that key.
  * No `kms:CreateKey`, no `kms:CreateAlias`, no `kms:PutKeyPolicy`, and no key
    policy anywhere: the fleet never creates or governs a key.
  The grant is attached before the instance starts (`depends_on`), so no host
  boots without it.
* IMDSv2 required (`http_tokens = "required"`), hop limit 1, tags enabled.
* Root volume: gp3, encrypted, sized by the approved size key, deleted with the
  instance.

## Size and cost

`config/profiles.yaml` maps `rex` / `standard` to `t3.medium` and a **40 GiB**
encrypted gp3 root volume. 40 GiB is the fleet default (owner decision,
2026-11-09); no sizing text anywhere in this repository claims 20 GiB.

Approximate on-demand cost, per hour that one host is running, in `ap-south-1`:

| Item | Approximate price | Per hour |
| --- | --- | --- |
| `t3.medium` | ≈ US$0.045 per instance-hour | ≈ US$0.045 |
| 40 GiB gp3 root volume | ≈ US$0.092 per GB-month ÷ 730 h | ≈ US$0.005 |
| **Total** | | **≈ US$0.05 per host-hour** |

That is ≈ US$36 per 30-day month per host if it is never stopped. **Approximate,
not billing evidence:** AWS list prices change, and the figure excludes data
transfer, S3 state, and any NAT gateway (this design has none). Check the
account's own price list before approving a fleet budget.

## Offline versus live

### The two binaries come from the flake profile, not from `PATH`

`terraform` and `aws` are **profile tools** in
`nix/modules/shared/default.nix`, pinned there the same way `herdr` is. Do not
install either from Homebrew, apt, or a downloaded zip: a run must not depend on
whichever copy happens to be first on `PATH`.

| Tool | Pinned version | Where it comes from |
| --- | --- | --- |
| `terraform` | **1.17.1** | `pkgs.terraform`, pinned nixpkgs |
| `aws` | **2.36.31** (package `awscli2`) | `pkgs.awscli2`, pinned nixpkgs |

1.17.1 is the version live smoke #1 used (1.5.7 was the other one, and both roots
only require `>= 1.5.0`). The profile carries an assertion that fails if a flake
update moves either version, so a bump is a reviewed edit in the same change as
the runbooks.

Preflight, before any live command. It fails clearly instead of half-working with
a stray binary:

```sh
command -v terraform >/dev/null || {
  echo "terraform is missing: it is a profile tool (nix/modules/shared/default.nix); run 'home-manager switch' for this host, do not install it from Homebrew" >&2; exit 1; }
command -v aws >/dev/null || {
  echo "aws is missing: it is a profile tool (nix/modules/shared/default.nix, package awscli2); run 'home-manager switch' for this host" >&2; exit 1; }
terraform version | head -1   # must report Terraform v1.17.1
aws --version               # must report aws-cli/2.36.31
```

Offline (no credentials, no network):

```sh
cd ops/provision && go test ./...
terraform -chdir=ops/provision/terraform/aws init -backend=false
terraform -chdir=ops/provision/terraform/aws validate
```

The Go adapter's tests assert the exact argument arrays, the explicit
`vpc_id`/`subnet_id` variables, the absent default-VPC dependency, the tag keys,
the single-prefix naming rule, the per-host state key, size and region
rejection, replay idempotency, per-host serialization, and destroy isolation —
all against a fake runner
(`internal/adapters/terraform/{aws_test.go,root_test.go}`). `root_test.go` also
checks the network root: one VPC and one subnet, both tagged, the dedicated
`10.99.0.0/16` CIDR, and no ingress from `0.0.0.0/0` or `::/0` in either root.

The enrollment half has its own offline suite
(`internal/adapters/ssm/`): a fake host runs the real host script against fake
`aws` and `tailscale` binaries, so the assertions are about what the host would
do. It covers the key never appearing in command parameters, comments, or command
output; the parameter deleted on the success and the failure path; the key file at
0600 and gone afterwards; an unregistered agent aborting before anything is
minted; and `iam_test.go`, which reads this root and asserts the instance role's
grant is scoped to `arn:aws:ssm:ap-south-1:<account>:parameter/fleet/enroll/<host_name>/*`
with `ssm:GetParameter` as the only SSM action and a `kms:Decrypt` grant that is
limited to SSM by a via-service condition.

Live (needs an AWS account, credentials with EC2/IAM/SSM/S3 access, an approved
VPC and subnet, and a network). Run the preflight above first; `terraform` and
`aws` come from the flake profile, not from Homebrew or a random `PATH` entry:

```sh
terraform -chdir=ops/provision/terraform/aws init -backend=false
terraform -chdir=ops/provision/terraform/aws validate
```

Then one host through the service, with the run directory, the state key, and
the `vpc_id`/`subnet_id` the service configuration supplies. The exact commands
and the blocked gates are in the S02 artifact.
