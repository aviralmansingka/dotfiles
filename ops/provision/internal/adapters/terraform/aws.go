// Package terraform implements the AWS EC2 compute provider by driving the
// isolated per-host Terraform root in ops/provision/terraform/aws.
//
// Two properties define the adapter:
//
//   - One host, one state object, one working directory. StateKey derives the S3
//     object key from the host name, and the adapter copies the template root
//     into <run_dir>/<host> before running Terraform there. Create, destroy, and
//     the serialization lock all use that one function, so two hosts can never
//     share state and a destroy cannot address a sibling.
//   - Argument arrays, never a command line. Every invocation is an explicit
//     []string handed to os/exec, and every value that reaches it was validated
//     against the approved catalog first.
package terraform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const (
	// ApprovedRegion is the single region this provider creates hosts in. The
	// Terraform root pins the same region in its only provider block.
	ApprovedRegion = domain.ApprovedAWSRegion

	// stateKeyPrefix is the S3 key prefix of every per-host state object, and
	// stateFileName the object name inside it.
	stateKeyPrefix = "fleet-hosts"
	stateFileName  = "terraform.tfstate"

	// defaultBinary and defaultTimeout apply when the configuration is silent.
	defaultBinary  = "terraform"
	defaultTimeout = 30 * time.Minute

	// namePrefix is applied to a host name exactly once, and
	// MaxResourceNameLen is the ceiling for the resulting AWS object name. A
	// name is never truncated: truncation could collide with another host, so
	// an over-budget name is refused instead.
	namePrefix         = "fleet-"
	MaxResourceNameLen = 32

	// maxDiagnostic bounds the Terraform stderr an error carries.
	maxDiagnostic = 4096
)

// templateExtensions are the files a per-host run directory needs: the root
// module, its template files, and the cloud-init document main.tf reads through
// file().
var templateExtensions = []string{".tf", ".tftpl", ".yaml"}

// AWSConfig configures the Terraform-backed AWS provider. Every field is a path,
// an approved label, or a dependency; no credential value is accepted, because
// the Terraform process uses the worker's own credential source.
type AWSConfig struct {
	// Profiles is the approved catalog. It is the only source of instance
	// types, disk sizes, and regions: the adapter re-resolves the size key
	// here instead of trusting the values in a request.
	Profiles domain.Catalog
	// Dir is the per-host Terraform root. It is read, never written.
	Dir string
	// RunDir holds one working directory per host.
	RunDir string
	// SSHPublicKeyFile names a `.pub` file. Private key material is refused.
	SSHPublicKeyFile string
	// BootstrapCIDR is the only source address allowed to reach port 22, or empty
	// for no SSH ingress at all. Empty is the default and is passed to Terraform
	// as `-var bootstrap_ssh_cidr=`, where the root's dynamic ingress block then
	// emits zero rules.
	BootstrapCIDR string
	// StateBucket and StateRegion locate the S3 bucket that holds one state
	// object per host.
	StateBucket string
	StateRegion string
	// VPCID and SubnetID are the owner-approved network the host joins. Both are
	// required: the root creates the security group in VPCID and launches the
	// instance in SubnetID, and it has no default-VPC fallback, because an
	// implicit default VPC does not exist in every account and region.
	VPCID    string
	SubnetID string
	// OwnerTag and TestRunTag are written to every taggable resource.
	OwnerTag   string
	TestRunTag string
	// Binary is the Terraform executable name; defaults to "terraform".
	Binary string
	// Timeout bounds one invocation; defaults to 30 minutes.
	Timeout time.Duration
	// Runner runs the commands. Defaults to ExecRunner.
	Runner CommandRunner
	// Locker serializes operations. Defaults to the in-process keyed locker.
	Locker KeyedLocker
}

// AWS creates and destroys one EC2 host per request through the per-host
// Terraform root.
type AWS struct {
	profiles      domain.Catalog
	dir           string
	runDir        string
	sshPublicKey  string
	bootstrapCIDR string
	stateBucket   string
	stateRegion   string
	vpcID         string
	subnetID      string
	ownerTag      string
	testRunTag    string
	binary        string
	timeout       time.Duration
	runner        CommandRunner
	locker        KeyedLocker
}

var _ application.HostProvider = (*AWS)(nil)

