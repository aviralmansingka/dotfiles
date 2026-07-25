package atlas

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/herdrsocket"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

var ErrReconnectTimeout = errors.New("Herdr reconnect window elapsed")

type EventSubscription = herdrsocket.EventSubscription

type LiveSource interface {
	Subscribe(context.Context, []string) (EventSubscription, error)
	Snapshot(context.Context, string) (AgentSnapshot, error)
}

type Reconciler struct {
	source            LiveSource
	live              *LiveState
	paneIDs           []string
	registered        map[string]struct{}
	RetryInterval     time.Duration
	ReconnectWindow   time.Duration
	HeartbeatInterval time.Duration
	BurstWindow       time.Duration
	Now               func() time.Time
	Sleep             func(context.Context, time.Duration) error
}

func NewReconciler(source LiveSource, live *LiveState, participants []runregistry.Participant) *Reconciler {
	paneIDs := make([]string, 0, len(participants))
	registered := make(map[string]struct{}, len(participants))
	for _, participant := range participants {
		if participant.PaneID == "" {
			continue
		}
		if _, exists := registered[participant.PaneID]; exists {
			continue
		}
		registered[participant.PaneID] = struct{}{}
		paneIDs = append(paneIDs, participant.PaneID)
	}
	return &Reconciler{
		source:            source,
		live:              live,
		paneIDs:           paneIDs,
		registered:        registered,
		RetryInterval:     500 * time.Millisecond,
		ReconnectWindow:   30 * time.Second,
		HeartbeatInterval: 30 * time.Second,
		BurstWindow:       10 * time.Millisecond,
		Now:               time.Now,
		Sleep:             sleepContext,
	}
}

func (r *Reconciler) Attach(ctx context.Context) (EventSubscription, error) {
	subscription, err := r.source.Subscribe(ctx, r.paneIDs)
	if err != nil {
		return nil, err
	}
	if err := r.refresh(ctx, r.paneIDs); err != nil {
		_ = subscription.Close()
		return nil, err
	}
	return subscription, nil
}

func (r *Reconciler) RefreshEvents(ctx context.Context, events []herdrsocket.Event) error {
	seen := make(map[string]struct{}, len(events))
	paneIDs := make([]string, 0, len(events))
	for _, event := range events {
		if _, registered := r.registered[event.PaneID]; !registered {
			continue
		}
		if _, duplicate := seen[event.PaneID]; duplicate {
			continue
		}
		seen[event.PaneID] = struct{}{}
		paneIDs = append(paneIDs, event.PaneID)
	}
	return r.refresh(ctx, paneIDs)
}

func (r *Reconciler) Heartbeat(ctx context.Context) error {
	return r.refresh(ctx, r.paneIDs)
}

func (r *Reconciler) Reconnect(ctx context.Context) (EventSubscription, error) {
	r.live.MarkStale()
	deadline := r.Now().Add(r.ReconnectWindow)
	var lastErr error
	for r.Now().Before(deadline) {
		remaining := deadline.Sub(r.Now())
		attemptCtx, cancel := context.WithTimeout(ctx, remaining)
		subscription, err := r.Attach(attemptCtx)
		cancel()
		if err == nil {
			return subscription, nil
		}
		lastErr = err
		r.live.MarkStale()
		remaining = deadline.Sub(r.Now())
		if remaining <= 0 {
			break
		}
		delay := min(r.RetryInterval, remaining)
		if err := r.Sleep(ctx, delay); err != nil {
			return nil, err
		}
	}
	if lastErr == nil {
		lastErr = errors.New("no reconnect attempt fit in the configured window")
	}
	return nil, fmt.Errorf("%w: %v", ErrReconnectTimeout, lastErr)
}

func (r *Reconciler) Run(ctx context.Context, changed func()) error {
	subscription, err := r.Attach(ctx)
	if err != nil {
		subscription, err = r.Reconnect(ctx)
		if err != nil {
			return err
		}
	}
	if changed != nil {
		changed()
	}
	for {
		err = r.runSubscription(ctx, subscription, changed)
		_ = subscription.Close()
		if ctx.Err() != nil {
			return nil
		}
		subscription, err = r.Reconnect(ctx)
		if err != nil {
			return err
		}
		if changed != nil {
			changed()
		}
	}
}

func (r *Reconciler) runSubscription(
	ctx context.Context,
	subscription EventSubscription,
	changed func(),
) error {
	type nextResult struct {
		event herdrsocket.Event
		err   error
	}
	results := make(chan nextResult, 64)
	go func() {
		for {
			event, err := subscription.Next()
			select {
			case results <- nextResult{event: event, err: err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	heartbeat := time.NewTicker(r.HeartbeatInterval)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-heartbeat.C:
			if err := r.Heartbeat(ctx); err != nil {
				return err
			}
			if changed != nil {
				changed()
			}
		case result := <-results:
			if result.err != nil {
				return result.err
			}
			events := []herdrsocket.Event{result.event}
			timer := time.NewTimer(r.BurstWindow)
			var drainErr error
			for drainErr == nil {
				select {
				case next := <-results:
					if next.err != nil {
						drainErr = next.err
						continue
					}
					events = append(events, next.event)
				case <-timer.C:
					drainErr = errBurstComplete
				}
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			if err := r.RefreshEvents(ctx, events); err != nil {
				return err
			}
			if changed != nil {
				changed()
			}
			if !errors.Is(drainErr, errBurstComplete) {
				return drainErr
			}
		}
	}
}

func (r *Reconciler) refresh(ctx context.Context, paneIDs []string) error {
	for _, paneID := range paneIDs {
		snapshot, err := r.source.Snapshot(ctx, paneID)
		if err != nil {
			return fmt.Errorf("snapshot %s: %w", paneID, err)
		}
		r.live.Refresh(snapshot)
	}
	return nil
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

var errBurstComplete = errors.New("event burst complete")
