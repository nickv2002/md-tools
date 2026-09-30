//go:build slackdump

package slack

import (
	"encoding/json"
	"strings"

	"github.com/yuin/goldmark/ast"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/text"
)

// dumpNode is the goldmark tree reduced to what the renderer reads, so a
// reimplementation's parser can be compared with goldmark before any rendering.
type dumpNode struct {
	Kind     string      `json:"k"`
	Children []*dumpNode `json:"c,omitempty"`
	Value    string      `json:"v,omitempty"`
	Soft     bool        `json:"soft,omitempty"`
	Hard     bool        `json:"hard,omitempty"`
	Level    int         `json:"level,omitempty"`
	Ordered  bool        `json:"ordered,omitempty"`
	Count    int         `json:"count,omitempty"`
	Start    int         `json:"start,omitempty"`
	Dest     string      `json:"dest,omitempty"`
	Email    bool        `json:"email,omitempty"`
	Checked  bool        `json:"checked,omitempty"`
	Aligns   []string    `json:"aligns,omitempty"`
	Lines    []string    `json:"lines,omitempty"`
}

// DumpAST parses input exactly as ConvertWith does and returns the tree as JSON.
func DumpAST(input []byte) []byte {
	source := stripFrontMatter([]byte(strings.ToValidUTF8(string(input), "�")))
	root := parser.Parser().Parse(text.NewReader(source))
	out, err := json.Marshal(dumpTree(root, source))
	if err != nil {
		panic(err)
	}
	return out
}

func dumpTree(n ast.Node, source []byte) *dumpNode {
	d := &dumpNode{Kind: n.Kind().String()}
	switch t := n.(type) {
	case *ast.Text:
		d.Value, d.Soft, d.Hard = string(t.Segment.Value(source)), t.SoftLineBreak(), t.HardLineBreak()
	case *ast.String:
		d.Value = string(t.Value)
	case *ast.Emphasis:
		d.Level = t.Level
	case *ast.List:
		d.Ordered, d.Start, d.Count = t.IsOrdered(), t.Start, t.ChildCount()
	case *ast.Link:
		d.Dest = string(t.Destination)
	case *ast.Image:
		d.Dest = string(t.Destination)
	case *ast.AutoLink:
		d.Value, d.Email = string(t.URL(source)), t.AutoLinkType == ast.AutoLinkEmail
	case *extast.TaskCheckBox:
		d.Checked = t.IsChecked
	case *ast.RawHTML:
		d.Value = string(t.Segments.Value(source))
	case *extast.Table:
		for _, a := range t.Alignments {
			d.Aligns = append(d.Aligns, a.String())
		}
	case *ast.FencedCodeBlock, *ast.CodeBlock:
		for i := 0; i < n.Lines().Len(); i++ {
			s := n.Lines().At(i)
			d.Lines = append(d.Lines, string(s.Value(source)))
		}
	}
	if _, isAuto := n.(*ast.AutoLink); !isAuto {
		for c := n.FirstChild(); c != nil; c = c.NextSibling() {
			d.Children = append(d.Children, dumpTree(c, source))
		}
	}
	return d
}
