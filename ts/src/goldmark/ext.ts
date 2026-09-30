import {
  GNode,
  type Alignment,
  type DelimiterProcessor,
  mergeOrAppendTextSegment,
  newRawText,
  walk,
} from './ast.js'
import {
  type ASTTransformer,
  type InlineParser,
  type ParagraphTransformer,
  contextKey,
  scanDelimiter,
} from './parser.js'
import { Segment } from './segment.js'
import {
  findEmailIndex,
  indentWidth,
  isAlphaNumeric,
  isBlank,
  isPunct,
  isSpace,
  latin1,
} from './util.js'
import { must } from '../must.js'

// ---------- strikethrough ----------

const strikethroughProcessor: DelimiterProcessor = {
  isDelimiter: (b) => b === 0x7e,
  canOpenCloser: (opener, closer) => opener.char === closer.char,
  onMatch: () => new GNode('Strikethrough'),
}

export const strikethroughParser: InlineParser = {
  trigger: [0x7e],
  parse(_parent, block, pc) {
    const before = block.precedingCharacter()
    const [line, segment] = block.peekLine()
    const node = scanDelimiter(must(line), before, 1, strikethroughProcessor)
    if (node === null || node.originalLength > 2 || before === 0x7e) return null
    node.segment = segment.withStop(segment.start + node.originalLength)
    block.advance(node.originalLength)
    pc.pushDelimiter(node)
    return node
  },
}

// ---------- task list checkbox ----------

const isTaskSpace = (c: number): boolean =>
  c === 0x20 || (c >= 0x09 && c <= 0x0d && c !== 0x0b)

/** The length of a leading [ ], [x] or [X] and the white space after it, or 0 (goldmark's ^\[([\s xX])\]\s* regexp). */
function taskBoxLength(line: Uint8Array): number {
  if (line.length < 3 || line[0] !== 0x5b || line[2] !== 0x5d) return 0
  const c = line[1]
  if (!(isTaskSpace(c) || c === 0x78 || c === 0x58)) return 0
  let i = 3
  while (i < line.length && isTaskSpace(line[i])) i++
  return i
}

export const taskCheckBoxParser: InlineParser = {
  trigger: [0x5b],
  parse(parent, block) {
    if (parent.parent === null || parent.parent.firstChild !== parent)
      return null
    if (parent.hasChildren()) return null
    if (parent.parent.kind !== 'ListItem') return null
    const [line] = block.peekLine()
    const length = taskBoxLength(must(line))
    if (length === 0) return null
    const value = must(line)[1]
    block.advance(length)
    const n = new GNode('TaskCheckBox')
    n.isChecked = value === 0x78 || value === 0x58
    return n
  },
}

// ---------- linkify ----------

