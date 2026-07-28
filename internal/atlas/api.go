package atlas

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const defaultCollectionByteLimit = 35_000

type MachineSelector struct {
	Positional string
	ID         string
	Name       string
}

func (s MachineSelector) any() string {
	if s.Positional != "" {
		return s.Positional
	}
	if s.ID != "" {
		return s.ID
	}
	return s.Name
}

type MachineGetOptions struct {
	Run     string
	Pending bool
}

type Envelope struct {
	APIVersion string         `json:"api_version"`
	Kind       string         `json:"kind"`
	Data       any            `json:"data"`
	Meta       map[string]any `json:"meta"`
}

type CreateRequest struct {
	Run           *vaultregistry.Run         `json:"run"`
	InitialDriver *vaultregistry.Observation `json:"initial_driver"`
}

type projectRecord struct {
	ID               string
	Name             string
	Description      string
	Status           string
	WorkingDirectory string
	Repository       string
	Path             string
	MissingMetadata  []string
}

type themeRecord struct {
	ID          string
	Name        string
	Description string
	Status      string
	Path        string
	ProjectPath string
}

type featureRecord struct {
	ID          string
	Name        string
	Description string
	Status      string
	Path        string
	ProjectPath string
	ThemePath   string
}

type verifierDefinition struct {
	ID       string
	LocalID  string
	Name     string
	Command  string
	Expected string
}

type taskRecord struct {
	ID          string
	LocalID     string
	Name        string
	Intent      string
	Status      string
	Path        string
	ProjectPath string
	ThemePath   string
	FeaturePath string
	Verifiers   []verifierDefinition
}

type note struct {
	Frontmatter map[string]string
	Title       string
	Paragraph   string
	Sections    map[string]string
	Body        string
}

type store struct {
	vaultRoot          string
	stateRoot          string
	projects           []projectRecord
	incompleteProjects []projectRecord
	themes             []themeRecord
	features           []featureRecord
	tasks              []taskRecord
	activeRuns         []vaultregistry.Run
	retiredRuns        []vaultregistry.Run
	runsByTask         map[string][]vaultregistry.Run
}

type taskIdentity struct {
	ID      string
	LocalID string
	Name    string
	Path    string
}

type attemptProjection struct {
	ID          string
	Revision    int
	Outcome     string
	Decision    string
	Reason      string
	RunID       string
	RunName     string
	Task        taskIdentity
	Verifier    verifierDefinition
	Evidence    evidenceProjection
	AttemptedAt string
}

type evidenceProjection struct {
	ID                 string
	Task               taskIdentity
	RunID              string
	RunName            string
	VerifierID         string
	VerifierLocalID    string
	VerifierName       string
	AttemptID          string
	AttemptOutcome     string
	AttemptDecision    string
	Command            string
	ExitStatus         *int
	ImplementationTree string
	Artifacts          []map[string]any
	CapturedAt         string
}

type participantProjection struct {
	ID        string
	Name      string
	Role      string
	State     string
	Runtime   string
	SessionID string
	RunID     string
	RunName   string
	Usage     map[string]any
	StartedAt string
	UpdatedAt string
}

type usageProjection struct {
	RunID      string
	RunName    string
	Input      int64
	Cached     int64
	Output     int64
	Total      int64
	Parts      []map[string]any
	ObservedAt string
}

type usageCounters struct {
	InputTokens       int64
	CachedInputTokens int64
	OutputTokens      int64
	TotalTokens       int64
}

func ResolveVaultRoot() (string, error) {
	if root := os.Getenv("ATLAS_VAULT_ROOT"); root != "" {
		return root, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "vault"), nil
}

func BuildEnvelope(vaultRoot, stateRoot, resource string, selector MachineSelector, options MachineGetOptions) (Envelope, error) {
	loaded, err := loadStore(vaultRoot, stateRoot)
	if err != nil {
		return Envelope{}, err
	}
	switch resource {
	case "projects":
		return loaded.projectsEnvelope(selector)
	case "themes":
		return loaded.themesEnvelope(selector)
	case "features":
		return loaded.featuresEnvelope(selector)
	case "tasks":
		return loaded.tasksEnvelope(selector)
	case "runs":
		return loaded.runsEnvelope(selector)
	case "verifiers":
		return loaded.verifiersEnvelope(selector)
	case "verifierattempts":
		return loaded.verifierAttemptsEnvelope(selector, options)
	case "participants":
		return loaded.participantsEnvelope(selector)
	case "usage":
		return loaded.usageEnvelope(selector)
	default:
		return Envelope{}, fmt.Errorf("atlas: unsupported resource %q", resource)
	}
}

func BuildEvidenceEnvelope(vaultRoot, stateRoot string, selector MachineSelector) (Envelope, error) {
	loaded, err := loadStore(vaultRoot, stateRoot)
	if err != nil {
		return Envelope{}, err
	}
	evidence := loaded.allEvidence()
	picked, err := resolveItem(selector, evidence, func(item evidenceProjection) string { return item.ID }, func(item evidenceProjection) string { return item.ID })
	if err != nil {
		return Envelope{}, err
	}
	taskRef := map[string]any{"id": picked.Task.ID, "name": picked.Task.Name}
	if picked.Task.LocalID != "" {
		taskRef["local_id"] = picked.Task.LocalID
	}
	verifier := map[string]any{"id": picked.VerifierID, "name": picked.VerifierName}
	if picked.VerifierLocalID != "" {
		verifier["local_id"] = picked.VerifierLocalID
	}
	data := map[string]any{
		"id":                  picked.ID,
		"task":                taskRef,
		"run":                 map[string]any{"id": picked.RunID, "name": picked.RunName},
		"verifier":            verifier,
		"attempt":             map[string]any{"id": picked.AttemptID, "outcome": picked.AttemptOutcome, "decision": picked.AttemptDecision},
		"command":             picked.Command,
		"implementation_tree": picked.ImplementationTree,
		"artifacts":           picked.Artifacts,
		"captured_at":         picked.CapturedAt,
	}
	if picked.ExitStatus != nil {
		data["exit_status"] = *picked.ExitStatus
	}
	return observedEnvelope("Evidence", data), nil
}

func CreateRunEnvelope(stateRoot string, raw []byte) (Envelope, error) {
	var request CreateRequest
	if err := decodeSingleJSONObject(raw, &request); err != nil {
		return Envelope{}, fmt.Errorf("atlas: %w", err)
	}
	if request.Run == nil || request.InitialDriver == nil {
		return Envelope{}, errors.New("atlas: run create requires run and initial_driver")
	}
	producer, err := vaultregistry.OpenProducer(stateRoot)
	if err != nil {
		return Envelope{}, err
	}
	created, err := producer.CreateRun(vaultregistry.CreateRequest{Run: *request.Run, InitialDriver: *request.InitialDriver})
	if err != nil {
		return Envelope{}, err
	}
	data := map[string]any{"id": created.RunID, "name": created.Name, "revision": created.Revision, "state": created.State}
	return Envelope{APIVersion: "atlas/v1", Kind: "Run", Data: data, Meta: map[string]any{"operation": "create"}}, nil
}

