// Package fakes provides in-memory implementations of the application ports for
// offline tests. It never touches a network, a cloud account, or Temporal.
package fakes

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/tokenstore"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// TestToken is the plaintext bearer token used by offline tests. Only its digest
// is ever handed to the service.
const TestToken = "offline-test-token-4f2c9a1b7e"

// Clock is a fixed clock.
type Clock struct {
	mu sync.Mutex
	t  time.Time
}

// NewClock returns a clock pinned to a fixed instant.
func NewClock() *Clock {
	return &Clock{t: time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)}
}

// Now implements application.Clock.
func (c *Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

// Advance moves the clock forward.
func (c *Clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// IDs is a deterministic identifier generator.
type IDs struct {
	mu sync.Mutex
	n  int
}

// NewID implements application.IDGenerator.
func (i *IDs) NewID(prefix string) string {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.n++
	return fmt.Sprintf("%s-%04d", prefix, i.n)
}

// Logger records sanitized log lines so tests can prove no secret leaked.
type Logger struct {
	mu    sync.Mutex
	lines []string
}

// Info implements application.Logger.
func (l *Logger) Info(msg string, kv ...any) { l.record("INFO", msg, kv...) }

// Warn implements application.Logger.
func (l *Logger) Warn(msg string, kv ...any) { l.record("WARN", msg, kv...) }

// Error implements application.Logger.
func (l *Logger) Error(msg string, kv ...any) { l.record("ERROR", msg, kv...) }

func (l *Logger) record(level, msg string, kv ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, fmt.Sprintf("%s %s %v", level, msg, kv))
}

// Lines returns a copy of every recorded line.
func (l *Logger) Lines() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.lines...)
}

// Orchestrator is an in-memory job orchestrator. Starts are counted per job ID,
// so a test can prove duplicate requests created exactly one durable operation.
type Orchestrator struct {
	mu          sync.Mutex
	starts      map[string]int
	views       map[string]application.JobView
	order       []string
	deleteSpecs []application.DeleteHostSpec
	startErr    error
}

// NewOrchestrator builds an empty fake orchestrator.
func NewOrchestrator() *Orchestrator {
	return &Orchestrator{
		starts: map[string]int{},
		views:  map[string]application.JobView{},
	}
}

var _ application.JobOrchestrator = (*Orchestrator)(nil)

// FailStarts makes every subsequent start return err.
func (o *Orchestrator) FailStarts(err error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.startErr = err
}

// StartCreateHost implements application.JobOrchestrator.
func (o *Orchestrator) StartCreateHost(_ context.Context, spec application.CreateHostSpec) (application.JobRef, error) {
	return o.start("create", spec.JobID, spec.HostID, domain.JobKindCreate, domain.StageQueued, domain.JobQueued)
}

// StartDeleteHost implements application.JobOrchestrator.
func (o *Orchestrator) StartDeleteHost(_ context.Context, spec application.DeleteHostSpec) (application.JobRef, error) {
	o.mu.Lock()
	o.deleteSpecs = append(o.deleteSpecs, spec)
	o.mu.Unlock()
	return o.start("delete", spec.JobID, spec.HostID, domain.JobKindDelete, domain.StageQueued, domain.JobQueued)
}

// DeleteSpecs returns every teardown spec that reached the orchestrator, so a test
// can assert what a delete job was actually handed.
func (o *Orchestrator) DeleteSpecs() []application.DeleteHostSpec {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]application.DeleteHostSpec(nil), o.deleteSpecs...)
}

func (o *Orchestrator) start(_ string, jobID, hostID string, kind domain.JobKind, stage domain.Stage, state domain.JobState) (application.JobRef, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.startErr != nil {
		return application.JobRef{}, o.startErr
	}
	o.starts[jobID]++
	o.order = append(o.order, jobID)
	o.views[jobID] = application.JobView{
		JobID:     jobID,
		HostID:    hostID,
		Kind:      kind,
		State:     state,
		Stage:     stage,
		CreatedAt: time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC),
		RunID:     "run-" + jobID,
	}
	return application.JobRef{JobID: jobID, HostID: hostID, RunID: "run-" + jobID}, nil
}

// DescribeJob implements application.JobOrchestrator.
func (o *Orchestrator) DescribeJob(_ context.Context, handle application.JobHandle) (application.JobView, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	view, ok := o.views[handle.JobID]
	if !ok {
		return application.JobView{}, domain.ErrNotFound
	}
	return view, nil
}

// SetJob replaces the reported view for a job, which lets a test model a
// workflow that progressed or failed.
func (o *Orchestrator) SetJob(view application.JobView) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.views[view.JobID] = view
}

// StartCount reports how many times a job was actually started.
func (o *Orchestrator) StartCount(jobID string) int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.starts[jobID]
}

// TotalStarts reports every start call that produced a durable operation.
func (o *Orchestrator) TotalStarts() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	total := 0
	for _, count := range o.starts {
		total += count
	}
	return total
}

// TokenStore returns a token store holding the digest of TestToken for client
// "test-client", plus a second client so revocation and isolation can be tested.
func TokenStore(t interface{ Fatalf(string, ...any) }) *tokenstore.File {
	store, err := tokenstore.New([]tokenstore.Client{
		{
			ClientID:    "test-client",
			TokenSHA256: application.TokenDigest(TestToken),
			Description: "offline test client",
		},
		{
			ClientID:    "other-client",
			TokenSHA256: application.TokenDigest(OtherToken),
			Description: "second offline client",
		},
		{
			ClientID:    "revoked-client",
			TokenSHA256: application.TokenDigest(RevokedToken),
			Description: "revoked offline client",
			Revoked:     true,
		},
	})
	if err != nil {
		t.Fatalf("build token store: %v", err)
	}
	return store
}

// OtherToken belongs to a different client, for ownership assertions.
const OtherToken = "offline-other-token-77cd0e15a9"

// RevokedToken is a valid digest whose record is revoked.
const RevokedToken = "offline-revoked-token-1a2b3c4d5e"