const wwwURLRegexp =
  /^www\.[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-z]+(?:[/#?][-a-zA-Z0-9@:%_+.~#!?&/=();,'">^{}[\]`]*)?/
const urlRegexp =
  /^(?:http|https|ftp):\/\/[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-z]+(?::\d+)?(?:[/#?][-a-zA-Z0-9@:%_+.~#$!?&/=();,'">^{}[\]`]*)?/

const hasPrefix = (line: Uint8Array, prefix: string): boolean => {
  if (line.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++)
    if (line[i] !== prefix.charCodeAt(i)) return false
  return true
}

export const linkifyParser: InlineParser = {
  // ' ' indicates any white spaces and a line head
  trigger: [0x20, 0x2a, 0x5f, 0x7e, 0x28],
  parse(parent, block, pc) {
    if (pc.isInLinkLabel()) return null
    const [line0, segment] = block.peekLine()
    let line = must(line0)
    let consumes = 0
    let start = segment.start
    const c = line[0]
    // advance if current position is not a line head.
    if (c === 0x20 || c === 0x2a || c === 0x5f || c === 0x7e || c === 0x28) {
      consumes++
      start++
      line = line.subarray(1)
    }
    let m: [number, number] | null = null
    let protocol: Uint8Array | null = null
    let typ: 'email' | 'url' = 'url'
    if (
      hasPrefix(line, 'http:') ||
      hasPrefix(line, 'https:') ||
      hasPrefix(line, 'ftp:')
    ) {
      const r = urlRegexp.exec(latin1(line))
      if (r) m = [r.index, r.index + r[0].length]
    }
    if (m === null && hasPrefix(line, 'www.')) {
      const r = wwwURLRegexp.exec(latin1(line))
      m = r ? [r.index, r.index + r[0].length] : null
      protocol = new TextEncoder().encode('http')
    }
    if (m !== null && m[0] !== 0) m = null
    if (m?.[0] === 0) {
      const lastChar = line[m[1] - 1]
      if (lastChar === 0x2e) {
        m[1]--
      } else if (lastChar === 0x29) {
        let closing = 0
        for (let i = m[1] - 1; i >= m[0]; i--) {
          if (line[i] === 0x29) closing++
          else if (line[i] === 0x28) closing--
        }
        if (closing > 0) m[1] -= closing
      } else if (lastChar === 0x3b) {
        let i = m[1] - 2
        for (; i >= m[0]; i--) {
          if (isAlphaNumeric(line[i])) continue
          break
        }
        if (i !== m[1] - 2) {
          if (line[i] === 0x26) m[1] -= m[1] - i
        }
      }
    }
    let at = 0
    let emailEnd = 0
    if (m === null) {
      if (line.length > 0 && isPunct(line[0])) return null
      typ = 'email'
      const stop = findEmailIndex(line)
      if (stop < 0) return null
      at = line.indexOf(0x40)
      emailEnd = stop
      m = [0, stop]
      if (!line.subarray(at, stop - 1).includes(0x2e)) return null
      const lastChar = line[m[1] - 1]
      if (lastChar === 0x2e) m[1]--
      if (m[1] < line.length) {
        const nextChar = line[m[1]]
        if (nextChar === 0x2d || nextChar === 0x5f) return null
      }
    }
    void at
    void emailEnd
    if (consumes !== 0)
      mergeOrAppendTextSegment(parent, segment.withStop(segment.start + 1))
    let i = m[1] - 1
    for (; i > 0; i--) {
      const ch = line[i]
      if (
        ch === 0x3f ||
        ch === 0x21 ||
        ch === 0x2e ||
        ch === 0x2c ||
        ch === 0x3a ||
        ch === 0x2a ||
        ch === 0x5f ||
        ch === 0x7e
      )
        continue
      break
    }
    i++
    consumes += i
    block.advance(consumes)
    const n = new GNode('Text')
    n.segment = new Segment(start, start + i)
    const link = new GNode('AutoLink')
    link.autoLinkType = typ
    link.value = n
    link.protocol = protocol
    return link
  },
}

// ---------- table ----------

const escapedPipeCellListKey = contextKey('escapedPipeCellList')

interface EscapedPipeCell {
  cell: GNode
  pos: number[]
  transformed: boolean
}

function isTableDelim(bs: Uint8Array): boolean {
  if (indentWidth(bs, 0)[0] > 3) return false
  let allSep = true
  for (const b of bs) {
    if (b !== 0x2d) allSep = false
    if (!(isSpace(b) || b === 0x2d || b === 0x7c || b === 0x3a)) return false
  }
  return !allSep
}

const tableDelimLeft = /^[\t\n\f\r ]*:-+[\t\n\f\r ]*$/
const tableDelimRight = /^[\t\n\f\r ]*-+:[\t\n\f\r ]*$/
const tableDelimCenter = /^[\t\n\f\r ]*:-+:[\t\n\f\r ]*$/
const tableDelimNone = /^[\t\n\f\r ]*-+[\t\n\f\r ]*$/

function splitBytes(line: Uint8Array, sep: number): Uint8Array[] {
  const out: Uint8Array[] = []
  let from = 0
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line[i] === sep) {
      out.push(line.subarray(from, i))
      from = i + 1
    }
  }
  return out
}

function parseDelimiter(
  segment: Segment,
  source: Uint8Array
): Alignment[] | null {
  const line = segment.value(source)
  if (!isTableDelim(line)) return null
  let cols = splitBytes(line, 0x7c)
  if (isBlank(cols[0])) cols = cols.slice(1)
  if (cols.length > 0 && isBlank(cols[cols.length - 1]))
    cols = cols.slice(0, cols.length - 1)
  const alignments: Alignment[] = []
  for (const col of cols) {
    const s = latin1(col)
    if (tableDelimLeft.test(s)) alignments.push('left')
    else if (tableDelimRight.test(s)) alignments.push('right')
    else if (tableDelimCenter.test(s)) alignments.push('center')
    else if (tableDelimNone.test(s)) alignments.push('none')
    else return null
  }
  return alignments.length === 0 ? null : alignments
}

function newTableCell(): GNode {
  return new GNode('TableCell')
}

function parseRow(
  segmentIn: Segment,
  alignments: Alignment[],
  isHeader: boolean,
  source: Uint8Array,
  pc: import('./parser.js').Context
): GNode {
  const segment = segmentIn.trimLeftSpace(source).trimRightSpace(source)
  const line = segment.value(source)
  let pos = 0
  let limit = line.length
  const row = new GNode('TableRow')
  row.alignments = alignments
  if (line.length > 0 && line[pos] === 0x7c) pos++
  if (line.length > 0 && line[limit - 1] === 0x7c) limit--
  let i = 0
  for (; pos < limit; i++) {
    let alignment: Alignment = 'none'
    if (i >= alignments.length) {
      if (!isHeader) return row
    } else {
      alignment = alignments[i]
    }
    let escapedCell: EscapedPipeCell | null = null
    const node = newTableCell()
    node.alignment = alignment
    let hasBacktick = false
    let closure = pos
    for (; closure < limit; closure++) {
      if (line[closure] === 0x60) hasBacktick = true
      if (line[closure] === 0x7c) {
        if (closure === 0 || line[closure - 1] !== 0x5c) {
          break
        } else if (hasBacktick) {
          if (escapedCell === null) {
            escapedCell = { cell: node, pos: [], transformed: false }
            pc.computeIfAbsent<EscapedPipeCell[]>(
              escapedPipeCellListKey,
              () => []
            ).push(escapedCell)
          }
          escapedCell.pos.push(segment.start + closure - 1)
        }
      }
    }
    const seg = new Segment(segment.start + pos, segment.start + closure)
      .trimLeftSpace(source)
      .trimRightSpace(source)
    node.lines.append(seg)
    row.appendChild(node)
    pos = closure + 1
  }
  for (; i < alignments.length; i++) row.appendChild(newTableCell())
  return row
}

export const tableParagraphTransformer: ParagraphTransformer = {
  transform(node, reader, pc) {
    const lines = node.lines
    if (lines.length < 2) return
    const source = reader.source()
    for (let i = 1; i < lines.length; i++) {
      const alignments = parseDelimiter(lines.at(i), source)
      if (alignments === null) continue
      const header = parseRow(lines.at(i - 1), alignments, true, source, pc)
      if (alignments.length !== header.childCount) return
      const table = new GNode('Table')
      table.alignments = alignments
      const th = new GNode('TableHeader')
      th.alignments = header.alignments
      for (let c = header.firstChild; c !== null;) {
        const next: GNode | null = c.next
        th.appendChild(c)
        c = next
      }
      table.appendChild(th)
      for (let j = i + 1; j < lines.length; j++)
        table.appendChild(parseRow(lines.at(j), alignments, false, source, pc))
      node.lines.setSliced(0, i - 1)
      must(node.parent).insertAfter(node, table)
      if (node.lines.length === 0) {
        must(node.parent).removeChild(node)
      } else {
        const last = node.lines.at(i - 2)
        node.lines.set(i - 2, last.withStop(last.stop - 1)) // trim last newline(\n)
      }
    }
  },
}

export const tableASTTransformer: ASTTransformer = {
  transform(_node, _reader, pc) {
    const lst = pc.get<EscapedPipeCell[]>(escapedPipeCellListKey)
    if (lst === undefined) return
    pc.set(escapedPipeCellListKey, null)
    for (const v of lst) {
      if (v.transformed) continue
      walk(v.cell, (n, entering) => {
        if (!entering || n.kind !== 'CodeSpan') return 'continue'
        for (let c = n.firstChild; c !== null;) {
          const next: GNode | null = c.next
          if (c.kind !== 'Text') {
            c = next
            continue
          }
          const parent = must(c.parent)
          const ts = c.segment
          let cur = c
          for (const w of lst) {
            for (const pos of w.pos) {
              if (ts.start <= pos && pos < ts.stop) {
                const segment = cur.segment
                const n1 = newRawText(segment.withStop(pos))
                const n2 = newRawText(segment.withStart(pos + 1))
                parent.insertAfter(cur, n1)
                parent.insertAfter(n1, n2)
                parent.removeChild(cur)
                cur = n2
                w.transformed = true
              }
            }
          }
          c = next
        }
        return 'continue'
      })
    }
  },
}
