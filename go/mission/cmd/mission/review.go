package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// pendingReview is the machine view of the waiting owner decision. Exactly
// these three keys are the contract: the evidence hash stays internal.
type pendingReview struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Evidence string `json:"evidence"`
}

// recordView is one mission record on the machine surface. It inlines the
// record, then adds the three derived fields an agent needs to hand the owner
// one stable line: revision, pending_review, and next_command.
type recordView struct {
	mission.Record
	Revision      int            `json:"revision"`
	PendingReview *pendingReview `json:"pending_review"`
	NextCommand   *string        `json:"next_command"`
}

// decisionView adds the idempotency fact to one decision result.
type decisionView struct {
	recordView
	AlreadyDecided bool `json:"already_decided,omitempty"`
}

func reviewOf(r mission.Record) *pendingReview {
	if r.State.Pending == "" {
		return nil
	}
	cs, ok := r.State.Checkpoints[r.State.Pending]
	if !ok || cs.Status != "pending" {
		return nil
	}
	pr := &pendingReview{ID: r.State.Pending, Evidence: cs.Evidence}
	for _, c := range r.Mission.Checkpoints {
		if c.ID == r.State.Pending {
			pr.Question = c.Question
			break
		}
	}
	return pr
}

// nextCommand is the one command that advances the mission now, or nil.
func nextCommand(r mission.Record) *string {
	if pr := reviewOf(r); pr != nil {
		line := decisionLine(r.Handle, pr.ID, "accept", "")
		return &line
	}
	if a, e := mission.FindAttempt(&r.State, r.State.Active); e == nil && a.Status == "reported" {
		line := "mission finish " + r.Handle
		return &line
	}
	return nil
}

func viewOf(r mission.Record) recordView {
	return recordView{Record: r, Revision: r.State.Revision, PendingReview: reviewOf(r), NextCommand: nextCommand(r)}
}

// listViews gives every mission row the same derived fields as show.
func (s *Store) listViews() ([]recordView, error) {
	recs, e := s.list()
	if e != nil {
		return nil, e
	}
	out := make([]recordView, 0, len(recs))
	for _, r := range recs {
		out = append(out, viewOf(r))
	}
	return out, nil
}

// decisionLine is the copy-paste form the owner sees in every message.
func decisionLine(h, id, decision, note string) string {
	if decision == "" {
		decision = "accept"
	}
	if id == "" {
		id = "<review-id>"
	}
	if strings.TrimSpace(note) == "" {
		note = "Reviewed the evidence"
	}
	return fmt.Sprintf("mission checkpoint %s %s %s --note %q", decision, h, id, note)
}

// defaultActor resolves the attestation name. Git's configured user wins, then
// the login name. An empty result is a decision requirement, never a silent
// default.
func defaultActor() string {
	if out, e := exec.Command("git", "config", "--get", "user.name").Output(); e == nil {
		if v := strings.TrimSpace(string(out)); v != "" {
			return v
		}
	}
	return strings.TrimSpace(os.Getenv("USER"))
}

// decisionRequest is one owner decision. Legacy marks the old flag form, which
// still requires an explicit --human.
type decisionRequest struct {
	Handle   string
	ID       string
	Decision string
	Note     string
	Actor    string
	Human    bool
	Legacy   bool
	Revision int
}

// decisionOutcome carries the record plus the idempotency fact.
type decisionOutcome struct {
	Record  mission.Record
	Already bool
}

// requirementMessage lists every missing requirement in one line, then the
// exact command that would work. One error, one round trip.
func requirementMessage(h, id, decision string, missing []string) string {
	return fmt.Sprintf("decision needs %s; --actor defaults to git user.name. Run:\n  %s",
		strings.Join(missing, " and "), decisionLine(h, id, decision, ""))
}

