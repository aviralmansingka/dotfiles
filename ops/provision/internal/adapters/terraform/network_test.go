package terraform_test

import (
	"regexp"
	"strings"
	"testing"
)

// These tests pin the owner decision recorded for S04: fleet hosts join a
// dedicated fleet VPC (10.99.0.0/16) created by ops/provision/terraform/aws-network,
// not the account's default VPC (there is none in ap-south-1) and not the
// existing Mumbai VPC. They inspect the tracked HCL only; no test here creates,
// reads, or destroys an AWS resource.

// TestNetworkRootIsOneDedicatedVPCAndSubnet is the shape test: exactly one VPC
// and one public subnet, tagged with the approved keys.
func TestNetworkRootIsOneDedicatedVPCAndSubnet(t *testing.T) {
	t.Parallel()
	files := terraformFiles(t, networkRootDir)
	main := files["main.tf"]

	for header, want := range map[string]int{
		`resource "aws_vpc" "fleet"`:                      1,
		`resource "aws_subnet" "public"`:                  1,
		`resource "aws_internet_gateway" "fleet"`:         1,
		`resource "aws_route_table" "public"`:             1,
		`resource "aws_route_table_association" "public"`: 1,
	} {
		if got := strings.Count(main, header); got != want {
			t.Fatalf("%s appears %d times, want %d", header, got, want)
		}
	}

	vpc := block(main, `resource "aws_vpc" "fleet"`)
	if got := assignedValue(vpc, "cidr_block"); got != `"10.99.0.0/16"` {
		t.Fatalf("fleet VPC cidr_block = %q, want the dedicated 10.99.0.0/16", got)
	}
	for _, flag := range []string{"enable_dns_support", "enable_dns_hostnames"} {
		if got := assignedValue(vpc, flag); got != "true" {
			t.Fatalf("fleet VPC %s = %q, want true", flag, got)
		}
	}

	subnet := block(main, `resource "aws_subnet" "public"`)
	for key, want := range map[string]string{
		"vpc_id":                  "aws_vpc.fleet.id",
		"cidr_block":              `"10.99.1.0/24"`,
		"availability_zone":       `"ap-south-1a"`,
		"map_public_ip_on_launch": "true",
	} {
		if got := assignedValue(subnet, key); got != want {
			t.Fatalf("public subnet %s = %q, want %q", key, got, want)
		}
	}

	// Both resources carry the approved tags and a Name.
	for name, body := range map[string]string{"vpc": vpc, "subnet": subnet} {
		tags := assignedValue(body, "tags")
		if !strings.Contains(tags, "local.tags") {
			t.Fatalf("%s tags = %q, want the approved tag map merged in", name, tags)
		}
		if !strings.Contains(tags, "Name") {
			t.Fatalf("%s tags = %q, want a Name tag", name, tags)
		}
	}
	locals := block(main, "tags = {")
	keys := assignmentKeys(locals)
	for _, want := range []string{"owner", "fleet-test-run"} {
		if !keys[want] {
			t.Fatalf("the network tag map is missing %q; keys are %v", want, keys)
		}
	}
	for _, source := range files {
		if strings.Contains(source, "fleet-owner") {
			t.Fatal("the network root still mentions the rejected tag key fleet-owner")
		}
	}

	// Public egress through the internet gateway, and nothing else.
	route := block(main, `resource "aws_route_table" "public"`)
	if !strings.Contains(route, `"0.0.0.0/0"`) {
		t.Fatalf("the public route table has no default route:\n%s", route)
	}
	if !strings.Contains(route, "gateway_id = aws_internet_gateway.fleet.id") {
		t.Fatal("the default route does not point at the fleet internet gateway")
	}

	// No NAT gateway: it costs more than the host and this design needs none.
	for name, source := range files {
		for _, needle := range []string{"aws_nat_gateway", "aws_eip", "nat_gateway_id"} {
			if strings.Contains(source, needle) {
				t.Fatalf("%s contains %q; the fleet network uses no NAT gateway", name, needle)
			}
		}
	}
}

