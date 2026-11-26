package ports

import (
	"context"
	"fmt"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// SecretSource reads a credential by reference. Implementations hold the
// credential store's own access token outside the request path: the reference is
// the only credential-shaped value that travels, and no literal, environment
// variable read at call time, or command argument can substitute for it.
type SecretSource interface {
	FetchSecret(ctx context.Context, ref string) (domain.Secret, error)
}

// FetchSecretFrom reads ref from src and refuses an empty value. Every enrollment
// credential goes through this helper, so "empty secret means failure" is one
// rule rather than a check each adapter remembers.
func FetchSecretFrom(ctx context.Context, src SecretSource, ref string) (domain.Secret, error) {
	if src == nil {
		return domain.Secret{}, fmt.Errorf("secret source is not configured")
	}
	if err := domain.ValidateSecretRef(ref); err != nil {
		return domain.Secret{}, err
	}
	secret, err := src.FetchSecret(ctx, ref)
	if err != nil {
		return domain.Secret{}, fmt.Errorf("read secret %s: %w", ref, err)
	}
	if secret.Empty() {
		return domain.Secret{}, fmt.Errorf("secret %s is empty", ref)
	}
	if strings.TrimSpace(string(secret.Bytes())) == "" {
		return domain.Secret{}, fmt.Errorf("secret %s is blank", ref)
	}
	return secret, nil
}