func decodeSingleJSONObject(raw []byte, destination any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func loadStore(vaultRoot, stateRoot string) (*store, error) {
	if vaultRoot == "" {
		var err error
		vaultRoot, err = ResolveVaultRoot()
		if err != nil {
			return nil, err
		}
	}
	if stateRoot == "" {
		var err error
		stateRoot, err = vaultregistry.ResolveRoot()
		if err != nil {
			return nil, err
		}
	}
	result := &store{vaultRoot: vaultRoot, stateRoot: stateRoot, runsByTask: map[string][]vaultregistry.Run{}}
	if err := result.loadNotes(); err != nil {
		return nil, err
	}
	if err := result.loadRuns(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *store) loadNotes() error {
	projects, err := filepath.Glob(filepath.Join(s.vaultRoot, "1_projects", "*", "README.md"))
	if err != nil {
		return err
	}
	sort.Strings(projects)
	for _, path := range projects {
		rel, err := filepath.Rel(s.vaultRoot, filepath.Dir(path))
		if err != nil {
			return err
		}
		note, err := readNote(path)
		if err != nil {
			return err
		}
		name := filepath.Base(rel)
		record := projectRecord{
			ID:               valueOr(note.Frontmatter["id"], "project-"+name),
			Name:             name,
			Description:      valueOr(note.Frontmatter["description"], note.Paragraph),
			Status:           valueOr(note.Frontmatter["status"], "active"),
			WorkingDirectory: note.Frontmatter["working_directory"],
			Repository:       note.Frontmatter["repository"],
			Path:             normalizePath(filepath.ToSlash(rel)),
		}
		if record.WorkingDirectory == "" {
			record.MissingMetadata = append(record.MissingMetadata, "working_directory")
		}
		if record.Repository == "" {
			record.MissingMetadata = append(record.MissingMetadata, "repository")
		}
		if len(record.MissingMetadata) != 0 {
			s.incompleteProjects = append(s.incompleteProjects, record)
			continue
		}
		s.projects = append(s.projects, record)
	}
	themes, err := filepath.Glob(filepath.Join(s.vaultRoot, "1_projects", "*", "themes", "*", "theme.md"))
	if err != nil {
		return err
	}
	sort.Strings(themes)
	for _, path := range themes {
		rel, err := filepath.Rel(s.vaultRoot, path)
		if err != nil {
			return err
		}
		normalized := normalizePath(filepath.ToSlash(rel))
		parts := strings.Split(normalized, "/")
		if !s.hasProjectPath(strings.Join(parts[:2], "/")) {
			continue
		}
		note, err := readNote(path)
		if err != nil {
			return err
		}
		name := parts[3]
		s.themes = append(s.themes, themeRecord{
			ID:          valueOr(note.Frontmatter["id"], "theme-"+name),
			Name:        name,
			Description: valueOr(note.Frontmatter["description"], note.Paragraph),
			Status:      valueOr(note.Frontmatter["status"], "active"),
			Path:        normalized,
			ProjectPath: strings.Join(parts[:2], "/"),
		})
	}
	features, err := filepath.Glob(filepath.Join(s.vaultRoot, "1_projects", "*", "themes", "*", "features", "*", "feature.md"))
	if err != nil {
		return err
	}
	sort.Strings(features)
	for _, path := range features {
		rel, err := filepath.Rel(s.vaultRoot, path)
		if err != nil {
			return err
		}
		normalized := normalizePath(filepath.ToSlash(rel))
		parts := strings.Split(normalized, "/")
		if !s.hasProjectPath(strings.Join(parts[:2], "/")) {
			continue
		}
		note, err := readNote(path)
		if err != nil {
			return err
		}
		name := parts[5]
		s.features = append(s.features, featureRecord{
			ID:          valueOr(note.Frontmatter["id"], "feature-"+name),
			Name:        name,
			Description: valueOr(note.Frontmatter["description"], note.Paragraph),
			Status:      valueOr(note.Frontmatter["status"], "active"),
			Path:        normalized,
			ProjectPath: strings.Join(parts[:2], "/"),
			ThemePath:   strings.Join(parts[:4], "/") + "/theme.md",
		})
	}
	tasks, err := filepath.Glob(filepath.Join(s.vaultRoot, "1_projects", "*", "themes", "*", "features", "*", "tasks", "*.md"))
	if err != nil {
		return err
	}
	sort.Strings(tasks)
	for _, path := range tasks {
		rel, err := filepath.Rel(s.vaultRoot, path)
		if err != nil {
			return err
		}
		normalized := normalizePath(filepath.ToSlash(rel))
		parts := strings.Split(normalized, "/")
		if !s.hasProjectPath(strings.Join(parts[:2], "/")) {
			continue
		}
		note, err := readNote(path)
		if err != nil {
			return err
		}
		localID, title := splitIdentity(note.Title)
		if localID == "" {
			localID = valueOr(note.Frontmatter["id"], strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
		}
		if title == "" {
			title = note.Title
		}
		taskID := atlasTaskID(localID, normalized)
		s.tasks = append(s.tasks, taskRecord{
			ID:          taskID,
			LocalID:     localID,
			Name:        title,
			Intent:      valueOr(note.Sections["intent"], note.Paragraph),
			Status:      valueOr(note.Frontmatter["status"], "pending"),
			Path:        normalized,
			ProjectPath: strings.Join(parts[:2], "/"),
			ThemePath:   strings.Join(parts[:4], "/") + "/theme.md",
			FeaturePath: strings.Join(parts[:6], "/") + "/feature.md",
			Verifiers:   parseVerifiers(note.Body, taskID),
		})
	}
	return nil
}

func (s *store) loadRuns() error {
	active, err := scanRuns(filepath.Join(s.stateRoot, "runs"))
	if err != nil {
		return err
	}
	retired, err := scanRuns(filepath.Join(s.stateRoot, "retired"))
	if err != nil {
		return err
	}
	s.activeRuns, s.retiredRuns = active, retired
	for _, run := range append(append([]vaultregistry.Run(nil), active...), retired...) {
		path := runTaskPath(run)
		if path != "" {
			s.runsByTask[path] = append(s.runsByTask[path], run)
		}
	}
	for path := range s.runsByTask {
		sort.SliceStable(s.runsByTask[path], func(i, j int) bool {
			if s.runsByTask[path][i].UpdatedAt != s.runsByTask[path][j].UpdatedAt {
				return s.runsByTask[path][i].UpdatedAt < s.runsByTask[path][j].UpdatedAt
			}
			return s.runsByTask[path][i].RunID < s.runsByTask[path][j].RunID
		})
	}
	return nil
}

func scanRuns(dir string) ([]vaultregistry.Run, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []vaultregistry.Run{}, nil
	}
	if err != nil {
		return nil, err
	}
	runs := make([]vaultregistry.Run, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		var run vaultregistry.Run
		if err := json.Unmarshal(data, &run); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	sort.SliceStable(runs, func(i, j int) bool { return runs[i].RunID < runs[j].RunID })
	return runs, nil
}

func readNote(path string) (note, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return note{}, err
	}
	return parseNote(string(data)), nil
}

func parseNote(data string) note {
	result := note{Frontmatter: map[string]string{}, Sections: map[string]string{}, Body: data}
	lines := strings.Split(data, "\n")
	start := 0
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
		for i := 1; i < len(lines); i++ {
			line := strings.TrimSpace(lines[i])
			if line == "---" {
				start = i + 1
				break
			}
			if key, value, ok := strings.Cut(line, ":"); ok {
				result.Frontmatter[strings.TrimSpace(strings.ToLower(key))] = strings.TrimSpace(value)
			}
		}
	}
	section := ""
	paragraphs := map[string][]string{}
	for i := start; i < len(lines); {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "# ") && result.Title == "" {
			result.Title = strings.TrimSpace(strings.TrimPrefix(line, "# "))
			i++
			continue
		}
		if strings.HasPrefix(line, "## ") {
			section = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(line, "## ")))
			i++
			continue
		}
		if line == "" || strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "```") || strings.HasPrefix(line, "|") {
			i++
			continue
		}
		var paragraph []string
		for i < len(lines) {
			current := strings.TrimSpace(lines[i])
			if current == "" || strings.HasPrefix(current, "## ") || strings.HasPrefix(current, "# ") || strings.HasPrefix(current, "- ") || strings.HasPrefix(current, "```") || strings.HasPrefix(current, "|") {
				break
			}
			paragraph = append(paragraph, current)
			i++
		}
		text := strings.TrimSpace(strings.Join(paragraph, " "))
		if text == "" {
			continue
		}
		paragraphs[section] = append(paragraphs[section], text)
		if result.Paragraph == "" {
			result.Paragraph = text
		}
		continue
	}
	for key, values := range paragraphs {
		if len(values) > 0 {
			result.Sections[key] = values[0]
		}
	}
	return result
}

