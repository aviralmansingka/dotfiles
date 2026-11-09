# One provisioned fleet host: AMI lookup, key pair, security group with an
# optional single-CIDR SSH ingress (none at all by default), a minimal SSM
# instance profile with a parameter read grant scoped to this host's own
# enrollment prefix, and the instance itself. Nothing account-wide lives here — no
# VPC, no subnet, no route table, no DNS, no IAM user, no Elastic IP — so tearing
# a host down cannot disturb the rest of the fleet, and `terraform destroy` on
# another host's state cannot see it.
#
# The network is input, not a lookup: the security group is created in
# `var.vpc_id` and the instance launches in `var.subnet_id`. This root never
# resolves a default VPC and never creates a VPC or a subnet.
#
# Enrollment runs over SSM, so no SSH ingress is required for it: the key pair and
# the optional CIDR exist for a human debugging session, not for the worker.

locals {
  # Documentation and tag value only: the state object the adapter actually
  # opens comes from `-backend-config=key=` at init time and is built from the
  # same host name by the Go adapter (see internal/adapters/terraform/aws.go).
  state_key = "fleet-hosts/${var.host_name}/terraform.tfstate"

  # Every AWS name this root creates carries the project prefix exactly once: a
  # host name that already begins with `fleet-` is used as is, so
  # `fleet-sm-28e571` never becomes `fleet-fleet-sm-28e571`. The result is never
  # truncated — variables.tf refuses a name that would not fit in 32 characters —
  # because a truncated name could collide with a different host.
  host_label = startswith(var.host_name, "fleet-") ? trimprefix(var.host_name, "fleet-") : var.host_name
  name       = "fleet-${local.host_label}"

  # Zero ingress is the default, not a narrow CIDR that happens to be
  # unreachable. An empty bootstrap_ssh_cidr yields an empty list here, so the
  # dynamic ingress block below emits NO rule at all; one non-empty value yields
  # exactly one rule. variables.tf refuses 0.0.0.0/0, ::/0, and every mask wider
  # than /8, so a public rule cannot be expressed at all.
  bootstrap_cidrs = var.bootstrap_ssh_cidr == "" ? [] : [var.bootstrap_ssh_cidr]

  # Approved tag policy: the owner tag KEY is `owner` (never `fleet-owner`), plus
  # `fleet-test-run`, so a live acceptance run can find and destroy exactly its
  # own hosts.
  tags = {
    Name             = var.host_name
    ManagedBy        = "terraform"
    owner            = var.owner
    "fleet-test-run" = var.test_run
    "fleet-provider" = "aws"
    "fleet-profile"  = var.profile
    "fleet-size"     = var.size_key
    "fleet-state"    = local.state_key
  }
}

# Ubuntu 24.04 LTS amd64 server, newest available, resolved in ap-south-1
# explicitly. Same Canonical owner and image family as ops/terraform/mumbai.tf.
data "aws_ami" "ubuntu" {
  provider    = aws.ap_south_1
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_key_pair" "host" {
  provider   = aws.ap_south_1
  key_name   = local.name
  public_key = var.ssh_public_key

  tags = local.tags
}

