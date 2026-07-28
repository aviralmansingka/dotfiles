package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const (
	maxConflictRetries = 8
	maxRequestBytes    = 1 << 20
)

var errMalformedRequest = errors.New("malformed request")

// The command contract uses one strict request type per action. Root is
// optional on every action and resolves through the Registry's normal state
// directory rules when omitted.
type createRequest struct {
	Action        string                     `json:"action"`
	Root          string                     `json:"root,omitempty"`
	Run           *vaultregistry.Run         `json:"run"`
	InitialDriver *vaultregistry.Observation `json:"initial_driver,omitempty"`
}

type getRequest struct {
	Action    string  `json:"action"`
	Root      string  `json:"root,omitempty"`
	RunID     *string `json:"run_id"`
	Namespace string  `json:"namespace,omitempty"`
}

type appendRequest struct {
	Action      string                     `json:"action"`
	Root        string                     `json:"root,omitempty"`
	RunID       *string                    `json:"run_id"`
	UpdatedAt   *string                    `json:"updated_at"`
	Participant *vaultregistry.Participant `json:"participant,omitempty"`
	Lifecycle   *vaultregistry.Lifecycle   `json:"lifecycle,omitempty"`
	Evidence    *vaultregistry.Evidence    `json:"evidence,omitempty"`
}

type listAgentSessionFilter struct {
	Source string `json:"source"`
	Kind   string `json:"kind"`
	Value  string `json:"value"`
}

type listFilterRequest struct {
	TaskID           string                  `json:"task_id,omitempty"`
	FeaturePath      string                  `json:"feature_path,omitempty"`
	ParticipantID    string                  `json:"participant_id,omitempty"`
	AgentSession     *listAgentSessionFilter `json:"agent_session,omitempty"`
	UpdatedAtFrom    string                  `json:"updated_at_from,omitempty"`
	UpdatedAtThrough string                  `json:"updated_at_through,omitempty"`
}

type listRequest struct {
	Action string            `json:"action"`
	Root   string            `json:"root,omitempty"`
	Filter listFilterRequest `json:"filter,omitempty"`
}

type retireRequest struct {
	Action           string  `json:"action"`
	Root             string  `json:"root,omitempty"`
	RunID            *string `json:"run_id"`
	ExpectedRevision *uint64 `json:"expected_revision"`
}

// request is the normalized append input used by the idempotent update logic.
type request struct {
	RunID       string
	UpdatedAt   string
	Participant *vaultregistry.Participant
	Lifecycle   *vaultregistry.Lifecycle
	Evidence    *vaultregistry.Evidence
}

func main() {
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fail(err)
	}
}

func serve(input io.Reader, output io.Writer) error {
	command, err := decodeRequest(input)
	if err != nil {
		return err
	}

	var response any
	switch req := command.(type) {
	case createRequest:
		producer, openErr := vaultregistry.OpenProducer(req.Root)
		if openErr != nil {
			return openErr
		}
		response, err = create(producer, req.Run, req.InitialDriver)
	case getRequest:
		reader, openErr := vaultregistry.OpenReader(req.Root)
		if openErr != nil {
			return openErr
		}
		if req.Namespace == "retired" {
			response, err = reader.GetRetired(*req.RunID)
		} else {
			response, err = reader.Get(*req.RunID)
		}
	case appendRequest:
		producer, openErr := vaultregistry.OpenProducer(req.Root)
		if openErr != nil {
			return openErr
		}
		response, err = appendObservation(producer, request{
			RunID: *req.RunID, UpdatedAt: *req.UpdatedAt,
			Participant: req.Participant, Lifecycle: req.Lifecycle, Evidence: req.Evidence,
		})
	case listRequest:
		reader, openErr := vaultregistry.OpenReader(req.Root)
		if openErr != nil {
			return openErr
		}
		filter := vaultregistry.ListFilter{
			TaskID: req.Filter.TaskID, FeaturePath: req.Filter.FeaturePath, ParticipantID: req.Filter.ParticipantID,
			UpdatedAtFrom: req.Filter.UpdatedAtFrom, UpdatedAtThrough: req.Filter.UpdatedAtThrough,
		}
		if session := req.Filter.AgentSession; session != nil {
			filter.AgentSession = &vaultregistry.AgentSession{Source: session.Source, Kind: session.Kind, Value: session.Value}
		}
		response, err = reader.ListSummaries(filter)
	case retireRequest:
		response, err = retireRun(req.Root, *req.RunID, *req.ExpectedRevision)
	default:
		return errors.New("unreachable command request")
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(response)
}

func retireRun(root, runID string, expectedRevision uint64) (vaultregistry.Run, error) {
	if expectedRevision == 0 {
		return vaultregistry.Run{}, fmt.Errorf("%w: retire revision must be non-zero", vaultregistry.ErrMalformed)
	}
	if root == "" {
		var err error
		root, err = vaultregistry.ResolveRoot()
		if err != nil {
			return vaultregistry.Run{}, err
		}
	}
	producer, err := vaultregistry.OpenExistingProducer(root)
	if err != nil {
		return vaultregistry.Run{}, err
	}
	if _, err := producer.Retire(runID, expectedRevision); err != nil {
		return vaultregistry.Run{}, err
	}
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		return vaultregistry.Run{}, err
	}
	return reader.GetRetired(runID)
}

