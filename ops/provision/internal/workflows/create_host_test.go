package workflows_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
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

// The offline activity doubles. Each one answers a port, so the test proves the
// workflow's authorizing stage reaches the HostAuthorizer port and nothing else.
type fakeProvider struct{}

func (fakeProvider) CreateHost(_ context.Context, req ports.ProviderCreateRequest) (ports.ProviderResource, error) {
	return ports.ProviderResource{ResourceID: "i-0123456789abcdef0", PrivateAddress: "10.99.1.10"}, nil
}

func (fakeProvider) DestroyHost(_ context.Context, _ ports.ProviderDestroyRequest) error {
	return nil
}

func (fakeProvider) StatusHost(_ context.Context, req ports.ProviderStatusRequest) (ports.ProviderResourceStatus, error) {
	return ports.ProviderResourceStatus{Exists: true, ResourceID: "i-0123456789abcdef0", PrivateAddress: "10.99.1.10"}, nil
}

type fakeProbe struct{}

func (fakeProbe) AwaitRegistration(_ context.Context, instanceID string) (ports.SSMAgentStatus, error) {
	return ports.SSMAgentStatus{InstanceID: instanceID, PingStatus: "Online", Online: true}, nil
}

type fakeDeployer struct{}

func (fakeDeployer) DeployProfile(_ context.Context, req ports.DeployRequest) (ports.DeployResult, error) {
	return ports.DeployResult{FlakeRevision: "rev-1", RexURL: "https://rex.example"}, nil
}

// fakeReadback answers the second profile step. It reports its own revision on
// purpose: the workflow's recorded revision must come from here, not from the
// deploy, and a test can tell the two apart only if they differ.
type fakeReadback struct{}

func (fakeReadback) ReadBackProfile(_ context.Context, req ports.ReadbackRequest) (ports.ReadbackResult, error) {
	return ports.ReadbackResult{
		FlakeRevision: "rev-verified-" + req.FlakeRevision,
		RexURL:        "https://rex.example",
		RexPath:       "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-rex/bin/rex",
		Facts:         []string{"rex_resolves_to_nix_store"},
	}, nil
}

type fakeTailnet struct{}

func (fakeTailnet) RemoveDevice(_ context.Context, _ ports.RemoveDeviceRequest) error {
	return nil
}

