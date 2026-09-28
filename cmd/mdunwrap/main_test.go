package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLI(t *testing.T) {
	if run([]string{"--help"}) != 0 || run([]string{"--version"}) != 0 {
		t.Fatal("help/version failed")
	}
	if run([]string{"a", "b"}) != 2 {
		t.Fatal("invalid argument count accepted")
	}
	stdout, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer stdout.Close()
	if got := runWithIO(nil, os.Stdin, stdout, os.Stderr); got != 0 {
		t.Fatalf("bare invocation exited %d", got)
	}
	output, err := os.ReadFile(stdout.Name())
	if err != nil || !strings.Contains(string(output), "Usage: mdunwrap FILE|DIRECTORY") {
		t.Fatalf("bare invocation printed %q: %v", output, err)
	}
	root := t.TempDir()
	notes := filepath.Join(root, "notes.md")
	other := filepath.Join(root, "notes.txt")
	_ = os.WriteFile(notes, []byte("a\nb\n"), 0644)
	_ = os.WriteFile(other, []byte("a\nb\n"), 0644)
	if run([]string{other}) != 1 || run([]string{notes}) != 0 {
		t.Fatal("file validation or rewrite failed")
	}
	data, _ := os.ReadFile(notes)
	if string(data) != "a b\n" {
		t.Fatalf("got %q", data)
	}
}
