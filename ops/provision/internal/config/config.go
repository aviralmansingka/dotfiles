// Package config loads the non-secret service configuration and the approved
// host profiles. It holds credential and flake references only: a literal secret
// value in either file is a configuration error, not a supported input.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Service is the non-secret service configuration.
type Service struct {
	API          API                 `yaml:"api"`
	Temporal     Temporal            `yaml:"temporal"`
	Storage      Storage             `yaml:"storage"`
	Tokens       Tokens              `yaml:"tokens"`
	ProfilesFile string              `yaml:"profiles_file"`
	Limits       Limits              `yaml:"limits"`
	Providers    map[string]Provider `yaml:"providers"`
	Enrollment   Enrollment          `yaml:"enrollment"`
	OpenBao      OpenBaoIdentity     `yaml:"openbao"`
	Logging      Logging             `yaml:"logging"`
}

// Enrollment locates the enrollment adapters. Every field is a path, a URL, an
// OpenBao reference, or an approved identifier: no credential value has a field
// here, and an inline secret in YAML is an unknown key that fails to decode.
type Enrollment struct {
	Tailscale TailscaleEnrollment `yaml:"tailscale"`
	OpenBao   OpenBaoEnrollment   `yaml:"openbao"`
	SSM       SSMEnrollment       `yaml:"ssm"`
}

// TailscaleEnrollment is the API endpoint and the OAuth client identity.
// OAuthClientID is public; the client secret is read from OAuthSecretRef.
type TailscaleEnrollment struct {
	BaseURL        string `yaml:"base_url"`
	Tailnet        string `yaml:"tailnet"`
	OAuthClientID  string `yaml:"oauth_client_id"`
	OAuthSecretRef string `yaml:"oauth_secret_ref"`
}

// OpenBaoEnrollment locates the OpenBao API and the access-token file. The token
// is read once at start-up from the file, never from the environment at call time.
type OpenBaoEnrollment struct {
	Address   string `yaml:"address"`
	TokenFile string `yaml:"token_file"`
	Namespace string `yaml:"namespace"`
}

// SSMEnrollment is the SSM-only enrollment path: the parameter prefix the
// enrollment key travels under and the host script's settings.
//
// There is no key field here. Every enrollment parameter is encrypted with the
// AWS-managed `alias/aws/ssm` key, which the account already has, so no operator
// creates a KMS key, an alias, or a key policy before the first host.
//
// There is no login key path and no known_hosts directory here either, because
// enrollment opens no SSH connection: the trust anchor is IAM, not a host key. An
// `ssh:` block in the service file is now an unknown key and fails to decode.
type SSMEnrollment struct {
	// Region is the region of the parameter, the command, and the host.
	Region string `yaml:"region"`
	// ParameterPrefix is the store path an enrollment parameter lives under. The
	// Terraform root scopes the instance role to <prefix>/<host_name>/*, so this
	// value and terraform/aws/main.tf must agree.
	ParameterPrefix string `yaml:"parameter_prefix"`
	// HostKeyPath is where the host script writes the key, on tmpfs, mode 0600.
	HostKeyPath string `yaml:"host_key_path"`
	// Binary is the AWS CLI executable the worker drives. Defaults to "aws".
	Binary string `yaml:"binary"`
	// AgentTimeoutSeconds is how long an enrollment waits for the host's SSM agent
	// to register before it fails closed.
	AgentTimeoutSeconds int `yaml:"agent_timeout_seconds"`
	// CommandTimeoutSeconds bounds the one command that delivers a key.
	CommandTimeoutSeconds int `yaml:"command_timeout_seconds"`
	// PollIntervalSeconds is the status poll interval for both waits.
	PollIntervalSeconds int `yaml:"poll_interval_seconds"`
}

// Configured reports whether the enrollment adapters are configured at all. When
// they are not, the worker keeps the refusing stub, so a job cannot reach
// "ready" without a real enrollment.
func (e Enrollment) Configured() bool {
	return e.Tailscale.OAuthSecretRef != "" && e.OpenBao.TokenFile != "" && e.SSM.ParameterPrefix != ""
}

