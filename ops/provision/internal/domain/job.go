package domain

import (
	"fmt"
	"time"
)

// JobKind distinguishes the two asynchronous operations.
type JobKind string

const (
	JobKindCreate JobKind = "create_host"
	JobKindDelete JobKind = "delete_host"
)

// JobState is the coarse lifecycle state of an asynchronous job.
type JobState string

const (
	JobQueued     JobState = "queued"
	JobInProgress JobState = "in_progress"
	JobReady      JobState = "ready"
	JobFailed     JobState = "failed"
	JobDeleted    JobState = "deleted"
)

// Stage is the fine-grained milestone reported by the job API and by the
// deterministic Temporal status query.
type Stage string

const (
	StageQueued      Stage = "queued"
	StageCreating    Stage = "creating"
	StageEnrolling   Stage = "enrolling"
	StageDeploying   Stage = "deploying"
	StageAuthorizing Stage = "authorizing"
	StageReady       Stage = "ready"

	// Deletion has its own progression: access is revoked and the device is
	// removed before provider resources are destroyed.
	StageRevokingAccess Stage = "revoking_access"
	StageRemovingDevice Stage = "removing_device"
	StageDestroying     Stage = "destroying"
	StageDeleted        Stage = "deleted"
)

// createLadder and deleteLadder are the only legal progressions. A stage may
// also be repeated (an activity retry re-reports the same stage) and any
// non-terminal job may move to failed.
var (
	createLadder = []Stage{
		StageQueued, StageCreating, StageEnrolling, StageDeploying, StageAuthorizing, StageReady,
	}
	deleteLadder = []Stage{
		StageQueued, StageRevokingAccess, StageRemovingDevice, StageDestroying, StageDeleted,
	}
)

// Ladder returns the legal stage progression for a job kind.
func Ladder(kind JobKind) ([]Stage, error) {
	switch kind {
	case JobKindCreate:
		return append([]Stage(nil), createLadder...), nil
	case JobKindDelete:
		return append([]Stage(nil), deleteLadder...), nil
	default:
		return nil, fmt.Errorf("unknown job kind %q", kind)
	}
}

// NextStage returns the stage after current on the ladder.
func NextStage(kind JobKind, current Stage) (Stage, bool) {
	ladder, err := Ladder(kind)
	if err != nil {
		return "", false
	}
	for i, s := range ladder {
		if s == current && i+1 < len(ladder) {
			return ladder[i+1], true
		}
	}
	return "", false
}

// CanTransition reports whether from→to is legal for the job kind. Repeating a
// stage is legal; so is advancing one or more rungs forward.
func CanTransition(kind JobKind, from, to Stage) bool {
	if from == to {
		return true
	}
	ladder, err := Ladder(kind)
	if err != nil {
		return false
	}
	fromIdx, toIdx := -1, -1
	for i, s := range ladder {
		if s == from {
			fromIdx = i
		}
		if s == to {
			toIdx = i
		}
	}
	if fromIdx < 0 || toIdx < 0 {
		return false
	}
	return toIdx > fromIdx
}

// JobError is a sanitized, client-safe failure description. It never carries a
// credential, stack trace, host path, or provider payload.
type JobError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

// Job is the durable view of an asynchronous operation. Execution is owned by
// Temporal; this struct is what the API may report.
type Job struct {
	ID        string    `json:"id"`
	HostID    string    `json:"host_id"`
	Kind      JobKind   `json:"kind"`
	State     JobState  `json:"state"`
	Stage     Stage     `json:"stage"`
	Error     *JobError `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// NewJob builds a queued job for a host.
func NewJob(id, hostID string, kind JobKind, now time.Time) Job {
	return Job{
		ID:        id,
		HostID:    hostID,
		Kind:      kind,
		State:     JobQueued,
		Stage:     StageQueued,
		CreatedAt: now.UTC(),
		UpdatedAt: now.UTC(),
	}
}

// Advance moves a job to a new stage, refusing an illegal transition.
func (j *Job) Advance(stage Stage, now time.Time) error {
	if !CanTransition(j.Kind, j.Stage, stage) {
		return fmt.Errorf("job %s: illegal %s transition %q -> %q", j.ID, j.Kind, j.Stage, stage)
	}
	j.Stage = stage
	j.UpdatedAt = now.UTC()
	switch stage {
	case StageReady:
		j.State = JobReady
	case StageDeleted:
		j.State = JobDeleted
	case StageQueued:
		j.State = JobQueued
	default:
		j.State = JobInProgress
	}
	return nil
}

// Fail marks a job failed while keeping the last attempted stage visible. A
// failed job is never reported as ready.
func (j *Job) Fail(jobErr JobError, now time.Time) {
	j.State = JobFailed
	j.Error = &jobErr
	j.UpdatedAt = now.UTC()
}

// Terminal reports whether no further transition is expected.
func (j Job) Terminal() bool {
	switch j.State {
	case JobReady, JobFailed, JobDeleted:
		return true
	default:
		return false
	}
}
