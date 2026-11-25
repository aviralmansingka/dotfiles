package provider_test

// Interchangeability tests for the provider contract.
//
// The contract is five operations: create, status, destroy, bootstrap-address, and
// trusted-host-key. These tests exercise it through the interface only — one
// `driveTheContract(t, contract)` helper, called once with the AWS adapter over a
// fake provider port and once with the fake adapter itself. If the two behave
// differently through the interface, the seam is not real.
//
// No test here runs Terraform, touches AWS, or holds a credential.

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/provider"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// contractOutcome is what one full pass through the contract observed. It is
// compared across adapters, so it holds only values every adapter must agree on.
type contractOutcome struct {
	// CreatedResourceID is the provider identity reported by create.
	CreatedResourceID string
	// StatusExistsBeforeDestroy is what status reported right after create.
	StatusExistsBeforeDestroy bool
	// BootstrapTransport and BootstrapAddress come from bootstrap-address.
	BootstrapTransport provider.Transport
	BootstrapAddress   string
	// HostKeyAlgorithm and HostKeyFingerprint come from trusted-host-key.
	HostKeyAlgorithm   string
	HostKeyFingerprint string
	// StatusExistsAfterDestroy is what status reported after destroy.
	StatusExistsAfterDestroy bool
	// SecondDestroyErr is the error of destroying an already-destroyed resource.
	SecondDestroyErr error
	// SecondCreateResourceID is what a repeated create reported.
	SecondCreateResourceID string
}

// contractHostKey is the key the fixture records, so both adapters answer the same.
const (
	contractHostKeyAlgorithm   = "ssh-ed25519"
	contractHostKeyFingerprint = "SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg"
)

// hostKeySourceStub is a HostKeySource that answers from a fixed map, so the AWS
// adapter can be driven without touching a file.
type hostKeySourceStub map[string]provider.HostKey

func (s hostKeySourceStub) TrustedHostKey(_ context.Context, hostID, _ string) (provider.HostKey, bool, error) {
	key, ok := s[hostID]
	return key, ok, nil
}

