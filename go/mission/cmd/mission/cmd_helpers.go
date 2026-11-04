package main

import (
	"fmt"
	"os"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func missionFromArgs(a platform.Args) (mission.Mission, error) {
	repo, slug, e := splitHandle(a.At(1))
	if e != nil {
		return mission.Mission{}, e
	}
	m := mission.Mission{Repo: repo, Slug: slug, Kind: platform.Fallback(a.Get("kind"), "research"), Title: a.Get("title"), Goal: a.Get("goal")}
	if a.Has("from") {
		b, e := os.ReadFile(a.Get("from"))
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
		mission.NormalizeMission(&m)
		return m, validateMission(m)
	}
	for _, title := range a.Flags["step"] {
		m.Steps = append(m.Steps, mission.Step{Title: title, Agent: platform.Fallback(a.Get("agent"), "any")})
	}
	for i, v := range a.Flags["checkpoint"] {
		after, q, ok := strings.Cut(v, ":")
		if !ok {
			return m, mission.Problem("usage", "checkpoint format: S01:Question")
		}
		m.Checkpoints = append(m.Checkpoints, mission.Checkpoint{ID: fmt.Sprintf("C%02d", i+1), After: after, Kind: "human", Question: q})
	}
	mission.NormalizeMission(&m)
	return m, validateMission(m)
}
