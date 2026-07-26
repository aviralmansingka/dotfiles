package atlas

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

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

type aggregateStyles struct {
	enabled                       bool
	heading, normal, done, active lipgloss.Style
	blocked, muted, registered    lipgloss.Style
}

func newAggregateStyles(enabled bool) aggregateStyles {
	if !enabled {
		return aggregateStyles{}
	}
	renderer := lipgloss.NewRenderer(io.Discard)
	renderer.SetColorProfile(termenv.TrueColor)
	return aggregateStyles{
		enabled:    true,
		heading:    renderer.NewStyle().Foreground(lipgloss.Color("#f28534")),
		normal:     renderer.NewStyle().Foreground(lipgloss.Color("#ebdbb2")),
		done:       renderer.NewStyle().Foreground(lipgloss.Color("#b8bb26")),
		active:     renderer.NewStyle().Foreground(lipgloss.Color("#e9b143")),
		blocked:    renderer.NewStyle().Foreground(lipgloss.Color("#f2594b")),
		muted:      renderer.NewStyle().Foreground(lipgloss.Color("#928374")),
		registered: renderer.NewStyle().Foreground(lipgloss.Color("#80aa9e")),
	}
}

func (s aggregateStyles) render(style lipgloss.Style, text string) string {
	if !s.enabled {
		return text
	}
	return style.Render(text)
}

func (s aggregateStyles) status(status Status, text string) string {
	switch status {
	case Done:
		return s.render(s.done, text)
	case Active:
		return s.render(s.active, text)
	case Blocked:
		return s.render(s.blocked, text)
	default:
		return s.render(s.muted, text)
	}
}

func ColorEnabled(mode string, snapshot, terminal, dumb, noColor bool) bool {
	if snapshot || mode == "never" {
		return false
	}
	if mode == "always" {
		return true
	}
	return terminal && !dumb && !noColor
}

var checklist = regexp.MustCompile(`^\s*-\s*\[([ xX-])\]\s*(.*)$`)
var canonicalTask = regexp.MustCompile(`^(T[0-9]+)[ \t]+\[\[([^]|]+)\|([^]]+)\]\]\.[ \t]*$`)
var compatibleTask = regexp.MustCompile(`^\[\[([^]|]+)\|((T[0-9]+)[ \t]+[^]]+)\]\][ \t]*$`)
var wiki = regexp.MustCompile(`^\[\[([^]|]+)(?:\|([^]]+))?\]\][ \t]*$`)
var taskID = regexp.MustCompile(`(?i)^([A-Z]+[0-9]+)\b\s*[-:]?\s*(.*)$`)
var h1OrH2 = regexp.MustCompile(`^ {0,3}#{1,2}(?:[ \t]+|$)`)
var tasksH2 = regexp.MustCompile(`^ {0,3}##[ \t]+Tasks(?:[ \t]+#*)?[ \t]*$`)

func DiscoverFeature(vaultRoot, featurePath string, runs []vaultregistry.Run) (Aggregate, error) {
	featurePath, err := canonicalFeaturePath(featurePath)
	if err != nil {
		return Aggregate{}, err
	}
	feature, diagnostics, err := discoverFeature(vaultRoot, featurePath, runs)
	if err != nil {
		return Aggregate{}, err
	}
	return Aggregate{Scope: "Feature", Name: feature.Name, Features: []FeatureProjection{feature}, Diagnostics: diagnostics}, nil
}

