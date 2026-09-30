package slack

import (
	"fmt"
	"html"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

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
	return ConvertWith(input, Options{MaxTableWidth: DefaultMaxTableWidth})
}

// DefaultMaxTableWidth is the widest table, in monospace cells, that Convert
// keeps as an aligned grid. Slack wraps code-block lines at the window width
// (about 80 cells in a narrow window, fewer on phones), which shreds a wider
// grid, so wider tables become one record per row instead.
const DefaultMaxTableWidth = 100

// Options tunes Convert.
type Options struct {
	// MaxTableWidth is the widest aligned table grid to emit; a table with a
	// body that would be wider is rendered as one record per row. Zero keeps
	// every table as a grid.
	MaxTableWidth int
}

// ConvertWith is Convert with explicit options.
func ConvertWith(input []byte, opts Options) string {
	source := stripFrontMatter([]byte(strings.ToValidUTF8(string(input), "\ufffd")))
	root := parser.Parser().Parse(text.NewReader(source))
	return strings.TrimSpace(renderChildren(root, source, 0, opts.MaxTableWidth)) + "\n"
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

// slackURL escapes a link target. Slack splits <url|label> on the first pipe,
// ends the link at whitespace, and reads < and > as delimiters, so those and
// control characters are percent-encoded before entity escaping.
func slackURL(u string) string {
	var b strings.Builder
	for _, r := range u {
		switch {
		case r == '|' || r == ' ' || r == '<' || r == '>' || r < 0x20 || r == 0x7f || r == 0x85 || r == 0x2028 || r == 0x2029:
			for _, c := range []byte(string(r)) {
				fmt.Fprintf(&b, "%%%02X", c)
			}
		default:
			b.WriteRune(r)
		}
	}
	return escape(b.String())
}

// linkSchemes are the URL schemes Slack turns into clickable links.
var linkSchemes = map[string]bool{"http": true, "https": true, "mailto": true, "tel": true, "ftp": true}

// linkTarget resolves a Markdown destination to text Slack can link. ok is
// false for empty, relative or non-linkable destinations (javascript:, data:,
// #anchors, paths), which callers render as plain text instead.
func linkTarget(dest string) (target string, ok bool) {
	dest = strings.TrimSpace(unescapeText(dest, false))
	if i := strings.IndexAny(dest, ":/?#"); i > 0 && dest[i] == ':' && linkSchemes[strings.ToLower(dest[:i])] && len(dest) > i+1 {
		return dest, true
	}
	return dest, false
}

// slackLink renders <url|label>, or label (url) when Slack cannot represent
// the link: an unlinkable destination or a label holding the | separator.
func slackLink(dest, label string) string {
	label = strings.Join(strings.Fields(label), " ")
	target, ok := linkTarget(dest)
	switch {
	case target == "":
		return label
	case !ok:
		if label == "" {
			return escape(target)
		}
		return label + " (" + escape(target) + ")"
	case label == "" || label == escape(target):
		return "<" + slackURL(target) + ">"
	case strings.Contains(label, "|"):
		return label + " (<" + slackURL(target) + ">)"
	}
	return "<" + slackURL(target) + "|" + label + ">"
}

// fenceSafe keeps ``` inside code content from closing the Slack code block.
func fenceSafe(s string) string {
	return strings.ReplaceAll(s, "```", "``"+zeroWidthSpace+"`")
}

// hairSpace is a near-invisible space Slack accepts as a word boundary.
// Slack only opens *bold* or _italic_ after whitespace or punctuation, so
// emphasis that touches a letter (foo**bar**, 这是**重点**) would print its
// markers literally; a zero-width space or word joiner does not help, but
// U+200A does (verified in real Slack).
const hairSpace = "\u200a"

func touchesWord(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) }