// pendingReviewIDs lists every checkpoint the ledger still holds as pending.
func pendingReviewIDs(r mission.Record) []string {
	ids := []string{}
	for id, cs := range r.State.Checkpoints {
		if cs.Status == "pending" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// reviewTarget resolves the review id. A single pending review needs no id;
// several pending reviews must be named; a wrong id names the right one.
func reviewTarget(r mission.Record, given string, decision string) (string, error) {
	ids := pendingReviewIDs(r)
	pending := r.State.Pending
	if given != "" {
		if pending != "" && given != pending {
			return "", mission.Problem("review_id_mismatch", "%s is not the pending review; the pending review is %s. Decide with:\n  %s",
				given, pending, decisionLine(r.Handle, pending, decision, ""))
		}
		for _, id := range ids {
			if id == given {
				return given, nil
			}
		}
		return "", mission.Problem("review_not_pending", "%s is not pending; inspect the mission with:\n  mission show %s", given, r.Handle)
	}
	switch {
	case len(ids) == 1:
		return ids[0], nil
	case len(ids) > 1:
		var b strings.Builder
		b.WriteString("several reviews are pending; name one. Decide with:\n")
		for _, id := range ids {
			b.WriteString("  " + decisionLine(r.Handle, id, decision, "") + "\n")
		}
		return "", mission.Problem("review_ambiguous", "%s", strings.TrimRight(b.String(), "\n"))
	}
	pr := ""
	if pending != "" {
		pr = " " + pending
	}
	return "", mission.Problem("review_not_pending", "no review is pending%s; inspect the mission with:\n  mission show %s", pr, r.Handle)
}

// decide records one owner decision. Revision is a legacy conflict check, not
// a target: the review id and the evidence hash already pin the reviewed work.
func (s *Store) decide(req decisionRequest) (decisionOutcome, error) {
	var out decisionOutcome
	if req.Decision != "accept" && req.Decision != "revise" {
		return out, mission.Problem("invalid_decision", "decision must be accept or revise")
	}
	if req.Legacy && !req.Human {
		return out, mission.Problem("human_required", "the flag form records a human attestation; add --human or use:\n  %s",
			decisionLine(req.Handle, req.ID, req.Decision, req.Note))
	}
	e := s.locked(func() error {
		r, e := s.load(req.Handle)
		if e != nil {
			return e
		}
		id, e := reviewTarget(r, req.ID, req.Decision)
		if e != nil {
			// A repeat of the recorded decision is idempotent, not an error.
			id = req.ID
			if id == "" {
				id = r.State.Pending
			}
			actor := strings.TrimSpace(req.Actor)
			if actor == "" {
				actor = defaultActor()
			}
			if id != "" && decidedAlready(r, id, req.Decision, actor, strings.TrimSpace(req.Note)) {
				out = decisionOutcome{Record: r, Already: true}
				return nil
			}
			return e
		}
		note, actor := strings.TrimSpace(req.Note), strings.TrimSpace(req.Actor)
		if actor == "" {
			actor = defaultActor()
		}
		var missing []string
		if note == "" {
			missing = append(missing, "--note TEXT")
		}
		if actor == "" {
			missing = append(missing, "--actor NAME")
		}
		if len(missing) > 0 {
			code := "actor_required"
			if note == "" {
				code = "note_required"
			}
			return mission.Problem(code, "%s", requirementMessage(req.Handle, id, req.Decision, missing))
		}
		cs := r.State.Checkpoints[id]
		if !(cs.Status == "pending" && (r.State.Pending == id || r.State.Pending == "")) {
			if decidedAlready(r, id, req.Decision, actor, note) {
				out = decisionOutcome{Record: r, Already: true}
				return nil
			}
			return mission.Problem("review_not_pending", "review %s is no longer pending; inspect the mission with:\n  mission show %s", id, r.Handle)
		}
		if req.Revision > 0 && r.State.Revision != req.Revision {
			return mission.Problem("revision_conflict", "expected revision %d, current %d", req.Revision, r.State.Revision)
		}
		d, _ := s.dir(req.Handle)
		b, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if mission.Digest(b) != r.State.SpecHash {
			return mission.Problem("brief_changed", "the mission brief changed after the review opened; inspect it with:\n  mission show %s", r.Handle)
		}
		p, e := s.path(r.Mission.Repo, r.Mission.Slug, cs.Evidence)
		if e != nil {
			return e
		}
		b, e = os.ReadFile(p)
		if e != nil || mission.Digest(b) != cs.Hash {
			return mission.Problem("evidence_changed", "the reviewed evidence changed; refresh the review with:\n  mission review reopen %s %s --note \"Refreshed after the worker fix\"", r.Handle, id)
		}
		if req.Decision == "accept" {
			if a, e := mission.FindAttempt(&r.State, cs.Attempt); e == nil && len(a.Verifications) > 0 && !s.verified(r, *a) {
				return mission.Problem("evidence_changed", "checked input or verification evidence changed since this result; refresh the review with:\n  mission review reopen %s %s --note \"Refreshed after the worker fix\"", r.Handle, id)
			}
		}
		cs.Actor = actor
		cs.Note = note
		cs.Status = "accepted"
		r.State.Pending = ""
		r.State.Status = "ready"
		if req.Decision == "revise" {
			cs.Status = "changes_requested"
			invalidate := false
			for _, step := range r.Mission.Steps {
				if step.ID == r.State.Current {
					invalidate = true
				}
				if invalidate {
					ss := r.State.Steps[step.ID]
					ss.Status = "pending"
					ss.Evidence = ""
					r.State.Steps[step.ID] = ss
					for _, c := range r.Mission.Checkpoints {
						if c.After == step.ID && c.ID != id {
							other := r.State.Checkpoints[c.ID]
							other.Status = "invalidated"
							r.State.Checkpoints[c.ID] = other
						}
					}
				}
			}
		}
		r.State.Decisions = append(r.State.Decisions, mission.Decision{Checkpoint: id, Decision: req.Decision, Attempt: cs.Attempt, EvidenceHash: cs.Hash, Actor: actor, Note: note, At: mission.Now()})
		r.State.Checkpoints[id] = cs
		if req.Decision == "accept" {
			if _, e := mission.NextStep(r.Mission, r.State); e != nil {
				if de, ok := e.(*mission.DomainError); ok && de.Code == "complete" {
					r.State.Status = "done"
				} else {
					return e
				}
			}
		}
		r.State.Revision++
		if e = s.save(&r); e != nil {
			return e
		}
		out = decisionOutcome{Record: r}
		return nil
	})
	return out, e
}

// decidedAlready reports the same decision already recorded, so a repeated
// command is idempotent instead of an error.
func decidedAlready(r mission.Record, id, decision, actor, note string) bool {
	for _, d := range r.State.Decisions {
		if d.Checkpoint == id && d.Decision == decision && d.Actor == actor && d.Note == note {
			return true
		}
	}
	return false
}

// decideRetry drops one stale legacy revision and retries once.
func (s *Store) decideRetry(req decisionRequest) (decisionOutcome, error) {
	out, e := s.decide(req)
	if d, ok := e.(*mission.DomainError); ok && d.Code == "revision_conflict" && req.Revision > 0 {
		req.Revision = 0
		return s.decide(req)
	}
	return out, e
}

// checkpoint keeps the pre-review API for the existing callers and tests.
func (s *Store) checkpoint(h, id, decision, note, actor string, human bool, revision int) (mission.Record, error) {
	out, e := s.decide(decisionRequest{Handle: h, ID: id, Decision: decision, Note: note, Actor: actor, Human: human, Legacy: true, Revision: revision})
	return out.Record, e
}

// reopen rebinds a pending review to the current artifact. The owner still
// decides; reopen re-runs the required checks, so the new content has fresh
// verification before the decision.
func (s *Store) reopen(h, id, note string) (mission.Record, error) {
	var current mission.Record
	var attempt mission.Attempt
	var st mission.Step
	var before subjectSnapshot
	var target string
	note = strings.TrimSpace(note)
	if note == "" {
		return current, mission.Problem("note_required", "reopen needs --note TEXT. Run:\n  mission review reopen %s %s --note \"Refreshed after the worker fix\"", h, platformFallbackID(id))
	}
	run := mission.Verification{ID: mission.UID("verify-"), Started: mission.Now(), Runner: "mission/checks@" + platform.Machine()}
	_, e := s.mutate(h, func(r *mission.Record) error {
		t, e := reviewTarget(*r, id, "accept")
		if e != nil {
			return e
		}
		target = t
		cs := r.State.Checkpoints[t]
		a, e := mission.FindAttempt(&r.State, cs.Attempt)
		if e != nil {
			return e
		}
		if a.Verifying != "" {
			return mission.Problem("verification_busy", "check run %s owns this attempt; retry after it ends", a.Verifying)
		}
		st = attemptDefinition(*r, *a)
		before = s.subject(*r, *a, st)
		if before.ArtifactErr != nil {
			return mission.Problem("review_evidence_missing", "read the reviewed evidence %s: %v", cs.Evidence, before.ArtifactErr)
		}
		run.SubjectHash = before.Hash
		run.DefinitionHash = definitionHash(st)
		for _, name := range mission.StepChecks(st) {
			run.Results = append(run.Results, mission.CheckResult{Check: name, Version: "1", Verdict: "not_run", At: run.Started, Summary: "Check has not run"})
		}
		a.Verifying = run.ID
		a.Verifications = append(a.Verifications, run)
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "note", At: mission.Now(),
			Summary: "Review " + target + " reopened: " + note})
		attempt = *a
		current = *r
		return nil
	})
	if e != nil {
		return current, e
	}
	// Checks run without the vault lock, like the worker verification path.
	logs := executeChecks(st, attempt.Cwd, before, &run)
	var failed error
	e = s.locked(func() error {
		r, e := s.load(h)
		if e != nil {
			return e
		}
		a, e := mission.FindAttempt(&r.State, attempt.ID)
		if e != nil {
			return e
		}
		if a.Verifying != run.ID {
			return mission.Problem("stale_attempt", "verification no longer owns this attempt")
		}
		if e = s.recordVerification(&r, a, st, &run, before, logs); e != nil {
			return e
		}
		if allPassed(run, st) {
			cs := r.State.Checkpoints[target]
			cs.Hash = before.ArtifactHash
			r.State.Checkpoints[target] = cs
		} else {
			failed = mission.Problem("checks_failed", "reopened review failed checks: %s", verificationSummary(run))
		}
		r.State.Revision++
		if e = s.save(&r); e != nil {
			return e
		}
		current = r
		return nil
	})
	if e != nil {
		return current, e
	}
	return current, failed
}

