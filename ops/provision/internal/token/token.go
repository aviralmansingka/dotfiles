// Package token holds the bearer-token digest primitive. It is a leaf package:
// it imports the standard library only, so a caller that needs to hash a token
// does not depend on the use-case layer.
package token

import (
	"crypto/sha256"
	"encoding/hex"
)

// Digest is the server-side representation of a client token.
func Digest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