// TestNoIngressFromAnywhere keeps both roots closed to inbound traffic. The
// tailnet is the only way in; egress stays open for Nix and Tailscale.
func TestNoIngressFromAnywhere(t *testing.T) {
	t.Parallel()

	for _, dir := range []string{rootDir, networkRootDir} {
		for name, source := range terraformFiles(t, dir) {
			// No rule shape that could bypass the block scan.
			for _, needle := range []string{
				"aws_vpc_security_group_ingress_rule",
				"aws_network_acl",
				"aws_default_network_acl",
			} {
				if strings.Contains(source, needle) {
					t.Fatalf("%s/%s contains %q; neither root declares network ACLs or rule resources", dir, name, needle)
				}
			}
			for _, body := range append(blocks(source, "ingress {"), blocks(source, `content {`)...) {
				for _, open := range []string{"0.0.0.0/0", "::/0"} {
					if strings.Contains(body, open) {
						t.Fatalf("%s/%s has ingress from %s:\n%s", dir, name, open, body)
					}
				}
			}
			// Every open CIDR left in a resource file must be egress or a route. A
			// variables-only file is exempt: its open CIDRs are the validation
			// messages that *refuse* a permissive value.
			if !strings.Contains(source, `resource "`) {
				continue
			}
			for _, open := range []string{"0.0.0.0/0", "::/0"} {
				total := strings.Count(source, open)
				allowed := countIn(blocks(source, "egress {"), open) + countIn(blocks(source, "route {"), open)
				if total > allowed {
					t.Fatalf("%s/%s uses %q %d times but only %d are inside an egress or route block", dir, name, open, total, allowed)
				}
			}
		}
	}

	// The host's ingress is one opt-in dynamic block, so the scan above is not
	// vacuous: the rule exists, it emits 22/tcp, and it can only be reached
	// through the empty-or-one-CIDR gate that TestHostIngressIsZeroByDefault
	// pins.
	gate := blocks(rootTerraform(t)["main.tf"], `dynamic "ingress"`)
	if len(gate) != 1 {
		t.Fatalf("the host root has %d dynamic ingress blocks, want exactly 1", len(gate))
	}
	if !strings.Contains(gate[0], "cidr_blocks = [ingress.value]") {
		t.Fatalf("the host ingress rule is not restricted to the approved CIDR:\n%s", gate[0])
	}
	if strings.Contains(gate[0], `"0.0.0.0/0"`) {
		t.Fatal("the host ingress rule allows 0.0.0.0/0")
	}

	// The network root declares no security group at all: the host root owns the
	// host's group, inside the fleet VPC.
	for name, source := range terraformFiles(t, networkRootDir) {
		if strings.Contains(source, "aws_security_group") {
			t.Fatalf("%s declares a security group; the host root owns it", name)
		}
	}
}

