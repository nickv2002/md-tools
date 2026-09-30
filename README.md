# md-tools

Two small Markdown command-line tools for macOS and Linux. Release ZIPs contain
self-contained executables; Go is only needed to build from source.

## Install

On macOS ARM64 or Linux AMD64/ARM64, install both commands with Homebrew:

```bash
brew tap nickv2002/md-tools https://github.com/nickv2002/md-tools
brew trust --cask nickv2002/md-tools/md-tools
brew install --cask md-tools
```

The explicit URL is required because this repository is named `md-tools`, not
`homebrew-md-tools`. The trust command grants access to this cask only, not the
whole tap. Alternatively, download the ZIP for your architecture from
[Releases](https://github.com/nickv2002/md-tools/releases), verify its SHA-256
against `checksums.txt`, extract it, and put both executables on your `PATH`.

## Commands

```bash
mdunwrap notes.md          # rewrite one Markdown file immediately
mdunwrap ./notes           # list changed Markdown files, then confirm once
md2mkdwn notes.md          # Slack mrkdwn on stdout
cat notes.md | md2mkdwn    # stdin also works
```

Running either command without a file or piped input prints its help. Pipe
Markdown into `md2mkdwn` to convert standard input.

`mdunwrap` only accepts regular `.md` or `.markdown` files in single-file mode.
Directory mode walks recursively, skips symlinks, and lists **only files that
would change**. It requires an interactive yes/confirmation; non-interactive
directory invocations change nothing. It preserves fenced and indented code,
front matter, headings, lists, blockquotes, tables, HTML blocks, references,
dominant newline style, final-newline state, and file permissions. Each changed
file is replaced atomically. As with any multi-file operation, a later write
error can leave earlier files already updated.

`md2mkdwn` does not write files. It maps Markdown emphasis, links, code,
quotes, and lists to Slack formatting. Headings become bold lines; tables
become monospace blocks; images become links; front matter and raw HTML are
omitted. The output is a readable approximation, not a lossless conversion.

## md2mkdwn converter contract

For programs that run `md2mkdwn` as a subprocess. The converter is a readable approximation of GitHub Flavored Markdown (parsed by goldmark with the GFM extension) in Slack's mrkdwn dialect, not a lossless renderer.

**Invocation and I/O**

- `md2mkdwn FILE` reads a file; `md2mkdwn -` reads stdin. Pass `-` explicitly when piping possibly empty input: with no argument, an empty or terminal stdin prints the usage text and exits 0 instead of converting. Use `--` before a file name that starts with a dash.
- Input must be valid UTF-8. CRLF and CR line endings are normalized to LF. Invalid UTF-8 is rejected with exit 1 (the library function `slack.Convert` instead replaces bad bytes with U+FFFD).
- On success stdout receives the mrkdwn in a single write: valid UTF-8, LF line endings, exactly one trailing newline (empty or whitespace-only input yields a single `\n`), and the same bytes for the same input whether it came from a file or stdin. Nothing else is written to stdout except `--version` and help output.
- Errors go to stderr prefixed `md2mkdwn:` with nothing on stdout. Exit codes: `0` success, help or version; `1` unreadable input, invalid UTF-8 or a write failure; `2` bad flags (including a negative `--max-table-width`) or more than one file argument.
- The command never writes files, reads the network, or executes anything from the input.

**Output guarantees**

- `&`, `<` and `>` are escaped as `&amp;`, `&lt;` and `&gt;` everywhere, including code. The only raw `<` in the output starts a link (`<url|label>` or `<url>`), so input such as `<!channel>`, `<@U123>` or `<#C123>` can never become a mention or channel reference. A bare `@here` stays plain text.
- Links are emitted only for the schemes `http`, `https`, `mailto`, `tel` and `ftp`. Anything else (relative paths, `#anchors`, `javascript:`, `data:`) becomes `label (target)` text. The same fallback applies when the label contains `|`, which Slack uses as the label separator (`label (<url>)`). An empty destination keeps just the label. `|`, spaces, `<`, `>` and control characters in a URL are percent-encoded. Image destinations follow the same rules, with the alt text (or `image`) as the label.
- Emphasis becomes `_italic_`, `*bold*` and `~strike~`; headings become bold lines; markers inside link labels and headings are dropped because Slack shows them literally. Literal `*` and backticks from Markdown escapes become look-alike characters (`∗`, `ˋ`) and a zero-width space guards `_` and `~`, since mrkdwn has no escape character.
- Bold or italic that touches a letter, digit or CJK character (`foo**bar**`, `这是**重点**`) gets a U+200A hair space outside its markers, because Slack only opens emphasis after whitespace or punctuation and otherwise prints the asterisks. A zero-width space or word joiner does not work. Strikethrough needs no gap. Blank emphasis is dropped, edge whitespace moves outside the markers, and a hard line break closes and reopens the pair on each line, since Slack does not format a span that starts or ends on a space or crosses a line.
- Code spans and fences keep their text; a run of three backticks inside code is broken with a zero-width space so it cannot close the block. Fence info strings are dropped.
- Lists keep nesting and ordinals. Fences, tables and quotes inside a list item start their own line, so Slack flattens their indentation. Task list items become `☐` and `☑`.
- Tables are a padded monospace block: cells are flattened to plain text (links become `label (url)`), missing cells are blank, extra cells are dropped, and alignment comes from the delimiter row. Column width counts grapheme clusters (combining marks, variation selectors, skin tones, flags and ZWJ sequences count as one glyph, two cells for emoji). Slack's fallback fonts can still draw some CJK and emoji a cell narrower. Slack wraps code-block lines at the window width, so a table whose grid would be wider than 100 cells (`--max-table-width N`, `0` never falls back) becomes one record per body row instead: the first cell in bold, then `Header: value` pairs joined by ` · `, empty cells skipped, links and emphasis in cells preserved.
- Front matter, HTML blocks, inline HTML (except `<br>`, which becomes a line break) and empty headings are omitted.
- Malformed or unsupported Markdown degrades to readable text and never panics; `go test -fuzz FuzzConvert ./internal/slack` checks this.

## macOS trust

The macOS executables are signed with a Developer ID and their ZIP is submitted
to Apple's notarization service. Apple cannot staple a notarization ticket to a
ZIP or a standalone CLI, so a quarantined first launch may need a network
connection for Gatekeeper to retrieve the ticket. No disk image is distributed.

## Development

```bash
make check                 # gofmt, go vet and tests, identical to CI
go test -race ./...
go build ./cmd/mdunwrap ./cmd/md2mkdwn
```

The local macOS release process is documented in [RELEASING.md](RELEASING.md).
