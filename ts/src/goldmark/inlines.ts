import { GNode, newRawText, newText } from './ast.js'
import { type DelimiterProcessor } from './ast.js'
import { ATTRIBUTE_PATTERN } from './blocks.js'
import { type InlineParser, scanDelimiter } from './parser.js'
import { Segment } from './segment.js'
import { findEmailIndex, findURLIndex, isAlphaNumeric, latin1 } from './util.js'

// ---------- code span ----------

const isSpaceOrNewline = (c: number): boolean => c === 0x20 || c === 0x0a

function codeSpanIsBlank(node: GNode, source: Uint8Array): boolean {
  for (let c = node.firstChild; c !== null; c = c.next) {
    const v = c.segment.value(source)
    for (const b of v) if (!(b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d)) return false
  }
  return true
}

export const codeSpanParser: InlineParser = {
  trigger: [0x60],
  parse(_parent, block) {
    const [line0, startSegment] = block.peekLine()
    let opener = 0
    for (; opener < line0!.length && line0![opener] === 0x60; opener++);
    block.advance(opener)
    const [l, pos] = block.position()
    const node = new GNode('CodeSpan')
    for (;;) {
      const [line, segmentIn] = block.peekLine()
      let segment = segmentIn
      if (line === null) {
        block.setPosition(l, pos)
        return newText(startSegment.withStop(startSegment.start + opener))
      }
      let closed = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!
        if (c === 0x60) {
          const oldi = i
          for (; i < line.length && line[i] === 0x60; i++);
          const closure = i - oldi
          if (closure === opener && (i >= line.length || line[i] !== 0x60)) {
            segment = segment.withStop(segment.start + i - closure)
            if (!segment.isEmpty()) node.appendChild(newRawText(segment))
            block.advance(i)
            closed = true
            break
          }
        }
      }
      if (closed) break
      node.appendChild(newRawText(segment))
      block.advanceLine()
    }
    const source = block.source()
    if (!codeSpanIsBlank(node, source)) {
      let segment = node.firstChild!.segment
      let shouldTrimmed = true
      if (!(!segment.isEmpty() && isSpaceOrNewline(source[segment.start]!))) shouldTrimmed = false
      segment = node.lastChild!.segment
      if (!(!segment.isEmpty() && isSpaceOrNewline(source[segment.stop - 1]!))) shouldTrimmed = false
      if (shouldTrimmed) {
        const first = node.firstChild!
        first.segment = first.segment.withStart(first.segment.start + 1)
        const last = node.lastChild!
        last.segment = last.segment.withStop(last.segment.stop - 1)
      }
    }
    return node
  },
}

// ---------- emphasis ----------

export const emphasisDelimiterProcessor: DelimiterProcessor = {
  isDelimiter: (b) => b === 0x2a || b === 0x5f,
  canOpenCloser: (opener, closer) => opener.char === closer.char,
  onMatch(consumes) {
    const n = new GNode('Emphasis')
    n.level = consumes
    return n
  },
}

export const emphasisParser: InlineParser = {
  trigger: [0x2a, 0x5f],
  parse(_parent, block, pc) {
    const before = block.precedingCharacter()
    const [line, segment] = block.peekLine()
    const node = scanDelimiter(line!, before, 1, emphasisDelimiterProcessor)
    if (node === null) return null
    node.segment = segment.withStop(segment.start + node.originalLength)
    block.advance(node.originalLength)
    pc.pushDelimiter(node)
    return node
  },
}

// ---------- autolink <...> ----------

export const autoLinkParser: InlineParser = {
  trigger: [0x3c],
  parse(_parent, block) {
    const [line0, segment] = block.peekLine()
    const line = line0!
    let stop = findEmailIndex(line.subarray(1))
    let typ: 'email' | 'url' = 'email'
    if (stop < 0) {
      stop = findURLIndex(line.subarray(1))
      typ = 'url'
    }
    if (stop < 0) return null
    stop++
    if (stop >= line.length || line[stop] !== 0x3e) return null
    const value = newText(new Segment(segment.start + 1, segment.start + stop))
    block.advance(stop + 1)
    const n = new GNode('AutoLink')
    n.autoLinkType = typ
    n.value = value
    return n
  },
}

