package ssm_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const (
	shippedMainTF      = "../../../terraform/aws/main.tf"
	shippedVariablesTF = "../../../terraform/aws/variables.tf"
)

// TestInstanceRoleReadsOnlyItsOwnEnrollmentPrefix is the IAM half of the handoff,
// asserted against the Terraform root that actually ships. The instance role must
// be able to read exactly `<prefix>/<host_name>/*` — one host's own parameter — and
// its decrypt grant must be limited to SSM in this region. A wildcard parameter
// resource, a second action, or a grant that is not scoped by host name would let
// one host read another host's key, which is the whole risk of a shared store.
func TestInstanceRoleReadsOnlyItsOwnEnrollmentPrefix(t *testing.T) {
	t.Parallel()
	document := readFile(t, shippedMainTF)

	// One GetParameter grant, scoped by account, prefix, and this host's name.
	wantResource := "arn:aws:ssm:ap-south-1:${data.aws_caller_identity.current.account_id}:parameter${var.enrollment_parameter_prefix}/${var.host_name}/*"
	if !strings.Contains(document, wantResource) {
		t.Fatalf("main.tf does not scope the instance role to\n  %s", wantResource)
	}

	// Every ssm: action in the root is GetParameter. A host must not be able to
	// write, list, or delete a parameter. The pattern is a quoted action, so an
	// SSM ARN (`arn:aws:ssm:ap-south-1:...`) is not mistaken for one.
	actions := regexp.MustCompile(`"ssm:[A-Z][A-Za-z]+"`).FindAllString(document, -1)
	if len(actions) == 0 {
		t.Fatal("main.tf grants no ssm action at all")
	}
	for _, action := range actions {
		if action != `"ssm:GetParameter"` {
			t.Fatalf("main.tf grants %s; a host may only read its own parameter", action)
		}
	}

	// The read statement carries no wildcard resource, and no parameter ARN is
	// broader than the host's own prefix.
	read := policyStatement(t, document, `"ssm:GetParameter"`)
	if strings.Contains(read, `"*"`) {
		t.Fatalf("the GetParameter statement carries a wildcard resource:\n%s", read)
	}
	for _, forbidden := range []string{
		":parameter/*",
		":parameter${var.enrollment_parameter_prefix}/*",
		`parameter/fleet/enroll/*"`,
	} {
		if strings.Contains(document, forbidden) {
			t.Fatalf("main.tf scopes a parameter grant too broadly: %q", forbidden)
		}
	}

	// Decryption is the one wildcard resource in the root, and only because the
	// key is AWS-managed: its ARN is not resolved here, so the two pins below —
	// the via-service condition and the action list — are what scope the grant.
	decrypt := policyStatement(t, document, `"kms:Decrypt"`)
	if !regexp.MustCompile(`(?m)^\s*resources\s*=\s*\[\s*"\*"\s*\]`).MatchString(decrypt) {
		t.Fatalf("the kms:Decrypt statement is not the wildcard resource the via-service condition scopes:\n%s", decrypt)
	}
	if !strings.Contains(decrypt, `variable = "kms:ViaService"`) ||
		!strings.Contains(decrypt, `values   = ["ssm.ap-south-1.amazonaws.com"]`) {
		t.Fatalf("the kms:Decrypt statement does not pin the grant to the SSM service:\n%s", decrypt)
	}
	// The action lists are read as action lists, so a condition key such as
	// kms:ViaService is not mistaken for a grant. Any wildcard action would defeat
	// both pins, and Decrypt is the only kms action allowed.
	lists := regexp.MustCompile(`(?m)actions\s+=\s+\[([^\]]*)\]`).FindAllStringSubmatch(document, -1)
	if len(lists) == 0 {
		t.Fatal("main.tf has no action list at all")
	}
	for _, list := range lists {
		for _, action := range regexp.MustCompile(`"[^"]+"`).FindAllString(list[1], -1) {
			if strings.Contains(action, "*") {
				t.Fatalf("main.tf grants the wildcard action %s", action)
			}
			if strings.HasPrefix(action, `"kms:`) && action != `"kms:Decrypt"` {
				t.Fatalf("main.tf grants %s; the only kms action may be Decrypt", action)
			}
		}
	}
	// The key is AWS-managed: no key resource, no alias lookup, no key policy, and
	// nothing account- or fleet-owned to create before a plan.
	for _, forbidden := range []string{
		`data "aws_kms_alias"`,
		`resource "aws_kms_key"`,
		`resource "aws_kms_alias"`,
		`"kms:CreateKey"`,
		`"kms:CreateAlias"`,
		`"kms:PutKeyPolicy"`,
		"target_key_arn",
	} {
		if strings.Contains(document, forbidden) {
			t.Fatalf("main.tf still depends on fleet-owned key machinery: %q", forbidden)
		}
	}

	// The only KMS alias the shipped root names is the AWS-managed SSM key, so
	// there is no fleet alias for an operator to create or point.
	for _, alias := range regexp.MustCompile(`alias/[A-Za-z0-9_/-]+`).FindAllString(document, -1) {
		if alias != ssm.DefaultKMSKeyID {
			t.Fatalf("main.tf names the key alias %q; the only key is the aws-managed one", alias)
		}
	}

	// The policy is attached to the host role itself, and the instance waits for
	// it, so no host ever boots without the grant.
	if !strings.Contains(document, `resource "aws_iam_role_policy" "host_enroll"`) ||
		!strings.Contains(document, `role     = aws_iam_role.host.id`) {
		t.Fatal("main.tf does not attach the enrollment policy to the host role")
	}
	if !strings.Contains(document, "aws_iam_role_policy.host_enroll,") {
		t.Fatal("the instance does not depend on the enrollment policy")
	}
}

