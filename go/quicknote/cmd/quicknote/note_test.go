package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSlug(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Writer's block is caused by reader's block", "writers-block-is-caused-by-readers-block"},
		{"Buy oat milk", "buy-oat-milk"},
		{"  padded  spaces  ", "padded-spaces"},
		{"Punctuation: commas, colons; and (parens)!", "punctuation-commas-colons-and-parens"},
		{"", "untitled-thought"},
		{"!!! ???", "untitled-thought"},
	}
	for _, c := range cases {
		if got := slug(c.in); got != c.want {
			t.Errorf("slug(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	// Long thoughts keep whole words and stay under the cap.
	long := slug("The single most important thing about spaced repetition is that you must review a note right before you forget it")
	if len(long) > 60 {
		t.Errorf("slug too long: %d chars: %q", len(long), long)
	}
	if strings.HasSuffix(long, "-") || !strings.HasPrefix(long, "the-single-most-important-thing-about") {
		t.Errorf("slug cut badly: %q", long)
	}
}

func TestNoteBody(t *testing.T) {
	got := noteBody("buy-oat-milk", "Buy oat milk", "the barista one\nthe unsweetened one")
	for _, want := range []string{
		"tags: [fleeting]",
		"> [!FLEETING] Buy oat milk",
		"> the barista one",
		"> the unsweetened one",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("body missing %q:\n%s", want, got)
		}
	}
	// No detail still writes a note with just the title line.
	if plain := noteBody("x", "Just a title", ""); strings.Count(plain, ">") != 1 {
		t.Errorf("title-only body has extra quote lines:\n%s", plain)
	}
}

func TestAppendWritesOneNotePerThought(t *testing.T) {
	vault := t.TempDir()
	res, err := Append(vault, Entry{Title: "Writer's block is caused by reader's block"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created || res.Duplicate {
		t.Fatalf("first capture: created=%v duplicate=%v", res.Created, res.Duplicate)
	}
	if want := filepath.Join(vault, "0_inbox", "fleeting", "writers-block-is-caused-by-readers-block.md"); res.Path != want {
		t.Errorf("path = %q, want %q", res.Path, want)
	}
	data, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "> [!FLEETING] Writer's block is caused by reader's block") {
		t.Errorf("note body wrong:\n%s", data)
	}

	// The same thought again reports the existing note and writes nothing.
	again, err := Append(vault, Entry{Title: "Writer's block is caused by reader's block"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !again.Duplicate || again.Created {
		t.Fatalf("repeat capture: created=%v duplicate=%v", again.Created, again.Duplicate)
	}
}

func TestAppendAddsNewDetailToTheSameThought(t *testing.T) {
	vault := t.TempDir()
	entry := Entry{Title: "Buy oat milk"}
	if _, err := Append(vault, entry, false); err != nil {
		t.Fatal(err)
	}
	entry.Body = "the barista one"
	res, err := Append(vault, entry, false)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Appended {
		t.Fatalf("detail was not appended: %+v", res)
	}
	data, _ := os.ReadFile(res.Path)
	if !strings.Contains(string(data), "> the barista one") {
		t.Errorf("detail missing from note:\n%s", data)
	}
	// The same detail twice does not duplicate itself.
	if third, err := Append(vault, entry, false); err != nil || third.Appended {
		t.Errorf("detail appended twice: %+v err=%v", third, err)
	}
}

func TestAppendNumbersAnUnrelatedClash(t *testing.T) {
	vault := t.TempDir()
	// Two thoughts that share the first 60 characters: the cap makes one slug.
	first, err := Append(vault, Entry{Title: "The single most important thing about spaced repetition is that you must review often"}, false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Append(vault, Entry{Title: "The single most important thing about spaced repetition is that you must review rarely"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if second.Path == first.Path || !strings.HasSuffix(second.Path, "-2.md") {
		t.Errorf("clash did not get a numbered file: %q vs %q", first.Path, second.Path)
	}
}

func TestAppendDryRunWritesNothing(t *testing.T) {
	vault := t.TempDir()
	res, err := Append(vault, Entry{Title: "Not written"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if !res.DryRun || !res.Created {
		t.Fatalf("dry run result: %+v", res)
	}
	if _, err := os.Stat(res.Path); !os.IsNotExist(err) {
		t.Errorf("dry run wrote %s", res.Path)
	}
}

func TestAppendRejectsEmptyTitle(t *testing.T) {
	if _, err := Append(t.TempDir(), Entry{Title: "   "}, false); err == nil {
		t.Error("empty title accepted")
	}
}
