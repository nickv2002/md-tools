package unwrap

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestTransform(t *testing.T) {
	tests := []struct{ name, input, want string }{
		{"paragraph and breaks", "First line  \nsecond line\\\nthird line\n\nNext paragraph.\n", "First line second line third line\n\nNext paragraph.\n"},
		{"front matter and fence", "---\ntitle: Wrapped\n---\n# Heading\nParagraph line one\nline two\n\n```python\nvalue = (\n    1\n)\n```\n", "---\ntitle: Wrapped\n---\n# Heading\nParagraph line one line two\n\n```python\nvalue = (\n    1\n)\n```\n"},
		{"toml and html", "+++\ntitle = 'A'\n+++\n<div>\nraw\n</div>\n\nOne\ntwo\n", "+++\ntitle = 'A'\n+++\n<div>\nraw\n</div>\n\nOne two\n"},
		{"lists quotes and tables", "- First item\n  continuation\n  - Nested item\n    nested continuation\n- Second item\n\n> Quoted line\n> continued line\n\n| A | B |\n| --- | --- |\n| one | two |\n", "- First item continuation\n  - Nested item\n    nested continuation\n- Second item\n\n> Quoted line continued line\n\n| A | B |\n| --- | --- |\n| one | two |\n"},
		{"indented code and reference", "    code\n    line\n\n[ref]: https://example.com\n\nOne\ntwo", "    code\n    line\n\n[ref]: https://example.com\n\nOne two"},
		{"CRLF", "one\r\ntwo\r\n", "one two\r\n"},
		{"no final newline", "one\ntwo", "one two"},
		{"blank file", "", ""},
		{"escaped backslash", "one\\\\\ntwo", "one\\\\ two"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Transform(tt.input); got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestProcessFileAndDirectory(t *testing.T) {
	root := t.TempDir()
	changed := filepath.Join(root, "changed.md")
	unchanged := filepath.Join(root, "unchanged.markdown")
	ignored := filepath.Join(root, "ignored.txt")
	for path, data := range map[string]string{changed: "wrapped\ntext\n", unchanged: "one line\n", ignored: "wrapped\ntext\n"} {
		if err := os.WriteFile(path, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	var out bytes.Buffer
	called := false
	if err := Process(root, &out, func(n int) bool { called = true; return false }); err != nil {
		t.Fatal(err)
	}
	if !called || !strings.Contains(out.String(), "changed.md") || strings.Contains(out.String(), "unchanged.markdown") || strings.Contains(out.String(), "ignored.txt") {
		t.Fatalf("unexpected changed-file listing: %q", out.String())
	}
	data, _ := os.ReadFile(changed)
	if string(data) != "wrapped\ntext\n" {
		t.Fatal("declined rewrite changed the file")
	}
	if err := Process(root, &out, func(n int) bool { return n == 1 }); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(changed)
	if string(data) != "wrapped text\n" {
		t.Fatalf("got %q", data)
	}
	if err := Process(ignored, &out, func(int) bool { return true }); err == nil {
		t.Fatal("accepted a non-Markdown file")
	}
}

func TestPreflightReadFailure(t *testing.T) {
	root := t.TempDir()
	good := filepath.Join(root, "good.md")
	bad := filepath.Join(root, "bad.md")
	_ = os.WriteFile(good, []byte("one\ntwo\n"), 0644)
	_ = os.WriteFile(bad, []byte{0xff, 0xfe}, 0644)
	if err := Process(root, &bytes.Buffer{}, func(int) bool { t.Fatal("should not confirm"); return true }); err == nil {
		t.Fatal("accepted invalid UTF-8")
	}
	data, _ := os.ReadFile(good)
	if string(data) != "one\ntwo\n" {
		t.Fatal("preflight failure modified valid file")
	}
}

func TestAtomicWritePreservesModeAndReplacesInode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permissions")
	}
	path := filepath.Join(t.TempDir(), "note.md")
	_ = os.WriteFile(path, []byte("one\r\ntwo\r\n"), 0744)
	before, _ := os.Stat(path)
	if err := Process(path, &bytes.Buffer{}, nil); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(path)
	data, _ := os.ReadFile(path)
	if after.Mode().Perm() != 0744 || os.SameFile(before, after) || string(data) != "one two\r\n" {
		t.Fatalf("mode=%o same=%v data=%q", after.Mode().Perm(), os.SameFile(before, after), data)
	}
}

func TestRecursiveAndSymlinkSkip(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	_ = os.Mkdir(nested, 0755)
	file := filepath.Join(nested, "note.MARKDOWN")
	_ = os.WriteFile(file, []byte("one\ntwo"), 0644)
	_ = os.Symlink(file, filepath.Join(root, "link.md"))
	var out bytes.Buffer
	if err := Process(root, &out, func(n int) bool { return n == 1 }); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "nested/note.MARKDOWN") || strings.Contains(out.String(), "link.md") {
		t.Fatal(out.String())
	}
}
