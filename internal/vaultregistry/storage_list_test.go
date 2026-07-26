package vaultregistry_test

import (
	"reflect"
	"testing"
)

func TestReaderList(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	for _, id := range []string{"run-z", "run-a"} {
		if _, err := producer.Create(baseRun(id)); err != nil {
			t.Fatal(err)
		}
	}

	runs, err := mustReader(t, root).List()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(runs))
	for i, run := range runs {
		ids[i] = run.RunID
	}
	if want := []string{"run-a", "run-z"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("List Run IDs = %v, want %v", ids, want)
	}
}
