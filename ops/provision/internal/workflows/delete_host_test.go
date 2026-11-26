package workflows_test

// Offline teardown tests.
//
// Each test runs the real DeleteHostWorkflow against real activities wired to
// in-process adapters, and asserts one of the four teardown properties:
//
//   - order: already-issued tokens are revoked before the login credential, the
//     device, and the provider resource;
//   - idempotent steps with a sanitized tombstone: a completed teardown leaves a
//     record that keeps its identifiers and drops everything that described a
//     machine which no longer exists;
//   - reportable partial teardown: a failing step does not abort the rest, and the
//     record and the job error both name what is left;
//   - isolation: a foreign host's identity is byte-for-byte unchanged.
//
// No test here contacts AWS, Tailscale, OpenBao, a multiplexer, or a real
// credential.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/store/jsonstore"
	temporaladapter "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/temporal"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

// recorder records the teardown steps in the order the adapters were called, so a
// test proves the sequence instead of inferring it from end state.
type recorder struct {
	mu    sync.Mutex
	steps []string
}

func (r *recorder) add(step string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.steps = append(r.steps, step)
}

// Steps returns the recorded steps.
func (r *recorder) Steps() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.steps...)
}

// orderedAuthorizer records the OpenBao steps before delegating.
type orderedAuthorizer struct {
	inner ports.HostAuthorizer
	rec   *recorder
	// failTokens and failCredentials inject a refusal at that step.
	failTokens      error
	failCredentials error
}

var _ ports.HostAuthorizer = (*orderedAuthorizer)(nil)

func (o *orderedAuthorizer) AuthorizeHost(ctx context.Context, req ports.AuthorizeRequest) error {
	return o.inner.AuthorizeHost(ctx, req)
}

func (o *orderedAuthorizer) RevokeTokens(ctx context.Context, req ports.AuthorizeRequest) (ports.TokenRevocation, error) {
	o.rec.add("openbao_tokens")
	if o.failTokens != nil {
		return ports.TokenRevocation{}, o.failTokens
	}
	return o.inner.RevokeTokens(ctx, req)
}

func (o *orderedAuthorizer) RevokeCredentials(ctx context.Context, req ports.AuthorizeRequest) (ports.CredentialRevocation, error) {
	o.rec.add("openbao_credentials")
	if o.failCredentials != nil {
		return ports.CredentialRevocation{}, o.failCredentials
	}
	return o.inner.RevokeCredentials(ctx, req)
}

// orderedTailnet records the device step before delegating.
type orderedTailnet struct {
	inner ports.TailnetDeviceManager
	rec   *recorder
	fail  error
}

var _ ports.TailnetDeviceManager = (*orderedTailnet)(nil)

func (o *orderedTailnet) RemoveDevice(ctx context.Context, req ports.RemoveDeviceRequest) error {
	o.rec.add("tailscale_device")
	if o.fail != nil {
		return o.fail
	}
	return o.inner.RemoveDevice(ctx, req)
}

// orderedProvider records the provider step before delegating.
type orderedProvider struct {
	inner ports.HostProvider
	rec   *recorder
	fail  error
}

var _ ports.HostProvider = (*orderedProvider)(nil)

func (o *orderedProvider) CreateHost(ctx context.Context, req ports.ProviderCreateRequest) (ports.ProviderResource, error) {
	return o.inner.CreateHost(ctx, req)
}

func (o *orderedProvider) StatusHost(ctx context.Context, req ports.ProviderStatusRequest) (ports.ProviderResourceStatus, error) {
	return o.inner.StatusHost(ctx, req)
}

func (o *orderedProvider) DestroyHost(ctx context.Context, req ports.ProviderDestroyRequest) error {
	o.rec.add("terraform_resources")
	if o.fail != nil {
		return o.fail
	}
	return o.inner.DestroyHost(ctx, req)
}