// driveTheContract runs the same five-operation exercise against any adapter and
// returns what it observed.
func driveTheContract(t *testing.T, contract provider.Contract) contractOutcome {
	t.Helper()
	ctx := context.Background()
	outcome := contractOutcome{}

	createRequest := provider.CreateRequest{
		HostID:       "host-0001",
		Name:         "canary-01",
		Provider:     domain.ProviderAWS,
		Profile:      "rex",
		Region:       "ap-south-1",
		Size:         "standard",
		InstanceType: "t3.medium",
		DiskGB:       40,
		Tags:         map[string]string{"owner": "fleet"},
	}

	// 1. create
	resource, err := contract.Create(ctx, createRequest)
	if err != nil {
		t.Fatalf("contract.Create: %v", err)
	}
	if resource.ResourceID == "" {
		t.Fatal("contract.Create returned no resource id")
	}
	outcome.CreatedResourceID = resource.ResourceID

	// A repeated create adopts instead of allocating a second resource. This is the
	// retry property, so it is part of the exercise.
	again, err := contract.Create(ctx, createRequest)
	if err != nil {
		t.Fatalf("contract.Create (repeat): %v", err)
	}
	outcome.SecondCreateResourceID = again.ResourceID
	if again.ResourceID != resource.ResourceID {
		t.Fatalf("a repeated create returned %q, want the adopted %q", again.ResourceID, resource.ResourceID)
	}

	// 2. status
	statusRequest := provider.StatusRequest{
		HostID:     createRequest.HostID,
		Name:       createRequest.Name,
		Provider:   createRequest.Provider,
		Profile:    createRequest.Profile,
		Region:     createRequest.Region,
		Size:       createRequest.Size,
		ResourceID: resource.ResourceID,
	}
	status, err := contract.Status(ctx, statusRequest)
	if err != nil {
		t.Fatalf("contract.Status: %v", err)
	}
	if !status.Exists {
		t.Fatal("contract.Status reported the just-created resource as absent")
	}
	if status.ResourceID != resource.ResourceID {
		t.Fatalf("status resource id = %q, want %q", status.ResourceID, resource.ResourceID)
	}
	outcome.StatusExistsBeforeDestroy = status.Exists

	// 4. bootstrap-address
	address, err := contract.BootstrapAddress(ctx, provider.BootstrapRequest{
		HostID:     createRequest.HostID,
		Name:       createRequest.Name,
		Profile:    createRequest.Profile,
		Region:     createRequest.Region,
		Size:       createRequest.Size,
		ResourceID: resource.ResourceID,
	})
	if err != nil {
		t.Fatalf("contract.BootstrapAddress: %v", err)
	}
	outcome.BootstrapTransport = address.Transport
	outcome.BootstrapAddress = address.Address
	if address.Address != resource.ResourceID {
		t.Fatalf("bootstrap address = %q, want the provider resource id %q", address.Address, resource.ResourceID)
	}

	// 5. trusted-host-key
	key, err := contract.TrustedHostKey(ctx, provider.HostKeyRequest{
		HostID:     createRequest.HostID,
		Name:       createRequest.Name,
		ResourceID: resource.ResourceID,
	})
	if err != nil {
		t.Fatalf("contract.TrustedHostKey: %v", err)
	}
	if !key.Known || key.Fingerprint == "" || key.Algorithm == "" {
		t.Fatalf("trusted host key = %+v, want a known key", key)
	}
	outcome.HostKeyAlgorithm = key.Algorithm
	outcome.HostKeyFingerprint = key.Fingerprint

	// A host with no recorded key is an error, not an empty value: a caller must not
	// connect on an unverified key.
	if _, err := contract.TrustedHostKey(ctx, provider.HostKeyRequest{HostID: "host-9999", Name: "canary-99"}); !errors.Is(err, provider.ErrHostKeyNotRecorded) {
		t.Fatalf("trusted-host-key for an unrecorded host = %v, want ErrHostKeyNotRecorded", err)
	}

	// 3. destroy
	destroyRequest := provider.DestroyRequest{
		HostID:     createRequest.HostID,
		Name:       createRequest.Name,
		Provider:   createRequest.Provider,
		Profile:    createRequest.Profile,
		Region:     createRequest.Region,
		Size:       createRequest.Size,
		ResourceID: resource.ResourceID,
	}
	if err := contract.Destroy(ctx, destroyRequest); err != nil {
		t.Fatalf("contract.Destroy: %v", err)
	}
	status, err = contract.Status(ctx, statusRequest)
	if err != nil {
		t.Fatalf("contract.Status after destroy: %v", err)
	}
	outcome.StatusExistsAfterDestroy = status.Exists
	if status.Exists {
		t.Fatal("contract.Status still reports the destroyed resource")
	}

	// Destroying again is success: a retried teardown must not fail.
	outcome.SecondDestroyErr = contract.Destroy(ctx, destroyRequest)
	if outcome.SecondDestroyErr != nil {
		t.Fatalf("destroying an already-destroyed resource failed: %v", outcome.SecondDestroyErr)
	}

	return outcome
}

// TestFakeProviderSatisfiesTheContract proves the fake is a real implementation of the
// five operations, so it can stand in for AWS in any test written against the
// contract.
func TestFakeProviderSatisfiesTheContract(t *testing.T) {
	t.Parallel()
	fake := fakes.NewProvider()
	fake.RecordHostKey("host-0001", contractHostKeyAlgorithm, contractHostKeyFingerprint)

	var contract provider.Contract = fake
	outcome := driveTheContract(t, contract)

	if outcome.CreatedResourceID != outcome.SecondCreateResourceID {
		t.Fatalf("create adopted %q instead of %q", outcome.SecondCreateResourceID, outcome.CreatedResourceID)
	}
	if outcome.BootstrapTransport != provider.TransportSSM {
		t.Fatalf("bootstrap transport = %q, want %q", outcome.BootstrapTransport, provider.TransportSSM)
	}
	if allocations := fake.Allocations(); allocations != 1 {
		t.Fatalf("allocations = %d, want the repeated create to adopt", allocations)
	}
	if destroys := fake.Destroys(); destroys != 1 {
		t.Fatalf("destroys = %d, want exactly one", destroys)
	}
}

