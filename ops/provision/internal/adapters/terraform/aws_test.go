package terraform_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/terraform"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// testPublicKey is inert public key material shaped like a real OpenSSH key. It
// is not a key anybody owns.
const testPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOfflinetestplaceholderonly0000000000 fleet-s02-test"

// The owner-approved network the offline provider is configured with. These are
// well-formed ids, not real resources, and no test resolves them against AWS.
const (
	testVPCID    = "vpc-0123456789abcdef0"
	testSubnetID = "subnet-0123456789abcdef0"
)

// fakeTerraform is a CommandRunner that records every argv and simulates just
// enough Terraform state to make create idempotent. It runs no process, opens no
// network connection, and touches no AWS account.
type fakeTerraform struct {
	mu     sync.Mutex
	calls  []terraform.Command
	states map[string]string
	// failures maps a subcommand name to the error it should return.
	failures map[string]error
	applies  int

	// release, when set, holds every apply open until the test closes it, so a
	// test can observe whether two applies overlap.
	release <-chan struct{}
	// started reports the host name of every apply that reached the release.
	started chan<- string

	applyActive int
	applyMax    int
}

func newFake() *fakeTerraform {
	return &fakeTerraform{
		states:   map[string]string{},
		failures: map[string]error{},
	}
}

func (f *fakeTerraform) Run(ctx context.Context, cmd terraform.Command) (terraform.Result, error) {
	step := ""
	if len(cmd.Args) > 0 {
		step = cmd.Args[0]
	}

	if step == "apply" && f.release != nil {
		f.mu.Lock()
		f.applyActive++
		if f.applyActive > f.applyMax {
			f.applyMax = f.applyActive
		}
		f.mu.Unlock()
		if f.started != nil {
			f.started <- argValue(cmd.Args, "-var", "host_name")
		}
		select {
		case <-f.release:
		case <-ctx.Done():
			return terraform.Result{}, ctx.Err()
		}
		defer func() {
			f.mu.Lock()
			f.applyActive--
			f.mu.Unlock()
		}()
	}

	f.mu.Lock()
	f.calls = append(f.calls, cmd)
	failure := f.failures[step]
	f.mu.Unlock()

	if failure != nil {
		return terraform.Result{Stderr: failure.Error()}, failure
	}

	switch step {
	case "init":
		return terraform.Result{Stdout: "Terraform has been successfully initialized!"}, nil
	case "output":
		f.mu.Lock()
		instanceID := f.states[cmd.Dir]
		f.mu.Unlock()
		if instanceID == "" {
			// Matches a real `terraform output -json` against an empty state.
			return terraform.Result{Stderr: "No outputs found"}, errors.New("exit status 1")
		}
		payload := map[string]any{
			"instance_id": map[string]any{"value": instanceID, "type": "string"},
			"private_ip":  map[string]any{"value": "10.0.1.20", "type": "string"},
			"region":      map[string]any{"value": "ap-south-1", "type": "string"},
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			return terraform.Result{}, err
		}
		return terraform.Result{Stdout: string(encoded)}, nil
	case "apply":
		f.mu.Lock()
		f.states[cmd.Dir] = "i-" + argValue(cmd.Args, "-var", "host_name")
		f.applies++
		f.mu.Unlock()
		return terraform.Result{Stdout: "Apply complete! Resources: 5 added, 0 changed, 0 destroyed."}, nil
	case "destroy":
		f.mu.Lock()
		delete(f.states, cmd.Dir)
		f.mu.Unlock()
		return terraform.Result{Stdout: "Destroy complete! Resources: 5 destroyed."}, nil
	default:
		return terraform.Result{}, fmt.Errorf("unexpected terraform subcommand %q", step)
	}
}

// recorded returns a copy of every command the adapter ran.
func (f *fakeTerraform) recorded() []terraform.Command {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]terraform.Command(nil), f.calls...)
}

// steps lists the subcommand of every recorded call, in order.
func (f *fakeTerraform) steps() []string {
	steps := make([]string, 0, len(f.calls))
	for _, call := range f.calls {
		if len(call.Args) > 0 {
			steps = append(steps, call.Args[0])
		}
	}
	return steps
}

