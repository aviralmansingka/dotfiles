package application_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

type captureLogger struct{ lines []string }

func (c *captureLogger) Info(msg string, kv ...any)  { c.record("INFO", msg, kv...) }
func (c *captureLogger) Warn(msg string, kv ...any)  { c.record("WARN", msg, kv...) }
func (c *captureLogger) Error(msg string, kv ...any) { c.record("ERROR", msg, kv...) }

func (c *captureLogger) record(level, msg string, kv ...any) {
	var builder strings.Builder
	builder.WriteString(level)
	builder.WriteString(" ")
	builder.WriteString(msg)
	for _, v := range kv {
		builder.WriteString(" ")
		if s, ok := v.(string); ok {
			builder.WriteString(s)
			continue
		}
		builder.WriteString("[non-string]")
	}
	c.lines = append(c.lines, builder.String())
}

func (c *captureLogger) joined() string { return strings.Join(c.lines, "\n") }

// TestRedactingLoggerScrubsCredentialShapesOutOfEveryField is the offline proof
// of the "logs redact credentials" property: a credential value passed as a
// string, a byte slice, or inside an error never reaches the sink, while the
// non-secret diagnosis (which field, which host, which operation) survives.
func TestRedactingLoggerScrubsCredentialShapesOutOfEveryField(t *testing.T) {
	t.Parallel()
	sink := &captureLogger{}
	log := application.NewRedactingLogger(sink)

	log.Info("activity.failed",
		"operation", "create_host_resource",
		"host_id", "host-0001",
		"password", "hunter2-do-not-log",
		"error", errors.New("dial ssh://deploy:s3cr3t@bastion:22 failed"),
		"token", []byte("eyJhbGciOiJIUzI1NiJ9.leaked"),
		"detail", "authorization: Bearer abcdef0123456789",
	)
	log.Error("openbao.token=abcd1234 rejected")

	out := sink.joined()
	for _, forbidden := range []string{"hunter2-do-not-log", "s3cr3t", "eyJhbGciOiJIUzI1NiJ9", "abcdef0123456789", "abcd1234"} {
		if strings.Contains(out, forbidden) {
			t.Fatalf("the logger leaked %q:\n%s", forbidden, out)
		}
	}
	for _, wanted := range []string{"[redacted]", "create_host_resource", "host-0001"} {
		if !strings.Contains(out, wanted) {
			t.Fatalf("the redacted line lost %q:\n%s", wanted, out)
		}
	}
}

// TestRedactingLoggerKeepsOrdinaryDiagnosisReadable guards against a scrubber so
// aggressive that it hides what an operator needs: identifiers, stages, and
// addresses survive untouched.
func TestRedactingLoggerKeepsOrdinaryDiagnosisReadable(t *testing.T) {
	t.Parallel()
	sink := &captureLogger{}
	log := application.NewRedactingLogger(sink)

	log.Info("host.milestone", "host_id", "host-0001", "stage", "deploying", "state", "in_progress", "private_address", "10.99.1.10")

	out := sink.joined()
	for _, wanted := range []string{"host.milestone", "host-0001", "deploying", "in_progress", "10.99.1.10"} {
		if !strings.Contains(out, wanted) {
			t.Fatalf("the logger dropped %q:\n%s", wanted, out)
		}
	}
	if strings.Contains(out, "[redacted]") {
		t.Fatalf("the logger redacted an ordinary line:\n%s", out)
	}
}

// TestNewRedactingLoggerToleratesNoSink proves the nil case cannot panic a
// worker that starts without a configured log sink.
func TestNewRedactingLoggerToleratesNoSink(t *testing.T) {
	t.Parallel()
	log := application.NewRedactingLogger(nil)
	log.Info("worker.starting", "task_queue", "fleet-provision")
	log.Warn("worker.degraded", "error", errors.New("password=hunter2"))
	log.Error("worker.failed")
}
