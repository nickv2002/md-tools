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
	return runWithIO(args, os.Stdin, os.Stdout, os.Stderr)
}

func runWithIO(args []string, stdin *os.File, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("md2mkdwn", flag.ContinueOnError)
	flags.SetOutput(stderr)
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
		fmt.Fprintln(stdout, "md2mkdwn", cli.Version)
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
		if flags.NArg() == 0 {
			info, statErr := stdin.Stat()
			if statErr != nil {
				fmt.Fprintln(stderr, "md2mkdwn:", statErr)
				return 1
			}
			if info.Mode()&os.ModeCharDevice != 0 {
				flags.SetOutput(stdout)
				flags.Usage()
				return 0
			}
		}
		input, err = io.ReadAll(stdin)
	}
	if err != nil {
		fmt.Fprintln(stderr, "md2mkdwn:", err)
		return 1
	}
	if flags.NArg() == 0 && len(input) == 0 {
		flags.SetOutput(stdout)
		flags.Usage()
		return 0
	}
	if !utf8.Valid(input) {
		fmt.Fprintln(stderr, "md2mkdwn: invalid UTF-8 input")
		return 1
	}
	if _, err := io.WriteString(stdout, slack.Convert(input)); err != nil {
		fmt.Fprintln(stderr, "md2mkdwn:", err)
		return 1
	}
	return 0
}
