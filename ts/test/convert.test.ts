import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markdownToSlackMrkdwn } from '../src/index.js'

const h = ' '

test('headings, emphasis and links map to mrkdwn', () => {
  assert.equal(
    markdownToSlackMrkdwn(
      '# Title\n\n**bold** _it_ ~~gone~~ `code` [link](https://x.io)'
    ),
    '*Title*\n\n*bold* _it_ ~gone~ `code` <https://x.io|link>\n'
  )
})

test('a span touching a letter gets a hair space so Slack formats it', () => {
  assert.equal(markdownToSlackMrkdwn('foo**bar**baz'), `foo${h}*bar*${h}baz\n`)
})

test('angle brackets, ampersands and mentions are escaped so they stay inert', () => {
  assert.equal(
    markdownToSlackMrkdwn('<!channel> & <@U123>'),
    '&lt;!channel&gt; &amp; &lt;@U123&gt;\n'
  )
})

test('lists use bullets with four-space nesting and keep ordered numbers', () => {
  assert.equal(
    markdownToSlackMrkdwn('- a\n  - b\n1. c\n2. d'),
    '• a\n    ◦ b\n\n1. c\n2. d\n'
  )
})

test('tables become an aligned grid in a code fence, with footnotes for links', () => {
  assert.equal(
    markdownToSlackMrkdwn('| A | B |\n|---|---|\n| 1 | [x](https://x.io) |'),
    '```\nA | B\n--+------\n1 | x [1]\n```\n[1] <https://x.io|x>\n'
  )
})

test('a table wider than maxTableWidth becomes one record per row', () => {
  assert.equal(
    markdownToSlackMrkdwn('| A | B |\n|---|---|\n| r | v |', {
      maxTableWidth: 1,
    }),
    '*r*\nB: v\n'
  )
})

test('output always ends in exactly one newline and uses LF', () => {
  assert.equal(markdownToSlackMrkdwn(''), '\n')
  assert.equal(markdownToSlackMrkdwn('a\r\nb\r\n\r\n'), 'a b\n')
})

test('front matter and raw HTML are dropped', () => {
  assert.equal(
    markdownToSlackMrkdwn('---\ntitle: x\n---\n<div>x</div>\n\ntext'),
    'text\n'
  )
})

test('lone surrogates become the replacement character', () => {
  assert.equal(markdownToSlackMrkdwn('a\ud800b'), 'a�b\n')
})

// The goldmark examples that name these cases spell the byte as a Go escape in
// a text file, so the recorded snapshots only hold the escape text. These use
// the real control characters; outputs are recorded from the Go converter.
test('NUL bytes pass through as text and an HTML block swallows the rest of its line', () => {
  assert.equal(
    markdownToSlackMrkdwn('hello\x00world\n\n<?\x00\n'),
    'hello\x00world\n'
  )
  assert.equal(markdownToSlackMrkdwn('a\x00b *c*\n'), 'a\x00b _c_\n')
  assert.equal(markdownToSlackMrkdwn('\\\\\x00"\n'), '\\\x00"\n')
})

test('a form feed is not treated as a space', () => {
  assert.equal(markdownToSlackMrkdwn('x \x0cy\n'), 'x \x0cy\n')
  assert.equal(markdownToSlackMrkdwn('a\x0cb *c*\n'), 'a\x0cb _c_\n')
  assert.equal(markdownToSlackMrkdwn('x \x0c\n'), 'x\n')
})
