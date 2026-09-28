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
		{"list", "- One\n- Two\n", "- One\n- Two\n"},
		{"table", "| A | B |\n| --- | --- |\n| one | two |", "```\nA | B\none | two\n```\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Convert([]byte(tt.input)); got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEscapesSlackSpecials(t *testing.T) {
	got := Convert([]byte("A & B < C > D"))
	if !strings.Contains(got, "A &amp; B &lt; C &gt; D") {
		t.Fatal(got)
	}
}
