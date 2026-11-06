// Package pisession reads the identity a Pi session file records.
//
// A Pi session file is JSON lines, and its first line is the session header: the
// type, the session id, and the working directory the session runs in. That
// header is the only part the mission CLI reads, and the core decides what it
// proves: the type must be a session, the id must be the attached session, and
// the directory must be the mission worktree.
package pisession

import (
	"bufio"
	"encoding/json"
	"io"
	"os"

	"mission.local/prototype/internal/domain/mission"
)

// HeaderLimit bounds the first line a header read accepts. A session header is a
// short identity record, so a longer first line is not one.
const HeaderLimit = 65536

// Header reads the session header. A file with no first line reports io.EOF in
// mission.SessionHeader.HeaderErr, and a first line that does not decode reports
// the decode error there, so the core keeps the refusal each one earns. Only a
// file that cannot be opened reports an error instead of a header.
func Header(file string) (mission.SessionHeader, error) {
	f, e := os.Open(file)
	if e != nil {
		return mission.SessionHeader{}, e
	}
	defer f.Close()
	scan := bufio.NewScanner(f)
	scan.Buffer(make([]byte, 4096), HeaderLimit)
	if !scan.Scan() {
		return mission.SessionHeader{HeaderErr: io.EOF}, nil
	}
	var h mission.SessionHeader
	if e := json.Unmarshal(scan.Bytes(), &h); e != nil {
		return mission.SessionHeader{HeaderErr: e}, nil
	}
	return h, nil
}
