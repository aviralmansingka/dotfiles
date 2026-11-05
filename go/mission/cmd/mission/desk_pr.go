package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

type deskPR struct {
	Number                int
	Draft                 bool
	Passed, Failed, Total int
}

func (p deskPR) label() string {
	if p.Draft {
		return paint(yellow, fmt.Sprintf("Draft #%d", p.Number))
	}
	return paint(green, fmt.Sprintf("PR #%d ready for review", p.Number))
}
func (p deskPR) checks() string {
	if p.Total == 0 {
		return "No CI checks reported"
	}
	if p.Failed > 0 {
		return fmt.Sprintf("CI %d/%d passed · %d failed", p.Passed, p.Total, p.Failed)
	}
	return fmt.Sprintf("CI %d/%d passed", p.Passed, p.Total)
}

type deskPRs map[string]deskPR

var githubRemote = regexp.MustCompile(`^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$`)

type ghDeskPR struct {
	Number                     int
	HeadRefName                string
	IsDraft, IsCrossRepository bool
	StatusCheckRollup          []struct{ Status, State, Conclusion string }
}

func (p ghDeskPR) deskPR() deskPR {
	out := deskPR{Number: p.Number, Draft: p.IsDraft, Total: len(p.StatusCheckRollup)}
	for _, check := range p.StatusCheckRollup {
		switch {
		case check.State == "SUCCESS" || check.Conclusion == "SUCCESS" || check.Conclusion == "NEUTRAL" || check.Conclusion == "SKIPPED":
			out.Passed++
		case check.State == "FAILURE" || check.State == "ERROR" || check.Status == "COMPLETED":
			out.Failed++
		}
	}
	return out
}

// Read GitHub asynchronously. A missing command, login, or remote never blocks
// the local desk or causes it to claim that a PR is absent.
func readDeskPRs(s *Store, records []mission.Record) tea.Cmd {
	branches := map[string]map[string]string{}
	for _, r := range records {
		if b := r.State.Runtime; b != nil && b.Branch != "" && r.State.Status != closedStatus {
			if branches[r.Mission.Repo] == nil {
				branches[r.Mission.Repo] = map[string]string{}
			}
			branches[r.Mission.Repo][b.Branch] = r.Handle
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
			cmd := exec.CommandContext(ctx, "gh", "pr", "list", "--repo", match[1], "--state", "open", "--limit", "100",
				"--json", "number,headRefName,isDraft,isCrossRepository,statusCheckRollup")
			cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1")
			raw, e := cmd.Output()
			cancel()
			var prs []ghDeskPR
			if e != nil || json.Unmarshal(raw, &prs) != nil {
				continue
			}
			for _, pr := range prs {
				if h := byBranch[pr.HeadRefName]; h != "" && !pr.IsCrossRepository && result[h].Number < pr.Number {
					result[h] = pr.deskPR()
				}
			}
		}
		return result
	}
}
