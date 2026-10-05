import {
  collapseUnicodeSpace,
  firstCodePoint,
  isSpace,
  lastCodePoint,
  trimRight,
  trimSpace,
  unescapeText,
} from './gotext.js'
import { type Align, type Node, nextSibling, prevSibling } from './tree.js'
import { displayWidth } from './width.js'
import { must } from './must.js'

const escape = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** A zero-width space placed before a literal markup character stops Slack from treating it as an emphasis delimiter. */
const ZERO_WIDTH_SPACE = '\u200b'

/** Percent-encodes the characters that would break out of a Slack <url|label> link, then entity-escapes. */
function slackURL(u: string): string {
  let out = ''
  for (const ch of u) {
    const r = must(ch.codePointAt(0))
    if (
      ch === '|' ||
      ch === ' ' ||
      ch === '<' ||
      ch === '>' ||
      r < 0x20 ||
      r === 0x7f ||
      r === 0x85 ||
      r === 0x2028 ||
      r === 0x2029
    ) {
      for (const b of new TextEncoder().encode(ch))
        out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
    } else {
      out += ch
    }
  }
  return escape(out)
}

/** The URL schemes Slack turns into clickable links. */
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp'])

/**
 * Resolves a Markdown destination to text Slack can link. ok is false for
 * empty, relative or non-linkable destinations (javascript:, data:, #anchors,
 * paths), which callers render as plain text instead.
 */
