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
| `versions.tf` | Pinned provider (`hashicorp/aws` `5.100.0`), partial S3 backend, one provider pinned to `ap-south-1` |
| `variables.tf` | Host name, profile, size key, resolved instance type and disk size, owner and test-run tags, SSH **public** key, approved bootstrap CIDR |
| `main.tf` | AMI lookup, key pair, security group, SSM role and instance profile, instance, outputs |
| `cloud-init.yaml` | Nix prerequisites and the multi-user Nix daemon. No secrets, no enrollment key |

Reused from `ops/terraform` rather than duplicated: the provider-alias shape,
the Canonical Ubuntu 24.04 `hvm-ssd-gp3` AMI filter, the encrypted gp3 root
volume, IMDSv2, and the `aviral-dotfiles-terraform-state` bucket. It is a
separate root on purpose — `ops/terraform` owns the long-lived Mumbai Rex host
and the account-level IAM and DNS objects, and this root must not be able to
reach them.

## State isolation

One host name, one state object, one working directory:

```
state object : s3://aviral-dotfiles-terraform-state/fleet-hosts/<host>/terraform.tfstate
working dir  : <run_dir>/<host>/          run_dir defaults to /var/lib/fleet-provision/terraform-runs
backend      : partial — bucket and bucket region are in versions.tf, the key is not
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
* Tags on every taggable resource: `Name`, `ManagedBy`, `fleet-owner`,
  `fleet-test-run`, `fleet-provider`, `fleet-profile`, `fleet-size`,
  `fleet-state`.

## Offline versus live

Offline (no credentials, no network): the Go adapter's tests assert the exact
argument arrays, the per-host state key, size and region rejection, replay
idempotency, per-host serialization, and destroy isolation, all against a fake
runner.

Live (needs an AWS account, credentials with EC2/IAM/SSM/S3 access, and a
network):

```sh
terraform -chdir=ops/provision/terraform/aws init -backend=false
terraform -chdir=ops/provision/terraform/aws validate
```

Then one host through the service, with the run directory and the state key the
service computes. The exact commands and the blocked gates are in the S02
artifact.
