package atlas

import (
	"context"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/herdrsocket"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

var _ LiveSource = herdrsocket.Client{}

type fakeSubscription struct {
	events []herdrsocket.Event
	index  int
}

func (s *fakeSubscription) Next() (herdrsocket.Event, error) {
	if s.index >= len(s.events) {
		return herdrsocket.Event{}, io.EOF
	}
	event := s.events[s.index]
	s.index++
	return event, nil
}

func (s *fakeSubscription) Close() error { return nil }

type fakeLiveSource struct {
	order          []string
	subscribeErrs  []error
	snapshots      map[string]AgentSnapshot
	snapshotCalls  map[string]int
	subscriptions  int
	lastSubscriber *fakeSubscription
	events         []herdrsocket.Event
}

func (s *fakeLiveSource) Subscribe(_ context.Context, paneIDs []string) (EventSubscription, error) {
	s.order = append(s.order, "subscribe:"+strings.Join(paneIDs, ","))
	s.subscriptions++
	if len(s.subscribeErrs) > 0 {
		err := s.subscribeErrs[0]
		s.subscribeErrs = s.subscribeErrs[1:]
		if err != nil {
			return nil, err
		}
	}
	s.lastSubscriber = &fakeSubscription{events: append([]herdrsocket.Event(nil), s.events...)}
	return s.lastSubscriber, nil
}

func (s *fakeLiveSource) Snapshot(_ context.Context, paneID string) (AgentSnapshot, error) {
	s.order = append(s.order, "snapshot:"+paneID)
	s.snapshotCalls[paneID]++
	return s.snapshots[paneID], nil
}

func newV09Reconciler(source *fakeLiveSource) (*Reconciler, *LiveState) {
	participants := []runregistry.Participant{
		{PaneID: "w2R:pF"},
		{PaneID: "w2R:pG"},
	}
	live := NewLiveState(participants)
	return NewReconciler(source, live, participants), live
}

func TestV09RecoveryDefaultsMatchTheTaskContract(t *testing.T) {
	source := &fakeLiveSource{
		snapshots:     map[string]AgentSnapshot{},
		snapshotCalls: map[string]int{},
	}
	reconciler, _ := newV09Reconciler(source)
	if reconciler.RetryInterval != 500*time.Millisecond ||
		reconciler.ReconnectWindow != 30*time.Second ||
		reconciler.HeartbeatInterval != 30*time.Second {
		t.Fatalf(
			"recovery defaults = retry %s, window %s, heartbeat %s",
			reconciler.RetryInterval,
			reconciler.ReconnectWindow,
			reconciler.HeartbeatInterval,
		)
	}
}

func TestV09SubscribePrecedesInitialAndReconnectSnapshots(t *testing.T) {
	source := &fakeLiveSource{
		snapshots: map[string]AgentSnapshot{
			"w2R:pF": {PaneID: "w2R:pF", Status: "working", Revision: 1},
			"w2R:pG": {PaneID: "w2R:pG", Status: "idle", Revision: 1},
		},
		snapshotCalls: map[string]int{},
	}
	reconciler, live := newV09Reconciler(source)
	subscription, err := reconciler.Attach(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_ = subscription.Close()
	want := []string{"subscribe:w2R:pF,w2R:pG", "snapshot:w2R:pF", "snapshot:w2R:pG"}
	if !reflect.DeepEqual(source.order, want) {
		t.Fatalf("attach order = %#v, want %#v", source.order, want)
	}

	source.order = nil
	reconciler.RetryInterval = time.Second
	reconciler.ReconnectWindow = 3 * time.Second
	now := time.Unix(0, 0)
	reconciler.Now = func() time.Time { return now }
	reconciler.Sleep = func(_ context.Context, duration time.Duration) error {
		now = now.Add(duration)
		return nil
	}
	source.subscribeErrs = []error{errors.New("down"), nil}
	subscription, err = reconciler.Reconnect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_ = subscription.Close()
	if !strings.Contains(live.RenderParticipant("w2R:pF", 0), "working") {
		t.Fatal("reconnect did not refresh the cached participant")
	}
	want = []string{
		"subscribe:w2R:pF,w2R:pG",
		"subscribe:w2R:pF,w2R:pG",
		"snapshot:w2R:pF",
		"snapshot:w2R:pG",
	}
	if !reflect.DeepEqual(source.order, want) {
		t.Fatalf("reconnect order = %#v, want %#v", source.order, want)
	}
}

func TestV09DuplicateAndDelayedEventsAreWakeupsOnly(t *testing.T) {
	source := &fakeLiveSource{
		snapshots: map[string]AgentSnapshot{
			"w2R:pF": {PaneID: "w2R:pF", Status: "done", Revision: 9},
			"w2R:pG": {PaneID: "w2R:pG", Status: "idle", Revision: 4},
		},
		snapshotCalls: map[string]int{},
	}
	reconciler, live := newV09Reconciler(source)
	events := []herdrsocket.Event{
		{PaneID: "w2R:pF", Status: "working"},
		{PaneID: "w2R:pF", Status: "blocked"},
		{PaneID: "w2R:pF", Status: "idle"},
		{PaneID: "not-registered", Status: "done"},
	}
	if err := reconciler.RefreshEvents(context.Background(), events); err != nil {
		t.Fatal(err)
	}
	if source.snapshotCalls["w2R:pF"] != 1 {
		t.Fatalf("duplicate burst made %d snapshots, want 1", source.snapshotCalls["w2R:pF"])
	}
	if output := live.RenderParticipant("w2R:pF", 0); !strings.Contains(output, "done") {
		t.Fatalf("delayed payload regressed authoritative snapshot: %q", output)
	}
	if source.snapshotCalls["not-registered"] != 0 {
		t.Fatal("unregistered event caused a snapshot")
	}
}

func TestV09HeartbeatRecoversLostEvent(t *testing.T) {
	source := &fakeLiveSource{
		snapshots: map[string]AgentSnapshot{
			"w2R:pF": {PaneID: "w2R:pF", Status: "working", Revision: 2},
			"w2R:pG": {PaneID: "w2R:pG", Status: "idle", Revision: 2},
		},
		snapshotCalls: map[string]int{},
	}
	reconciler, live := newV09Reconciler(source)
	if err := reconciler.Heartbeat(context.Background()); err != nil {
		t.Fatal(err)
	}
	if output := live.RenderParticipant("w2R:pF", 0); !strings.Contains(output, "working") {
		t.Fatalf("heartbeat did not recover state: %q", output)
	}
	if source.snapshotCalls["w2R:pF"] != 1 || source.snapshotCalls["w2R:pG"] != 1 {
		t.Fatalf("heartbeat was not a full refresh: %#v", source.snapshotCalls)
	}
}

func TestV09InteractiveLoopCoalescesTheWireBurst(t *testing.T) {
	source := &fakeLiveSource{
		events: []herdrsocket.Event{
			{PaneID: "w2R:pF", Status: "working"},
			{PaneID: "w2R:pF", Status: "blocked"},
			{PaneID: "w2R:pF", Status: "idle"},
		},
		snapshots: map[string]AgentSnapshot{
			"w2R:pF": {PaneID: "w2R:pF", Status: "done", Revision: 9},
			"w2R:pG": {PaneID: "w2R:pG", Status: "idle", Revision: 4},
		},
		snapshotCalls: map[string]int{},
	}
	reconciler, _ := newV09Reconciler(source)
	reconciler.BurstWindow = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	changes := 0
	err := reconciler.Run(ctx, func() {
		changes++
		if changes == 2 {
			cancel()
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if source.snapshotCalls["w2R:pF"] != 2 {
		t.Fatalf(
			"initial attach plus one coalesced burst made %d snapshots, want 2",
			source.snapshotCalls["w2R:pF"],
		)
	}
}

func TestV09ReconnectStopsAtBoundAndLeavesVisibleStaleState(t *testing.T) {
	source := &fakeLiveSource{
		subscribeErrs: []error{
			errors.New("down"),
			errors.New("down"),
			errors.New("down"),
			errors.New("down"),
		},
		snapshots:     map[string]AgentSnapshot{},
		snapshotCalls: map[string]int{},
	}
	reconciler, live := newV09Reconciler(source)
	live.Refresh(AgentSnapshot{PaneID: "w2R:pF", Status: "idle", Revision: 1})
	reconciler.RetryInterval = time.Second
	reconciler.ReconnectWindow = 3 * time.Second
	now := time.Unix(0, 0)
	reconciler.Now = func() time.Time { return now }
	reconciler.Sleep = func(_ context.Context, duration time.Duration) error {
		now = now.Add(duration)
		return nil
	}

	_, err := reconciler.Reconnect(context.Background())
	if !errors.Is(err, ErrReconnectTimeout) {
		t.Fatalf("Reconnect error = %v, want ErrReconnectTimeout", err)
	}
	if source.subscriptions != 3 {
		t.Fatalf("made %d attempts, want 3 within the bound", source.subscriptions)
	}
	if output := live.RenderParticipant("w2R:pF", 0); !strings.Contains(output, "stale") {
		t.Fatalf("disconnect was not visible: %q", output)
	}
}
