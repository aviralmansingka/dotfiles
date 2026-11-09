// Command provision runs the private fleet provisioning API and its Temporal
// worker.
//
//	provision api     --config /etc/fleet-provision/service.yaml
//	provision worker  --config /etc/fleet-provision/service.yaml
//	provision token-digest < client-token
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	httpapi "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/http"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/idgen"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/openbao"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssh"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/ssm"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/store/jsonstore"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/tailscale"
	temporaladapter "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/temporal"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/terraform"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/tokenstore"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/config"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const defaultConfigPath = "/etc/fleet-provision/service.yaml"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "provision: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "api":
		return runAPI(args[1:])
	case "worker":
		return runWorker(args[1:])
	case "token-digest":
		return runTokenDigest(args[1:])
	case "help", "-h", "--help":
		return usage()
	default:
		return fmt.Errorf("unknown subcommand %q\n\n%s", args[0], usageText())
	}
}

func usage() error {
	fmt.Fprint(os.Stderr, usageText())
	return nil
}

func usageText() string {
	return `usage:
  provision api    --config <path>   # authenticated HTTP API on loopback
  provision worker --config <path>   # Temporal worker for provisioning workflows
  provision token-digest             # print the SHA-256 digest of a token read from stdin

The service config holds no credential values: only paths and OpenBao references.
`
}

type slogLogger struct{ logger *slog.Logger }

func (l slogLogger) Info(msg string, kv ...any)  { l.logger.Info(msg, kv...) }
func (l slogLogger) Warn(msg string, kv ...any)  { l.logger.Warn(msg, kv...) }
func (l slogLogger) Error(msg string, kv ...any) { l.logger.Error(msg, kv...) }

func newLogger(cfg config.Logging) application.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(cfg.Level) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	options := &slog.HandlerOptions{Level: level}
	var handler slog.Handler
	if cfg.Format == "text" {
		handler = slog.NewTextHandler(os.Stderr, options)
	} else {
		handler = slog.NewJSONHandler(os.Stderr, options)
	}
	return slogLogger{logger: slog.New(handler)}
}

// loaded is the composition shared by the api and worker subcommands.
type loaded struct {
	service  *config.Service
	catalog  domain.Catalog
	store    *jsonstore.Store
	tokens   *tokenstore.File
	log      application.Logger
	temporal client.Client
}

func load(configPath string) (*loaded, error) {
	service, err := config.LoadService(configPath)
	if err != nil {
		return nil, err
	}
	catalog, err := config.LoadProfiles(service.ProfilesFile)
	if err != nil {
		return nil, err
	}
	store, err := jsonstore.Open(service.Storage.StateFile)
	if err != nil {
		return nil, err
	}
	tokens, err := tokenstore.Load(service.Tokens.File)
	if err != nil {
		return nil, err
	}
	temporalClient, err := client.Dial(client.Options{
		HostPort:  service.Temporal.HostPort,
		Namespace: service.Temporal.Namespace,
	})
	if err != nil {
		return nil, fmt.Errorf("connect to temporal at %s: %w", service.Temporal.HostPort, err)
	}
	return &loaded{
		service:  service,
		catalog:  catalog,
		store:    store,
		tokens:   tokens,
		log:      newLogger(service.Logging),
		temporal: temporalClient,
	}, nil
}

