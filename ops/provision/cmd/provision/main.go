// Command provision runs the private fleet provisioning API and its Temporal
// worker.
//
//	provision api     --config /etc/fleet-provision/service.yaml
//	provision worker  --config /etc/fleet-provision/service.yaml
//	provision token-digest < client-token
package main

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"go.temporal.io/sdk/client"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/store/jsonstore"
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
	return application.NewRedactingLogger(slogLogger{logger: slog.New(handler)})
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
