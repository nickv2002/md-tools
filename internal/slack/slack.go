package slack

import (
	"fmt"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/text"
)

var parser = goldmark.New(goldmark.WithExtensions(extension.GFM))

// Convert renders Markdown as Slack mrkdwn. Unsupported block syntax is
// rendered as readable plain text; front matter and raw HTML are omitted.
func Convert(input []byte) string {
	source := stripFrontMatter(input)
	root := parser.Parser().Parse(text.NewReader(source))
	return strings.TrimSpace(renderChildren(root, source, 0)) + "\n"
}

func stripFrontMatter(input []byte) []byte {
	s := strings.ReplaceAll(strings.ReplaceAll(string(input), "\r\n", "\n"), "\r", "\n")
	lines := strings.Split(s, "\n")
	if len(lines) == 0 || (lines[0] != "---" && lines[0] != "+++") {
		return []byte(s)
	}
	for i := 1; i < len(lines); i++ {
		if lines[i] == lines[0] || (lines[0] == "---" && lines[i] == "...") {
			return []byte(strings.Join(lines[i+1:], "\n"))
		}
	}
	return []byte(s)
}

func escape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	return strings.ReplaceAll(s, ">", "&gt;")
}

func childrenInline(node ast.Node, source []byte) string {
	var b strings.Builder
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		b.WriteString(renderInline(child, source))
	}
	return b.String()
}

func renderInline(node ast.Node, source []byte) string {
	switch n := node.(type) {
	case *ast.Text:
		s := escape(string(n.Segment.Value(source)))
		if n.HardLineBreak() {
			return s + "\n"
		}
		if n.SoftLineBreak() {
			return s + " "
		}
		return s
	case *ast.String:
		return escape(string(n.Value))
	case *ast.Emphasis:
		mark := "_"
		if n.Level >= 2 {
			mark = "*"
		}
		return mark + childrenInline(n, source) + mark
	case *extast.Strikethrough:
		return "~" + childrenInline(n, source) + "~"
	case *ast.CodeSpan:
		return "`" + strings.ReplaceAll(childrenInline(n, source), "`", "ˋ") + "`"
	case *ast.Link:
		label := strings.TrimSpace(childrenInline(n, source))
		url := escape(string(n.Destination))
		if label == "" || label == url {
			return "<" + url + ">"
		}
		return "<" + url + "|" + label + ">"
	case *ast.AutoLink:
		return "<" + escape(string(n.URL(source))) + ">"
	case *ast.Image:
		label := strings.TrimSpace(childrenInline(n, source))
		if label == "" {
			label = "image"
		}
		return "<" + escape(string(n.Destination)) + "|" + label + ">"
	case *extast.TaskCheckBox:
		if n.IsChecked {
			return "[x] "
		}
		return "[ ] "
	case *ast.RawHTML:
		return ""
	default:
		return childrenInline(node, source)
	}
}

func renderChildren(node ast.Node, source []byte, depth int) string {
	var blocks []string
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		if block := strings.TrimSpace(renderBlock(child, source, depth)); block != "" {
			blocks = append(blocks, block)
		}
	}
	return strings.Join(blocks, "\n\n")
}

func codeLines(node ast.Node, source []byte) string {
	var b strings.Builder
	for i := 0; i < node.Lines().Len(); i++ {
		segment := node.Lines().At(i)
		b.Write(segment.Value(source))
	}
	return strings.TrimRight(b.String(), "\n")
}

func renderList(n *ast.List, source []byte, depth int) string {
	var lines []string
	ordinal := n.Start
	for item := n.FirstChild(); item != nil; item = item.NextSibling() {
		var parts []string
		for child := item.FirstChild(); child != nil; child = child.NextSibling() {
			if _, ok := child.(*ast.List); ok {
				if nested := renderBlock(child, source, depth+1); nested != "" {
					parts = append(parts, "\n"+nested)
				}
			} else if part := strings.TrimSpace(renderBlock(child, source, depth+1)); part != "" {
				parts = append(parts, part)
			}
		}
		marker := "-"
		if n.IsOrdered() {
			marker = fmt.Sprintf("%d.", ordinal)
			ordinal++
		}
		lines = append(lines, strings.Repeat("  ", depth)+marker+" "+strings.Join(parts, " "))
	}
	return strings.Join(lines, "\n")
}

func renderTable(n *extast.Table, source []byte) string {
	var rows []string
	for row := n.FirstChild(); row != nil; row = row.NextSibling() {
		var cells []string
		for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
			cells = append(cells, strings.TrimSpace(childrenInline(cell, source)))
		}
		rows = append(rows, strings.Join(cells, " | "))
	}
	return "```\n" + strings.Join(rows, "\n") + "\n```"
}

func renderBlock(node ast.Node, source []byte, depth int) string {
	switch n := node.(type) {
	case *ast.Paragraph, *ast.TextBlock:
		return childrenInline(node, source)
	case *ast.Heading:
		return "*" + strings.TrimSpace(childrenInline(n, source)) + "*"
	case *ast.List:
		return renderList(n, source, depth)
	case *ast.Blockquote:
		body := renderChildren(n, source, depth)
		if body == "" {
			return ""
		}
		return "> " + strings.ReplaceAll(body, "\n", "\n> ")
	case *ast.FencedCodeBlock, *ast.CodeBlock:
		return "```\n" + codeLines(node, source) + "\n```"
	case *ast.ThematicBreak:
		return "---"
	case *extast.Table:
		return renderTable(n, source)
	case *ast.HTMLBlock:
		return ""
	default:
		return renderChildren(node, source, depth)
	}
}