func parseVerifiers(body, taskID string) []verifierDefinition {
	const itemPrefix = "- ["
	itemPattern := regexpMustCompile(`^\s*-\s*\[[ xX-]\]\s*\*\*(V[0-9]+)\s*[—-]\s*(.*?)\*\*`)
	commandPattern := regexpMustCompile(`\*\*Command:\*\*\s*(.+)$`)
	expectedPattern := regexpMustCompile(`\*\*Expected:\*\*\s*(.+)$`)
	var verifiers []verifierDefinition
	var current *verifierDefinition
	inSection := false
	scanner := bufio.NewScanner(strings.NewReader(body))
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			if strings.EqualFold(strings.TrimSpace(strings.TrimPrefix(trimmed, "## ")), "Verifiers") {
				inSection = true
				current = nil
				continue
			}
			if inSection {
				break
			}
		}
		if !inSection {
			continue
		}
		if strings.HasPrefix(trimmed, itemPrefix) {
			if match := itemPattern.FindStringSubmatch(trimmed); match != nil {
				localID := strings.ToUpper(match[1])
				verifiers = append(verifiers, verifierDefinition{ID: atlasVerifierID(taskID, localID), LocalID: localID, Name: strings.TrimSpace(match[2])})
				current = &verifiers[len(verifiers)-1]
				continue
			}
		}
		if current == nil {
			continue
		}
		if match := commandPattern.FindStringSubmatch(trimmed); match != nil {
			current.Command = strings.TrimSpace(match[1])
		}
		if match := expectedPattern.FindStringSubmatch(trimmed); match != nil {
			current.Expected = strings.TrimSpace(match[1])
		}
	}
	return verifiers
}

func (s *store) projectsEnvelope(selector MachineSelector) (Envelope, error) {
	if selector.any() == "" {
		data := make([]map[string]any, 0, len(s.projects))
		for _, project := range s.projects {
			data = append(data, s.projectObject(project))
		}
		return listEnvelope("ProjectList", data), nil
	}
	project, err := resolveItem(selector, s.projects, func(item projectRecord) string { return item.ID }, func(item projectRecord) string { return item.Name })
	if err == nil {
		return observedEnvelope("Project", s.projectObject(project)), nil
	}
	incomplete, incompleteErr := resolveItem(selector, s.incompleteProjects, func(item projectRecord) string { return item.ID }, func(item projectRecord) string { return item.Name })
	if incompleteErr == nil {
		return Envelope{}, incomplete.metadataError()
	}
	return Envelope{}, err
}

func (s *store) themesEnvelope(selector MachineSelector) (Envelope, error) {
	if selector.any() == "" {
		data := make([]map[string]any, 0, len(s.themes))
		for _, theme := range s.themes {
			data = append(data, s.themeObject(theme))
		}
		return listEnvelope("ThemeList", data), nil
	}
	theme, err := resolveItem(selector, s.themes, func(item themeRecord) string { return item.ID }, func(item themeRecord) string { return item.Name })
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("Theme", s.themeObject(theme)), nil
}

func (s *store) featuresEnvelope(selector MachineSelector) (Envelope, error) {
	if selector.any() == "" {
		data := make([]map[string]any, 0, len(s.features))
		for _, feature := range s.features {
			data = append(data, s.featureObject(feature))
		}
		return listEnvelope("FeatureList", data), nil
	}
	feature, err := resolveItem(selector, s.features, func(item featureRecord) string { return item.ID }, func(item featureRecord) string { return item.Name })
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("Feature", s.featureObject(feature)), nil
}

func (s *store) tasksEnvelope(selector MachineSelector) (Envelope, error) {
	if selector.any() == "" {
		data := make([]map[string]any, 0, len(s.tasks))
		for _, task := range s.tasks {
			data = append(data, s.taskObject(task))
		}
		return listEnvelope("TaskList", data), nil
	}
	task, err := resolveItem(selector, s.tasks, func(item taskRecord) string { return item.ID }, func(item taskRecord) string { return item.Name })
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("Task", s.taskObject(task)), nil
}

func (s *store) runsEnvelope(selector MachineSelector) (Envelope, error) {
	if selector.any() == "" {
		data := make([]map[string]any, 0, len(s.activeRuns))
		for _, run := range s.activeRuns {
			data = append(data, s.runSummaryObject(run))
		}
		return boundedListEnvelope("RunList", data), nil
	}
	run, err := s.resolveRun(selector)
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("Run", s.runObject(run)), nil
}

func (s *store) verifiersEnvelope(selector MachineSelector) (Envelope, error) {
	verifiers := s.allVerifiers()
	if selector.any() == "" {
		data := make([]map[string]any, 0, len(verifiers))
		for _, verifier := range verifiers {
			data = append(data, verifier)
		}
		return boundedListEnvelope("VerifierList", data), nil
	}
	picked, err := resolveMapItem(selector, verifiers, "id", "name")
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("Verifier", picked), nil
}

func (s *store) verifierAttemptsEnvelope(selector MachineSelector, options MachineGetOptions) (Envelope, error) {
	attempts := s.allAttempts()
	if options.Run != "" {
		runs := append(append([]vaultregistry.Run(nil), s.activeRuns...), s.retiredRuns...)
		run, err := resolveItem(MachineSelector{Positional: options.Run}, runs, func(item vaultregistry.Run) string { return item.RunID }, func(item vaultregistry.Run) string { return runName(item) })
		if err != nil {
			return Envelope{}, err
		}
		filtered := attempts[:0]
		for _, attempt := range attempts {
			if attempt.RunID == run.RunID && (!options.Pending || attempt.Decision == "pending") {
				filtered = append(filtered, attempt)
			}
		}
		attempts = filtered
	}
	if selector.any() == "" {
		data := make([]map[string]any, 0, len(attempts))
		for _, attempt := range attempts {
			data = append(data, attemptObject(attempt))
		}
		return boundedListEnvelope("VerifierAttemptList", data), nil
	}
	picked, err := resolveItem(selector, attempts, func(item attemptProjection) string { return item.ID }, func(item attemptProjection) string { return item.ID })
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("VerifierAttempt", attemptObject(picked)), nil
}

