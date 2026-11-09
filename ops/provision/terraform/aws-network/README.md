# Dedicated fleet network (S04 owner decision)

The network half of the fleet provisioning API. Created **once**, before any
host, and destroyed only when the fleet is retired.

**Owner decision (2026-11-09):** fleet hosts join a **dedicated fleet VPC**, not
the pre-existing Mumbai VPC (`vpc-00d2dd5dcd01d0bc5`, `10.98.0.0/24`, already in
use by the long-lived infrastructure). No host ever uses the account's default
VPC — in `ap-south-1` there is none (`default-vpc` attribute is `none`), which
is what failed the live smoke with `VPCIdNotSpecified`.

## What it creates

| Resource | Value |
| --- | --- |
| `aws_vpc.fleet` | `10.99.0.0/16`, DNS support enabled, DNS hostnames enabled |
| `aws_subnet.public` | `10.99.1.0/24` in `ap-south-1a`, `map_public_ip_on_launch = true` |
| `aws_internet_gateway.fleet` | attached to the fleet VPC |
| `aws_route_table.public` + association | `0.0.0.0/0` → the fleet internet gateway |
| outputs | `vpc_id`, `subnet_id`, `vpc_cidr`, `subnet_cidr`, `region` |

Every taggable resource carries `owner`, `fleet-test-run`, `ManagedBy`, and a
`Name`. The tag key is `owner`, never `fleet-owner`.

## What it deliberately does not create

* **No NAT gateway and no NAT instance.** A NAT gateway costs more per month than
  the t3.medium host it would serve, and this design does not need one: the
  subnet is public, and the host's only inbound path is the tailnet.
* **No security group and no network ACL.** The host root creates the host's own
  security group inside this VPC, with one SSH ingress rule from the approved
  operator CIDR and HTTPS egress only. Nothing in either root allows `0.0.0.0/0`
  or `::/0` **ingress**; egress is open by design, because the first boot needs
  `cache.nixos.org`, `nixos.org`, and the Tailscale control plane.
* **No second subnet, no peering, no VPN.** One zone is the approved scope.
* **No default VPC reference of any kind.**

## Wiring: network first, then hosts

The two roots are separate, and the host root takes the network as **required
input**. That ordering is the whole contract:

1. **Network root** — `ops/provision/terraform/aws-network/` (this directory).
   Create it once, note the `vpc_id` and `subnet_id` outputs, and put them in the
   service configuration (`providers.aws.terraform.vpc_id` and `subnet_id`):

   ```sh
   # real state: one network object, keyed separately from every host
   terraform -chdir=ops/provision/terraform/aws-network init \
     -backend-config=bucket=<state bucket> \
     -backend-config=key=fleet-network/terraform.tfstate \
     -backend-config=region=<bucket region> \
     -backend-config=encrypt=true
   terraform -chdir=ops/provision/terraform/aws-network plan  -var owner=<owner> -var test_run=<run id>
   terraform -chdir=ops/provision/terraform/aws-network apply -var owner=<owner> -var test_run=<run id>
   terraform -chdir=ops/provision/terraform/aws-network output -raw vpc_id
   terraform -chdir=ops/provision/terraform/aws-network output -raw subnet_id
   ```

2. **Host root** — `ops/provision/terraform/aws/`, one run directory per host,
   driven by the Go adapter. It receives the two outputs as `-var vpc_id=…` and
   `-var subnet_id=…`, creates the host's security group inside that VPC, and
   launches the instance in that subnet. It never creates network resources.

For a smoke run without S3 state, copy either root to a writable directory and
drop one untracked local-backend override file there (the tracked backend blocks
are partial and empty):
```sh
cat > <root copy>/backend_override.tf <<'HCL'
terraform {
  backend "local" {
    path = "/tmp/fleet-smoke/terraform.tfstate"
  }
}
HCL
```

`*_override.tf` is gitignored inside these roots, so an in-place smoke run leaves
`git status` clean. `-backend=false` initializes providers only; `apply` then
refuses with `Backend initialization required`, so the override (or the
`-backend-config` form above) is the supported path.

## Offline checks

```sh
terraform -chdir=ops/provision/terraform/aws-network init -backend=false
terraform -chdir=ops/provision/terraform/aws-network validate
cd ops/provision && go test ./...
```

The Go suite asserts this root's shape without an AWS account: exactly one VPC and
one subnet, both tagged, the dedicated `10.99.0.0/16` CIDR, the public subnet
settings, gateway and default route, the two outputs the host root consumes, no
NAT gateway, no security group or network ACL in either root, and no `0.0.0.0/0`
or `::/0` ingress anywhere.
