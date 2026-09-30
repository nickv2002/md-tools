// Seeded Markdown generators for differential fuzzing: a grammar (well-formed
// documents with messy details), a character soup of Markdown-significant
// characters, and mutation of existing inputs.

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(r: Rng, xs: readonly T[]): T =>
  xs[Math.floor(r() * xs.length)]!
const chance = (r: Rng, p: number): boolean => r() < p
const int = (r: Rng, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1))

const WORDS = [
  'a',
  'b',
  'foo',
  'bar',
  'baz',
  'x',
  'note',
  'Note.',
  'hello',
  'world',
  'e',
  "it's",
  "don't",
  '(paren)',
  '[br]',
  '{cu}',
  '"q"',
  '“q”',
  '‘s’',
  'a.b',
  'a,b',
  'a-b',
  'a/b',
  '#tag',
  '$5',
  '50%',
  '^up',
  '+1',
  '=eq',
  '—',
  '…',
  '重点',
  '这是',
  'テスト',
  '한국어',
  'café',
  'é',
  'e\u0301',
  '👍',
  '👍🏽',
  '👨\u200d👩\u200d👧',
  '🇺🇸',
  '❤️',
  '❌',
  '©',
  '·',
  '«a»',
  '（注）',
  '，',
  '。',
  '|',
  '\u00a0',
  '\u200a',
  '\u200b',
  '\u2060',
  'https://x.io',
  'https://x.io/a_b',
  'www.x.io',
  'a@b.co',
  '<!channel>',
  '<@U1>',
  '&amp;',
  '&lt;',
  '&copy',
  '&copy;',
  '&#35;',
  '&#x26;',
  '&#0;',
  '&#128;',
  '&notit;',
  '&bogus;',
  '&',
  '\\*',
  '\\_',
  '\\`',
  '\\~',
  '\\\\',
  '\\[',
  '\\<',
  '\\&',
  '\\|',
  '\\q',
  '<br>',
  '<b>',
  '</b>',
  '<!-- c -->',
  '<?pi?>',
  '<![CDATA[x]]>',
  '<a href="u">',
  '*',
  '_',
  '~',
  '`',
  '**',
  '__',
  '~~',
  '***',
]

function words(r: Rng, n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(pick(r, WORDS))
  return out.join(chance(r, 0.9) ? ' ' : '')
}

const URLS = [
  'https://x.io',
  'https://x.io/a b',
  '/rel/a.md',
  '#anc',
  'mailto:a@b.co',
  'tel:+1555',
  'javascript:alert(1)',
  'data:x/y;base64,AAA',
  'https://x.io/?a=1&amp;b=2',
  'https://x.io/a\\_b',
  'HTTPS://X.IO',
  'ftp://f.io/a',
  'https://x.io/a(b)c',
  'https://x.io/a|b',
  '',
  'https:',
]

function inline(r: Rng, depth: number): string {
  const p = r()
  if (depth > 3 || p < 0.35) return words(r, int(r, 1, 3))
  const inner = () => inline(r, depth + 1)
  const gap = () => (chance(r, 0.25) ? '' : ' ')
  if (p < 0.43) return `*${inner()}*`
  if (p < 0.5) return `**${inner()}**`
  if (p < 0.55) return `_${inner()}_`
  if (p < 0.6) return `__${inner()}__`
  if (p < 0.63) return `***${inner()}***`
  if (p < 0.67) return `~${inner()}~`
  if (p < 0.71) return `~~${inner()}~~`
  if (p < 0.76)
    return (
      '`' +
      pick(r, [
        'x',
        'a b',
        'a`b',
        ' x ',
        '*a*',
        '<b>',
        'C:\\dir',
        '&amp;',
        '',
      ]) +
      '`'
    )
  if (p < 0.81)
    return `[${inner()}](${pick(r, URLS)}${chance(r, 0.15) ? ' "t"' : ''})`
  if (p < 0.83) return `[${inner()}](<${pick(r, URLS)}>)`
  if (p < 0.85) return `![${inner()}](${pick(r, URLS)})`
  if (p < 0.87) return `[${inner()}][r${int(r, 1, 2)}]`
  if (p < 0.88)
    return `<${pick(r, ['https://x.io/a', 'a@b.co', 'irc://x.io', 'mailto:a@b.co', 'x'])}>`
  if (p < 0.9) return pick(r, ['\n', '  \n', '\\\n', ' \n', '\t\n']) + inner()
  if (p < 0.94) return inner() + gap() + inner()
  return inner() + inner()
}

