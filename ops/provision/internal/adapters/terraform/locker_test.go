package terraform_test

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/terraform"
)

// TestKeyedLockerSerializesOneKey proves two goroutines holding the same key
// never enter the critical section together.
func TestKeyedLockerSerializesOneKey(t *testing.T) {
	t.Parallel()
	locker := terraform.NewKeyedLocker()
	var active, maxActive int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			unlock := locker.Lock("host:rex-01", "state:fleet-hosts/rex-01/terraform.tfstate")
			defer unlock()
			current := atomic.AddInt32(&active, 1)
			for {
				previous := atomic.LoadInt32(&maxActive)
				if current <= previous || atomic.CompareAndSwapInt32(&maxActive, previous, current) {
					break
				}
			}
			time.Sleep(2 * time.Millisecond)
			atomic.AddInt32(&active, -1)
		}()
	}
	wg.Wait()
	if got := atomic.LoadInt32(&maxActive); got != 1 {
		t.Fatalf("max concurrent holders of one key = %d, want 1", got)
	}
}

// TestKeyedLockerAllowsDifferentKeys proves the serialization is scoped to the
// keys, not to the locker.
func TestKeyedLockerAllowsDifferentKeys(t *testing.T) {
	t.Parallel()
	locker := terraform.NewKeyedLocker()
	release := make(chan struct{})
	started := make(chan string, 2)
	for _, key := range []string{"host:rex-01", "host:rex-02"} {
		key := key
		go func() {
			unlock := locker.Lock(key)
			defer unlock()
			started <- key
			<-release
		}()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatalf("only %d keys were held at once", i)
		}
	}
	close(release)
}

// TestKeyedLockerDoesNotDeadlockOnReversedOrder proves the keys are acquired in
// a stable order, so two callers asking for the same set in opposite order do
// not deadlock.
func TestKeyedLockerDoesNotDeadlockOnReversedOrder(t *testing.T) {
	t.Parallel()
	locker := terraform.NewKeyedLocker()
	done := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		reverse := i == 1
		go func() {
			keys := []string{"host:rex-01", "state:fleet-hosts/rex-01/terraform.tfstate"}
			if reverse {
				keys[0], keys[1] = keys[1], keys[0]
			}
			for n := 0; n < 50; n++ {
				unlock := locker.Lock(keys...)
				unlock()
			}
			done <- struct{}{}
		}()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("lock acquisition deadlocked on reversed key order")
		}
	}
}

// TestKeyedLockerToleratesDuplicateKeys proves a repeated key in one call does
// not self-deadlock.
func TestKeyedLockerToleratesDuplicateKeys(t *testing.T) {
	t.Parallel()
	locker := terraform.NewKeyedLocker()
	done := make(chan struct{})
	go func() {
		unlock := locker.Lock("host:rex-01", "host:rex-01", "state:k")
		unlock()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("locking the same key twice in one call deadlocked")
	}
}