// deleteFixture is two hosts' worth of adapters: one to tear down, one that must
// stay untouched, both in one inventory, one provider, one tailnet, and one OpenBao
// backend.
type deleteFixture struct {
	t          *testing.T
	store      *jsonstore.Store
	provider   *fakes.Provider
	tailnet    *fakes.Tailnet
	backend    *fakes.IdentityBackend
	recorder   *recorder
	authorizer *orderedAuthorizer
	device     *orderedTailnet
	resources  *orderedProvider
	activities *temporaladapter.Activities

	targetName   string
	targetID     string
	targetDevice string
	foreignName  string
	foreignID    string
	foreignDev   string
	targetToken  string
	foreignToken string
}

const (
	targetHost  = "host-0001"
	targetName  = "canary-01"
	foreignHost = "host-0002"
	foreignName = "canary-02"
)

func newDeleteFixture(t *testing.T) *deleteFixture {
	t.Helper()
	store, err := jsonstore.Open(t.TempDir() + "/inventory.json")
	if err != nil {
		t.Fatalf("open inventory: %v", err)
	}
	f := &deleteFixture{
		t:           t,
		store:       store,
		provider:    fakes.NewProvider(),
		tailnet:     fakes.NewTailnet(),
		backend:     fakes.NewIdentityBackend(),
		recorder:    &recorder{},
		targetName:  targetName,
		targetID:    targetHost,
		foreignName: foreignName,
		foreignID:   foreignHost,
	}

	ctx := context.Background()
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)

	// Two provider allocations and two joined devices, so the records hold the real
	// identifiers a teardown consumes.
	resource, err := f.provider.CreateHost(ctx, ports.ProviderCreateRequest{
		HostID: targetHost, Name: targetName, Provider: domain.ProviderAWS,
		Profile: "rex", Region: "ap-south-1", Size: "standard",
	})
	if err != nil {
		t.Fatalf("create resource for %s: %v", targetHost, err)
	}
	foreignResource, err := f.provider.CreateHost(ctx, ports.ProviderCreateRequest{
		HostID: foreignHost, Name: foreignName, Provider: domain.ProviderAWS,
		Profile: "rex", Region: "ap-south-1", Size: "standard",
	})
	if err != nil {
		t.Fatalf("create resource for %s: %v", foreignHost, err)
	}
	f.targetDevice, err = f.tailnet.Join(targetName, domain.ApprovedTailnetTag, "auth-key-target")
	if err != nil {
		t.Fatalf("join target device: %v", err)
	}
	f.foreignDev, err = f.tailnet.Join(foreignName, domain.ApprovedTailnetTag, "auth-key-foreign")
	if err != nil {
		t.Fatalf("join foreign device: %v", err)
	}

	for _, host := range []struct {
		id, name, device string
		resource         ports.ProviderResource
	}{
		{targetHost, targetName, f.targetDevice, resource},
		{foreignHost, foreignName, f.foreignDev, foreignResource},
	} {
		if _, _, err := store.CreateHost(ctx, domain.Host{
			ID:             host.id,
			Name:           host.name,
			Provider:       domain.ProviderAWS,
			Profile:        "rex",
			Region:         "ap-south-1",
			Size:           "standard",
			InstanceType:   "t3.medium",
			DiskGB:         40,
			Tags:           map[string]string{"owner": "fleet", "fleet-tier": "managed"},
			SecretBundles:  []string{"bao:secret/data/hosts/" + host.id + "/canary"},
			OwnerClientID:  "test-client",
			JobID:          "create-" + host.id,
			State:          domain.HostStateReady,
			ResourceID:     host.resource.ResourceID,
			DeviceID:       host.device,
			PrivateAddress: host.resource.PrivateAddress,
			FlakeRevision:  "sha256:revision-" + host.id,
			RexURL:         "https://" + host.name + ".fleet.example",
			CreatedAt:      now,
			UpdatedAt:      now,
		}); err != nil {
			t.Fatalf("seed host %s: %v", host.id, err)
		}
	}

	logger := &fakes.Logger{}
	identity, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  f.backend,
		Delivery: fakes.NewBootstrap(),
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("build identity service: %v", err)
	}
	// Both hosts are authorized, so both own a role and a policy. The teardown of
	// one must not touch the other.
	for _, host := range []struct{ id, name string }{
		{targetHost, targetName},
		{foreignHost, foreignName},
	} {
		if err := identity.AuthorizeHost(ctx, authorizeRequestFor(host.id, host.name)); err != nil {
			t.Fatalf("authorize %s: %v", host.id, err)
		}
		// One already-issued token each: the thing revocation has to invalidate.
		token := f.backend.IssueAppRoleToken(roleNameFor(t, host.id), "default")
		if host.id == targetHost {
			f.targetToken = token
		} else {
			f.foreignToken = token
		}
	}

	f.authorizer = &orderedAuthorizer{inner: identity, rec: f.recorder}
	f.device = &orderedTailnet{inner: f.tailnet, rec: f.recorder}
	f.resources = &orderedProvider{inner: f.provider, rec: f.recorder}
	f.activities = &temporaladapter.Activities{
		Inventory:  store,
		Providers:  f.resources,
		Authorizer: f.authorizer,
		Tailnet:    f.device,
		Clock:      fakes.NewClock(),
		Logger:     logger,
	}
	return f
}