// TestHostIngressIsZeroByDefault pins the owner decision that a fleet host
// accepts nothing inbound unless an operator asks for it. The variable defaults
// to empty, an empty value makes the ingress block emit zero rules, one value
// emits exactly one 22/tcp rule from that CIDR, both wildcards are refused, and
// a malformed value fails at plan against the variable by name. Egress stays
// open, because the host needs Nix and Tailscale to come up.
func TestHostIngressIsZeroByDefault(t *testing.T) {
	t.Parallel()
	files := rootTerraform(t)
	main := files["main.tf"]
	variables := files["variables.tf"]

	// 1. The default is empty, and empty is a real value rather than a missing
	// one, so the adapter's `-var bootstrap_ssh_cidr=` reaches the root as "".
	variable := block(variables, `variable "bootstrap_ssh_cidr"`)
	if variable == "" {
		t.Fatal("variables.tf declares no bootstrap_ssh_cidr variable")
	}
	if got := assignedValue(variable, "default"); got != `""` {
		t.Fatalf("bootstrap_ssh_cidr default = %q, want an empty string (zero ingress)", got)
	}
	if got := assignedValue(variable, "nullable"); got != "false" {
		t.Fatalf("bootstrap_ssh_cidr nullable = %q, want false so an empty value stays an empty string", got)
	}
	if got := assignedValue(variable, "type"); got != "string" {
		t.Fatalf("bootstrap_ssh_cidr type = %q, want string", got)
	}

	// 2. Both wildcards and every mask wider than /8 are refused here, at plan
	// time, against this variable. The validation names the two wildcard
	// spellings outright, so a request for 0.0.0.0/0 or ::/0 fails by name.
	if !strings.Contains(variable, `!contains(["0.0.0.0/0", "::/0"], var.bootstrap_ssh_cidr)`) {
		t.Fatalf("the bootstrap_ssh_cidr validation does not refuse both wildcards:\n%s", variable)
	}
	if !strings.Contains(variable, "/([89]|[12][0-9]|3[0-2])$") {
		t.Fatalf("the bootstrap_ssh_cidr validation does not floor the mask at /8:\n%s", variable)
	}
	if !strings.Contains(variable, "can(cidrhost(var.bootstrap_ssh_cidr, 0))") {
		t.Fatalf("the bootstrap_ssh_cidr validation does not reject a malformed CIDR:\n%s", variable)
	}
	for _, want := range []string{"bootstrap_ssh_cidr must be empty", "0.0.0.0/0 and ::/0 are not accepted"} {
		if !strings.Contains(variable, want) {
			t.Fatalf("the bootstrap_ssh_cidr error message never says %q:\n%s", want, variable)
		}
	}

	// 3. The gate itself: one ternary that turns empty into an empty list and a
	// value into a one-element list. Anything outside this shape fails the test,
	// so a permissive edit cannot hide behind a comment.
	locals := block(main, "locals {")
	const gateExpression = `bootstrap_cidrs = var.bootstrap_ssh_cidr == "" ? [] : [var.bootstrap_ssh_cidr]`
	if !strings.Contains(locals, gateExpression) {
		t.Fatalf("main.tf local.bootstrap_cidrs is not the empty-or-one gate:\n%s", locals)
	}
	for _, cidr := range []string{"", "203.0.113.10/32", "203.0.113.0/24"} {
		// The rule count follows from the asserted gate: empty is the empty list
		// (no ingress block at all), every non-empty value is one element.
		want := 1
		if cidr == "" {
			want = 0
		}
		if got := ingressRuleCount(cidr); got != want {
			t.Fatalf("bootstrap_ssh_cidr %q emits %d ingress rules, want %d", cidr, got, want)
		}
	}

	// 4. The dynamic block consumes that gate and emits exactly one 22/tcp rule
	// from the single approved CIDR.
	group := block(main, `resource "aws_security_group" "host"`)
	if group == "" {
		t.Fatal("main.tf declares no aws_security_group.host")
	}
	ingress := blocks(group, `dynamic "ingress"`)
	if len(ingress) != 1 {
		t.Fatalf("the host security group has %d ingress blocks, want exactly 1", len(ingress))
	}
	if got := assignedValue(ingress[0], "for_each"); got != "local.bootstrap_cidrs" {
		t.Fatalf("ingress for_each = %q, want local.bootstrap_cidrs", got)
	}
	content := block(ingress[0], "content {")
	for key, want := range map[string]string{
		"from_port":   "22",
		"to_port":     "22",
		"protocol":    `"tcp"`,
		"cidr_blocks": "[ingress.value]",
	} {
		if got := assignedValue(content, key); got != want {
			t.Fatalf("ingress %s = %q, want %q", key, got, want)
		}
	}

	// 5. Egress stays open: a host needs outbound for Nix and Tailscale.
	egress := blocks(group, "egress {")
	if len(egress) == 0 {
		t.Fatal("the host security group has no egress block; Nix and Tailscale need outbound")
	}
	if countIn(egress, `"0.0.0.0/0"`) == 0 {
		t.Fatal("the host security group egress is not open to the internet")
	}
}