// Validate fails closed on a half-configured enrollment block.
func (e Enrollment) Validate() error {
	if e.Tailscale.OAuthSecretRef == "" && e.OpenBao.TokenFile == "" && e.SSM.ParameterPrefix == "" {
		return nil
	}
	if e.Tailscale.OAuthSecretRef == "" {
		return errors.New("enrollment.tailscale.oauth_secret_ref is required")
	}
	if err := domain.ValidateSecretRef(e.Tailscale.OAuthSecretRef); err != nil {
		return fmt.Errorf("enrollment.tailscale.oauth_secret_ref: %w", err)
	}
	if e.Tailscale.OAuthClientID == "" {
		return errors.New("enrollment.tailscale.oauth_client_id is required")
	}
	if e.OpenBao.TokenFile == "" {
		return errors.New("enrollment.openbao.token_file is required")
	}
	if strings.ContainsAny(e.OpenBao.TokenFile, " \t") {
		return errors.New("enrollment.openbao.token_file must not contain whitespace")
	}
	if e.SSM.Region == "" {
		return errors.New("enrollment.ssm.region is required")
	}
	if err := domain.ValidateAWSRegion(e.SSM.Region); err != nil {
		return fmt.Errorf("enrollment.ssm.region: %w", err)
	}
	if e.SSM.ParameterPrefix == "" {
		return errors.New("enrollment.ssm.parameter_prefix is required: the instance role is scoped to <prefix>/<host_name>/*")
	}
	if err := domain.ValidateParameterName(e.SSM.ParameterPrefix); err != nil {
		return fmt.Errorf("enrollment.ssm.parameter_prefix: %w", err)
	}
	if e.SSM.ParameterPrefix != domain.ApprovedEnrollmentParameterPrefix {
		return fmt.Errorf("enrollment.ssm.parameter_prefix must be the approved %q: terraform/aws/main.tf scopes the instance role to exactly that path",
			domain.ApprovedEnrollmentParameterPrefix)
	}
	if e.SSM.HostKeyPath == "" {
		return errors.New("enrollment.ssm.host_key_path is required: the key file is created on the host and removed after the join")
	}
	if !strings.HasPrefix(e.SSM.HostKeyPath, "/run/") {
		return errors.New("enrollment.ssm.host_key_path must live under /run, so a reboot removes it")
	}
	if e.SSM.Binary != "" && strings.ContainsAny(e.SSM.Binary, "/\\ \t") {
		return fmt.Errorf("enrollment.ssm.binary %q must be a bare executable name", e.SSM.Binary)
	}
	if e.SSM.AgentTimeoutSeconds < 0 || e.SSM.AgentTimeoutSeconds > 3600 {
		return errors.New("enrollment.ssm.agent_timeout_seconds must be between 0 and 3600")
	}
	if e.SSM.CommandTimeoutSeconds < 0 || e.SSM.CommandTimeoutSeconds > 86400 {
		return errors.New("enrollment.ssm.command_timeout_seconds must be between 0 and 86400")
	}
	if e.SSM.PollIntervalSeconds < 0 || e.SSM.PollIntervalSeconds > 300 {
		return errors.New("enrollment.ssm.poll_interval_seconds must be between 0 and 300")
	}
	return nil
}

// OpenBaoIdentity locates the per-host identity adapter: the management API, the
// token file it reads once, and the directory bootstrap material is written to.
// Every field is a path, a URL, or a lifetime; no credential value has a field
// here.
type OpenBaoIdentity struct {
	// Address is the management API base URL.
	Address string `yaml:"address"`
	// TokenFile is a mode-0600 file holding the management token. It is read once
	// at construction and never appears in an argument or a log line.
	TokenFile string `yaml:"token_file"`
	// Namespace is optional (OpenBao Enterprise namespaces).
	Namespace string `yaml:"namespace"`
	// BootstrapDir is where the one-use wrapping token is delivered, one 0600 file
	// per host. It must be a real directory path: never the Nix store, a Git
	// worktree, or Terraform state.
	BootstrapDir string `yaml:"bootstrap_dir"`
	// TokenTTLSeconds is the requested host token lifetime (default 600). The
	// maximum is the step's bound: above zero and at most 900.
	TokenTTLSeconds int `yaml:"token_ttl_seconds"`
	// MaxTokenTTLSeconds is the hard maximum lifetime (default 900, never more).
	MaxTokenTTLSeconds int `yaml:"max_token_ttl_seconds"`
}

