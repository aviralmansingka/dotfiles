package mission

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"go.yaml.in/yaml/v3"
	"strings"
	"time"
)

type Mission struct {
	ID          string       `yaml:"id" json:"id"`
	Schema      int          `yaml:"schema_version" json:"schema_version"`
	Repo        string       `yaml:"repo" json:"repo"`
	Slug        string       `yaml:"slug" json:"slug"`
	Title       string       `yaml:"title" json:"title"`
	Goal        string       `yaml:"goal" json:"goal"`
	Kind        string       `yaml:"kind" json:"kind"`
	Created     string       `yaml:"created" json:"created"`
	Steps       []Step       `yaml:"steps" json:"steps"`
	Checkpoints []Checkpoint `yaml:"checkpoints,omitempty" json:"checkpoints,omitempty"`
	Body        string       `yaml:"-" json:"brief"`
}
type Step struct {
	ID           string   `yaml:"id" json:"id"`
	Title        string   `yaml:"title" json:"title"`
	Agent        string   `yaml:"agent" json:"agent"`
	Output       string   `yaml:"output" json:"output"`
	Check        string   `yaml:"check,omitempty" json:"check,omitempty"` // Read older prototype notes.
	Checks       []string `yaml:"checks,omitempty" json:"checks"`
	Instructions string   `yaml:"instructions,omitempty" json:"instructions,omitempty"`
	Acceptance   string   `yaml:"acceptance,omitempty" json:"acceptance,omitempty"`
}

func (s *Step) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind == yaml.ScalarNode {
		if n.Tag != "!!str" {
			return Problem("invalid_step", "step titles must be strings")
		}
		s.Title = n.Value
		return nil
	}
	type plain Step
	return n.Decode((*plain)(s))
}
func NormalizeMission(m *Mission) {
	for i := range m.Steps {
		s := &m.Steps[i]
		s.Title = strings.TrimSpace(s.Title)
		if s.ID == "" {
			s.ID = fmt.Sprintf("S%02d", i+1)
		}
		if s.Agent == "" {
			s.Agent = "any"
		}
		if s.Output == "" {
			s.Output = fmt.Sprintf("step-%02d.md", i+1)
		}
		s.Checks = StepChecks(*s)
		s.Check = ""
	}
}
func StepChecks(s Step) []string {
	checks := s.Checks
	if len(checks) == 0 && s.Check != "" {
		checks = []string{s.Check}
	}
	out := []string{"nonempty-artifact"}
	seen := map[string]bool{"nonempty-artifact": true}
	for _, c := range checks {
		if !seen[c] {
			out = append(out, c)
			seen[c] = true
		}
	}
	return out
}