// TestCreateHostReachesAuthorizedStateThroughTheAdapterPort runs the real
// CreateHostWorkflow against the real activity implementations, with an
// in-process fake authorizer behind the port. The job must reach "ready", and the
// authorizing stage must have been the step that called the port exactly once.
func TestCreateHostReachesAuthorizedStateThroughTheAdapterPort(t *testing.T) {
	t.Parallel()
	store, err := jsonstore.Open(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	// The API records the host before it starts the workflow, so the milestone
	// activity has a record to update.
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
	backend := fakes.NewIdentityBackend()
	bootstrap := fakes.NewBootstrap()
	logger := &fakes.Logger{}
	authorizer, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  backend,
		Delivery: bootstrap,
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	activities := &temporaladapter.Activities{
		Inventory:  store,
		Providers:  fakeProvider{},
		Agent:      fakeProbe{},
		Enroller:   fakes.NewEnroller(fakes.NewTailnet()),
		Deployer:   fakeDeployer{},
		Readback:   fakeReadback{},
		Authorizer: authorizer,
		Tailnet:    fakeTailnet{},
		Clock:      fakes.NewClock(),
		Logger:     logger,
	}
	if err := activities.Validate(); err != nil {
		t.Fatalf("Activities.Validate: %v", err)
	}

	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(workflows.CreateHostWorkflow)
	env.RegisterActivity(activities.CreateHostResource)
	env.RegisterActivity(activities.CheckSSMAgent)
	env.RegisterActivity(activities.EnrollHost)
	env.RegisterActivity(activities.DeployProfile)
	env.RegisterActivity(activities.ReadBackProfile)
	env.RegisterActivity(activities.AuthorizeHost)
	env.RegisterActivity(activities.RecordHostMilestone)

	bundles := []string{"bao:secret/data/hosts/host-0001/canary"}
	env.ExecuteWorkflow(workflows.CreateHostWorkflow, workflows.CreateHostInput{
		Spec: workflows.HostSpec{
			HostID:        "host-0001",
			Name:          "canary-01",
			Provider:      string(domain.ProviderAWS),
			Profile:       "rex",
			Region:        "ap-south-1",
			Size:          "standard",
			InstanceType:  "t3.medium",
			DiskGB:        40,
			SecretBundles: bundles,
		},
		JobID:          "create-host-0001",
		IdempotencyKey: "idem-key-0001",
		OwnerClientID:  "test-client",
	})
	if !env.IsWorkflowCompleted() {
		t.Fatal("the workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var status workflows.Status
	if err := env.GetWorkflowResult(&status); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if status.State != domain.JobReady {
		t.Fatalf("state = %q, want ready (stage %q, error %+v)", status.State, status.Stage, status.Error)
	}
	if status.Stage != domain.StageReady {
		t.Fatalf("stage = %q, want ready", status.Stage)
	}
	if status.ResourceID != "i-0123456789abcdef0" {
		t.Fatalf("resource id = %q", status.ResourceID)
	}

	// The authorizing stage went through the adapter port: one role, one policy,
	// one wrapped delivery for the host.
	if roles := backend.RoleNames(); len(roles) != 1 || roles[0] != "fleet-host-host-0001" {
		t.Fatalf("roles = %v, want the host's own role", roles)
	}
	if mints := backend.Mints(); len(mints) != 1 {
		t.Fatalf("mints = %v, want exactly one wrapped SecretID", mints)
	}
	if delivered := bootteeCount(bootstrap); delivered != 1 {
		t.Fatalf("bootstrap deliveries = %d, want 1", delivered)
	}

	// The durable milestone records readiness outside workflow history.
	host, err := store.GetHost(context.Background(), "host-0001")
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if host.State != domain.HostStateReady {
		t.Fatalf("persisted host state = %q, want ready", host.State)
	}
	// The revision in the record is the one the readback proved, not the one the
	// deploy reported and not anything a caller supplied.
	if host.FlakeRevision != "rev-verified-rev-1" {
		t.Fatalf("persisted flake revision = %q, want the readback's", host.FlakeRevision)
	}
	if status.FlakeRevision != "rev-verified-rev-1" {
		t.Fatalf("job flake revision = %q, want the readback's", status.FlakeRevision)
	}

	// The workflow result carries references only.
	payload, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	rendered := string(payload)
	for _, forbidden := range []string{"wrap-token", "secret_id", "secret-id"} {
		if strings.Contains(strings.ToLower(rendered), forbidden) {
			t.Fatalf("the workflow result carries %q: %s", forbidden, rendered)
		}
	}
}

// TestCreateHostFailsWhenTheAuthorizerRefuses keeps the stage load-bearing: a
// permanently refused identity fails the job at "authorizing" with a
// non-retryable, sanitized error, and no later stage runs.
func TestCreateHostFailsWhenTheAuthorizerRefuses(t *testing.T) {
	t.Parallel()
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
	backend := fakes.NewIdentityBackend()
	// A role already bound to another host is a permanent refusal.
	backend.SeedRoleClaim("fleet-host-host-0001", "host-0002")
	logger := &fakes.Logger{}
	authorizer, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  backend,
		Delivery: fakes.NewBootstrap(),
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	activities := &temporaladapter.Activities{
		Inventory:  store,
		Providers:  fakeProvider{},
		Agent:      fakeProbe{},
		Enroller:   fakes.NewEnroller(fakes.NewTailnet()),
		Deployer:   fakeDeployer{},
		Readback:   fakeReadback{},
		Authorizer: authorizer,
		Tailnet:    fakeTailnet{},
		Clock:      fakes.NewClock(),
		Logger:     logger,
	}

	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(workflows.CreateHostWorkflow)
	env.RegisterActivity(activities.CreateHostResource)
	env.RegisterActivity(activities.CheckSSMAgent)
	env.RegisterActivity(activities.EnrollHost)
	env.RegisterActivity(activities.DeployProfile)
	env.RegisterActivity(activities.ReadBackProfile)
	env.RegisterActivity(activities.AuthorizeHost)
	env.RegisterActivity(activities.RecordHostMilestone)

	env.ExecuteWorkflow(workflows.CreateHostWorkflow, workflows.CreateHostInput{
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
		JobID: "create-host-0001",
	})
	if !env.IsWorkflowCompleted() {
		t.Fatal("the workflow did not complete")
	}
	workflowErr := env.GetWorkflowError()
	if workflowErr == nil {
		t.Fatal("a refused identity must fail the workflow")
	}
	var appErr *temporal.ApplicationError
	if !errors.As(workflowErr, &appErr) {
		t.Fatalf("workflow error = %T (%v), want a Temporal application error", workflowErr, workflowErr)
	}
	if appErr.Type() != workflows.FailureTypePermanent {
		t.Fatalf("failure type = %q, want the permanent type", appErr.Type())
	}
	if !strings.Contains(appErr.Message(), "already claimed by host host-0002") {
		t.Fatalf("the failure does not carry the refusal: %s", appErr.Message())
	}
	if mints := backend.Mints(); len(mints) != 0 {
		t.Fatalf("a refused host was minted a SecretID: %v", mints)
	}
	host, err := store.GetHost(context.Background(), "host-0001")
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if host.State != domain.HostStateFailed {
		t.Fatalf("persisted host state = %q, want failed", host.State)
	}
	milestones := strings.Join(logger.Lines(), "\n")
	if !strings.Contains(milestones, "stage authorizing") {
		t.Fatalf("the job did not fail at the authorizing stage:\n%s", milestones)
	}
}

func bootteeCount(b *fakes.Bootstrap) int { return len(b.Deliveries()) }

// failingDeployer models an activation that exited non-zero: the profile did not
// land, so nothing after the deploy may run.
type failingDeployer struct {
	err   error
	calls int
}

func (f *failingDeployer) DeployProfile(_ context.Context, _ ports.DeployRequest) (ports.DeployResult, error) {
	f.calls++
	return ports.DeployResult{}, f.err
}

// countingReadback reports that the readback ran, which it must not after a failed
// deploy.
type countingReadback struct{ calls int }

func (c *countingReadback) ReadBackProfile(_ context.Context, _ ports.ReadbackRequest) (ports.ReadbackResult, error) {
	c.calls++
	return ports.ReadbackResult{FlakeRevision: "rev-never"}, nil
}

// TestCreateHostNeverReachesReadyWhenActivationFails is the property the deploy
// stage exists for. A switch that exited non-zero fails the job at "deploying": the
// readback never runs, the authorizing stage never runs, and the job is never
// reported ready.
func TestCreateHostNeverReachesReadyWhenActivationFails(t *testing.T) {
	t.Parallel()
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
	authorizer, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  fakes.NewIdentityBackend(),
		Delivery: fakes.NewBootstrap(),
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	deployer := &failingDeployer{err: errors.New("activate the profile did not succeed (status \"Failed\", exit 100)")}
	readback := &countingReadback{}
	activities := &temporaladapter.Activities{
		Inventory:  store,
		Providers:  fakeProvider{},
		Agent:      fakeProbe{},
		Enroller:   fakes.NewEnroller(fakes.NewTailnet()),
		Deployer:   deployer,
		Readback:   readback,
		Authorizer: authorizer,
		Tailnet:    fakeTailnet{},
		Clock:      fakes.NewClock(),
		Logger:     logger,
	}

	env := (&testsuite.WorkflowTestSuite{}).NewTestWorkflowEnvironment()
	env.RegisterWorkflow(workflows.CreateHostWorkflow)
	env.RegisterActivity(activities.CreateHostResource)
	env.RegisterActivity(activities.CheckSSMAgent)
	env.RegisterActivity(activities.EnrollHost)
	env.RegisterActivity(activities.DeployProfile)
	env.RegisterActivity(activities.ReadBackProfile)
	env.RegisterActivity(activities.AuthorizeHost)
	env.RegisterActivity(activities.RecordHostMilestone)
	env.ExecuteWorkflow(workflows.CreateHostWorkflow, workflows.CreateHostInput{
		Spec: workflows.HostSpec{
			HostID:       "host-0001",
			Name:         "canary-01",
			Provider:     string(domain.ProviderAWS),
			Profile:      "rex",
			Region:       "ap-south-1",
			Size:         "standard",
			InstanceType: "t3.medium",
			DiskGB:       40,
		},
		JobID: "create-host-0001",
	})
	if !env.IsWorkflowCompleted() {
		t.Fatal("the workflow did not complete")
	}
	if env.GetWorkflowError() == nil {
		t.Fatal("a failed activation reported success")
	}
	if readback.calls != 0 {
		t.Fatalf("the readback ran %d times after a failed deploy", readback.calls)
	}
	if deployer.calls == 0 {
		t.Fatal("the deploy never ran")
	}
	if roles := len(fakes.NewIdentityBackend().RoleNames()); roles != 0 {
		t.Fatalf("roles = %d, want none: authorizing must not run after a failed deploy", roles)
	}
	host, err := store.GetHost(context.Background(), "host-0001")
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if host.State == domain.HostStateReady {
		t.Fatal("the durable record says ready after a failed activation")
	}
	if host.State != domain.HostStateFailed {
		t.Fatalf("persisted host state = %q, want failed", host.State)
	}
	if host.FlakeRevision != "" || host.RexURL != "" {
		t.Fatalf("a failed deploy recorded revision %q and address %q", host.FlakeRevision, host.RexURL)
	}
}
