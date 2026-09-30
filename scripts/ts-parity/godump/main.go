//go:build slackdump

// Command godump is the Go side of the TypeScript parity harness. "serve"
// reads one JSON request per line on stdin and answers one JSON line per
// request; "corpus" prints every string literal in the converter tests and the
// Go fuzz corpus as base64 JSON lines. Build with -tags slackdump.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/nickv2002/md-tools/internal/slack"
)

type request struct {
	In    string `json:"in"`
	Width *int   `json:"w,omitempty"`
	AST   bool   `json:"ast,omitempty"`
}

type response struct {
	Out string          `json:"out"`
	AST json.RawMessage `json:"ast,omitempty"`
	Err string          `json:"err,omitempty"`
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func serve() {
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	out := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer out.Flush()
	enc := json.NewEncoder(out)
	for {
		line, err := in.ReadBytes('\n')
		if len(line) > 0 {
			enc.Encode(handle(line))
			if in.Buffered() == 0 {
				out.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

func handle(line []byte) (resp response) {
	defer func() {
		if r := recover(); r != nil {
			resp = response{Err: fmt.Sprint(r)}
		}
	}()
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		return response{Err: err.Error()}
	}
	raw, err := base64.StdEncoding.DecodeString(req.In)
	if err != nil {
		return response{Err: err.Error()}
	}
	opts := slack.Options{MaxTableWidth: slack.DefaultMaxTableWidth}
	if req.Width != nil {
		opts.MaxTableWidth = *req.Width
	}
	resp.Out = b64([]byte(slack.ConvertWith(raw, opts)))
	if req.AST {
		resp.AST = slack.DumpAST(raw)
	}
	return resp
}

// constString evaluates string literals, "+" chains and named constants.
func constString(e ast.Expr, consts map[string]string) (string, bool) {
	switch x := e.(type) {
	case *ast.BasicLit:
		if x.Kind == token.STRING {
			s, err := strconv.Unquote(x.Value)
			return s, err == nil
		}
	case *ast.BinaryExpr:
		if x.Op == token.ADD {
			l, lok := constString(x.X, consts)
			r, rok := constString(x.Y, consts)
			return l + r, lok && rok
		}
	case *ast.ParenExpr:
		return constString(x.X, consts)
	case *ast.Ident:
		s, ok := consts[x.Name]
		return s, ok
	}
	return "", false
}

func corpus(root string, extra []string) {
	seen := map[string]bool{}
	emit := func(s string) {
		if !seen[s] {
			seen[s] = true
			fmt.Println(b64([]byte(s)))
		}
	}
	files, _ := filepath.Glob(filepath.Join(root, "internal/slack/*_test.go"))
	more, _ := filepath.Glob(filepath.Join(root, "cmd/*/*_test.go"))
	files = append(files, more...)
	for _, dir := range extra {
		filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(path, "_test.go") {
				files = append(files, path)
			}
			return nil
		})
	}
	for _, path := range files {
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			continue
		}
		consts := map[string]string{}
		ast.Inspect(f, func(n ast.Node) bool {
			if vs, ok := n.(*ast.ValueSpec); ok && len(vs.Names) == len(vs.Values) {
				for i, name := range vs.Names {
					if s, ok := constString(vs.Values[i], consts); ok {
						consts[name.Name] = s
					}
				}
			}
			return true
		})
		ast.Inspect(f, func(n ast.Node) bool {
			if e, ok := n.(ast.Expr); ok {
				if s, ok := constString(e, consts); ok && s != "" {
					emit(s)
				}
			}
			return true
		})
	}
	fuzz, _ := filepath.Glob(filepath.Join(root, "internal/slack/testdata/fuzz/*/*"))
	for _, path := range fuzz {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n")[1:] {
			if i := strings.Index(line, "("); i > 0 && strings.HasSuffix(line, ")") {
				if s, err := strconv.Unquote(line[i+1 : len(line)-1]); err == nil && s != "" {
					emit(s)
				}
			}
		}
	}
}

// classes prints one byte per code point: bit 0 punctuation or symbol, bit 1 space, bit 2 zero-width (Mn, Me, Cf, Cc).
func classes() {
	out := make([]byte, 0x110000)
	for r := rune(0); r < 0x110000; r++ {
		var b byte
		if unicode.IsPunct(r) || unicode.IsSymbol(r) {
			b |= 1
		}
		if unicode.IsSpace(r) {
			b |= 2
		}
		if unicode.In(r, unicode.Mn, unicode.Me, unicode.Cf, unicode.Cc) {
			b |= 4
		}
		out[r] = b
	}
	os.Stdout.WriteString(b64(out))
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: godump serve | corpus <repo root>")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		serve()
	case "classes":
		classes()
	case "corpus":
		corpus(os.Args[2], os.Args[3:])
	}
}
