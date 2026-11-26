package domain

// Credential values. A Secret is the one value type that holds key material: it
// copies its input, refuses every rendering path, and reveals itself only through
// an explicit Bytes call.

// Secret is a credential value that refuses to render itself. Every formatting
// path a log line or a payload could take — %s, %v, %#v, encoding/json — returns
// a placeholder, so a credential can only be revealed by an explicit Bytes call
// at the one place that must use it.
//
// The value is copied in and copied out: a caller cannot alias the buffer, and
// Destroy clears it once the credential has served its purpose.
type Secret struct {
	ref   string
	value []byte
}

// NewSecret wraps a credential value together with the reference it came from.
// The reference is a path, not a value, and is safe to log.
func NewSecret(ref string, value []byte) Secret {
	copied := make([]byte, len(value))
	copy(copied, value)
	return Secret{ref: ref, value: copied}
}

// Ref reports where the secret came from. It is a reference such as
// bao:secret/data/hosts/rex/tailscale, never the value.
func (s Secret) Ref() string { return s.ref }

// Len reports the value length without revealing it.
func (s Secret) Len() int { return len(s.value) }

// Empty reports whether the secret holds no value.
func (s Secret) Empty() bool { return len(s.value) == 0 }

// Bytes returns a copy of the value. This is the only reveal path.
func (s Secret) Bytes() []byte {
	if len(s.value) == 0 {
		return nil
	}
	out := make([]byte, len(s.value))
	copy(out, s.value)
	return out
}

// Destroy zeroes the stored value.
func (s *Secret) Destroy() {
	for i := range s.value {
		s.value[i] = 0
	}
	s.value = nil
}

// String implements fmt.Stringer with a placeholder, so %s and %v cannot leak.
func (s Secret) String() string { return "[redacted]" }

// GoString implements fmt.GoStringer with a placeholder, so %#v cannot leak.
func (s Secret) GoString() string { return "[redacted]" }

// MarshalJSON implements json.Marshaler with a placeholder, so a secret that
// reaches a workflow payload, a job record, or a Terraform variable document
// cannot carry key material.
func (s Secret) MarshalJSON() ([]byte, error) { return []byte(`"[redacted]"`), nil }