// TestAWSAdapterAndTheFakeAreInterchangeable is the interchangeability property: the
// AWS adapter over a fake provider port and the fake adapter itself produce the same
// observations through the contract. Two adapters that disagree here are two
// contracts.
func TestAWSAdapterAndTheFakeAreInterchangeable(t *testing.T) {
	t.Parallel()

	// The AWS adapter, composed over the in-process provider port and a fixed key
	// source. Nothing here reaches Terraform or AWS.
	fake := fakes.NewProvider()
	fake.RecordHostKey("host-0001", contractHostKeyAlgorithm, contractHostKeyFingerprint)
	awsContract, err := provider.NewAWSIdentity(fake, hostKeySourceStub{
		"host-0001": {Algorithm: contractHostKeyAlgorithm, Fingerprint: contractHostKeyFingerprint},
	})
	if err != nil {
		t.Fatalf("NewAWSIdentity: %v", err)
	}
	awsOutcome := driveTheContract(t, awsContract)

	// The fake adapter on its own.
	directFake := fakes.NewProvider()
	directFake.RecordHostKey("host-0001", contractHostKeyAlgorithm, contractHostKeyFingerprint)
	fakeOutcome := driveTheContract(t, directFake)

	if awsOutcome != fakeOutcome {
		t.Fatalf("the two adapters disagree through the contract:\naws  %+v\nfake %+v", awsOutcome, fakeOutcome)
	}
	// And the shared outcome is the one the exercise expects, so agreeing on the
	// wrong answer is not enough.
	if awsOutcome.BootstrapTransport != provider.TransportSSM {
		t.Fatalf("bootstrap transport = %q, want %q", awsOutcome.BootstrapTransport, provider.TransportSSM)
	}
	if awsOutcome.HostKeyFingerprint != contractHostKeyFingerprint {
		t.Fatalf("host key fingerprint = %q, want the recorded %q", awsOutcome.HostKeyFingerprint, contractHostKeyFingerprint)
	}
	if awsOutcome.StatusExistsBeforeDestroy != true || awsOutcome.StatusExistsAfterDestroy != false {
		t.Fatalf("status went %v then %v, want true then false",
			awsOutcome.StatusExistsBeforeDestroy, awsOutcome.StatusExistsAfterDestroy)
	}
}

// TestAWSAdapterRequiresEveryDependency keeps a half-wired provider from starting:
// with no provider port there is nothing to create, and with no key source the
// trusted-host-key operation would have to invent an answer.
func TestAWSAdapterRequiresEveryDependency(t *testing.T) {
	t.Parallel()
	if _, err := provider.NewAWSIdentity(nil, hostKeySourceStub{}); err == nil {
		t.Fatal("NewAWSIdentity accepted a nil provider port")
	}
	if _, err := provider.NewAWSIdentity(fakes.NewProvider(), nil); err == nil {
		t.Fatal("NewAWSIdentity accepted a nil host key source")
	}
}

// TestAWSAdapterReportsAnUnrecordedHostKeyAsNotRecorded proves the operation fails
// closed: connecting on an unverified key is exactly the mistake a trusted-host-key
// operation exists to prevent.
func TestAWSAdapterReportsAnUnrecordedHostKeyAsNotRecorded(t *testing.T) {
	t.Parallel()
	contract, err := provider.NewAWSIdentity(fakes.NewProvider(), hostKeySourceStub{})
	if err != nil {
		t.Fatalf("NewAWSIdentity: %v", err)
	}
	_, err = contract.TrustedHostKey(context.Background(), provider.HostKeyRequest{HostID: "host-0001", Name: "canary-01"})
	if !errors.Is(err, provider.ErrHostKeyNotRecorded) {
		t.Fatalf("error = %v, want ErrHostKeyNotRecorded", err)
	}
}

// TestAWSAdapterBootstrapAddressReportsAnUnknownHost proves the address is looked up
// rather than invented: a host with no recorded resource has no bootstrap path.
func TestAWSAdapterBootstrapAddressReportsAnUnknownHost(t *testing.T) {
	t.Parallel()
	contract, err := provider.NewAWSIdentity(fakes.NewProvider(), hostKeySourceStub{})
	if err != nil {
		t.Fatalf("NewAWSIdentity: %v", err)
	}
	_, err = contract.BootstrapAddress(context.Background(), provider.BootstrapRequest{
		HostID:  "host-0001",
		Name:    "canary-01",
		Profile: "rex",
		Region:  "ap-south-1",
		Size:    "standard",
	})
	if !errors.Is(err, provider.ErrNotRecorded) {
		t.Fatalf("error = %v, want ErrNotRecorded", err)
	}
}

