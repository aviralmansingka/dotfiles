package domain

import (
	"regexp"
	"strings"
)

const maxSanitizedMessageLen = 200

// secretValuePatterns redact value shapes that must never reach a log, an API
// error, a workflow payload, or a job record. Each match is replaced by a
// placeholder, keeping the surrounding words so an operator can still tell what
// failed.
var secretValuePatterns = []*regexp.Regexp{
	// key=value / key: value where the key names a credential.
	regexp.MustCompile(`(?i)\b(api[_-]?key|token|secret|secret[_-]?id|password|passwd|credential|authorization|cookie|private[_-]?key|access[_-]?key|client[_-]?secret|refresh[_-]?token|bearer)\b\s*[:=]\s*"?[^\s"',;]+`),
	// Bearer tokens and basic-auth headers.
	regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+`),
	regexp.MustCompile(`(?i)\bbasic\s+[A-Za-z0-9+/=]+`),
	// URLs with inline credentials: scheme://user:password@host
	regexp.MustCompile(`([a-z][a-z0-9+.-]*://)[^/@\s]+@`),
	// Dotted quad + port is allowed (private address); long hex/base64 blobs are not.
	regexp.MustCompile(`\b[A-Fa-f0-9]{40,}\b`),
	regexp.MustCompile(`\b[A-Za-z0-9+/]{60,}={0,2}\b`),
}

var whitespaceRun = regexp.MustCompile(`\s+`)

// SanitizeMessage reduces an arbitrary error or provider message to a bounded,
// credential-free sentence suitable for a job record, an API response, or a log.
func SanitizeMessage(message string) string {
	out := strings.TrimSpace(message)
	if out == "" {
		return "operation failed"
	}
	for _, pattern := range secretValuePatterns {
		out = pattern.ReplaceAllStringFunc(out, func(match string) string {
			// Keep the leading key when the match looks like key=value so the
			// message still names the failing field.
			if idx := strings.IndexAny(match, ":="); idx > 0 {
				key := strings.TrimSpace(match[:idx])
				if strings.ContainsAny(key, " \t") {
					return "[redacted]"
				}
				return key + "=[redacted]"
			}
			if strings.HasPrefix(strings.ToLower(match), "bearer") || strings.HasPrefix(strings.ToLower(match), "basic") {
				return "[redacted]"
			}
			if strings.Contains(match, "://") {
				return match[:strings.Index(match, "://")+3] + "[redacted]@"
			}
			return "[redacted]"
		})
	}
	out = whitespaceRun.ReplaceAllString(out, " ")
	if len(out) > maxSanitizedMessageLen {
		out = out[:maxSanitizedMessageLen] + "…"
	}
	return out
}
