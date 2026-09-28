package unwrap

import (
	"regexp"
	"strings"
)

var (
	fenceRE      = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})(.*)$")
	fenceCloseRE = regexp.MustCompile("^ {0,3}([`~]+)[ \\t]*$")
	listRE       = regexp.MustCompile(`^([ \t]*)([-+*]|[0-9]+[.)])([ \t]+|$)(.*)$`)
	topListRE    = regexp.MustCompile(`^ {0,3}(?:[-+*]|[0-9]+[.)])(?:[ \t]+.*|$)`)
	quoteRE      = regexp.MustCompile(`^( {0,3}> ?)(.*)$`)
	setextRE     = regexp.MustCompile(`^ {0,3}(?:=+|-+)\s*$`)
	referenceRE  = regexp.MustCompile(`^ {0,3}\[[^\]]+\]:\s*\S`)
	headingRE    = regexp.MustCompile(`^ {0,3}#{1,6}(?:[ \t]+|$)`)
	htmlRE       = regexp.MustCompile(`(?i)^\s*</?(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|nav|ol|p|pre|script|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|/?>|$)`)
	tableCellRE  = regexp.MustCompile(`^\s*:?-{3,}:?\s*$`)
)

// Transform removes line wraps from prose without serializing or reformatting Markdown.
func Transform(text string) string {
	crlf := strings.Count(text, "\r\n")
	lf := strings.Count(text, "\n") - crlf
	newline := "\n"
	if crlf > lf {
		newline = "\r\n"
	}
	normalized := strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	finalNewline := strings.HasSuffix(normalized, "\n")
	if finalNewline {
		normalized = strings.TrimSuffix(normalized, "\n")
	}
	var lines []string
	if normalized != "" {
		lines = strings.Split(normalized, "\n")
	} else if finalNewline {
		lines = []string{""}
	}
	out := strings.Join(unwrapLines(lines), "\n")
	if finalNewline {
		out += "\n"
	}
	return strings.ReplaceAll(out, "\n", newline)
}