func DiscoverProject(vaultRoot, projectPath string, runs []vaultregistry.Run) (Aggregate, error) {
	projectPath, err := canonicalProjectPath(projectPath)
	if err != nil {
		return Aggregate{}, err
	}
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
	projectPath := strings.Join(strings.Split(path, "/")[:2], "/")
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		if h1OrH2.MatchString(line) {
			inTasks = tasksH2.MatchString(line)
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
		link, id, title, ok := parseTaskBody(body)
		if !ok {
			if raw := wiki.FindStringSubmatch(body); raw != nil {
				target := normalizeLink(path, raw[1])
				if target != projectPath && !strings.HasPrefix(target, projectPath+"/") {
					diagnostics = append(diagnostics, "Task link outside selected Project: "+target)
					continue
				}
			}
			diagnostics = append(diagnostics, "malformed Task checklist entry: "+body)
			continue
		}
		target := normalizeLink(path, link)
		if target != projectPath && !strings.HasPrefix(target, projectPath+"/") {
			diagnostics = append(diagnostics, "Task link outside selected Project: "+target)
			continue
		}
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
	return a.RenderColor(false)
}

func (a Aggregate) RenderColor(enabled bool) string {
	styles := newAggregateStyles(enabled)
	if a.Scope == "Feature" && len(a.Features) == 1 {
		return renderFeature(a.Features[0], a.Diagnostics, styles)
	}
	return renderProject(a, styles)
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

func renderFeature(f FeatureProjection, diagnostics []string, styles aggregateStyles) string {
	lines := []string{
		styles.render(styles.heading, "FEATURE ATLAS") + " " + styles.render(styles.muted, "·") + " " + styles.render(styles.normal, f.Name) + "  " + styles.render(styles.heading, "OUTLINE + SUMMARY"),
		styles.status(f.Status, statusGlyph(f.Status)+" "+strings.ToUpper(string(f.Status))) + "  " + styles.render(styles.normal, "Feature status roll-up"),
		styles.render(styles.muted, "│"),
	}
	for i, t := range f.Tasks {
		branch := "├─"
		indent := "│   "
		if i == len(f.Tasks)-1 {
			branch, indent = "└─", "    "
		}
		lines = append(lines, styles.render(styles.muted, branch)+" "+styles.status(t.Status, statusGlyph(t.Status))+" "+styles.render(styles.normal, valueOr(t.ID, "?")+"  "+t.Title)+"  "+styles.status(t.Status, strings.ToUpper(string(t.Status))))
		detail := styledTaskDetail(t, styles)
		if detail != "" {
			lines = append(lines, styles.render(styles.muted, indent)+detail)
		}
	}
	lines = append(lines, "", styles.render(styles.heading, "SUMMARY")+"  "+styles.status(Pending, "Pending")+fmt.Sprintf(" %d  ", f.Counts[Pending])+styles.status(Active, "Active")+fmt.Sprintf(" %d  ", f.Counts[Active])+styles.status(Blocked, "Blocked")+fmt.Sprintf(" %d  ", f.Counts[Blocked])+styles.status(Done, "Done")+fmt.Sprintf(" %d", f.Counts[Done]))
	for _, diagnostic := range diagnostics {
		lines = append(lines, styles.render(styles.blocked, "! "+diagnostic))
	}
	lines = append(lines, styles.render(styles.heading, "FEATURE B — HIERARCHY + ROLL-UP"))
	return strings.Join(lines, "\n")
}

func renderProject(a Aggregate, styles aggregateStyles) string {
	features := append([]FeatureProjection(nil), a.Features...)
	sort.SliceStable(features, func(i, j int) bool {
		if statusRank(features[i].Status) != statusRank(features[j].Status) {
			return statusRank(features[i].Status) < statusRank(features[j].Status)
		}
		return features[i].Path < features[j].Path
	})
	lines := []string{
		styles.render(styles.heading, "PROJECT ATLAS") + " " + styles.render(styles.muted, "·") + " " + styles.render(styles.normal, a.Name) + "  " + styles.render(styles.heading, "FEATURE QUEUE"),
		styles.render(styles.muted, "ST  FEATURE                 P  A  B  D  WHY / NEXT OBSERVABLE ITEM"),
		styles.render(styles.muted, "──  ──────────────────────  ─  ─  ─  ─  ─────────────────────────────"),
	}
	for _, f := range features {
		lines = append(lines, styles.status(f.Status, statusGlyph(f.Status))+"   "+styles.render(styles.normal, fmt.Sprintf("%-22s  %d  %d  %d  %d  %s", f.Name, f.Counts[Pending], f.Counts[Active], f.Counts[Blocked], f.Counts[Done], featureWhy(f))))
	}
	lines = append(lines, "", styles.render(styles.heading, "TASK QUEUE"))
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
		lines = append(lines, styles.status(item.task.Status, statusGlyph(item.task.Status))+" "+styles.render(styles.normal, item.feature.Name+"/"+valueOr(item.task.ID, "?")+" "+item.task.Title)+" "+styles.render(styles.muted, "·")+" "+styledTaskDetail(item.task, styles))
	}
	for _, diagnostic := range a.Diagnostics {
		lines = append(lines, styles.render(styles.blocked, "! "+diagnostic))
	}
	lines = append(lines, styles.render(styles.heading, "PROJECT C — DENSE TRIAGE TABLE"))
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
		if registered == nil || timestampAfter(r.UpdatedAt, registered.UpdatedAt) || timestampEqual(r.UpdatedAt, registered.UpdatedAt) && r.RunID > registered.RunID {
			registered = r
		}
		if currentStage(*r) != "done" && (unfinished == nil || timestampAfter(r.UpdatedAt, unfinished.UpdatedAt) || timestampEqual(r.UpdatedAt, unfinished.UpdatedAt) && r.RunID > unfinished.RunID) {
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
		if order == -1 || timestampAfter(observation.ObservedAt, at) || timestampEqual(observation.ObservedAt, at) && i > order {
			stage, at, order = observation.State, observation.ObservedAt, i
		}
	}
	return stage
}

func timestampAfter(a, b string) bool {
	aTime, aErr := time.Parse(time.RFC3339, a)
	bTime, bErr := time.Parse(time.RFC3339, b)
	if aErr == nil && bErr == nil {
		return aTime.After(bTime)
	}
	return a > b
}

func timestampEqual(a, b string) bool {
	aTime, aErr := time.Parse(time.RFC3339, a)
	bTime, bErr := time.Parse(time.RFC3339, b)
	if aErr == nil && bErr == nil {
		return aTime.Equal(bTime)
	}
	return a == b
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
	if strings.HasPrefix(link, "/") {
		return normalizePath(strings.TrimPrefix(link, "/"))
	}
	if strings.HasPrefix(link, "1_projects/") {
		return normalizePath(link)
	}
	return normalizePath(filepath.ToSlash(filepath.Join(filepath.Dir(featurePath), filepath.FromSlash(link))))
}
func canonicalProjectPath(path string) (string, error) {
	normalized := normalizePath(path)
	parts := strings.Split(normalized, "/")
	if filepath.IsAbs(path) || len(parts) != 2 || parts[0] != "1_projects" || parts[1] == "" || (strings.TrimSpace(path) != normalized && strings.TrimSuffix(strings.TrimSpace(path), "/") != normalized) {
		return "", fmt.Errorf("invalid canonical Project target: %s", path)
	}
	return normalized, nil
}
func canonicalFeaturePath(path string) (string, error) {
	normalized := normalizePath(path)
	parts := strings.Split(normalized, "/")
	if filepath.IsAbs(path) || strings.TrimSpace(path) != normalized || len(parts) != 7 || parts[0] != "1_projects" || parts[1] == "" || parts[2] != "themes" || parts[3] == "" || parts[4] != "features" || parts[5] == "" || parts[6] != "feature.md" {
		return "", fmt.Errorf("invalid canonical Feature target: %s", path)
	}
	return normalized, nil
}
func parseTaskBody(body string) (link, id, title string, ok bool) {
	if match := canonicalTask.FindStringSubmatch(body); match != nil {
		link, id, title = strings.TrimSpace(match[2]), match[1], strings.TrimSpace(match[3])
		return link, id, title, link != "" && title != ""
	}
	if match := compatibleTask.FindStringSubmatch(body); match != nil {
		link = strings.TrimSpace(match[1])
		id, title = splitIdentity(match[2])
		return link, id, title, link != "" && title != ""
	}
	return "", "", "", false
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
func styledTaskDetail(t TaskProjection, styles aggregateStyles) string {
	parts := []string{}
	if t.NoteMissing {
		parts = append(parts, styles.render(styles.normal, "Task note missing"))
	}
	if t.RunID != "" {
		parts = append(parts, styles.render(styles.registered, "registered → "+t.RunID))
	} else {
		parts = append(parts, styles.render(styles.normal, "unregistered"))
	}
	return strings.Join(parts, " "+styles.render(styles.muted, "·")+" ")
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