// call returns the nth recorded call for a subcommand.
func (f *fakeTerraform) call(t *testing.T, step string, nth int) terraform.Command {
	t.Helper()
	seen := 0
	for _, call := range f.recorded() {
		if len(call.Args) == 0 || call.Args[0] != step {
			continue
		}
		if seen == nth {
			return call
		}
		seen++
	}
	t.Fatalf("no %s call at index %d; recorded %v", step, nth, f.steps())
	return terraform.Command{}
}

// argValue returns the value of `-flag value` inside an argument array.
func argValue(args []string, flag, key string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] != flag {
			continue
		}
		name, value, ok := strings.Cut(args[i+1], "=")
		if ok && name == key {
			return value
		}
	}
	return ""
}

func backendConfig(args []string, name string) string {
	for _, arg := range args {
		value, ok := strings.CutPrefix(arg, "-backend-config=")
		if !ok {
			continue
		}
		configName, configValue, found := strings.Cut(value, "=")
		if found && configName == name {
			return configValue
		}
	}
	return ""
}

// offlineProvider builds a provider against a throwaway template root and run
// directory, with a fake runner and the approved offline catalog.
func offlineProvider(t *testing.T) (*terraform.AWS, *fakeTerraform, string) {
	t.Helper()
	runner := newFake()
	provider, runDir := buildProvider(t, runner)
	return provider, runner, runDir
}