// edgeRune returns the first or last rune a sibling text node contributes,
// or false when the sibling is not plain text or ends in a line break.
func edgeRune(n ast.Node, source []byte, last bool) (rune, bool) {
	var v string
	switch t := n.(type) {
	case *ast.Text:
		if last && (t.SoftLineBreak() || t.HardLineBreak()) {
			return 0, false
		}
		v = string(t.Segment.Value(source))
	case *ast.String:
		v = string(t.Value)
	default:
		return 0, false
	}
	if v == "" {
		return 0, false
	}
	if last {
		r, _ := utf8.DecodeLastRuneInString(v)
		return r, true
	}
	r, _ := utf8.DecodeRuneInString(v)
	return r, true
}

// emphasisGap returns the hair spaces needed outside an emphasis span whose
// neighbours are word characters.
func emphasisGap(n ast.Node, source []byte) (before, after string) {
	if prev := n.PreviousSibling(); prev != nil {
		if r, ok := edgeRune(prev, source, true); ok && touchesWord(r) {
			before = hairSpace
		}
	}
	if next := n.NextSibling(); next != nil {
		if r, ok := edgeRune(next, source, false); ok && touchesWord(r) {
			after = hairSpace
		}
	}
	return before, after
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
		before, after := emphasisGap(n, source)
		return before + mark + childrenInline(n, source, c) + mark + after
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
		if strings.TrimSpace(b.String()) == "" {
			return b.String() // Slack shows an empty code span as bare backticks
		}
		return "`" + strings.ReplaceAll(b.String(), "`", "ˋ") + "`"
	case *ast.Link:
		c.link = true
		return slackLink(string(n.Destination), childrenInline(n, source, c))
	case *ast.AutoLink:
		url := string(n.URL(source))
		if n.AutoLinkType == ast.AutoLinkEmail {
			return slackLink("mailto:"+url, escape(url))
		}
		return slackLink(url, "")
	case *ast.Image:
		label := strings.TrimSpace(childrenInline(n, source, c))
		if target, ok := linkTarget(string(n.Destination)); !ok && target == "" {
			return label
		}
		if label == "" {
			label = "image"
		}
		if c.link {
			return label // a link label cannot hold another link
		}
		return slackLink(string(n.Destination), label)
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

func renderChildren(node ast.Node, source []byte, depth, maxTable int) string {
	var blocks []string
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		if block := strings.TrimSpace(renderBlock(child, source, depth, maxTable)); block != "" {
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

func renderList(n *ast.List, source []byte, depth, maxTable int) string {
	var lines []string
	ordinal := n.Start
	for item := n.FirstChild(); item != nil; item = item.NextSibling() {
		var body strings.Builder
		for child := item.FirstChild(); child != nil; child = child.NextSibling() {
			var part string
			switch child.(type) {
			case *ast.List:
				part = "\n" + renderBlock(child, source, depth+1, maxTable)
			case *ast.FencedCodeBlock, *ast.CodeBlock, *extast.Table, *ast.Blockquote:
				// A fence or quote marker only renders when it starts its own line.
				part = "\n" + renderBlock(child, source, depth+1, maxTable)
			default:
				part = strings.TrimSpace(renderBlock(child, source, depth+1, maxTable))
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
			url := strings.TrimSpace(unescapeText(string(n.Destination), false))
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

// wideRanges lists code points that render two cells wide: East Asian Wide
// and Fullwidth blocks plus characters with default emoji presentation.
var wideRanges = [][2]rune{
	{0x1100, 0x115f}, {0x231a, 0x231b}, {0x2329, 0x232a}, {0x23e9, 0x23ec}, {0x23f0, 0x23f0}, {0x23f3, 0x23f3},
	{0x25fd, 0x25fe}, {0x2614, 0x2615}, {0x2648, 0x2653}, {0x267f, 0x267f}, {0x2693, 0x2693}, {0x26a1, 0x26a1},
	{0x26aa, 0x26ab}, {0x26bd, 0x26be}, {0x26c4, 0x26c5}, {0x26ce, 0x26ce}, {0x26d4, 0x26d4}, {0x26ea, 0x26ea},
	{0x26f2, 0x26f3}, {0x26f5, 0x26f5}, {0x26fa, 0x26fa}, {0x26fd, 0x26fd}, {0x2705, 0x2705}, {0x270a, 0x270b},
	{0x2728, 0x2728}, {0x274c, 0x274c}, {0x274e, 0x274e}, {0x2753, 0x2755}, {0x2757, 0x2757}, {0x2795, 0x2797},
	{0x27b0, 0x27b0}, {0x27bf, 0x27bf}, {0x2b1b, 0x2b1c}, {0x2b50, 0x2b50}, {0x2b55, 0x2b55},
	{0x2e80, 0x303e}, {0x3041, 0xa4cf}, {0xa960, 0xa97f}, {0xac00, 0xd7a3}, {0xf900, 0xfaff}, {0xfe30, 0xfe6f},
	{0xff00, 0xff60}, {0xffe0, 0xffe6},
	{0x1f004, 0x1f004}, {0x1f0cf, 0x1f0cf}, {0x1f18e, 0x1f18e}, {0x1f191, 0x1f19a}, {0x1f200, 0x1f320},
	{0x1f32d, 0x1f335}, {0x1f337, 0x1f37c}, {0x1f37e, 0x1f393}, {0x1f3a0, 0x1f3ca}, {0x1f3cf, 0x1f3d3},
	{0x1f3e0, 0x1f3f0}, {0x1f3f4, 0x1f3f4}, {0x1f3f8, 0x1f43e}, {0x1f440, 0x1f440}, {0x1f442, 0x1f4fc},
	{0x1f4ff, 0x1f53d}, {0x1f54b, 0x1f54e}, {0x1f550, 0x1f567}, {0x1f57a, 0x1f57a}, {0x1f595, 0x1f596},
	{0x1f5a4, 0x1f5a4}, {0x1f5fb, 0x1f64f}, {0x1f680, 0x1f6c5}, {0x1f6cc, 0x1f6cc}, {0x1f6d0, 0x1f6d2},
	{0x1f6d5, 0x1f6d7}, {0x1f6dc, 0x1f6df}, {0x1f6eb, 0x1f6ec}, {0x1f6f4, 0x1f6fc}, {0x1f7e0, 0x1f7eb},
	{0x1f7f0, 0x1f7f0}, {0x1f90c, 0x1f93a}, {0x1f93c, 0x1f945}, {0x1f947, 0x1f9ff}, {0x1fa70, 0x1faff},
	{0x20000, 0x3fffd},
}

func isWide(r rune) bool {
	for _, w := range wideRanges {
		if r < w[0] {
			return false
		}
		if r <= w[1] {
			return true
		}
	}
	return false
}

// isZeroWidth reports combining marks, format characters (ZWJ, ZWSP, tags,
// variation selectors) and controls, which occupy no cell of their own.
func isZeroWidth(r rune) bool {
	return unicode.In(r, unicode.Mn, unicode.Me, unicode.Cf, unicode.Cc) || (r >= 0x1160 && r <= 0x11ff)
}

func isRegionalIndicator(r rune) bool { return r >= 0x1f1e6 && r <= 0x1f1ff }

func isEmojiModifier(r rune) bool { return r >= 0x1f3fb && r <= 0x1f3ff }

// displayWidth approximates monospace cell width by grapheme cluster: a base
// character followed by combining marks or a text/emoji variation selector,
// an emoji with a skin-tone modifier, a flag (two regional indicators) and a
// ZWJ sequence each take the width of their base, and a sequence that is
// emoji-styled (VS16, modifier, keycap, flag, ZWJ) is two cells wide.
func displayWidth(s string) int {
	rs := []rune(s)
	total := 0
	for i := 0; i < len(rs); {
		base := rs[i]
		i++
		if isZeroWidth(base) {
			continue
		}
		width := 1
		if isWide(base) {
			width = 2
		}
		emoji := false
		if isRegionalIndicator(base) { // a flag, or a lone letter drawn in a box
			if i < len(rs) && isRegionalIndicator(rs[i]) {
				i++
			}
			width, emoji = 2, true
		}
		for i < len(rs) {
			r := rs[i]
			switch {
			case r == 0xfe0f || r == 0x20e3 || isEmojiModifier(r):
				emoji = true
			case r == 0x200d && i+1 < len(rs) && !isZeroWidth(rs[i+1]):
				i++ // the joined character belongs to this cluster
				emoji = true
			case r == 0xfe0e:
				width = 1 // text presentation
				emoji = false
			case isZeroWidth(r):
			default:
				goto done
			}
			i++
		}
	done:
		if emoji {
			width = 2
		}
		total += width
	}
	return total
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
func renderTable(n *extast.Table, source []byte, maxTable int) string {
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
	if width := gridWidth(widths); maxTable > 0 && width > maxTable && len(grid) > 1 {
		return renderTableRecords(n, source)
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
		last := len(cells) - 1 // trailing empty cells add no visible text
		for last >= 0 && cells[last] == "" {
			last--
		}
		if last < 0 {
			return ""
		}
		return strings.TrimRight(strings.Join(parts[:last+1], " | "), " ")
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

// gridWidth is the display width of a table grid with the given column widths.
func gridWidth(widths []int) int {
	total := 3 * max(len(widths)-1, 0) // " | " between columns
	for _, w := range widths {
		total += w
	}
	return total
}

// renderTableRecords renders a table too wide for a code block as one record
// per body row: the first cell in bold, then "Header: value" pairs. Unlike the
// grid it stays mrkdwn, so links and emphasis in cells keep working.
func renderTableRecords(n *extast.Table, source []byte) string {
	inline := func(node ast.Node, c inlineCtx) string {
		return strings.Join(strings.Fields(childrenInline(node, source, c)), " ")
	}
	var headers []string
	var records []string
	for row := n.FirstChild(); row != nil; row = row.NextSibling() {
		if _, isHeader := row.(*extast.TableHeader); isHeader {
			for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
				headers = append(headers, inline(cell, inlineCtx{bold: true, link: true}))
			}
			continue
		}
		var title string
		var pairs []string
		i := 0
		for cell := row.FirstChild(); cell != nil; cell, i = cell.NextSibling(), i+1 {
			if i == 0 {
				if t := inline(cell, inlineCtx{bold: true}); t != "" {
					title = "*" + t + "*"
				}
				continue
			}
			value := inline(cell, inlineCtx{})
			if value == "" {
				continue
			}
			if i < len(headers) && headers[i] != "" {
				value = headers[i] + ": " + value
			}
			pairs = append(pairs, value)
		}
		record := strings.Join(pairs, " · ")
		switch {
		case title != "" && record != "":
			record = title + "\n" + record
		case title != "":
			record = title
		}
		if record != "" {
			records = append(records, record)
		}
	}
	return strings.Join(records, "\n\n")
}

func renderBlock(node ast.Node, source []byte, depth, maxTable int) string {
	switch n := node.(type) {
	case *ast.Paragraph, *ast.TextBlock:
		return childrenInline(node, source, inlineCtx{})
	case *ast.Heading:
		title := strings.Join(strings.Fields(childrenInline(n, source, inlineCtx{bold: true})), " ")
		if title == "" {
			return ""
		}
		return "*" + title + "*"
	case *ast.List:
		return renderList(n, source, depth, maxTable)
	case *ast.Blockquote:
		body := renderChildren(n, source, depth, maxTable)
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
		return renderTable(n, source, maxTable)
	case *ast.HTMLBlock:
		return ""
	default:
		return renderChildren(node, source, depth, maxTable)
	}
}
