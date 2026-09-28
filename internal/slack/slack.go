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

// plainText flattens inline nodes to unformatted text. Slack does not render
// mrkdwn inside code blocks, so markup would otherwise show up literally.
func plainText(node ast.Node, source []byte) string {
	var b strings.Builder
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		switch n := child.(type) {
		case *ast.Text:
			b.Write(n.Segment.Value(source))
			if n.HardLineBreak() || n.SoftLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(n.Value)
		case *ast.Link:
			label := strings.TrimSpace(plainText(n, source))
			url := string(n.Destination)
			if label == "" || label == url {
				b.WriteString(url)
			} else {
				b.WriteString(label + " (" + url + ")")
			}
		case *ast.AutoLink:
			b.Write(n.URL(source))
		case *ast.Image:
			b.WriteString(strings.TrimSpace(plainText(n, source)))
		case *extast.TaskCheckBox:
			if n.IsChecked {
				b.WriteString("[x] ")
			} else {
				b.WriteString("[ ] ")
			}
		case *ast.RawHTML:
			if strings.HasPrefix(strings.ToLower(string(n.Segments.Value(source))), "<br") {
				b.WriteByte(' ')
			}
		default:
			b.WriteString(plainText(child, source))
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// runeWidth approximates terminal cell width: 0 for combining marks and
// joiners, 2 for East Asian wide characters and emoji, 1 otherwise.
func runeWidth(r rune) int {
	switch {
	case r == 0x200d || (r >= 0x0300 && r <= 0x036f) || (r >= 0xfe00 && r <= 0xfe0f):
		return 0
	case (r >= 0x1100 && r <= 0x115f) || (r >= 0x2e80 && r <= 0xa4cf) ||
		(r >= 0xac00 && r <= 0xd7a3) || (r >= 0xf900 && r <= 0xfaff) ||
		(r >= 0xfe30 && r <= 0xfe6f) || (r >= 0xff00 && r <= 0xff60) ||
		(r >= 0xffe0 && r <= 0xffe6) || (r >= 0x1f300 && r <= 0x1faff) || r == 0x2705 || r == 0x274c || r == 0x2b50 ||
		(r >= 0x20000 && r <= 0x3fffd):
		return 2
	}
	return 1
}

func displayWidth(s string) int {
	w := 0
	for _, r := range s {
		if r == 0xfe0f && w > 0 { // emoji presentation selector widens the previous rune
			w++
			continue
		}
		w += runeWidth(r)
	}
	return w
}

func pad(s string, width int, align extast.Alignment) string {
	gap := width - displayWidth(s)
	switch align {
	case extast.AlignRight:
		return strings.Repeat(" ", gap) + s
	case extast.AlignCenter:
		left := gap / 2
		return strings.Repeat(" ", left) + s + strings.Repeat(" ", gap-left)
	}
	return s + strings.Repeat(" ", gap)
}

// renderTable draws a column-aligned monospace grid inside a code block, the
// only place Slack preserves alignment. Column alignment from the delimiter
// row is honored and a rule separates the header from the body. Only ASCII
// box characters are used: Slack draws Unicode box-drawing glyphs from a
// fallback font whose lines do not meet.
func renderTable(n *extast.Table, source []byte) string {
	var grid [][]string
	for row := n.FirstChild(); row != nil; row = row.NextSibling() {
		var cells []string
		for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
			cells = append(cells, plainText(cell, source))
		}
		grid = append(grid, cells)
	}
	cols := len(n.Alignments)
	for _, cells := range grid {
		cols = max(cols, len(cells))
	}
	widths := make([]int, cols)
	for _, cells := range grid {
		for i, c := range cells {
			widths[i] = max(widths[i], displayWidth(c))
		}
	}
	align := func(i int) extast.Alignment {
		if i < len(n.Alignments) {
			return n.Alignments[i]
		}
		return extast.AlignNone
	}
	line := func(cells []string, header bool) string {
		parts := make([]string, cols)
		for i := range parts {
			cell := ""
			if i < len(cells) {
				cell = cells[i]
			}
			a := align(i)
			if header && a == extast.AlignNone {
				a = extast.AlignLeft
			}
			parts[i] = pad(cell, widths[i], a)
		}
		row := strings.TrimRight(strings.Join(parts, " | "), " ")
		return strings.TrimSuffix(row, " |")
	}
	rule := make([]string, cols)
	for i, w := range widths {
		rule[i] = strings.Repeat("-", w)
	}
	var out []string
	for i, cells := range grid {
		out = append(out, escape(line(cells, i == 0)))
		if i == 0 {
			out = append(out, strings.Join(rule, "-+-"))
		}
	}
	return "```\n" + strings.Join(out, "\n") + "\n```"
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