func buildProvider(t *testing.T, runner terraform.CommandRunner) (*terraform.AWS, string) {
	t.Helper()
	templateRoot := t.TempDir()
	for name, body := range map[string]string{
		"versions.tf":     "terraform {}\n",
		"main.tf":         "output \"instance_id\" { value = \"i-1\" }\n",
		"cloud-init.yaml": "#cloud-config\n",
		"README.md":       "read me\n",
	} {
		if err := os.WriteFile(filepath.Join(templateRoot, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write template %s: %v", name, err)
		}
	}
	keyFile := filepath.Join(t.TempDir(), "bootstrap.pub")
	if err := os.WriteFile(keyFile, []byte(testPublicKey+"\n"), 0o600); err != nil {
		t.Fatalf("write public key: %v", err)
	}
	runDir := filepath.Join(t.TempDir(), "runs")
	provider, err := terraform.NewAWS(terraform.AWSConfig{
		Profiles:         testCatalog(t),
		Dir:              templateRoot,
		RunDir:           runDir,
		SSHPublicKeyFile: keyFile,
		BootstrapCIDR:    "203.0.113.0/24",
		StateBucket:      "fleet-state-bucket",
		StateRegion:      "us-east-1",
		VPCID:            testVPCID,
		SubnetID:         testSubnetID,
		OwnerTag:         "homelab",
		TestRunTag:       "s02-offline",
		Timeout:          5 * time.Second,
		Runner:           runner,
	})
	if err != nil {
		t.Fatalf("NewAWS: %v", err)
	}
	return provider, runDir
}

func testCatalog(t *testing.T) domain.Catalog {
	t.Helper()
	catalog, err := domain.NewCatalog([]domain.Profile{{
		Name:        "rex",
		DisplayName: "Managed Rex host",
		Provider:    domain.ProviderAWS,
		Regions:     []string{"ap-south-1"},
		Sizes: map[string]domain.SizeSpec{
			"standard": {Name: "standard", InstanceType: "t3.medium", DiskGB: 40},
		},
		Tags:          map[string]string{"owner": "homelab", "fleet-tier": "managed"},
		SecretBundles: []string{"bao:secret/data/hosts/rex/canary"},
		FlakeRef:      ".#homeConfigurations.remote-mumbai.activationPackage",
	}})
	if err != nil {
		t.Fatalf("build catalog: %v", err)
	}
	return catalog
}

func createRequest(name string) application.ProviderCreateRequest {
	return application.ProviderCreateRequest{
		HostID:   "host-0001",
		Name:     name,
		Provider: domain.ProviderAWS,
		Profile:  "rex",
		Region:   "ap-south-1",
		Size:     "standard",
		Tags:     map[string]string{"owner": "homelab", "Name": name},
	}
}

func destroyRequest(name, resourceID string) application.ProviderDestroyRequest {
	return application.ProviderDestroyRequest{
		HostID:     "host-0001",
		Name:       name,
		Provider:   domain.ProviderAWS,
		Profile:    "rex",
		Region:     "ap-south-1",
		Size:       "standard",
		ResourceID: resourceID,
	}
}

// TestCreateHostRunsOneInstanceThroughOneStatePath is the S02 acceptance test in
// its offline form: one request, one Terraform run, one state object, and the
// approved shape from the catalog rather than from the request.
func TestCreateHostRunsOneInstanceThroughOneStatePath(t *testing.T) {
	t.Parallel()
	provider, runner, runDir := offlineProvider(t)

	resource, err := provider.CreateHost(context.Background(), createRequest("rex-01"))
	if err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	if resource.ResourceID != "i-rex-01" {
		t.Fatalf("resource id = %q, want i-rex-01", resource.ResourceID)
	}
	if resource.PrivateAddress != "10.0.1.20" {
		t.Fatalf("private address = %q", resource.PrivateAddress)
	}

	if got, want := fmt.Sprint(runner.steps()), "[init output apply output]"; got != want {
		t.Fatalf("terraform steps = %s, want %s", got, want)
	}

	initCall := runner.call(t, "init", 0)
	if initCall.Dir != filepath.Join(runDir, "rex-01") {
		t.Fatalf("init ran in %q, want the per-host run directory", initCall.Dir)
	}
	if initCall.Name != "terraform" {
		t.Fatalf("ran %q, want the terraform binary", initCall.Name)
	}
	wantInit := []string{
		"init",
		"-input=false",
		"-no-color",
		"-reconfigure",
		"-backend-config=bucket=fleet-state-bucket",
		"-backend-config=key=fleet-hosts/rex-01/terraform.tfstate",
		"-backend-config=region=us-east-1",
		"-backend-config=encrypt=true",
	}
	if got := fmt.Sprint(initCall.Args); got != fmt.Sprint(wantInit) {
		t.Fatalf("init argv = %s\nwant %s", got, fmt.Sprint(wantInit))
	}

	applyCall := runner.call(t, "apply", 0)
	if applyCall.Dir != initCall.Dir {
		t.Fatalf("apply ran in %q, want the same per-host directory as init", applyCall.Dir)
	}
	for _, want := range []string{
		"apply", "-input=false", "-auto-approve", "-no-color",
		"-var", "host_name=rex-01",
		"-var", "profile=rex",
		"-var", "size_key=standard",
		"-var", "instance_type=t3.medium",
		"-var", "disk_gb=40",
		"-var", "vpc_id=" + testVPCID,
		"-var", "subnet_id=" + testSubnetID,
		"-var", "owner=homelab",
		"-var", "test_run=s02-offline",
		"-var", "bootstrap_ssh_cidr=203.0.113.0/24",
		"-var", "ssh_public_key=" + testPublicKey,
	} {
		if !containsArg(applyCall.Args, want) {
			t.Fatalf("apply argv is missing %q: %v", want, applyCall.Args)
		}
	}

	// The template root is only read: the run directory holds the copies.
	for _, name := range []string{"versions.tf", "main.tf", "cloud-init.yaml"} {
		if _, err := os.Stat(filepath.Join(runDir, "rex-01", name)); err != nil {
			t.Fatalf("per-host run directory is missing %s: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(runDir, "rex-01", "README.md")); err == nil {
		t.Fatal("the run directory copied a non-Terraform file")
	}
}

// TestCreateHostReplayIsIdempotent proves a retried request cannot create a
// second instance: the existing state object is returned, and no second apply
// runs.
func TestCreateHostReplayIsIdempotent(t *testing.T) {
	t.Parallel()
	provider, runner, _ := offlineProvider(t)

	first, err := provider.CreateHost(context.Background(), createRequest("rex-02"))
	if err != nil {
		t.Fatalf("first CreateHost: %v", err)
	}
	second, err := provider.CreateHost(context.Background(), createRequest("rex-02"))
	if err != nil {
		t.Fatalf("replayed CreateHost: %v", err)
	}
	if first != second {
		t.Fatalf("replay returned %+v, want the same resource %+v", second, first)
	}

	runner.mu.Lock()
	applies := runner.applies
	runner.mu.Unlock()
	if applies != 1 {
		t.Fatalf("apply ran %d times, want exactly 1", applies)
	}

	firstKey := backendConfig(runner.call(t, "init", 0).Args, "key")
	secondKey := backendConfig(runner.call(t, "init", 1).Args, "key")
	if firstKey != secondKey {
		t.Fatalf("replay used state key %q, want the same %q", secondKey, firstKey)
	}
	if want := "fleet-hosts/rex-02/terraform.tfstate"; firstKey != want {
		t.Fatalf("state key = %q, want %q", firstKey, want)
	}
}

// TestCreateHostRejectsUnknownSize keeps the size key server-side: an unapproved
// name never reaches Terraform.
func TestCreateHostRejectsUnknownSize(t *testing.T) {
	t.Parallel()
	provider, runner, _ := offlineProvider(t)

	req := createRequest("rex-03")
	req.Size = "enormous"
	_, err := provider.CreateHost(context.Background(), req)
	if err == nil {
		t.Fatal("CreateHost accepted an unapproved size")
	}
	var invalid *domain.ValidationError
	if !errors.As(err, &invalid) || invalid.Field != "size" {
		t.Fatalf("error = %v, want a size validation error", err)
	}
	if calls := runner.recorded(); len(calls) != 0 {
		t.Fatalf("terraform ran for a rejected request: %v", calls)
	}
}

func TestCreateHostRejectsUnapprovedRegion(t *testing.T) {
	t.Parallel()
	for _, region := range []string{"us-east-1", "ap-southeast-1", "eu-west-1", "", "moon-1"} {
		region := region
		t.Run(region, func(t *testing.T) {
			t.Parallel()
			provider, runner, _ := offlineProvider(t)
			req := createRequest("rex-04")
			req.Region = region
			if _, err := provider.CreateHost(context.Background(), req); err == nil {
				t.Fatalf("CreateHost accepted region %q", region)
			}
			if calls := runner.recorded(); len(calls) != 0 {
				t.Fatalf("terraform ran for region %q: %v", region, calls)
			}
		})
	}
}

func TestCreateHostRejectsDivergentShape(t *testing.T) {
	t.Parallel()
	cases := map[string]func(*application.ProviderCreateRequest){
		"instance type": func(req *application.ProviderCreateRequest) { req.InstanceType = "m5.24xlarge" },
		"disk size":     func(req *application.ProviderCreateRequest) { req.DiskGB = 4000 },
		"profile":       func(req *application.ProviderCreateRequest) { req.Profile = "unapproved" },
		"provider":      func(req *application.ProviderCreateRequest) { req.Provider = "gcp" },
	}
	for name, mutate := range cases {
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			provider, runner, _ := offlineProvider(t)
			req := createRequest("rex-05")
			mutate(&req)
			if _, err := provider.CreateHost(context.Background(), req); err == nil {
				t.Fatalf("CreateHost accepted a divergent %s", name)
			}
			if calls := runner.recorded(); len(calls) != 0 {
				t.Fatalf("terraform ran for a divergent %s: %v", name, calls)
			}
		})
	}
}

// TestCreateHostRejectsHostileHostName proves a name never becomes a path
// segment or an argument: it fails validation before any process starts.
func TestCreateHostRejectsHostileHostName(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"rex-01; rm -rf /", "../escape", "rex 01", "REX-01", "rex/01", ""} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			provider, runner, _ := offlineProvider(t)
			if _, err := provider.CreateHost(context.Background(), createRequest(name)); err == nil {
				t.Fatalf("CreateHost accepted host name %q", name)
			}
			if calls := runner.recorded(); len(calls) != 0 {
				t.Fatalf("terraform ran for host name %q: %v", name, calls)
			}
		})
	}
}