func (s *store) participantsEnvelope(selector MachineSelector) (Envelope, error) {
	if selector.any() == "" {
		participants := s.allParticipants(s.activeRuns)
		data := make([]map[string]any, 0, len(participants))
		for _, participant := range participants {
			data = append(data, participantObject(participant))
		}
		return boundedListEnvelope("ParticipantList", data), nil
	}
	participants := s.allParticipants(append(append([]vaultregistry.Run(nil), s.activeRuns...), s.retiredRuns...))
	picked, err := resolveItem(selector, participants, func(item participantProjection) string { return item.ID }, func(item participantProjection) string { return item.Name })
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("Participant", participantObject(picked)), nil
}

func (s *store) usageEnvelope(selector MachineSelector) (Envelope, error) {
	if selector.any() == "" {
		usage := s.allUsage(s.activeRuns)
		data := make([]map[string]any, 0, len(usage))
		for _, item := range usage {
			data = append(data, usageObject(item))
		}
		return boundedListEnvelope("UsageList", data), nil
	}
	usage := s.allUsage(append(append([]vaultregistry.Run(nil), s.activeRuns...), s.retiredRuns...))
	picked, err := resolveItem(selector, usage, func(item usageProjection) string { return item.RunID }, func(item usageProjection) string { return item.RunName })
	if err != nil {
		return Envelope{}, err
	}
	return observedEnvelope("Usage", usageObject(picked)), nil
}

func (s *store) projectObject(project projectRecord) map[string]any {
	themes := make([]map[string]any, 0)
	for _, theme := range s.themes {
		if theme.ProjectPath == project.Path {
			themes = append(themes, map[string]any{"id": theme.ID, "name": theme.Name, "description": theme.Description, "status": theme.Status})
		}
	}
	return map[string]any{
		"id":                project.ID,
		"name":              project.Name,
		"description":       project.Description,
		"status":            project.Status,
		"working_directory": project.WorkingDirectory,
		"repository":        project.Repository,
		"themes":            themes,
	}
}

func (s *store) themeObject(theme themeRecord) map[string]any {
	project := s.projectByPath(theme.ProjectPath)
	features := make([]map[string]any, 0)
	for _, feature := range s.features {
		if feature.ThemePath == theme.Path {
			features = append(features, map[string]any{"id": feature.ID, "name": feature.Name, "description": feature.Description, "status": feature.Status})
		}
	}
	return map[string]any{
		"id":          theme.ID,
		"name":        theme.Name,
		"description": theme.Description,
		"status":      theme.Status,
		"project":     map[string]any{"id": project.ID, "name": project.Name},
		"features":    features,
	}
}

func (s *store) featureObject(feature featureRecord) map[string]any {
	project := s.projectByPath(feature.ProjectPath)
	theme := s.themeByPath(feature.ThemePath)
	tasks := make([]map[string]any, 0)
	for _, task := range s.tasks {
		if task.FeaturePath == feature.Path {
			entry := map[string]any{"id": task.ID, "name": task.Name, "status": task.Status}
			if task.LocalID != "" {
				entry["local_id"] = task.LocalID
			}
			tasks = append(tasks, entry)
		}
	}
	return map[string]any{
		"id":          feature.ID,
		"name":        feature.Name,
		"description": feature.Description,
		"status":      feature.Status,
		"project":     map[string]any{"id": project.ID, "name": project.Name},
		"theme": map[string]any{
			"id":          theme.ID,
			"name":        theme.Name,
			"description": theme.Description,
			"status":      theme.Status,
		},
		"tasks": tasks,
	}
}

func (s *store) taskObject(task taskRecord) map[string]any {
	project := s.projectByPath(task.ProjectPath)
	theme := s.themeByPath(task.ThemePath)
	feature := s.featureByPath(task.FeaturePath)
	taskRuns := append([]vaultregistry.Run(nil), s.runsByTask[task.Path]...)
	verifiers := make([]map[string]any, 0, len(task.Verifiers))
	for _, def := range task.Verifiers {
		attempts := s.taskVerifierAttempts(task, def.ID)
		verifier := map[string]any{
			"id":         def.ID,
			"name":       def.Name,
			"definition": map[string]any{"command": def.Command, "expected": def.Expected},
			"status":     verifierStatus(attempts),
		}
		if def.LocalID != "" {
			verifier["local_id"] = def.LocalID
		}
		if accepted := acceptedAttempt(attempts); accepted != nil {
			verifier["accepted_attempt"] = map[string]any{
				"id":           accepted.ID,
				"run_id":       accepted.RunID,
				"outcome":      accepted.Outcome,
				"decision":     accepted.Decision,
				"evidence_ids": []string{accepted.Evidence.ID},
			}
		}
		verifiers = append(verifiers, verifier)
	}
	evidence := make([]map[string]any, 0)
	for _, attempt := range s.taskAttempts(task) {
		entry := map[string]any{
			"id":                  attempt.Evidence.ID,
			"verifier_id":         attempt.Verifier.ID,
			"attempt_id":          attempt.ID,
			"run_id":              attempt.RunID,
			"command":             attempt.Evidence.Command,
			"implementation_tree": attempt.Evidence.ImplementationTree,
			"artifacts":           attempt.Evidence.Artifacts,
		}
		if attempt.Verifier.LocalID != "" {
			entry["verifier_local_id"] = attempt.Verifier.LocalID
		}
		if attempt.Evidence.ExitStatus != nil {
			entry["exit_status"] = *attempt.Evidence.ExitStatus
		}
		evidence = append(evidence, entry)
	}
	runs := make([]map[string]any, 0, len(taskRuns))
	for _, run := range taskRuns {
		runs = append(runs, map[string]any{
			"id":                   run.RunID,
			"name":                 runName(run),
			"state":                runState(run),
			"verifier_attempt_ids": attemptIDsForRun(s.taskAttempts(task), run.RunID),
			"evidence_ids":         evidenceIDsForRun(s.taskAttempts(task), run.RunID),
		})
	}
	data := map[string]any{
		"id":        task.ID,
		"name":      task.Name,
		"intent":    task.Intent,
		"status":    task.Status,
		"project":   map[string]any{"id": project.ID, "name": project.Name},
		"theme":     map[string]any{"id": theme.ID, "name": theme.Name, "status": theme.Status},
		"feature":   map[string]any{"id": feature.ID, "name": feature.Name, "status": feature.Status},
		"verifiers": verifiers,
		"evidence":  evidence,
		"runs":      runs,
	}
	if task.LocalID != "" {
		data["local_id"] = task.LocalID
	}
	return data
}

func (s *store) runSummaryObject(run vaultregistry.Run) map[string]any {
	project, theme, feature, task := s.runContext(run)
	verifierCounts := s.runVerifierCounts(run, task)
	activeParticipants, totalParticipants := participantCounts(run)
	return map[string]any{
		"id":           run.RunID,
		"name":         runName(run),
		"revision":     run.Revision,
		"state":        runState(run),
		"stage":        runStage(run),
		"project":      project,
		"theme":        theme,
		"feature":      feature,
		"task":         task,
		"participants": map[string]any{"active": activeParticipants, "total": totalParticipants},
		"verifiers":    verifierCounts,
		"started_at":   run.InvokedAt,
		"updated_at":   run.UpdatedAt,
	}
}