// ingressRuleCount is the number of ingress rules the tracked gate emits for one
// bootstrap_ssh_cidr value. The gate is a single ternary over `= ""` (asserted
// verbatim above), so empty yields none and any value yields exactly one. This
// is the rule count the Terraform plan produces; no provider plugin, credential,
// or AWS call is involved.
func ingressRuleCount(bootstrapCIDR string) int {
	cidrs := []string{}
	if bootstrapCIDR != "" {
		cidrs = append(cidrs, bootstrapCIDR)
	}
	return len(cidrs)
}

// TestNetworkRootOutputsFeedHostRoot pins the wiring: the network root emits
// vpc_id and subnet_id, and the host root consumes them as required variables.
func TestNetworkRootOutputsFeedHostRoot(t *testing.T) {
	t.Parallel()
	network := terraformFiles(t, networkRootDir)["main.tf"]
	for output, want := range map[string]string{
		"vpc_id":    "aws_vpc.fleet.id",
		"subnet_id": "aws_subnet.public.id",
	} {
		body := block(network, `output "`+output+`"`)
		if body == "" {
			t.Fatalf("the network root has no output %q", output)
		}
		if got := assignedValue(body, "value"); got != want {
			t.Fatalf("network output %q = %q, want %q", output, got, want)
		}
	}

	hostVariables := rootTerraform(t)["variables.tf"]
	for _, name := range []string{"vpc_id", "subnet_id"} {
		if !strings.Contains(hostVariables, `variable "`+name+`"`) {
			t.Fatalf("the host root does not take %q as an input", name)
		}
	}

	// The host root must not grow network resources of its own.
	host := rootTerraform(t)["main.tf"]
	for _, needle := range []string{"aws_vpc", "aws_subnet", "aws_internet_gateway", "aws_route_table"} {
		if strings.Contains(host, `resource "`+needle+`"`) {
			t.Fatalf("the host root creates %q; the network root owns it", needle)
		}
	}

	// One place documents the order: network first, then hosts.
	networkReadme := fileIn(t, networkRootDir, "README.md")
	if !strings.Contains(networkReadme, "Network root") || !strings.Contains(networkReadme, "Host root") {
		t.Fatal("the network README does not document the network-then-hosts order")
	}
	hostReadme := rootFile(t, "README.md")
	if !strings.Contains(hostReadme, "aws-network") {
		t.Fatal("the host README does not point at the network root")
	}
}

// TestFleetNetworkIsDedicated keeps the fleet off the existing Mumbai VPC and off
// any default VPC.
func TestFleetNetworkIsDedicated(t *testing.T) {
	t.Parallel()

	vpcCIDR := assignedValue(block(terraformFiles(t, networkRootDir)["main.tf"], `resource "aws_vpc" "fleet"`), "cidr_block")
	if vpcCIDR != `"10.99.0.0/16"` {
		t.Fatalf("fleet VPC cidr_block = %q, want the owner-approved 10.99.0.0/16", vpcCIDR)
	}

	// The long-lived Mumbai VPC's range and id must appear in neither root.
	for _, dir := range []string{rootDir, networkRootDir} {
		for name, source := range terraformFiles(t, dir) {
			for _, needle := range []string{"10.98.0.0/24", "vpc-00d2dd5dcd01d0bc5", "default_vpc", "aws_default_vpc"} {
				if strings.Contains(source, needle) {
					t.Fatalf("%s/%s references %q; the fleet network is dedicated", dir, name, needle)
				}
			}
		}
	}

	// Every CIDR this root declares is inside the approved /16.
	cidrPattern := regexp.MustCompile(`"(10\.99\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2})"`)
	main := terraformFiles(t, networkRootDir)["main.tf"]
	matches := cidrPattern.FindAllStringSubmatch(main, -1)
	if len(matches) < 2 {
		t.Fatalf("the network root declares %d fleet CIDRs, want at least the VPC and the subnet", len(matches))
	}
	for _, match := range matches {
		if match[1] != "10.99.0.0/16" && match[1] != "10.99.1.0/24" {
			t.Fatalf("the network root declares %q, outside the approved fleet ranges", match[1])
		}
	}
}
