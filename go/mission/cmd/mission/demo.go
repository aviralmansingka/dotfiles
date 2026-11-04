package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func seedDemo(s *Store) ([]Record, error) {
	existing, e := s.repos()
	if e != nil {
		return nil, e
	}
	if len(existing) > 0 {
		return nil, problem("demo_not_empty", "demo requires an empty mission collection; existing records were left intact")
	}
	checkout := filepath.Join(s.Vault, "demo-checkout")
	if e = os.MkdirAll(checkout, 0700); e != nil {
		return nil, e
	}
	if _, e = s.addRepo("dotfiles", checkout, "https://github.com/aviral/dotfiles"); e != nil {
		return nil, e
	}
	definitions := []Mission{
		{Repo: "dotfiles", Slug: "lifecycle-hooks", Title: "Preserve agent lifecycle", Goal: "Keep every session, hook and result attached to its attempt.", Kind: "research", Steps: []Step{{Title: "Map lifecycle events", Output: "hook-map.md"}, {Title: "Design the Pi adapter", Output: "adapter-design.md"}, {Title: "Review recovery gaps", Output: "recovery.md"}}, Checkpoints: []Checkpoint{{"C01", "S01", "human", "Are these the right lifecycle boundaries?"}, {"C02", "S03", "human", "Is this ready for an implementation mission?"}}},
		{Repo: "dotfiles", Slug: "worktree-ownership", Title: "Audit worktree ownership", Goal: "Document how claims fit durable worktree owners.", Kind: "research", Steps: []Step{{Title: "Inspect current ownership", Output: "ownership.md"}, {Title: "Propose guardrails", Output: "guardrails.md"}}},
		{Repo: "dotfiles", Slug: "mission-templates", Title: "Make mission creation easy", Goal: "Produce reusable briefs for research and implementation.", Kind: "research", Steps: []Step{{Title: "Sketch mission templates", Output: "templates.md"}}, Checkpoints: []Checkpoint{{"C01", "S01", "human", "Would you use these templates for your next mission?"}}},
	}
	for _, m := range definitions {
		m.Body = "# " + m.Title + "\n\n" + m.Goal + "\n\nSIMULATED DEMO: no Pi process has been launched.\n"
		if _, e = s.create(m); e != nil {
			return nil, e
		}
	}
	c, e := s.claim("dotfiles/lifecycle-hooks", "scout", "pi-demo-7f23", "", false)
	if e != nil {
		return nil, e
	}
	session := filepath.Join(s.Vault, "demo-session.jsonl")
	if e = atomicWrite(session, []byte("{\"type\":\"session\",\"id\":\"pi-demo-7f23\",\"demo\":true}\n")); e != nil {
		return nil, e
	}
	events := []Event{{Type: "session-start", SessionID: "pi-demo-7f23", SessionFile: session, Summary: "Simulated Pi session bound to attempt"}, {Type: "agent-start", Summary: "Inspect lifecycle boundaries"}, {Type: "tool-start", Tool: "read", Summary: "Read interactive-subagents lifecycle handlers"}, {Type: "tool-end", Tool: "read", Summary: "Identified session, agent, tool and shutdown events"}, {Type: "agent-end", Summary: "Turn ended; attempt is still owned"}}
	for i, ev := range events {
		ev.ID = fmt.Sprintf("demo-event-%d", i)
		if _, e = s.hook(c.Handle, c.Attempt.ID, c.Token, ev); e != nil {
			return nil, e
		}
	}
	if e = atomicWrite(artifactPath(s, c), []byte("# Lifecycle map\n\nSIMULATED EVIDENCE\n\n- session_start binds the session.\n- agent_end ends a turn, not the attempt.\n- session_shutdown preserves the transcript.\n\nA real Pi compatibility pilot is still required.\n")); e != nil {
		return nil, e
	}
	if _, e = s.finish(c.Handle, c.Attempt.ID, c.Token, false, "Simulated result ready for human review", false, 0); e != nil {
		return nil, e
	}
	c, e = s.claim("dotfiles/worktree-ownership", "scout", "pi-demo-9b41", "", false)
	if e != nil {
		return nil, e
	}
	for i, ev := range []Event{{Type: "session-start", SessionID: "pi-demo-9b41", Summary: "SIMULATED: no process or pane was launched"}, {Type: "agent-start", Summary: "Inspecting durable owner records"}, {Type: "tool-start", Tool: "read", Summary: "Reading worktree.ts ownership checks"}} {
		ev.ID = fmt.Sprintf("demo-owner-%d", i)
		if _, e = s.hook(c.Handle, c.Attempt.ID, c.Token, ev); e != nil {
			return nil, e
		}
	}
	return s.list()
}