func platformFallbackID(id string) string {
	if id == "" {
		return "<review-id>"
	}
	return id
}

// cmdCheckpoint accepts both surfaces: the review verb form, and the legacy
// flag form. The verb form implies the human attestation.
func cmdCheckpoint(a platform.Args, s *Store) (any, error) {
	h := platform.Fallback(a.At(1), os.Getenv("MISSION_HANDLE"))
	if v := a.At(1); v == "accept" || v == "revise" {
		req := decisionRequest{Handle: platform.Fallback(a.At(2), os.Getenv("MISSION_HANDLE")), ID: a.At(3), Decision: v, Note: a.Get("note"), Actor: a.Get("actor"), Human: true}
		out, e := s.decideRetry(req)
		if e != nil {
			return nil, e
		}
		return decisionView{recordView: viewOf(out.Record), AlreadyDecided: out.Already}, nil
	}
	rev, e := revisionFlag(a.Get("revision"))
	if e != nil {
		return nil, e
	}
	out, e := s.decideRetry(decisionRequest{Handle: h, ID: a.Get("id"), Decision: a.Get("decision"), Note: a.Get("note"), Actor: a.Get("actor"), Human: a.Has("human"), Legacy: true, Revision: rev})
	if e != nil {
		return nil, e
	}
	return decisionView{recordView: viewOf(out.Record), AlreadyDecided: out.Already}, nil
}

// cmdReview owns the owner repair action for a changed evidence file.
// revisionFlag parses the deprecated legacy revision. An empty value means
// "resolve it from the review id".
func revisionFlag(v string) (int, error) {
	if strings.TrimSpace(v) == "" {
		return 0, nil
	}
	n, e := strconv.Atoi(v)
	if e != nil || n < 1 {
		return 0, mission.Problem("usage", "--revision must be a positive integer")
	}
	return n, nil
}

func cmdReview(a platform.Args, s *Store) (any, error) {
	switch a.At(1) {
	case "reopen":
		r, e := s.reopen(platform.Fallback(a.At(2), os.Getenv("MISSION_HANDLE")), a.At(3), a.Get("note"))
		if e != nil {
			return nil, e
		}
		return viewOf(r), nil
	}
	return nil, mission.Problem("usage", "review subcommands: reopen REPO/SLUG [C01] --note TEXT")
}
