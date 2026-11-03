package main

import (
	"fmt"
	"os"
	"strings"
)

func missionFromArgs(a args) (Mission, error) {
	repo, slug, e := splitHandle(a.at(1))
	if e != nil {
		return Mission{}, e
	}
	m := Mission{Repo: repo, Slug: slug, Kind: fallback(a.get("kind"), "research"), Title: a.get("title"), Goal: a.get("goal")}
	if a.has("from") {
		b, e := os.ReadFile(a.get("from"))
		if e != nil {
			return m, e
		}
		body, e := parseMarkdown(b, &m)
		if e != nil {
			return m, e
		}
		m.Repo = repo
		m.Slug = slug
		m.Body = body
		normalizeMission(&m)
		return m, validateMission(m)
	}
	for _, title := range a.flags["step"] {
		m.Steps = append(m.Steps, Step{Title: title, Agent: fallback(a.get("agent"), "any")})
	}
	for i, v := range a.flags["checkpoint"] {
		after, q, ok := strings.Cut(v, ":")
		if !ok {
			return m, problem("usage", "checkpoint format: S01:Question")
		}
		m.Checkpoints = append(m.Checkpoints, Checkpoint{ID: fmt.Sprintf("C%02d", i+1), After: after, Kind: "human", Question: q})
	}
	normalizeMission(&m)
	return m, validateMission(m)
}