// Configured reports whether the identity adapter is configured at all. When it is
// not, the worker keeps the refusing stub, so a job cannot reach "ready" through a
// half-configured identity.
func (o OpenBaoIdentity) Configured() bool {
	return o.Address != "" || o.TokenFile != "" || o.BootstrapDir != ""
}

// TokenTTL returns the configured token lifetime, defaulted and bounded.
func (o OpenBaoIdentity) TokenTTL() time.Duration {
	seconds := o.TokenTTLSeconds
	if seconds == 0 {
		seconds = int(domain.AuthorizationTokenTTL / time.Second)
	}
	return time.Duration(seconds) * time.Second
}

// MaxTokenTTL returns the configured hard maximum, defaulted and bounded.
func (o OpenBaoIdentity) MaxTokenTTL() time.Duration {
	seconds := o.MaxTokenTTLSeconds
	if seconds == 0 {
		seconds = int(domain.MaxAuthorizationTokenTTL / time.Second)
	}
	return time.Duration(seconds) * time.Second
}

// Validate fails closed on a half-configured identity block, and refuses a
// bootstrap directory that is inside a build output, a Git checkout, or Terraform
// state: bootstrap material is a credential and none of those is a place for one.
func (o OpenBaoIdentity) Validate() error {
	if !o.Configured() {
		return nil
	}
	if o.Address == "" {
		return errors.New("openbao.address is required")
	}
	if o.TokenFile == "" {
		return errors.New("openbao.token_file is required")
	}
	if strings.ContainsAny(o.TokenFile, " \t") {
		return errors.New("openbao.token_file must not contain whitespace")
	}
	if o.BootstrapDir == "" {
		return errors.New("openbao.bootstrap_dir is required: the wrapping token is delivered as a 0600 file, never a payload")
	}
	if !filepath.IsAbs(o.BootstrapDir) {
		return errors.New("openbao.bootstrap_dir must be an absolute path")
	}
	if strings.ContainsAny(o.BootstrapDir, "\t") {
		return errors.New("openbao.bootstrap_dir must not contain whitespace")
	}
	clean := filepath.ToSlash(filepath.Clean(o.BootstrapDir))
	if clean == "/nix/store" || strings.HasPrefix(clean, "/nix/store/") {
		return errors.New("openbao.bootstrap_dir must not be in the Nix store: bootstrap material is written at runtime, mode 0600")
	}
	for _, segment := range strings.Split(clean, "/") {
		switch segment {
		case ".git", ".terraform":
			return errors.New("openbao.bootstrap_dir must not be a Git or Terraform directory: bootstrap material is never a tracked or state file")
		}
	}
	if strings.HasSuffix(clean, ".tfstate") || strings.HasSuffix(clean, ".tfstate.d") {
		return errors.New("openbao.bootstrap_dir must not be Terraform state")
	}
	if o.TokenTTLSeconds < 0 || o.MaxTokenTTLSeconds < 0 {
		return errors.New("openbao token lifetimes must not be negative")
	}
	policy := domain.TokenPolicy{
		TTL:            o.TokenTTL(),
		MaxTTL:         o.MaxTokenTTL(),
		RenewIncrement: domain.TokenRenewIncrement,
		Renewable:      true,
	}
	if err := policy.Validate(); err != nil {
		return fmt.Errorf("openbao: %w", err)
	}
	return nil
}

// API is the HTTP listener configuration.
type API struct {
	// Listen defaults to loopback. The client-facing service is published only
	// through Tailscale Serve, so this backend must not face the network.
	Listen string `yaml:"listen"`
	// AllowNonLoopback must be set explicitly to bind off loopback, and TLS is
	// then mandatory.
	AllowNonLoopback bool `yaml:"allow_non_loopback"`
	TLS              TLS  `yaml:"tls"`
}

// TLS points at certificate files; it never embeds key material.
type TLS struct {
	CertFile string `yaml:"cert_file"`
	KeyFile  string `yaml:"key_file"`
}

// Enabled reports whether TLS is configured.
func (t TLS) Enabled() bool { return t.CertFile != "" && t.KeyFile != "" }

// Temporal is the durable-execution connection.
type Temporal struct {
	HostPort  string `yaml:"host_port"`
	Namespace string `yaml:"namespace"`
	TaskQueue string `yaml:"task_queue"`
}

// Storage locates the durable inventory and idempotency document. S06 replaces
// this with PostgreSQL; the path is a non-secret directory reference.
type Storage struct {
	StateFile string `yaml:"state_file"`
}

