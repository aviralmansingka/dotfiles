package token_test

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/token"
)

// TestDigestKnownInputs pins the exact bytes a client token digests to, so a
// change to the hash, the encoding, or the length is a test failure and never
// silently an authentication change.
func TestDigestKnownInputs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		label string
		token string
		want  string
	}{
		{
			label: "client token",
			token: "client-token",
			want:  "acf6b6f1c492a018d86d7bdb01852131ea7533992c5a0246d24c4ec74b56aff0",
		},
		{
			label: "offline test token",
			token: "offline-test-token-4f2c9a1b7e",
			want:  "c686b2beed3a589935b65247819128eb2e6d779b726d8c41869bfe15e13c757b",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.label, func(t *testing.T) {
			t.Parallel()
			if got := token.Digest(tc.token); got != tc.want {
				t.Fatalf("Digest(%q) = %q, want %q", tc.token, got, tc.want)
			}
		})
	}
}

// TestDigestEmptyStringIsSHA256OfEmptyInput proves the empty string is not a
// special case: it digests exactly as SHA-256 of zero bytes.
func TestDigestEmptyStringIsSHA256OfEmptyInput(t *testing.T) {
	t.Parallel()
	const want = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if got := token.Digest(""); got != want {
		t.Fatalf("Digest(\"\") = %q, want %q", got, want)
	}
	sum := sha256.Sum256(nil)
	if encoded := hex.EncodeToString(sum[:]); encoded != want {
		t.Fatalf("SHA-256 of empty input = %q, want %q", encoded, want)
	}
}

// TestDigestIsLowercaseHex64 fixes the wire shape: 64 lowercase hex characters,
// which is what a token file row and a lookup key are written as.
func TestDigestIsLowercaseHex64(t *testing.T) {
	t.Parallel()
	for _, input := range []string{"client-token", "", "  padded  ", "ünïcode-☃", "a"} {
		digest := token.Digest(input)
		if len(digest) != 64 {
			t.Fatalf("Digest(%q) length = %d, want 64", input, len(digest))
		}
		for _, r := range digest {
			if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
				t.Fatalf("Digest(%q) = %q contains %q, want lowercase hex only", input, digest, r)
			}
		}
	}
}