// authorizeRequestFor builds the revocation request for one host.
func authorizeRequestFor(hostID, name string) ports.AuthorizeRequest {
	return ports.AuthorizeRequest{
		HostID:        hostID,
		Name:          name,
		Profile:       "rex",
		SecretBundles: []string{"bao:secret/data/hosts/" + hostID + "/canary"},
	}
}

// roleNameFor is the derived AppRole name for a host id.
func roleNameFor(t *testing.T, hostID string) string {
	t.Helper()
	name, err := domain.HostRoleName(hostID)
	if err != nil {
		t.Fatalf("HostRoleName(%s): %v", hostID, err)
	}
	return name
}

// policyNameFor is the derived policy name for a host id.
func policyNameFor(t *testing.T, hostID string) string {
	t.Helper()
	name, err := domain.HostPolicyName(hostID)
	if err != nil {
		t.Fatalf("HostPolicyName(%s): %v", hostID, err)
	}
	return name
}

// teardownInput builds the workflow input a service would produce for one host.
func (f *deleteFixture) teardownInput(hostID, name, deviceID string) workflows.DeleteHostInput {
	host, err := f.store.GetHost(context.Background(), hostID)
	if err != nil {
		f.t.Fatalf("GetHost(%s): %v", hostID, err)
	}
	return workflows.DeleteHostInput{
		Spec: workflows.HostSpec{
			HostID:        host.ID,
			Name:          host.Name,
			Provider:      string(host.Provider),
			Profile:       host.Profile,
			Region:        host.Region,
			Size:          host.Size,
			SecretBundles: host.SecretBundles,
		},
		JobID:      "delete-" + hostID,
		ResourceID: host.ResourceID,
		DeviceID:   deviceID,
	}
}

// run executes the teardown workflow in a bounded test environment and returns the
// status, the workflow error, and the elapsed wall clock.
func (f *deleteFixture) run(in workflows.DeleteHostInput) (workflows.Status, error, time.Duration) {
	f.t.Helper()
	started := time.Now()
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	env.SetTestTimeout(testEnvTimeout)
	env.RegisterWorkflow(workflows.DeleteHostWorkflow)
	env.RegisterActivity(f.activities.RevokeHostTokens)
	env.RegisterActivity(f.activities.RevokeHostCredentials)
	env.RegisterActivity(f.activities.RemoveDevice)
	env.RegisterActivity(f.activities.DestroyHostResource)
	env.RegisterActivity(f.activities.RecordHostMilestone)
	env.ExecuteWorkflow(workflows.DeleteHostWorkflow, in)
	if !env.IsWorkflowCompleted() {
		f.t.Fatal("the teardown did not complete inside the bounded test environment")
	}
	var status workflows.Status
	if err := env.GetWorkflowResult(&status); err != nil {
		// The result is still decoded on a failed workflow; only an undecodable
		// result is a real problem here.
		var appErr *temporal.ApplicationError
		if !errors.As(err, &appErr) && !errors.Is(err, context.Canceled) {
			f.t.Logf("workflow result was not decoded: %v", err)
		}
	}
	return status, env.GetWorkflowError(), time.Since(started)
}

