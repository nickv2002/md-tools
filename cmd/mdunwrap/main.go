package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/nickv2002/md-tools/internal/cli"
	"github.com/nickv2002/md-tools/internal/unwrap"
)

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	return runWithIO(args, os.Stdin, os.Stdout, os.Stderr)
}

func runWithIO(args []string, stdin, stdout *os.File, stderr io.Writer) int {
	flags := flag.NewFlagSet("mdunwrap", flag.ContinueOnError)
	flags.SetOutput(stderr)
	version := flags.Bool("version", false, "print version")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "Usage: mdunwrap FILE|DIRECTORY")
		fmt.Fprintln(flags.Output(), "Remove hard-wrapped Markdown prose in place. Directories require confirmation.")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *version {
		fmt.Fprintln(stdout, "mdunwrap", cli.Version)
		return 0
	}
	if flags.NArg() == 0 {
		flags.SetOutput(stdout)
		flags.Usage()
		return 0
	}
	if flags.NArg() != 1 {
		flags.Usage()
		return 2
	}
	if err := unwrap.Process(flags.Arg(0), stdout, func(n int) bool { return unwrap.ConfirmTTY(stdin, stdout, n) }); err != nil {
		fmt.Fprintln(stderr, "mdunwrap:", err)
		return 1
	}
	return 0
}
