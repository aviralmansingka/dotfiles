// Package config loads the non-secret service configuration and the approved
// host profiles. It holds credential and flake references only: a literal secret
// value in either file is a configuration error, not a supported input.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"

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
	Logging      Logging             `yaml:"logging"`
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
}

// Credentials references OpenBao paths. It has no field for a credential value,
// so an inline secret in YAML is an unknown field and fails to decode.
type Credentials struct {
	Kind        string `yaml:"kind"`
	RoleIDRef   string `yaml:"role_id_ref"`
	SecretIDRef string `yaml:"secret_id_ref"`
}

// Bootstrap is the approved SSH ingress policy reference for the provider.
type Bootstrap struct {
	SSHSourceRef string `yaml:"ssh_source_ref"`
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
	if aws.Credentials.Kind != "openbao_approle" {
		return errors.New("providers.aws.credentials.kind must be openbao_approle")
	}
	if aws.Credentials.RoleIDRef == "" || aws.Credentials.SecretIDRef == "" {
		return errors.New("providers.aws.credentials.role_id_ref and secret_id_ref are required")
	}
	switch s.Logging.Format {
	case "", "json", "text":
	default:
		return fmt.Errorf("logging.format %q must be json or text", s.Logging.Format)
	}
	return nil
}

// profileDocument is the on-disk profiles file.
type profileDocument struct {
	Profiles []profileSpec `yaml:"profiles"`
}

type profileSpec struct {
	Name          string              `yaml:"name"`
	DisplayName   string              `yaml:"display_name"`
	Provider      string              `yaml:"provider"`
	Regions       []string            `yaml:"regions"`
	Sizes         map[string]sizeSpec `yaml:"sizes"`
	Tags          map[string]string   `yaml:"tags"`
	SecretBundles []string            `yaml:"secret_bundles"`
	FlakeRef      string              `yaml:"flake_ref"`
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
		})
	}
	catalog, err := domain.NewCatalog(profiles)
	if err != nil {
		return domain.Catalog{}, fmt.Errorf("config: %s: %w", path, err)
	}
	return catalog, nil
}
