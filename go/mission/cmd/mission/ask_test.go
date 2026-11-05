package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/platform"
)

// asksOf reads the ask files of one mission straight from disk, so a test proves
// the durable format instead of trusting the reader that lists it.
func asksOf(t *testing.T, s *Store, h string) []Ask {
	t.Helper()
	d, e := s.dir(h)
	must(t, e)
	ents, e := os.ReadDir(filepath.Join(d, "asks"))
	if os.IsNotExist(e) {
		return nil
	}
	must(t, e)
	out := []Ask{}
	for _, ent := range ents {
		b, e := os.ReadFile(filepath.Join(d, "asks", ent.Name()))
		must(t, e)
		var ask Ask
		must(t, json.Unmarshal(b, &ask))
		out = append(out, ask)
	}
	return out
}

// askCmd runs one `mission ask` line the way a captain types it.
func askCmd(t *testing.T, s *Store, argv ...string) (any, error) {
	t.Helper()
	a, e := platform.ParseArgs(append([]string{"ask"}, argv...))
	must(t, e)
	return cmdAsk(a, s)
}

// One captain question becomes one durable file with every field the commander
// renders, and the receipt names the id and the path a captain reports.
func TestAskWritesOneDurableFile(t *testing.T) {
	s, h := fixture(t)
	v, e := askCmd(t, s, h, "--text", "Which branch name should the migration use?", "--step", "S02", "--attempt", "attempt-1", "--kind", "decision", "--json")
	must(t, e)
	receipt := v.(askFile)
	if receipt.ID == "" || receipt.Path == "" || receipt.Handle != h {
		t.Fatalf("receipt = %+v", receipt)
	}
	asks := asksOf(t, s, h)
	if len(asks) != 1 {
		t.Fatalf("wrote %d asks", len(asks))
	}
	ask := asks[0]
	if ask.ID != receipt.ID || ask.Handle != h || ask.Step != "S02" || ask.Attempt != "attempt-1" || ask.Kind != "decision" ||
		ask.Text != "Which branch name should the migration use?" || ask.At == "" || ask.DeliveredAt != "" || ask.DeliveredTo != "" {
		t.Fatalf("ask = %+v", ask)
	}
	if !strings.Contains(filepath.Base(receipt.Path), ask.ID) {
		t.Fatalf("ask path %q does not carry its id", receipt.Path)
	}
}

// The default kind is blocked: a captain that names no kind still says it is
// stuck, and a second ask gets its own id and file.
func TestSecondAskGetsADistinctID(t *testing.T) {
	s, h := fixture(t)
	first, e := askCmd(t, s, h, "--text", "Which branch?", "--json")
	must(t, e)
	second, e := askCmd(t, s, h, "--text", "Which remote?", "--json")
	must(t, e)
	a, b := first.(askFile), second.(askFile)
	if a.ID == b.ID || a.Path == b.Path {
		t.Fatalf("two asks shared an identity: %+v %+v", a, b)
	}
	asks := asksOf(t, s, h)
	if len(asks) != 2 || asks[0].Kind != "blocked" || asks[1].Kind != "blocked" {
		t.Fatalf("asks = %+v", asks)
	}
	if asks[0].Text != "Which branch?" || asks[1].Text != "Which remote?" {
		t.Fatalf("asks are out of oldest-first order: %+v", asks)
	}
}

// A retired mission takes no new question: the commander would act on a record
// that no longer exists.
func TestAskRefusesAClosedMission(t *testing.T) {
	s, h := fixture(t)
	_, e := s.close(h, "shipped", true)
	must(t, e)
	_, e = askCmd(t, s, h, "--text", "Can I reopen this?", "--json")
	wantCode(t, e, "closed_mission")
	if !strings.Contains(e.Error(), "mission new dotfiles/NAME") {
		t.Fatalf("the refusal does not offer the new-mission hint: %v", e)
	}
	if asks := asksOf(t, s, h); len(asks) != 0 {
		t.Fatalf("a closed mission wrote %d asks", len(asks))
	}
}

// An empty question is a mistake, not a blank message the commander must read.
func TestAskRefusesEmptyText(t *testing.T) {
	s, h := fixture(t)
	for _, argv := range [][]string{{h, "--json"}, {h, "--text", "   ", "--json"}, {h, "--text", "Question?", "--kind", "urgent", "--json"}} {
		_, e := askCmd(t, s, argv...)
		if e == nil {
			t.Fatalf("%v was accepted", argv)
		}
		wantCode(t, e, "usage")
	}
	if asks := asksOf(t, s, h); len(asks) != 0 {
		t.Fatalf("refused asks still wrote %d files", len(asks))
	}
	_, e := askCmd(t, s, "dotfiles/missing", "--text", "Question?", "--json")
	wantCode(t, e, "not_found")
}

// --list shows the question a captain wrote, and moves it to delivered once a
// commander records delivery in the same file.
func TestAskListShowsPendingThenDelivered(t *testing.T) {
	s, h := fixture(t)
	written, e := askCmd(t, s, h, "--text", "Which branch?", "--step", "S01", "--json")
	must(t, e)
	v, e := askCmd(t, s, "--list", h, "--json")
	must(t, e)
	list := v.(askListing)
	if list.Handle != h || len(list.Pending) != 1 || len(list.Delivered) != 0 {
		t.Fatalf("listing = %+v", list)
	}
	if list.Pending[0].ID != written.(askFile).ID || list.Pending[0].Step != "S01" {
		t.Fatalf("pending = %+v", list.Pending)
	}
	// Delivery is written by the commander's session, in place, so the ask stays
	// one file and never reaches it twice.
	ask := list.Pending[0].Ask
	ask.DeliveredAt, ask.DeliveredTo = "2026-11-05T19:20:00Z", "commander-session"
	b, e := json.Marshal(ask)
	must(t, e)
	must(t, atomicWrite(list.Pending[0].Path, append(b, '\n')))
	v, e = askCmd(t, s, "--list", h, "--json")
	must(t, e)
	list = v.(askListing)
	if len(list.Pending) != 0 || len(list.Delivered) != 1 || list.Delivered[0].DeliveredTo != "commander-session" {
		t.Fatalf("listing after delivery = %+v", list)
	}
}

// The captain brief teaches the ask channel and the argv withholds the menu, so
// a launch cannot paint a question nobody watches.
func TestCaptainBriefNamesTheAskChannel(t *testing.T) {
	s, h, _ := piFixture(t)
	p, e := s.plan(h, "rex", "")
	must(t, e)
	for _, want := range []string{"mission ask " + h, "then stop", "Do not use ask_user_question", "nobody watches a captain pane"} {
		if !strings.Contains(p.CaptainBrief, want) {
			t.Fatalf("the captain brief does not say %q:\n%s", want, p.CaptainBrief)
		}
	}
	for _, tool := range strings.Split(captainLoadout, ",") {
		if tool == "ask_user_question" {
			t.Fatalf("the captain still holds ask_user_question: %s", captainLoadout)
		}
	}
}
