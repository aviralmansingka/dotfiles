package main

import (
	"errors"
	"flag"
	"fmt"
	"net/http"
	"time"

	"go.temporal.io/sdk/worker"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/openbao"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssh"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/tailscale"
	temporaladapter "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/temporal"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/terraform"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

func runWorker(args []string) error {
	flags := flag.NewFlagSet("worker", flag.ContinueOnError)
	configPath := flags.String("config", defaultConfigPath, "path to the non-secret service config")
	if err := flags.Parse(args); err != nil {
		return err
	}
	state, err := load(*configPath)
	if err != nil {
		return err
	}
	defer state.temporal.Close()

	provider, err := newHostProvider(state)
	if err != nil {
		return err
	}

	enrollee, agent, deviceManager, err := newEnrollment(state)
	if err != nil {
		return err
	}

	authorizer, err := newAuthorizer(state)
	if err != nil {
		return err
	}

	// Enrollment runs over SSM only: the agent check gates it, the key travels as
	// an encrypted parameter, and the command carries a parameter path. Profile
	// deployment (S04) remains a refusing stub, so no job can reach "ready" before
	// it lands. The authorizing and revoking stages are the real OpenBao adapter:
	// per-host AppRole, own-path policy, one-use wrapped SecretID delivered as a
	// 0600 file, and token revocation by accessor. Device removal is the real
	// Tailscale adapter when enrollment is configured, and the refusing stub
	// otherwise, so a teardown can never report a device removed that it never
	// touched.
	activities := &temporaladapter.Activities{
		Inventory:  state.store,
		Providers:  provider,
		Agent:      agent,
		Enroller:   enrollee,
		Deployer:   ssh.NewStub(),
		Authorizer: authorizer,
		Tailnet:    deviceManager,
		Clock:      application.WallClock{},
		Logger:     state.log,
	}
	bounded, err := temporaladapter.NewWorker(state.temporal, state.service.Temporal.TaskQueue, worker.Options{
		MaxConcurrentWorkflowTaskExecutionSize: state.service.Limits.MaxConcurrentJobs,
		MaxConcurrentActivityExecutionSize:     state.service.Limits.MaxConcurrentProvision,
	}, activities)
	if err != nil {
		return err
	}
	state.log.Info("worker.starting",
		"namespace", state.service.Temporal.Namespace,
		"task_queue", state.service.Temporal.TaskQueue,
		"max_concurrent_jobs", state.service.Limits.MaxConcurrentJobs,
	)
	return bounded.Run(worker.InterruptCh())
}

// newEnrollment builds the SSM-only enrollment chain from the approved
// configuration: the OpenBao secret source, the Tailscale key minter and device
// manager, the encrypted-parameter handoff, the run-command transport, and the
// agent check that gates all of them.
//
// It returns the enroller, the agent probe, and the tailnet device manager
// separately because each is its own activity. A half-configured block is refused
// at load time. When enrollment is not configured at all the refusing stubs are
// kept, so no job can reach "ready" without a real enrollment step and no teardown
// can claim a device was removed by a component that is not wired.
func newEnrollment(state *loaded) (ports.HostEnroller, ports.SSMAgentProbe, ports.TailnetDeviceManager, error) {
	cfg := state.service.Enrollment
	if !cfg.Configured() {
		state.log.Warn("enrollment.not_configured",
			"reason", "enrollment.tailscale.oauth_secret_ref, enrollment.openbao.token_file, and enrollment.ssm.parameter_prefix are not all set; enrollment and device removal stay refusing stubs")
		stub := ssm.NewStub()
		return stub, stub, tailscale.NewStub(), nil
	}
	secrets, err := openbao.NewSecretSource(openbao.SecretSourceConfig{
		Address:   cfg.OpenBao.Address,
		TokenFile: cfg.OpenBao.TokenFile,
		Namespace: cfg.OpenBao.Namespace,
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("enrollment secret source: %w", err)
	}
	clientConfig := tailscale.ClientConfig{
		HTTP:           &http.Client{Timeout: 30 * time.Second},
		BaseURL:        cfg.Tailscale.BaseURL,
		Tailnet:        cfg.Tailscale.Tailnet,
		OAuthClientID:  cfg.Tailscale.OAuthClientID,
		OAuthSecretRef: cfg.Tailscale.OAuthSecretRef,
		Secrets:        secrets,
		Clock:          application.WallClock{},
		Logger:         state.log,
	}
	minter, err := tailscale.NewMinter(clientConfig)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("enrollment key minter: %w", err)
	}
	devices, err := tailscale.NewDevices(clientConfig)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("enrollment device lookup: %w", err)
	}

	// One SSM configuration for every call: the same region and the same pinned CLI
	// binary. There is no credential field and no key field anywhere in it,
	// because the AWS CLI runs with the worker's own credential source.
	pollInterval := time.Duration(cfg.SSM.PollIntervalSeconds) * time.Second
	ssmClient := ssm.ClientConfig{Binary: cfg.SSM.Binary, Region: cfg.SSM.Region, Executor: ssm.CLIExecutor{}}
	parameters, err := ssm.NewParameterStore(ssm.ParameterStoreConfig{Client: ssmClient})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("enrollment parameter store: %w", err)
	}
	runner, err := ssm.NewRunner(ssm.RunnerConfig{
		Client:                ssmClient,
		CommandTimeoutSeconds: cfg.SSM.CommandTimeoutSeconds,
		PollInterval:          pollInterval,
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("enrollment run-command transport: %w", err)
	}
	agent, err := ssm.NewAgentProbe(ssm.AgentProbeConfig{
		Client:       ssmClient,
		Timeout:      time.Duration(cfg.SSM.AgentTimeoutSeconds) * time.Second,
		PollInterval: pollInterval,
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("enrollment agent probe: %w", err)
	}
	enroller, err := ssm.NewEnroller(ssm.EnrollConfig{
		Runner:          runner,
		Parameters:      parameters,
		Agent:           agent,
		Minter:          minter,
		ParameterPrefix: cfg.SSM.ParameterPrefix,
		Region:          cfg.SSM.Region,
		HostKeyPath:     cfg.SSM.HostKeyPath,
		Logger:          state.log,
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("enrollment enroller: %w", err)
	}
	service, err := application.NewEnrollmentService(application.EnrollmentDeps{
		Profiles: state.catalog,
		Devices:  devices,
		Enroller: enroller,
		Logger:   state.log,
	})
	if err != nil {
		return nil, nil, nil, err
	}
	// The same adapter answers device removal: it is the only component that holds
	// the tailnet credential and knows a device id from a name.
	return service, agent, devices, nil
}

// newAuthorizer builds the per-host OpenBao identity adapter.
//
// It fails rather than falling back to the refusing stub: a worker that cannot
// authorize a host would create the AWS resource and then fail the job at the last
// stage, leaving a real instance with no identity. The management token is read
// once from a 0600 file, and bootstrap material is written as 0600 files outside
// the Nix store, Git, Terraform state, and every job record.
func newAuthorizer(state *loaded) (ports.HostAuthorizer, error) {
	cfg := state.service.OpenBao
	if !cfg.Configured() {
		return nil, errors.New("openbao identity is not configured: set openbao.address, openbao.token_file, and openbao.bootstrap_dir")
	}
	admin, err := openbao.NewIdentityAdmin(openbao.IdentityConfig{
		Address:   cfg.Address,
		TokenFile: cfg.TokenFile,
		Namespace: cfg.Namespace,
	})
	if err != nil {
		return nil, fmt.Errorf("openbao identity adapter: %w", err)
	}
	delivery, err := openbao.NewBootstrapWriter(openbao.BootstrapConfig{Dir: cfg.BootstrapDir})
	if err != nil {
		return nil, fmt.Errorf("openbao bootstrap delivery: %w", err)
	}
	authorizer, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  admin,
		Delivery: delivery,
		Logger:   state.log,
		TokenPolicy: domain.TokenPolicy{
			TTL:            cfg.TokenTTL(),
			MaxTTL:         cfg.MaxTokenTTL(),
			RenewIncrement: domain.TokenRenewIncrement,
			Renewable:      true,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("openbao identity service: %w", err)
	}
	return authorizer, nil
}

// newHostProvider builds the AWS compute provider from the approved
// configuration. It fails rather than falling back to the refusing stub: a
// worker that cannot create hosts must not start and must not report success.
func newHostProvider(state *loaded) (ports.HostProvider, error) {
	aws := state.service.Providers["aws"]
	provider, err := terraform.NewAWS(terraform.AWSConfig{
		Profiles:         state.catalog,
		Dir:              aws.Terraform.Dir,
		RunDir:           aws.Terraform.RunDir,
		SSHPublicKeyFile: aws.Bootstrap.SSHPublicKeyFile,
		BootstrapCIDR:    aws.Bootstrap.SSHSourceCIDR,
		StateBucket:      aws.Terraform.StateBucket,
		StateRegion:      aws.Terraform.StateRegion,
		VPCID:            aws.Terraform.VPCID,
		SubnetID:         aws.Terraform.SubnetID,
		OwnerTag:         aws.Terraform.OwnerTag,
		TestRunTag:       aws.Terraform.TestRunTag,
		Binary:           aws.Terraform.Binary,
		Timeout:          time.Duration(aws.Terraform.TimeoutSeconds) * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("aws host provider: %w", err)
	}
	return provider, nil
}