func (s *store) runObject(run vaultregistry.Run) map[string]any {
	project, theme, feature, task := s.runContext(run)
	attempts := s.runAttempts(run)
	items := make([]map[string]any, 0, len(attempts))
	for _, attempt := range attempts {
		verifier := map[string]any{"id": attempt.Verifier.ID, "name": attempt.Verifier.Name, "definition": map[string]any{"command": attempt.Verifier.Command, "expected": attempt.Verifier.Expected}}
		if attempt.Verifier.LocalID != "" {
			verifier["local_id"] = attempt.Verifier.LocalID
		}
		item := map[string]any{
			"id":       attempt.ID,
			"verifier": verifier,
			"outcome":  attempt.Outcome,
			"decision": attempt.Decision,
			"evidence": map[string]any{
				"id":                  attempt.Evidence.ID,
				"command":             attempt.Evidence.Command,
				"implementation_tree": attempt.Evidence.ImplementationTree,
				"artifacts":           attempt.Evidence.Artifacts,
			},
		}
		if attempt.Evidence.ExitStatus != nil {
			item["evidence"].(map[string]any)["exit_status"] = *attempt.Evidence.ExitStatus
		}
		items = append(items, item)
	}
	return map[string]any{
		"id":                run.RunID,
		"name":              runName(run),
		"revision":          run.Revision,
		"state":             runState(run),
		"stage":             runStage(run),
		"project":           project,
		"theme":             theme,
		"feature":           feature,
		"task":              task,
		"verifier_attempts": items,
		"started_at":        run.InvokedAt,
		"updated_at":        run.UpdatedAt,
	}
}

func (s *store) runContext(run vaultregistry.Run) (map[string]any, map[string]any, map[string]any, map[string]any) {
	path := runTaskPath(run)
	featurePath := runFeaturePath(run)
	var task taskRecord
	for _, candidate := range s.tasks {
		if candidate.Path == path {
			task = candidate
			featurePath = candidate.FeaturePath
			break
		}
	}
	feature := s.featureByPath(featurePath)
	theme := s.themeByPath(feature.ThemePath)
	project := s.projectByPath(feature.ProjectPath)
	projectObj := map[string]any{"id": project.ID, "name": project.Name}
	themeObj := map[string]any{"id": theme.ID, "name": theme.Name}
	featureObj := map[string]any{"id": feature.ID, "name": feature.Name}
	taskObj := map[string]any{"id": task.ID, "name": task.Name, "status": task.Status}
	if task.LocalID != "" {
		taskObj["local_id"] = task.LocalID
	}
	if task.ID == "" {
		identity := runTaskIdentity(run)
		taskObj = map[string]any{"id": identity.ID, "name": identity.Name}
		if identity.LocalID != "" {
			taskObj["local_id"] = identity.LocalID
		}
	}
	return projectObj, themeObj, featureObj, taskObj
}

func (s *store) runVerifierCounts(run vaultregistry.Run, task map[string]any) map[string]any {
	id, _ := task["id"].(string)
	var record taskRecord
	for _, candidate := range s.tasks {
		if candidate.ID == id {
			record = candidate
			break
		}
	}
	passed, pending, failed := 0, 0, 0
	for _, def := range record.Verifiers {
		attempts := filterAttemptsByRun(s.taskVerifierAttempts(record, def.ID), run.RunID)
		switch verifierStatus(attempts) {
		case "passed":
			passed++
		case "failed":
			failed++
		default:
			pending++
		}
	}
	return map[string]any{"passed": passed, "pending": pending, "failed": failed}
}

func participantCounts(run vaultregistry.Run) (int, int) {
	if run.SchemaVersion == 1 {
		return len(run.Participants), len(run.Participants)
	}
	seen := map[string]string{}
	for _, observation := range run.Observations {
		if observation.Kind != vaultregistry.KindRegisteredParticipant || observation.Payload.RegisteredParticipant == nil {
			continue
		}
		seen[observation.Payload.RegisteredParticipant.ParticipantID] = string(observation.State)
	}
	active := 0
	for _, state := range seen {
		if state == string(vaultregistry.StateActive) {
			active++
		}
	}
	return active, len(seen)
}

func (s *store) allVerifiers() []map[string]any {
	items := make([]map[string]any, 0)
	for _, task := range s.tasks {
		for _, def := range task.Verifiers {
			attempts := s.taskVerifierAttempts(task, def.ID)
			taskRef := map[string]any{"id": task.ID, "name": task.Name}
			if task.LocalID != "" {
				taskRef["local_id"] = task.LocalID
			}
			item := map[string]any{
				"id":         def.ID,
				"name":       def.Name,
				"status":     verifierStatus(attempts),
				"task":       taskRef,
				"definition": map[string]any{"command": def.Command, "expected": def.Expected},
			}
			if def.LocalID != "" {
				item["local_id"] = def.LocalID
			}
			rows := make([]map[string]any, 0, len(attempts))
			for _, attempt := range attempts {
				evidence := map[string]any{"id": attempt.Evidence.ID, "implementation_tree": attempt.Evidence.ImplementationTree, "artifacts": attempt.Evidence.Artifacts}
				if attempt.Verifier.LocalID != "" {
					evidence["verifier_local_id"] = attempt.Verifier.LocalID
				}
				entry := map[string]any{
					"id":           attempt.ID,
					"run":          map[string]any{"id": attempt.RunID, "name": attempt.RunName},
					"outcome":      attempt.Outcome,
					"decision":     attempt.Decision,
					"evidence":     evidence,
					"attempted_at": attempt.AttemptedAt,
				}
				if attempt.Evidence.ExitStatus != nil {
					entry["evidence"].(map[string]any)["exit_status"] = *attempt.Evidence.ExitStatus
				}
				rows = append(rows, entry)
			}
			item["attempts"] = rows
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i]["id"].(string) != items[j]["id"].(string) {
			return items[i]["id"].(string) < items[j]["id"].(string)
		}
		return items[i]["name"].(string) < items[j]["name"].(string)
	})
	return items
}

func (s *store) taskVerifierAttempts(task taskRecord, verifierID string) []attemptProjection {
	var attempts []attemptProjection
	for _, attempt := range s.taskAttempts(task) {
		if attempt.Verifier.ID == verifierID {
			attempts = append(attempts, attempt)
		}
	}
	sort.SliceStable(attempts, func(i, j int) bool {
		if attempts[i].AttemptedAt != attempts[j].AttemptedAt {
			return attempts[i].AttemptedAt < attempts[j].AttemptedAt
		}
		return attempts[i].ID < attempts[j].ID
	})
	return attempts
}

func (s *store) taskAttempts(task taskRecord) []attemptProjection {
	var attempts []attemptProjection
	for _, run := range s.runsByTask[task.Path] {
		attempts = append(attempts, s.runAttempts(run)...)
	}
	sort.SliceStable(attempts, func(i, j int) bool {
		if attempts[i].AttemptedAt != attempts[j].AttemptedAt {
			return attempts[i].AttemptedAt < attempts[j].AttemptedAt
		}
		return attempts[i].ID < attempts[j].ID
	})
	return attempts
}

