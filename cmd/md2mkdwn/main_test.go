package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLI(t *testing.T) {
	if run([]string{"--help"}) != 0 || run([]string{"--version"}) != 0 {
		t.Fatal("help/version failed")
	}
	if run([]string{"a", "b"}) != 2 || run([]string{"missing-file.md"}) != 1 {
		t.Fatal("invalid input accepted")
	}
	path := filepath.Join(t.TempDir(), "notes.md")
	_ = os.WriteFile(path, []byte("# Heading\n"), 0644)
	if run([]string{path}) != 0 {
		t.Fatal("file conversion failed")
	}
}

func TestBareAndPipedInvocation(t *testing.T) {
	devNull, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatal(err)
	}
	defer devNull.Close()

	var stdout, stderr bytes.Buffer
	if got := runWithIO(nil, devNull, &stdout, &stderr); got != 0 || !strings.Contains(stdout.String(), "Usage: md2mkdwn [FILE]") || stderr.Len() != 0 {
		t.Fatalf("bare invocation: exit %d, stdout %q, stderr %q", got, stdout.String(), stderr.String())
	}

	pipeInput := func(input string) *os.File {
		t.Helper()
		reader, writer, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.WriteString(input); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { reader.Close() })
		return reader
	}

	stdout.Reset()
	if got := runWithIO(nil, pipeInput("# Heading\n"), &stdout, &stderr); got != 0 || stdout.String() != "*Heading*\n" {
		t.Fatalf("piped input: exit %d, stdout %q, stderr %q", got, stdout.String(), stderr.String())
	}

	stdout.Reset()
	if got := runWithIO(nil, pipeInput(""), &stdout, &stderr); got != 0 || !strings.Contains(stdout.String(), "Usage: md2mkdwn [FILE]") {
		t.Fatalf("empty pipe: exit %d, stdout %q, stderr %q", got, stdout.String(), stderr.String())
	}

	stdout.Reset()
	if got := runWithIO([]string{"-"}, pipeInput(""), &stdout, &stderr); got != 0 || strings.Contains(stdout.String(), "Usage:") {
		t.Fatalf("explicit stdin: exit %d, stdout %q, stderr %q", got, stdout.String(), stderr.String())
	}
}
