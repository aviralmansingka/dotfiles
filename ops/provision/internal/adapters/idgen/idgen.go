// Package idgen generates opaque resource identifiers from crypto/rand.
package idgen

import (
	"crypto/rand"
	"encoding/hex"
)

// Generator implements application.IDGenerator.
type Generator struct {
	// Bytes is the random suffix width. The zero value means 12 bytes (96 bits).
	Bytes int
}

// NewID returns "<prefix>-<hex>". The prefix is a fixed internal label, never
// client input.
func (g Generator) NewID(prefix string) string {
	width := g.Bytes
	if width <= 0 {
		width = 12
	}
	buf := make([]byte, width)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failure means the process cannot produce safe identifiers.
		panic("idgen: crypto/rand unavailable: " + err.Error())
	}
	return prefix + "-" + hex.EncodeToString(buf)
}
