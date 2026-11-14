package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

const version = "0.1.0"

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	if len(args) > 0 {
		switch args[0] {
		case "ui":
			return cmdUI(args[1:])
		case "help", "-h", "--help":
			usage(os.Stdout)
			return 0
		case "version", "--version":
			fmt.Println("quicknote " + version)
			return 0
		}
	}
	return cmdCapture(args)
}

func usage(w io.Writer) {
	fmt.Fprint(w, `quicknote - capture fleeting notes into the vault

  quicknote <text...>        write one note (agent, script, or shell)
  quicknote                  open the capture box (terminal only)
  quicknote ui               open the capture box


Capture flags:
  --json            print the result as JSON
  --vault DIR       vault root (default $QUICKNOTE_VAULT, then ~/vault)
  --dry-run         report the entry without writing

UI flags:
  --dry-run         show what would be saved, then exit
  --text TEXT       prefill the input (handy for --render)
  --render          print one frame and exit (--width, --height, --blurred)
`)
}

// cmdCapture is the non-interactive path. It never draws, so an agent or a pipe
// can use it.
func cmdCapture(args []string) int {
	fs := flag.NewFlagSet("quicknote", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	jsonOut := fs.Bool("json", false, "print the result as JSON")
	vault := fs.String("vault", "", "vault root")
	dry := fs.Bool("dry-run", false, "report the note without writing")
	detail := fs.String("body", "", "detail for the note body")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	text := strings.Join(fs.Args(), " ")
	if len(fs.Args()) == 0 && strings.TrimSpace(text) == "" {
		// A pipe supplies the note; a bare terminal means the human wants the box.
		if terminal(os.Stdin) {
			return cmdUIWith(*vault, false, "", false, false, 0, 0)
		}
		piped, err := io.ReadAll(os.Stdin)
		if err != nil {
			return check(err)
		}
		text = string(piped)
	}
	// The first line names the note; every line after it is detail.
	parts := strings.SplitN(strings.ReplaceAll(text, "\r\n", "\n"), "\n", 2)
	title := strings.TrimSpace(parts[0])
	body := strings.TrimSpace(*detail)
	if len(parts) > 1 {
		rest := strings.TrimSpace(parts[1])
		if body != "" && rest != "" {
			body = rest + "\n" + body
		} else if rest != "" {
			body = rest
		}
	}
	if title == "" {
		fmt.Fprintln(os.Stderr, "quicknote: empty note")
		return 2
	}
	res, err := Append(vaultDir(*vault), Entry{Title: title, Body: body}, *dry)
	if err != nil {
		return check(err)
	}
	report(res, *jsonOut)
	return 0
}

func cmdUI(args []string) int {
	fs := flag.NewFlagSet("quicknote ui", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	vault := fs.String("vault", "", "vault root")
	dry := fs.Bool("dry-run", false, "show what would be saved")
	text := fs.String("text", "", "prefill the input")
	render := fs.Bool("render", false, "print one frame and exit")
	blurred := fs.Bool("blurred", false, "render the unfocused palette")
	width := fs.Int("width", 70, "frame width for --render")
	height := fs.Int("height", 10, "frame height for --render")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	return cmdUIWith(*vault, *dry, *text, *render, *blurred, *width, *height)
}

func cmdUIWith(vault string, dry bool, text string, render, blurred bool, width, height int) int {
	final, err := runUI(dry, text, vaultDir(vault), render, blurred, width, height)
	if err != nil {
		return check(err)
	}
	if final.done {
		report(final.result, false)
	}
	return 0
}

func jsonText(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"ok":false}`
	}
	return string(b)
}

// terminal reports whether f is a character device, so the box never opens into
// a pipe.
func terminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}
