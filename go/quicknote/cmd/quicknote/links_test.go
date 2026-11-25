package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
)

// seedKnowledge writes one note under the knowledge folder the picker reads.
func seedKnowledge(t *testing.T, vault, slug, body string) string {
	t.Helper()
	dir := filepath.Join(vault, "2_knowledge")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, slug+".md")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadTargetsReadsTitleAndBothAliasShapes(t *testing.T) {
	vault := t.TempDir()
	seedKnowledge(t, vault, "amdahls-law", `---
id: amdahls-law
aliases: [amdahl, "speedup bound"]
tags: [atomic]
---

# Amdahl's law bounds the speedup

The gain is capped by the serial part.
`)
	seedKnowledge(t, vault, "wgmma-definition", `---
id: wgmma-definition
aliases:
  - "WGMMA = warpgroup Tensor Core MMA"
tags: [proposition]
---

# WGMMA definition
`)

	got, err := loadTargets(vault)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("targets = %d, want 2", len(got))
	}
	bySlug := map[string]linkTarget{}
	for _, tg := range got {
		bySlug[tg.Slug] = tg
	}
	amdahl := bySlug["amdahls-law"]
	if amdahl.Title != "Amdahl's law bounds the speedup" {
		t.Errorf("title = %q", amdahl.Title)
	}
	if len(amdahl.Aliases) != 2 || amdahl.Aliases[0] != "amdahl" || amdahl.Aliases[1] != "speedup bound" {
		t.Errorf("inline aliases = %v", amdahl.Aliases)
	}
	if block := bySlug["wgmma-definition"]; len(block.Aliases) != 1 {
		t.Errorf("block aliases = %v", block.Aliases)
	}
	// A note with no heading still offers its filename, dashes read as spaces.
	seedKnowledge(t, vault, "bare-note", "no heading here\n")
	got, err = loadTargets(vault)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("targets after bare note = %d, want 3", len(got))
	}
}

