package ssm

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

// TestCommandRenderKeepsEveryArgumentOneWord is the argv property, stated as an
// assertion: a rendered call is `exec` plus one single-quoted word per element, so
// the shell that finally runs it cannot split, expand, or redirect any of them.
func TestCommandRenderKeepsEveryArgumentOneWord(t *testing.T) {
	t.Parallel()
	argv := command{
		"systemctl", "--user", "-M", "ubuntu@.host", "is-active", "rex-serve",
	}
	program, err := argv.render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(program, "set +x\n") {
		t.Fatal("the program does not disable shell tracing: a traced line reaches SSM command history")
	}
	if !strings.Contains(program, "PATH=") {
		t.Fatal("the program does not pin PATH: the SSM agent environment has neither nix nor the aws cli")
	}
	line := program[strings.Index(program, "exec ")+len("exec "):]
	line = strings.TrimSuffix(line, "\n")
	if got, want := line, "'systemctl' '--user' '-M' 'ubuntu@.host' 'is-active' 'rex-serve'"; got != want {
		t.Fatalf("program line = %s, want %s", got, want)
	}
	// Round-trip: the words the shell will see are exactly the arguments.
	words := quotedWords(t, line)
	if len(words) != len(argv) {
		t.Fatalf("rendered %d words, want %d", len(words), len(argv))
	}
	for i := range argv {
		if words[i] != argv[i] {
			t.Fatalf("word %d = %q, want %q", i, words[i], argv[i])
		}
	}
}

// TestCommandRenderRefusesShellMetacharacters is the other half of that property:
// a value that carries shell syntax is refused rather than escaped, so no argument
// can ever become a second command, a pipeline, a redirection, or an expansion.
func TestCommandRenderRefusesShellMetacharacters(t *testing.T) {
	t.Parallel()
	bad := map[string]string{
		"space":           "two words",
		"tab":             "two\twords",
		"newline":         "two\nwords",
		"semicolon":       "rex;rm -rf /",
		"pipe":            "rex|tee",
		"ampersand":       "rex&&id",
		"dollar":          "$(id)",
		"backtick":        "`id`",
		"single quote":    "a'b",
		"double quote":    "a\"b",
		"backslash":       "a\\b",
		"redirect":        "a>out",
		"input redirect":  "a<in",
		"glob":            "a*",
		"brace":           "a{b}",
		"paren":           "a(b)",
		"bang":            "a!b",
		"tilde":           "~root",
		"caret":           "a^b",
		"carriage return": "a\rb",
	}
	for name, arg := range bad {
		arg := arg
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := (command{"tailscale", arg}).render(); err == nil {
				t.Fatalf("%q was rendered; every one of these must be refused", arg)
			}
		})
	}
}

// TestCommandRenderAcceptsAFlakeReference pins the documented contract of the safe
// set against the value that actually has to reach a remote host: a flake
// reference carries both a query (`?rev=`) and an attribute path (`#`), and a
// refusal of either byte refuses the whole deploy. The `#` case is here beside the
// `?` case so the two exceptions cannot drift apart, and the refusals below it are
// the bytes that still have to be gone.
func TestCommandRenderAcceptsAFlakeReference(t *testing.T) {
	t.Parallel()
	updated := "git+https://github.com/example/dotfiles?rev=0123456789abcdef0123456789abcdef01234567#homeConfigurations.remote-mumbai.activationPackage"
	attribute := "git+https://github.com/example/dotfiles/archive/0123456789abcdef0123456789abcdef01234567.tar.gz#homeConfigurations.remote-mumbai.activationPackage"
	for _, arg := range []string{updated, attribute} {
		arg := arg
		t.Run("accepted", func(t *testing.T) {
			t.Parallel()
			program, err := (command{"nix", "profile", "add", arg}).render()
			if err != nil {
				t.Fatalf("flake reference %q was refused: %v", arg, err)
			}
			if !strings.Contains(program, "'"+arg+"'") {
				t.Fatalf("flake reference %q is not one quoted word in %q", arg, program)
			}
		})
	}
	refused := map[string]string{
		"semicolon": "a?rev=1;id",
		"ampersand": "a?rev=1&&id",
		"backtick":  "a?rev=`id`",
		"dollar":    "a?rev=$(id)",
		"newline":   "a?rev=1\nid",
	}
	for name, arg := range refused {
		arg := arg
		t.Run("refused "+name, func(t *testing.T) {
			t.Parallel()
			if _, err := (command{"nix", "profile", "add", arg}).render(); err == nil {
				t.Fatalf("%q was rendered; a query-bearing reference must not carry shell syntax", arg)
			}
		})
	}
}

// TestCommandRenderRefusesAnEmptyCommand: there is no such thing as a program with
// no program.
func TestCommandRenderRefusesAnEmptyCommand(t *testing.T) {
	t.Parallel()
	empty := command{}
	if _, err := empty.render(); err == nil {
		t.Fatal("an empty command was rendered")
	}
	blank := command{"tailscale", ""}
	if _, err := blank.render(); err == nil {
		t.Fatal("an empty argument was rendered: it would not survive as a word")
	}
}

