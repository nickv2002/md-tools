package unwrap

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

type change struct {
	path string
	data []byte
}

func markdown(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".md" || ext == ".markdown"
}

func readChange(path string) (change, bool, error) {
	original, err := os.ReadFile(path)
	if err != nil {
		return change{}, false, fmt.Errorf("read %s: %w", path, err)
	}
	if !utf8.Valid(original) {
		return change{}, false, fmt.Errorf("read %s: invalid UTF-8", path)
	}
	transformed := []byte(Transform(string(original)))
	if string(transformed) == string(original) {
		return change{}, false, nil
	}
	return change{path: path, data: transformed}, true, nil
}

func atomicWrite(path string, data []byte) (err error) {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular file: %s", path)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if _, err = tmp.Write(data); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	mode := info.Mode() & (os.ModePerm | os.ModeSetuid | os.ModeSetgid | os.ModeSticky)
	if err = tmp.Chmod(mode); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func findMarkdown(root string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type().IsRegular() && markdown(path) {
			paths = append(paths, path)
		}
		return nil
	})
	sort.Slice(paths, func(i, j int) bool {
		return strings.ToLower(paths[i]) < strings.ToLower(paths[j])
	})
	return paths, err
}

// Process writes a file immediately, or preflights a directory and asks once before writing.
// confirm is called only when a directory contains changed files.
func Process(path string, out io.Writer, confirm func(int) bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		paths, err := findMarkdown(path)
		if err != nil {
			return err
		}
		var changes []change
		for _, candidate := range paths {
			item, changed, err := readChange(candidate)
			if err != nil {
				return err
			}
			if changed {
				changes = append(changes, item)
			}
		}
		if len(changes) == 0 {
			_, _ = fmt.Fprintln(out, "No changes needed.")
			return nil
		}
		_, _ = fmt.Fprintf(out, "Markdown files to rewrite (%d):\n", len(changes))
		for _, item := range changes {
			rel, _ := filepath.Rel(path, item.path)
			_, _ = fmt.Fprintf(out, "  %s\n", rel)
		}
		if !confirm(len(changes)) {
			_, _ = fmt.Fprintln(out, "No files changed.")
			return nil
		}
		for _, item := range changes {
			if err := atomicWrite(item.path, item.data); err != nil {
				return fmt.Errorf("rewrite %s: %w", item.path, err)
			}
		}
		_, _ = fmt.Fprintf(out, "Rewrote %d Markdown files.\n", len(changes))
		return nil
	}
	if !info.Mode().IsRegular() || !markdown(path) {
		return errors.New("expected a regular .md or .markdown file or a directory")
	}
	item, changed, err := readChange(path)
	if err != nil {
		return err
	}
	if !changed {
		_, _ = fmt.Fprintf(out, "No changes needed: %s\n", path)
		return nil
	}
	if err := atomicWrite(path, item.data); err != nil {
		return fmt.Errorf("rewrite %s: %w", path, err)
	}
	_, _ = fmt.Fprintf(out, "Rewrote: %s\n", path)
	return nil
}

// ConfirmTTY prompts only when both input and output are terminals.
func ConfirmTTY(in *os.File, out *os.File, count int) bool {
	inInfo, inErr := in.Stat()
	outInfo, outErr := out.Stat()
	if inErr != nil || outErr != nil || inInfo.Mode()&os.ModeCharDevice == 0 || outInfo.Mode()&os.ModeCharDevice == 0 {
		_, _ = fmt.Fprintln(os.Stderr, "Refusing directory rewrite without interactive confirmation.")
		return false
	}
	_, _ = fmt.Fprintf(out, "Rewrite these %d file(s)? [y/N] ", count)
	answer, _ := bufio.NewReader(in).ReadString('\n')
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes"
}
