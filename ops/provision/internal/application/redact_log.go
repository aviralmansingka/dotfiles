package application

import (
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// RedactingLogger decorates a Logger so that no credential shape can reach the
// log sink even if a caller passes one by mistake.
//
// The service already refuses to log secret values by construction — ports carry
// references, domain.Secret renders as "[redacted]", and every error is
// sanitized before it becomes a JobError. This wrapper is the last line of that
// defence: it runs the same scrubber over the message and every string, byte
// slice, and error value, so a raw provider message, a URL with inline
// credentials, or a base64 blob that reached a log call by accident is redacted
// there rather than trusted to the caller.
type RedactingLogger struct {
	inner ports.Logger
}

var _ ports.Logger = RedactingLogger{}

// NewRedactingLogger wraps inner. A nil inner yields a logger that drops lines:
// there is no useful sink to write to, and silently forwarding would hide the
// misconfiguration.
func NewRedactingLogger(inner ports.Logger) ports.Logger {
	if inner == nil {
		return NoopLogger{}
	}
	return RedactingLogger{inner: inner}
}

// NoopLogger discards every line.
type NoopLogger struct{}

// Info implements Logger.
func (NoopLogger) Info(string, ...any) {}

// Warn implements Logger.
func (NoopLogger) Warn(string, ...any) {}

// Error implements Logger.
func (NoopLogger) Error(string, ...any) {}

// Info implements Logger.
func (l RedactingLogger) Info(msg string, kv ...any) {
	l.inner.Info(domain.SanitizeMessage(msg), redactArgs(kv)...)
}

// Warn implements Logger.
func (l RedactingLogger) Warn(msg string, kv ...any) {
	l.inner.Warn(domain.SanitizeMessage(msg), redactArgs(kv)...)
}

// Error implements Logger.
func (l RedactingLogger) Error(msg string, kv ...any) {
	l.inner.Error(domain.SanitizeMessage(msg), redactArgs(kv)...)
}

// redactArgs scrubs the value half of a key/value list. Attribute names are
// structural and pass through so a redacted line still says which field was
// involved — except that a name which itself names a credential takes its value
// with it, because such a value is a secret whatever it looks like.
func redactArgs(kv []any) []any {
	if len(kv) == 0 {
		return nil
	}
	out := make([]any, len(kv))
	for i, value := range kv {
		if i%2 == 0 {
			if key, ok := value.(string); ok {
				out[i] = key
				continue
			}
		}
		if i%2 == 1 && sensitiveKeyAt(kv, i-1) {
			out[i] = redactedPlaceholder
			continue
		}
		out[i] = redactValue(value)
	}
	return out
}

const redactedPlaceholder = "[redacted]"

func sensitiveKeyAt(kv []any, index int) bool {
	key, ok := kv[index].(string)
	return ok && domain.SensitiveKey(key)
}

func redactValue(value any) any {
	switch v := value.(type) {
	case string:
		return domain.SanitizeMessage(v)
	case []byte:
		return domain.SanitizeMessage(string(v))
	case error:
		return domain.SanitizeMessage(v.Error())
	default:
		return value
	}
}