// host reads one inventory record.
func (f *deleteFixture) host(hostID string) domain.Host {
	f.t.Helper()
	host, err := f.store.GetHost(context.Background(), hostID)
	if err != nil {
		f.t.Fatalf("GetHost(%s): %v", hostID, err)
	}
	return host
}

// TestTeardownRevokesTokensThenTheLoginCredentialThenTheDeviceThenTheResource
// proves the order the security argument depends on: the already-issued tokens go
// first, because that is the only step that cuts off a running session, and the
// billable resource goes last.
func TestTeardownRevokesTokensThenTheLoginCredentialThenTheDeviceThenTheResource(t *testing.T) {
	t.Parallel()
	f := newDeleteFixture(t)

	status, workflowErr, elapsed := f.run(f.teardownInput(targetHost, targetName, f.targetDevice))
	assertBounded(t, elapsed)
	if workflowErr != nil {
		t.Fatalf("teardown failed: %v", workflowErr)
	}

	want := []string{
		string(domain.CleanupRevokeTokens),
		string(domain.CleanupRevokeCredentials),
		string(domain.CleanupRemoveDevice),
		string(domain.CleanupDestroyResources),
	}
	got := f.recorder.Steps()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("teardown order = %v, want %v", got, want)
	}
	if status.State != domain.JobDeleted {
		t.Fatalf("job state = %q, want deleted", status.State)
	}
	if status.TokensRevoked != 1 {
		t.Fatalf("tokens revoked = %d, want the one issued before the teardown", status.TokensRevoked)
	}
	if incomplete := status.IncompleteSteps(); len(incomplete) != 0 {
		t.Fatalf("incomplete steps = %v, want none", incomplete)
	}
}

// TestTeardownWritesASanitizedTombstone proves the record a completed teardown
// leaves: identifiers and cost-relevant shape stay, and every field that described
// a machine which no longer exists is gone.
func TestTeardownWritesASanitizedTombstone(t *testing.T) {
	t.Parallel()
	f := newDeleteFixture(t)
	before := f.host(targetHost)

	status, workflowErr, elapsed := f.run(f.teardownInput(targetHost, targetName, f.targetDevice))
	assertBounded(t, elapsed)
	if workflowErr != nil {
		t.Fatalf("teardown failed: %v", workflowErr)
	}
	_ = status

	host := f.host(targetHost)
	if host.State != domain.HostStateDeleted {
		t.Fatalf("record state = %q, want deleted", host.State)
	}
	if host.Tombstone == nil {
		t.Fatal("the record carries no tombstone")
	}
	if !host.Tombstone.Complete() {
		t.Fatalf("tombstone = %+v, want every step released", host.Tombstone)
	}
	if reason := host.Tombstone.Sanitized(); reason != "" {
		t.Fatalf("tombstone is not sanitized: %s", reason)
	}
	if host.Tombstone.TokenAccessorsRevoked != 1 {
		t.Fatalf("tombstone token count = %d, want 1", host.Tombstone.TokenAccessorsRevoked)
	}
	// Identifiers stay: they are what proves which instance was destroyed.
	if host.ResourceID != before.ResourceID {
		t.Fatalf("resource id = %q, want the destroyed instance id %q kept for audit", host.ResourceID, before.ResourceID)
	}
	if host.DeviceID != before.DeviceID {
		t.Fatalf("device id = %q, want the removed device id %q kept for audit", host.DeviceID, before.DeviceID)
	}
	// Everything that pointed at a machine which no longer exists is cleared.
	for _, field := range []struct {
		name  string
		value string
	}{
		{"private address", host.PrivateAddress},
		{"rex url", host.RexURL},
		{"flake revision", host.FlakeRevision},
	} {
		if field.value != "" {
			t.Fatalf("%s = %q on a tombstoned record, want it cleared", field.name, field.value)
		}
	}
	if len(host.Tags) != 0 {
		t.Fatalf("tags = %v on a tombstoned record, want them cleared", host.Tags)
	}

	encoded, err := json.Marshal(host)
	if err != nil {
		t.Fatalf("marshal tombstoned record: %v", err)
	}
	for _, forbidden := range []string{before.PrivateAddress, before.RexURL, before.FlakeRevision, "10.99.1."} {
		if forbidden == "" {
			continue
		}
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("the tombstoned record still carries %q: %s", forbidden, encoded)
		}
	}
}

