# md2mkdwn-ts

A TypeScript port of the Go converter in `internal/slack`: `markdownToSlackMrkdwn(markdown, { maxTableWidth })` returns the same Slack mrkdwn the `md2mkdwn` CLI prints, byte for byte. It is a pure function with no I/O.

```ts
import { markdownToSlackMrkdwn } from './src/index.js'

markdownToSlackMrkdwn('**bold** and a [link](https://example.com)') // "*bold* and a <https://example.com|link>\n"
markdownToSlackMrkdwn(table, { maxTableWidth: 0 }) // always an aligned grid (default 100 cells, wider tables become one record per row)
```

## How it stays identical to Go

The Go converter renders the tree that goldmark (with its GFM extension) produces, and several goldmark behaviors differ from the CommonMark spec (raw HTML and declaration rules, list and table quirks, linkify, delimiter handling). A different Markdown library would not reproduce them, so `src/goldmark/` is a line-by-line port of the parts of goldmark that `extension.GFM` uses, working on UTF-8 bytes like the original. `src/render.ts` is a port of `internal/slack/slack.go`, `src/gotext.ts` holds the Go string semantics it relies on (`unicode.IsSpace`, `html.UnescapeString`, `ToValidUTF8`), and `src/width.ts` ports `displayWidth`.

## Testing

```bash
npm install          # only inside ts/
npm run typecheck
npm test             # unit tests plus test/fixtures.json, the Go converter's output for ~7.7k inputs (no Go needed)
```

`parity/` compares against the Go converter itself and needs Go (`go build -tags slackdump` builds `scripts/ts-parity/godump`, a batch driver that also dumps goldmark's tree):

| Command | What it checks |
| --- | --- |
| `npx tsx parity/run.ts tree\|e2e\|render [limit] [goldmark\|gofuzz]` | the Go test literals, goldmark's spec and extension examples, or the Go fuzz engine's cache: parsed tree (`tree`), final output (`e2e`), or the TS renderer fed Go's own tree (`render`) |
| `npx tsx parity/fuzz.ts tree\|e2e <seed> <count>` | seeded grammar, character-soup and mutation inputs, including invalid UTF-8 and random table widths |
| `npx tsx parity/enumerate.ts <length> <random>` | every token sequence up to a length over inline- and block-focused alphabets, plus random longer ones |
| `npx tsx parity/exhaustive.ts` | every code point through tables, span boundaries, links and entities |
| `npx tsx parity/exhaustive2.ts` | every HTML entity name, every numeric reference, random grapheme sequences |
| `npx tsx parity/classes.ts` | Unicode classification (punctuation, space, zero width) for every code point, Go vs this runtime |
| `npx tsx parity/labels.ts` | link reference case folding for every code point |
| `npm run fixtures` | regenerates `test/fixtures.json` from the Go converter |

Any difference prints the smallest input that shows it, with both outputs.

## Known limits

- The renderer recurses once or twice per nesting level: roughly 1000 levels of nested emphasis or 2500 of nested blockquotes overflow the JavaScript stack and throw a `RangeError` where Go keeps going (parsing and tree conversion are iterative). Real messages are nowhere near that, but callers that accept untrusted input should catch it.
- Character classes come from the runtime's Unicode tables, which matched Go 1.27 on Node 24 (Unicode 17). A runtime with older tables can differ for recently added characters; `parity/classes.ts` shows exactly which.
- `decode-named-character-reference` supplies the HTML entity table (two names it has, `nGt` and `nLt`, are excluded because Go's table lacks them).
- Input is a JavaScript string. Lone surrogates become U+FFFD; `decodeUtf8Lossy` decodes bytes the way the Go CLI does.