function linkTarget(rawDest: string): { target: string; ok: boolean } {
  const dest = trimSpace(unescapeText(rawDest, false))
  const i = dest.search(/[:/?#]/)
  if (
    i > 0 &&
    dest.charAt(i) === ':' &&
    LINK_SCHEMES.has(dest.slice(0, i).toLowerCase()) &&
    dest.length > i + 1
  )
    return { target: dest, ok: true }
  return { target: dest, ok: false }
}

/** Renders <url|label>, or label (url) when Slack cannot represent the link. */
function slackLink(rawDest: string, rawLabel: string): string {
  const label = collapseSpace(rawLabel)
  const { target, ok } = linkTarget(rawDest)
  if (target === '') return label
  if (!ok) return label === '' ? escape(target) : `${label} (${escape(target)})`
  if (label === '' || label === escape(target)) return `<${slackURL(target)}>`
  if (label.includes('|')) return `${label} (<${slackURL(target)}>)`
  return `<${slackURL(target)}|${label}>`
}

/** Keeps ``` inside code content from closing the Slack code block. */
const fenceSafe = (s: string): string =>
  s.replaceAll('```', '``' + ZERO_WIDTH_SPACE + '`')

/**
 * A near-invisible space Slack accepts as a word boundary. Slack only formats
 * *bold*, _italic_ and ~strike~ that start and end at whitespace or
 * punctuation, so a span that touches a letter would print its markers
 * literally; a zero-width space or word joiner does not help, but U+200A does.
 */
const HAIR_SPACE = '\u200a'

/**
 * Slack opens a span only after whitespace or one of OPEN_OK and closes it only
 * before whitespace or one of CLOSE_OK (measured through chat.postMessage by
 * probing every ASCII punctuation mark, typographic quotes, CJK punctuation and
 * letters). Everything else, including letters, digits, CJK text, fullwidth
 * punctuation, ) ] } ' \ | @ and &, is not a boundary. A code span also opens
 * after a backslash or another marker.
 */
const OPEN_OK = new Set(
  Array.from('([{".,;:!?-/#$%^+=—…“”‘’', (c) => must(c.codePointAt(0)))
)
const CLOSE_OK = new Set(
  Array.from(')[]{}".,;:!?-/#$%^+=—…“”‘’', (c) => must(c.codePointAt(0)))
)
const CODE_OPEN_EXTRA = new Set(
  Array.from('\\_*~', (c) => must(c.codePointAt(0)))
)

/** Folds runs of ASCII whitespace to one space; Unicode spaces (the hair space) are left alone. */
const collapseSpace = (s: string): string =>
  s
    .split(/[ \t\n\r]+/)
    .filter((f) => f !== '')
    .join(' ')

const opensAfter = (r: number, code: boolean): boolean =>
  isSpace(r) || OPEN_OK.has(r) || (code && CODE_OPEN_EXTRA.has(r))
const closesBefore = (r: number): boolean => isSpace(r) || CLOSE_OK.has(r)

/** The first or last rune a sibling text node contributes, or null when the sibling is not plain text or ends in a line break. */
function edgeRune(n: Node, last: boolean): number | null {
  let v: string
  if (n.k === 'Text') {
    if (last && (n.soft === true || n.hard === true)) return null
    v = n.v ?? ''
  } else if (n.k === 'String') {
    v = n.v ?? ''
  } else {
    return null
  }
  if (v === '') return null
  return last ? lastCodePoint(v) : firstCodePoint(v)
}

/** Closing punctuation moved out of an italic that ends its parent span. */
const CLOSING_PUNCT = '.,;:!?…"\'”’)]'

/** Strips trailing closing punctuation from body without cutting through an entity the converter wrote. */
function trimClosingPunct(body: string): string {
  const trimmed = trimRight(body, CLOSING_PUNCT)
  if (body.slice(trimmed.length).startsWith(';')) {
    for (const e of ['&amp', '&lt', '&gt'])
      if (trimmed.endsWith(e)) return trimmed + ';'
  }
  return trimmed
}

const isSpanParent = (n: Node): boolean =>
  n.parent?.k === 'Emphasis' || n.parent?.k === 'Strikethrough'
const isSpan = (n: Node): boolean =>
  n.k === 'Emphasis' || n.k === 'Strikethrough' || n.k === 'CodeSpan'

/**
 * Whether a span next to sibling would fail to format in Slack: the sibling is
 * a word character, or another span that ends in a marker.
 */
function needsGap(sibling: Node, last: boolean, code: boolean): boolean {
  if (isSpan(sibling)) return true
  const r = edgeRune(sibling, last)
  if (r === null) return false // not plain text (a link, a line break): Slack treats it as a boundary
  return last ? !opensAfter(r, code) : !code && !closesBefore(r)
}

/** The hair spaces needed outside a marked-up span. */
function spanGap(n: Node): { before: string; after: string } {
  const code = n.k === 'CodeSpan'
  let before = ''
  let after = ''
  const prev = prevSibling(n)
  if (prev && needsGap(prev, true, code) && !isSpan(prev)) before = HAIR_SPACE // a preceding span already adds its own gap after itself
  const next = nextSibling(n)
  if (next && (isSpan(next) || needsGap(next, false, code))) after = HAIR_SPACE
  return { before, after }
}

/** Renders a span whose style is already active around it: no markers, but a following span still needs the gap this one would have provided. */
function flattened(n: Node, c: InlineCtx): string {
  let out = childrenInline(n, c)
  const next = nextSibling(n)
  if (next && isSpan(next)) out += HAIR_SPACE
  return out
}

/**
 * Surrounds inner with mark, adjusting for what Slack will not format: nothing
 * at all when inner is blank, and never a span that opens or closes on
 * whitespace or crosses a line break, so edge whitespace moves outside the
 * markers and each line gets its own pair.
 */
function wrapMarks(
  mark: string,
  inner: string,
  before: string,
  after: string
): string {
  const core = trimSpace(inner)
  if (core === '') return inner
  const lead = inner.slice(0, inner.indexOf(core))
  const trail = inner.slice(lead.length + core.length)
  const lines = core.split('\n')
  lines.forEach((raw, i) => {
    const line = trimSpace(raw)
    if (line !== '') lines[i] = mark + line + mark
  })
  return lead + before + lines.join('\n') + after + trail
}

/** Tracks enclosing markup while rendering inline nodes. */
interface InlineCtx {
  bold?: boolean // inside a heading or bold span, already bold
  italic?: boolean // inside an italic span
  strike?: boolean // inside a strikethrough span
  link?: boolean // inside a link label, where nested links cannot exist
  plain?: boolean // drop emphasis, strikethrough and code markup
}

function childrenInline(node: Node, c: InlineCtx): string {
  let out = ''
  for (const child of node.c) out += renderInline(child, c)
  return out
}

function renderInline(node: Node, c: InlineCtx): string {
  switch (node.k) {
    case 'Text': {
      const s = escape(unescapeText(node.v ?? '', true))
      if (node.hard) return s + '\n'
      if (node.soft) return s + ' '
      return s
    }
    case 'String':
      return escape(node.v ?? '')
    case 'Emphasis': {
      if (c.plain) return childrenInline(node, c)
      let mark = '_'
      const inner: InlineCtx = { ...c }
      if ((node.level ?? 0) >= 2) {
        mark = '*'
        inner.bold = true
      } else {
        inner.italic = true
      }
      if (
        (mark === '*' && c.bold === true) ||
        (mark === '_' && c.italic === true)
      )
        return flattened(node, c) // Slack cannot nest a style inside itself
      const { before, after } = spanGap(node)
      const body = childrenInline(node, inner)
      if (mark === '_' && nextSibling(node) === null && isSpanParent(node)) {
        // Slack mis-pairs a later _ when an italic ends in punctuation right
        // before the enclosing span closes (*_Note._*), so leave it outside.
        const trimmed = trimClosingPunct(body)
        if (trimmed !== '' && trimmed !== body)
          return (
            wrapMarks(mark, trimmed, before, '') +
            body.slice(trimmed.length) +
            after
          )
      }
      return wrapMarks(mark, body, before, after)
    }
    case 'Strikethrough': {
      if (c.plain) return childrenInline(node, c)
      if (c.strike) return flattened(node, c)
      const inner = { ...c, strike: true }
      const { before, after } = spanGap(node)
      return wrapMarks('~', childrenInline(node, inner), before, after)
    }
    case 'CodeSpan': {
      let raw = ''
      for (const child of node.c)
        if (child.k === 'Text') raw += escape(child.v ?? '')
      // A line ending inside a code span is a space, and Slack only formats code that stays on one line.
      const code = raw
        .replaceAll('\r\n', ' ')
        .replaceAll('\n', ' ')
        .replaceAll('\r', ' ')
      if (c.plain) return code
      if (trimSpace(code) === '') return code // Slack shows an empty code span as bare backticks
      const { before, after } = spanGap(node)
      return before + '`' + code.replaceAll('`', 'ˋ') + '`' + after
    }
    case 'Link':
      return slackLink(
        node.dest ?? '',
        childrenInline(node, { ...c, link: true })
      )
    case 'AutoLink': {
      const url = node.v ?? ''
      if (node.email) return slackLink('mailto:' + url, escape(url))
      return slackLink(url, '')
    }
    case 'Image': {
      const label0 = trimSpace(childrenInline(node, c))
      const { target, ok } = linkTarget(node.dest ?? '')
      if (!ok && target === '') return label0
      const label = label0 === '' ? 'image' : label0
      if (c.link) return label // a link label cannot hold another link
      return slackLink(node.dest ?? '', label)
    }
    case 'TaskCheckBox':
      return node.checked ? '☑ ' : '☐ '
    case 'RawHTML':
      return (node.v ?? '').toLowerCase().startsWith('<br') ? '\n' : ''
    default:
      return childrenInline(node, c)
  }
}

function renderChildren(node: Node, depth: number, maxTable: number): string {
  const blocks: string[] = []
  for (const child of node.c) {
    const block = trimSpace(renderBlock(child, depth, maxTable))
    if (block !== '') blocks.push(block)
  }
  return blocks.join('\n\n')
}

function codeLines(node: Node): string {
  return fenceSafe(escape(trimRight((node.lines ?? []).join(''), '\n')))
}

const isParagraph = (n: Node): boolean => n.k === 'Paragraph'

function renderList(n: Node, depth: number, maxTable: number): string {
  const { level, indent } = listPlacement(n)
  const lines: string[] = []
  let ordinal = n.start ?? 0
  for (const item of n.c) {
    let body = ''
    for (const child of item.c) {
      let part: string
      switch (child.k) {
        case 'List':
          part = '\n' + renderBlock(child, depth + 1, maxTable)
          break
        case 'FencedCodeBlock':
        case 'CodeBlock':
        case 'Table':
        case 'Blockquote':
          // A fence or quote marker only renders when it starts its own line.
          part = '\n' + renderBlock(child, depth + 1, maxTable)
          break
        default:
          part = trimSpace(renderBlock(child, depth + 1, maxTable))
      }
      if (trimSpace(part) === '') continue
      if (part.startsWith('\n')) {
        // starts its own line
      } else if (body.length === 0) {
        // first part
      } else if (body.endsWith('```')) {
        body += '\n'
      } else if (isParagraph(child)) {
        body += '\n' // keep a second paragraph in an item on its own line
      } else {
        body += ' '
      }
      body += part
    }
    let marker = bulletFor(level)
    if (n.ordered) {
      marker = `${ordinal}.`
      ordinal++
    }
    lines.push(' '.repeat(indent) + marker + ' ' + body)
  }
  return lines.join('\n')
}

/**
 * Picks the bullet for a list nested level lists deep. Slack has no list
 * syntax in message text, so these are plain characters; "▪" renders as a
 * black box in Slack, hence the en dash for the third level and deeper.
 */
function bulletFor(level: number): string {
  if (level === 0) return '•'
  if (level === 1) return '◦'
  return '–'
}

/**
 * How many lists enclose n and how many spaces its lines are indented: each
 * enclosing ordered list adds its marker width so nested items sit under the
 * parent's text, and each enclosing bullet list adds four.
 */
function listPlacement(n: Node): { level: number; indent: number } {
  let level = 0
  let indent = 0
  for (let p = n.parent; p; p = p.parent) {
    if (p.k !== 'List') continue
    level++
    if (p.ordered) {
      const last = (p.start ?? 0) + (p.count ?? p.c.length) - 1
      indent += String(last).length + 2 // "N." and the space
    } else {
      indent += 4
    }
  }
  return { level, indent }
}

/** Flattens inline nodes to unformatted text. Slack does not render mrkdwn inside code blocks. */
type LinkNoter = (n: Node, dest: string) => string

function plainTextWith(node: Node, note: LinkNoter | null): string {
  let out = ''
  for (const child of node.c) {
    switch (child.k) {
      case 'Text':
        out += unescapeText(child.v ?? '', false)
        if (child.hard === true || child.soft === true) out += ' '
        break
      case 'String':
        out += child.v ?? ''
        break
      case 'CodeSpan':
        for (const cc of child.c) if (cc.k === 'Text') out += cc.v ?? ''
        break
      case 'Link': {
        const label = trimSpace(plainTextWith(child, null))
        const url = trimSpace(unescapeText(child.dest ?? '', false))
        const marker = note ? note(child, url) : ''
        if (marker !== '' && (label === '' || label === url)) out += marker
        else if (marker !== '') out += label + ' ' + marker
        else if (label === '' || label === url) out += url
        else out += label + ' (' + url + ')'
        break
      }
      case 'AutoLink': {
        const url = child.v ?? ''
        if (note) {
          const dest = child.email ? 'mailto:' + url : url
          const marker = note(child, dest)
          if (marker !== '') {
            out += url + ' ' + marker
            break
          }
        }
        out += url
        break
      }
      case 'Image':
        out += trimSpace(plainTextWith(child, null))
        break
      case 'TaskCheckBox':
        out += child.checked ? '[x] ' : '[ ] '
        break
      case 'RawHTML':
        if ((child.v ?? '').toLowerCase().startsWith('<br')) out += ' '
        break
      default:
        out += plainTextWith(child, note)
    }
  }
  return collapseUnicodeSpace(out)
}

function pad(s: string, width: number, align: Align): string {
  const gap = width - displayWidth(s)
  if (align === 'right') return ' '.repeat(gap) + s
  if (align === 'center') {
    const left = Math.floor(gap / 2)
    return ' '.repeat(left) + s + ' '.repeat(gap - left)
  }
  return s + ' '.repeat(gap)
}

interface TableNote {
  label: string
  dest: string
  row: number
  col: number
}

/**
 * Draws a column-aligned monospace grid inside a code block, the only place
 * Slack preserves alignment. Only ASCII box characters are used: Slack draws
 * Unicode box-drawing glyphs from a fallback font whose lines do not meet.
 */
function renderTable(n: Node, maxTable: number): string {
  // A grid sits in a code block, where Slack cannot link anything, so each
  // linkable link becomes a numbered marker and gets a clickable footnote under the block.
  const notes: TableNote[] = []
  let row0 = 0
  let col0 = 0
  const noter: LinkNoter = (link, dest) => {
    const { target, ok } = linkTarget(dest)
    if (!ok) return ''
    const note: TableNote = { dest: target, row: row0, col: col0, label: '' }
    if (link.k === 'Link')
      note.label = collapseSpace(childrenInline(link, { link: true }))
    else if (link.k === 'AutoLink') note.label = escape(link.v ?? '')
    notes.push(note)
    return `[${notes.length}]`
  }
  const grid: string[][] = []
  for (const row of n.c) {
    const cells: string[] = []
    col0 = 0
    for (const cell of row.c) {
      cells.push(plainTextWith(cell, noter))
      col0++
    }
    grid.push(cells)
    row0++
  }
  const aligns = n.aligns ?? []
  let cols = aligns.length
  for (const cells of grid) cols = Math.max(cols, cells.length)
  const widths: number[] = Array.from({ length: cols }, () => 0)
  for (const cells of grid) {
    for (let i = 0; i < cells.length; i++)
      widths[i] = Math.max(widths[i], displayWidth(cells[i]))
  }
  if (maxTable > 0 && gridWidth(widths) > maxTable && grid.length > 1)
    return renderTableRecords(n)
  const alignOf = (i: number): Align => aligns[i] ?? 'none'
  const line = (cells: string[], header: boolean): string => {
    const parts: string[] = []
    for (let i = 0; i < cols; i++) {
      let a = alignOf(i)
      if (header && a === 'none') a = 'left'
      parts.push(pad(cells[i] ?? '', widths[i], a))
    }
    let last = cells.length - 1 // trailing empty cells add no visible text
    while (last >= 0 && cells[last] === '') last--
    if (last < 0) return ''
    return trimRight(parts.slice(0, last + 1).join(' | '), ' ')
  }
  const rule = widths.map((w) => '-'.repeat(w))
  const out: string[] = []
  grid.forEach((cells, i) => {
    out.push(escape(line(cells, i === 0)))
    if (i === 0) out.push(rule.join('-+-'))
  })
  return (
    '```\n' + fenceSafe(out.join('\n')) + '\n```' + tableFootnotes(notes, grid)
  )
}

/**
 * Lists each numbered table link as a clickable line. When two links share a
 * label, a link outside the first column is prefixed with its row's first
 * cell so the footnotes stay distinguishable.
 */
function tableFootnotes(notes: TableNote[], grid: string[][]): string {
  if (notes.length === 0) return ''
  const count = new Map<string, number>()
  for (const note of notes)
    count.set(note.label, (count.get(note.label) ?? 0) + 1)
  let out = ''
  notes.forEach((note, i) => {
    let label = note.label
    const first = grid[note.row]?.[0]
    if (
      (count.get(label) ?? 0) > 1 &&
      note.col > 0 &&
      note.row < grid.length &&
      grid[note.row].length > 0 &&
      first !== ''
    ) {
      label = escape(must(first)) + ' ' + label
    }
    out += `\n[${i + 1}] ${slackLink(note.dest, label)}`
  })
  return out
}

/** The display width of a table grid with the given column widths. */
function gridWidth(widths: number[]): number {
  let total = 3 * Math.max(widths.length - 1, 0) // " | " between columns
  for (const w of widths) total += w
  return total
}

/**
 * Renders a table too wide for a code block as one record per body row: the
 * first cell in bold, then "Header: value" pairs. Unlike the grid it stays
 * mrkdwn, so links and emphasis in cells keep working.
 */
function renderTableRecords(n: Node): string {
  const inline = (node: Node, c: InlineCtx): string =>
    collapseSpace(childrenInline(node, c))
  const headers: string[] = []
  const records: string[] = []
  for (const row of n.c) {
    if (row.k === 'TableHeader') {
      for (const cell of row.c)
        headers.push(inline(cell, { plain: true, link: true }))
      continue
    }
    let title = ''
    const pairs: string[] = []
    row.c.forEach((cell, i) => {
      if (i === 0) {
        const t = inline(cell, { bold: true })
        if (t !== '') title = '*' + t + '*'
        return
      }
      let value = inline(cell, {})
      if (value === '') return
      if (i < headers.length && headers[i] !== '')
        value = headers[i] + ': ' + value
      pairs.push(value)
    })
    let record = pairs.join(' · ')
    if (title !== '' && record !== '') record = title + '\n' + record
    else if (title !== '') record = title
    if (record !== '') records.push(record)
  }
  return records.join('\n\n')
}

/** Prefixes body as one Slack quote. Slack drops the "> " only on the first line and keeps the space on later ones, so those use a bare ">". */
function quoteBlock(body: string): string {
  return body
    .split('\n')
    .map((l, i) => trimRight((i === 0 ? '> ' : '>') + l, ' '))
    .join('\n')
}

/**
 * Renders a Markdown blockquote. A Slack quote cannot hold a code block (the
 * ">" characters would leak into it), so fences and tables end the quote,
 * stand on their own, and a new quote continues after them.
 */
function renderQuote(n: Node, depth: number, maxTable: number): string {
  const parts: string[] = []
  let pending: string[] = []
  const flush = (): void => {
    if (pending.length > 0) {
      parts.push(quoteBlock(pending.join('\n\n')))
      pending = []
    }
  }
  for (const child of n.c) {
    const block = trimSpace(renderBlock(child, depth, maxTable))
    if (block === '') continue
    if (
      child.k === 'FencedCodeBlock' ||
      child.k === 'CodeBlock' ||
      child.k === 'Table'
    ) {
      flush()
      parts.push(block)
    } else {
      pending.push(block)
    }
  }
  flush()
  return parts.join('\n')
}

function renderBlock(node: Node, depth: number, maxTable: number): string {
  switch (node.k) {
    case 'Paragraph':
    case 'TextBlock':
      return childrenInline(node, {})
    case 'Heading': {
      const title = collapseSpace(childrenInline(node, { bold: true }))
      return title === '' ? '' : '*' + title + '*'
    }
    case 'List':
      return renderList(node, depth, maxTable)
    case 'Blockquote':
      return renderQuote(node, depth, maxTable)
    case 'FencedCodeBlock':
    case 'CodeBlock':
      return '```\n' + codeLines(node) + '\n```'
    case 'ThematicBreak':
      return '---'
    case 'Table':
      return renderTable(node, maxTable)
    case 'HTMLBlock':
      return ''
    default:
      return renderChildren(node, depth, maxTable)
  }
}

/** Renders a parsed document tree as Slack mrkdwn. */
export function renderDocument(root: Node, maxTableWidth: number): string {
  return trimSpace(renderChildren(root, 0, maxTableWidth)) + '\n'
}