// NewAWS validates the configuration and builds the provider. A configuration
// error here is fatal at worker start: an unusable provider must never look
// like a working one.
func NewAWS(cfg AWSConfig) (*AWS, error) {
	if len(cfg.Profiles.Profiles()) == 0 {
		return nil, errors.New("terraform: the approved profile catalog is required")
	}
	if err := validateTemplateRoot(cfg.Dir); err != nil {
		return nil, err
	}
	if cfg.RunDir == "" {
		return nil, errors.New("terraform: run directory is required")
	}
	if filepath.Clean(cfg.Dir) == filepath.Clean(cfg.RunDir) {
		return nil, errors.New("terraform: run directory must differ from the template root")
	}
	publicKey, err := readSSHPublicKey(cfg.SSHPublicKeyFile)
	if err != nil {
		return nil, err
	}
	if err := domain.ValidateBootstrapCIDR(cfg.BootstrapCIDR); err != nil {
		return nil, fmt.Errorf("terraform: bootstrap SSH CIDR: %w", err)
	}
	if cfg.StateBucket == "" || cfg.StateRegion == "" {
		return nil, errors.New("terraform: state bucket and state region are required")
	}
	// The network is required input, and the message names the variable so an
	// operator fixes the configuration instead of guessing. There is no lookup
	// that could silently pick a different network.
	if cfg.VPCID == "" {
		return nil, errors.New("terraform: vpc_id is required: the root creates the host's security group in vpc_id and has no default-VPC fallback")
	}
	if err := domain.ValidateVPCID(cfg.VPCID); err != nil {
		return nil, fmt.Errorf("terraform: %w", err)
	}
	if cfg.SubnetID == "" {
		return nil, errors.New("terraform: subnet_id is required: the root launches the instance in subnet_id and has no default-VPC fallback")
	}
	if err := domain.ValidateSubnetID(cfg.SubnetID); err != nil {
		return nil, fmt.Errorf("terraform: %w", err)
	}
	if err := domain.ValidateTagValue("owner tag", cfg.OwnerTag); err != nil {
		return nil, fmt.Errorf("terraform: %w", err)
	}
	if err := domain.ValidateTagValue("test-run tag", cfg.TestRunTag); err != nil {
		return nil, fmt.Errorf("terraform: %w", err)
	}

	binary := cfg.Binary
	if binary == "" {
		binary = defaultBinary
	}
	if strings.ContainsAny(binary, `/\ `) {
		return nil, fmt.Errorf("terraform: binary %q must be a bare executable name", binary)
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	runner := cfg.Runner
	if runner == nil {
		runner = ExecRunner{}
	}
	locker := cfg.Locker
	if locker == nil {
		locker = NewKeyedLocker()
	}

	return &AWS{
		profiles:      cfg.Profiles,
		dir:           cfg.Dir,
		runDir:        cfg.RunDir,
		sshPublicKey:  publicKey,
		bootstrapCIDR: cfg.BootstrapCIDR,
		stateBucket:   cfg.StateBucket,
		stateRegion:   cfg.StateRegion,
		vpcID:         cfg.VPCID,
		subnetID:      cfg.SubnetID,
		ownerTag:      cfg.OwnerTag,
		testRunTag:    cfg.TestRunTag,
		binary:        binary,
		timeout:       timeout,
		runner:        runner,
		locker:        locker,
	}, nil
}

// StateKey is the S3 object key of one host's Terraform state. It is the single
// source of a state path: create, destroy, and the lock key all derive from it,
// so two hosts cannot share state and a destroy cannot address a sibling.
func StateKey(hostName string) string {
	return path.Join(stateKeyPrefix, hostName, stateFileName)
}

// ResourceName is the AWS name of a host's objects: the project prefix applied
// to the host name at most once, so a host already named `fleet-sm-28e571` does
// not become `fleet-fleet-sm-28e571`. It mirrors `local.name` in
// ops/provision/terraform/aws/main.tf, and MaxResourceNameLen is the budget both
// sides enforce.
func ResourceName(hostName string) string {
	return namePrefix + strings.TrimPrefix(hostName, namePrefix)
}

// CreateHost creates this host's instance exactly once.
//
// The run is serialized on the host name and the state path, then replayed
// safely: a state object that already records an instance is returned as is,
// so a retried request yields one instance and one state path rather than a
// second host.
func (a *AWS) CreateHost(ctx context.Context, req application.ProviderCreateRequest) (application.ProviderResource, error) {
	plan, err := a.resolve(req.Name, req.Provider, req.Profile, req.Region, req.Size, req.InstanceType, req.DiskGB, req.Tags)
	if err != nil {
		return application.ProviderResource{}, err
	}

	unlock := a.locker.Lock(hostLockKey(plan.name), stateLockKey(plan.stateKey))
	defer unlock()

	if err := a.prepare(plan); err != nil {
		return application.ProviderResource{}, err
	}
	if _, err := a.invoke(ctx, plan, a.initArgs(plan)...); err != nil {
		return application.ProviderResource{}, err
	}

	existing, recorded, err := a.recorded(ctx, plan)
	if err != nil {
		return application.ProviderResource{}, err
	}
	if recorded {
		return existing, nil
	}

	if _, err := a.invoke(ctx, plan, a.applyArgs(plan)...); err != nil {
		return application.ProviderResource{}, err
	}
	created, recorded, err := a.recorded(ctx, plan)
	if err != nil {
		return application.ProviderResource{}, err
	}
	if !recorded || created.ResourceID == "" {
		return application.ProviderResource{}, fmt.Errorf("terraform: apply for host %q recorded no instance id", plan.name)
	}
	return created, nil
}

// DestroyHost destroys only this host's resources.
//
// The destroy opens the state object keyed by this host's name and nothing
// else: there is no target, no alternate state path, and no shared state, so a
// sibling host, the long-lived Mumbai host, and every account-level object are
// out of reach. A state that records a different instance than the inventory
// does is refused rather than destroyed.
func (a *AWS) DestroyHost(ctx context.Context, req application.ProviderDestroyRequest) error {
	plan, err := a.resolve(req.Name, req.Provider, req.Profile, req.Region, req.Size, "", 0, nil)
	if err != nil {
		return err
	}

	unlock := a.locker.Lock(hostLockKey(plan.name), stateLockKey(plan.stateKey))
	defer unlock()

	if err := a.prepare(plan); err != nil {
		return err
	}
	if _, err := a.invoke(ctx, plan, a.initArgs(plan)...); err != nil {
		return err
	}

	existing, recorded, err := a.recorded(ctx, plan)
	if err != nil {
		return err
	}
	if recorded && req.ResourceID != "" && existing.ResourceID != req.ResourceID {
		return fmt.Errorf("terraform: host %q state holds instance %q, not the recorded %q; refusing to destroy",
			plan.name, existing.ResourceID, req.ResourceID)
	}

	// A state with no instance destroys nothing and reports success, which keeps
	// a retried teardown idempotent.
	if _, err := a.invoke(ctx, plan, a.destroyArgs(plan)...); err != nil {
		return err
	}
	return nil
}

// hostPlan is everything one host's Terraform run needs. Every field is derived
// from the approved catalog and the adapter's own configuration.
type hostPlan struct {
	name         string
	profile      string
	size         string
	region       string
	instanceType string
	diskGB       int
	ownerTag     string
	vpcID        string
	subnetID     string
	stateKey     string
	workDir      string
}

// resolve validates one operation against the approved catalog. It is the only
// path from a request to a Terraform variable, so an unknown size, an
// unapproved region, or a shape that disagrees with the catalog is refused
// before any process starts.
func (a *AWS) resolve(name string, provider domain.Provider, profileName, region, size, instanceType string, diskGB int, tags map[string]string) (hostPlan, error) {
	if err := domain.ValidateHostName(name); err != nil {
		return hostPlan{}, err
	}
	if provider != domain.ProviderAWS {
		return hostPlan{}, domain.Invalid("provider", fmt.Sprintf("%q is not the approved provider %q", provider, domain.ProviderAWS))
	}
	if err := domain.ValidateAWSRegion(region); err != nil {
		return hostPlan{}, err
	}
	profile, ok := a.profiles.Profile(profileName)
	if !ok {
		return hostPlan{}, domain.Invalid("profile", fmt.Sprintf("%q is not an approved profile", profileName))
	}
	if profile.Provider != domain.ProviderAWS {
		return hostPlan{}, domain.Invalid("profile", fmt.Sprintf("profile %q is not an AWS profile", profileName))
	}
	if !containsString(profile.Regions, region) {
		return hostPlan{}, domain.Invalid("region", fmt.Sprintf("%q is not an approved region for profile %q", region, profileName))
	}
	spec, ok := profile.Sizes[size]
	if !ok {
		return hostPlan{}, domain.Invalid("size", fmt.Sprintf("%q is not an approved size for profile %q", size, profileName))
	}
	// The catalog decides the shape. A request that names a different instance
	// type or disk size is a divergence, not an override.
	if instanceType != "" && instanceType != spec.InstanceType {
		return hostPlan{}, domain.Invalid("instance_type", fmt.Sprintf("%q is not the resolved type of size %q", instanceType, size))
	}
	if diskGB != 0 && diskGB != spec.DiskGB {
		return hostPlan{}, domain.Invalid("disk_gb", fmt.Sprintf("%d is not the resolved disk size of size %q", diskGB, size))
	}

	// The approved tag policy key is `owner`. The catalog supplies its value;
	// a request cannot inject a different key.
	owner := a.ownerTag
	if tag := tags["owner"]; tag != "" {
		owner = tag
	}
	if err := domain.ValidateTagValue("owner tag", owner); err != nil {
		return hostPlan{}, err
	}
	// Fail here, with the name in the message, rather than at the Terraform
	// plan: the root applies the same 32-character budget to local.name.
	if resourceName := ResourceName(name); len(resourceName) > MaxResourceNameLen {
		return hostPlan{}, domain.Invalid("name", fmt.Sprintf("host name %q derives the AWS object name %q (%d characters); the limit is %d, so use a name of at most 26 characters unless it already starts with %q",
			name, resourceName, len(resourceName), MaxResourceNameLen, namePrefix))
	}

	return hostPlan{
		name:         name,
		profile:      profileName,
		size:         size,
		region:       region,
		instanceType: spec.InstanceType,
		diskGB:       spec.DiskGB,
		ownerTag:     owner,
		vpcID:        a.vpcID,
		subnetID:     a.subnetID,
		stateKey:     StateKey(name),
		workDir:      filepath.Join(a.runDir, name),
	}, nil
}

// prepare materializes this host's working directory from the template root.
// The template is only read, so a run cannot corrupt the thing that is
// validated and reviewed.
func (a *AWS) prepare(plan hostPlan) error {
	if err := os.MkdirAll(plan.workDir, 0o700); err != nil {
		return fmt.Errorf("terraform: create run directory for host %q: %w", plan.name, err)
	}
	entries, err := os.ReadDir(a.dir)
	if err != nil {
		return fmt.Errorf("terraform: read template root: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !isTemplateFile(entry.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(a.dir, entry.Name()))
		if err != nil {
			return fmt.Errorf("terraform: read template %s: %w", entry.Name(), err)
		}
		if err := os.WriteFile(filepath.Join(plan.workDir, entry.Name()), data, 0o600); err != nil {
			return fmt.Errorf("terraform: write %s for host %q: %w", entry.Name(), plan.name, err)
		}
	}
	return nil
}

// recorded reads this host's own state. A missing state object, or one with no
// outputs, is reported as "not recorded" rather than as an error: that is
// exactly what a first create looks like. A real failure surfaces on the apply
// or destroy that follows.
func (a *AWS) recorded(ctx context.Context, plan hostPlan) (application.ProviderResource, bool, error) {
	result, err := a.invoke(ctx, plan, "output", "-json")
	if err != nil {
		return application.ProviderResource{}, false, nil
	}
	var outputs map[string]stateOutput
	if err := json.Unmarshal([]byte(result.Stdout), &outputs); err != nil {
		return application.ProviderResource{}, false, fmt.Errorf("terraform: host %q: unreadable state output: %w", plan.name, err)
	}
	id := outputString(outputs, "instance_id")
	if id == "" {
		return application.ProviderResource{}, false, nil
	}
	return application.ProviderResource{ResourceID: id, PrivateAddress: outputString(outputs, "private_ip")}, true, nil
}

// stateOutput is one entry of `terraform output -json`.
type stateOutput struct {
	Value json.RawMessage `json:"value"`
}

func outputString(outputs map[string]stateOutput, name string) string {
	entry, ok := outputs[name]
	if !ok {
		return ""
	}
	var value string
	if err := json.Unmarshal(entry.Value, &value); err != nil {
		return ""
	}
	return value
}

// initArgs opens exactly one state object: this host's. The key is a
// `-backend-config` argument, so no file, variable, or request can name a state
// path.
func (a *AWS) initArgs(plan hostPlan) []string {
	return []string{
		"init",
		"-input=false",
		"-no-color",
		"-reconfigure",
		"-backend-config=bucket=" + a.stateBucket,
		"-backend-config=key=" + plan.stateKey,
		"-backend-config=region=" + a.stateRegion,
		"-backend-config=encrypt=true",
	}
}

// varArgs is the variable set shared by apply and destroy: Terraform needs every
// declared variable on both, so the destroy runs with the identical shape the
// create used.
func (a *AWS) varArgs(plan hostPlan) []string {
	return []string{
		"-var", "host_name=" + plan.name,
		"-var", "profile=" + plan.profile,
		"-var", "size_key=" + plan.size,
		"-var", "instance_type=" + plan.instanceType,
		"-var", "disk_gb=" + strconv.Itoa(plan.diskGB),
		"-var", "vpc_id=" + plan.vpcID,
		"-var", "subnet_id=" + plan.subnetID,
		"-var", "owner=" + plan.ownerTag,
		"-var", "test_run=" + a.testRunTag,
		"-var", "bootstrap_ssh_cidr=" + a.bootstrapCIDR,
		"-var", "ssh_public_key=" + a.sshPublicKey,
	}
}

func (a *AWS) applyArgs(plan hostPlan) []string {
	return append([]string{"apply", "-input=false", "-auto-approve", "-no-color"}, a.varArgs(plan)...)
}

func (a *AWS) destroyArgs(plan hostPlan) []string {
	return append([]string{"destroy", "-input=false", "-auto-approve", "-no-color"}, a.varArgs(plan)...)
}

// invoke runs one Terraform command in this host's working directory.
func (a *AWS) invoke(ctx context.Context, plan hostPlan, args ...string) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, a.timeout)
	defer cancel()
	result, err := a.runner.Run(ctx, Command{
		Dir:  plan.workDir,
		Name: a.binary,
		Args: args,
		Env:  a.env(),
	})
	if err != nil {
		return result, &InvocationError{Step: args[0], Host: plan.name, Stderr: truncate(result.Stderr), Err: err}
	}
	return result, nil
}