// Tokens locates the token digest file (digests, never plaintext tokens).
type Tokens struct {
	File string `yaml:"file"`
}

// Limits bounds work.
type Limits struct {
	MaxConcurrentJobs      int `yaml:"max_concurrent_jobs"`
	TerraformStateLocks    int `yaml:"terraform_state_locks"`
	MaxConcurrentProvision int `yaml:"max_concurrent_provisioning"`
}

// Provider is a provider configuration: region plus credential references.
type Provider struct {
	Region      string      `yaml:"region"`
	Credentials Credentials `yaml:"credentials"`
	Bootstrap   Bootstrap   `yaml:"bootstrap"`
	Terraform   Terraform   `yaml:"terraform"`
}

// Credentials references OpenBao paths. It has no field for a credential value,
// so an inline secret in YAML is an unknown field and fails to decode.
type Credentials struct {
	Kind        string `yaml:"kind"`
	RoleIDRef   string `yaml:"role_id_ref"`
	SecretIDRef string `yaml:"secret_id_ref"`
}

// Bootstrap is the approved SSH ingress policy reference for the provider. The
// CIDR and the public key are the values the per-host Terraform root consumes;
// the ref is where the operator keeps the approved value.
type Bootstrap struct {
	SSHSourceRef string `yaml:"ssh_source_ref"`
	// SSHSourceCIDR is the only source address allowed to reach port 22. Empty
	// (the default) means no SSH ingress at all: the host root then emits no
	// ingress rule, which is the zero-ingress default. A non-empty value is
	// validated as IPv4 and no wider than /8, and both wildcards are refused, so
	// 0.0.0.0/0 cannot be configured.
	SSHSourceCIDR string `yaml:"ssh_source_cidr"`
	// SSHPublicKeyFile names a `.pub` file. The adapter reads it and refuses
	// private key material; no key material is stored in this document.
	SSHPublicKeyFile string `yaml:"ssh_public_key_file"`
}

// Terraform locates the per-host AWS entry point. Every field is a path or a
// non-secret label: the credentials the Terraform process runs with are the
// worker's own, acquired from OpenBao, and never appear in this file.
type Terraform struct {
	// Dir is the template root (ops/provision/terraform/aws). It is read, never
	// written.
	Dir string `yaml:"dir"`
	// RunDir holds one working directory per host, and with it one state path
	// per host. Two hosts never share either.
	RunDir string `yaml:"run_dir"`
	// Binary is the Terraform executable, resolved on PATH. Defaults to
	// "terraform".
	Binary string `yaml:"binary"`
	// TimeoutSeconds bounds one Terraform invocation.
	TimeoutSeconds int `yaml:"timeout_seconds"`
	// StateBucket and StateRegion locate the shared S3 bucket for state
	// objects. StateRegion is the bucket's own region, not the resource region:
	// the resources this root creates are all pinned to ap-south-1.
	StateBucket string `yaml:"state_bucket"`
	StateRegion string `yaml:"state_region"`
	// VPCID and SubnetID are the owner-approved network the hosts join. Both are
	// required: the root has no default-VPC fallback, because a default VPC does
	// not exist in every account and region. They are service configuration, not
	// client input, so no request can choose a network.
	VPCID    string `yaml:"vpc_id"`
	SubnetID string `yaml:"subnet_id"`
	// OwnerTag is the value of the approved `owner` tag on every resource, and
	// TestRunTag the `fleet-test-run` value, so a live acceptance run can find
	// and destroy exactly its own hosts.
	OwnerTag   string `yaml:"owner_tag"`
	TestRunTag string `yaml:"test_run_tag"`
}

// Logging configures output shape.
type Logging struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

// LoadService reads and validates the service configuration.
func LoadService(path string) (*Service, error) {
	if path == "" {
		return nil, errors.New("config: service config path is required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read %s: %w", path, err)
	}
	var service Service
	decoder := yaml.NewDecoder(strings.NewReader(string(raw)))
	// Unknown keys are errors: a literal password or token field cannot sneak in.
	decoder.KnownFields(true)
	if err := decoder.Decode(&service); err != nil {
		return nil, fmt.Errorf("config: decode %s: %w", path, err)
	}
	if err := service.Validate(); err != nil {
		return nil, fmt.Errorf("config: %s: %w", path, err)
	}
	return &service, nil
}

