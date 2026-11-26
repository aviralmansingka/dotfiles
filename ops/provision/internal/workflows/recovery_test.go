package workflows_test

// Offline fault tests for restart recovery.
//
// Each test kills the worker at a different point in the creation ladder — between
// allocation and the record, between enrollment and the record, and between
// authorization and readiness — and then asserts the same three properties:
//
//   - no duplicate instance or device: the provider and the tailnet see one
//     allocation and one join, never two;
//   - no lost ownership: the durable inventory record still names the resource and
//     the device, so a later run, a reconcile, or a teardown can find them;
//   - no false ready: the record says "ready" only after a run in which the
//     authorizing step actually ran.
//
// The fault is injected at the write, not by sleeping: the inventory discards a
// write whose result matches the test's predicate and reports the failure an
// activity sees when the process dies mid-step. Every run is bounded by
// testEnvTimeout and by assertBounded, so a hung workflow fails the test instead
// of passing slowly.

import (
	"context"
	"errors"
	"fmt"
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

const (
	// testEnvTimeout is the ceiling the test environment applies to one workflow
	// execution. A workflow that would wait is failed, never waited on.
	testEnvTimeout = 30 * time.Second
	// boundedRun is the wall-clock ceiling for one execution in this file. The test
	// environment runs on a virtual clock, so a correct run takes milliseconds; a
	// run that approaches this bound is waiting on something real, which is a
	// defect, not evidence.
	boundedRun = 10 * time.Second
)

// faultSpec describes one injected write failure.
type faultSpec struct {
	// dropWhen selects the write to lose: it sees the host before and after the
	// mutation, so a test can name the exact record — the allocation, the device,
	// or the readiness write — instead of counting calls.
	dropWhen func(before, after domain.Host) bool
	// persistent keeps dropping every matching write. One shot (the default) models
	// a single crash whose restarted worker is healthy; persistent models a worker
	// that never gets to record, which is how a "no false ready" test can still
	// inspect the record after the run.
	persistent bool
}

// faultInventory is the durable inventory with a failure injected at the write.
//
// A write whose post-mutation host matches the fault is not persisted: the call
// fails with the error an activity sees when the worker dies between doing the
// work and recording it. Reads always pass through, so the fault models a lost
// record rather than a broken database.
type faultInventory struct {
	inner    ports.HostRepository
	dropWhen func(before, after domain.Host) bool
	persists bool

	mu      sync.Mutex
	dropped int
}

var _ ports.HostRepository = (*faultInventory)(nil)

func (f *faultInventory) CreateHost(ctx context.Context, host domain.Host) (domain.Host, bool, error) {
	return f.inner.CreateHost(ctx, host)
}

func (f *faultInventory) GetHost(ctx context.Context, id string) (domain.Host, error) {
	return f.inner.GetHost(ctx, id)
}

func (f *faultInventory) ListHosts(ctx context.Context) ([]domain.Host, error) {
	return f.inner.ListHosts(ctx)
}

func (f *faultInventory) UpdateHost(ctx context.Context, id string, mutate func(h *domain.Host) error) (domain.Host, error) {
	before, err := f.inner.GetHost(ctx, id)
	if err != nil {
		return domain.Host{}, err
	}
	after := before.Clone()
	if err := mutate(&after); err != nil {
		return domain.Host{}, err
	}
	if f.shouldDrop(before, after) {
		f.mu.Lock()
		f.dropped++
		f.mu.Unlock()
		return domain.Host{}, errors.New("inventory write lost: the worker died before the record became durable")
	}
	return f.inner.UpdateHost(ctx, id, mutate)
}

func (f *faultInventory) shouldDrop(before, after domain.Host) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.dropWhen == nil || !f.dropWhen(before, after) {
		return false
	}
	if f.persists {
		return true
	}
	// One shot: the crash happened once, and the restarted worker is healthy.
	f.dropWhen = nil
	return true
}

// ClearFault stops injecting, which is what a resumed run after the fault clears
// looks like.
func (f *faultInventory) ClearFault() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.dropWhen = nil
}

// Dropped reports how many writes were lost.
func (f *faultInventory) Dropped() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.dropped
}

// recordingProvider is an idempotent provider: one instance per host name, and it
// counts allocations so a test can prove a resume did not ask for a second one.
// That is the shape the Terraform adapter has — it re-reads recorded state before
// planning an apply — so the counter models the real idempotency rather than
// papering over a missing one.
type recordingProvider struct {
	mu        sync.Mutex
	instances map[string]ports.ProviderResource
	allocs    int
	destroys  int
	refusals  int
}

