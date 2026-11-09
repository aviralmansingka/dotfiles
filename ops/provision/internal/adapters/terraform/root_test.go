package terraform_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/terraform"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// These tests are the offline regression suite for the live S04 smoke failure
// (`VPCIdNotSpecified: No default VPC for this user` in ap-south-1) and its two
// smaller findings, the `fleet-owner` tag key and the doubled `fleet-fleet-`
// name prefix. They inspect the tracked Terraform root and the adapter's
// argument construction. No test here needs an AWS account, a credential, or a
// Terraform binary.

// rootDir is the tracked per-host root, relative to this package's directory.
var rootDir = filepath.Join("..", "..", "..", "terraform", "aws")

// networkRootDir is the tracked dedicated fleet network root, created once
// before any host.
var networkRootDir = filepath.Join("..", "..", "..", "terraform", "aws-network")

// fileIn reads one tracked file of a root, refusing to guess if it is missing.
func fileIn(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}

// rootFile reads one tracked file of the host root.
func rootFile(t *testing.T, name string) string {
	t.Helper()
	return fileIn(t, rootDir, name)
}

// terraformFiles is every tracked .tf file of one root, with comment-only lines
// removed so an explanation of a defect cannot satisfy (or trip) a scan.
func terraformFiles(t *testing.T, dir string) map[string]string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	files := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".tf") {
			continue
		}
		var kept []string
		for _, line := range strings.Split(fileIn(t, dir, entry.Name()), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "#") {
				continue
			}
			kept = append(kept, line)
		}
		files[entry.Name()] = strings.Join(kept, "\n")
	}
	if len(files) == 0 {
		t.Fatalf("no .tf file in %s", dir)
	}
	return files
}

// rootTerraform is every tracked .tf file of the host root.
func rootTerraform(t *testing.T) map[string]string {
	t.Helper()
	return terraformFiles(t, rootDir)
}

// blocks returns the body of every block whose header line contains header, in
// file order.
func blocks(source, header string) []string {
	var found []string
	for offset := 0; offset < len(source); {
		index := strings.Index(source[offset:], header)
		if index < 0 {
			return found
		}
		start := offset + index
		body, ok := findBlock(source[start:], header)
		if !ok {
			return found
		}
		found = append(found, body)
		offset = start + len(header)
	}
	return found
}

// countIn sums the occurrences of needle across block bodies.
func countIn(bodies []string, needle string) int {
	total := 0
	for _, body := range bodies {
		total += strings.Count(body, needle)
	}
	return total
}

// findBlock returns the body of the HCL block whose header line contains
// header. It matches braces, so a nested block comes back with its contents. An
// empty body ("{}") is a found block with no attributes, which is why presence
// is reported separately.
func findBlock(source, header string) (string, bool) {
	index := strings.Index(source, header)
	if index < 0 {
		return "", false
	}
	open := strings.Index(source[index:], "{")
	if open < 0 {
		return "", false
	}
	depth := 0
	for i := index + open; i < len(source); i++ {
		switch source[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return source[index+open+1 : i], true
			}
		}
	}
	return "", false
}

// block returns the body of the named block, or "" when it is absent.
func block(source, header string) string {
	body, _ := findBlock(source, header)
	return body
}

// assignmentKeys lists the attribute names assigned inside a block body, with
// quotes and alignment whitespace removed.
func assignmentKeys(body string) map[string]bool {
	keys := map[string]bool{}
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.ContainsAny(strings.SplitN(trimmed, "=", 2)[0], "{[") {
			continue
		}
		name, _, found := strings.Cut(trimmed, "=")
		if !found {
			continue
		}
		keys[strings.Trim(strings.TrimSpace(name), `"`)] = true
	}
	return keys
}

// assignedValue returns the right-hand side of `key = ...` inside a block body,
// with surrounding whitespace removed.
func assignedValue(body, key string) string {
	for _, line := range strings.Split(body, "\n") {
		name, value, found := strings.Cut(strings.TrimSpace(line), "=")
		if !found || strings.Trim(strings.TrimSpace(name), `"`) != key {
			continue
		}
		return strings.TrimSpace(value)
	}
	return ""
}