// env pins the automation behavior and the default region of the process.
func (a *AWS) env() []string {
	return []string{
		"TF_IN_AUTOMATION=1",
		"TF_INPUT=0",
		"CHECKPOINT_DISABLE=1",
		"AWS_DEFAULT_REGION=" + ApprovedRegion,
	}
}

// InvocationError reports a failed Terraform run. It carries the step, the host,
// and a bounded tail of stderr. No credential is ever passed to Terraform, so
// there is nothing else to redact.
type InvocationError struct {
	Step   string
	Host   string
	Stderr string
	Err    error
}

func (e *InvocationError) Error() string {
	message := fmt.Sprintf("terraform %s failed for host %q", e.Step, e.Host)
	if e.Stderr != "" {
		message += ": " + e.Stderr
	}
	return message
}

// Unwrap exposes the process error so callers can test for cancellation.
func (e *InvocationError) Unwrap() error { return e.Err }

func hostLockKey(name string) string { return "host:" + name }
func stateLockKey(key string) string { return "state:" + key }
func containsString(vs []string, want string) bool {
	for _, v := range vs {
		if v == want {
			return true
		}
	}
	return false
}

// validateTemplateRoot proves the configured directory is the Terraform root
// and not, say, a service subdirectory that happens to exist.
func validateTemplateRoot(dir string) error {
	if dir == "" {
		return errors.New("terraform: template root is required")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("terraform: read template root: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".tf") {
			return nil
		}
	}
	return fmt.Errorf("terraform: template root %s has no .tf file", dir)
}

// readSSHPublicKey loads public key material and refuses anything else. The
// resulting value is the only key material the adapter ever holds.
func readSSHPublicKey(file string) (string, error) {
	if file == "" {
		return "", errors.New("terraform: SSH public key file is required")
	}
	if !strings.HasSuffix(file, ".pub") {
		return "", fmt.Errorf("terraform: SSH public key file %q must be a .pub file", file)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return "", fmt.Errorf("terraform: read SSH public key file: %w", err)
	}
	key := strings.TrimSpace(string(raw))
	if err := domain.ValidateSSHPublicKey(key); err != nil {
		return "", fmt.Errorf("terraform: SSH public key file %q: %w", file, err)
	}
	return key, nil
}

func isTemplateFile(name string) bool {
	if strings.HasPrefix(name, ".") {
		return false
	}
	for _, extension := range templateExtensions {
		if strings.HasSuffix(name, extension) {
			return true
		}
	}
	return false
}

func truncate(text string) string {
	text = strings.TrimSpace(text)
	if len(text) <= maxDiagnostic {
		return text
	}
	return text[len(text)-maxDiagnostic:]
}