// TestRootPrefixMatchesTheApprovedStorePath binds the Terraform default to the Go
// constants: the instance role is scoped to `<prefix>/<host_name>/*`, so a drift
// between the two would either break every enrollment or widen the grant.
func TestRootPrefixMatchesTheApprovedStorePath(t *testing.T) {
	t.Parallel()
	variables := readFile(t, shippedVariablesTF)
	if !strings.Contains(variables, `variable "enrollment_parameter_prefix"`) {
		t.Fatal("variables.tf declares no enrollment_parameter_prefix")
	}
	if !strings.Contains(variables, `default  = "`+ssm.DefaultParameterPrefix+`"`) {
		t.Fatalf("variables.tf default does not match the approved prefix %q", ssm.DefaultParameterPrefix)
	}
	if ssm.DefaultParameterPrefix != domain.ApprovedEnrollmentParameterPrefix {
		t.Fatalf("the adapter default %q is not the approved %q",
			ssm.DefaultParameterPrefix, domain.ApprovedEnrollmentParameterPrefix)
	}
	if ssm.DefaultKMSKeyID != domain.ApprovedEnrollmentKMSKeyID {
		t.Fatalf("the adapter key %q is not the approved %q", ssm.DefaultKMSKeyID, domain.ApprovedEnrollmentKMSKeyID)
	}
	if ssm.DefaultKMSKeyID != "alias/aws/ssm" {
		t.Fatalf("the approved key %q is not the aws-managed ssm key", domain.ApprovedEnrollmentKMSKeyID)
	}
	if ssm.DefaultRegion != domain.ApprovedAWSRegion {
		t.Fatalf("the adapter region %q is not the approved %q", ssm.DefaultRegion, domain.ApprovedAWSRegion)
	}
}

// TestRootStillHasNoSSHIngressDependency proves enrollment was not quietly given
// an SSH path back: the CIDR variable stays empty by default and the root emits no
// ingress rule unless one is set.
func TestRootStillHasNoSSHIngressDependency(t *testing.T) {
	t.Parallel()
	variables := readFile(t, shippedVariablesTF)
	if !strings.Contains(variables, "variable \"bootstrap_ssh_cidr\"") {
		t.Fatal("variables.tf no longer declares bootstrap_ssh_cidr")
	}
	if !strings.Contains(variables, "default  = \"\"") {
		t.Fatal("bootstrap_ssh_cidr must stay empty by default: enrollment needs no SSH ingress")
	}
	document := readFile(t, shippedMainTF)
	if !strings.Contains(document, "dynamic \"ingress\"") {
		t.Fatal("the security group no longer conditions its ingress on the approved CIDR")
	}
	// Nothing in the root refreshes or installs anything on port 22 for the worker:
	// no SSH key path reaches the enrollment script.
	if strings.Contains(document, "ssm send-command") || strings.Contains(document, "ssh -i") {
		t.Fatal("main.tf contains an enrollment transport; the transport belongs to the worker")
	}
}

// policyStatement returns the enrollment policy statement that names one action,
// so a resource or condition assertion cannot be satisfied by a different
// statement in the same document.
func policyStatement(t *testing.T, document, action string) string {
	t.Helper()
	start := strings.Index(document, `data "aws_iam_policy_document" "host_enroll"`)
	if start < 0 {
		t.Fatal("main.tf has no host_enroll policy document")
	}
	for _, block := range strings.Split(document[start:], "\n  statement {") {
		if strings.Contains(block, action) {
			return block
		}
	}
	t.Fatalf("the host_enroll policy has no statement granting %s", action)
	return ""
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}