func decodeRequest(input io.Reader) (any, error) {
	data, err := io.ReadAll(io.LimitReader(input, maxRequestBytes+1))
	if err != nil {
		return nil, malformedRequest(err)
	}
	if len(data) > maxRequestBytes {
		return nil, malformedRequest(errors.New("request exceeds 1 MiB"))
	}

	var envelope struct {
		Action string `json:"action"`
	}
	if err := decodeSingleJSON(data, &envelope, false); err != nil {
		return nil, malformedRequest(err)
	}
	if envelope.Action == "" {
		return nil, malformedRequest(errors.New("action is required"))
	}

	var command any
	switch envelope.Action {
	case "create":
		command = &createRequest{}
	case "get":
		command = &getRequest{}
	case "append":
		command = &appendRequest{}
	case "list":
		command = &listRequest{}
	case "retire":
		command = &retireRequest{}
	default:
		return nil, malformedRequest(fmt.Errorf("unsupported action %q", envelope.Action))
	}
	if err := decodeSingleJSON(data, command, true); err != nil {
		return nil, malformedRequest(err)
	}

	switch req := command.(type) {
	case *createRequest:
		if req.Action != "create" || req.Run == nil {
			return nil, malformedRequest(errors.New("create requires run"))
		}
		return *req, nil
	case *getRequest:
		if req.Action != "get" || req.RunID == nil {
			return nil, malformedRequest(errors.New("get requires run_id"))
		}
		if req.Namespace != "" && req.Namespace != "active" && req.Namespace != "retired" {
			return nil, malformedRequest(errors.New("get namespace must be active or retired"))
		}
		return *req, nil
	case *appendRequest:
		if req.Action != "append" || req.RunID == nil || req.UpdatedAt == nil {
			return nil, malformedRequest(errors.New("append requires run_id and updated_at"))
		}
		return *req, nil
	case *listRequest:
		if req.Action != "list" {
			return nil, malformedRequest(errors.New("invalid list action"))
		}
		return *req, nil
	case *retireRequest:
		if req.Action != "retire" || req.RunID == nil || req.ExpectedRevision == nil {
			return nil, malformedRequest(errors.New("retire requires run_id and expected_revision"))
		}
		return *req, nil
	default:
		return nil, errors.New("unreachable decoded request")
	}
}

func decodeSingleJSON(data []byte, destination any, strict bool) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if strict {
		decoder.DisallowUnknownFields()
	}
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

func malformedRequest(err error) error {
	return fmt.Errorf("%w: %v", errMalformedRequest, err)
}

func create(producer *vaultregistry.Producer, wanted *vaultregistry.Run, drivers ...*vaultregistry.Observation) (vaultregistry.Run, error) {
	if wanted == nil {
		return vaultregistry.Run{}, errors.New("create requires run")
	}
	var driver *vaultregistry.Observation
	if len(drivers) > 0 {
		driver = drivers[0]
	}
	if wanted.WorkReference != nil {
		if driver == nil {
			return vaultregistry.Run{}, fmt.Errorf("%w: reconciled create requires initial_driver", vaultregistry.ErrMalformed)
		}
		return producer.CreateRun(vaultregistry.CreateRequest{Run: *wanted, InitialDriver: *driver})
	}
	if driver != nil {
		return vaultregistry.Run{}, fmt.Errorf("%w: initial_driver requires a reconciled schema-version-2 Run", vaultregistry.ErrMalformed)
	}
	created, err := producer.Create(*wanted)
	if !errors.Is(err, vaultregistry.ErrConflict) {
		return created, err
	}
	existing, getErr := producer.Get(wanted.RunID)
	if getErr != nil {
		return vaultregistry.Run{}, getErr
	}
	if existing.InvokedAt != wanted.InvokedAt || !sameTask(existing.Task, wanted.Task) {
		return vaultregistry.Run{}, fmt.Errorf("%w: run identity differs", vaultregistry.ErrConflict)
	}
	return existing, nil
}

