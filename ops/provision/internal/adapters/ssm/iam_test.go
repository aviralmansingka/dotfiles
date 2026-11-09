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
// decrypt with exactly the one fleet key. A wildcard resource, a second action, or
// a grant that is not scoped by host name would let one host read another host's
// key, which is the whole risk of a shared store.
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

	// No resource is a bare wildcard, and no parameter ARN is broader than the
	// host's own prefix.
	if regexp.MustCompile(`(?m)^\s*resources\s*=\s*\[\s*"\*"\s*\]`).MatchString(document) {
		t.Fatal("main.tf grants a wildcard resource")
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

	// Decryption is limited to the one fleet key, resolved by alias, and only when
	// SSM is the calling service.
	if !strings.Contains(document, "resources = [data.aws_kms_alias.enroll.target_key_arn]") {
		t.Fatal("main.tf does not scope kms:Decrypt to the one fleet key ARN")
	}
	if !strings.Contains(document, `variable = "kms:ViaService"`) ||
		!strings.Contains(document, `values   = ["ssm.ap-south-1.amazonaws.com"]`) {
		t.Fatal("main.tf does not scope kms:Decrypt to the SSM service")
	}
	if !strings.Contains(document, `name     = "`+ssm.DefaultKMSKeyID+`"`) {
		t.Fatalf("main.tf does not resolve the approved KMS alias %q", ssm.DefaultKMSKeyID)
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

func readFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}
