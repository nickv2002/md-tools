package slack

import (
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"
)

func runCases(t *testing.T, tests []struct{ name, input, want string }) {
	t.Helper()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Convert([]byte(tt.input)); got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestLinkSafety(t *testing.T) {
	runCases(t, []struct{ name, input, want string }{
		{"pipe in label falls back to label (url)", "[a|b](https://x.io)", "a|b (<https://x.io>)\n"},
		{"angle brackets and ampersand in label", "[a < b > &c](https://x.io)", "<https://x.io|a &lt; b &gt; &amp;c>\n"},
		{"channel mention in label is escaped", "[<!channel>](https://x.io)", "<https://x.io|&lt;!channel&gt;>\n"},
		{"mrkdwn markers in label lose emphasis", "[*a* `b` _c_ ~d~](https://x.io)", "<https://x.io|a b c d>\n"},
		{"escaped markers in label are neutralized", "[\\*a\\*](https://x.io)", "<https://x.io|∗a∗>\n"},
		{"label newline collapses", "[a  \nb](https://x.io)", "<https://x.io|a b>\n"},
		{"empty link destination keeps label", "[x]()", "x\n"},
		{"empty link with empty label vanishes", "[]()", "\n"},
		{"empty image destination keeps alt", "![alt]() ![]()", "alt\n"},
		{"whitespace-only destination", "[x](<  >)", "x\n"},
		{"javascript scheme is not linked", "[x](javascript:alert(1))", "x (javascript:alert(1))\n"},
		{"data image is not linked", "![a](data:image/png;base64,AAA)", "a (data:image/png;base64,AAA)\n"},
		{"scheme check is case insensitive", "[d](HTTPS://X.IO)", "<HTTPS://X.IO|d>\n"},
		{"relative path and anchor fall back", "[e](/rel/a.md) [f](#anc)", "e (/rel/a.md) f (#anc)\n"},
		{"mailto and tel are linked", "[m](mailto:a@b.co) [t](tel:+15551234)", "<mailto:a@b.co|m> <tel:+15551234|t>\n"},
		{"scheme with nothing after it", "[x](https:)", "x (https:)\n"},
		{"email autolink gets mailto", "<a@b.co>", "<mailto:a@b.co|a@b.co>\n"},
		{"unknown autolink scheme is plain text", "<irc://x.io/chan>", "irc://x.io/chan\n"},
		{"entity in destination decoded once", "[a](https://x.io/?a=1&amp;b=2)", "<https://x.io/?a=1&amp;b=2|a>\n"},
		{"backslash escape in destination", "[b](https://x.io/a\\_b)", "<https://x.io/a_b|b>\n"},
		{"angle brackets in destination are encoded", "[a](<https://x.io/a>b>)", "[a](<https://x.io/a>b&gt;)\n"},
		{"lt in destination is encoded", "[a](<https://x.io/<b>)", "<https://x.io/%3Cb|a>\n"},
		{"newline-free tab in destination", "[a](<https://x.io/a\tb>)", "<https://x.io/a%09b|a>\n"},
		{"label equal to url collapses", "[https://x.io](https://x.io)", "<https://x.io>\n"},
		{"image with empty alt uses image", "![](https://x.io/a.png)", "<https://x.io/a.png|image>\n"},
		{"image label escapes specials", "![a<b](https://x.io/a.png)", "<https://x.io/a.png|a&lt;b>\n"},
		{"relative image falls back", "![chart](chart.png)", "chart (chart.png)\n"},
		{"reference to empty definition", "[a]: <>\n\n[b][a]", "b\n"},
	})
}

func TestBlockNesting(t *testing.T) {
	runCases(t, []struct{ name, input, want string }{
		{"ordered start number kept", "5. five\n6. six", "5. five\n6. six\n"},
		{"nested ordered under bullets", "- a\n  1. b\n  2. c\n- d", "- a\n  1. b\n  2. c\n- d\n"},
		{"fence in nested list", "1. a\n   - b\n     ```\n     x\n     ```\n   - c", "1. a\n  - b\n```\nx\n```\n  - c\n"},
		{"quote in list item starts its own line", "- a\n\n  > quote\n  > more\n- b", "- a\n> quote more\n- b\n"},
		{"table in list item", "- a\n\n  | A |\n  |---|\n  | 1 |\n- b", "- a\n```\nA\n-\n1\n```\n- b\n"},
		{"three paragraphs in list item", "- a\n\n  b\n\n  c\n- d", "- a\nb\nc\n- d\n"},
		{"list in quote", "> - a\n>   - b", "> - a\n>   - b\n"},
		{"fence in quote", "> ```\n> x\n> ```", "> ```\n> x\n> ```\n"},
		{"nested quotes", "> a\n>\n> > b", "> a\n>\n> > b\n"},
		{"empty list item", "- \n- b", "- \n- b\n"},
		{"task list nested", "- [x] a\n  - [ ] b", "- ☑ a\n  - ☐ b\n"},
		{"indented code block", "    code\n\ntext", "```\ncode\n```\n\ntext\n"},
		{"empty fence", "```\n```", "```\n\n```\n"},
		{"thematic breaks", "* * *\n\n- - -", "---\n\n---\n"},
		{"empty headings vanish", "#\n\n# \n\ntext", "text\n"},
		{"setext heading multiline joins", "Title\nline2\n---", "*Title line2*\n"},
		{"empty quote vanishes", ">\n\ntext", "text\n"},
		{"html block and comment dropped", "<!-- c -->\n\n<div>x</div>\n\ntext", "text\n"},
		{"toml front matter dropped", "+++\na = 1\n+++\ntext", "text\n"},
		{"unterminated front matter is text", "---\na: 1\ntext", "---\n\na: 1 text\n"},
		{"crlf input", "# A\r\n\r\n- b\r\n", "*A*\n\n- b\n"},
		{"empty input", "", "\n"},
		{"whitespace input", " \n\t\n", "\n"},
	})
}

func TestCodeSafety(t *testing.T) {
	const z = "​"
	runCases(t, []struct{ name, input, want string }{
		{"backtick in code span", "`` a`b ``", "`aˋb`\n"},
		{"empty code span is not backticks", "`` ``", "\n"},
		{"control characters in code span", "`<!channel> &`", "`&lt;!channel&gt; &amp;`\n"},
		{"triple backticks in fence", "````\n```\n````", "```\n``" + z + "`\n```\n"},
		{"backtick run longer than fence", "`````\na ```` b\n`````", "```\na ``" + z + "`` b\n```\n"},
		{"fence content ends with backticks", "````\n``\n````", "```\n``\n```\n"},
		{"fence info string dropped", "```js title=x\nlet a;\n```", "```\nlet a;\n```\n"},
		{"mention in fence", "```\n<!here> <@U1>\n```", "```\n&lt;!here&gt; &lt;@U1&gt;\n```\n"},
		{"tilde fence", "~~~\nx\n~~~", "```\nx\n```\n"},
		{"unclosed fence", "```\nx", "```\nx\n```\n"},
	})
}

func TestInjectionPrevention(t *testing.T) {
	inputs := []string{
		"<!channel>", "<!here|here>", "<!everyone>", "<@U123|x>", "<#C123|general>", "<!subteam^S1>",
		"[<!channel>](https://x.io)", "![<!here>](https://x.io/a.png)", "| <!channel> |\n|---|\n| <@U1> |",
		"# <!channel>", "> <!channel>", "- <!channel>", "**<!channel>**", "`<!channel>`", "```\n<!channel>\n```",
		"<b>&lt;!channel&gt;</b>", "&lt;!channel&gt;", "[x](<https://x.io/<!channel>>)", "<https://x.io|<!channel>>",
	}
	for _, in := range inputs {
		got := Convert([]byte(in))
		if strings.Contains(got, "<!") || strings.Contains(got, "<@") || strings.Contains(got, "<#") {
			t.Errorf("%q leaked a Slack control sequence: %q", in, got)
		}
	}
}

func TestTableNormalization(t *testing.T) {
	runCases(t, []struct{ name, input, want string }{
		{"missing cells", "| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 |", "```\nA | B | C\n--+---+--\n1\n1 | 2\n```\n"},
		{"extra cells dropped", "| A |\n|---|\n| 1 | 2 | 3 |", "```\nA\n-\n1\n```\n"},
		{"empty cells", "| A | B |\n|---|---|\n|   | x |\n| y |   |", "```\nA | B\n--+--\n  | x\ny\n```\n"},
		{"all-empty row is blank", "| A | B |\n|---|---|\n|  |  |\n| 1 | 2 |", "```\nA | B\n--+--\n\n1 | 2\n```\n"},
		{"empty header", "|  |  |\n|---|---|\n| 1 | 2 |", "```\n\n--+--\n1 | 2\n```\n"},
		{"header only", "| A | B |\n|---|---|", "```\nA | B\n--+--\n```\n"},
		{"br makes multiline cell one line", "| A |\n|---|\n| a<br>b<br/>c |", "```\nA\n-----\na b c\n```\n"},
		{"escaped pipe", "| A |\n|---|\n| a\\|b |", "```\nA\n---\na|b\n```\n"},
		{"trailing pipe in last cell kept", "| A | B |\n|---|---|\n| x | a\\| |", "```\nA | B\n--+---\nx | a|\n```\n"},
		{"flattening", "| A |\n|---|\n| **b** _i_ ~~s~~ ![img](x.png) [l](https://x.io) &copy; &lt;t&gt; [x] |", "```\nA\n" + strings.Repeat("-", 36) + "\nb i s img l (https://x.io) © &lt;t&gt; [x]\n```\n"},
		{"task checkbox", "| A |\n|---|\n| - [ ] x |", "```\nA\n-------\n- [ ] x\n```\n"},
		{"fence marker in cell", "| A |\n|---|\n| ``` |", "```\nA\n---\n``​`\n```\n"},
	})
}

func TestDisplayWidth(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want int
	}{
		{"ascii", "abc", 3},
		{"empty", "", 0},
		{"cjk", "日本語", 6},
		{"hangul", "한글", 4},
		{"fullwidth latin", "Ａ", 2},
		{"combining acute", "é", 1},
		{"combining stack", "á̂̃", 1},
		{"precomposed", "é", 1},
		{"emoji", "😀", 2},
		{"check mark button", "✅", 2},
		{"cross mark", "❌", 2},
		{"text heart", "❤", 1},
		{"emoji heart via VS16", "❤️", 2},
		{"text presentation forced", "😀︎", 1},
		{"skin tone", "👍🏽", 2},
		{"flag", "🇺🇸", 2},
		{"two flags", "🇺🇸🇯🇵", 4},
		{"lone regional indicator", "🇺", 2},
		{"zwj family", "👨‍👩‍👧", 2},
		{"zwj with modifier", "🧑🏽‍💻", 2},
		{"keycap", "1️⃣", 2},
		{"tag flag", "🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f", 2},
		{"zero width space", "a​b", 2},
		{"leading combining mark", "́a", 1},
		{"lone joiner", "‍", 0},
		{"trailing joiner", "a‍", 1},
		{"mixed", "a日😀é", 6},
		{"control", "a\x01b", 2},
		{"replacement char", "�", 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := displayWidth(tt.s); got != tt.want {
				t.Errorf("displayWidth(%q) = %d, want %d", tt.s, got, tt.want)
			}
		})
	}
}

