package mission

import (
	"path/filepath"
	"regexp"
	"strings"
)

var slugRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// ValidSlug reports whether one repository or mission slug is well formed.
func ValidSlug(s string) bool { return len(s) >= 3 && len(s) <= 64 && slugRE.MatchString(s) }

// SplitHandle splits a qualified REPO/SLUG handle.
func SplitHandle(h string) (string, string, error) {
	p := strings.Split(h, "/")
	if len(p) != 2 || !ValidSlug(p[0]) || !ValidSlug(p[1]) {
		return "", "", Problem("invalid_handle", "use a qualified handle such as dotfiles/vault-mission-store")
	}
	return p[0], p[1], nil
}

// MissionBranch is the branch a mission owns. Slugs are validated as
// [a-z0-9]+(-[a-z0-9]+)*, so the name is a legal ref component; the core still
// has the catalog confirm it with Git, because the branch name is a durable,
// user-visible identity that other tooling matches on.
func MissionBranch(slug string) string { return "mission/" + slug }

// Validate is the mission definition policy: every stored mission, and every
// mission about to be written, must still satisfy it.
func Validate(m Mission) error {
	if !ValidSlug(m.Repo) || !ValidSlug(m.Slug) {
		return Problem("invalid_slug", "repository and mission slugs must be 3–64 lowercase letters/digits/hyphens")
	}
	if m.Title == "" || m.Goal == "" || len(m.Steps) == 0 {
		return Problem("invalid_mission", "title, goal and at least one step are required")
	}
	if m.Kind != "research" && m.Kind != "implementation" {
		return Problem("invalid_mission", "kind must be research or implementation")
	}
	ids := map[string]bool{}
	for _, st := range m.Steps {
		if !regexp.MustCompile(`^S[0-9]{2,}$`).MatchString(st.ID) || ids[st.ID] {
			return Problem("invalid_step", "step IDs must be unique S01-style IDs")
		}
		ids[st.ID] = true
		if st.Title == "" || st.Agent == "" {
			return Problem("invalid_step", "step title and agent required")
		}
		if st.Output == "" || filepath.Base(st.Output) != st.Output || strings.Contains(st.Output, "..") || st.Output == "session.jsonl" || st.Output == "session.log" || st.Output == "brief.md" {
			return Problem("invalid_output", "output must be a simple filename; session.jsonl, session.log and brief.md are reserved")
		}
		for _, name := range StepChecks(st) {
			if !KnownCheck(name) {
				if strings.HasPrefix(name, CmdCheckPrefix) {
					return Problem("invalid_check", "check %q needs a shell command after the cmd: prefix", name)
				}
				return Problem("invalid_check", "unknown check %q; use mission checks to list presets", name)
			}
		}
		if len(st.Instructions) > 8000 || len(st.Acceptance) > 8000 {
			return Problem("too_large", "step instructions and acceptance criteria are limited to 8000 characters each")
		}
	}
	cpids := map[string]bool{}
	after := map[string]bool{}
	for _, c := range m.Checkpoints {
		if !ids[c.After] || cpids[c.ID] || after[c.After] || c.Kind != "human" || c.Question == "" || !regexp.MustCompile(`^C[0-9]{2,}$`).MatchString(c.ID) {
			return Problem("invalid_checkpoint", "unique C01 checkpoints must reference a step, kind human, and a question")
		}
		cpids[c.ID] = true
		after[c.After] = true
	}
	return nil
}

// CheckPreset is one registered check the CLI offers by name.
type CheckPreset struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
}

// CmdCheckPrefix marks a preset that carries its own command, so its name is
// data, not a catalog entry.
const CmdCheckPrefix = "cmd:"

// CheckCatalog is every check a mission may name.
func CheckCatalog() []CheckPreset {
	return []CheckPreset{{CheckNonemptyArtifact, "1", "Required: a nonempty UTF-8 result, limited to 16 MiB"}, {CheckJSONValid, "1", "Parse the result as exactly one JSON value"}, {CheckGoTest, "1", "Run go test ./... in the Go module under the attempt checkout, with a two-minute deadline"}, {CmdCheckPrefix + "<shell command>", "1", "Run the shell command in the attempt checkout, with a two-minute deadline"}}
}

// KnownCheck reports whether one step check names a registered preset or
// carries a shell command.
func KnownCheck(name string) bool {
	if cmd, ok := strings.CutPrefix(name, CmdCheckPrefix); ok {
		return strings.TrimSpace(cmd) != ""
	}
	for _, c := range CheckCatalog() {
		if c.Name == name {
			return true
		}
	}
	return false
}

// VerificationSummary renders one check run as the line the ledger, the
// attempt note, and the refusal message all show.
func VerificationSummary(v Verification) string {
	parts := []string{}
	for _, r := range v.Results {
		parts = append(parts, r.Check+": "+r.Verdict)
	}
	return strings.Join(parts, ", ")
}