// TestTerraformArgumentsAreArrays asserts the shape of every invocation: an
// executable and an argument array, one element per argument, no shell, and no
// call outside the host's own run directory.
func TestTerraformArgumentsAreArrays(t *testing.T) {
	t.Parallel()
	provider, runner, runDir := offlineProvider(t)
	if _, err := provider.CreateHost(context.Background(), createRequest("rex-06")); err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	if err := provider.DestroyHost(context.Background(), destroyRequest("rex-06", "i-rex-06")); err != nil {
		t.Fatalf("DestroyHost: %v", err)
	}

	for _, call := range runner.recorded() {
		if call.Name != "terraform" {
			t.Fatalf("executable %q is not the terraform binary", call.Name)
		}
		if strings.ContainsAny(call.Name, " \t;&|`$") {
			t.Fatalf("executable %q looks like a command line", call.Name)
		}
		if !strings.HasPrefix(call.Dir, runDir+string(os.PathSeparator)) {
			t.Fatalf("%s ran in %q, outside the per-host run root %q", call.Args[0], call.Dir, runDir)
		}
		for _, arg := range call.Args {
			if arg == "-c" || arg == "sh" || arg == "bash" || arg == "-lc" {
				t.Fatalf("%s argv contains a shell invocation: %v", call.Args[0], call.Args)
			}
			if strings.ContainsAny(arg, "\n\r") {
				t.Fatalf("%s argv element contains a line break: %q", call.Args[0], arg)
			}
		}
		// Every `-var` is a separate argument from its value.
		for i, arg := range call.Args {
			if arg == "-var" && i+1 < len(call.Args) {
				if !strings.Contains(call.Args[i+1], "=") {
					t.Fatalf("%s: -var without name=value: %q", call.Args[0], call.Args[i+1])
				}
				if strings.Contains(call.Args[i+1], " ") && !strings.HasPrefix(call.Args[i+1], "ssh_public_key=") {
					t.Fatalf("%s: variable value contains a space: %q", call.Args[0], call.Args[i+1])
				}
			}
		}
	}
}

