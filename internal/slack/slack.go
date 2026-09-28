package slack

import (
	"fmt"
	"html"
	"regexp"
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

// zeroWidthSpace placed before a literal markup character stops Slack from
// treating it as an emphasis delimiter.
const zeroWidthSpace = "\u200b"

var entityRef = regexp.MustCompile(`^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});`)

func isASCIIPunct(c byte) bool {
	return strings.IndexByte("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", c) >= 0
}

// unescapeText resolves Markdown backslash escapes and HTML entities in a
// raw text segment. With neutralize, an escaped *, _, ~ or ` keeps Slack from
// reading it as markup, since mrkdwn has no backslash escape.
func unescapeText(s string, neutralize bool) string {
	if !strings.ContainsAny(s, "\\&") {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); {
		switch c := s[i]; {
		case c == '\\' && i+1 < len(s) && isASCIIPunct(s[i+1]):
			if neutralize && s[i+1] == '*' {
				// A zero-width space does not stop Slack bolding *x*; the
				// asterisk operator looks the same and is inert.
				b.WriteString("∗")
				i += 2
				continue
			}
			if neutralize && s[i+1] == '`' {
				b.WriteString("ˋ") // same stand-in used for backticks inside code spans
				i += 2
				continue
			}
			if neutralize && strings.IndexByte("_~", s[i+1]) >= 0 {
				b.WriteString(zeroWidthSpace)
			}
			b.WriteByte(s[i+1])
			i += 2
			continue
		case c == '&':
			if m := entityRef.FindString(s[i:]); m != "" {
				if u := html.UnescapeString(m); u != m {
					b.WriteString(u)
					i += len(m)
					continue
				}
			}
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// slackURL escapes a link target. Slack splits <url|label> on the first pipe
// and ends the link at whitespace, so both are percent-encoded.
func slackURL(u string) string {
	u = strings.ReplaceAll(u, "|", "%7C")
	u = strings.ReplaceAll(u, " ", "%20")
	return escape(u)
}

// fenceSafe keeps ``` inside code content from closing the Slack code block.
func fenceSafe(s string) string {
	return strings.ReplaceAll(s, "```", "``"+zeroWidthSpace+"`")
}

// inlineCtx tracks enclosing markup while rendering inline nodes.
type inlineCtx struct {
	bold bool // inside a heading, already rendered bold
	link bool // inside a link label, where nested links cannot exist
}

func childrenInline(node ast.Node, source []byte, c inlineCtx) string {
	var b strings.Builder
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		b.WriteString(renderInline(child, source, c))
	}
	return b.String()
}

func renderInline(node ast.Node, source []byte, c inlineCtx) string {
	switch n := node.(type) {
	case *ast.Text:
		s := escape(unescapeText(string(n.Segment.Value(source)), true))
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
		if c.link { // Slack shows emphasis markers literally inside a link label
			return childrenInline(n, source, c)
		}
		mark := "_"
		if n.Level >= 2 {
			if c.bold {
				return childrenInline(n, source, c)
			}
			mark = "*"
		}
		return mark + childrenInline(n, source, c) + mark
	case *extast.Strikethrough:
		if c.link {
			return childrenInline(n, source, c)
		}
		return "~" + childrenInline(n, source, c) + "~"
	case *ast.CodeSpan:
		var b strings.Builder
		for child := n.FirstChild(); child != nil; child = child.NextSibling() {
			if t, ok := child.(*ast.Text); ok {
				b.WriteString(escape(string(t.Segment.Value(source))))
				if t.SoftLineBreak() || t.HardLineBreak() {
					b.WriteByte(' ')
				}
			}
		}
		if c.link {
			return b.String() // Slack does not render code inside a link label
		}
		return "`" + strings.ReplaceAll(b.String(), "`", "ˋ") + "`"
	case *ast.Link:
		c.link = true
		label := strings.TrimSpace(childrenInline(n, source, c))
		url := slackURL(string(n.Destination))
		if label == "" || label == url {
			return "<" + url + ">"
		}
		return "<" + url + "|" + label + ">"
	case *ast.AutoLink:
		return "<" + slackURL(string(n.URL(source))) + ">"
	case *ast.Image:
		label := strings.TrimSpace(childrenInline(n, source, c))
		if label == "" {
			label = "image"
		}
		if c.link {
			return label // a link label cannot hold another link
		}
		return "<" + slackURL(string(n.Destination)) + "|" + label + ">"
	case *extast.TaskCheckBox:
		if n.IsChecked {
			return "☑ "
		}
		return "☐ "
	case *ast.RawHTML:
		if strings.HasPrefix(strings.ToLower(string(n.Segments.Value(source))), "<br") {
			return "\n"
		}
		return ""
	default:
		return childrenInline(node, source, c)
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
	return fenceSafe(escape(strings.TrimRight(b.String(), "\n")))
}

func isParagraph(n ast.Node) bool {
	_, ok := n.(*ast.Paragraph)
	return ok
}

func renderList(n *ast.List, source []byte, depth int) string {
	var lines []string
	ordinal := n.Start
	for item := n.FirstChild(); item != nil; item = item.NextSibling() {
		var body strings.Builder
		for child := item.FirstChild(); child != nil; child = child.NextSibling() {
			var part string
			switch child.(type) {
			case *ast.List:
				part = "\n" + renderBlock(child, source, depth+1)
			case *ast.FencedCodeBlock, *ast.CodeBlock, *extast.Table:
				// A fence only renders when it starts its own line.
				part = "\n" + renderBlock(child, source, depth+1)
			default:
				part = strings.TrimSpace(renderBlock(child, source, depth+1))
			}
			if strings.TrimSpace(part) == "" {
				continue
			}
			switch {
			case strings.HasPrefix(part, "\n"):
			case body.Len() == 0:
			case strings.HasSuffix(body.String(), "```"):
				body.WriteByte('\n')
			case isParagraph(child):
				body.WriteByte('\n') // keep a second paragraph in an item on its own line
			default:
				body.WriteByte(' ')
			}
			body.WriteString(part)
		}
		marker := "-"
		if n.IsOrdered() {
			marker = fmt.Sprintf("%d.", ordinal)
			ordinal++
		}
		lines = append(lines, strings.Repeat("  ", depth)+marker+" "+body.String())
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
			b.WriteString(unescapeText(string(n.Segment.Value(source)), false))
			if n.HardLineBreak() || n.SoftLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(n.Value)
		case *ast.CodeSpan:
			for cc := n.FirstChild(); cc != nil; cc = cc.NextSibling() {
				if t, ok := cc.(*ast.Text); ok {
					b.Write(t.Segment.Value(source))
				}
			}
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
	return "```\n" + fenceSafe(strings.Join(out, "\n")) + "\n```"
}

func renderBlock(node ast.Node, source []byte, depth int) string {
	switch n := node.(type) {
	case *ast.Paragraph, *ast.TextBlock:
		return childrenInline(node, source, inlineCtx{})
	case *ast.Heading:
		return "*" + strings.TrimSpace(childrenInline(n, source, inlineCtx{bold: true})) + "*"
	case *ast.List:
		return renderList(n, source, depth)
	case *ast.Blockquote:
		body := renderChildren(n, source, depth)
		if body == "" {
			return ""
		}
		lines := strings.Split(body, "\n")
		for i, l := range lines {
			lines[i] = strings.TrimRight("> "+l, " ")
		}
		return strings.Join(lines, "\n")
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
