package atlas

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type Status string

const (
	Pending Status = "Pending"
	Active  Status = "Active"
	Blocked Status = "Blocked"
	Done    Status = "Done"
)

type TaskProjection struct {
	ID, Title, Path, NoteStatus, RunID string
	Status                             Status
	NoteMissing                        bool
}

type FeatureProjection struct {
	Name, Path string
	Status     Status
	Tasks      []TaskProjection
	Counts     map[Status]int
}

type Aggregate struct {
	Scope, Name string
	Features    []FeatureProjection
	Diagnostics []string
}

var checklist = regexp.MustCompile(`^\s*-\s*\[([ xX-])\]\s*(.*)$`)
var wiki = regexp.MustCompile(`^\[\[([^]|]+)(?:\|([^]]+))?\]\](?:\s+.*)?$`)
var taskID = regexp.MustCompile(`(?i)^([A-Z]+[0-9]+)\b\s*[-:]?\s*(.*)$`)

func DiscoverFeature(vaultRoot, featurePath string, runs []vaultregistry.Run) (Aggregate, error) {
	featurePath = normalizePath(featurePath)
	feature, diagnostics, err := discoverFeature(vaultRoot, featurePath, runs)
	if err != nil {
		return Aggregate{}, err
	}
	return Aggregate{Scope: "Feature", Name: feature.Name, Features: []FeatureProjection{feature}, Diagnostics: diagnostics}, nil
}

func DiscoverProject(vaultRoot, projectPath string, runs []vaultregistry.Run) (Aggregate, error) {
	projectPath = normalizePath(projectPath)
	pattern := filepath.Join(vaultRoot, filepath.FromSlash(projectPath), "themes", "*", "features", "*", "feature.md")
	paths, err := filepath.Glob(pattern)
	if err != nil {
		return Aggregate{}, err
	}
	sort.Strings(paths)
	result := Aggregate{Scope: "Project", Name: filepath.Base(projectPath)}
	for _, path := range paths {
		rel, err := filepath.Rel(vaultRoot, path)
		if err != nil {
			return Aggregate{}, err
		}
		feature, diagnostics, err := discoverFeature(vaultRoot, filepath.ToSlash(rel), runs)
		if err != nil {
			return Aggregate{}, err
		}
		result.Features = append(result.Features, feature)
		result.Diagnostics = append(result.Diagnostics, diagnostics...)
	}
	return result, nil
}

func discoverFeature(root, path string, runs []vaultregistry.Run) (FeatureProjection, []string, error) {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
	if err != nil {
		return FeatureProjection{}, nil, err
	}
	f := FeatureProjection{Name: filepath.Base(filepath.Dir(path)), Path: path, Counts: map[Status]int{}}
	featureStatus := frontmatterStatus(string(data))
	var diagnostics []string
	seenPath, seenID := map[string]int{}, map[string]int{}
	var seenChecks []string
	inTasks := false
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "## ") {
			inTasks = strings.TrimSpace(line) == "## Tasks"
			continue
		}
		if !inTasks {
			continue
		}
		match := checklist.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		check, body := strings.ToLower(match[1]), strings.TrimSpace(match[2])
		link := wiki.FindStringSubmatch(body)
		if link == nil {
			diagnostics = append(diagnostics, "malformed Task checklist entry: "+body)
			continue
		}
		target := normalizeLink(path, link[1])
		display := strings.TrimSpace(link[2])
		if display == "" {
			display = strings.TrimSuffix(filepath.Base(target), filepath.Ext(target))
		}
		id, title := splitIdentity(display)
		key := seenPath[target]
		if key == 0 && id != "" {
			key = seenID[id]
		}
		if key != 0 {
			diagnostics = append(diagnostics, fmt.Sprintf("duplicate Task link: %s", target))
			if check != seenChecks[key-1] {
				diagnostics = append(diagnostics, fmt.Sprintf("conflicting duplicate checkboxes for %s; first occurrence wins", valueOr(id, target)))
			}
			continue
		}
		t := TaskProjection{ID: id, Title: title, Path: target}
		note, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(target)))
		if os.IsNotExist(readErr) {
			t.NoteMissing = true
			diagnostics = append(diagnostics, "missing Task note: "+target)
		} else if readErr != nil {
			return FeatureProjection{}, nil, readErr
		} else {
			t.NoteStatus = frontmatterStatus(string(note))
		}
		run, stage := selectedRun(runs, target, false)
		if run != nil {
			t.RunID = run.RunID
		}
		t.Status = taskStatus(check, t.NoteStatus, stage)
		if check == "x" && t.NoteStatus == "in-progress" {
			diagnostics = append(diagnostics, fmt.Sprintf("%s [x] conflicts with Task note status: in-progress", valueOr(id, target)))
		}
		f.Tasks = append(f.Tasks, t)
		seenChecks = append(seenChecks, check)
		seenPath[target] = len(f.Tasks)
		if id != "" {
			seenID[id] = len(f.Tasks)
		}
	}
	if err := scanner.Err(); err != nil {
		return FeatureProjection{}, nil, err
	}
	for _, task := range f.Tasks {
		f.Counts[task.Status]++
	}
	_, featureStage := selectedRun(runs, path, true)
	switch {
	case len(f.Tasks) > 0 && f.Counts[Done] == len(f.Tasks):
		f.Status = Done
	case featureStage == "blocked":
		f.Status = Blocked
	case featureStatus == "in-progress" || featureStage == "active" || f.Counts[Active] > 0:
		f.Status = Active
	default:
		f.Status = Pending
	}
	return f, diagnostics, nil
}