function paragraph(r: Rng): string {
  const lines: string[] = []
  for (let i = int(r, 1, 3); i > 0; i--)
    lines.push(inline(r, 0) + pick(r, ['', '', '', ' ', '  ', '\\']))
  return lines.join('\n')
}

function table(r: Rng): string {
  const cols = int(r, 1, 4)
  const cell = () =>
    pick(r, [
      'a',
      '**b**',
      '`c`',
      '[l](https://x.io)',
      '日本',
      '👨\u200d👩\u200d👧',
      'é',
      '',
      'x\\|y',
      '<https://x.io/a>',
      'www.x.io',
      '![i](https://x.io/a.png)',
      'a<br>b',
      inline(r, 2),
    ])
  const row = (n: number) =>
    '| ' + Array.from({ length: n }, cell).join(' | ') + ' |'
  const delim = () => pick(r, ['---', ':--', '--:', ':-:', '-', ':-:'])
  const lines = [
    row(cols),
    '|' +
      Array.from({ length: chance(r, 0.9) ? cols : cols + 1 }, delim).join(
        '|'
      ) +
      '|',
  ]
  for (let i = int(r, 0, 3); i > 0; i--)
    lines.push(row(chance(r, 0.85) ? cols : int(r, 1, 5)))
  return lines.join('\n')
}

function list(r: Rng, depth: number, indent = ''): string {
  const ordered = chance(r, 0.4)
  const loose = chance(r, 0.25)
  const items: string[] = []
  const n = int(r, 1, 3)
  for (let i = 0; i < n; i++) {
    const marker = ordered ? `${int(r, 0, 12)}. ` : pick(r, ['- ', '* ', '+ '])
    const pad = ' '.repeat(marker.length)
    let body =
      (chance(r, 0.15) ? pick(r, ['[ ] ', '[x] ', '[X] ']) : '') + inline(r, 1)
    if (chance(r, 0.25)) body += '\n' + pad + inline(r, 2)
    if (depth < 2 && chance(r, 0.3)) body += '\n' + list(r, depth + 1, pad)
    if (chance(r, 0.12))
      body +=
        '\n\n' +
        pad +
        pick(r, [
          '> q',
          '```\nx\n```',
          table(r)
            .split('\n')
            .join('\n' + pad),
          inline(r, 2),
        ])
    items.push(
      indent +
        marker +
        body.split('\n').join('\n' + (body.includes('\n') ? '' : ''))
    )
  }
  return items.join(loose ? '\n\n' : '\n')
}

function block(r: Rng, depth: number): string {
  const p = r()
  if (p < 0.3) return paragraph(r)
  if (p < 0.38)
    return `${'#'.repeat(int(r, 1, 6))} ${inline(r, 1)}${chance(r, 0.2) ? ' ##' : ''}`
  if (p < 0.42) return `${inline(r, 1)}\n${pick(r, ['===', '---', '-'])}`
  if (p < 0.52) return list(r, 0)
  if (p < 0.6)
    return (
      paragraph(r)
        .split('\n')
        .map((l) => '> ' + l)
        .join('\n') +
      (depth < 2 && chance(r, 0.3)
        ? '\n>\n> ' + list(r, 1).split('\n').join('\n> ')
        : '')
    )
  if (p < 0.66)
    return (
      pick(r, ['```', '~~~', '````']) +
      pick(r, ['', 'js', 'md']) +
      '\n' +
      pick(r, [
        'x',
        'a\n\nb',
        '```js\ny\n```',
        '*not* **md**',
        '<b>',
        '& < >',
        '',
      ]) +
      '\n' +
      pick(r, ['```', '~~~', '````', ''])
    )
  if (p < 0.7) return '    ' + pick(r, ['code', 'a\n\n    b', '\tt', '  x'])
  if (p < 0.8) return table(r)
  if (p < 0.83) return pick(r, ['---', '***', '___', '- - -'])
  if (p < 0.88)
    return pick(r, [
      '<div>x</div>',
      '<!-- c -->',
      '<!channel>',
      '<p>\n*x*\n</p>',
      '<br>',
      '<script>\nx\n</script>',
      '<?php ?>',
      '<![CDATA[\nx\n]]>',
      '<!DOCTYPE html>',
    ])
  if (p < 0.92)
    return pick(r, [
      '[r1]: https://x.io',
      '[r2]: <https://y.io> "t"',
      '[R1]: /rel',
      '[r1]:',
    ])
  return paragraph(r)
}

