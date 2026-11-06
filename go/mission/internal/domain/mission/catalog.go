package mission

// CheckoutState is how an existing path relates to a mission branch: not a
// checkout at that path at all, already on the branch, a clean detached HEAD at
// the branch tip, a detached HEAD with local changes, or a checkout on another
// branch or commit.
type CheckoutState string

// The five states a checkout can be in. Only a checkout that already is the
// mission branch, or a clean detached HEAD at its tip, carries no work of its
// own, so the core adopts those two and refuses the rest.
const (
	CheckoutNone     CheckoutState = ""         // not a checkout at this path
	CheckoutSame     CheckoutState = "same"     // already on the mission branch
	CheckoutDetached CheckoutState = "detached" // clean detached HEAD at the branch tip
	CheckoutDirty    CheckoutState = "dirty"    // detached HEAD with local changes
	CheckoutOther    CheckoutState = "other"    // a checkout on another branch or commit
)

// A SessionHeader is the identity Pi writes as the first line of a session
// file. A file that holds no such identity still answers with one: HeaderErr
// says why not — io.EOF when the file has no first line at all, and the decode
// error when the first line is not a session header — so the core keeps the
// refusal each one earns.
type SessionHeader struct {
	Type string
	ID   string
	Cwd  string
	// HeaderErr is what the file could not give: no first line, or a first
	// line that does not decode.
	HeaderErr error `json:"-"`
}

// Catalog is the port through which the mission core reaches Git and the host
// it runs on. It answers facts only, and names domain types, so a test can
// answer for a second host and an adapter can be a real Git or a recording one.
//
// The adapter behind it owns the Git commands and their arguments. The core
// owns every policy: which branch a mission owns, where its checkout lives,
// which missions may share a worktree, and the codes and texts of the refusals.
type Catalog interface {
	// Common is the repository's common Git directory, symlink-resolved, so two
	// checkouts of one repository answer the same path.
	Common(cwd string) (string, error)
	// Branch is the branch checked out at cwd, and "" at a detached HEAD.
	Branch(cwd string) (string, error)
	// State classifies an existing path against a mission branch without
	// touching its working tree.
	State(cwd, branch string) (CheckoutState, error)
	// Holder is the checkout that has branch checked out, and "" when the
	// branch is free. A branch has at most one worktree, because a second
	// checkout would be a second writer.
	Holder(checkout, branch string) (string, error)
	// Ref is the commit id of one local branch, and an error when that branch
	// does not exist.
	Ref(checkout, name string) (string, error)
	// ValidBranch is Git's verdict on one branch name.
	ValidBranch(checkout, name string) error
	// Checkout is the root of the working tree that holds cwd and the Git
	// directory that checkout uses, both symlink-resolved. A checkout is the
	// repository's primary one when its Git directory is the common one, and
	// cwd sits at its root when that root is cwd.
	Checkout(cwd string) (root, gitDir string, err error)
	// Owner is the ownership marker one branch carries, and "" when it carries
	// none: an unreadable marker means no marker, never a failed binding.
	Owner(checkout, branch string) (string, error)
	// SessionHeader is the identity Pi wrote into a session file.
	SessionHeader(file string) (SessionHeader, error)
	// Machine is the host name that binds a record to one machine.
	Machine() string
}

// Workspace is the command side of the catalog: the Git commands that create a
// mission branch and keep its checkout. The core decides when each one runs and
// what it means; the adapter runs it.
type Workspace interface {
	// CreateBranch creates one branch at one base.
	CreateBranch(checkout, branch, base string) error
	// MarkOwner records which mission owns a branch, under the key
	// branch.<branch>.missionOwner.
	MarkOwner(checkout, branch, owner string) error
	// Ensure keeps the mission checkout at cwd, or revives a deleted one,
	// without ever switching a checkout that carries work of its own.
	Ensure(checkout, cwd, branch string) error
}