// TestUnimplementedProviderRefusesEveryOperation is the "only AWS is implemented"
// property: a local VM or another cloud is a name in configuration that refuses
// every call, so a missing backend can never look like a working one.
func TestUnimplementedProviderRefusesEveryOperation(t *testing.T) {
	t.Parallel()
	providers := map[string]provider.Contract{
		"local-vm":        provider.NewUnimplemented("local VM"),
		"another-cloud":   provider.NewUnimplemented("another cloud"),
		"unnamed-locally": provider.NewUnimplemented(""),
	}
	for name, contract := range providers {
		ctx := context.Background()
		if _, err := contract.Create(ctx, provider.CreateRequest{}); !isNotImplemented(err) {
			t.Fatalf("%s: create error = %v, want a not-implemented refusal", name, err)
		}
		if _, err := contract.Status(ctx, provider.StatusRequest{}); !isNotImplemented(err) {
			t.Fatalf("%s: status error = %v, want a not-implemented refusal", name, err)
		}
		if err := contract.Destroy(ctx, provider.DestroyRequest{}); !isNotImplemented(err) {
			t.Fatalf("%s: destroy error = %v, want a not-implemented refusal", name, err)
		}
		if _, err := contract.BootstrapAddress(ctx, provider.BootstrapRequest{}); !isNotImplemented(err) {
			t.Fatalf("%s: bootstrap-address error = %v, want a not-implemented refusal", name, err)
		}
		if _, err := contract.TrustedHostKey(ctx, provider.HostKeyRequest{}); !isNotImplemented(err) {
			t.Fatalf("%s: trusted-host-key error = %v, want a not-implemented refusal", name, err)
		}
	}
}

// isNotImplemented reports whether err is the domain's explicit refusal.
func isNotImplemented(err error) bool {
	var refusal *domain.NotImplementedError
	return errors.As(err, &refusal)
}

// TestHostKeyStoreRecordsAndAnswersVerification proves the file-backed source: a
// recorded key answers for its own resource, a stale resource id does not, and the
// file holds public material at mode 0600.
func TestHostKeyStoreRecordsAndAnswersVerification(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "state", "hostkeys.json")
	store, err := provider.OpenHostKeyStore(path)
	if err != nil {
		t.Fatalf("OpenHostKeyStore: %v", err)
	}
	ctx := context.Background()

	if _, found, err := store.TrustedHostKey(ctx, "host-0001", "i-1"); err != nil || found {
		t.Fatalf("an empty store answered found=%v err=%v", found, err)
	}
	if err := store.Record(ctx, "host-0001", "i-1", provider.HostKey{
		Algorithm:   contractHostKeyAlgorithm,
		Fingerprint: contractHostKeyFingerprint,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}

	key, found, err := store.TrustedHostKey(ctx, "host-0001", "i-1")
	if err != nil || !found {
		t.Fatalf("TrustedHostKey = found=%v err=%v, want the recorded key", found, err)
	}
	if key.Fingerprint != contractHostKeyFingerprint || key.Algorithm != contractHostKeyAlgorithm {
		t.Fatalf("key = %+v, want the recorded values", key)
	}
	// A different machine under the same host id must not reuse the old key.
	if _, found, err := store.TrustedHostKey(ctx, "host-0001", "i-2"); err != nil || found {
		t.Fatalf("a stale resource id answered found=%v err=%v, want not found", found, err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat host key store: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("host key store mode = %o, want 600", mode)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read host key store: %v", err)
	}
	if !strings.Contains(string(raw), contractHostKeyFingerprint) {
		t.Fatalf("the store does not contain the recorded fingerprint: %s", raw)
	}

	// A reopened store answers the same, so the record survives a restart.
	reopened, err := provider.OpenHostKeyStore(path)
	if err != nil {
		t.Fatalf("reopen host key store: %v", err)
	}
	if _, found, err := reopened.TrustedHostKey(ctx, "host-0001", "i-1"); err != nil || !found {
		t.Fatalf("a reopened store answered found=%v err=%v, want the recorded key", found, err)
	}
}

// TestHostKeyStoreRefusesARecordWithoutAKey keeps an empty fingerprint from becoming
// a key a caller would compare against nothing.
func TestHostKeyStoreRefusesARecordWithoutAKey(t *testing.T) {
	t.Parallel()
	store, err := provider.OpenHostKeyStore(filepath.Join(t.TempDir(), "hostkeys.json"))
	if err != nil {
		t.Fatalf("OpenHostKeyStore: %v", err)
	}
	if err := store.Record(context.Background(), "host-0001", "i-1", provider.HostKey{}); err == nil {
		t.Fatal("an empty host key was recorded")
	}
}