func TestLoadTargetsWithoutAKnowledgeFolder(t *testing.T) {
	got, err := loadTargets(t.TempDir())
	if err != nil {
		t.Fatalf("a fresh vault must not fail: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("targets = %v, want none", got)
	}
}

func TestRankTargetsMatchesTitleAliasAndSlug(t *testing.T) {
	targets := []linkTarget{
		{Slug: "amdahls-law", Title: "Amdahl's law bounds the speedup", Aliases: []string{"amdahl"}},
		{Slug: "gustafsons-law", Title: "Gustafson's law moves the ceiling", Aliases: []string{"speedup scaling"}},
		{Slug: "container-vs-host", Title: "Container vs. host"},
	}
	cases := []struct {
		query string
		want  string
	}{
		{"amdahl", "amdahls-law"},
		{"amdah", "amdahls-law"},      // a prefix still finds it
		{"scaling", "gustafsons-law"}, // an alias reaches it
		{"container host", "container-vs-host"},
		{"", "amdahls-law"}, // empty query is the alphabetical index
	}
	for _, c := range cases {
		got := rankTargets(targets, c.query)
		if len(got) == 0 {
			t.Errorf("query %q found nothing", c.query)
			continue
		}
		if got[0].Slug != c.want {
			t.Errorf("query %q ranked %q first, want %q", c.query, got[0].Slug, c.want)
		}
	}
	if got := rankTargets(targets, "zzz"); len(got) != 0 {
		t.Errorf("nonsense query = %v, want nothing", got)
	}
}

func TestClaimWarning(t *testing.T) {
	for _, title := range []string{
		"Writer's block is caused by reader's block",
		"Reading widely comes before writing well",
		"Atomic notes are not shorter notes",
		"Notes matter because they are reread",
	} {
		if w := claimWarning(title); w != "" {
			t.Errorf("%q warned: %q", title, w)
		}
	}
	for _, title := range []string{
		"Writer's block",
		"Notes",
		"Zettelkasten",
		"Why do notes matter?",
	} {
		if w := claimWarning(title); w == "" {
			t.Errorf("%q read as a claim, want a warning", title)
		}
	}
}

func TestPromoteWritesLinksBlock(t *testing.T) {
	vault := t.TempDir()
	c := seedCapture(t, vault, "Writer's block is caused by reader's block", "")
	links := []Link{
		{Slug: "amdahls-law", Reason: "this bounds what the rewrite can win"},
		{Slug: "gustafsons-law"},
	}
	path, err := promote(vault, c, "Reading widely comes before writing well", links, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	body := string(data)
	for _, want := range []string{
		"## Links",
		"- [[amdahls-law]] — this bounds what the rewrite can win",
		"- [[gustafsons-law]]\n",
		// The links sit between the heading and the capture they came from.
		"> [!CAPTURE] Writer's block is caused by reader's block",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("atomic note missing %q:\n%s", want, body)
		}
	}
	if strings.Index(body, "## Links") > strings.Index(body, "[!CAPTURE]") {
		t.Errorf("links must come before the capture:\n%s", body)
	}

	// Nothing picked means no empty heading.
	bare, err := promote(vault, c, "Nothing linked yet", nil, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(bare)
	if strings.Contains(string(data), "## Links") {
		t.Errorf("unlinked note grew a Links section:\n%s", data)
	}
}

func TestTitleWarningNeedsASecondEnter(t *testing.T) {
	vault := t.TempDir()
	seedCapture(t, vault, "Buy oat milk", "")
	m := newReview(vault)
	m.refresh()
	m.stage = stageTitle
	m.input.SetValue("Zettelkasten")

	m.titleKey(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.stage != stageTitle {
		t.Fatal("a topic title went straight to the picker")
	}
	if m.claim == "" {
		t.Error("no warning was shown")
	}
	m.titleKey(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.stage != stageLinks {
		t.Fatalf("second enter did not continue: stage %v", m.stage)
	}
	if m.pending != "Zettelkasten" {
		t.Errorf("pending title = %q", m.pending)
	}

	// Typing again clears the warning, so a rewritten title is checked afresh.
	m.input.SetValue("Notes are reread")
	m.titleKey(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.stage != stageLinks || m.claim != "" {
		t.Errorf("claim title did not pass: stage %v claim %q", m.stage, m.claim)
	}
}

func TestLinkStagePicksWithTab(t *testing.T) {
	vault := t.TempDir()
	seedKnowledge(t, vault, "amdahls-law", "# Amdahl's law bounds the speedup\n")
	seedKnowledge(t, vault, "gustafsons-law", "# Gustafson's law moves the ceiling\n")
	m := newReview(vault)
	m.stage = stageLinks
	m.targets, _ = loadTargets(vault)
	m.cands = rankTargets(m.targets, "")
	if len(m.cands) != 2 {
		t.Fatalf("candidates = %d, want 2", len(m.cands))
	}

	m.linksKey(tea.KeyPressMsg{Code: tea.KeyTab})
	if len(m.picked) != 1 || m.picked[0].Slug != m.cands[0].Slug {
		t.Fatalf("first tab picked %v", m.picked)
	}
	m.linksKey(tea.KeyPressMsg{Code: tea.KeyDown})
	m.linksKey(tea.KeyPressMsg{Code: tea.KeyTab})
	if len(m.picked) != 2 {
		t.Fatalf("second tab picked %v", m.picked)
	}
	// Tab on a taken note takes it back out.
	m.linksKey(tea.KeyPressMsg{Code: tea.KeyTab})
	if len(m.picked) != 1 {
		t.Fatalf("untake left %v", m.picked)
	}
	// Esc returns to the words, keeping them.
	m.linksKey(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.stage != stageTitle {
		t.Errorf("esc left stage %v, want the title row", m.stage)
	}
}

// The picker must fit the floating layer rex/notes.lua cuts for the review pass,
// or the bottom border falls off the box.
func TestLinkStageFitsTheLayer(t *testing.T) {
	vault := t.TempDir()
	for slug, title := range map[string]string{
		"amdahls-law":       "Amdahl's law bounds the speedup",
		"gustafsons-law":    "Gustafson's law moves the ceiling",
		"container-vs-host": "Container vs. host",
		"gpt2":              "Let's reproduce GPT-2",
	} {
		seedKnowledge(t, vault, slug, "# "+title+"\n")
	}
	m := newReview(vault)
	m.w, m.h = 78, 16
	m.targets, _ = loadTargets(vault)
	m.pending = "Amdahl's law bounds the speedup"
	m.stage = stageLinks
	m.cands = rankTargets(m.targets, "")

	frame := m.frame()
	if !strings.Contains(frame, "LINKS") {
		t.Errorf("frame has no LINKS head:\n%s", frame)
	}
	if !strings.Contains(frame, "Amdahl") {
		t.Errorf("frame has no candidate:\n%s", frame)
	}
	if w, h := lg.Width(frame), lg.Height(frame); w > 78 || h > 16 {
		t.Errorf("frame = %dx%d, want at most 78x16:\n%s", w, h, frame)
	}
}
