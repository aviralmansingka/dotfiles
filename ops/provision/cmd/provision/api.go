package main

import (
	"context"
	"errors"
	"flag"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	httpapi "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/http"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/idgen"
	temporaladapter "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/temporal"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

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
