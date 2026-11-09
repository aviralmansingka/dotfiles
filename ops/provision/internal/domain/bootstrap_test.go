package domain_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// TestValidateBootstrapCIDRIsOptIn pins the owner decision that zero ingress is
// the default: an empty value is valid and means "no SSH ingress rule at all",
// one concrete network is valid (the host root then emits exactly one 22/tcp
// rule), and nothing permissive, malformed, or IPv6 can be expressed.
func TestValidateBootstrapCIDRIsOptIn(t *testing.T) {
	t.Parallel()

	valid := []string{
		"",                // the zero-ingress default: no rule is emitted
		"203.0.113.10/32", // exactly one host
		"203.0.113.0/24",  // the documentation-range example
		"10.0.0.0/8",      // the widest value the policy allows
		"198.51.100.7/32", // a second /32, so /32 is not special-cased
		"192.0.2.128/25",  // a non-trivial prefix inside a documentation range
	}
	for _, cidr := range valid {
		cidr := cidr
		t.Run("valid:"+cidr, func(t *testing.T) {
			t.Parallel()
			if err := domain.ValidateBootstrapCIDR(cidr); err != nil {
				t.Fatalf("ValidateBootstrapCIDR(%q) = %v, want nil", cidr, err)
			}
		})
	}

	invalid := []string{
		"0.0.0.0/0",       // the IPv4 default route
		"::/0",            // the IPv6 default route
		"0.0.0.0/7",       // wider than /8
		"10.0.0.0/1",      // wider than /8
		"2001:db8::/64",   // not IPv4
		"203.0.113.10/33", // not a valid mask
		"203.0.113.10",    // no prefix length
		"not-a-cidr",      // not a network at all
		"203.0.113.0/24 ", // trailing whitespace is not a CIDR
	}
	for _, cidr := range invalid {
		cidr := cidr
		t.Run("invalid:"+cidr, func(t *testing.T) {
			t.Parallel()
			err := domain.ValidateBootstrapCIDR(cidr)
			if err == nil {
				t.Fatalf("ValidateBootstrapCIDR(%q) = nil, want an error", cidr)
			}
			// The error names the value the operator has to fix, so a plan-time
			// failure points at the bootstrap source and not at a generic field.
			var validation *domain.ValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("ValidateBootstrapCIDR(%q) = %T, want *domain.ValidationError", cidr, err)
			}
			if validation.Field != "bootstrap_ssh_cidr" {
				t.Fatalf("ValidateBootstrapCIDR(%q) field = %q, want bootstrap_ssh_cidr", cidr, validation.Field)
			}
			if !strings.Contains(err.Error(), "bootstrap_ssh_cidr") {
				t.Fatalf("ValidateBootstrapCIDR(%q) error = %q, want it to name the field", cidr, err)
			}
		})
	}
}