// networkConfig is the minimum AWSConfig the network tests need: a throwaway
// template root, a .pub key file, and the approved offline catalog.
func networkConfig(t *testing.T) terraform.AWSConfig {
	t.Helper()
	templateRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(templateRoot, "main.tf"), []byte("output \"instance_id\" { value = \"i-1\" }\n"), 0o600); err != nil {
		t.Fatalf("write template: %v", err)
	}
	keyFile := filepath.Join(t.TempDir(), "bootstrap.pub")
	if err := os.WriteFile(keyFile, []byte(testPublicKey+"\n"), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	return terraform.AWSConfig{
		Profiles:         testCatalog(t),
		Dir:              templateRoot,
		RunDir:           filepath.Join(t.TempDir(), "runs"),
		SSHPublicKeyFile: keyFile,
		BootstrapCIDR:    "203.0.113.0/24",
		StateBucket:      "fleet-state-bucket",
		StateRegion:      "us-east-1",
		VPCID:            testVPCID,
		SubnetID:         testSubnetID,
		OwnerTag:         "homelab",
		TestRunTag:       "s04-offline",
		Timeout:          5 * time.Second,
	}
}

// TestRootRequiresExplicitNetworkInputs is the regression test for
// `VPCIdNotSpecified`. The root must declare vpc_id and subnet_id as required
// input (no default, a validation that names the variable) and must bind the
// security group and the instance to them.
func TestRootRequiresExplicitNetworkInputs(t *testing.T) {
	t.Parallel()
	files := rootTerraform(t)
	variables := files["variables.tf"]
	main := files["main.tf"]

	for _, name := range []string{"vpc_id", "subnet_id"} {
		body := block(variables, `variable "`+name+`"`)
		if body == "" {
			t.Fatalf("variables.tf declares no variable %q", name)
		}
		if assignmentKeys(body)["default"] {
			t.Fatalf("variable %q has a default; it must be required input with no fallback", name)
		}
		validation := block(body, "validation")
		if validation == "" {
			t.Fatalf("variable %q has no validation, so an empty value would reach AWS", name)
		}
		if !strings.Contains(validation, name) {
			t.Fatalf("variable %q validation does not name the variable in its error message", name)
		}
	}

	securityGroup := block(main, `resource "aws_security_group" "host"`)
	if securityGroup == "" {
		t.Fatal("main.tf has no aws_security_group.host resource")
	}
	if got := assignedValue(securityGroup, "vpc_id"); got != "var.vpc_id" {
		t.Fatalf("security group vpc_id = %q, want var.vpc_id", got)
	}

	instance := block(main, `resource "aws_instance" "host"`)
	if instance == "" {
		t.Fatal("main.tf has no aws_instance.host resource")
	}
	if got := assignedValue(instance, "subnet_id"); got != "var.subnet_id" {
		t.Fatalf("instance subnet_id = %q, want var.subnet_id", got)
	}
	if got := assignedValue(instance, "vpc_security_group_ids"); got != "[aws_security_group.host.id]" {
		t.Fatalf("instance vpc_security_group_ids = %q, want the host security group id", got)
	}
}

// TestRootHasNoDefaultVPCReference keeps the implicit-default-VPC dependency
// from coming back: no default VPC resource, no VPC or subnet discovery, and no
// `"default"` network value anywhere in the root.
func TestRootHasNoDefaultVPCReference(t *testing.T) {
	t.Parallel()
	forbidden := []string{
		"aws_default_vpc",
		"aws_default_subnet",
		"data \"aws_vpc\"",
		"data \"aws_subnets\"",
		"data \"aws_subnet\"",
		"default = true",
		"default_vpc",
		`vpc_id = "default"`,
		`subnet_id = "default"`,
	}
	for name, source := range rootTerraform(t) {
		for _, needle := range forbidden {
			if strings.Contains(source, needle) {
				t.Fatalf("%s contains %q: the root must take the network as explicit input", name, needle)
			}
		}
	}
}

