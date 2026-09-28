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
	if run(nil) != 2 || run([]string{"a", "b"}) != 2 {
		t.Fatal("invalid argument count accepted")
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