type Evidence struct {
	Path string `yaml:"path" json:"path"`
	Hash string `yaml:"hash" json:"hash"`
}
type CheckResult struct {
	Check    string     `yaml:"check" json:"check"`
	Version  string     `yaml:"version" json:"version"`
	Verdict  string     `yaml:"verdict" json:"verdict"`
	At       string     `yaml:"at" json:"at"`
	Summary  string     `yaml:"summary" json:"summary"`
	Evidence []Evidence `yaml:"evidence,omitempty" json:"evidence,omitempty"`
}
type Verification struct {
	ID             string        `yaml:"id" json:"id"`
	Started        string        `yaml:"started_at" json:"started_at"`
	Ended          string        `yaml:"ended_at,omitempty" json:"ended_at,omitempty"`
	Runner         string        `yaml:"runner" json:"runner"`
	SubjectHash    string        `yaml:"subject_hash,omitempty" json:"subject_hash,omitempty"`
	DefinitionHash string        `yaml:"definition_hash" json:"definition_hash"`
	Results        []CheckResult `yaml:"results" json:"results"`
}
type Checkpoint struct {
	ID       string `yaml:"id" json:"id"`
	After    string `yaml:"after" json:"after"`
	Kind     string `yaml:"kind" json:"kind"`
	Question string `yaml:"question" json:"question"`
}
type Repo struct {
	ID       string            `yaml:"id" json:"id"`
	Slug     string            `yaml:"repo_slug" json:"slug"`
	Remote   string            `yaml:"remote,omitempty" json:"remote,omitempty"`
	Bindings map[string]string `yaml:"checkouts" json:"checkouts"`
}
type StepState struct {
	Status   string `yaml:"status" json:"status"`
	Attempt  string `yaml:"last_attempt,omitempty" json:"last_attempt,omitempty"`
	Evidence string `yaml:"evidence,omitempty" json:"evidence,omitempty"`
}
type CheckState struct {
	Status   string `yaml:"status" json:"status"`
	Attempt  string `yaml:"covers_attempt,omitempty" json:"covers_attempt,omitempty"`
	Evidence string `yaml:"evidence,omitempty" json:"evidence,omitempty"`
	Hash     string `yaml:"evidence_hash,omitempty" json:"evidence_hash,omitempty"`
	Actor    string `yaml:"actor,omitempty" json:"actor,omitempty"`
	Note     string `yaml:"note,omitempty" json:"note,omitempty"`
}
type Event struct {
	Quiescent   bool   `yaml:"quiescent,omitempty" json:"quiescent,omitempty"`
	ID          string `yaml:"id" json:"id"`
	Type        string `yaml:"type" json:"type"`
	At          string `yaml:"at" json:"at"`
	SessionID   string `yaml:"session_id,omitempty" json:"session_id,omitempty"`
	SessionFile string `yaml:"session_file,omitempty" json:"session_file,omitempty"`
	Tool        string `yaml:"tool,omitempty" json:"tool,omitempty"`
	Summary     string `yaml:"summary,omitempty" json:"summary,omitempty"`
	Model       string `yaml:"model,omitempty" json:"model,omitempty"`
	Pane        string `yaml:"pane_id,omitempty" json:"pane_id,omitempty"`
	Workspace   string `yaml:"workspace_id,omitempty" json:"workspace_id,omitempty"`
	Fingerprint string `yaml:"fingerprint,omitempty" json:"-"`
}
type Attempt struct {
	Execution       string         `yaml:"execution,omitempty" json:"execution,omitempty"`
	Progress        []Progress     `yaml:"progress,omitempty" json:"progress,omitempty"`
	Settled         bool           `yaml:"settled,omitempty" json:"settled,omitempty"`
	ID              string         `yaml:"id" json:"id"`
	Sequence        int            `yaml:"sequence" json:"sequence"`
	Step            string         `yaml:"step" json:"step"`
	Agent           string         `yaml:"agent" json:"agent"`
	Status          string         `yaml:"status" json:"status"`
	Started         string         `yaml:"started_at" json:"started_at"`
	Updated         string         `yaml:"updated_at" json:"updated_at"`
	Ended           string         `yaml:"ended_at,omitempty" json:"ended_at,omitempty"`
	Machine         string         `yaml:"machine" json:"machine"`
	SessionID       string         `yaml:"session_id,omitempty" json:"session_id,omitempty"`
	SessionFile     string         `yaml:"session_file,omitempty" json:"session_file,omitempty"`
	Transcript      string         `yaml:"transcript,omitempty" json:"transcript,omitempty"`
	Cwd             string         `yaml:"cwd" json:"cwd"`
	Branch          string         `yaml:"branch,omitempty" json:"branch,omitempty"`
	Managed         bool           `yaml:"managed" json:"managed"`
	ReportedFailure bool           `yaml:"reported_failure,omitempty" json:"reported_failure,omitempty"`
	PID             int            `yaml:"pid,omitempty" json:"pid,omitempty"`
	ProcessExited   bool           `yaml:"process_exited" json:"process_exited"`
	TokenHash       string         `yaml:"token_hash" json:"-"`
	SpecHash        string         `yaml:"spec_hash" json:"spec_hash"`
	Brief           string         `yaml:"brief_snapshot" json:"brief_snapshot"`
	Artifact        string         `yaml:"artifact" json:"artifact"`
	ArtifactHash    string         `yaml:"artifact_hash,omitempty" json:"artifact_hash,omitempty"`
	ExitCode        int            `yaml:"exit_code,omitempty" json:"exit_code,omitempty"`
	Events          []Event        `yaml:"events" json:"events"`
	Definition      *Step          `yaml:"step_definition,omitempty" json:"step_definition,omitempty"`
	Verifying       string         `yaml:"verifying,omitempty" json:"verifying,omitempty"`
	Verifications   []Verification `yaml:"verifications,omitempty" json:"verifications,omitempty"`
}
type State struct {
	Runtime     *RuntimeBinding       `yaml:"runtime,omitempty" json:"runtime,omitempty"`
	Schema      int                   `yaml:"schema_version" json:"schema_version"`
	Mission     string                `yaml:"mission" json:"mission"`
	Revision    int                   `yaml:"revision" json:"revision"`
	SpecHash    string                `yaml:"spec_hash" json:"spec_hash"`
	Status      string                `yaml:"status" json:"status"`
	Current     string                `yaml:"current_step,omitempty" json:"current_step,omitempty"`
	Active      string                `yaml:"active_attempt,omitempty" json:"active_attempt,omitempty"`
	Pending     string                `yaml:"pending_checkpoint,omitempty" json:"pending_checkpoint,omitempty"`
	Steps       map[string]StepState  `yaml:"steps" json:"steps"`
	Checkpoints map[string]CheckState `yaml:"checkpoints" json:"checkpoints"`
	Attempts    []Attempt             `yaml:"attempts" json:"attempts"`
	Decisions   []Decision            `yaml:"decisions,omitempty" json:"decisions,omitempty"`
	Edits       []StepEdit            `yaml:"step_edits,omitempty" json:"step_edits,omitempty"`
}
type StepEdit struct {
	Step   string `yaml:"step" json:"step"`
	At     string `yaml:"at" json:"at"`
	Before Step   `yaml:"before" json:"before"`
	After  Step   `yaml:"after" json:"after"`
	Reset  bool   `yaml:"reset" json:"reset"`
}
type Decision struct {
	Checkpoint   string `yaml:"checkpoint" json:"checkpoint"`
	Decision     string `yaml:"decision" json:"decision"`
	Attempt      string `yaml:"attempt" json:"attempt"`
	EvidenceHash string `yaml:"evidence_hash" json:"evidence_hash"`
	Actor        string `yaml:"actor" json:"actor"`
	Note         string `yaml:"note" json:"note"`
	At           string `yaml:"at" json:"at"`
}
type Record struct {
	Handle  string  `json:"handle"`
	Mission Mission `json:"mission"`
	State   State   `json:"state"`
}
type Claim struct {
	Handle      string            `json:"handle"`
	Step        Step              `json:"step"`
	Attempt     Attempt           `json:"attempt"`
	Token       string            `json:"token"`
	Environment map[string]string `json:"environment"`
}
type Work struct {
	Handle string `json:"handle"`
	Title  string `json:"title"`
	Step   Step   `json:"step"`
	Goal   string `json:"goal"`
	Cwd    string `json:"cwd"`
}
type DomainError struct{ Code, Message string }

