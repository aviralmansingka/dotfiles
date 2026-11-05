package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

type deskPR struct {
	Number                         int
	Draft                          bool
	State                          string
	Passed, Failed, Skipped, Total int
}

func (p deskPR) label() string {
	switch p.State {
	case "MERGED":
		return paint(muted, fmt.Sprintf("PR #%d merged", p.Number))
	case "CLOSED":
		return paint(muted, fmt.Sprintf("PR #%d closed", p.Number))
	}
	if p.Draft {
		return paint(yellow, fmt.Sprintf("Draft #%d", p.Number))
	}
	if p.Failed > 0 {
		return paint(orange, fmt.Sprintf("PR #%d", p.Number))
	}
	return paint(ink, fmt.Sprintf("PR #%d", p.Number))
}

func (p deskPR) open() bool { return p.Number > 0 && p.State != "MERGED" && p.State != "CLOSED" }

func (p deskPR) checksPassed() bool {
	return p.Passed > 0 && p.Failed == 0 && p.Passed+p.Skipped == p.Total
}

func (p deskPR) preferredTo(other deskPR) bool {
	if p.open() != other.open() {
		return p.open()
	}
	return p.Number > other.Number
}

func (p deskPR) badge() string {
	if p.Number == 0 {
		return ""
	}
	fg := muted
	switch {
	case p.Failed > 0:
		fg = orange
	case p.checksPassed():
		fg = green
	}
	return p.label() + "   " + paint(fg, p.checks())
}
func (p deskPR) checks() string {
	if p.Total == 0 {
		return "No CI checks reported"
	}
	text := fmt.Sprintf("CI %d/%d passed", p.Passed, p.Total)
	if p.Failed > 0 {
		text += fmt.Sprintf(" · %d failed", p.Failed)
	}
	if p.Skipped > 0 {
		text += fmt.Sprintf(" · %d skipped", p.Skipped)
	}
	if p.Passed+p.Failed+p.Skipped < p.Total {
		text += " · pending"
	}
	return text
}

type deskPRs map[string]deskPR

var githubRemote = regexp.MustCompile(`^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$`)

type ghDeskPR struct {
	Number                     int
	HeadRefName, State         string
	IsDraft, IsCrossRepository bool
	StatusCheckRollup          []struct{ Status, State, Conclusion string }
}

func (p ghDeskPR) deskPR() deskPR {
	out := deskPR{Number: p.Number, Draft: p.IsDraft, State: p.State, Total: len(p.StatusCheckRollup)}
	for _, check := range p.StatusCheckRollup {
		switch {
		case check.State == "SUCCESS" || check.Conclusion == "SUCCESS":
			out.Passed++
		case check.Conclusion == "NEUTRAL" || check.Conclusion == "SKIPPED":
			out.Skipped++
		case check.State == "FAILURE" || check.State == "ERROR" || check.Status == "COMPLETED":
			out.Failed++
		}
	}
	return out
}

const deskPRLimit = 100

func listDeskPRs(ctx context.Context, repo string, extra ...string) ([]ghDeskPR, bool) {
	args := []string{"pr", "list", "--repo", repo, "--state", "all", "--limit", fmt.Sprint(deskPRLimit),
		"--json", "number,headRefName,state,isDraft,isCrossRepository,statusCheckRollup"}
	cmd := exec.CommandContext(ctx, "gh", append(args, extra...)...)
	cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1")
	raw, err := cmd.Output()
	var prs []ghDeskPR
	ok := err == nil && json.Unmarshal(raw, &prs) == nil
	return prs, ok
}

// Read GitHub asynchronously. A missing command, login, or remote never blocks
// the local desk or causes it to claim that a PR is absent.
func readDeskPRs(s *Store, records []mission.Record) tea.Cmd {
	branches := map[string]map[string]string{}
	completed := map[string][]mission.Record{}
	for _, r := range records {
		if b := r.State.Runtime; b != nil && b.Branch != "" && r.State.Status != closedStatus {
			if branches[r.Mission.Repo] == nil {
				branches[r.Mission.Repo] = map[string]string{}
			}
			branches[r.Mission.Repo][b.Branch] = r.Handle
			if r.State.Status == "done" {
				completed[r.Mission.Repo] = append(completed[r.Mission.Repo], r)
			}
		}
	}
	if len(branches) == 0 {
		return nil
	}
	return func() tea.Msg {
		result := deskPRs{}
		for slug, byBranch := range branches {
			repo, e := s.repo(slug)
			if e != nil {
				continue
			}
			remote := repo.Remote
			if remote == "" && repo.Bindings[platform.Machine()] != "" {
				remote, _ = gitText(repo.Bindings[platform.Machine()], "config", "--get", "remote.origin.url")
			}
			match := githubRemote.FindStringSubmatch(strings.TrimSpace(remote))
			if len(match) < 2 {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			prs, ok := listDeskPRs(ctx, match[1])
			if !ok {
				cancel()
				continue
			}
			// Only a complete listing can establish that a branch has no PR.
			if len(prs) < deskPRLimit {
				for _, h := range byBranch {
					result[h] = deskPR{}
				}
			}
			for _, pr := range prs {
				candidate := pr.deskPR()
				if h := byBranch[pr.HeadRefName]; h != "" && !pr.IsCrossRepository && candidate.preferredTo(result[h]) {
					result[h] = candidate
				}
			}
			// A busy repository's first page can miss older handoffs. Use
			// the rest of the poll budget to check completed branches directly.
			done := completed[slug]
			sort.SliceStable(done, func(i, j int) bool { return lastMissionUpdate(done[i]) > lastMissionUpdate(done[j]) })
			for _, r := range done {
				if ctx.Err() != nil {
					break
				}
				if _, known := result[r.Handle]; known {
					continue
				}
				branch := r.State.Runtime.Branch
				prs, ok := listDeskPRs(ctx, match[1], "--head", branch)
				if !ok {
					continue
				}
				if len(prs) < deskPRLimit {
					result[r.Handle] = deskPR{}
				}
				for _, pr := range prs {
					candidate := pr.deskPR()
					if pr.HeadRefName == branch && !pr.IsCrossRepository && candidate.preferredTo(result[r.Handle]) {
						result[r.Handle] = candidate
					}
				}
			}
			cancel()
		}
		return result
	}
}