resource "aws_security_group" "host" {
  provider    = aws.ap_south_1
  name        = local.name
  description = "Fleet host ${var.host_name}: no ingress unless an approved bootstrap CIDR is set, HTTPS egress for Nix and SSM"

  # Required, explicit, and supplied by the service: there is no default-VPC
  # fallback, and this root creates no VPC of its own. A missing vpc_id fails the
  # variable validation in variables.tf before this resource is planned.
  vpc_id = var.vpc_id

  # The only ingress rule, and it is opt-in: an empty bootstrap_ssh_cidr makes
  # `local.bootstrap_cidrs` empty, so this block emits zero rules and the host
  # accepts nothing inbound (the tailnet is the way in). A non-empty value emits
  # exactly one 22/tcp rule from that single CIDR. There is no 0.0.0.0/0 or ::/0
  # ingress anywhere in this root, and the variable cannot express a CIDR wider
  # than /8.
  dynamic "ingress" {
    for_each = local.bootstrap_cidrs

    content {
      description = "SSH bootstrap from the approved operator CIDR"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  # Egress needed by the bootstrap: cache.nixos.org, nixos.org, and the SSM
  # service endpoints. Nothing else leaves the host.
  egress {
    description = "Nix installer and binary cache, plus the SSM service endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# The account id is not a credential and not client input: it is what an SSM
# parameter ARN is made of, and the only reason this root needs it. The instance
# role's read grant is scoped to an ARN built from it, so no wildcard resource can
# stand in for "this account".
data "aws_caller_identity" "current" {
  provider = aws.ap_south_1
}

# There is no fleet KMS key and no aws_kms_alias lookup here. Every enrollment
# parameter is encrypted with the AWS-managed `alias/aws/ssm` key, which exists in
# every account: no key resource, no alias, and no key policy is created or
# referenced by this root, so an operator has no key-creation step before a plan.

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# Host-key retrieval runs over SSM Session Manager, so the instance needs the
# EC2 service role and nothing more: no wildcard action, no inline policy, no
# account-wide grant. The attachment is not taggable; the role and the profile
# are. Both are named `local.name`, so no derived name needs a suffix that would
# push it past the 32-character budget.
resource "aws_iam_role" "host" {
  provider           = aws.ap_south_1
  name               = local.name
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "host_ssm" {
  provider   = aws.ap_south_1
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Enrollment handoff, in two statements that are both narrower than the SDK's
# convenience policy:
#
#   - GetParameter, and only GetParameter, on
#     `<prefix>/<this host's name>/*`. A host therefore cannot read another host's
#     parameter even if it knows the path: the ARN of that path is outside this
#     grant. Nothing here allows PutParameter or DeleteParameter, so a host cannot
#     write, extend, or resurrect a parameter either.
#   - Decrypt, and only when SSM in this region is the calling service. The
#     resource is `*` because the key is AWS-managed and its ARN is not something
#     this root resolves; `*` is safe here for two reasons. The kms:ViaService
#     condition means the grant can only be exercised on a KMS request that SSM
#     makes on this role's behalf in ap-south-1 — a direct `aws kms decrypt` call
#     from the host does not carry that key, so it does not match. And the key
#     policy on `alias/aws/ssm` is AWS's, not the fleet's: it lets this account's
#     principals use that key only on SSM's behalf, and the fleet creates no key
#     policy of its own that could loosen it. Together the condition and the
#     AWS-owned key policy scope the grant more tightly than a key ARN alone
#     would, and neither is a value an operator maintains.
#
# The command that delivers the key carries a parameter NAME and a nonce; SSM
# command history therefore holds a parameter path, never a credential.
data "aws_iam_policy_document" "host_enroll" {
  statement {
    sid    = "ReadThisHostsEnrollmentParameterOnly"
    effect = "Allow"

    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:ap-south-1:${data.aws_caller_identity.current.account_id}:parameter${var.enrollment_parameter_prefix}/${var.host_name}/*"]
  }

  statement {
    sid    = "DecryptOnlyThroughSSM"
    effect = "Allow"

    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.ap-south-1.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "host_enroll" {
  provider = aws.ap_south_1
  name     = "${local.name}-enroll"
  role     = aws_iam_role.host.id
  policy   = data.aws_iam_policy_document.host_enroll.json
}

resource "aws_iam_instance_profile" "host" {
  provider = aws.ap_south_1
  name     = local.name
  role     = aws_iam_role.host.name

  tags = local.tags
}

resource "aws_instance" "host" {
  provider = aws.ap_south_1

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.host.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.host.id]
  iam_instance_profile   = aws_iam_instance_profile.host.name

  # Public bootstrap only: packages, the Nix daemon, and lingering. No secret,
  # no enrollment key, no fleet credential — see cloud-init.yaml.
  user_data                   = file("${path.module}/cloud-init.yaml")
  user_data_replace_on_change = true

  # IMDSv2 required: no token-less metadata reads, so a bootstrap step cannot
  # be tricked into signing with the instance profile.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  # Encrypted gp3 root volume, sized by the approved size key, deleted with the
  # instance so a destroyed host leaves no orphaned volume behind.
  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.disk_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = local.tags

  # The profile must exist before the instance starts, or SSM registration
  # races the first boot.
  depends_on = [
    aws_iam_role_policy_attachment.host_ssm,
    aws_iam_role_policy.host_enroll,
  ]
}

output "instance_id" {
  description = "EC2 instance id of this host (empty until the instance exists)"
  value       = aws_instance.host.id
}

output "private_ip" {
  description = "Private address of the host, recorded for inventory and the audit trail; enrollment does not dial it"
  value       = aws_instance.host.private_ip
}

output "region" {
  description = "Region every resource in this root lives in"
  value       = "ap-south-1"
}

output "vpc_id" {
  description = "VPC this host joined, echoed for the teardown audit"
  value       = aws_security_group.host.vpc_id
}

output "subnet_id" {
  description = "Subnet this host launched in, echoed for the teardown audit"
  value       = aws_instance.host.subnet_id
}

output "resource_name" {
  description = "The single prefixed name every AWS object of this host carries"
  value       = local.name
}

output "state_key" {
  description = "S3 object key of this host's state; unique per host name"
  value       = local.state_key
}

output "enrollment_parameter_scope" {
  description = "The only SSM parameter path this host's instance role can read"
  value       = "arn:aws:ssm:ap-south-1:${data.aws_caller_identity.current.account_id}:parameter${var.enrollment_parameter_prefix}/${var.host_name}/*"
}

output "enrollment_kms_key_alias" {
  description = "The AWS-managed key every enrollment parameter is encrypted with; the fleet creates no key"
  value       = "alias/aws/ssm"
}

output "security_group_id" {
  description = "Security group of this host, for the teardown audit"
  value       = aws_security_group.host.id
}