// TestAdapterRequiresExplicitNetwork is the behavioural half: an unset or
// malformed network stops the adapter at construction with an error that names
// the missing variable, so no host is ever planned without one.
func TestAdapterRequiresExplicitNetwork(t *testing.T) {
	t.Parallel()
	cases := map[string]struct {
		mutate func(*terraform.AWSConfig)
		want   string
	}{
		"empty vpc_id":        {func(c *terraform.AWSConfig) { c.VPCID = "" }, "vpc_id"},
		"empty subnet_id":     {func(c *terraform.AWSConfig) { c.SubnetID = "" }, "subnet_id"},
		"blank vpc_id":        {func(c *terraform.AWSConfig) { c.VPCID = "   " }, "vpc_id"},
		"malformed vpc_id":    {func(c *terraform.AWSConfig) { c.VPCID = "default" }, "vpc_id"},
		"malformed subnet_id": {func(c *terraform.AWSConfig) { c.SubnetID = "subnet-not-hex" }, "subnet_id"},
	}
	for name, testCase := range cases {
		testCase := testCase
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			cfg := networkConfig(t)
			testCase.mutate(&cfg)
			provider, err := terraform.NewAWS(cfg)
			if err == nil {
				t.Fatalf("NewAWS accepted %s", name)
			}
			if provider != nil {
				t.Fatalf("NewAWS returned a provider for %s", name)
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("error = %v, want it to name %q", err, testCase.want)
			}
			if !strings.Contains(err.Error(), "required") && !strings.Contains(err.Error(), "not a") {
				t.Fatalf("error = %v, want a clear required-or-malformed message", err)
			}
		})
	}
}

// TestApplyPassesExplicitNetwork proves the configured network reaches Terraform
// as its own -var arguments on both apply and destroy, and that no argument
// carries a default network value.
func TestApplyPassesExplicitNetwork(t *testing.T) {
	t.Parallel()
	provider, runner, _ := offlineProvider(t)

	if _, err := provider.CreateHost(context.Background(), createRequest("rex-20")); err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	if err := provider.DestroyHost(context.Background(), destroyRequest("rex-20", "i-rex-20")); err != nil {
		t.Fatalf("DestroyHost: %v", err)
	}

	for _, step := range []string{"apply", "destroy"} {
		call := runner.call(t, step, 0)
		if got := argValue(call.Args, "-var", "vpc_id"); got != testVPCID {
			t.Fatalf("%s vpc_id = %q, want %q", step, got, testVPCID)
		}
		if got := argValue(call.Args, "-var", "subnet_id"); got != testSubnetID {
			t.Fatalf("%s subnet_id = %q, want %q", step, got, testSubnetID)
		}
		for _, arg := range call.Args {
			if strings.HasSuffix(arg, "=default") || arg == "default" {
				t.Fatalf("%s argv falls back to a default network: %q", step, arg)
			}
		}
	}
}

