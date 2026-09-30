//go:build slackapi

package slack

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/yuin/goldmark/ast"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/text"
)

// Differential test against the real Slack API. It posts converter output with
// chat.postMessage, reads back the rich_text tree Slack parsed, deletes the
// message, and compares it with the styling goldmark says the Markdown has.
//
//	scripts/slack-api/parity.sh            # fetches the token from 1Password
//
// Env: SLACK_BOT_TOKEN, SLACK_TEST_USER (DM target), SLACK_PARITY_N (cases,
// default 60), SLACK_PARITY_SEED (default 1), SLACK_PARITY_INPUT (one case).

type run struct {
	Text                       string
	Bold, Italic, Strike, Code bool
	URL                        string
}

func (r run) String() string {
	var s string
	for _, f := range []struct {
		on bool
		c  string
	}{{r.Bold, "b"}, {r.Italic, "i"}, {r.Strike, "s"}, {r.Code, "c"}} {
		if f.on {
			s += f.c
		}
	}
	out := fmt.Sprintf("[%s]%q", s, r.Text)
	if r.URL != "" {
		out += "->" + r.URL
	}
	return out
}

// expectedRuns flattens the inline styling goldmark sees in one paragraph.
func expectedRuns(node ast.Node, source []byte, st run, out *[]run) bool {
	for c := node.FirstChild(); c != nil; c = c.NextSibling() {
		switch n := c.(type) {
		case *ast.Text:
			t := unescapeText(string(n.Segment.Value(source)), false)
			if n.HardLineBreak() {
				t += "\n"
			} else if n.SoftLineBreak() {
				t += " "
			}
			r := st
			r.Text = t
			*out = append(*out, r)
		case *ast.String:
			r := st
			r.Text = string(n.Value)
			*out = append(*out, r)
		case *ast.Emphasis:
			s := st
			if n.Level >= 2 {
				s.Bold = true
			} else {
				s.Italic = true
			}
			if !expectedRuns(n, source, s, out) {
				return false
			}
		case *extast.Strikethrough:
			s := st
			s.Strike = true
			if !expectedRuns(n, source, s, out) {
				return false
			}
		case *ast.CodeSpan:
			var b strings.Builder
			for cc := n.FirstChild(); cc != nil; cc = cc.NextSibling() {
				if t, ok := cc.(*ast.Text); ok {
					b.Write(t.Segment.Value(source))
					if t.SoftLineBreak() || t.HardLineBreak() {
						b.WriteByte(' ')
					}
				}
			}
			r := st
			r.Text, r.Code = b.String(), true
			*out = append(*out, r)
		case *ast.Link:
			var inner []run
			if !expectedRuns(n, source, run{}, &inner) {
				return false
			}
			var b strings.Builder
			for _, r := range inner {
				b.WriteString(r.Text)
			}
			r := st // outer styling applies to the whole link; markup inside the label is dropped
			r.Text, r.URL = b.String(), strings.TrimSpace(unescapeText(string(n.Destination), false))
			*out = append(*out, r)
		default:
			return false
		}
	}
	return true
}

// cells expands runs to one entry per character so that comparison ignores
// how Slack happened to split or merge runs. Whitespace carries no style, and
// zero-width and hair spaces are dropped.
func cells(in []run) []string {
	var out []string
	for _, r := range in {
		t := strings.NewReplacer("\u200a", "", "\u200b", "", "∗", "*", "ˋ", "`").Replace(r.Text)
		for _, ch := range t {
			if ch == ' ' || ch == '\n' || ch == '\t' {
				if n := len(out); n > 0 && out[n-1] == " " {
					continue
				}
				out = append(out, " ")
				continue
			}
			key := fmt.Sprintf("%c", ch)
			if r.Bold || r.Italic || r.Strike || r.Code || r.URL != "" {
				key += fmt.Sprintf("|%t%t%t%t|%s", r.Bold, r.Italic, r.Strike, r.Code, r.URL)
			}
			out = append(out, key)
		}
	}
	for len(out) > 0 && out[0] == " " {
		out = out[1:]
	}
	for len(out) > 0 && out[len(out)-1] == " " {
		out = out[:len(out)-1]
	}
	return out
}

type element struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	URL   string `json:"url"`
	Style struct {
		Bold, Italic, Strike, Code bool
	} `json:"style"`
}

type postResponse struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error"`
	TS      string `json:"ts"`
	Channel string `json:"channel"`
	Message struct {
		Blocks []struct {
			Type     string `json:"type"`
			Elements []struct {
				Type     string    `json:"type"`
				Elements []element `json:"elements"`
			} `json:"elements"`
		} `json:"blocks"`
	} `json:"message"`
}

type slackClient struct {
	token, user string
	http        http.Client
}

func (c *slackClient) call(method string, body any) (json.RawMessage, error) {
	for attempt := 0; ; attempt++ {
		payload, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", "https://slack.com/api/"+method, bytes.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
		resp, err := c.http.Do(req)
		if err != nil {
			return nil, err
		}
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 429 && attempt < 5 {
			wait, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			time.Sleep(time.Duration(max(wait, 1)) * time.Second)
			continue
		}
		return data, nil
	}
}

