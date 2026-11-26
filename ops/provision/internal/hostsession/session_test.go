package hostsession_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/hostsession"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

func newSessionHarness(t *testing.T) (*fakes.HostSessions, *fakes.Logger, *hostsession.SessionService) {
	t.Helper()
	client := fakes.NewHostSessions()
	logger := &fakes.Logger{}
	service, err := hostsession.NewSessionService(hostsession.SessionDeps{Client: client, Logger: logger})
	if err != nil {
		t.Fatalf("NewSessionService: %v", err)
	}
	return client, logger, service
}

// TestSessionLoginUnwrapsOnceAndLogsIn is property 3's host half: the wrapping
// token is consumed by the first unwrap, and a replay is refused before a second
// login happens.
func TestSessionLoginUnwrapsOnceAndLogsIn(t *testing.T) {
	t.Parallel()
	client, logger, service := newSessionHarness(t)
	client.IssueWrapToken("wrap-token-one-use")
	wrap := application.NewSecret("bootstrap:wrapping-token", []byte("wrap-token-one-use"))

	session, err := service.LoginFromWrapped(context.Background(), "fleet-host-host-0001", wrap)
	if err != nil {
		t.Fatalf("LoginFromWrapped: %v", err)
	}
	if session.Token.Empty() {
		t.Fatal("login returned no token")
	}
	if session.TTL <= 0 || session.TTL > 900*time.Second {
		t.Fatalf("session TTL = %s, want (0, 900s]", session.TTL)
	}
	if client.UnwrapCount() != 1 || client.LoginCount() != 1 {
		t.Fatalf("unwraps/logins = %d/%d, want 1/1", client.UnwrapCount(), client.LoginCount())
	}

	_, err = service.LoginFromWrapped(context.Background(), "fleet-host-host-0001", wrap)
	if err == nil {
		t.Fatal("a replay of the wrapping token must fail")
	}
	var consumed *domain.WrapTokenConsumedError
	if !errors.As(err, &consumed) {
		t.Fatalf("replay error = %T (%v), want *domain.WrapTokenConsumedError", err, err)
	}
	if client.UnwrapCount() != 1 || client.LoginCount() != 1 {
		t.Fatalf("a replay reached the server: unwraps/logins = %d/%d", client.UnwrapCount(), client.LoginCount())
	}
	for _, line := range logger.Lines() {
		if strings.Contains(line, "wrap-token-one-use") || strings.Contains(line, "secret-id-value") {
			t.Fatalf("a log line carried credential material: %s", line)
		}
	}
}

// TestSessionRefusesATokenLongerThanTheHardMaximum keeps a misconfigured role from
// handing the host a token the service cannot bound.
func TestSessionRefusesATokenLongerThanTheHardMaximum(t *testing.T) {
	t.Parallel()
	client, _, service := newSessionHarness(t)
	client.IssueWrapToken("wrap-token-long")
	client.SetLoginTTL(16 * time.Minute)

	_, err := service.LoginFromWrapped(context.Background(), "fleet-host-host-0001",
		application.NewSecret("bootstrap:wrapping-token", []byte("wrap-token-long")))
	if err == nil {
		t.Fatal("a 16 minute token must be refused")
	}
	var identityErr *domain.IdentityError
	if !errors.As(err, &identityErr) {
		t.Fatalf("error = %T (%v), want *domain.IdentityError", err, err)
	}
	if !strings.Contains(err.Error(), "hard maximum") {
		t.Fatalf("the error does not name the bound: %v", err)
	}
}

// TestSessionRenewKeepsTheHardMaximum is property 5's renewal half: renewal
// succeeds inside the bound and is refused outside it.
func TestSessionRenewKeepsTheHardMaximum(t *testing.T) {
	t.Parallel()
	client, _, service := newSessionHarness(t)
	token := application.NewSecret("openbao:session-token", []byte("session-token-value"))

	session, err := service.Renew(context.Background(), token)
	if err != nil {
		t.Fatalf("Renew: %v", err)
	}
	if session.TTL <= 0 || session.TTL > 900*time.Second {
		t.Fatalf("renewed TTL = %s, want (0, 900s]", session.TTL)
	}
	client.SetRenewTTL(901 * time.Second)
	if _, err := service.Renew(context.Background(), token); err == nil {
		t.Fatal("a renewal above 900 seconds must be refused")
	}
}

// TestSessionRotateMintsAFreshWrappedSecretID is property 5's rotation half: a
// new credential arrives wrapped, and the previous accessor is retired only after
// the new one exists.
func TestSessionRotateMintsAFreshWrappedSecretID(t *testing.T) {
	t.Parallel()
	client, _, service := newSessionHarness(t)
	wrapped, err := service.Rotate(context.Background(), "fleet-host-host-0001", "accessor-0001")
	if err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	if wrapped.WrapToken.Empty() {
		t.Fatal("rotation returned no wrapping token")
	}
	if wrapped.Accessor == "" || wrapped.Accessor == "accessor-0001" {
		t.Fatalf("rotation accessor = %q, want a fresh one", wrapped.Accessor)
	}
	if wrapped.TTL <= 0 || wrapped.TTL > 900*time.Second {
		t.Fatalf("rotation wrap TTL = %s, want a short window", wrapped.TTL)
	}
	rotations := client.Rotations()
	if len(rotations) != 1 || rotations[0] != "fleet-host-host-0001|accessor-0001" {
		t.Fatalf("rotations = %v", rotations)
	}
}

// TestSessionRefusesAnEmptyCredential is the trivial fail-closed case: no
// credential, no server call.
func TestSessionRefusesAnEmptyCredential(t *testing.T) {
	t.Parallel()
	client, _, service := newSessionHarness(t)
	if _, err := service.LoginFromWrapped(context.Background(), "fleet-host-host-0001", application.Secret{}); err == nil {
		t.Fatal("an empty wrapping token must be refused")
	}
	if _, err := service.Renew(context.Background(), application.Secret{}); err == nil {
		t.Fatal("an empty token must be refused")
	}
	if client.UnwrapCount() != 0 || client.LoginCount() != 0 {
		t.Fatalf("an empty credential reached the server: %d/%d", client.UnwrapCount(), client.LoginCount())
	}
}
