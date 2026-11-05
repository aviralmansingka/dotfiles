package platform

import (
	"fmt"
	"io"
	"os"
)

// BoundedFile reads one whole regular file, refusing anything that is not a
// regular file or that exceeds limit bytes. It reads one byte past the limit, so
// a file that grew after the size check is still refused. The vault artifact
// read and the checkout snapshot both use it: neither may load an unbounded
// file from a path it does not control.
func BoundedFile(p string, limit int64) ([]byte, error) {
	st, e := os.Lstat(p)
	if e != nil {
		return nil, e
	}
	if !st.Mode().IsRegular() {
		return nil, fmt.Errorf("not a regular file: %s", p)
	}
	if st.Size() > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	f, e := os.Open(p)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, limit+1))
	if len(b) > int(limit) {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	return b, e
}
