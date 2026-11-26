package domain_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const secretValue = "fake-credential-value-9f3a"

// TestSecretRefusesToRenderItsValue is the redaction rule a credential value
// depends on: every formatting path a log line, an error, or a payload can take
// produces a placeholder.
func TestSecretRefusesToRenderItsValue(t *testing.T) {
	t.Parallel()
	secret := domain.NewSecret("bao:secret/data/fleet/x", []byte(secretValue))
	if secret.Ref() != "bao:secret/data/fleet/x" {
		t.Fatalf("ref = %q, want the reference", secret.Ref())
	}
	if secret.Len() != len(secretValue) {
		t.Fatalf("len = %d, want %d", secret.Len(), len(secretValue))
	}
	for _, rendered := range []string{
		fmt.Sprintf("%v", secret),
		fmt.Sprintf("%s", secret),
		fmt.Sprintf("%#v", secret),
		fmt.Sprint(secret),
	} {
		if strings.Contains(rendered, secretValue) {
			t.Fatalf("rendered secret leaked the value: %s", rendered)
		}
		if rendered != "[redacted]" {
			t.Fatalf("rendered secret = %q, want [redacted]", rendered)
		}
	}
	encoded, err := json.Marshal(struct {
		Value domain.Secret `json:"value"`
	}{secret})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), secretValue) || !strings.Contains(string(encoded), "[redacted]") {
		t.Fatalf("JSON form = %s, want a redacted placeholder", encoded)
	}
}

// TestSecretCopiesInAndOut proves a caller cannot alias the buffer: mutating the
// returned slice or the input slice cannot change what the secret holds.
func TestSecretCopiesInAndOut(t *testing.T) {
	t.Parallel()
	input := []byte(secretValue)
	secret := domain.NewSecret("bao:secret/data/fleet/x", input)
	for i := range input {
		input[i] = 'x'
	}
	first := secret.Bytes()
	if string(first) != secretValue {
		t.Fatalf("the secret followed a mutation of the input slice")
	}
	for i := range first {
		first[i] = 'y'
	}
	if string(secret.Bytes()) != secretValue {
		t.Fatalf("the secret followed a mutation of the returned slice")
	}
}

// TestSecretDestroyZeroesTheValue proves the value can be cleared after use.
func TestSecretDestroyZeroesTheValue(t *testing.T) {
	t.Parallel()
	secret := domain.NewSecret("bao:secret/data/fleet/x", []byte(secretValue))
	secret.Destroy()
	if !secret.Empty() || secret.Len() != 0 {
		t.Fatalf("destroyed secret still holds %d bytes", secret.Len())
	}
	if secret.Bytes() != nil {
		t.Fatal("Bytes() after Destroy must return nothing")
	}
}