func (a Aggregate) Render() string {
	if a.Scope == "Feature" && len(a.Features) == 1 {
		return renderFeature(a.Features[0], a.Diagnostics)
	}
	return renderProject(a)
}

func (a Aggregate) Task(path string) (TaskProjection, bool) {
	path = normalizePath(path)
	for _, feature := range a.Features {
		for _, task := range feature.Tasks {
			if task.Path == path {
				return task, true
			}
		}
	}
	return TaskProjection{}, false
}

func renderFeature(f FeatureProjection, diagnostics []string) string {
	lines := []string{"FEATURE ATLAS · " + f.Name + "  OUTLINE + SUMMARY", statusGlyph(f.Status) + " " + strings.ToUpper(string(f.Status)) + "  Feature status roll-up", "│"}
	for i, t := range f.Tasks {
		branch := "├─"
		indent := "│   "
		if i == len(f.Tasks)-1 {
			branch, indent = "└─", "    "
		}
		lines = append(lines, fmt.Sprintf("%s %s %s  %s  %s", branch, statusGlyph(t.Status), valueOr(t.ID, "?"), t.Title, strings.ToUpper(string(t.Status))))
		detail := taskDetail(t)
		if detail != "" {
			lines = append(lines, indent+detail)
		}
	}
	lines = append(lines, "", fmt.Sprintf("SUMMARY  Pending %d  Active %d  Blocked %d  Done %d", f.Counts[Pending], f.Counts[Active], f.Counts[Blocked], f.Counts[Done]))
	for _, diagnostic := range diagnostics {
		lines = append(lines, "! "+diagnostic)
	}
	lines = append(lines, "FEATURE B — HIERARCHY + ROLL-UP")
	return strings.Join(lines, "\n")
}

func renderProject(a Aggregate) string {
	features := append([]FeatureProjection(nil), a.Features...)
	sort.SliceStable(features, func(i, j int) bool {
		if statusRank(features[i].Status) != statusRank(features[j].Status) {
			return statusRank(features[i].Status) < statusRank(features[j].Status)
		}
		return features[i].Path < features[j].Path
	})
	lines := []string{"PROJECT ATLAS · " + a.Name + "  FEATURE QUEUE", "ST  FEATURE                 P  A  B  D  WHY / NEXT OBSERVABLE ITEM", "──  ──────────────────────  ─  ─  ─  ─  ─────────────────────────────"}
	for _, f := range features {
		lines = append(lines, fmt.Sprintf("%s   %-22s  %d  %d  %d  %d  %s", statusGlyph(f.Status), f.Name, f.Counts[Pending], f.Counts[Active], f.Counts[Blocked], f.Counts[Done], featureWhy(f)))
	}
	lines = append(lines, "", "TASK QUEUE")
	var tasks []struct {
		feature FeatureProjection
		task    TaskProjection
	}
	for _, f := range a.Features {
		for _, t := range f.Tasks {
			tasks = append(tasks, struct {
				feature FeatureProjection
				task    TaskProjection
			}{f, t})
		}
	}
	sort.SliceStable(tasks, func(i, j int) bool {
		if statusRank(tasks[i].task.Status) != statusRank(tasks[j].task.Status) {
			return statusRank(tasks[i].task.Status) < statusRank(tasks[j].task.Status)
		}
		return tasks[i].task.Path < tasks[j].task.Path
	})
	for _, item := range tasks {
		lines = append(lines, fmt.Sprintf("%s %s/%s %s · %s", statusGlyph(item.task.Status), item.feature.Name, valueOr(item.task.ID, "?"), item.task.Title, taskDetail(item.task)))
	}
	for _, diagnostic := range a.Diagnostics {
		lines = append(lines, "! "+diagnostic)
	}
	lines = append(lines, "PROJECT C — DENSE TRIAGE TABLE")
	return strings.Join(lines, "\n")
}

