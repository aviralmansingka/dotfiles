package tokenstore_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/tokenstore"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

// plaintextToken is a stand-in client token used only inside tests. The file that
// reaches the server must contain its digest, never the token itself.
const plaintextToken = "offline-test-token-4f2c9a1b7e"

func writeTokenFile(t *testing.T, dir, contents string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(dir, "tokens.yaml")
	if err := os.WriteFile(path, []byte(contents), mode); err != nil {
		t.Fatalf("write token file: %v", err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatalf("chmod token file: %v", err)
	}
	return path
}

func digestFileContents(extra string) string {
	return fmt.Sprintf(`clients:
  - client_id: test-client
    token_sha256: %s
    description: offline test client
  - client_id: revoked-client
    token_sha256: %s
    description: revoked client
    revoked: true
%s`, application.TokenDigest(plaintextToken), application.TokenDigest("offline-revoked-token"), extra)
}

// TestTokenFileStoresOnlyDigests covers the "tokens stored only as digests" half
// of acceptance criterion 1: the store is keyed by SHA-256 digest, so the
// plaintext token is not a lookup key, and the on-disk document holds no token.
func TestTokenFileStoresOnlyDigests(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := writeTokenFile(t, dir, digestFileContents(""), 0o600)

	loaded, err := tokenstore.Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	ctx := context.Background()

	digest := application.TokenDigest(plaintextToken)
	record, found, err := loaded.LookupToken(ctx, digest)
	if err != nil || !found {
		t.Fatalf("digest lookup: found=%v err=%v", found, err)
	}
	if record.ClientID != "test-client" || record.Revoked {
		t.Fatalf("record = %+v, want test-client and not revoked", record)
	}

	if _, found, _ := loaded.LookupToken(ctx, plaintextToken); found {
		t.Fatal("the plaintext token must not be a valid lookup key")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read token file: %v", err)
	}
	if strings.Contains(string(raw), plaintextToken) {
		t.Fatal("the token file must not contain the plaintext token")
	}
	if !strings.Contains(string(raw), digest) {
		t.Fatal("the token file must contain the digest")
	}

	revoked, found, err := loaded.LookupToken(ctx, application.TokenDigest("offline-revoked-token"))
	if err != nil || !found {
		t.Fatalf("revoked digest lookup: found=%v err=%v", found, err)
	}
	if !revoked.Revoked {
		t.Fatal("the revoked record must stay marked revoked")
	}
}

// TestTokenFileRejectsPlaintextAndMalformedDigests proves the store refuses to
// start on a document that would make the API an open door or a plaintext store.
func TestTokenFileRejectsPlaintextAndMalformedDigests(t *testing.T) {
	t.Parallel()
	cases := []struct {
		label    string
		contents string
	}{
		{
			label: "plaintext token instead of a digest",
			contents: `clients:
  - client_id: test-client
    token_sha256: ` + plaintextToken + "\n",
		},
		{
			label:    "empty document",
			contents: "clients: []\n",
		},
		{
			label:    "missing client_id",
			contents: "clients:\n  - token_sha256: " + application.TokenDigest("x") + "\n",
		},
		{
			label: "duplicate digest",
			contents: `clients:
  - client_id: one
    token_sha256: ` + application.TokenDigest("dup") + `
  - client_id: two
    token_sha256: ` + application.TokenDigest("dup") + "\n",
		},
		{
			label:    "uppercase digest",
			contents: "clients:\n  - client_id: one\n    token_sha256: " + strings.ToUpper(application.TokenDigest("up")) + "\n",
		},
		{
			label:    "short digest",
			contents: "clients:\n  - client_id: one\n    token_sha256: abcdef\n",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.label, func(t *testing.T) {
			t.Parallel()
			path := writeTokenFile(t, t.TempDir(), tc.contents, 0o600)
			if _, err := tokenstore.Load(path); err == nil {
				t.Fatalf("Load accepted %s", tc.label)
			}
		})
	}
}

// TestTokenFileRequiresOwnerOnlyMode keeps a world-readable digest file from
// being an accepted deployment.
func TestTokenFileRequiresOwnerOnlyMode(t *testing.T) {
	t.Parallel()
	path := writeTokenFile(t, t.TempDir(), digestFileContents(""), 0o644)
	if _, err := tokenstore.Load(path); err == nil {
		t.Fatal("Load accepted a group/world-readable token file")
	} else if !strings.Contains(err.Error(), "group or world accessible") {
		t.Fatalf("Load error = %q, want it to explain the file mode", err)
	}
}

// TestLoadRequiresAPath keeps the composition root from starting with an empty
// token source.
func TestLoadRequiresAPath(t *testing.T) {
	t.Parallel()
	if _, err := tokenstore.Load(""); err == nil {
		t.Fatal("Load(\"\") must fail")
	}
	if err := tokenstore.ValidateTokenFile(""); err == nil {
		t.Fatal("ValidateTokenFile(\"\") must fail")
	}
}