// TestPartialTeardownReportsIncompleteCleanupAndStaysRetryable proves the reporting
// rule: a failing device removal does not abort the rest, the record says which
// cleanup is left, the instance is still destroyed, and the failure is retryable.
func TestPartialTeardownReportsIncompleteCleanupAndStaysRetryable(t *testing.T) {
	t.Parallel()
	f := newDeleteFixture(t)
	f.device.fail = errors.New("tailscale: the OAuth client cannot manage devices")

	status, workflowErr, elapsed := f.run(f.teardownInput(targetHost, targetName, f.targetDevice))
	assertBounded(t, elapsed)
	if workflowErr == nil {
		t.Fatal("a teardown that could not finish every step must fail")
	}
	var appErr *temporal.ApplicationError
	if !errors.As(workflowErr, &appErr) {
		t.Fatalf("workflow error = %T (%v), want a Temporal application error", workflowErr, workflowErr)
	}
	if appErr.Type() != workflows.FailureTypeRetryable {
		t.Fatalf("failure type = %q, want the retryable type", appErr.Type())
	}
	if !strings.Contains(appErr.Message(), string(domain.CleanupRemoveDevice)) {
		t.Fatalf("the failure does not name the incomplete step: %s", appErr.Message())
	}

	// The later step still ran: a failing Bao or Tailscale endpoint must not leave a
	// billable instance behind.
	if destroys := f.provider.Destroys(); destroys != 1 {
		t.Fatalf("destroys = %d, want the resource destroyed despite the earlier failure", destroys)
	}
	// A failed workflow's result is not decodable through the test environment, so
	// the durable half of the report is what this asserts: the record's own list.
	if incomplete := status.IncompleteSteps(); len(incomplete) != 0 {
		t.Fatalf("incomplete steps on a failed result = %v, want none (the result is not returned on failure)", incomplete)
	}

	host := f.host(targetHost)
	if host.State == domain.HostStateDeleted || host.Tombstone != nil {
		t.Fatal("a partial teardown must not tombstone the record")
	}
	if got := domain.IncompleteCleanup(host.PendingCleanup); got != string(domain.CleanupRemoveDevice) {
		t.Fatalf("persisted pending cleanup = %q, want %q", got, domain.CleanupRemoveDevice)
	}
}