func TestTableUnicodeAlignment(t *testing.T) {
	in := "| K | V |\n|---|---|\n| 👨‍👩‍👧 | a |\n| 🇺🇸 | b |\n| 👍🏽 | c |\n| e\u0301 | d |\n| ❤️ | e |\n| 日本 | f |\n"
	// The widest cell (日本) is four cells; each emoji cluster is two.
	want := "```\n" +
		"K    | V\n" +
		"-----+--\n" +
		"👨‍👩‍👧   | a\n" +
		"🇺🇸   | b\n" +
		"👍🏽   | c\n" +
		"e\u0301    | d\n" +
		"❤️   | e\n" +
		"日本 | f\n" +
		"```\n"
	if got := Convert([]byte(in)); got != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestMalformedInputNeverPanics(t *testing.T) {
	inputs := []string{
		"", "\x00", "\xff\xfe", "[", "]", "[]", "![", "![]", "[a](", "[a](<", "[a](<b", "[a]: ", "[a]: <", "<", ">", "&", "&#", "&#x;", "&#99999999999;",
		"```", "````", "~~~", "> ", ">>>>", "- ", "1.", "1) ", "| a", "|---|", "| a |\n|-", "| a | b |\n| - |", "|a|\n|:-:|\n|b|c|d|",
		"---\n", "+++\n", "---\n---", "<!--", "<div>", "</div>", "<br", "<br/>", "\\", "\\\\", "`", "``", "***", "___", "~~", "~~~~",
		"[a]\n\n[a]: /x", "[a][b]", "![a][b]", "* * *", "\t- a\n\t\t- b", "- a\n\n\n\n- b", "1. a\n1. b\n1. c",
		"​", "‍", "️", "\U0001f1fa", "| \U0001f1fa |\n|-|\n| ‍ |", string([]byte{0xe2, 0x82}),
		strings.Repeat("> ", 500) + "x", strings.Repeat("- ", 200) + "x", strings.Repeat("[", 1000), strings.Repeat("*a", 1000),
		strings.Repeat("`", 999), "| " + strings.Repeat("a | ", 500) + "\n|" + strings.Repeat("-|", 500) + "\n",
	}
	for _, in := range inputs {
		assertWellFormed(t, in)
	}
}

// linkStart matches the start of a Slack link body: an allowed scheme and a
// target with no whitespace before the pipe or closing bracket.
var linkStart = regexp.MustCompile(`(?i)^(?:https?|mailto|tel|ftp):[^\s|>]+[|>]`)

func assertWellFormed(t testing.TB, in string) {
	t.Helper()
	got := Convert([]byte(in))
	if !utf8.ValidString(got) {
		t.Fatalf("invalid UTF-8 output for %q: %q", in, got)
	}
	if !strings.HasSuffix(got, "\n") || strings.HasSuffix(got, "\n\n") {
		t.Fatalf("want exactly one trailing newline for %q, got %q", in, got)
	}
	if strings.Contains(got, "\r") {
		t.Fatalf("carriage return in output for %q: %q", in, got)
	}
	for rest := got; ; {
		i := strings.IndexByte(rest, '<')
		if i < 0 {
			break
		}
		rest = rest[i+1:]
		end := strings.IndexAny(rest, ">\n")
		if end < 0 || rest[end] != '>' || !linkStart.MatchString(rest) {
			t.Fatalf("unsafe < in output for %q: %q", in, got)
		}
	}
	if again := Convert([]byte(in)); again != got {
		t.Fatalf("non-deterministic output for %q", in)
	}
}

func FuzzConvert(f *testing.F) {
	seeds := []string{
		"# Title\n\n**bold** _it_ ~~s~~ `c` [l](https://x.io) ![i](https://x.io/a.png)",
		"- a\n  - b\n    ```\n    x\n    ```\n1. c\n> q\n\n| A | B |\n|:-:|--:|\n| 1 | 2 |",
		"[a|b](<https://x.io/a b>) <!channel> &amp; <a@b.co> www.x.io",
		"---\ntitle: x\n---\n<div>x</div>\n\n- [ ] t\n- [x] d",
		"| 👨‍👩‍👧 | 🇺🇸 | é |\n|---|---|---|\n| ❤️ | 👍🏽 | 日本 |",
		"````md\n```js\nx\n```\n````", "\xff\x00\r\n\r\r",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, in string) {
		assertWellFormed(t, in)
	})
}