export function grammarDoc(r: Rng): string {
  const parts: string[] = []
  if (chance(r, 0.05))
    parts.push(
      pick(r, ['---\ntitle: x\n---', '+++\na = 1\n+++', '---\nx\n...'])
    )
  for (let i = int(r, 1, 4); i > 0; i--) parts.push(block(r, 0))
  let doc = parts.join(pick(r, ['\n\n', '\n\n', '\n\n', '\n', '\n\n\n']))
  if (chance(r, 0.1)) doc = doc.replaceAll('\n', '\r\n')
  if (chance(r, 0.05)) doc += '\n'
  return doc
}

const SOUP = [
  '*',
  '*',
  '**',
  '_',
  '__',
  '~',
  '~~',
  '`',
  '``',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '!',
  '#',
  '-',
  '+',
  '1.',
  '|',
  '&',
  '\\',
  ' ',
  ' ',
  ' ',
  '\n',
  '\n',
  '\n\n',
  '\t',
  '  \n',
  'a',
  'b',
  'x',
  '"x"',
  'http://x.io',
  'www.x.io',
  'a@b.co',
  '&amp;',
  '=',
  ':',
  '.',
  ',',
  '日',
  '😀',
  '\u200a',
  '\u00a0',
  '    ',
  '> ',
  '```',
  '---',
  '| ',
  ' |',
  ':-:',
  '[ ]',
  '[x]',
  '[r]: u',
  '<b>',
  '</b>',
  '<!--',
  '-->',
]

export function soupDoc(r: Rng): string {
  const n = int(r, 1, 40)
  let s = ''
  for (let i = 0; i < n; i++) s += pick(r, SOUP)
  return s
}

const INSERTS = [
  '*',
  '_',
  '~',
  '`',
  '\\',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '|',
  '\n',
  ' ',
  '  ',
  '\t',
  '&',
  '!',
  '#',
  '-',
  ':',
  'é',
  '日',
  '\u200a',
  '\u200b',
  '\u00a0',
  '\r',
  '\0',
]

export function mutate(r: Rng, s: string): string {
  const chars = Array.from(s)
  for (let k = int(r, 1, 3); k > 0; k--) {
    const at = int(r, 0, chars.length)
    const op = r()
    if (op < 0.5) chars.splice(at, 0, pick(r, INSERTS))
    else if (op < 0.8) chars.splice(at, int(r, 1, 2))
    else
      chars.splice(
        at,
        0,
        ...chars
          .slice(int(r, 0, chars.length), int(r, 0, chars.length))
          .slice(0, 6)
      )
  }
  return chars.join('')
}

