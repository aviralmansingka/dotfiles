package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// Link is one wikilink a promoted note carries. The reason is optional: a bare
// bullet is a valid link, and the editor that opens after promotion is where the
// words go.
type Link struct {
	Slug   string `json:"slug"`
	Reason string `json:"reason,omitempty"`
}

// linkTarget is one existing note the picker can offer: the filename it links
// by, the heading it reads as, and the other names it answers to.
type linkTarget struct {
	Slug    string
	Title   string
	Aliases []string
}

// loadTargets reads the notes a promoted note can point at. The knowledge folder
// is walked whole, so subfolders count; a missing folder is an empty list, not a
// failure, because a fresh vault still promotes.
func loadTargets(vault string) ([]linkTarget, error) {
	dir := filepath.Join(vault, "2_knowledge")
	var out []linkTarget
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		t, err := readTarget(path)
		if err != nil {
			return err
		}
		if t.Slug == "" {
			return nil
		}
		out = append(out, t)
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return out, err
}

// readTarget pulls the three names a note answers to out of its file. The
// frontmatter is stripped first, so a fence inside the body cannot be read as
// metadata.
func readTarget(path string) (linkTarget, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return linkTarget{}, err
	}
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	front, body := splitFrontmatter(lines)
	t := linkTarget{Slug: strings.TrimSuffix(filepath.Base(path), ".md")}
	t.Aliases = parseAliases(front)
	for _, line := range body {
		if heading, ok := strings.CutPrefix(strings.TrimSpace(line), "# "); ok {
			t.Title = strings.TrimSpace(heading)
			break
		}
	}
	if t.Title == "" {
		t.Title = strings.ReplaceAll(t.Slug, "-", " ")
	}
	return t, nil
}

// splitFrontmatter separates a leading fence block from the note body.
func splitFrontmatter(lines []string) (front, body []string) {
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return nil, lines
	}
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			return lines[1:i], lines[i+1:]
		}
	}
	return nil, lines
}

// parseAliases reads both alias shapes the vault uses: the inline list a capture
// template writes and the block list a hand-written note uses.
func parseAliases(front []string) []string {
	var out []string
	block := false
	for _, raw := range front {
		line := strings.TrimSpace(raw)
		if block && strings.HasPrefix(line, "- ") {
			if alias := trimYAML(strings.TrimPrefix(line, "- ")); alias != "" {
				out = append(out, alias)
			}
			continue
		}
		block = false
		value, ok := strings.CutPrefix(line, "aliases:")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if value == "" {
			block = true
			continue
		}
		value = strings.TrimSuffix(strings.TrimPrefix(value, "["), "]")
		for _, part := range strings.Split(value, ",") {
			if alias := trimYAML(part); alias != "" {
				out = append(out, alias)
			}
		}
	}
	return out
}

// trimYAML drops the quoting a frontmatter value carries.
func trimYAML(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, `"'`)
	return strings.TrimSpace(s)
}

// rankTargets orders the notes the picker offers. An empty query offers every
// note, alphabetical, so the list reads as an index before you type.
func rankTargets(targets []linkTarget, query string) []linkTarget {
	tokens := tokenize(query)
	type scored struct {
		t     linkTarget
		score int
	}
	ranked := make([]scored, 0, len(targets))
	for _, t := range targets {
		score := t.score(tokens)
		if len(tokens) > 0 && score == 0 {
			continue
		}
		ranked = append(ranked, scored{t: t, score: score})
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return strings.ToLower(ranked[i].t.Title) < strings.ToLower(ranked[j].t.Title)
	})
	out := make([]linkTarget, len(ranked))
	for i, r := range ranked {
		out[i] = r.t
	}
	return out
}

// score rates one note against the query words. A word the title or an alias
// holds counts full; a word that only starts a name still counts, so "amdah"
// finds the law before the typing is done.
func (t linkTarget) score(tokens []string) int {
	if len(tokens) == 0 {
		return 1
	}
	hay := strings.ToLower(t.Title + " " + strings.ReplaceAll(t.Slug, "-", " ") + " " + strings.Join(t.Aliases, " "))
	words := strings.Fields(hay)
	total := 0
	for _, tok := range tokens {
		if strings.Contains(hay, tok) {
			total += 3
			continue
		}
		for _, w := range words {
			if strings.HasPrefix(w, tok) {
				total++
				break
			}
		}
	}
	return total
}

// tokenize splits a query into the words the picker matches on.
func tokenize(s string) []string {
	var out []string
	var word strings.Builder
	flush := func() {
		if word.Len() > 0 {
			out = append(out, strings.ToLower(word.String()))
			word.Reset()
		}
	}
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			word.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	return out
}

// claimWords are the verbs and joins that make a title say something. A title
// without one is a topic: a folder name wearing a heading, which reads badly a
// year later and links to nothing worth linking.
var claimWords = []string{
	"is", "are", "was", "were", "be", "means", "causes", "makes", "comes",
	"leads", "needs", "must", "can", "cannot", "should", "gives", "has", "have",
	"do", "does", "follows", "requires", "depends", "prevents", "enables",
	"improves", "reduces", "increases", "turns", "becomes", "wins", "breaks",
	"matters", "beats", "costs", "saves", "fails", "works", "not", "because",
	"when", "if", "than", "vs", "before", "after", "instead", "without",
}

// claimWarning reports what is wrong with a title that reads as a topic instead
// of a claim. It returns empty when the title is fine. The caller shows the
// warning once and lets a second Enter through, so the check teaches without
// blocking a fast pass.
func claimWarning(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "say what is true, in your own words"
	}
	if strings.HasSuffix(title, "?") {
		return "a question is not a claim · state the answer · enter again to keep"
	}
	words := tokenize(title)
	if len(words) < 3 {
		return "a topic is not a claim · say what it does · enter again to keep"
	}
	for _, w := range words {
		for _, marker := range claimWords {
			if w == marker {
				return ""
			}
		}
	}
	return "no claim in this title · add what it says · enter again to keep"
}

// linksBlock renders the note's links as their own section. The section is
// omitted when nothing was picked, so a note that stands alone is not given an
// empty heading.
func linksBlock(links []Link) string {
	if len(links) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n## Links\n\n")
	for _, l := range links {
		if reason := strings.TrimSpace(l.Reason); reason != "" {
			fmt.Fprintf(&b, "- [[%s]] — %s\n", l.Slug, reason)
			continue
		}
		fmt.Fprintf(&b, "- [[%s]]\n", l.Slug)
	}
	return b.String()
}

// toggleLink adds a slug to the picked list or takes it out again, keeping the
// order they were picked in.
func toggleLink(picked []Link, slug string) []Link {
	out := make([]Link, 0, len(picked)+1)
	for _, l := range picked {
		if l.Slug == slug {
			continue
		}
		out = append(out, l)
	}
	if len(out) == len(picked) {
		out = append(out, Link{Slug: slug})
	}
	return out
}