func sameTask(a, b vaultregistry.Task) bool {
	return a.ID == b.ID && a.Title == b.Title && a.Path == b.Path && a.FeaturePath == b.FeaturePath && a.Kind == b.Kind
}

func appendObservation(producer *vaultregistry.Producer, req request) (vaultregistry.Run, error) {
	if req.RunID == "" || req.UpdatedAt == "" {
		return vaultregistry.Run{}, errors.New("append requires run_id and updated_at")
	}
	if _, err := time.Parse(time.RFC3339, req.UpdatedAt); err != nil {
		return vaultregistry.Run{}, fmt.Errorf("invalid updated_at: %w", err)
	}
	for range maxConflictRetries {
		current, err := producer.Get(req.RunID)
		if err != nil {
			return vaultregistry.Run{}, err
		}
		complete, err := observationState(current, req)
		if err != nil {
			return vaultregistry.Run{}, err
		}
		if complete {
			return current, nil
		}
		next, err := producer.Update(req.RunID, current.Revision, func(run *vaultregistry.Run) error {
			if _, err := observationState(*run, req); err != nil {
				return err
			}
			if after(req.UpdatedAt, run.UpdatedAt) {
				run.UpdatedAt = req.UpdatedAt
			}
			if req.Participant != nil && !participantExists(run.Participants, *req.Participant) {
				run.Participants = append(run.Participants, *req.Participant)
			}
			if req.Lifecycle != nil && !lifecycleExists(run.Lifecycle, req.Lifecycle.ObservationID) {
				run.Lifecycle = append(run.Lifecycle, *req.Lifecycle)
			}
			if req.Evidence != nil && !evidenceExists(run.Evidence, req.Evidence.ObservationID) {
				run.Evidence = append(run.Evidence, *req.Evidence)
			}
			return nil
		})
		if err == nil {
			return next, nil
		}
		if !errors.Is(err, vaultregistry.ErrConflict) {
			return vaultregistry.Run{}, err
		}
	}
	return vaultregistry.Run{}, fmt.Errorf("%w: retries exhausted", vaultregistry.ErrConflict)
}

func observationState(run vaultregistry.Run, req request) (bool, error) {
	complete := true
	if req.Participant != nil {
		found, equal := participantState(run.Participants, *req.Participant)
		if found && !equal {
			return false, fmt.Errorf("%w: participant identity collision", vaultregistry.ErrConflict)
		}
		complete = complete && found
	}
	if req.Lifecycle != nil {
		found, equal := lifecycleState(run.Lifecycle, *req.Lifecycle)
		if found && !equal {
			return false, fmt.Errorf("%w: lifecycle observation collision", vaultregistry.ErrConflict)
		}
		complete = complete && found
	}
	if req.Evidence != nil {
		found, equal := evidenceState(run.Evidence, *req.Evidence)
		if found && !equal {
			return false, fmt.Errorf("%w: evidence observation collision", vaultregistry.ErrConflict)
		}
		complete = complete && found
	}
	return complete, nil
}

func participantState(items []vaultregistry.Participant, wanted vaultregistry.Participant) (bool, bool) {
	for _, item := range items {
		if item.ParticipantID == wanted.ParticipantID && item.ObservedAt == wanted.ObservedAt {
			return true, equalCanonical(item, wanted)
		}
	}
	return false, false
}

func lifecycleState(items []vaultregistry.Lifecycle, wanted vaultregistry.Lifecycle) (bool, bool) {
	for _, item := range items {
		if item.ObservationID == wanted.ObservationID {
			return true, equalCanonical(item, wanted)
		}
	}
	return false, false
}

func evidenceState(items []vaultregistry.Evidence, wanted vaultregistry.Evidence) (bool, bool) {
	for _, item := range items {
		if item.ObservationID == wanted.ObservationID {
			return true, equalCanonical(item, wanted)
		}
	}
	return false, false
}

func equalCanonical[T any](a, b T) bool {
	aa, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return bytes.Equal(aa, bb)
}

func participantExists(items []vaultregistry.Participant, wanted vaultregistry.Participant) bool {
	found, _ := participantState(items, wanted)
	return found
}

func lifecycleExists(items []vaultregistry.Lifecycle, id string) bool {
	for _, item := range items {
		if item.ObservationID == id {
			return true
		}
	}
	return false
}

func evidenceExists(items []vaultregistry.Evidence, id string) bool {
	for _, item := range items {
		if item.ObservationID == id {
			return true
		}
	}
	return false
}

func after(a, b string) bool {
	aa, _ := time.Parse(time.RFC3339, a)
	bb, _ := time.Parse(time.RFC3339, b)
	return aa.After(bb)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