var _ ports.HostProvider = (*recordingProvider)(nil)

func newRecordingProvider() *recordingProvider {
	return &recordingProvider{instances: map[string]ports.ProviderResource{}}
}

func (p *recordingProvider) CreateHost(_ context.Context, req ports.ProviderCreateRequest) (ports.ProviderResource, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.instances[req.Name]; ok {
		return existing, nil
	}
	p.allocs++
	resource := ports.ProviderResource{
		ResourceID:     "i-0000000000000000" + string(rune('0'+p.allocs)),
		PrivateAddress: "10.99.1.10",
	}
	p.instances[req.Name] = resource
	return resource, nil
}

func (p *recordingProvider) DestroyHost(_ context.Context, req ports.ProviderDestroyRequest) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if req.ResourceID == "" {
		p.refusals++
		return errors.New("test provider: destroy needs a resource id")
	}
	p.destroys++
	delete(p.instances, req.Name)
	return nil
}

// StatusHost implements ports.HostProvider: it reads what the provider
// already holds and creates nothing.
func (p *recordingProvider) StatusHost(_ context.Context, req ports.ProviderStatusRequest) (ports.ProviderResourceStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	existing, ok := p.instances[req.Name]
	if !ok {
		return ports.ProviderResourceStatus{Exists: false}, nil
	}
	if req.ResourceID != "" && existing.ResourceID != req.ResourceID {
		return ports.ProviderResourceStatus{}, fmt.Errorf("test provider: host %q state holds %q, not the recorded %q", req.Name, existing.ResourceID, req.ResourceID)
	}
	return ports.ProviderResourceStatus{
		Exists:         true,
		ResourceID:     existing.ResourceID,
		PrivateAddress: existing.PrivateAddress,
	}, nil
}

func (p *recordingProvider) Allocations() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.allocs
}

func (p *recordingProvider) Destroys() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.destroys
}

// countingAuthorizer counts authorization calls in front of the real identity use
// case, so a test can prove readiness was written by a run in which authorization
// actually ran.
type countingAuthorizer struct {
	inner       ports.HostAuthorizer
	mu          sync.Mutex
	calls       int
	revocations int
}

var _ ports.HostAuthorizer = (*countingAuthorizer)(nil)

func (c *countingAuthorizer) AuthorizeHost(ctx context.Context, req ports.AuthorizeRequest) error {
	c.mu.Lock()
	c.calls++
	c.mu.Unlock()
	return c.inner.AuthorizeHost(ctx, req)
}

func (c *countingAuthorizer) RevokeTokens(ctx context.Context, req ports.AuthorizeRequest) (ports.TokenRevocation, error) {
	c.mu.Lock()
	c.revocations++
	c.mu.Unlock()
	return c.inner.RevokeTokens(ctx, req)
}

func (c *countingAuthorizer) RevokeCredentials(ctx context.Context, req ports.AuthorizeRequest) (ports.CredentialRevocation, error) {
	c.mu.Lock()
	c.revocations++
	c.mu.Unlock()
	return c.inner.RevokeCredentials(ctx, req)
}

// Revocations reports how many revocation calls crossed the port.
func (c *countingAuthorizer) Revocations() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.revocations
}

func (c *countingAuthorizer) Calls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

// recoveryFixture is one host's worth of wired adapters over a real file-backed
// store, with a fault that the test can clear and re-run.
type recoveryFixture struct {
	t          *testing.T
	store      *jsonstore.Store
	inventory  *faultInventory
	provider   *recordingProvider
	tailnet    *fakes.Tailnet
	enroller   *fakes.Enroller
	backend    *fakes.IdentityBackend
	bootstrap  *fakes.Bootstrap
	authorizer *countingAuthorizer
	logger     *fakes.Logger
	activities *temporaladapter.Activities
}