// TestTeardownLeavesAForeignHostsIdentityUntouched is the isolation property, stated
// at the identity level: a foreign host's Bao role and policy, its tailnet device,
// and its provider instance are identical before and after another host's teardown.
func TestTeardownLeavesAForeignHostsIdentityUntouched(t *testing.T) {
	t.Parallel()
	f := newDeleteFixture(t)
	ctx := context.Background()

	beforeHost := f.host(foreignHost)
	beforeRole, roleExisted := f.backend.Role(roleNameFor(t, foreignHost))
	beforePolicy, policyExisted := f.backend.Policy(policyNameFor(t, foreignHost))
	beforeDevice, deviceExisted := f.tailnet.DeviceByID(f.foreignDev)
	beforeResource, resourceExisted := f.provider.Resource(foreignHost)
	beforeTokens := f.backend.Tokens()

	if !roleExisted || !policyExisted || !deviceExisted || !resourceExisted {
		t.Fatalf("fixture is incomplete: role=%v policy=%v device=%v resource=%v",
			roleExisted, policyExisted, deviceExisted, resourceExisted)
	}

	if _, workflowErr, elapsed := f.run(f.teardownInput(targetHost, targetName, f.targetDevice)); workflowErr != nil {
		t.Fatalf("teardown of the target host failed: %v", workflowErr)
	} else {
		assertBounded(t, elapsed)
	}
	_ = ctx

	if role, ok := f.backend.Role(roleNameFor(t, foreignHost)); !ok || role.Name != beforeRole.Name || role.HostID != beforeRole.HostID {
		t.Fatalf("the foreign host's role changed: %+v (found=%v), was %+v", role, ok, beforeRole)
	}
	if policy, ok := f.backend.Policy(policyNameFor(t, foreignHost)); !ok || policy.Document != beforePolicy.Document || policy.Name != beforePolicy.Name {
		t.Fatalf("the foreign host's policy changed (found=%v)", ok)
	}
	if device, ok := f.tailnet.DeviceByID(f.foreignDev); !ok || device.ID != beforeDevice.ID || device.Name != beforeDevice.Name {
		t.Fatalf("the foreign host's device changed: %+v (found=%v), was %+v", device, ok, beforeDevice)
	}
	if resource, ok := f.provider.Resource(foreignHost); !ok || resource.ResourceID != beforeResource.ResourceID {
		t.Fatalf("the foreign host's provider resource changed: %+v (found=%v), was %+v", resource, ok, beforeResource)
	}
	afterHost := f.host(foreignHost)
	if afterHost.State != beforeHost.State ||
		afterHost.ResourceID != beforeHost.ResourceID ||
		afterHost.DeviceID != beforeHost.DeviceID ||
		afterHost.PrivateAddress != beforeHost.PrivateAddress ||
		afterHost.RexURL != beforeHost.RexURL ||
		afterHost.FlakeRevision != beforeHost.FlakeRevision ||
		afterHost.Tombstone != nil || len(afterHost.PendingCleanup) != 0 ||
		!afterHost.UpdatedAt.Equal(beforeHost.UpdatedAt) {
		t.Fatalf("the foreign host's record changed:\nbefore %+v\nafter  %+v", beforeHost, afterHost)
	}
	if after := f.backend.Tokens(); !containsString(after, f.foreignToken) {
		t.Fatalf("the foreign host's issued token was revoked: before %v, after %v", beforeTokens, after)
	} else if containsString(after, f.targetToken) {
		t.Fatalf("the target host's issued token survived its own teardown: %v", after)
	}
	// The target host's own double was removed exactly once, and only its own.
	if removals := f.tailnet.Removals(); removals != 1 {
		t.Fatalf("device removals = %d, want exactly the target's", removals)
	}
	if destroys := f.provider.Destroys(); destroys != 1 {
		t.Fatalf("destroys = %d, want exactly the target's", destroys)
	}
}

// TestSecondTeardownOfTheSameHostsStepsIsHarmless proves every step is idempotent,
// which is what makes a retried partial teardown safe. The second run finds nothing
// to revoke, no device, and no state, and still completes.
func TestSecondTeardownOfTheSameHostsStepsIsHarmless(t *testing.T) {
	t.Parallel()
	f := newDeleteFixture(t)

	input := f.teardownInput(targetHost, targetName, f.targetDevice)
	if _, workflowErr, _ := f.run(input); workflowErr != nil {
		t.Fatalf("first teardown failed: %v", workflowErr)
	}
	f.recorder = &recorder{}
	f.authorizer.rec = f.recorder
	f.device.rec = f.recorder
	f.resources.rec = f.recorder

	status, workflowErr, elapsed := f.run(input)
	assertBounded(t, elapsed)
	if workflowErr != nil {
		t.Fatalf("second teardown must be harmless, got %v", workflowErr)
	}
	if status.State != domain.JobDeleted {
		t.Fatalf("second run state = %q, want deleted", status.State)
	}
	if status.TokensRevoked != 0 {
		t.Fatalf("second run revoked %d tokens, want none left", status.TokensRevoked)
	}
	if destroys := f.provider.Destroys(); destroys != 1 {
		t.Fatalf("destroys = %d after two runs, want the first run's one destroy only", destroys)
	}
	if removals := f.tailnet.Removals(); removals != 1 {
		t.Fatalf("device removals = %d after two runs, want the first run's one only", removals)
	}
	if absent := f.tailnet.AbsentRemovals(); absent != 1 {
		t.Fatalf("the second run's device removal found the device already gone %d times, want 1", absent)
	}
	if incomplete := status.IncompleteSteps(); len(incomplete) != 0 {
		t.Fatalf("second run reported incomplete steps %v, want none", incomplete)
	}
}

// containsString reports whether values holds want.
func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
