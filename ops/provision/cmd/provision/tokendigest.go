package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

func runTokenDigest(args []string) error {
	flags := flag.NewFlagSet("token-digest", flag.ContinueOnError)
	if err := flags.Parse(args); err != nil {
		return err
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return fmt.Errorf("read token from stdin: %w", err)
		}
		return errors.New("read token from stdin: empty input")
	}
	token := strings.TrimSpace(scanner.Text())
	if token == "" {
		return errors.New("read token from stdin: empty token")
	}
	fmt.Println(application.TokenDigest(token))
	return nil
}