// TestDestroyHostTargetsOnlyThatHostsState is the destroy-isolation test: two
// hosts exist, one is destroyed, and the destroy opens only its own state object
// and only its own run directory.
func TestDestroyHostTargetsOnlyThatHostsState(t *testing.T) {
	t.Parallel()
	provider, runner, runDir := offlineProvider(t)

	if _, err := provider.CreateHost(context.Background(), createRequest("rex-07")); err != nil {
		t.Fatalf("create rex-07: %v", err)
	}
	if _, err := provider.CreateHost(context.Background(), createRequest("rex-08")); err != nil {
		t.Fatalf("create rex-08: %v", err)
	}
	if err := provider.DestroyHost(context.Background(), destroyRequest("rex-07", "i-rex-07")); err != nil {
		t.Fatalf("destroy rex-07: %v", err)
	}

	// Three inits: two creates and one destroy. The destroy's is the last.
	destroyInit := runner.call(t, "init", 2)
	if got, want := backendConfig(destroyInit.Args, "key"), "fleet-hosts/rex-07/terraform.tfstate"; got != want {
		t.Fatalf("destroy opened state key %q, want %q", got, want)
	}
	if got, want := destroyInit.Dir, filepath.Join(runDir, "rex-07"); got != want {
		t.Fatalf("destroy ran in %q, want %q", got, want)
	}

	destroyCall := runner.call(t, "destroy", 0)
	for _, arg := range destroyCall.Args {
		if arg == "-target" || arg == "-state" || arg == "-state-out" {
			t.Fatalf("destroy argv narrows or redirects state: %v", destroyCall.Args)
		}
	}
	if got := argValue(destroyCall.Args, "-var", "host_name"); got != "rex-07" {
		t.Fatalf("destroy host_name = %q, want rex-07", got)
	}

	// The sibling's state object is untouched.
	runner.mu.Lock()
	sibling := runner.states[filepath.Join(runDir, "rex-08")]
	destroyed := runner.states[filepath.Join(runDir, "rex-07")]
	runner.mu.Unlock()
	if sibling != "i-rex-08" {
		t.Fatalf("sibling state after destroying rex-07 = %q, want i-rex-08", sibling)
	}
	if destroyed != "" {
		t.Fatalf("destroyed host still holds instance %q", destroyed)
	}
}