func (s *store) runAttempts(run vaultregistry.Run) []attemptProjection {
	if run.SchemaVersion != 2 {
		return nil
	}
	definitions := map[string]verifierDefinition{}
	if path := runTaskPath(run); path != "" {
		for _, task := range s.tasks {
			if task.Path == path {
				for _, verifier := range task.Verifiers {
					key := verifier.LocalID
					if key == "" {
						key = verifier.ID
					}
					definitions[key] = verifier
				}
				break
			}
		}
	}
	builders := map[string]*attemptProjection{}
	for _, observation := range run.Observations {
		identity := attemptIdentity(observation)
		if identity == nil {
			if observation.Kind == vaultregistry.KindVerifierDecision && observation.Payload.VerifierDecision != nil {
				builder := builders[observation.Payload.VerifierDecision.AttemptID]
				if builder == nil {
					continue
				}
				builder.Decision = string(observation.State)
				builder.Revision++
				if builder.Reason == "" {
					builder.Reason = observation.Summary
				}
			}
			continue
		}
		builder := builders[identity.AttemptID]
		if builder == nil {
			builder = &attemptProjection{
				ID:       identity.AttemptID,
				Revision: 1,
				Decision: "pending",
				RunID:    run.RunID,
				RunName:  runName(run),
				Task:     runTaskIdentity(run),
				Verifier: definitions[identity.VerifierID],
			}
			if builder.Verifier.ID == "" {
				builder.Verifier = verifierDefinition{ID: atlasVerifierID(builder.Task.ID, identity.VerifierID), LocalID: strings.ToUpper(identity.VerifierID), Name: identity.VerifierID, Command: identity.Command}
			}
			builders[identity.AttemptID] = builder
		}
		builder.Evidence = deriveEvidence(s.stateRoot, run, observation, builder.Verifier)
		switch observation.Kind {
		case vaultregistry.KindVerifierAttempt:
			builder.Outcome = string(observation.State)
			builder.AttemptedAt = valueOr(valueAt(observation.FinishedAt), observation.ObservedAt)
		case vaultregistry.KindVerifierAttemptGap:
			builder.Outcome = string(observation.State)
			builder.AttemptedAt = observation.ObservedAt
		}
	}
	attempts := make([]attemptProjection, 0, len(builders))
	for _, builder := range builders {
		attempts = append(attempts, *builder)
	}
	sort.SliceStable(attempts, func(i, j int) bool {
		if attempts[i].AttemptedAt != attempts[j].AttemptedAt {
			return attempts[i].AttemptedAt < attempts[j].AttemptedAt
		}
		return attempts[i].ID < attempts[j].ID
	})
	return attempts
}

func attemptIdentity(observation vaultregistry.Observation) *vaultregistry.VerifierAttemptIdentity {
	if observation.Kind == vaultregistry.KindVerifierAttempt && observation.Payload.VerifierAttempt != nil {
		return &observation.Payload.VerifierAttempt.Identity
	}
	if observation.Kind == vaultregistry.KindVerifierAttemptGap && observation.Payload.VerifierAttemptGap != nil {
		return &observation.Payload.VerifierAttemptGap.Identity
	}
	return nil
}

func deriveEvidence(stateRoot string, run vaultregistry.Run, observation vaultregistry.Observation, verifier verifierDefinition) evidenceProjection {
	identity := attemptIdentity(observation)
	projection := evidenceProjection{
		ID:                 evidenceID(identity.AttemptID),
		Task:               runTaskIdentity(run),
		RunID:              run.RunID,
		RunName:            runName(run),
		VerifierID:         verifier.ID,
		VerifierLocalID:    verifier.LocalID,
		VerifierName:       verifier.Name,
		AttemptID:          identity.AttemptID,
		Command:            identity.Command,
		ImplementationTree: identity.ImplementationTree,
		CapturedAt:         valueOr(valueAt(observation.FinishedAt), observation.ObservedAt),
	}
	switch observation.Kind {
	case vaultregistry.KindVerifierAttempt:
		if observation.Payload.VerifierAttempt != nil {
			projection.ExitStatus = observation.Payload.VerifierAttempt.ExitStatus
			projection.Artifacts = loadArtifacts(stateRoot, observation.Payload.VerifierAttempt.ResultManifest, observation.Payload.VerifierAttempt.PartialResultManifest)
		}
	case vaultregistry.KindVerifierAttemptGap:
		if observation.Payload.VerifierAttemptGap != nil {
			projection.Artifacts = nil
		}
	}
	projection.AttemptOutcome = string(observation.State)
	projection.AttemptDecision = "pending"
	return projection
}

