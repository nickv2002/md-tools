package main

import (
	"bytes"
	"errors"
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

func pipeOf(t *testing.T, input string) *os.File {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		writer.WriteString(input)
		writer.Close()
	}()
	t.Cleanup(func() { reader.Close() })
	return reader
}

func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestInvalidUTF8IsRejected(t *testing.T) {
	bad := "ok \xff\xfe bytes\n"
	for name, args := range map[string][]string{"stdin": nil, "dash": {"-"}, "file": {writeFile(t, "bad.md", bad)}} {
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if got := runWithIO(args, pipeOf(t, bad), &stdout, &stderr); got != 1 {
				t.Fatalf("exit %d, want 1", got)
			}
			if stdout.Len() != 0 || !strings.Contains(stderr.String(), "invalid UTF-8") {
				t.Fatalf("stdout %q, stderr %q", stdout.String(), stderr.String())
			}
		})
	}
}

func TestUnreadableInputs(t *testing.T) {
	dir := t.TempDir()
	locked := filepath.Join(dir, "locked.md")
	if err := os.WriteFile(locked, []byte("# x\n"), 0o000); err != nil {
		t.Fatal(err)
	}
	if f, err := os.Open(locked); err == nil { // running as root ignores modes
		f.Close()
		locked = ""
	}
	tests := map[string]string{"missing": filepath.Join(dir, "nope.md"), "directory": dir, "locked": locked}
	for name, path := range tests {
		if path == "" {
			continue
		}
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if got := runWithIO([]string{path}, pipeOf(t, ""), &stdout, &stderr); got != 1 {
				t.Fatalf("exit %d, want 1", got)
			}
			if stdout.Len() != 0 || !strings.HasPrefix(stderr.String(), "md2mkdwn: ") {
				t.Fatalf("stdout %q, stderr %q", stdout.String(), stderr.String())
			}
		})
	}
}

type failingWriter struct{ err error }

func (w failingWriter) Write([]byte) (int, error) { return 0, w.err }

func TestWriterFailureReportsToStderr(t *testing.T) {
	var stderr bytes.Buffer
	got := runWithIO(nil, pipeOf(t, "# Heading\n"), failingWriter{errors.New("disk full")}, &stderr)
	if got != 1 || !strings.Contains(stderr.String(), "disk full") {
		t.Fatalf("exit %d, stderr %q", got, stderr.String())
	}
}

func TestEmptyInput(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if got := runWithIO([]string{writeFile(t, "empty.md", "")}, pipeOf(t, ""), &stdout, &stderr); got != 0 || stdout.String() != "\n" || stderr.Len() != 0 {
		t.Fatalf("empty file: exit %d, stdout %q, stderr %q", got, stdout.String(), stderr.String())
	}
	stdout.Reset()
	if got := runWithIO([]string{"-"}, pipeOf(t, "  \n\n"), &stdout, &stderr); got != 0 || stdout.String() != "\n" {
		t.Fatalf("blank stdin: exit %d, stdout %q", got, stdout.String())
	}
	stdout.Reset()
	if got := runWithIO([]string{writeFile(t, "fm.md", "---\na: 1\n---\n")}, pipeOf(t, ""), &stdout, &stderr); got != 0 || stdout.String() != "\n" {
		t.Fatalf("front matter only: exit %d, stdout %q", got, stdout.String())
	}
}

