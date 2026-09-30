package slack

import (
	"strings"
	"testing"
)

func TestConvert(t *testing.T) {
	tests := []struct{ name, input, want string }{
		{"basic", "# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code`.\n", "*Title*\n\nSome *bold*, _italic_, ~gone~ and `code`.\n"},
		{"links and images", "[Site](https://example.com) ![Chart](https://example.com/a.png)", "<https://example.com|Site> <https://example.com/a.png|Chart>\n"},
		{"front matter and HTML", "---\ntitle: Secret\n---\n# Hi\n\n<div>discard</div>\n\nText\n", "*Hi*\n\nText\n"},
		{"fence", "```go\nfmt.Println(1)\n```", "```\nfmt.Println(1)\n```\n"},
		{"quote", "> A line\n> another line", "> A line another line\n"},
		{"list", "- One\n- Two\n", "• One\n• Two\n"},
		{"table", "| A | B |\n| --- | --- |\n| one | two |", "```\nA   | B\n----+----\none | two\n```\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Convert([]byte(tt.input)); got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

// Cases drawn from formatting failures seen in real Slack threads: agents
// mixing Markdown with mrkdwn, fences inside lists, entities, and link edge cases.
func TestConvertSlackRegressions(t *testing.T) {
	const z = "\u200b"
	tests := []struct{ name, input, want string }{
		{"angle bracket link destination", "See [#123](<https://x.io/pull/123>).", "See <https://x.io/pull/123|#123>.\n"},
		{"code span in a link label keeps its backticks", "[`PR #60017`](<https://x.io/60017>)", "<https://x.io/60017|`PR #60017`>\n"},
		{"fence inside list item", "1. Confirm\n   the build.\n2. Compare:\n\n   ```bash\n   git diff a b\n   ```\n\n3. Done", "1. Confirm the build.\n2. Compare:\n```\ngit diff a b\n```\n3. Done\n"},
		{"nested list has no trailing space", "- top\n  - child **bold**\n    - grand", "• top\n    ◦ child *bold*\n        – grand\n"},
		{"bold inside heading", "## **Verdict:** see [doc](https://a.b) and __init__", "*Verdict: see <https://a.b|doc> and init*\n"},
		{"italic inside heading kept", "# A *b* c", "*A _b_ c*\n"},
		{"entities are not double escaped", "Use &amp; and &lt;tag&gt; and &copy;", "Use &amp; and &lt;tag&gt; and ©\n"},
		{"entity in code span stays literal", "`&amp;`", "`&amp;amp;`\n"},
		{"pipe in url", "[a](https://x.io/?q=a|b)", "<https://x.io/?q=a%7Cb|a>\n"},
		{"space in url", "[a](<https://x.io/a b>)", "<https://x.io/a%20b|a>\n"},
		{"ampersand in url", "[q](https://a.io/x?a=1&b=2)", "<https://a.io/x?a=1&amp;b=2|q>\n"},
		{"escaped asterisks are neutralized", "Price \\*not bold\\*", "Price ∗not bold∗\n"},
		{"second paragraph in list item stays on its own line", "- first\n\n  second\n- next", "• first\nsecond\n• next\n"},
		{"escaped backtick cannot open code", "\\`not code\\`", "ˋnot codeˋ\n"},
		{"emphasis in a link label is kept", "[**b**](https://x.io/b) [_i_](https://x.io/i) [~~s~~](https://x.io/s) [`c`](https://x.io/c)", "<https://x.io/b|*b*> <https://x.io/i|_i_> <https://x.io/s|~s~> <https://x.io/c|`c`>\n"},
		{"escaped punctuation loses backslash", "1\\. and \\> and a\\.b", "1. and &gt; and a.b\n"},
		{"image inside link", "[![alt](https://i.io/a.png)](https://x.io)", "<https://x.io|alt>\n"},
		{"link syntax in code span stays literal", "Run `[a](https://x.io)` or `curl https://x.io/a`", "Run `[a](https://x.io)` or `curl https://x.io/a`\n"},
		{"slack link syntax in code span is escaped", "`<https://x.io|a>`", "`&lt;https://x.io|a&gt;`\n"},
		{"links in fence stay literal", "```\n[a](https://x.io) https://x.io\n```", "```\n[a](https://x.io) https://x.io\n```\n"},
		{"slack specials in fence are escaped", "```\n<https://x.io|a> <!channel> a && b\n```", "```\n&lt;https://x.io|a&gt; &lt;!channel&gt; a &amp;&amp; b\n```\n"},
		{"links in table cells flatten to text", "| A |\n|---|\n| `https://x.io` and [l](https://x.io) |", "```\nA\n----------------------\nhttps://x.io and l [1]\n```\n[1] <https://x.io|l>\n"},
		{"nested fence cannot close block", "````markdown\n# Doc\n\n```mermaid\nA --> B\n```\n````", "```\n# Doc\n\n``" + z + "`mermaid\nA --&gt; B\n``" + z + "`\n```\n"},
		{"blockquote has no trailing spaces", "> **Note**\n> - one\n> - two", "> *Note*\n>\n>• one\n>• two\n"},
		{"br becomes newline", "a<br>b", "a\nb\n"},
		{"task list", "- [ ] todo\n- [x] done", "• ☐ todo\n• ☑ done\n"},
		{"mention and channel injection neutralized", "<!channel> <@U123> @here", "&lt;!channel&gt; &lt;@U123&gt; @here\n"},
		{"snake case and underscores untouched", "if_changed snake_case_name", "if_changed snake_case_name\n"},
		{"autolink and bare url", "<https://example.com/x> https://bare.example/y", "<https://example.com/x> <https://bare.example/y>\n"},
		{"setext heading", "Title\n=====", "*Title*\n"},
		{"reference link", "[ref][1]\n\n[1]: https://ref.example", "<https://ref.example|ref>\n"},
		{"emoji shortcodes", ":white_check_mark: done ✅", ":white_check_mark: done ✅\n"},
		{"strikethrough", "~~double~~ ~single~", "~double~ ~single~\n"},
		{"agent reply with angle-bracket links, bold labels, code in a label, and italic",
			"Checked: `limit: 1` is set in [PR #10](<https://git.example/pull/10>), commit [`abc1234`](<https://git.example/commit/abc1234>).\n\n**Who/when:** Sam added it in [PR #20](<https://git.example/pull/20>) on Sep 14; it was reverted in [PR #30](<https://git.example/pull/30>) (“too strict”).\n\nSo `1` is a cap for *this matrix*, not every workload; see [the thread](<https://chat.example/p1>).",
			"Checked: `limit: 1` is set in <https://git.example/pull/10|PR #10>, commit <https://git.example/commit/abc1234|`abc1234`>.\n\n*Who/when:* Sam added it in <https://git.example/pull/20|PR #20> on Sep 14; it was reverted in <https://git.example/pull/30|PR #30> (“too strict”).\n\nSo `1` is a cap for _this matrix_, not every workload; see <https://chat.example/p1|the thread>.\n"},
		{"table cell escapes entity once", "| A |\n|---|\n| `a\\|b` &amp; c |", "```\nA\n-------\na|b &amp; c\n```\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Convert([]byte(tt.input)); got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTableAlignmentAndPlainCells(t *testing.T) {
	in := "| Name | N | C |\n| :-- | --: | :-: |\n| [a](https://x.io) **b** | 5 | ok |\n| 日本 | 1,250 | y |\n"
	want := "```\n" +
		"Name    |     N | C\n" +
		"--------+-------+---\n" +
		"a [1] b |     5 | ok\n" +
		"日本    | 1,250 | y\n" +
		"```\n" +
		"[1] <https://x.io|a>\n"
	if got := Convert([]byte(in)); got != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestEscapesSlackSpecials(t *testing.T) {
	got := Convert([]byte("A & B < C > D"))
	if !strings.Contains(got, "A &amp; B &lt; C &gt; D") {
		t.Fatal(got)
	}
}