// ---------- raw HTML ----------

const tagnamePattern = '([A-Za-z][A-Za-z0-9-]*)'
const spaceOrOneNewline = '(?:[ \\t]|(?:\\r\\n|\\n){0,1})'
const openTagRegexp = new RegExp('^<' + tagnamePattern + ATTRIBUTE_PATTERN + '*' + spaceOrOneNewline + '*/?>')
const closeTagRegexp = new RegExp('^</' + tagnamePattern + spaceOrOneNewline + '*>')

const startsWith = (line: Uint8Array, prefix: string): boolean => {
  if (line.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (line[i] !== prefix.charCodeAt(i)) return false
  return true
}

import type { TextReader } from './reader.js'

function indexOfSeq(line: Uint8Array, seq: string): number {
  return latin1(line).indexOf(seq)
}

function parseMultiLineRegexp(reg: RegExp, block: TextReader): GNode | null {
  const [sline, ssegment] = block.position()
  if (block.match(reg)) {
    const node = new GNode('RawHTML')
    const [eline, esegment] = block.position()
    block.setPosition(sline, ssegment)
    for (;;) {
      const [line, segment] = block.peekLine()
      if (line === null) break
      const [l] = block.position()
      let start = segment.start
      if (l === sline) start = ssegment.start
      let end = segment.stop
      if (l === eline) end = esegment.start
      node.segments.append(new Segment(start, end))
      if (l === eline) {
        block.advance(end - start)
        break
      }
      block.advanceLine()
    }
    return node
  }
  return null
}

function parseComment(block: TextReader): GNode | null {
  const [savedLine, savedSegment] = block.position()
  const node = new GNode('RawHTML')
  let [line, segment] = block.peekLine()
  if (startsWith(line!, '<!-->')) {
    node.segments.append(segment.withStop(segment.start + 5))
    block.advance(5)
    return node
  }
  if (startsWith(line!, '<!--->')) {
    node.segments.append(segment.withStop(segment.start + 6))
    block.advance(6)
    return node
  }
  let offset = 4
  let rest: Uint8Array | null = line!.subarray(offset)
  for (;;) {
    const index = indexOfSeq(rest!, '-->')
    if (index > -1) {
      node.segments.append(segment.withStop(segment.start + offset + index + 3))
      block.advance(offset + index + 3)
      return node
    }
    offset = 0
    node.segments.append(segment)
    block.advanceLine()
    ;[line, segment] = block.peekLine()
    if (line === null) break
    rest = line
  }
  block.setPosition(savedLine, savedSegment)
  return null
}

function parseUntil(block: TextReader, closer: string): GNode | null {
  const [savedLine, savedSegment] = block.position()
  const node = new GNode('RawHTML')
  for (;;) {
    const [line, segment] = block.peekLine()
    if (line === null) break
    const index = indexOfSeq(line, closer)
    if (index > -1) {
      node.segments.append(segment.withStop(segment.start + index + closer.length))
      block.advance(index + closer.length)
      return node
    }
    node.segments.append(segment)
    block.advanceLine()
  }
  block.setPosition(savedLine, savedSegment)
  return null
}

export const rawHTMLParser: InlineParser = {
  trigger: [0x3c],
  parse(_parent, block) {
    const [line0] = block.peekLine()
    const line = line0!
    if (line.length > 1 && isAlphaNumeric(line[1]!)) return parseMultiLineRegexp(openTagRegexp, block)
    if (line.length > 2 && line[1] === 0x2f && isAlphaNumeric(line[2]!)) return parseMultiLineRegexp(closeTagRegexp, block)
    if (startsWith(line, '<!--')) return parseComment(block)
    if (startsWith(line, '<?')) return parseUntil(block, '?>')
    if (line.length > 2 && line[1] === 0x21 && line[2]! >= 0x41 && line[2]! <= 0x5a) return parseUntil(block, '>')
    if (startsWith(line, '<![CDATA[')) return parseUntil(block, ']]>')
    return null
  },
}
