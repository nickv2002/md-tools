package main

import (
	"os"
	"path/filepath"
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