// TestRootTagPolicy pins the approved tag keys: `owner` and `fleet-test-run`,
// never `fleet-owner`, in the root and in the adapter's variable construction.
func TestRootTagPolicy(t *testing.T) {
	t.Parallel()

	tags := block(rootTerraform(t)["main.tf"], "tags = {")
	if tags == "" {
		t.Fatal("main.tf has no local tags map")
	}
	keys := assignmentKeys(tags)
	for _, want := range []string{"Name", "ManagedBy", "owner", "fleet-test-run"} {
		if !keys[want] {
			t.Fatalf("the tag map is missing %q; keys are %v", want, keys)
		}
	}
	for name, source := range rootTerraform(t) {
		if strings.Contains(source, "fleet-owner") {
			t.Fatalf("%s still mentions the rejected tag key fleet-owner", name)
		}
	}

	// The adapter must not reintroduce it as a Terraform variable either: the
	// root's variable is `owner`, and the value comes from the catalog.
	cfg := networkConfig(t)
	cfg.OwnerTag = "aviral"
	runner := newFake()
	cfg.Runner = runner
	provider, err := terraform.NewAWS(cfg)
	if err != nil {
		t.Fatalf("NewAWS: %v", err)
	}
	req := createRequest("rex-21")
	// No request tags: the catalog's owner value is the one the adapter uses.
	req.Tags = nil
	if _, err := provider.CreateHost(context.Background(), req); err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	args := runner.call(t, "apply", 0).Args
	if got := argValue(args, "-var", "owner"); got != "aviral" {
		t.Fatalf("owner var = %q, want aviral", got)
	}
	for _, arg := range args {
		if strings.Contains(arg, "fleet-owner") || strings.Contains(arg, "fleet_owner") {
			t.Fatalf("adapter argv still carries the rejected tag key: %q", arg)
		}
	}
	if got := argValue(args, "-var", "test_run"); got != "s04-offline" {
		t.Fatalf("test_run var = %q, want s04-offline", got)
	}
}

// TestResourceNameAppliesPrefixOnce is the double-prefix regression: a host name
// that already starts with the project prefix keeps exactly one.
func TestResourceNameAppliesPrefixOnce(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"rex-01":          "fleet-rex-01",
		"fleet-sm-28e571": "fleet-sm-28e571",
		"fleet-rex":       "fleet-rex",
		"fleet":           "fleet-fleet",
		"fleet-fleet":     "fleet-fleet",
		"fleet-fleet-x":   "fleet-fleet-x",
	}
	for hostName, want := range cases {
		if got := terraform.ResourceName(hostName); got != want {
			t.Fatalf("ResourceName(%q) = %q, want %q", hostName, got, want)
		}
	}
	for _, hostName := range []string{"rex-01", "fleet-sm-28e571"} {
		name := terraform.ResourceName(hostName)
		if len(name) > terraform.MaxResourceNameLen {
			t.Fatalf("ResourceName(%q) = %q is %d characters, over the %d budget", hostName, name, len(name), terraform.MaxResourceNameLen)
		}
		if strings.Contains(name, "fleet-fleet-") {
			t.Fatalf("ResourceName(%q) = %q doubles the prefix", hostName, name)
		}
	}

	// Both sides must agree on the rule, so the root's local has to apply the
	// prefix conditionally instead of always interpolating it.
	main := rootTerraform(t)["main.tf"]
	if !strings.Contains(main, `startswith(var.host_name, "fleet-")`) {
		t.Fatal("main.tf does not test for the existing project prefix")
	}
	if !strings.Contains(main, `trimprefix(var.host_name, "fleet-")`) {
		t.Fatal("main.tf does not strip the existing project prefix before re-adding it")
	}
	if strings.Contains(main, `fleet-${var.host_name}`) {
		t.Fatal("main.tf still interpolates the prefix unconditionally, which doubles it")
	}
}

// TestHostNamePrefixBudgetIsEnforced proves the 32-character budget is refused,
// not truncated, before Terraform runs.
func TestHostNamePrefixBudgetIsEnforced(t *testing.T) {
	t.Parallel()
	provider, runner, _ := offlineProvider(t)

	// 32 characters is a valid host name, but it derives a 38-character AWS
	// object name.
	tooLong := strings.Repeat("a", 32)
	_, err := provider.CreateHost(context.Background(), createRequest(tooLong))
	if err == nil {
		t.Fatalf("CreateHost accepted host name %q, whose derived name exceeds the budget", tooLong)
	}
	var invalid *domain.ValidationError
	if !errors.As(err, &invalid) || invalid.Field != "name" {
		t.Fatalf("error = %v, want a name validation error", err)
	}
	if !strings.Contains(err.Error(), "32") {
		t.Fatalf("error = %v, want the budget in the message", err)
	}
	if calls := runner.recorded(); len(calls) != 0 {
		t.Fatalf("terraform ran for an over-budget name: %v", calls)
	}

	// A name that already carries the prefix fits exactly at 32 characters.
	fits := "fleet-" + strings.Repeat("b", 26)
	if _, err := provider.CreateHost(context.Background(), createRequest(fits)); err != nil {
		t.Fatalf("CreateHost rejected host name %q of %d characters: %v", fits, len(fits), err)
	}

	// The root enforces the same budget at plan time.
	variables := rootTerraform(t)["variables.tf"]
	if !strings.Contains(variables, `startswith(var.host_name, "fleet-") ? 32 : 26`) {
		t.Fatal("variables.tf does not bound the derived name to 32 characters")
	}
}