func TestDestroyHostRefusesStateForAnotherInstance(t *testing.T) {
	t.Parallel()
	provider, runner, _ := offlineProvider(t)
	if _, err := provider.CreateHost(context.Background(), createRequest("rex-09")); err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	err := provider.DestroyHost(context.Background(), destroyRequest("rex-09", "i-someone-else"))
	if err == nil {
		t.Fatal("destroy accepted a state object that holds a different instance")
	}
	if !strings.Contains(err.Error(), "refusing to destroy") {
		t.Fatalf("error = %v, want an ownership refusal", err)
	}
	for _, call := range runner.recorded() {
		if call.Args[0] == "destroy" {
			t.Fatal("destroy ran despite the ownership mismatch")
		}
	}
}

func TestDestroyHostIsIdempotentWhenStateIsEmpty(t *testing.T) {
	t.Parallel()
	provider, runner, _ := offlineProvider(t)
	for i := 0; i < 2; i++ {
		if err := provider.DestroyHost(context.Background(), destroyRequest("rex-10", "")); err != nil {
			t.Fatalf("destroy of an absent host %d: %v", i, err)
		}
	}
	if got := runner.call(t, "destroy", 1); got.Args[0] != "destroy" {
		t.Fatalf("second destroy did not run: %v", got.Args)
	}
}

// TestOperationsSerializePerHost holds one apply open and starts a second create
// for the same host: the second must wait, then replay the recorded instance
// instead of applying again.
func TestOperationsSerializePerHost(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	started := make(chan string, 4)
	runner := newFake()
	runner.release = release
	runner.started = started
	provider, _ := buildProvider(t, runner)

	errs := make(chan error, 2)
	go func() {
		_, err := provider.CreateHost(context.Background(), createRequest("rex-11"))
		errs <- err
	}()

	select {
	case host := <-started:
		if host != "rex-11" {
			t.Fatalf("first apply was for %q", host)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("first apply never started")
	}

	go func() {
		_, err := provider.CreateHost(context.Background(), createRequest("rex-11"))
		errs <- err
	}()

	select {
	case host := <-started:
		t.Fatalf("a second apply for %q overlapped the first; operations did not serialize", host)
	case <-time.After(150 * time.Millisecond):
	}

	close(release)
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("CreateHost: %v", err)
		}
	}

	runner.mu.Lock()
	applies := runner.applies
	runner.mu.Unlock()
	if applies != 1 {
		t.Fatalf("apply ran %d times, want exactly 1", applies)
	}
}

// TestOperationsRunInParallelForDifferentHosts proves the serialization is per
// host, not global.
func TestOperationsRunInParallelForDifferentHosts(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	started := make(chan string, 4)
	runner := newFake()
	runner.release = release
	runner.started = started
	provider, _ := buildProvider(t, runner)

	errs := make(chan error, 2)
	for _, name := range []string{"rex-12", "rex-13"} {
		name := name
		go func() {
			_, err := provider.CreateHost(context.Background(), createRequest(name))
			errs <- err
		}()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatalf("only %d applies overlapped; different hosts must not serialize", i)
		}
	}
	close(release)
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("CreateHost: %v", err)
		}
	}
	runner.mu.Lock()
	maxActive := runner.applyMax
	runner.mu.Unlock()
	if maxActive != 2 {
		t.Fatalf("max concurrent applies = %d, want 2", maxActive)
	}
}

func TestInitFailureStopsBeforeApply(t *testing.T) {
	t.Parallel()
	runner := newFake()
	runner.failures["init"] = errors.New("no credentials configured")
	provider, _ := buildProvider(t, runner)

	_, err := provider.CreateHost(context.Background(), createRequest("rex-14"))
	if err == nil {
		t.Fatal("CreateHost reported success after a failed init")
	}
	var invocation *terraform.InvocationError
	if !errors.As(err, &invocation) || invocation.Step != "init" {
		t.Fatalf("error = %v, want an init invocation failure", err)
	}
	for _, call := range runner.recorded() {
		if call.Args[0] == "apply" {
			t.Fatal("apply ran after a failed init")
		}
	}
}

func TestStateKeyIsPerHost(t *testing.T) {
	t.Parallel()
	if got, want := terraform.StateKey("rex-01"), "fleet-hosts/rex-01/terraform.tfstate"; got != want {
		t.Fatalf("StateKey = %q, want %q", got, want)
	}
	if terraform.StateKey("rex-01") == terraform.StateKey("rex-02") {
		t.Fatal("two hosts share a state key")
	}
	if terraform.StateKey("rex-1") == terraform.StateKey("rex-1-0") {
		t.Fatal("state keys collide across name shapes")
	}
}

