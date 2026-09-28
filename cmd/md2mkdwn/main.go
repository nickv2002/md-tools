package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"unicode/utf8"

	"github.com/nickv2002/md-tools/internal/cli"
	"github.com/nickv2002/md-tools/internal/slack"
)

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	flags := flag.NewFlagSet("md2mkdwn", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	version := flags.Bool("version", false, "print version")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "Usage: md2mkdwn [FILE]")
		fmt.Fprintln(flags.Output(), "Convert Markdown from FILE or stdin to Slack mrkdwn on stdout.")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *version {
		fmt.Println("md2mkdwn", cli.Version)
		return 0
	}
	if flags.NArg() > 1 {
		flags.Usage()
		return 2
	}
	var input []byte
	var err error
	if flags.NArg() == 1 && flags.Arg(0) != "-" {
		input, err = os.ReadFile(flags.Arg(0))
	} else {
		input, err = io.ReadAll(os.Stdin)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "md2mkdwn:", err)
		return 1
	}
	if !utf8.Valid(input) {
		fmt.Fprintln(os.Stderr, "md2mkdwn: invalid UTF-8 input")
		return 1
	}
	if _, err := io.WriteString(os.Stdout, slack.Convert(input)); err != nil {
		fmt.Fprintln(os.Stderr, "md2mkdwn:", err)
		return 1
	}
	return 0
}
