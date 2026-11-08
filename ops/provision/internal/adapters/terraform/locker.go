package terraform

import (
	"sort"
	"sync"
)

// KeyedLocker serializes work per key.
//
// The AWS adapter holds one key per host name and one per state path, so two
// operations on the same host, or on the same state object, can never overlap,
// while different hosts proceed in parallel. Temporal retries two activities
// for one host all the way down here; this is the last line that keeps them
// from planning the same state at the same time.
type KeyedLocker interface {
	// Lock acquires every key or none, and returns the release function.
	Lock(keys ...string) (unlock func())
}

// NewKeyedLocker builds the in-process keyed locker.
func NewKeyedLocker() KeyedLocker {
	return &keyedLocker{gates: map[string]*sync.Mutex{}}
}

type keyedLocker struct {
	mu    sync.Mutex
	gates map[string]*sync.Mutex
}

// Lock acquires the keys in sorted order, which is what keeps two callers that
// ask for the same set in a different order from deadlocking.
func (l *keyedLocker) Lock(keys ...string) func() {
	ordered := uniqueSorted(keys)
	for _, key := range ordered {
		l.gate(key).Lock()
	}
	return func() {
		for i := len(ordered) - 1; i >= 0; i-- {
			l.gate(ordered[i]).Unlock()
		}
	}
}

// gate returns the mutex of a key. Gates live for the process lifetime: dropping
// one while another caller still holds its pointer would let a third caller
// enter the same critical section, and a fleet has few host names.
func (l *keyedLocker) gate(key string) *sync.Mutex {
	l.mu.Lock()
	defer l.mu.Unlock()
	if mutex, ok := l.gates[key]; ok {
		return mutex
	}
	mutex := &sync.Mutex{}
	l.gates[key] = mutex
	return mutex
}

func uniqueSorted(keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
