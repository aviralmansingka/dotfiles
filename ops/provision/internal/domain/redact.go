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
//
// The scheme-qualified credential forms come first: in
// "authorization: Bearer <value>" the generic key=value rule would match only as
// far as the scheme keyword and leave the value in place, so the bearer and basic
// rules have to consume the pair before that rule runs.
var secretValuePatterns = []*regexp.Regexp{
	// Bearer tokens and basic-auth headers.
	regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+`),
	regexp.MustCompile(`(?i)\bbasic\s+[A-Za-z0-9+/=]+`),
	// key=value / key: value where the key names a credential.
	regexp.MustCompile(`(?i)\b(api[_-]?key|token|secret|secret[_-]?id|password|passwd|credential|authorization|cookie|private[_-]?key|access[_-]?key|client[_-]?secret|refresh[_-]?token|bearer)\b\s*[:=]\s*"?[^\s"',;]+`),
	// URLs with inline credentials: scheme://user:password@host
	regexp.MustCompile(`([a-z][a-z0-9+.-]*://)[^/@\s]+@`),
	// Credential shapes with a vendor prefix. They are recognized as a class rather
	// than by context, because a prefix is the only thing that makes a short opaque
	// string recognizable at all: a Tailscale key, an OpenBao token, a GitHub token,
	// and an AWS access key id.
	regexp.MustCompile(`(?i)\b(tskey-[A-Za-z0-9_-]+|hvs\.[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b`),
	// Dotted quad + port is allowed (private address); long hex/base64 blobs are not.
	regexp.MustCompile(`\b[A-Fa-f0-9]{40,}\b`),
	regexp.MustCompile(`\b[A-Za-z0-9+/]{60,}={0,2}\b`),
}

var whitespaceRun = regexp.MustCompile(`\s+`)

// sensitiveKeyMarkers name a credential attribute. A log line built from
// key/value pairs is checked by name before its value is even looked at, because
// a value like a 20-character password or a short opaque token has no recognizable
// shape to match on: the only thing that makes it a secret is the field it was
// passed under.
var sensitiveKeyMarkers = []string{
	"password", "passwd", "passphrase", "secret", "token", "apikey", "api_key", "api-key",
	"credential", "authorization", "cookie", "private_key", "private-key", "access_key",
	"access-key", "bearer", "salt",
}

// SensitiveKey reports whether an attribute name names a credential whose value
// must never be written to a log, an error, or a record.
func SensitiveKey(name string) bool {
	normalized := strings.ToLower(strings.TrimSpace(name))
	if normalized == "" {
		return false
	}
	for _, marker := range sensitiveKeyMarkers {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

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
