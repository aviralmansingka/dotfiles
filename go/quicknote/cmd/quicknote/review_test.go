package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func seedCapture(t *testing.T, vault, title, detail string) capture {
	t.Helper()
	res, err := Append(vault, Entry{Title: title, Body: detail}, false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := readCapture(res.Path)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestReadCapture(t *testing.T) {
	vault := t.TempDir()
	c := seedCapture(t, vault, "Writer's block is caused by reader's block", "Ahrens says reading widely comes first")
	if c.Title != "Writer's block is caused by reader's block" {
		t.Errorf("title = %q", c.Title)
	}
	if len(c.Detail) != 1 || c.Detail[0] != "Ahrens says reading widely comes first" {
		t.Errorf("detail = %v", c.Detail)
	}
	if c.Due != "" {
		t.Errorf("unsnoozed capture has due %q", c.Due)
	}
}

func TestQueueOldestFirstAndSnoozeFilter(t *testing.T) {
	vault := t.TempDir()
	old := seedCapture(t, vault, "Buy oat milk", "")
	time.Sleep(10 * time.Millisecond)
	fresh := seedCapture(t, vault, "Call the dentist", "")
	// A note snoozed into the future stays out of the queue.
	if err := snooze(old.Path, time.Now().AddDate(0, 0, 3)); err != nil {
		t.Fatal(err)
	}
	got, err := queue(vault, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Path != fresh.Path {
		t.Fatalf("queue = %v, want only the fresh capture", paths(got))
	}
	// Its day arrives: the note is due again, and oldest first puts it back on top.
	got, err = queue(vault, time.Now().AddDate(0, 0, 4))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Path != old.Path {
		t.Fatalf("queue after due = %v, want the snoozed note first", paths(got))
	}
}

func TestSnoozeWritesFrontmatterOnce(t *testing.T) {
	vault := t.TempDir()
	c := seedCapture(t, vault, "Buy oat milk", "")
	until := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	if err := snooze(c.Path, until); err != nil {
		t.Fatal(err)
	}
	if err := snooze(c.Path, until.AddDate(0, 0, 1)); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(c.Path)
	if n := strings.Count(string(data), "review_due:"); n != 1 {
		t.Errorf("review_due written %d times:\n%s", n, data)
	}
	if !strings.Contains(string(data), "review_due: 2026-12-02") {
		t.Errorf("second snooze did not win:\n%s", data)
	}
	// The rest of the note is untouched.
	if !strings.Contains(string(data), "tags: [fleeting]") {
		t.Errorf("frontmatter damaged:\n%s", data)
	}
}

func TestPromoteWritesAtomicNote(t *testing.T) {
	vault := t.TempDir()
	c := seedCapture(t, vault, "Writer's block is caused by reader's block", "Ahrens says reading widely comes first")
	path, err := promote(vault, c, "Reading widely comes before writing well", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(vault, "2_knowledge", "reading-widely-comes-before-writing-well.md"); path != want {
		t.Errorf("path = %q, want %q", path, want)
	}
	data, _ := os.ReadFile(path)
	for _, want := range []string{
		"tags: [atomic]",
		"up:",
		"# Reading widely comes before writing well",
		"> [!CAPTURE] Writer's block is caused by reader's block",
		"> Ahrens says reading widely comes first",
	} {
		if !strings.Contains(string(data), want) {
			t.Errorf("atomic note missing %q:\n%s", want, data)
		}
	}
}

func TestPromoteNeedsATitleAndAvoidsCollisions(t *testing.T) {
	vault := t.TempDir()
	c := seedCapture(t, vault, "Buy oat milk", "")
	if _, err := promote(vault, c, "  ", time.Now()); err == nil {
		t.Error("empty title accepted")
	}
	first, err := promote(vault, c, "Buy oat milk", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	second, err := promote(vault, c, "Buy oat milk", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if second == first || !strings.HasSuffix(second, "-2.md") {
		t.Errorf("collision not handled: %q then %q", first, second)
	}
}

func paths(cs []capture) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = filepath.Base(c.Path)
	}
	return out
}
