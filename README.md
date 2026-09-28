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

## macOS trust

The macOS executables are signed with a Developer ID and their ZIP is submitted
to Apple's notarization service. Apple cannot staple a notarization ticket to a
ZIP or a standalone CLI, so a quarantined first launch may need a network
connection for Gatekeeper to retrieve the ticket. No disk image is distributed.

## Development

```bash
go test ./...
go build ./cmd/mdunwrap ./cmd/md2mkdwn
```

The local macOS release process is documented in [RELEASING.md](RELEASING.md).
