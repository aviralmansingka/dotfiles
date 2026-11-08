// Package tokenstore loads client token digests from a protected YAML file.
// Only SHA-256 digests are stored server-side; the plaintext token exists in a
// mode-0600 client file and in one Authorization header.
package tokenstore

import (
	"context"
	"fmt"
	"os"
	"regexp"

	"go.yaml.in/yaml/v3"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

var digestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Document is the on-disk shape of the token digest file.
type Document struct {
	Clients []Client `yaml:"clients"`
}

// Client is one issued token record.
type Client struct {
	ClientID    string `yaml:"client_id"`
	TokenSHA256 string `yaml:"token_sha256"`
	Description string `yaml:"description"`
	Revoked     bool   `yaml:"revoked"`
}

// File is the loaded token digest set.
type File struct {
	records map[string]application.TokenRecord
}

// Load reads the digest file. A missing, empty, or malformed file is an error:
// the API must not start with an accidental open-door token set.
func Load(path string) (*File, error) {
	if path == "" {
		return nil, fmt.Errorf("tokenstore: path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("tokenstore: stat %s: %w", path, err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("tokenstore: %s must not be group or world accessible (mode %04o)", path, info.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("tokenstore: read %s: %w", path, err)
	}
	var doc Document
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("tokenstore: decode %s: %w", path, err)
	}
	return New(doc.Clients)
}

// New validates records into a token store.
func New(clients []Client) (*File, error) {
	if len(clients) == 0 {
		return nil, fmt.Errorf("tokenstore: at least one client token digest is required")
	}
	records := make(map[string]application.TokenRecord, len(clients))
	for _, client := range clients {
		if client.ClientID == "" {
			return nil, fmt.Errorf("tokenstore: client_id is required")
		}
		if !digestPattern.MatchString(client.TokenSHA256) {
			return nil, fmt.Errorf("tokenstore: client %q: token_sha256 must be 64 lowercase hex characters", client.ClientID)
		}
		if _, dup := records[client.TokenSHA256]; dup {
			return nil, fmt.Errorf("tokenstore: duplicate token digest for client %q", client.ClientID)
		}
		records[client.TokenSHA256] = application.TokenRecord{
			ClientID:    client.ClientID,
			Description: client.Description,
			Revoked:     client.Revoked,
		}
	}
	return &File{records: records}, nil
}

// LookupToken implements application.TokenStore. It never sees a plaintext
// token, only a digest.
func (f *File) LookupToken(_ context.Context, tokenDigestHex string) (application.TokenRecord, bool, error) {
	record, ok := f.records[tokenDigestHex]
	return record, ok, nil
}

// ValidateTokenFile is a startup guard used by the API command: it proves the
// digest file is readable and well-formed before the listener opens.
func ValidateTokenFile(path string) error {
	_, err := Load(path)
	return err
}