func (e *DomainError) Error() string { return e.Message }
func Problem(code, format string, args ...any) error {
	return &DomainError{code, fmt.Sprintf(format, args...)}
}
func Now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func UID(prefix string) string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(b)
}
func Digest(b []byte) string { d := sha256.Sum256(b); return "sha256:" + hex.EncodeToString(d[:]) }
func Active(a Attempt) bool  { return a.Status == "running" || a.Status == "reported" }
func StateFor(m Mission, hash string) State {
	s := State{Schema: 1, Mission: m.ID, Revision: 1, SpecHash: hash, Status: "ready", Steps: map[string]StepState{}, Checkpoints: map[string]CheckState{}, Attempts: []Attempt{}}
	for _, v := range m.Steps {
		s.Steps[v.ID] = StepState{Status: "pending"}
	}
	for _, v := range m.Checkpoints {
		s.Checkpoints[v.ID] = CheckState{Status: "not_reached"}
	}
	return s
}
func NextStep(m Mission, s State) (Step, error) {
	if s.Active != "" {
		return Step{}, Problem("busy", "%s already has Active attempt %s", m.Slug, s.Active)
	}
	for _, step := range m.Steps {
		ss, ok := s.Steps[step.ID]
		if !ok {
			return Step{}, Problem("invalid_state", "state does not contain step %s", step.ID)
		}
		if ss.Status != "passed" {
			if ss.Status != "pending" && ss.Status != "needs_changes" {
				return Step{}, Problem("step_blocked", "%s is %s; inspect it before retrying", step.ID, ss.Status)
			}
			return step, nil
		}
		for _, cp := range m.Checkpoints {
			if cp.After == step.ID && s.Checkpoints[cp.ID].Status != "accepted" {
				return Step{}, Problem("checkpoint_pending", "%s requires human checkpoint %s", step.ID, cp.ID)
			}
		}
	}
	return Step{}, Problem("complete", "all mission steps and checkpoints are complete")
}
func FindAttempt(s *State, id string) (*Attempt, error) {
	for i := range s.Attempts {
		if s.Attempts[i].ID == id {
			return &s.Attempts[i], nil
		}
	}
	return nil, Problem("not_found", "attempt %s not found", id)
}
func Slugify(s string) string {
	var b strings.Builder
	sep := false
	for _, c := range strings.ToLower(s) {
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' {
			if sep && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(c)
			sep = false
		} else {
			sep = true
		}
	}
	out := b.String()
	if len(out) > 64 {
		out = strings.TrimRight(out[:64], "-")
	}
	return out
}

type RuntimeBinding struct {
	Machine     string `yaml:"machine" json:"machine"`
	Common      string `yaml:"common_dir" json:"common_dir"`
	Cwd         string `yaml:"cwd" json:"cwd"`
	Branch      string `yaml:"branch" json:"branch"`
	Base        string `yaml:"base,omitempty" json:"base,omitempty"`
	BaseCommit  string `yaml:"base_commit,omitempty" json:"base_commit,omitempty"`
	SessionID   string `yaml:"session_id,omitempty" json:"session_id,omitempty"`
	SessionFile string `yaml:"session_file,omitempty" json:"session_file,omitempty"`
	Pane        string `yaml:"pane_id,omitempty" json:"pane_id,omitempty"`
	Workspace   string `yaml:"workspace_id,omitempty" json:"workspace_id,omitempty"`
	LaunchID    string `yaml:"launch_id,omitempty" json:"launch_id,omitempty"`
}

type Progress struct {
	ID          string     `yaml:"id" json:"id"`
	At          string     `yaml:"at" json:"at"`
	Status      string     `yaml:"status" json:"status"`
	Summary     string     `yaml:"summary" json:"summary"`
	Next        string     `yaml:"next,omitempty" json:"next,omitempty"`
	Blocker     string     `yaml:"blocker,omitempty" json:"blocker,omitempty"`
	Evidence    []Evidence `yaml:"evidence,omitempty" json:"evidence,omitempty"`
	Fingerprint string     `yaml:"fingerprint,omitempty" json:"-"`
}

type PiAttachment struct{ SessionID, SessionFile, Cwd, Workspace, Pane, Token, Agent, LaunchID string }