func runAPI(args []string) error {
	flags := flag.NewFlagSet("api", flag.ContinueOnError)
	configPath := flags.String("config", defaultConfigPath, "path to the non-secret service config")
	if err := flags.Parse(args); err != nil {
		return err
	}
	state, err := load(*configPath)
	if err != nil {
		return err
	}
	defer state.temporal.Close()

	orchestrator, err := temporaladapter.NewOrchestrator(state.temporal, state.service.Temporal.Namespace, state.service.Temporal.TaskQueue, state.log)
	if err != nil {
		return err
	}
	service, err := application.New(application.Deps{
		Profiles: state.catalog,
		Hosts:    state.store,
		Ledger:   state.store,
		Jobs:     orchestrator,
		Tokens:   state.tokens,
		Clock:    application.WallClock{},
		IDs:      idgen.Generator{},
		Logger:   state.log,
	})
	if err != nil {
		return err
	}
	api, err := httpapi.New(service, state.log)
	if err != nil {
		return err
	}

	server := &http.Server{
		Addr:              state.service.API.Listen,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	errs := make(chan error, 1)
	go func() {
		state.log.Info("api.listening", "address", state.service.API.Listen, "tls", state.service.API.TLS.Enabled())
		var serveErr error
		if state.service.API.TLS.Enabled() {
			serveErr = server.ListenAndServeTLS(state.service.API.TLS.CertFile, state.service.API.TLS.KeyFile)
		} else {
			serveErr = server.ListenAndServe()
		}
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			errs <- serveErr
			return
		}
		errs <- nil
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		state.log.Info("api.shutting_down")
		return server.Shutdown(shutdownCtx)
	}
}

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

	enrollee, agent, err := newEnrollment(state)
	if err != nil {
		return err
	}

	// Enrollment runs over SSM only: the agent check gates it, the key travels as
	// an encrypted parameter, and the command carries a parameter path. Profile
	// deployment (S04), OpenBao host identity (S05), and device removal (S07)
	// remain refusing stubs, so no job can reach "ready" before those land.
	activities := &temporaladapter.Activities{
		Inventory:  state.store,
		Providers:  provider,
		Agent:      agent,
		Enroller:   enrollee,
		Deployer:   ssh.NewStub(),
		Authorizer: openbao.NewStub(),
		Tailnet:    tailscale.NewStub(),
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
// lookup, the encrypted-parameter handoff, the run-command transport, and the
// agent check that gates all of them.
//
// It returns the enroller and the agent probe separately because the probe is its
// own workflow activity. A half-configured block is refused at load time. When
// enrollment is not configured at all the refusing stubs are kept, so a job cannot
// reach "ready" without a real enrollment step.
func newEnrollment(state *loaded) (application.HostEnroller, application.SSMAgentProbe, error) {
	cfg := state.service.Enrollment
	if !cfg.Configured() {
		state.log.Warn("enrollment.not_configured",
			"reason", "enrollment.tailscale.oauth_secret_ref, enrollment.openbao.token_file, and enrollment.ssm.parameter_prefix are not all set; enrollment stays a refusing stub")
		stub := ssm.NewStub()
		return stub, stub, nil
	}
	secrets, err := openbao.NewSecretSource(openbao.SecretSourceConfig{
		Address:   cfg.OpenBao.Address,
		TokenFile: cfg.OpenBao.TokenFile,
		Namespace: cfg.OpenBao.Namespace,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("enrollment secret source: %w", err)
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
		return nil, nil, fmt.Errorf("enrollment key minter: %w", err)
	}
	devices, err := tailscale.NewDevices(clientConfig)
	if err != nil {
		return nil, nil, fmt.Errorf("enrollment device lookup: %w", err)
	}

	// One SSM configuration for every call: the same region and the same pinned CLI
	// binary. There is no credential field and no key field anywhere in it,
	// because the AWS CLI runs with the worker's own credential source.
	pollInterval := time.Duration(cfg.SSM.PollIntervalSeconds) * time.Second
	ssmClient := ssm.ClientConfig{Binary: cfg.SSM.Binary, Region: cfg.SSM.Region, Executor: ssm.CLIExecutor{}}
	parameters, err := ssm.NewParameterStore(ssm.ParameterStoreConfig{Client: ssmClient})
	if err != nil {
		return nil, nil, fmt.Errorf("enrollment parameter store: %w", err)
	}
	runner, err := ssm.NewRunner(ssm.RunnerConfig{
		Client:                ssmClient,
		CommandTimeoutSeconds: cfg.SSM.CommandTimeoutSeconds,
		PollInterval:          pollInterval,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("enrollment run-command transport: %w", err)
	}
	agent, err := ssm.NewAgentProbe(ssm.AgentProbeConfig{
		Client:       ssmClient,
		Timeout:      time.Duration(cfg.SSM.AgentTimeoutSeconds) * time.Second,
		PollInterval: pollInterval,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("enrollment agent probe: %w", err)
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
		return nil, nil, fmt.Errorf("enrollment enroller: %w", err)
	}
	service, err := application.NewEnrollmentService(application.EnrollmentDeps{
		Profiles: state.catalog,
		Devices:  devices,
		Enroller: enroller,
		Logger:   state.log,
	})
	if err != nil {
		return nil, nil, err
	}
	return service, agent, nil
}

// newHostProvider builds the AWS compute provider from the approved
// configuration. It fails rather than falling back to the refusing stub: a
// worker that cannot create hosts must not start and must not report success.
func newHostProvider(state *loaded) (application.HostProvider, error) {
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

func runTokenDigest(args []string) error {
	flags := flag.NewFlagSet("token-digest", flag.ContinueOnError)
	if err := flags.Parse(args); err != nil {
		return err
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return fmt.Errorf("read token from stdin: %w", err)
		}
		return errors.New("read token from stdin: empty input")
	}
	token := strings.TrimSpace(scanner.Text())
	if token == "" {
		return errors.New("read token from stdin: empty token")
	}
	fmt.Println(application.TokenDigest(token))
	return nil
}
