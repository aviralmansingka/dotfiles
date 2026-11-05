package mission

import (
	"bytes"
	"encoding/json"
	"unicode/utf8"
)

// A Checker judges an attempt's input. The core owns the run: it freezes one
// snapshot before the checks, replays them in the declared order, records every
// verdict, and freezes the snapshot again afterwards, so a passed check whose
// input moved becomes inconclusive. A checker owns the two facts that need the
// machine: the fingerprint of an attempt's input, and the verdicts of the
// presets that run a process.
//
// Every verdict this port reports is a fact about this host, so a checker
// answers with the same verdict, summary, and log bytes the ledger records,
// never with a policy the core could have decided itself.
type Checker interface {
	// Fingerprint completes one snapshot of the attempt's input. The caller
	// fills the artifact facts it read from the ledger, so reading the result
	// stays with the ledger; the checker adds the repository facts and the hash
	// over both.
	Fingerprint(attempt Attempt, step Step, snap Snapshot) (Snapshot, error)
	// Run executes one process preset in the attempt checkout and reports its
	// verdict together with the log the evidence record keeps.
	Run(name, cwd string, snap Snapshot) (CheckResult, []byte, error)
}

// A Snapshot is the frozen input one check run judges: the result the attempt
// wrote, and the checkout its checks read. ArtifactErr and RepoErr are the two
// ways that input can be unavailable, and each stays on the snapshot so the
// check that needs it reports the reason instead of the run failing.
type Snapshot struct {
	Hash         string
	ArtifactHash string
	Artifact     []byte
	ArtifactErr  error
	RepoErr      error
}

// The presets this package judges itself, and the one the checker adapter
// executes. A cmd: check carries its own command, so CmdCheckPrefix in policy
// marks a name that is data, not a catalog entry.
const (
	CheckNonemptyArtifact = "nonempty-artifact"
	CheckJSONValid        = "json-valid"
	CheckGoTest           = "go-test"
)

// BlockedSummary is what a check records when an earlier required check did not
// pass: a required check that did not pass stops every check after it.
const BlockedSummary = "Earlier required check did not pass"

// Blocks reports whether one verdict stops the required checks after it. Only a
// passing verdict lets the next check run.
func Blocks(verdict string) bool { return verdict != "passed" }

// PureCheck judges one preset that needs only the frozen snapshot: the presets
// that read the result bytes and run no process. It reports false for a name
// this package does not judge, so the core sends go-test and cmd: checks to its
// checker adapter.
func PureCheck(name string, snap Snapshot) (verdict, summary string, ok bool) {
	switch name {
	case CheckNonemptyArtifact:
		verdict, summary = nonemptyArtifact(snap)
		return verdict, summary, true
	case CheckJSONValid:
		verdict, summary = jsonValid(snap)
		return verdict, summary, true
	}
	return "", "", false
}

// nonemptyArtifact is the required preset: the attempt wrote a result that is
// UTF-8 text, not whitespace, and readable within the size limit.
func nonemptyArtifact(snap Snapshot) (string, string) {
	if snap.ArtifactErr != nil {
		return "failed", "Result unavailable: " + snap.ArtifactErr.Error()
	}
	if !utf8.Valid(snap.Artifact) || len(bytes.TrimSpace(snap.Artifact)) == 0 {
		return "failed", "Result must contain non-whitespace UTF-8 text"
	}
	return "passed", "Nonempty UTF-8 result exists"
}

// jsonValid is the preset that parses the result as exactly one JSON value.
func jsonValid(snap Snapshot) (string, string) {
	if !json.Valid(snap.Artifact) {
		return "failed", "Result is not one valid JSON value"
	}
	return "passed", "Result parses as one JSON value"
}

// DefinitionHash is the identity of one step definition: a check run proves the
// definition it started under, and an edited step invalidates that run.
func DefinitionHash(st Step) string {
	b, _ := json.Marshal(st)
	return Digest(b)
}

// AllPassed reports whether one recorded run proves this step: it ended, it
// covered this definition, it holds one result per declared check, in the
// declared order, and every one of them passed.
func AllPassed(v Verification, st Step) bool {
	if v.Ended == "" || v.DefinitionHash != DefinitionHash(st) || len(v.Results) != len(StepChecks(st)) {
		return false
	}
	for i, c := range StepChecks(st) {
		if v.Results[i].Check != c || v.Results[i].Verdict != "passed" {
			return false
		}
	}
	return true
}

// Verified is the evidence reuse gate: the last run on one attempt still proves
// its step. The run must have passed everything the step declares, the input
// must still fingerprint to the hash the run recorded, and every evidence file
// must still hash to the digest the run recorded for it. read answers one
// mission-relative vault path, so the ledger layout stays with the caller.
func Verified(a Attempt, st Step, snap Snapshot, read func(rel string) ([]byte, error)) bool {
	if len(a.Verifications) == 0 {
		return false
	}
	v := a.Verifications[len(a.Verifications)-1]
	if !AllPassed(v, st) || snap.Hash != v.SubjectHash {
		return false
	}
	for _, c := range v.Results {
		if c.Version != "1" || len(c.Evidence) == 0 {
			return false
		}
		for _, ev := range c.Evidence {
			b, e := read(ev.Path)
			if e != nil || Digest(b) != ev.Hash {
				return false
			}
		}
	}
	return true
}