func stripBreak(s string) string {
	s = strings.TrimRight(s, " \t")
	if strings.HasSuffix(s, `\`) && !strings.HasSuffix(s, `\\`) {
		s = strings.TrimRight(strings.TrimSuffix(s, `\`), " \t")
	}
	return strings.TrimSpace(s)
}

func joinFragments(lines []string) string {
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		if part := stripBreak(line); part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, " ")
}

func blank(s string) bool { return strings.TrimSpace(s) == "" }

func fenceClose(s, open string) bool {
	m := fenceCloseRE.FindStringSubmatch(s)
	return m != nil && len(m[1]) >= len(open) && m[1][0] == open[0] && strings.Trim(m[1], string(open[0])) == ""
}

func thematic(s string) bool {
	s = strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(s), " ", ""), "\t", "")
	if len(s) < 3 {
		return false
	}
	return (s[0] == '*' || s[0] == '-' || s[0] == '_') && strings.Trim(s, string(s[0])) == ""
}

func htmlStart(s string) bool {
	s = strings.TrimLeft(s, " \t")
	return strings.HasPrefix(s, "<!--") || strings.HasPrefix(s, "<?") || (strings.HasPrefix(s, "<!") && len(s) > 2 && s[2] >= 'A' && s[2] <= 'Z') || htmlRE.MatchString(s)
}

func tableDelimiter(s string) bool {
	if !strings.Contains(s, "|") {
		return false
	}
	for _, cell := range strings.Split(strings.Trim(strings.TrimSpace(s), "|"), "|") {
		if !tableCellRE.MatchString(cell) {
			return false
		}
	}
	return true
}

func tableStart(lines []string, i int) bool {
	return i+1 < len(lines) && strings.Contains(lines[i], "|") && tableDelimiter(lines[i+1])
}

func setextPair(lines []string, i int) bool {
	return i+1 < len(lines) && !blank(lines[i]) && setextRE.MatchString(lines[i+1])
}

func indented(s string) bool { return strings.HasPrefix(s, "\t") || strings.HasPrefix(s, "    ") }

func reference(s string) bool {
	return referenceRE.MatchString(s) && !strings.HasPrefix(strings.TrimLeft(s, " "), "[^")
}

func boundary(lines []string, i int) bool {
	s := lines[i]
	return blank(s) || fenceRE.MatchString(s) || indented(s) || tableStart(lines, i) || htmlStart(s) || quoteRE.MatchString(s) || topListRE.MatchString(s) || headingRE.MatchString(s) || thematic(s) || reference(s) || setextPair(lines, i)
}

func frontMatterEnd(lines []string) int {
	if len(lines) == 0 || (lines[0] != "---" && lines[0] != "+++") {
		return 0
	}
	for i := 1; i < len(lines); i++ {
		if lines[i] == lines[0] || (lines[0] == "---" && lines[i] == "...") {
			return i + 1
		}
	}
	return 0
}

func indentWidth(s string) int { return len(s) - len(strings.TrimLeft(s, " \t")) }

func unwrapList(lines []string, start int) ([]string, int) {
	first := listRE.FindStringSubmatch(lines[start])
	base := indentWidth(first[1])
	result := []string{strings.TrimRight(first[1]+first[2]+first[3]+stripBreak(first[4]), " \t")}
	i, nested := start+1, false
	for i < len(lines) && !blank(lines[i]) {
		line := lines[i]
		match := listRE.FindStringSubmatch(line)
		indent := indentWidth(line)
		if match != nil {
			indent = indentWidth(match[1])
			if indent <= base {
				break
			}
			nested = true
		}
		if fenceRE.MatchString(line) || quoteRE.MatchString(line) || (indented(line) && indent >= base+4) || headingRE.MatchString(line) || thematic(line) {
			nested = true
		}
		if nested {
			result = append(result, line)
		} else if part := stripBreak(line); part != "" {
			result[0] = strings.TrimRight(result[0]+" "+part, " \t")
		}
		i++
	}
	return result, i
}

func unwrapQuote(lines []string, start int) ([]string, int) {
	var contents []string
	var prefix string
	i := start
	for i < len(lines) {
		m := quoteRE.FindStringSubmatch(lines[i])
		if m == nil {
			break
		}
		if i == start {
			prefix = m[1]
		}
		contents = append(contents, m[2])
		i++
	}
	inner := unwrapLines(contents)
	for j, line := range inner {
		if line == "" {
			inner[j] = strings.TrimRight(prefix, " \t")
		} else {
			inner[j] = prefix + line
		}
	}
	return inner, i
}

func unwrapLines(lines []string) []string {
	var result []string
	frontEnd := frontMatterEnd(lines)
	for i := 0; i < len(lines); {
		line := lines[i]
		switch {
		case i < frontEnd:
			result = append(result, line)
			i++
		case blank(line):
			result = append(result, "")
			i++
		case fenceRE.MatchString(line):
			open := fenceRE.FindStringSubmatch(line)[1]
			result = append(result, line)
			i++
			for i < len(lines) {
				result = append(result, lines[i])
				closed := fenceClose(lines[i], open)
				i++
				if closed {
					break
				}
			}
		case indented(line):
			result = append(result, line)
			i++
		case tableStart(lines, i):
			for i < len(lines) && !blank(lines[i]) && strings.Contains(lines[i], "|") {
				result = append(result, lines[i])
				i++
			}
		case htmlStart(line):
			result = append(result, line)
			i++
			for i < len(lines) && !blank(lines[i]) {
				result = append(result, lines[i])
				i++
			}
		case quoteRE.MatchString(line):
			block, next := unwrapQuote(lines, i)
			result, i = append(result, block...), next
		case topListRE.MatchString(line):
			block, next := unwrapList(lines, i)
			result, i = append(result, block...), next
		case headingRE.MatchString(line) || thematic(line) || reference(line):
			result = append(result, line)
			i++
		case setextPair(lines, i):
			result = append(result, line, lines[i+1])
			i += 2
		default:
			start := i
			i++
			for i < len(lines) && !boundary(lines, i) {
				i++
			}
			result = append(result, joinFragments(lines[start:i]))
		}
	}
	return result
}