// parse posts mrkdwn and returns the runs Slack parsed, or an explanation when
// the message is not a single plain rich_text_section.
func (c *slackClient) parse(mrkdwn string) ([]run, string, error) {
	data, err := c.call("chat.postMessage", map[string]any{"channel": c.user, "text": mrkdwn, "mrkdwn": true, "unfurl_links": false, "unfurl_media": false})
	if err != nil {
		return nil, "", err
	}
	var r postResponse
	if err := json.Unmarshal(data, &r); err != nil || !r.OK {
		return nil, "", fmt.Errorf("chat.postMessage: %s %v", r.Error, err)
	}
	defer c.call("chat.delete", map[string]any{"channel": r.Channel, "ts": r.TS})
	if len(r.Message.Blocks) != 1 || len(r.Message.Blocks[0].Elements) != 1 || r.Message.Blocks[0].Elements[0].Type != "rich_text_section" {
		return nil, "message is not a single rich_text_section", nil
	}
	var out []run
	for _, e := range r.Message.Blocks[0].Elements[0].Elements {
		switch e.Type {
		case "text":
			out = append(out, run{Text: e.Text, Bold: e.Style.Bold, Italic: e.Style.Italic, Strike: e.Style.Strike, Code: e.Style.Code})
		case "link":
			out = append(out, run{Text: e.Text, URL: e.URL, Bold: e.Style.Bold, Italic: e.Style.Italic, Strike: e.Style.Strike, Code: e.Style.Code})
		default:
			return nil, "unexpected element " + e.Type, nil
		}
	}
	return out, "", nil
}

// pileup matches runs of delimiters that goldmark leaves half-literal; they are
// not worth chasing.
var pileup = regexp.MustCompile(`\*{4,}|_{3,}|~{3,}|\*\*\*\*|~~~~`)

var words = []string{"foo", "bar", "x", "y1", "日本", "重点", "snake_case", "a", "Bee", "2", "don't", "(paren)", "\"q\"", "end.", "a-b", "Go"}

func genInline(r *rand.Rand, depth int) string {
	n := 1 + r.Intn(3)
	var b strings.Builder
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString([]string{" ", "", " ", ", ", "-"}[r.Intn(5)])
		}
		w := words[r.Intn(len(words))]
		if depth <= 0 {
			b.WriteString(w)
			continue
		}
		switch r.Intn(9) {
		case 0:
			b.WriteString("**" + genInline(r, depth-1) + "**")
		case 1:
			b.WriteString("*" + genInline(r, depth-1) + "*")
		case 2:
			b.WriteString("_" + genInline(r, depth-1) + "_")
		case 3:
			b.WriteString("~~" + genInline(r, depth-1) + "~~")
		case 4:
			b.WriteString("`" + w + "`")
		case 5:
			b.WriteString("[" + w + "](https://example.com/" + strconv.Itoa(r.Intn(9)) + ")")
		case 6:
			b.WriteString("__" + genInline(r, depth-1) + "__")
		default:
			b.WriteString(w)
		}
	}
	return b.String()
}

func TestSlackParity(t *testing.T) {
	token := os.Getenv("SLACK_BOT_TOKEN")
	user := os.Getenv("SLACK_TEST_USER")
	if token == "" || user == "" {
		t.Skip("set SLACK_BOT_TOKEN and SLACK_TEST_USER (see scripts/slack-api/parity.sh)")
	}
	n, _ := strconv.Atoi(os.Getenv("SLACK_PARITY_N"))
	if n == 0 {
		n = 60
	}
	seed, _ := strconv.ParseInt(os.Getenv("SLACK_PARITY_SEED"), 10, 64)
	if seed == 0 {
		seed = 1
	}
	rng := rand.New(rand.NewSource(seed))
	client := &slackClient{token: token, user: user}

	var inputs []string
	if one := os.Getenv("SLACK_PARITY_INPUT"); one != "" {
		inputs = strings.Split(one, "\n@@\n")
	}
	for os.Getenv("SLACK_PARITY_INPUT") == "" && len(inputs) < n {
		inputs = append(inputs, genInline(rng, 2))
	}

	failures, checked := 0, 0
	for _, in := range inputs {
		source := []byte(in)
		root := parser.Parser().Parse(text.NewReader(source))
		if root.ChildCount() != 1 || pileup.MatchString(in) {
			continue
		}
		para, ok := root.FirstChild().(*ast.Paragraph)
		if !ok {
			continue
		}
		var want []run
		if !expectedRuns(para, source, run{}, &want) {
			continue
		}
		mrkdwn := Convert(source)
		got, note, err := client.parse(strings.TrimSuffix(mrkdwn, "\n"))
		if err != nil {
			t.Fatal(err)
		}
		time.Sleep(1100 * time.Millisecond)
		checked++
		if note != "" {
			t.Logf("SKIP %q -> %q: %s", in, mrkdwn, note)
			continue
		}
		if w, g := cells(want), cells(got); strings.Join(w, "\x00") != strings.Join(g, "\x00") {
			failures++
			t.Errorf("MISMATCH\n  markdown: %q\n  mrkdwn:   %q\n  want: %v\n  got:  %v", in, mrkdwn, want, got)
		}
	}
	t.Logf("checked %d cases (seed %d), %d mismatches", checked, seed, failures)
}