// TestBackendIsPartialAndOverridable is the regression test for
// `-backend=false` plus apply being refused: the tracked backend block is
// partial (no bucket, key, region, or credential), the adapter supplies every
// value at init time, and the README documents both supported forms.
func TestBackendIsPartialAndOverridable(t *testing.T) {
	t.Parallel()

	versions := rootTerraform(t)["versions.tf"]
	backend, found := findBlock(versions, `backend "s3"`)
	if !found {
		t.Fatal("versions.tf declares no s3 backend block")
	}
	if keys := assignmentKeys(backend); len(keys) != 0 {
		t.Fatalf("the tracked backend block is not partial; it hardcodes %v", keys)
	}
	for name, source := range rootTerraform(t) {
		for _, needle := range []string{"access_key", "secret_key", "aviral-dotfiles-terraform-state"} {
			if strings.Contains(source, needle) {
				t.Fatalf("%s hardcodes %q; the backend is supplied at init time", name, needle)
			}
		}
	}

	// The adapter supplies the real backend as -backend-config arguments.
	runner := newFake()
	provider, _ := buildProvider(t, runner)
	if _, err := provider.CreateHost(context.Background(), createRequest("rex-22")); err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	initArgs := runner.call(t, "init", 0).Args
	for name, want := range map[string]string{
		"bucket":  "fleet-state-bucket",
		"key":     "fleet-hosts/rex-22/terraform.tfstate",
		"region":  "us-east-1",
		"encrypt": "true",
	} {
		if got := backendConfig(initArgs, name); got != want {
			t.Fatalf("init -backend-config %s = %q, want %q", name, got, want)
		}
	}

	// Both documented smoke-run forms: an -backend-config key, and a local
	// backend override file that sets path.
	readme := rootFile(t, "README.md")
	for _, needle := range []string{
		"-backend-config=key=",
		`backend "local"`,
		"path =",
		"backend_override.tf",
	} {
		if !strings.Contains(readme, needle) {
			t.Fatalf("the root README does not document %q", needle)
		}
	}
}

// TestRootNamesUseOneLocal keeps every AWS object name on the single derived
// local, so no resource can grow its own prefix, suffix, or truncation.
func TestRootNamesUseOneLocal(t *testing.T) {
	t.Parallel()
	main := rootTerraform(t)["main.tf"]

	for _, testCase := range []struct {
		header string
		key    string
	}{
		{`resource "aws_key_pair" "host"`, "key_name"},
		{`resource "aws_security_group" "host"`, "name"},
		{`resource "aws_iam_role" "host"`, "name"},
		{`resource "aws_iam_instance_profile" "host"`, "name"},
	} {
		body := block(main, testCase.header)
		if body == "" {
			t.Fatalf("main.tf has no block %s", testCase.header)
		}
		if got := assignedValue(body, testCase.key); got != "local.name" {
			t.Fatalf("%s: %s = %q, want local.name (one prefix, one source)", testCase.header, testCase.key, got)
		}
	}

	if got := assignedValue(main, "name"); got != `"fleet-${local.host_label}"` {
		t.Fatalf("local.name = %q, want a single prefixed label", got)
	}
	unconditional := regexp.MustCompile(`fleet-\$\{var\.`)
	if unconditional.MatchString(main) {
		t.Fatal("main.tf interpolates a resource name from var.* instead of local.name")
	}
}
