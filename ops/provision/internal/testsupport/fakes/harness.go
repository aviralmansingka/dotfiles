package fakes

import (
	"path/filepath"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/store/jsonstore"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Harness wires a Service to a real file-backed store in a temporary directory
// and a fake orchestrator, token store, clock, and logger.
type Harness struct {
	T            *testing.T
	Dir          string
	Store        *jsonstore.Store
	Orchestrator *Orchestrator
	Logger       *Logger
	Clock        *Clock
	Service      *application.Service
}

// NewHarness builds a harness with an empty store in t.TempDir().
func NewHarness(t *testing.T) *Harness {
	t.Helper()
	h := &Harness{T: t, Dir: t.TempDir()}
	h.Orchestrator = NewOrchestrator()
	h.Logger = &Logger{}
	h.Clock = NewClock()
	h.open()
	return h
}

// open loads the store from disk and rebuilds the service, which is exactly what
// a restart does.
func (h *Harness) open() {
	h.T.Helper()
	store, err := jsonstore.Open(filepath.Join(h.Dir, "store.json"))
	if err != nil {
		h.T.Fatalf("open store: %v", err)
	}
	h.Store = store
	service, err := application.New(application.Deps{
		Profiles: Catalog(h.T),
		Hosts:    store,
		Ledger:   store,
		Jobs:     h.Orchestrator,
		Tokens:   TokenStore(h.T),
		Clock:    h.Clock,
		IDs:      &IDs{},
		Logger:   h.Logger,
	})
	if err != nil {
		h.T.Fatalf("build service: %v", err)
	}
	h.Service = service
}

// Restart reopens the durable store and rebuilds the service. With
// freshOrchestrator the fake orchestrator is replaced too, which models the
// truth that Temporal execution state lives outside this process.
func (h *Harness) Restart(freshOrchestrator bool) {
	h.T.Helper()
	if freshOrchestrator {
		h.Orchestrator = NewOrchestrator()
	}
	h.open()
}

// Catalog returns the approved offline test profile.
func Catalog(t *testing.T) domain.Catalog {
	t.Helper()
	catalog, err := domain.NewCatalog([]domain.Profile{{
		Name:        "rex",
		DisplayName: "Managed Rex host",
		Provider:    domain.ProviderAWS,
		Regions:     []string{"ap-south-1"},
		Sizes: map[string]domain.SizeSpec{
			"standard": {Name: "standard", InstanceType: "t3.medium", DiskGB: 40},
		},
		Tags:          map[string]string{"fleet-tier": "managed"},
		SecretBundles: []string{"bao:secret/data/hosts/rex/canary"},
		FlakeRef:      ".#homeConfigurations.remote-mumbai.activationPackage",
	}})
	if err != nil {
		t.Fatalf("build catalog: %v", err)
	}
	return catalog
}
