package ssm

import (
	"errors"
	"fmt"
	"strings"
)

// The control plane runs an SSM document, and the document this package uses is
// AWS-RunShellScript, which carries shell text. So a string has to exist
// somewhere. What must not exist is *interpolation*: a provider value spliced
// into that text where a shell would read it again.
//
// Hence command: every remote call is written as an argument array first, each
// element is refused unless it is a bare word from a fixed safe set, and only then
// is the array rendered, with single quotes around every element. A value that
// carries a space, a quote, a `$`, a `;`, or a backtick is refused rather than
// escaped: nothing in this package needs one, and a refusal is auditable where an
// escape is a puzzle an operator has to re-derive.
type command []string

// safeArgBytes is the set an argument may be made of. It covers a store path, a
// flake reference, a unit name, an account@machine string, and an env assignment,
// and it excludes every byte a shell would treat as syntax if the quoting were
// ever lost: no whitespace, no quotes, no `$`, no backtick, no `;`, `|`, `<`, `>`,
// `(`, `)`, `\`, `*`, `~`, or `!`. `#`, `?`, `&`, `=`, `+`, `,`, `%`, `^`, `@`,
// `:`, `/`, `.`, `_`, and `-` stay, because flake references and paths need them;
// so do `=`, `,`, `%`, and `+`, which a flake reference or an env assignment can
// contain. `#` stays because a flake attribute path needs it, and it is inert
// inside a quoted word.
const safeArgBytes = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./_-:@+=,%#"

// remotePath is the PATH every remote program runs with.
//
// The SSM agent runs as root with a minimal environment, and the nix profile
// binary directory is not on it: a deploy that could not find `nix` would fail on
// a host that is perfectly healthy. It is a fixed value, which is why it can be
// written here without becoming interpolation. `/snap/bin` is there for the
// snap-installed AWS CLI the enrollment script also needs.
const remotePath = "/nix/var/nix/profiles/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

// scriptPrelude is the fixed prologue of every remote call.
//
// `set -eu` stops a partly built command from doing half its work; `set +x`
// disables shell tracing before anything runs, so no command line can reach the
// invocation's stderr and from there SSM command history.
const scriptPrelude = "set -eu\nset +x\nPATH='" + remotePath + "'\nexport PATH\n"

// render turns an argument array into the program text one SSM invocation runs.
//
// The result is `exec 'arg0' 'arg1' ...`: one program, its arguments passed as
// words the shell cannot re-read, and the program's exit code as the invocation's
// because `exec` replaces the shell.
func (c command) render() (string, error) {
	if len(c) == 0 {
		return "", errors.New("ssm: refusing an empty command")
	}
	var b strings.Builder
	b.WriteString(scriptPrelude)
	b.WriteString("exec")
	for _, arg := range c {
		if err := validateArg(arg); err != nil {
			return "", err
		}
		if arg == "" {
			return "", errors.New("ssm: refusing an empty argument: an empty word cannot be quoted into one")
		}
		b.WriteString(" '")
		b.WriteString(arg)
		b.WriteString("'")
	}
	b.WriteString("\n")
	return b.String(), nil
}

// validateArg refuses an argument that is not a bare word. The refusal is the
// security property: nothing in this package ever escapes a value into the
// program text.
func validateArg(arg string) error {
	for _, r := range arg {
		if !strings.ContainsRune(safeArgBytes, r) {
			return fmt.Errorf("ssm: refusing argument %q: %q is not a bare word a shell cannot re-read", arg, r)
		}
	}
	return nil
}

// validated normalizes an argv that arrives from configuration rather than from
// this package's own constants, so a bad switch command fails at construction
// instead of at the first deploy.
func validateArgv(argv []string) error {
	if len(argv) == 0 {
		return errors.New("ssm: refusing an empty argument array")
	}
	for _, arg := range argv {
		if arg == "" {
			return errors.New("ssm: refusing an empty argument array element")
		}
		if err := validateArg(arg); err != nil {
			return err
		}
	}
	return nil
}
