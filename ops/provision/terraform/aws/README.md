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
| `variables.tf` | Host name, **required `vpc_id` and `subnet_id`**, profile, size key, resolved instance type and disk size, `owner` and test-run tag values, SSH **public** key, approved bootstrap CIDR |
| `main.tf` | AMI lookup, key pair, security group, SSM role and instance profile, instance, outputs |
| `cloud-init.yaml` | Nix prerequisites, the multi-user Nix daemon, and the system `tailscaled` daemon. No secrets, no enrollment key, no tailnet tag |

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
3. `/etc/tmpfiles.d/fleet-enroll.conf` creates `/run/fleet-enroll` (`0770`,
   `root:ubuntu`) on every boot, which is the only directory enrollment writes
   into;
4. a short readiness probe waits for `/var/run/tailscale/tailscaled.sock`.

The host is **not** enrolled by cloud-init. Enrollment is an explicit step the
worker performs later, and it is the only step that holds a credential:

```
SSM (IAM-authenticated)      cat /etc/ssh/ssh_host_ed25519_key.pub
  -> validate: reply instance id and correlation comment, exit status, one well-formed ed25519 key
  -> write a dedicated known_hosts file, mode 0600
mint                          single-use, non-ephemeral, preauthorized key, short expiry, tag from the approved profile
ssh (StrictHostKeyChecking=yes, UserKnownHostsFile=<that file>)
  -> stdin into /run/fleet-enroll/auth-key (umask 077, chmod 600)
  -> sudo -n tailscale up --auth-key=file:/run/fleet-enroll/auth-key --advertise-tags=tag:aws-host ...
  -> rm -f /run/fleet-enroll/auth-key  (also on the failure path)
```

A forged or changed host key aborts before a secret byte is written: the key is
minted only after the host key is pinned, and the pin is enforced by OpenSSH on
the delivery connection. No enrollment key is an argv word, an environment
variable, a log field, a workflow payload, or a Terraform variable.

## Bootstrap policy

* SSH ingress: one rule, port 22, source = `bootstrap_ssh_cidr`. The variable
  refuses anything wider than `/8`, so `0.0.0.0/0` cannot be expressed.
* Egress: TCP 443 only, for `nixos.org`, `cache.nixos.org`, and the SSM
  endpoints.
* IAM: an EC2 trust role with the AWS-managed `AmazonSSMManagedInstanceCore`
  policy attached and nothing else. No wildcard action, no inline policy.
* IMDSv2 required (`http_tokens = "required"`), hop limit 1, tags enabled.
* Root volume: gp3, encrypted, sized by the approved size key, deleted with the
  instance.

## Offline versus live

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

Live (needs an AWS account, credentials with EC2/IAM/SSM/S3 access, an approved
VPC and subnet, and a network):

```sh
terraform -chdir=ops/provision/terraform/aws init -backend=false
terraform -chdir=ops/provision/terraform/aws validate
```

Then one host through the service, with the run directory, the state key, and
the `vpc_id`/`subnet_id` the service configuration supplies. The exact commands
and the blocked gates are in the S02 artifact.