// Validate enforces the invariants that keep the backend private.
func (s *Service) Validate() error {
	if s.API.Listen == "" {
		return errors.New("api.listen is required")
	}
	host, _, err := net.SplitHostPort(s.API.Listen)
	if err != nil {
		return fmt.Errorf("api.listen %q is not host:port: %w", s.API.Listen, err)
	}
	address := net.ParseIP(host)
	loopback := address != nil && address.IsLoopback()
	if !loopback && !s.API.AllowNonLoopback {
		return fmt.Errorf("api.listen %q is not loopback; set api.allow_non_loopback only for a documented exception", s.API.Listen)
	}
	if !loopback && !s.API.TLS.Enabled() {
		return errors.New("api.tls.cert_file and api.tls.key_file are required off loopback")
	}
	if s.API.TLS.CertFile != "" && s.API.TLS.KeyFile == "" || s.API.TLS.KeyFile != "" && s.API.TLS.CertFile == "" {
		return errors.New("api.tls.cert_file and api.tls.key_file must be set together")
	}
	if s.Temporal.HostPort == "" {
		return errors.New("temporal.host_port is required")
	}
	if s.Temporal.Namespace == "" {
		return errors.New("temporal.namespace is required")
	}
	if s.Temporal.TaskQueue == "" {
		return errors.New("temporal.task_queue is required")
	}
	if s.Storage.StateFile == "" {
		return errors.New("storage.state_file is required")
	}
	if s.Tokens.File == "" {
		return errors.New("tokens.file is required")
	}
	if s.ProfilesFile == "" {
		return errors.New("profiles_file is required")
	}
	if s.Limits.MaxConcurrentJobs <= 0 || s.Limits.MaxConcurrentJobs > 64 {
		return errors.New("limits.max_concurrent_jobs must be between 1 and 64")
	}
	if s.Limits.TerraformStateLocks <= 0 {
		return errors.New("limits.terraform_state_locks must be at least 1")
	}
	if len(s.Providers) == 0 {
		return errors.New("providers: at least one approved provider is required")
	}
	aws, ok := s.Providers["aws"]
	if !ok {
		return errors.New("providers.aws is required")
	}
	if aws.Region == "" {
		return errors.New("providers.aws.region is required")
	}
	if err := domain.ValidateAWSRegion(aws.Region); err != nil {
		return fmt.Errorf("providers.aws.region: %w", err)
	}
	if aws.Credentials.Kind != "openbao_approle" {
		return errors.New("providers.aws.credentials.kind must be openbao_approle")
	}
	if aws.Credentials.RoleIDRef == "" || aws.Credentials.SecretIDRef == "" {
		return errors.New("providers.aws.credentials.role_id_ref and secret_id_ref are required")
	}
	if err := aws.Bootstrap.Validate(); err != nil {
		return err
	}
	if err := aws.Terraform.Validate(); err != nil {
		return err
	}
	if err := s.Enrollment.Validate(); err != nil {
		return fmt.Errorf("enrollment: %w", err)
	}
	if err := s.OpenBao.Validate(); err != nil {
		return fmt.Errorf("openbao: %w", err)
	}
	switch s.Logging.Format {
	case "", "json", "text":
	default:
		return fmt.Errorf("logging.format %q must be json or text", s.Logging.Format)
	}
	return nil
}

// Validate enforces the approved bootstrap policy: at most one IPv4 CIDR source,
// never a default route, and public key material only. An empty source CIDR is
// the zero-ingress default, not a missing value.
func (b Bootstrap) Validate() error {
	if b.SSHSourceRef == "" {
		return errors.New("providers.aws.bootstrap.ssh_source_ref is required")
	}
	if err := domain.ValidateBootstrapCIDR(b.SSHSourceCIDR); err != nil {
		return fmt.Errorf("providers.aws.bootstrap.ssh_source_cidr: %w", err)
	}
	if b.SSHPublicKeyFile == "" {
		return errors.New("providers.aws.bootstrap.ssh_public_key_file is required")
	}
	if !strings.HasSuffix(b.SSHPublicKeyFile, ".pub") {
		return fmt.Errorf("providers.aws.bootstrap.ssh_public_key_file %q must name a .pub file", b.SSHPublicKeyFile)
	}
	return nil
}