func newRecoveryFixture(t *testing.T, spec faultSpec) *recoveryFixture {
	t.Helper()
	store, err := jsonstore.Open(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	now := time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC)
	if _, _, err := store.CreateHost(context.Background(), domain.Host{
		ID:            "host-0001",
		Name:          "canary-01",
		Provider:      domain.ProviderAWS,
		Profile:       "rex",
		Region:        "ap-south-1",
		Size:          "standard",
		InstanceType:  "t3.medium",
		DiskGB:        40,
		Tags:          map[string]string{"Name": "canary-01"},
		SecretBundles: []string{"bao:secret/data/hosts/host-0001/canary"},
		OwnerClientID: "test-client",
		JobID:         "create-host-0001",
		State:         domain.HostStateProvisioning,
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		t.Fatalf("seed host: %v", err)
	}

	logger := &fakes.Logger{}
	tailnet := fakes.NewTailnet()
	enroller := fakes.NewEnroller(tailnet)
	// The real enrollment use case, so the resume decision is the shipped one. A
	// resumed enrollment consults the tailnet by name and tag and never joins a
	// second device.
	enrollment, err := application.NewEnrollmentService(application.EnrollmentDeps{
		Profiles: fakes.Catalog(t),
		Devices:  tailnet,
		Enroller: enroller,
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("NewEnrollmentService: %v", err)
	}
	backend := fakes.NewIdentityBackend()
	bootstrap := fakes.NewBootstrap()
	identity, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  backend,
		Delivery: bootstrap,
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	provider := newRecordingProvider()
	inventory := &faultInventory{inner: store, dropWhen: spec.dropWhen, persists: spec.persistent}
	authorizer := &countingAuthorizer{inner: identity}

	return &recoveryFixture{
		t:          t,
		store:      store,
		inventory:  inventory,
		provider:   provider,
		tailnet:    tailnet,
		enroller:   enroller,
		backend:    backend,
		bootstrap:  bootstrap,
		authorizer: authorizer,
		logger:     logger,
		activities: &temporaladapter.Activities{
			Inventory:  inventory,
			Providers:  provider,
			Agent:      fakeProbe{},
			Enroller:   enrollment,
			Deployer:   fakeDeployer{},
			Readback:   fakeReadback{},
			Authorizer: authorizer,
			Tailnet:    fakeTailnet{},
			Clock:      fakes.NewClock(),
			Logger:     logger,
		},
	}
}

func (f *recoveryFixture) host() domain.Host {
	f.t.Helper()
	host, err := f.store.GetHost(context.Background(), "host-0001")
	if err != nil {
		f.t.Fatalf("GetHost: %v", err)
	}
	return host
}

// runCreate executes one CreateHostWorkflow against the fixture's adapters and
// returns its status and error. The execution is bounded twice: the environment
// fails a workflow that would wait, and the elapsed check fails a test that spent
// real time waiting.
func (f *recoveryFixture) runCreate() (workflows.Status, error) {
	f.t.Helper()
	started := time.Now()
	env := &testsuite.WorkflowTestSuite{}
	testEnv := env.NewTestWorkflowEnvironment()
	testEnv.SetTestTimeout(testEnvTimeout)
	testEnv.RegisterWorkflow(workflows.CreateHostWorkflow)
	testEnv.RegisterActivity(f.activities.CreateHostResource)
	testEnv.RegisterActivity(f.activities.CheckSSMAgent)
	testEnv.RegisterActivity(f.activities.EnrollHost)
	testEnv.RegisterActivity(f.activities.DeployProfile)
	testEnv.RegisterActivity(f.activities.ReadBackProfile)
	testEnv.RegisterActivity(f.activities.AuthorizeHost)
	testEnv.RegisterActivity(f.activities.RecordHostMilestone)

	testEnv.ExecuteWorkflow(workflows.CreateHostWorkflow, f.createInput())
	if !testEnv.IsWorkflowCompleted() {
		f.t.Fatal("the workflow did not complete inside the bounded test environment")
	}
	var status workflows.Status
	if err := testEnv.GetWorkflowResult(&status); err != nil && testEnv.GetWorkflowError() == nil {
		f.t.Fatalf("workflow result: %v", err)
	}
	assertBounded(f.t, time.Since(started))
	return status, testEnv.GetWorkflowError()
}

func (f *recoveryFixture) createInput() workflows.CreateHostInput {
	return workflows.CreateHostInput{
		Spec: workflows.HostSpec{
			HostID:        "host-0001",
			Name:          "canary-01",
			Provider:      string(domain.ProviderAWS),
			Profile:       "rex",
			Region:        "ap-south-1",
			Size:          "standard",
			InstanceType:  "t3.medium",
			DiskGB:        40,
			SecretBundles: []string{"bao:secret/data/hosts/host-0001/canary"},
		},
		JobID:          "create-host-0001",
		IdempotencyKey: "idem-key-0001",
		OwnerClientID:  "test-client",
	}
}

func assertBounded(t *testing.T, elapsed time.Duration) {
	t.Helper()
	if elapsed > boundedRun {
		t.Fatalf("the execution took %s, which means something really waited; a bounded run on the test clock takes milliseconds", elapsed)
	}
}

// TestRecoveryAfterCrashBetweenCreateAndRecord kills the worker after the provider
// allocated the instance and before the record became durable. The activity's
// retry must adopt the allocation: one instance exists, the record names it, and
// the job still reaches ready.
func TestRecoveryAfterCrashBetweenCreateAndRecord(t *testing.T) {
	t.Parallel()
	fixture := newRecoveryFixture(t, faultSpec{dropWhen: func(before, after domain.Host) bool {
		// Exactly the write that would have recorded the allocation.
		return before.ResourceID == "" && after.ResourceID != ""
	}})

	status, err := fixture.runCreate()
	if err != nil {
		t.Fatalf("the retried activity did not recover the job: %v", err)
	}
	if status.State != domain.JobReady {
		t.Fatalf("state = %q, want ready (stage %q, error %+v)", status.State, status.Stage, status.Error)
	}
	if dropped := fixture.inventory.Dropped(); dropped != 1 {
		t.Fatalf("dropped writes = %d, want the single allocation record", dropped)
	}
	if allocs := fixture.provider.Allocations(); allocs != 1 {
		t.Fatalf("provider allocations = %d, want exactly one instance for the host", allocs)
	}
	host := fixture.host()
	if host.ResourceID != status.ResourceID || host.ResourceID == "" {
		t.Fatalf("recorded resource id = %q, status resource id = %q; the allocation must be owned by the record", host.ResourceID, status.ResourceID)
	}
	if host.State != domain.HostStateReady {
		t.Fatalf("persisted state = %q, want ready after the resumed run", host.State)
	}
	if messages := strings.Join(fixture.logger.Lines(), "\n"); !strings.Contains(messages, "host.resource.adopted") && !strings.Contains(messages, "host.resource.created") {
		t.Fatalf("the run did not record how it obtained the resource:\n%s", messages)
	}
}

// TestRecoveryAfterCrashBetweenEnrollmentAndDeploy kills the worker after the
// device joined the tailnet and before the device id became durable. The retry
// must resume, not enroll again: one device exists, one enrollment ran, and the
// record still names that device.
func TestRecoveryAfterCrashBetweenEnrollmentAndDeploy(t *testing.T) {
	t.Parallel()
	fixture := newRecoveryFixture(t, faultSpec{dropWhen: func(before, after domain.Host) bool {
		return before.DeviceID == "" && after.DeviceID != ""
	}})

	status, err := fixture.runCreate()
	if err != nil {
		t.Fatalf("the retried enrollment did not recover the job: %v", err)
	}
	if status.State != domain.JobReady {
		t.Fatalf("state = %q, want ready (stage %q, error %+v)", status.State, status.Stage, status.Error)
	}
	if dropped := fixture.inventory.Dropped(); dropped != 1 {
		t.Fatalf("dropped writes = %d, want the single device record", dropped)
	}
	if joins := fixture.tailnet.JoinCount(); joins != 1 {
		t.Fatalf("tailnet joins = %d, want exactly one device", joins)
	}
	if devices := fixture.tailnet.Devices(); len(devices) != 1 {
		t.Fatalf("devices = %d, want exactly one", len(devices))
	}
	if calls := fixture.enroller.CallCount(); calls != 1 {
		t.Fatalf("enrollments = %d, want exactly one; the retry must resume the running device", calls)
	}
	host := fixture.host()
	if host.DeviceID == "" || host.DeviceID != status.DeviceID {
		t.Fatalf("recorded device id = %q, status device id = %q; ownership of the device must survive", host.DeviceID, status.DeviceID)
	}
}

// TestRecoveryAfterCrashBetweenAuthorizationAndReady kills the worker after the
// identity was authorized and before readiness became durable. Two things must
// hold: the record does not claim ready, and the resumed run authorizes again with
// the same role and reaches ready without a second identity.
func TestRecoveryAfterCrashBetweenAuthorizationAndReady(t *testing.T) {
	t.Parallel()
	// Persistent: the worker never gets to record readiness, so the record can be
	// inspected after the run without the retry quietly succeeding.
	fixture := newRecoveryFixture(t, faultSpec{
		dropWhen:   func(_, after domain.Host) bool { return after.State == domain.HostStateReady },
		persistent: true,
	})

	status, err := fixture.runCreate()
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if status.State != domain.JobReady {
		t.Fatalf("state = %q, want the workflow's own ready result", status.State)
	}
	if dropped := fixture.inventory.Dropped(); dropped == 0 {
		t.Fatal("no readiness write was lost, so the test did not reach the case it names")
	}
	// No false ready: the durable record is what other jobs act on, and it did not
	// receive the readiness write.
	if host := fixture.host(); host.State == domain.HostStateReady {
		t.Fatal("the record claims ready although its readiness write was lost")
	}
	if calls := fixture.authorizer.Calls(); calls != 1 {
		t.Fatalf("authorizations = %d, want one before readiness is written", calls)
	}

	fixture.inventory.ClearFault()
	status, err = fixture.runCreate()
	if err != nil {
		t.Fatalf("the resumed run failed: %v", err)
	}
	if status.State != domain.JobReady {
		t.Fatalf("resumed state = %q, want ready", status.State)
	}
	host := fixture.host()
	if host.State != domain.HostStateReady {
		t.Fatalf("persisted state = %q, want ready after the resumed run", host.State)
	}
	if calls := fixture.authorizer.Calls(); calls != 2 {
		t.Fatalf("authorizations = %d, want the resumed run to authorize again before readiness", calls)
	}
	if roles := fixture.backend.RoleNames(); len(roles) != 1 || roles[0] != "fleet-host-host-0001" {
		t.Fatalf("roles = %v, want exactly the host's own role", roles)
	}
	if policies := fixture.backend.PolicyNames(); len(policies) != 1 {
		t.Fatalf("policies = %v, want exactly one", policies)
	}
	if mints := len(fixture.backend.Mints()); mints != 2 {
		t.Fatalf("wrapped secret ids = %d, want one per authorization (a lost delivery is re-minted)", mints)
	}
	if allocs := fixture.provider.Allocations(); allocs != 1 {
		t.Fatalf("provider allocations = %d, want the resumed run to adopt the instance", allocs)
	}
	if joins := fixture.tailnet.JoinCount(); joins != 1 {
		t.Fatalf("tailnet joins = %d, want the resumed run to adopt the device", joins)
	}
}

// TestTeardownRefusesAmbiguousOwnership is the negative half of reconciliation: a
// teardown whose record names no provider resource destroys nothing. Ambiguity is an
// operator decision, not an automatic deletion.
//
// It also pins the reporting rule: the other cleanup steps still run (a token that
// can be revoked should be revoked whatever the provider record says), the
// terraform step is reported incomplete with the reason, and the record is not
// tombstoned.
func TestTeardownRefusesAmbiguousOwnership(t *testing.T) {
	t.Parallel()
	fixture := newRecoveryFixture(t, faultSpec{})

	started := time.Now()
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	env.SetTestTimeout(testEnvTimeout)
	env.RegisterWorkflow(workflows.DeleteHostWorkflow)
	env.RegisterActivity(fixture.activities.RevokeHostTokens)
	env.RegisterActivity(fixture.activities.RevokeHostCredentials)
	env.RegisterActivity(fixture.activities.RemoveDevice)
	env.RegisterActivity(fixture.activities.DestroyHostResource)
	env.RegisterActivity(fixture.activities.RecordHostMilestone)
	env.ExecuteWorkflow(workflows.DeleteHostWorkflow, workflows.DeleteHostInput{
		Spec: workflows.HostSpec{
			HostID:   "host-0001",
			Name:     "canary-01",
			Provider: string(domain.ProviderAWS),
			Profile:  "rex",
			Region:   "ap-south-1",
			Size:     "standard",
		},
		JobID: "delete-host-0001",
		// No resource id and no device id: the record cannot prove what it owns.
	})
	if !env.IsWorkflowCompleted() {
		t.Fatal("the teardown did not complete inside the bounded test environment")
	}
	assertBounded(t, time.Since(started))

	workflowErr := env.GetWorkflowError()
	if workflowErr == nil {
		t.Fatal("a teardown that could not finish every step must fail")
	}
	var appErr *temporal.ApplicationError
	if !errors.As(workflowErr, &appErr) {
		t.Fatalf("workflow error = %T (%v), want a Temporal application error", workflowErr, workflowErr)
	}
	if appErr.Type() != workflows.FailureTypeRetryable {
		t.Fatalf("failure type = %q, want the retryable type: cleanup steps are idempotent", appErr.Type())
	}
	for _, want := range []string{string(domain.CleanupRemoveDevice), string(domain.CleanupDestroyResources), "ownership is ambiguous"} {
		if !strings.Contains(appErr.Message(), want) {
			t.Fatalf("the failure does not report %q: %s", want, appErr.Message())
		}
	}
	if destroys := fixture.provider.Destroys(); destroys != 0 {
		t.Fatalf("destroys = %d, want none for an ambiguously owned host", destroys)
	}
	if joins := fixture.tailnet.Removals(); joins != 0 {
		t.Fatalf("device removals = %d, want none without a recorded device id", joins)
	}
	host := fixture.host()
	if host.State == domain.HostStateDeleted || host.Tombstone != nil {
		t.Fatal("the record was tombstoned although the teardown did not finish")
	}
	if !host.NeedsCleanup() {
		t.Fatal("the record does not say which cleanup is left")
	}
	if got := domain.IncompleteCleanup(host.PendingCleanup); !strings.Contains(got, string(domain.CleanupDestroyResources)) {
		t.Fatalf("pending cleanup = %q, want the destroy step named", got)
	}
}

// blockingEnroller makes the worker stop mid-step: the activity waits for the
// cancellation it is given and reports it, which is exactly what a cancelled
// activity does.
type blockingEnroller struct {
	once    sync.Once
	started chan struct{}
}

var _ ports.HostEnroller = (*blockingEnroller)(nil)

func (b *blockingEnroller) Enroll(ctx context.Context, _ ports.EnrollRequest) (ports.EnrollResult, error) {
	b.once.Do(func() { close(b.started) })
	<-ctx.Done()
	return ports.EnrollResult{}, ctx.Err()
}

// TestCancellationKeepsOwnershipAndDropsNoResource proves the cancellation
// property: a cancelled job reports "canceled", keeps the allocation it already
// made, and destroys nothing.
func TestCancellationKeepsOwnershipAndDropsNoResource(t *testing.T) {
	t.Parallel()
	fixture := newRecoveryFixture(t, faultSpec{})
	blocker := &blockingEnroller{started: make(chan struct{})}
	fixture.activities.Enroller = blocker

	started := time.Now()
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	env.SetTestTimeout(testEnvTimeout)
	env.RegisterWorkflow(workflows.CreateHostWorkflow)
	env.RegisterActivity(fixture.activities.CreateHostResource)
	env.RegisterActivity(fixture.activities.CheckSSMAgent)
	env.RegisterActivity(fixture.activities.EnrollHost)
	env.RegisterActivity(fixture.activities.DeployProfile)
	env.RegisterActivity(fixture.activities.ReadBackProfile)
	env.RegisterActivity(fixture.activities.AuthorizeHost)
	env.RegisterActivity(fixture.activities.RecordHostMilestone)
	go func() {
		<-blocker.started
		env.CancelWorkflow()
	}()
	env.ExecuteWorkflow(workflows.CreateHostWorkflow, fixture.createInput())
	if !env.IsWorkflowCompleted() {
		t.Fatal("the cancelled workflow did not complete inside the bounded test environment")
	}
	assertBounded(t, time.Since(started))

	if env.GetWorkflowError() == nil {
		t.Fatal("a cancelled job must not report success")
	}
	if destroys := fixture.provider.Destroys(); destroys != 0 {
		t.Fatalf("destroys = %d, want none: cancellation never tears anything down", destroys)
	}
	if allocs := fixture.provider.Allocations(); allocs != 1 {
		t.Fatalf("allocations = %d, want the one the job had already made", allocs)
	}
	host := fixture.host()
	if host.ResourceID == "" {
		t.Fatal("the cancellation dropped ownership of the allocated resource")
	}
	if host.State != domain.HostStateProvisioning {
		t.Fatalf("persisted state = %q, want the record to stay owned (provisioning)", host.State)
	}
	if messages := strings.Join(fixture.logger.Lines(), "\n"); !strings.Contains(messages, "canceled") && !strings.Contains(messages, "state canceled") {
		t.Fatalf("the cancellation was not recorded as a milestone:\n%s", messages)
	}
}