func TestNewAWSRejectsPrivateKeyMaterial(t *testing.T) {
	t.Parallel()
	templateRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(templateRoot, "main.tf"), []byte("resource \"x\" \"y\" {}\n"), 0o600); err != nil {
		t.Fatalf("write template: %v", err)
	}
	keyFile := filepath.Join(t.TempDir(), "id_ed25519.pub")
	private := "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1lZDI1NTE5\n-----END OPENSSH PRIVATE KEY-----\n"
	if err := os.WriteFile(keyFile, []byte(private), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	base := terraform.AWSConfig{
		Profiles:         testCatalog(t),
		Dir:              templateRoot,
		RunDir:           filepath.Join(t.TempDir(), "runs"),
		SSHPublicKeyFile: keyFile,
		BootstrapCIDR:    "203.0.113.0/24",
		StateBucket:      "bucket",
		StateRegion:      "us-east-1",
		VPCID:            testVPCID,
		SubnetID:         testSubnetID,
		OwnerTag:         "homelab",
		TestRunTag:       "s02-offline",
	}
	if _, err := terraform.NewAWS(base); err == nil {
		t.Fatal("NewAWS accepted private key material")
	}

	// A path that is not a .pub file is refused before it is even read.
	base.SSHPublicKeyFile = filepath.Join(t.TempDir(), "id_ed25519")
	if _, err := terraform.NewAWS(base); err == nil {
		t.Fatal("NewAWS accepted a private-key-shaped file name")
	}
}

func TestNewAWSRejectsPermissiveBootstrapCIDR(t *testing.T) {
	t.Parallel()
	templateRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(templateRoot, "main.tf"), []byte("resource \"x\" \"y\" {}\n"), 0o600); err != nil {
		t.Fatalf("write template: %v", err)
	}
	keyFile := filepath.Join(t.TempDir(), "bootstrap.pub")
	if err := os.WriteFile(keyFile, []byte(testPublicKey+"\n"), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	for _, cidr := range []string{"0.0.0.0/0", "10.0.0.0/1", "0.0.0.0/7", "::/0", "not-a-cidr", ""} {
		cidr := cidr
		t.Run(cidr, func(t *testing.T) {
			t.Parallel()
			_, err := terraform.NewAWS(terraform.AWSConfig{
				Profiles:         testCatalog(t),
				Dir:              templateRoot,
				RunDir:           filepath.Join(t.TempDir(), "runs"),
				SSHPublicKeyFile: keyFile,
				BootstrapCIDR:    cidr,
				StateBucket:      "bucket",
				StateRegion:      "us-east-1",
				VPCID:            testVPCID,
				SubnetID:         testSubnetID,
				OwnerTag:         "homelab",
				TestRunTag:       "s02-offline",
			})
			if err == nil {
				t.Fatalf("NewAWS accepted bootstrap CIDR %q", cidr)
			}
		})
	}
}

func TestNewAWSRejectsTemplateRootWithoutTerraform(t *testing.T) {
	t.Parallel()
	keyFile := filepath.Join(t.TempDir(), "bootstrap.pub")
	if err := os.WriteFile(keyFile, []byte(testPublicKey+"\n"), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	empty := t.TempDir()
	if err := os.WriteFile(filepath.Join(empty, "notes.txt"), []byte("not terraform\n"), 0o600); err != nil {
		t.Fatalf("write note: %v", err)
	}
	_, err := terraform.NewAWS(terraform.AWSConfig{
		Profiles:         testCatalog(t),
		Dir:              empty,
		RunDir:           filepath.Join(t.TempDir(), "runs"),
		SSHPublicKeyFile: keyFile,
		BootstrapCIDR:    "203.0.113.0/24",
		StateBucket:      "bucket",
		StateRegion:      "us-east-1",
		VPCID:            testVPCID,
		SubnetID:         testSubnetID,
		OwnerTag:         "homelab",
		TestRunTag:       "s02-offline",
	})
	if err == nil {
		t.Fatal("NewAWS accepted a template root with no .tf file")
	}
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
