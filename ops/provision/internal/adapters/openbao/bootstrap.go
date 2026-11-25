package openbao

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// bootstrapFileName is the one file a host reads to unwrap its SecretID. The name
// is fixed so the host command needs no argument carrying anything.
const bootstrapFileName = "approle-wrap-token"

// bootstrapDirMode and bootstrapFileMode are the only modes this adapter creates.
// A wrapping token is a credential: its directory is unreadable to group and
// world, and the file itself is owner-only.
const (
	bootstrapDirMode  = 0o700
	bootstrapFileMode = 0o600
)

// BootstrapConfig locates the delivery directory. It holds a path, nothing else:
// no token has a field here.
type BootstrapConfig struct {
	// Dir is the parent directory. One subdirectory per host is created under it.
	Dir string
}

// BootstrapWriter delivers one-use wrapping tokens as owner-only files. It is the
// only place in the service that writes bootstrap material, which is what makes
// the "0600, outside every record store, no argv" property checkable in one test.
type BootstrapWriter struct {
	dir string
}

var _ application.BootstrapDelivery = (*BootstrapWriter)(nil)

// NewBootstrapWriter validates the directory before any host is authorized. The
// refusal list is the step's list: not the Nix store, not a Git checkout, not
// Terraform state, and not the filesystem root.
func NewBootstrapWriter(cfg BootstrapConfig) (*BootstrapWriter, error) {
	dir, err := validateBootstrapDir(cfg.Dir)
	if err != nil {
		return nil, err
	}
	return &BootstrapWriter{dir: dir}, nil
}

// DeliverBootstrap writes the wrapping token for one host and returns its path.
// The path is safe to log and to hand to an operator; the token is not, and it is
// never part of the return value.
func (w *BootstrapWriter) DeliverBootstrap(_ context.Context, material application.BootstrapMaterial) (string, error) {
	if err := domain.ValidateHostID(material.HostID); err != nil {
		return "", err
	}
	token := material.WrapTok.Bytes()
	defer clear(token)
	if len(token) == 0 {
		return "", errors.New("openbao: refusing to deliver an empty wrapping token")
	}
	hostDir := filepath.Join(w.dir, material.HostID)
	if err := os.MkdirAll(hostDir, bootstrapDirMode); err != nil {
		return "", fmt.Errorf("openbao: create bootstrap directory: %w", err)
	}
	// MkdirAll does not tighten an existing directory, and a directory created by a
	// previous run with a looser mode would make the token readable. Set the mode
	// explicitly on every delivery.
	if err := os.Chmod(hostDir, bootstrapDirMode); err != nil {
		return "", fmt.Errorf("openbao: set bootstrap directory mode: %w", err)
	}
	path := filepath.Join(hostDir, bootstrapFileName)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, bootstrapFileMode)
	if err != nil {
		return "", fmt.Errorf("openbao: create bootstrap file: %w", err)
	}
	if _, err := file.Write(token); err != nil {
		_ = file.Close()
		return "", fmt.Errorf("openbao: write bootstrap file: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("openbao: close bootstrap file: %w", err)
	}
	// The creation mode is subject to the process umask, so assert the mode the
	// contract requires rather than the mode that was requested.
	if err := os.Chmod(path, bootstrapFileMode); err != nil {
		return "", fmt.Errorf("openbao: set bootstrap file mode: %w", err)
	}
	return path, nil
}

// validateBootstrapDir enforces the delivery-location rules. Each rule exists
// because the location it refuses is a place a credential is copied, committed, or
// world-readable: a Nix store path is world-readable and immutable, a Git checkout
// is committed, and Terraform state is uploaded and shared.
func validateBootstrapDir(dir string) (string, error) {
	if strings.TrimSpace(dir) == "" {
		return "", errors.New("openbao: bootstrap directory is required")
	}
	if strings.ContainsAny(dir, "\t\r\n") {
		return "", errors.New("openbao: bootstrap directory must not contain whitespace or control characters")
	}
	clean := filepath.Clean(dir)
	if !filepath.IsAbs(clean) {
		return "", errors.New("openbao: bootstrap directory must be an absolute path")
	}
	if clean == string(filepath.Separator) {
		return "", errors.New("openbao: bootstrap directory must not be the filesystem root")
	}
	slashed := filepath.ToSlash(clean)
	if slashed == "/nix/store" || strings.HasPrefix(slashed, "/nix/store/") {
		return "", errors.New("openbao: bootstrap directory must not be in the Nix store")
	}
	segments := strings.Split(slashed, "/")
	for _, segment := range segments {
		switch segment {
		case ".git", ".terraform":
			return "", fmt.Errorf("openbao: bootstrap directory must not contain a %q segment", segment)
		}
	}
	if strings.HasSuffix(slashed, ".tfstate") || strings.HasSuffix(slashed, ".tfstate.d") {
		return "", errors.New("openbao: bootstrap directory must not be Terraform state")
	}
	// Walk the parents for a Git checkout. The segment check above catches the
	// directory itself; this catches the much more common case of a bootstrap
	// directory inside a worktree.
	for parent := clean; ; parent = filepath.Dir(parent) {
		if _, err := os.Stat(filepath.Join(parent, ".git")); err == nil {
			return "", fmt.Errorf("openbao: bootstrap directory %s is inside a Git checkout", clean)
		}
		next := filepath.Dir(parent)
		if next == parent {
			break
		}
	}
	return clean, nil
}

// BootstrapAge reports how long ago a delivered file was written, so an operator
// command can refuse a stale wrapping token before a host tries to unwrap it.
func BootstrapAge(path string, now time.Time) (time.Duration, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("openbao: stat bootstrap file: %w", err)
	}
	return now.Sub(info.ModTime()), nil
}