func TestStdinAndFileProduceIdenticalOutput(t *testing.T) {
	doc := "---\nt: x\n---\n# Title\n\n- a\n  - b\n\n| A | B |\n|---|---|\n| 日本 | [l](https://x.io) |\n\n```\n<!channel>\n```\n"
	path := writeFile(t, "doc.md", doc)
	var fromFile, fromStdin, fromDash, stderr bytes.Buffer
	for _, c := range []struct {
		args []string
		out  *bytes.Buffer
	}{{[]string{path}, &fromFile}, {nil, &fromStdin}, {[]string{"-"}, &fromDash}} {
		if got := runWithIO(c.args, pipeOf(t, doc), c.out, &stderr); got != 0 {
			t.Fatalf("%v: exit %d, stderr %q", c.args, got, stderr.String())
		}
	}
	if fromFile.String() != fromStdin.String() || fromFile.String() != fromDash.String() {
		t.Fatalf("outputs differ:\nfile:  %q\nstdin: %q\ndash:  %q", fromFile.String(), fromStdin.String(), fromDash.String())
	}
	if !strings.HasSuffix(fromFile.String(), "\n") || strings.HasSuffix(fromFile.String(), "\n\n") {
		t.Fatalf("want exactly one trailing newline: %q", fromFile.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("unexpected stderr %q", stderr.String())
	}
}

func TestFlagAndArgumentCombinations(t *testing.T) {
	file := writeFile(t, "a.md", "# A\n")
	dashName := filepath.Join(t.TempDir(), "-x.md")
	if err := os.WriteFile(dashName, []byte("# D\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name       string
		args       []string
		stdin      string
		wantCode   int
		wantStdout string // substring
		wantStderr string // substring
	}{
		{"version", []string{"--version"}, "", 0, "md2mkdwn ", ""},
		{"version wins over file", []string{"--version", file}, "", 0, "md2mkdwn ", ""},
		{"version single dash", []string{"-version"}, "", 0, "md2mkdwn ", ""},
		{"help", []string{"-h"}, "", 0, "", "Usage: md2mkdwn [FILE]"},
		{"long help", []string{"--help"}, "", 0, "", "Usage: md2mkdwn [FILE]"},
		{"unknown flag", []string{"--bogus"}, "", 2, "", "flag provided but not defined"},
		{"unknown flag with file", []string{"--bogus", file}, "", 2, "", "Usage: md2mkdwn [FILE]"},
		{"two files", []string{file, file}, "", 2, "", "Usage: md2mkdwn [FILE]"},
		{"dash and file", []string{"-", file}, "", 2, "", "Usage: md2mkdwn [FILE]"},
		{"file then flag is a second argument", []string{file, "--version"}, "", 2, "", "Usage: md2mkdwn [FILE]"},
		{"table width flag accepted", []string{"--max-table-width", "10", file}, "", 0, "*A*\n", ""},
		{"table width flag rejects negative", []string{"--max-table-width=-1", file}, "", 2, "", "must not be negative"},
		{"table width flag rejects text", []string{"--max-table-width=wide", file}, "", 2, "", "invalid value"},
		{"double dash then file", []string{"--", file}, "", 0, "*A*\n", ""},
		{"double dash allows dash-prefixed name", []string{"--", dashName}, "", 0, "*D*\n", ""},
		{"double dash then dash reads stdin", []string{"--", "-"}, "# S\n", 0, "*S*\n", ""},
		{"file ignores stdin", []string{file}, "# Other\n", 0, "*A*\n", ""},
		{"dash reads stdin", []string{"-"}, "# S\n", 0, "*S*\n", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			got := runWithIO(tt.args, pipeOf(t, tt.stdin), &stdout, &stderr)
			if got != tt.wantCode {
				t.Fatalf("exit %d, want %d (stdout %q, stderr %q)", got, tt.wantCode, stdout.String(), stderr.String())
			}
			if !strings.Contains(stdout.String(), tt.wantStdout) || !strings.Contains(stderr.String(), tt.wantStderr) {
				t.Fatalf("stdout %q, stderr %q", stdout.String(), stderr.String())
			}
			if tt.wantCode == 2 && stdout.Len() != 0 {
				t.Fatalf("usage errors must not write stdout: %q", stdout.String())
			}
		})
	}
}

func TestMaxTableWidthFlagSwitchesWideTables(t *testing.T) {
	doc := "| Name | Detail |\n|---|---|\n| alpha | a fairly long description here |\n"
	run := func(args ...string) string {
		var stdout, stderr bytes.Buffer
		if got := runWithIO(append(args, "-"), pipeOf(t, doc), &stdout, &stderr); got != 0 {
			t.Fatalf("exit %d, stderr %q", got, stderr.String())
		}
		return stdout.String()
	}
	if got := run(); !strings.HasPrefix(got, "```\n") {
		t.Fatalf("default keeps a narrow table as a grid: %q", got)
	}
	if got := run("--max-table-width", "10"); got != "*alpha*\nDetail: a fairly long description here\n" {
		t.Fatalf("narrow limit should produce records: %q", got)
	}
	if got := run("--max-table-width=0"); !strings.HasPrefix(got, "```\n") {
		t.Fatalf("0 disables the fallback: %q", got)
	}
}