// Constructs that reach the less common paths of goldmark's parsers; combined at random by snippetDoc.
const SNIPPETS = [
  '[foo]: /u',
  '[foo]: /u "t"',
  "[foo]: </u> 'multi\nline'",
  '[foo\nbar]: /u',
  '[foo]: /u\n"title"',
  '[f]: <>',
  '[f]:\n/u',
  '[f]: /u "t" x',
  '[F]: /other',
  '[foo]',
  '[foo][]',
  '[foo][bar]',
  '![foo]',
  '![foo][foo]',
  '[foo] [bar]',
  '[[foo]]',
  '[a [b](c) d](e)',
  '===',
  '---',
  '--',
  '-',
  '* * *',
  '***',
  '___',
  '- - -',
  '- a\n---',
  '1. a\n   ---',
  '- a\n  ---\n- b',
  '> a\n===',
  'a\n===\nb',
  '<pre>\nx\n</pre>',
  '<pre>x</pre> y',
  '<script>a</script>',
  '<style>\n</style>',
  '<textarea>\n',
  '</pre>',
  '<!-- c\n-->',
  '<!-->',
  '<!--->',
  '<?pi\n?>',
  '<![CDATA[\nx]]>',
  '<!DOCTYPE\nhtml>',
  '<!x>',
  '<div>',
  '</div>',
  '<div\nclass="a">',
  '<a href="u"\n>',
  '<a b c="d e" f=\'g\'>',
  '</a >',
  '</a\n>',
  '<a\n',
  '<1>',
  '<a/>',
  '<a b=>',
  '<hr />',
  '| a | b |\n|---|---|\n| `x\\|y` | 1 |',
  '| a |\n|---|\n| `\\|` `a\\|b` |',
  '| a | b |\n| - | - |',
  '| a |\n|:-|\n| **b** | c |',
  '|a|b|\n|-|-|\n',
  '| a | b |\n|---|---|\n| 1 | 2 | 3 |',
  '| a | b |\n|---|---|\n| 1 |',
  'a | b\n--|--\nc | d',
  '|---|',
  '| a |\n|---|\n\nx',
  '- [ ] a',
  '- [x] b\n- [X] c',
  '- [ ]',
  '* [ ]x',
  '1. [ ] a',
  '- a\n  - [ ] b',
  '[ ] a',
  '- [y] a',
  'http://x.io',
  'https://x.io/a(b)c',
  'https://x.io/a)',
  'https://x.io/a.',
  'https://x.io/a&amp;',
  'www.x.io/a',
  'www.x',
  'ftp://f.io',
  'a@b.co',
  'a.b@c.d-e.co.',
  'a@b',
  '<http://x.io>',
  '<a@b.co>',
  '<x:y>',
  '<http://x y>',
  '(http://x.io)',
  '*http://x.io*',
  '_www.x.io_',
  '~a@b.co~',
  '\tcode',
  '    code',
  '    a\n\n    b',
  '\ta\n\t\tb',
  '>\tq',
  '-\ta',
  '1.\ta',
  '```\n\tx\n```',
  '  ```\n  x\n ```',
  '```js x\ncode',
  '~~~\na\n```\n~~~',
  '````\n```\n````',
  '``` a`b\n',
  '> a\n> b',
  '> a\nb',
  '>\n> a',
  '> > a',
  '> - a\n> - b',
  '> ```\n> x\n> ```',
  '- a\n\n  b',
  '- a\n - b',
  '- a\n  - b\n    - c',
  '1. a\n2. b\n   1. c',
  '10. a\n    - b',
  '- a\n\n\n- b',
  '-\n  a',
  '- \n\n  a',
  '-\n-\n',
  '2. a',
  '1) a\n2) b',
  '- a\n+ b',
  '* a\n- b',
  '**a**',
  '*a*',
  '***a***',
  '**a*',
  '*a**',
  '_a_',
  '__a__',
  'a_b_c',
  'a*b*c',
  '**a **b** c**',
  '*a _b_ c*',
  '~a~',
  '~~a~~',
  '~~~a~~~',
  '~a~~',
  '`a`',
  '``a`b``',
  '` a `',
  '`  `',
  '`a\nb`',
  '\\*a\\*',
  '\\`',
  '&amp;',
  '&copy',
  '&#35;',
  '&#x26;',
  '&#0;',
  '&nbsp;',
  '&notit;',
  'a  \nb',
  'a\\\nb',
  'a \nb',
  'a\tb\t\nc',
  '\n',
  '\n\n',
  '   ',
  '\t',
  '\u00a0',
  'é',
  '日本',
  '👍',
  '# h',
  '## h ##',
  '# ',
  '#',
  '#h',
  '####### h',
  '\\# h',
  '  # h',
  '    # h',
  '# h #\n',
  '# a #b',
  'h\n=',
  'h\n-',
]

export function snippetDoc(r: Rng): string {
  const parts: string[] = []
  for (let i = int(r, 1, 6); i > 0; i--) parts.push(pick(r, SNIPPETS))
  return parts.join(
    pick(r, ['\n', '\n', '\n\n', ' ', '\n  ', '\n> ', '\n- ', '\n\t'])
  )
}

const INVALID_BYTES = [0x80, 0xbf, 0xc0, 0xc1, 0xe0, 0xed, 0xf0, 0xf5, 0xff]

/** Replaces or inserts a few raw bytes so the input is no longer valid UTF-8. */
function corrupt(r: Rng, s: string): Uint8Array {
  const bytes = Array.from(new TextEncoder().encode(s))
  for (let k = int(r, 1, 3); k > 0; k--) {
    const at = int(r, 0, bytes.length)
    if (chance(r, 0.5) && at < bytes.length) bytes[at] = pick(r, INVALID_BYTES)
    else
      bytes.splice(
        at,
        0,
        ...Array.from({ length: int(r, 1, 3) }, () => pick(r, INVALID_BYTES))
      )
  }
  return Uint8Array.from(bytes)
}

/** A deterministic mixed batch of inputs; pool entries are decoded text to mutate. */
export function generate(
  seed: number,
  n: number,
  pool: string[] = []
): Array<string | Uint8Array> {
  const r = mulberry32(seed)
  const out: Array<string | Uint8Array> = []
  for (let i = 0; i < n; i++) {
    const p = r()
    if (p < 0.03) out.push(corrupt(r, grammarDoc(r)))
    else if (p < 0.3) out.push(snippetDoc(r))
    else if (p < 0.5) out.push(grammarDoc(r))
    else if (p < 0.72) out.push(soupDoc(r))
    else if (pool.length > 0) out.push(mutate(r, pick(r, pool)))
    else out.push(mutate(r, grammarDoc(r)))
  }
  return out
}
