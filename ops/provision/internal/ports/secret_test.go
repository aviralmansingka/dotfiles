package ports_test

import (
	"context"
	"errors"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// failingSource is a SecretSource that always fails.
type failingSource struct{}

func (failingSource) FetchSecret(context.Context, string) (domain.Secret, error) {
	return domain.Secret{}, errors.New("openbao: permission denied")
}

// emptySource returns an empty value.
type emptySource struct{}

func (emptySource) FetchSecret(context.Context, string) (domain.Secret, error) {
	return domain.NewSecret("bao:secret/data/fleet/x", nil), nil
}

// TestFetchSecretFromFailsClosed proves every failure mode of a credential read is
// an error, so a blank key can never be delivered to a host.
func TestFetchSecretFromFailsClosed(t *testing.T) {
	t.Parallel()
	const ref = "bao:secret/data/fleet/x"
	if _, err := ports.FetchSecretFrom(context.Background(), nil, ref); err == nil {
		t.Fatal("a nil secret source must be refused")
	}
	if _, err := ports.FetchSecretFrom(context.Background(), failingSource{}, ref); err == nil {
		t.Fatal("a failing read must be refused")
	}
	if _, err := ports.FetchSecretFrom(context.Background(), emptySource{}, ref); err == nil {
		t.Fatal("an empty secret must be refused")
	}
	if _, err := ports.FetchSecretFrom(context.Background(), failingSource{}, "--api-key"); err == nil {
		t.Fatal("an invalid reference must be refused before the read")
	}
}