func TestTableCellFlatteningKinds(t *testing.T) {
	in := "| A |\n|---|\n" +
		"| <https://x.io/a> <a@b.co> www.x.io |\n" +
		"| [](https://x.io) [https://y.io](https://y.io) |\n" +
		"| **_nested_ `code <b>`** ![](i.png) |\n" +
		"| a<br>b |\n"
	got := Convert([]byte(in))
	for _, want := range []string{"https://x.io/a a@b.co http://www.x.io", "https://x.io https://y.io", "nested code <b>", "a b"} {
		if !strings.Contains(strings.NewReplacer("&lt;", "<", "&gt;", ">").Replace(got), want) {
			t.Errorf("missing %q in\n%s", want, got)
		}
	}
	if strings.ContainsAny(got, "*_~") {
		t.Errorf("markup leaked into table:\n%s", got)
	}
}

func TestEmphasisTouchingWordsGetsHairSpace(t *testing.T) {
	const h = " "
	runCases(t, []struct{ name, input, want string }{
		{"bold inside a word", "foo**bar**baz", "foo" + h + "*bar*" + h + "baz\n"},
		{"cjk bold", "这是**重点**文字", "这是" + h + "*重点*" + h + "文字\n"},
		{"italic after a letter only", "x*y* z", "x" + h + "_y_ z\n"},
		{"italic before a letter only", "a *y*z", "a _y_" + h + "z\n"},
		{"digits count as word characters", "1**2**3", "1" + h + "*2*" + h + "3\n"},
		{"spaces need no gap", "a **b** c", "a *b* c\n"},
		{"punctuation needs no gap", "(**b**) \"**c**\" **d**.", "(*b*) \"*c*\" *d*.\n"},
		{"line start and end need no gap", "**b**", "*b*\n"},
		{"soft line break is a boundary", "a\n**b**\nc", "a *b* c\n"},
		{"strikethrough needs no gap", "a~~b~~c", "a~b~c\n"},
		{"adjacent emphasis needs no gap", "**a**_b_", "*a*_b_\n"},
		{"link neighbour needs no gap", "[l](https://x.io)**b**", "<https://x.io|l>*b*\n"},
	})
}