// TestConfiguredSwitchIsValidatedAtConstruction: the switch command comes from
// configuration, so a bad one has to fail when the worker starts instead of at the
// first deploy.
func TestConfiguredSwitchIsValidatedAtConstruction(t *testing.T) {
	t.Parallel()
	if err := validateArgv([]string{"nix", "run"}); err != nil {
		t.Fatalf("a safe argv was refused: %v", err)
	}
	for _, argv := range []command{{}, {"nix", "run; id"}, {"nix", ""}} {
		if err := validateArgv(argv); err == nil {
			t.Fatalf("argv %v was accepted", argv)
		}
	}
}

// TestParseServeStatusReadsTheOperatorSurface pins the parser to the text
// `tailscale serve status` prints, in both shapes the CLI has used, and refuses a
// mapping that points anywhere but the profile's loopback listener.
func TestParseServeStatusReadsTheOperatorSurface(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		status  string
		wantURL string
		wantMap string
		wantOK  bool
	}{
		{
			name:    "bracketed tailnet-only form",
			status:  "https://rex-1.tail1234.ts.net (tailnet only)\n|-- / proxy http://127.0.0.1:7297\n",
			wantURL: "https://rex-1.tail1234.ts.net",
			wantMap: "127.0.0.1:7297",
			wantOK:  true,
		},
		{
			name:    "trailing slash form",
			status:  "https://rex-1.tail1234.ts.net/\n|-- / proxy http://127.0.0.1:7297",
			wantURL: "https://rex-1.tail1234.ts.net",
			wantMap: "127.0.0.1:7297",
			wantOK:  true,
		},
		{
			name:    "wrong loopback port",
			status:  "https://rex-1.tail1234.ts.net\n|-- / proxy http://127.0.0.1:8080",
			wantURL: "https://rex-1.tail1234.ts.net",
			wantMap: "127.0.0.1:8080",
			wantOK:  true,
		},
		{
			name:    "explicit port is not the default address",
			status:  "https://rex-1.tail1234.ts.net:8443\n|-- / proxy http://127.0.0.1:7297",
			wantURL: "",
			wantMap: "",
			wantOK:  false,
		},
		{
			name:    "not running",
			status:  "# Tailscale Serve is not running\n",
			wantURL: "",
			wantMap: "",
			wantOK:  false,
		},
	}
	for _, testCase := range cases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			url, mapping, ok := parseServeStatus(testCase.status)
			if ok != testCase.wantOK {
				t.Fatalf("ok = %v, want %v (status %q)", ok, testCase.wantOK, testCase.status)
			}
			if url != testCase.wantURL || mapping != testCase.wantMap {
				t.Fatalf("url, mapping = %q, %q; want %q, %q", url, mapping, testCase.wantURL, testCase.wantMap)
			}
		})
	}
}

// TestRenderedProgramIsSafeInARealShell executes a rendered call through /bin/sh
// and checks what the program actually received. It is the end-to-end proof that
// the quoting holds: no test double stands between the renderer and a shell.
func TestRenderedProgramIsSafeInARealShell(t *testing.T) {
	t.Parallel()
	witness := t.TempDir() + "/witness.sh"
	if err := writeExecutable(witness, "#!/bin/sh\nprintf '%s\\n' \"$#\"\nprintf '%s\\n' \"$@\"\n"); err != nil {
		t.Fatalf("write witness: %v", err)
	}
	program, err := command{witness, "a#b", "ubuntu@.host", "127.0.0.1:7297"}.render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	out, err := exec.Command("/bin/sh", "-c", program).Output()
	if err != nil {
		t.Fatalf("run rendered program: %v", err)
	}
	lines := strings.Split(strings.TrimSuffix(string(out), "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("program received %d lines, want a count plus three words: %q", len(lines), out)
	}
	if lines[0] != "3" {
		t.Fatalf("program received %s arguments, want 3", lines[0])
	}
	want := []string{"a#b", "ubuntu@.host", "127.0.0.1:7297"}
	for i, word := range want {
		if lines[i+1] != word {
			t.Fatalf("argument %d = %q, want %q", i, lines[i+1], word)
		}
	}
}

// quotedWords recovers the words a rendered program line passes to its program.
// No argument may contain a quote — that is what the renderer refuses — so a
// single-quote scan is exact.
func quotedWords(t *testing.T, line string) []string {
	t.Helper()
	var words []string
	for {
		open := strings.Index(line, "'")
		if open < 0 {
			return words
		}
		rest := line[open+1:]
		close := strings.Index(rest, "'")
		if close < 0 {
			t.Fatalf("unbalanced quoting in %q", line)
		}
		words = append(words, rest[:close])
		line = rest[close+1:]
	}
}

// writeExecutable writes one helper program for the real-shell test.
func writeExecutable(path, body string) error {
	return os.WriteFile(path, []byte(body), 0o700)
}
