package ssm

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// ValidateParameterName enforces the shape of an enrollment parameter path. The
// rule lives in the domain, because the configuration, the Terraform root, and
// this adapter must agree on it.
func ValidateParameterName(name string) error {
	if err := domain.ValidateParameterName(name); err != nil {
		return fmt.Errorf("ssm: %w", err)
	}
	return nil
}

// ParameterStoreConfig configures the homelab side of the secret handoff.
type ParameterStoreConfig struct {
	Client ClientConfig
	// TempDir is where the private handoff file is created. Defaults to the
	// system temporary directory; tests point it at a temporary directory they
	// own.
	TempDir string
}

// ParameterStore writes and deletes the single-use SecureString that carries one
// enrollment key to one host.
type ParameterStore struct {
	client  *Client
	tempDir string
}

var _ ports.SSMParameterStore = (*ParameterStore)(nil)

// NewParameterStore validates the configuration and builds the store.
func NewParameterStore(cfg ParameterStoreConfig) (*ParameterStore, error) {
	client, err := NewClient(cfg.Client)
	if err != nil {
		return nil, err
	}
	return &ParameterStore{client: client, tempDir: cfg.TempDir}, nil
}

// PutSecureParameter stores the enrollment key as a SecureString under the
// AWS-managed SSM key.
//
// The value must not appear in any argument, so it is handed to the CLI as
// `--value file://<private file>`: the CLI has no stdin form for a parameter
// value, and an argument would be visible in `ps` and in the CLI's own debug
// output. The file lives in a 0700 directory, is created 0600, and is removed
// before this call returns — the same contract as the key file on the host.
//
// There is no --description and no --allowed-pattern: SSM keeps parameter
// metadata, and metadata is no place for a credential or a hint about one.
func (p *ParameterStore) PutSecureParameter(ctx context.Context, req ports.SecureParameterRequest) error {
	if err := ValidateParameterName(req.Name); err != nil {
		return err
	}
	value := req.Value.Bytes()
	defer clear(value)
	if len(value) == 0 {
		return fmt.Errorf("ssm: refusing to store an empty enrollment key at %s", req.Name)
	}

	dir, err := os.MkdirTemp(p.tempDir, "fleet-enroll-param-")
	if err != nil {
		return fmt.Errorf("ssm: create private handoff directory: %w", err)
	}
	defer os.RemoveAll(dir)
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("ssm: set handoff directory mode: %w", err)
	}
	path := filepath.Join(dir, "value")
	if err := os.WriteFile(path, value, 0o600); err != nil {
		return fmt.Errorf("ssm: write handoff file: %w", err)
	}
	// Chmod after the write and assert it: an inherited umask can only make this
	// stricter, and the final mode is then exact rather than incidental.
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("ssm: set handoff file mode: %w", err)
	}

	if _, err := p.client.run(ctx,
		"ssm", "put-parameter",
		"--name", req.Name,
		"--type", "SecureString",
		"--key-id", DefaultKMSKeyID,
		"--value", "file://"+path,
		"--output", "json",
	); err != nil {
		return fmt.Errorf("ssm: store the enrollment parameter %s: %w", req.Name, err)
	}
	return nil
}

// DeleteParameter removes the parameter, and treats "already gone" as success so
// the deletion can run on both the success and the failure path without turning a
// retry into an error.
func (p *ParameterStore) DeleteParameter(ctx context.Context, name string) error {
	if err := ValidateParameterName(name); err != nil {
		return err
	}
	_, err := p.client.run(ctx, "ssm", "delete-parameter", "--name", name, "--output", "json")
	if err == nil {
		return nil
	}
	if notFound(err, "ParameterNotFound", "does not exist") {
		return nil
	}
	return fmt.Errorf("ssm: delete the enrollment parameter %s: %w", name, err)
}