func selectedRun(runs []vaultregistry.Run, path string, feature bool) (*vaultregistry.Run, string) {
	var registered, unfinished *vaultregistry.Run
	for i := range runs {
		r := &runs[i]
		match := normalizePath(r.Task.Path) == path
		if feature {
			match = r.Task.Kind == "feature" && (normalizePath(r.Task.FeaturePath) == path || normalizePath(r.Task.Path) == path)
		}
		if !match {
			continue
		}
		if registered == nil || r.UpdatedAt > registered.UpdatedAt || r.UpdatedAt == registered.UpdatedAt && r.RunID > registered.RunID {
			registered = r
		}
		if currentStage(*r) != "done" && (unfinished == nil || r.UpdatedAt > unfinished.UpdatedAt || r.UpdatedAt == unfinished.UpdatedAt && r.RunID > unfinished.RunID) {
			unfinished = r
		}
	}
	if unfinished == nil {
		return registered, ""
	}
	return registered, currentStage(*unfinished)
}

func currentStage(run vaultregistry.Run) string {
	stage, at, order := "", "", -1
	for i, observation := range run.Lifecycle {
		if observation.ObservedAt > at || observation.ObservedAt == at && i > order {
			stage, at, order = observation.State, observation.ObservedAt, i
		}
	}
	return stage
}

func taskStatus(check, note, stage string) Status {
	if check == "x" {
		return Done
	}
	if stage == "blocked" {
		return Blocked
	}
	if check == "-" || note == "in-progress" || stage == "active" {
		return Active
	}
	return Pending
}

func frontmatterStatus(data string) string {
	lines := strings.Split(data, "\n")
	if len(lines) == 0 || lines[0] != "---" {
		return ""
	}
	for _, line := range lines[1:] {
		if line == "---" {
			break
		}
		if strings.HasPrefix(line, "status:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "status:"))
		}
	}
	return ""
}
func normalizePath(path string) string {
	return filepath.ToSlash(filepath.Clean(filepath.FromSlash(strings.TrimSpace(path))))
}
func normalizeLink(featurePath, link string) string {
	link = strings.TrimSpace(link)
	if !strings.HasSuffix(strings.ToLower(link), ".md") {
		link += ".md"
	}
	if strings.HasPrefix(link, "1_projects/") {
		return normalizePath(link)
	}
	return normalizePath(filepath.ToSlash(filepath.Join(filepath.Dir(featurePath), filepath.FromSlash(link))))
}
func splitIdentity(display string) (string, string) {
	match := taskID.FindStringSubmatch(strings.TrimSpace(display))
	if match == nil {
		return "", strings.TrimSpace(display)
	}
	return strings.ToUpper(match[1]), strings.TrimSpace(match[2])
}
func valueOr(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
func statusRank(status Status) int {
	switch status {
	case Blocked:
		return 0
	case Active:
		return 1
	case Pending:
		return 2
	default:
		return 3
	}
}
func statusGlyph(status Status) string {
	switch status {
	case Done:
		return "✓"
	case Active:
		return "●"
	case Blocked:
		return "!"
	default:
		return "○"
	}
}
func taskDetail(t TaskProjection) string {
	parts := []string{}
	if t.NoteMissing {
		parts = append(parts, "Task note missing")
	}
	if t.RunID != "" {
		parts = append(parts, "registered → "+t.RunID)
	} else {
		parts = append(parts, "unregistered")
	}
	return strings.Join(parts, " · ")
}
func featureWhy(f FeatureProjection) string {
	switch f.Status {
	case Blocked:
		return "own Feature run blocked"
	case Active:
		return "active Task or Feature observation"
	case Done:
		return "every authoritative Task [x]"
	default:
		return "no active Registry observation"
	}
}