// Validate enforces the per-host Terraform entry point's configuration. Every
// host gets its own run directory and its own state key, so the run directory
// must exist as a distinct path from the template root.
func (t Terraform) Validate() error {
	switch {
	case t.Dir == "":
		return errors.New("providers.aws.terraform.dir is required")
	case t.RunDir == "":
		return errors.New("providers.aws.terraform.run_dir is required")
	case t.StateBucket == "":
		return errors.New("providers.aws.terraform.state_bucket is required")
	case t.StateRegion == "":
		return errors.New("providers.aws.terraform.state_region is required")
	}
	if err := domain.ValidateVPCID(t.VPCID); err != nil {
		return fmt.Errorf("providers.aws.terraform: %w", err)
	}
	if err := domain.ValidateSubnetID(t.SubnetID); err != nil {
		return fmt.Errorf("providers.aws.terraform: %w", err)
	}
	if clean := filepath.Clean(t.Dir); clean == filepath.Clean(t.RunDir) {
		return errors.New("providers.aws.terraform.run_dir must differ from dir; the template root is never written")
	}
	if t.Binary != "" && strings.ContainsAny(t.Binary, "/\\ \t") {
		return fmt.Errorf("providers.aws.terraform.binary %q must be a bare executable name", t.Binary)
	}
	if t.TimeoutSeconds < 0 || t.TimeoutSeconds > 24*60*60 {
		return errors.New("providers.aws.terraform.timeout_seconds must be between 0 and 86400")
	}
	if err := domain.ValidateTagValue("providers.aws.terraform.owner_tag", t.OwnerTag); err != nil {
		return err
	}
	if err := domain.ValidateTagValue("providers.aws.terraform.test_run_tag", t.TestRunTag); err != nil {
		return err
	}
	return nil
}

// profileDocument is the on-disk profiles file.
type profileDocument struct {
	Profiles []profileSpec `yaml:"profiles"`
}

type profileSpec struct {
	Name        string              `yaml:"name"`
	DisplayName string              `yaml:"display_name"`
	Provider    string              `yaml:"provider"`
	Regions     []string            `yaml:"regions"`
	Sizes       map[string]sizeSpec `yaml:"sizes"`
	Tags        map[string]string   `yaml:"tags"`
	// SecretBundles maps a bundle name to a per-host path template. A shared
	// literal path is refused: the template must contain exactly one {host}
	// placeholder in the host segment.
	SecretBundles map[string]string `yaml:"secret_bundles"`
	FlakeRef      string            `yaml:"flake_ref"`
	// TailnetTag is the approved tag hosts of this profile join with. It is the
	// only source of a tag in the service.
	TailnetTag string `yaml:"tailnet_tag"`
}

type sizeSpec struct {
	InstanceType string `yaml:"instance_type"`
	DiskGB       int    `yaml:"disk_gb"`
}

// LoadProfiles reads and validates the approved host profiles.
func LoadProfiles(path string) (domain.Catalog, error) {
	if path == "" {
		return domain.Catalog{}, errors.New("config: profiles path is required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return domain.Catalog{}, fmt.Errorf("config: read %s: %w", path, err)
	}
	var doc profileDocument
	decoder := yaml.NewDecoder(strings.NewReader(string(raw)))
	decoder.KnownFields(true)
	if err := decoder.Decode(&doc); err != nil {
		return domain.Catalog{}, fmt.Errorf("config: decode %s: %w", path, err)
	}
	profiles := make([]domain.Profile, 0, len(doc.Profiles))
	for _, spec := range doc.Profiles {
		sizes := make(map[string]domain.SizeSpec, len(spec.Sizes))
		for name, size := range spec.Sizes {
			sizes[name] = domain.SizeSpec{Name: name, InstanceType: size.InstanceType, DiskGB: size.DiskGB}
		}
		profiles = append(profiles, domain.Profile{
			Name:          spec.Name,
			DisplayName:   spec.DisplayName,
			Provider:      domain.Provider(spec.Provider),
			Regions:       spec.Regions,
			Sizes:         sizes,
			Tags:          spec.Tags,
			SecretBundles: spec.SecretBundles,
			FlakeRef:      spec.FlakeRef,
			TailnetTag:    spec.TailnetTag,
		})
	}
	catalog, err := domain.NewCatalog(profiles)
	if err != nil {
		return domain.Catalog{}, fmt.Errorf("config: %s: %w", path, err)
	}
	return catalog, nil
}