func loadArtifacts(stateRoot string, manifests ...*vaultregistry.ManifestMetadata) []map[string]any {
	for _, manifest := range manifests {
		if manifest == nil || manifest.Path == "" {
			continue
		}
		path := manifest.Path
		if !filepath.IsAbs(path) {
			path = filepath.Join(stateRoot, filepath.FromSlash(path))
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var decoded struct {
			Artifacts []map[string]any `json:"artifacts"`
		}
		if json.Unmarshal(data, &decoded) == nil {
			return decoded.Artifacts
		}
	}
	return nil
}

func evidenceID(attemptID string) string {
	if strings.HasPrefix(attemptID, "attempt-") {
		return "evidence-" + strings.TrimPrefix(attemptID, "attempt-")
	}
	return "evidence-" + attemptID
}

func (s *store) allAttempts() []attemptProjection {
	var attempts []attemptProjection
	for _, run := range append(append([]vaultregistry.Run(nil), s.activeRuns...), s.retiredRuns...) {
		attempts = append(attempts, s.runAttempts(run)...)
	}
	sort.SliceStable(attempts, func(i, j int) bool {
		if attempts[i].AttemptedAt != attempts[j].AttemptedAt {
			return attempts[i].AttemptedAt < attempts[j].AttemptedAt
		}
		return attempts[i].ID < attempts[j].ID
	})
	return attempts
}

func attemptObject(attempt attemptProjection) map[string]any {
	taskRef := map[string]any{"id": attempt.Task.ID, "name": attempt.Task.Name}
	if attempt.Task.LocalID != "" {
		taskRef["local_id"] = attempt.Task.LocalID
	}
	verifier := map[string]any{"id": attempt.Verifier.ID, "name": attempt.Verifier.Name, "definition": map[string]any{"command": attempt.Verifier.Command, "expected": attempt.Verifier.Expected}}
	if attempt.Verifier.LocalID != "" {
		verifier["local_id"] = attempt.Verifier.LocalID
	}
	data := map[string]any{
		"id":           attempt.ID,
		"revision":     attempt.Revision,
		"outcome":      attempt.Outcome,
		"decision":     attempt.Decision,
		"run":          map[string]any{"id": attempt.RunID, "name": attempt.RunName},
		"task":         taskRef,
		"verifier":     verifier,
		"evidence":     map[string]any{"id": attempt.Evidence.ID, "command": attempt.Evidence.Command, "implementation_tree": attempt.Evidence.ImplementationTree, "artifacts": attempt.Evidence.Artifacts},
		"attempted_at": attempt.AttemptedAt,
	}
	if attempt.Evidence.ExitStatus != nil {
		data["evidence"].(map[string]any)["exit_status"] = *attempt.Evidence.ExitStatus
	}
	if attempt.Reason != "" && attempt.Decision == "rejected" {
		data["reason"] = attempt.Reason
	}
	return data
}

func (s *store) allEvidence() []evidenceProjection {
	attempts := s.allAttempts()
	evidence := make([]evidenceProjection, 0, len(attempts))
	for _, attempt := range attempts {
		entry := attempt.Evidence
		entry.AttemptOutcome = attempt.Outcome
		entry.AttemptDecision = attempt.Decision
		evidence = append(evidence, entry)
	}
	sort.SliceStable(evidence, func(i, j int) bool {
		if evidence[i].CapturedAt != evidence[j].CapturedAt {
			return evidence[i].CapturedAt < evidence[j].CapturedAt
		}
		return evidence[i].ID < evidence[j].ID
	})
	return evidence
}

func (s *store) allParticipants(runs []vaultregistry.Run) []participantProjection {
	var participants []participantProjection
	for _, run := range runs {
		participants = append(participants, participantsForRun(run)...)
	}
	sort.SliceStable(participants, func(i, j int) bool {
		if participants[i].StartedAt != participants[j].StartedAt {
			return participants[i].StartedAt < participants[j].StartedAt
		}
		return participants[i].ID < participants[j].ID
	})
	return participants
}

func participantsForRun(run vaultregistry.Run) []participantProjection {
	if run.SchemaVersion != 2 {
		return nil
	}
	type builder struct {
		participantProjection
		telemetry []vaultregistry.RuntimeTelemetryPayload
	}
	builders := map[string]*builder{}
	for _, observation := range run.Observations {
		switch observation.Kind {
		case vaultregistry.KindRegisteredParticipant:
			payload := observation.Payload.RegisteredParticipant
			if payload == nil {
				continue
			}
			item := builders[payload.ParticipantID]
			if item == nil {
				item = &builder{participantProjection: participantProjection{ID: payload.ParticipantID, Name: payload.ParticipantID, Role: payload.Role, RunID: run.RunID, RunName: runName(run), StartedAt: valueOr(valueAt(observation.StartedAt), observation.ObservedAt)}}
				builders[payload.ParticipantID] = item
			}
			item.State = string(observation.State)
			item.Runtime = runtimeName(payload.AgentSession.Source)
			item.SessionID = payload.AgentSession.Value
			item.UpdatedAt = observation.ObservedAt
		case vaultregistry.KindRuntimeTelemetry:
			payload := observation.Payload.RuntimeTelemetry
			if payload == nil {
				continue
			}
			item := builders[payload.ParticipantID]
			if item == nil {
				continue
			}
			item.telemetry = append(item.telemetry, *payload)
			item.UpdatedAt = observation.ObservedAt
		}
	}
	result := make([]participantProjection, 0, len(builders))
	for _, item := range builders {
		usage := normalizeTelemetry(item.Runtime, item.telemetry)
		item.Usage = map[string]any{
			"input_tokens":        usage.InputTokens,
			"cached_input_tokens": usage.CachedInputTokens,
			"output_tokens":       usage.OutputTokens,
			"total_tokens":        usage.TotalTokens,
		}
		result = append(result, item.participantProjection)
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func runtimeName(source string) string {
	lower := strings.ToLower(source)
	switch {
	case strings.Contains(lower, "codex"):
		return "codex"
	case strings.Contains(lower, "pi"):
		return "pi"
	default:
		return lower
	}
}

func normalizeTelemetry(runtime string, telemetry []vaultregistry.RuntimeTelemetryPayload) usageCounters {
	var latest *vaultregistry.UsageCounters
	var sum vaultregistry.UsageCounters
	for i := range telemetry {
		usage := telemetry[i].Usage
		if usage == nil {
			continue
		}
		if usage.Scope == vaultregistry.UsageCumulative {
			latest = usage
			continue
		}
		sumUsage(&sum, usage)
	}
	selected := &sum
	if latest != nil {
		selected = latest
	}
	input := value64(selected.InputTokens)
	cachedRead := value64(selected.CacheReadTokens)
	cacheWrite := value64(selected.CacheWriteTokens)
	output := value64(selected.OutputTokens)
	normalizedInput := input
	if runtime == "pi" {
		normalizedInput = input + cachedRead + cacheWrite
	}
	return usageCounters{
		InputTokens:       normalizedInput,
		CachedInputTokens: cachedRead,
		OutputTokens:      output,
		TotalTokens:       normalizedInput + output,
	}
}

func sumUsage(sum *vaultregistry.UsageCounters, usage *vaultregistry.UsageCounters) {
	if usage.InputTokens != nil {
		if sum.InputTokens == nil {
			sum.InputTokens = new(int64)
		}
		*sum.InputTokens += *usage.InputTokens
	}
	if usage.CacheReadTokens != nil {
		if sum.CacheReadTokens == nil {
			sum.CacheReadTokens = new(int64)
		}
		*sum.CacheReadTokens += *usage.CacheReadTokens
	}
	if usage.CacheWriteTokens != nil {
		if sum.CacheWriteTokens == nil {
			sum.CacheWriteTokens = new(int64)
		}
		*sum.CacheWriteTokens += *usage.CacheWriteTokens
	}
	if usage.OutputTokens != nil {
		if sum.OutputTokens == nil {
			sum.OutputTokens = new(int64)
		}
		*sum.OutputTokens += *usage.OutputTokens
	}
}

func value64(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func participantObject(participant participantProjection) map[string]any {
	return map[string]any{
		"id":         participant.ID,
		"name":       participant.Name,
		"role":       participant.Role,
		"state":      participant.State,
		"runtime":    participant.Runtime,
		"session_id": participant.SessionID,
		"run":        map[string]any{"id": participant.RunID, "name": participant.RunName},
		"usage":      participant.Usage,
		"started_at": participant.StartedAt,
		"updated_at": participant.UpdatedAt,
	}
}

func (s *store) allUsage(runs []vaultregistry.Run) []usageProjection {
	var usage []usageProjection
	for _, run := range runs {
		participants := participantsForRun(run)
		item := usageProjection{RunID: run.RunID, RunName: runName(run), ObservedAt: run.UpdatedAt}
		for _, participant := range participants {
			input := int64(participant.Usage["input_tokens"].(int64))
			cached := int64(participant.Usage["cached_input_tokens"].(int64))
			output := int64(participant.Usage["output_tokens"].(int64))
			total := int64(participant.Usage["total_tokens"].(int64))
			item.Input += input
			item.Cached += cached
			item.Output += output
			item.Total += total
			item.Parts = append(item.Parts, map[string]any{
				"id":                  participant.ID,
				"name":                participant.Name,
				"role":                participant.Role,
				"input_tokens":        input,
				"cached_input_tokens": cached,
				"output_tokens":       output,
				"total_tokens":        total,
			})
		}
		usage = append(usage, item)
	}
	sort.SliceStable(usage, func(i, j int) bool { return usage[i].RunID < usage[j].RunID })
	return usage
}

func usageObject(usage usageProjection) map[string]any {
	return map[string]any{
		"run":                 map[string]any{"id": usage.RunID, "name": usage.RunName},
		"input_tokens":        usage.Input,
		"cached_input_tokens": usage.Cached,
		"output_tokens":       usage.Output,
		"total_tokens":        usage.Total,
		"participants":        usage.Parts,
	}
}

func resolveItem[T any](selector MachineSelector, items []T, id func(T) string, name func(T) string) (T, error) {
	var zero T
	if selector.ID != "" {
		matches := filterItems(items, func(item T) bool { return id(item) == selector.ID })
		if len(matches) == 0 {
			return zero, fmt.Errorf("%w: %s", vaultregistry.ErrNotFound, selector.ID)
		}
		if len(matches) != 1 {
			return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.ID)
		}
		return matches[0], nil
	}
	if selector.Name != "" {
		matches := filterItems(items, func(item T) bool { return name(item) == selector.Name })
		if len(matches) == 0 {
			return zero, fmt.Errorf("%w: %s", vaultregistry.ErrNotFound, selector.Name)
		}
		if len(matches) != 1 {
			return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.Name)
		}
		return matches[0], nil
	}
	if selector.Positional == "" {
		return zero, fmt.Errorf("%w: selector is required", vaultregistry.ErrNotFound)
	}
	idMatches := filterItems(items, func(item T) bool { return id(item) == selector.Positional })
	nameMatches := filterItems(items, func(item T) bool { return name(item) == selector.Positional })
	if len(idMatches) == 0 && len(nameMatches) == 0 {
		return zero, fmt.Errorf("%w: %s", vaultregistry.ErrNotFound, selector.Positional)
	}
	if len(idMatches) > 1 || len(nameMatches) > 1 {
		return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.Positional)
	}
	if len(idMatches) == 1 && len(nameMatches) == 1 && id(idMatches[0]) != id(nameMatches[0]) {
		return zero, fmt.Errorf("%w: %q", vaultregistry.ErrAmbiguous, selector.Positional)
	}
	if len(idMatches) == 1 {
		return idMatches[0], nil
	}
	return nameMatches[0], nil
}

func resolveMapItem(selector MachineSelector, items []map[string]any, idKey, nameKey string) (map[string]any, error) {
	return resolveItem(selector, items,
		func(item map[string]any) string { return stringValue(item[idKey]) },
		func(item map[string]any) string { return stringValue(item[nameKey]) },
	)
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func filterItems[T any](items []T, include func(T) bool) []T {
	matches := make([]T, 0, 2)
	for _, item := range items {
		if include(item) {
			matches = append(matches, item)
		}
	}
	return matches
}

func observedEnvelope(kind string, data any) Envelope {
	return Envelope{APIVersion: "atlas/v1", Kind: kind, Data: data, Meta: map[string]any{"observed_at": time.Now().UTC().Format(time.RFC3339)}}
}

func listEnvelope(kind string, data []map[string]any) Envelope {
	return Envelope{APIVersion: "atlas/v1", Kind: kind, Data: data, Meta: map[string]any{"count": len(data), "truncated": false, "observed_at": time.Now().UTC().Format(time.RFC3339)}}
}

func boundedListEnvelope(kind string, data []map[string]any) Envelope {
	limit := defaultCollectionByteLimit
	if raw := os.Getenv("ATLAS_MAX_COLLECTION_BYTES"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	bounded := make([]map[string]any, 0, len(data))
	truncated := false
	for _, item := range data {
		candidate := append(append([]map[string]any(nil), bounded...), item)
		envelope := Envelope{APIVersion: "atlas/v1", Kind: kind, Data: candidate, Meta: map[string]any{"count": len(candidate), "truncated": false}}
		encoded, _ := json.Marshal(envelope)
		if len(encoded) > limit {
			truncated = true
			break
		}
		bounded = candidate
	}
	return Envelope{APIVersion: "atlas/v1", Kind: kind, Data: bounded, Meta: map[string]any{"count": len(bounded), "truncated": truncated, "observed_at": time.Now().UTC().Format(time.RFC3339)}}
}

func runTaskPath(run vaultregistry.Run) string {
	if run.WorkReference != nil {
		return normalizePath(run.WorkReference.Path)
	}
	return normalizePath(run.Task.Path)
}

func runFeaturePath(run vaultregistry.Run) string {
	if run.WorkReference != nil {
		return normalizePath(run.WorkReference.FeaturePath)
	}
	return normalizePath(run.Task.FeaturePath)
}

func atlasTaskID(localID, path string) string {
	normalized := normalizePath(path)
	if normalized != "" {
		return normalized
	}
	return strings.ToUpper(localID)
}

func atlasVerifierID(taskID, localID string) string {
	localID = strings.ToUpper(localID)
	if taskID == "" {
		return localID
	}
	if localID == "" {
		return taskID + "#verifier"
	}
	return taskID + "#" + localID
}

func runTaskIdentity(run vaultregistry.Run) taskIdentity {
	if run.WorkReference != nil {
		path := normalizePath(run.WorkReference.Path)
		return taskIdentity{ID: atlasTaskID(run.WorkReference.ID, path), LocalID: run.WorkReference.ID, Name: run.WorkReference.Title, Path: path}
	}
	path := normalizePath(run.Task.Path)
	return taskIdentity{ID: atlasTaskID(run.Task.ID, path), LocalID: run.Task.ID, Name: run.Task.Title, Path: path}
}

func runName(run vaultregistry.Run) string {
	if run.Name != "" {
		return run.Name
	}
	return run.RunID
}

func runState(run vaultregistry.Run) string {
	if run.SchemaVersion == 2 && run.State != "" {
		return string(run.State)
	}
	return "active"
}

func runStage(run vaultregistry.Run) string {
	if run.Stage != "" {
		return run.Stage
	}
	if len(run.Lifecycle) != 0 {
		return run.Lifecycle[len(run.Lifecycle)-1].Kind
	}
	return "unknown"
}

func acceptedAttempt(attempts []attemptProjection) *attemptProjection {
	for i := len(attempts) - 1; i >= 0; i-- {
		if attempts[i].Decision == "accepted" {
			return &attempts[i]
		}
	}
	return nil
}

func filterAttemptsByRun(attempts []attemptProjection, runID string) []attemptProjection {
	filtered := make([]attemptProjection, 0, len(attempts))
	for _, attempt := range attempts {
		if attempt.RunID == runID {
			filtered = append(filtered, attempt)
		}
	}
	return filtered
}

func verifierStatus(attempts []attemptProjection) string {
	if accepted := acceptedAttempt(attempts); accepted != nil {
		return "passed"
	}
	if len(attempts) == 0 {
		return "pending"
	}
	last := attempts[len(attempts)-1]
	if last.Decision == "rejected" {
		return "pending"
	}
	if last.Outcome == "failed" {
		return "failed"
	}
	return "pending"
}

func attemptIDsForRun(attempts []attemptProjection, runID string) []string {
	ids := make([]string, 0)
	for _, attempt := range attempts {
		if attempt.RunID == runID {
			ids = append(ids, attempt.ID)
		}
	}
	return ids
}

func evidenceIDsForRun(attempts []attemptProjection, runID string) []string {
	ids := make([]string, 0)
	for _, attempt := range attempts {
		if attempt.RunID == runID {
			ids = append(ids, attempt.Evidence.ID)
		}
	}
	return ids
}

func valueAt(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *store) hasProjectPath(path string) bool {
	for _, project := range s.projects {
		if project.Path == path {
			return true
		}
	}
	return false
}

func (p projectRecord) metadataError() error {
	if len(p.MissingMetadata) == 0 {
		return nil
	}
	if len(p.MissingMetadata) == 1 {
		return fmt.Errorf("atlas: Project %s requires %s frontmatter", p.Name, p.MissingMetadata[0])
	}
	return fmt.Errorf("atlas: Project %s requires %s frontmatter", p.Name, strings.Join(p.MissingMetadata, " and "))
}

func (s *store) projectByPath(path string) projectRecord {
	for _, project := range s.projects {
		if project.Path == path {
			return project
		}
	}
	return projectRecord{}
}

func (s *store) themeByPath(path string) themeRecord {
	for _, theme := range s.themes {
		if theme.Path == path {
			return theme
		}
	}
	return themeRecord{}
}

func (s *store) featureByPath(path string) featureRecord {
	for _, feature := range s.features {
		if feature.Path == path {
			return feature
		}
	}
	return featureRecord{}
}

func regexpMustCompile(pattern string) *regexp.Regexp {
	return regexp.MustCompile(pattern)
}
