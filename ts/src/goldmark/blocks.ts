import { GNode, isParagraph } from './ast.js'
import {
  type Context,
  type BlockParser,
  type ParagraphTransformer,
  State,
  contextKey,
} from './parser.js'
import { BlockReader, type TextReader } from './reader.js'
import { Segment } from './segment.js'
import {
  firstNonSpacePosition,
  indentPosition,
  indentPositionPadding,
  indentWidth,
  isBlank,
  isNumeric,
  isSpace,
  latin1,
  tabWidth,
  toLinkReference,
  trimLeftLength,
  trimLeftSpaceLength,
  trimRightSpaceLength,
} from './util.js'
import { parseLinkDestination, LINK_FIND_CLOSURE_OPTIONS } from './link.js'
import { must } from '../must.js'

const { Continue, Close, HasChildren, NoChildren, RequireParagraph } = State

const newBlock = (kind: GNode['kind']): GNode => new GNode(kind)

// ---------- paragraph ----------

export const paragraphParser: BlockParser = {
  trigger: null,
  open(_parent, reader) {
    let [, segment] = reader.peekLine()
    segment = segment.trimLeftSpace(reader.source())
    if (segment.isEmpty()) return [null, NoChildren]
    const node = newBlock('Paragraph')
    node.lines.append(segment)
    reader.advanceToEOL()
    return [node, NoChildren]
  },
  continue(node, reader) {
    const [line, segment] = reader.peekLine()
    if (isBlank(must(line))) return Close
    node.lines.append(segment)
    reader.advanceToEOL()
    return Continue | NoChildren
  },
  close(node, reader) {
    const lines = node.lines
    if (lines.length !== 0) {
      for (let i = 0; i < lines.length; i++)
        lines.set(i, lines.at(i).trimLeftSpace(reader.source()))
      const length = lines.length
      lines.set(
        length - 1,
        lines.at(length - 1).trimRightSpace(reader.source())
      )
    }
    if (lines.length === 0) must(node.parent).removeChild(node)
  },
  canInterruptParagraph: false,
  canAcceptIndentedLine: false,
}

// ---------- setext heading ----------

const temporaryParagraphKey = contextKey('temporaryParagraph')

function matchesSetextHeadingBar(line: Uint8Array): [number, boolean] {
  let start = 0
  let end = line.length
  const space = trimLeftLength(line, [0x20])
  if (space > 3) return [0, false]
  start += space
  const level1 = trimLeftLength(line.subarray(start, end), [0x3d])
  let c = 0x3d
  let level2 = 0
  if (level1 === 0) {
    level2 = trimLeftLength(line.subarray(start, end), [0x2d])
    c = 0x2d
  }
  if (isSpace(line[end - 1]))
    end -= trimRightSpaceLength(line.subarray(start, end))
  if (
    !(
      (level1 > 0 && start + level1 === end) ||
      (level2 > 0 && start + level2 === end)
    )
  )
    return [0, false]
  return [c, true]
}

export const setextHeadingParser: BlockParser = {
  trigger: [0x2d, 0x3d],
  open(parent, reader, pc) {
    const last = pc.lastOpenedBlock().node
    if (last === null) return [null, NoChildren]
    if (last.kind !== 'Paragraph' || last.parent !== parent)
      return [null, NoChildren]
    const [line, segment] = reader.peekLine()
    const [c, ok] = matchesSetextHeadingBar(must(line))
    if (!ok) return [null, NoChildren]
    const node = newBlock('Heading')
    node.level = c === 0x2d ? 2 : 1
    node.lines.append(segment)
    pc.set(temporaryParagraphKey, last)
    return [node, NoChildren | RequireParagraph]
  },
  continue: () => Close,
  close(node, reader, pc) {
    let segment = node.lines.at(0)
    node.lines.clear()
    const tmp = must(pc.get<GNode>(temporaryParagraphKey))
    pc.set(temporaryParagraphKey, null)
    if (tmp.lines.length === 0) {
      const next = node.next
      segment = segment.trimLeftSpace(reader.source())
      if (next === null || !isParagraph(next)) {
        const para = newBlock('Paragraph')
        para.lines.append(segment)
        must(node.parent).insertAfter(node, para)
      } else {
        next.lines.unshift(segment)
      }
      must(node.parent).removeChild(node)
    } else {
      node.lines = tmp.lines
      node.blankPreviousLines = tmp.blankPreviousLines
      const tp = tmp.parent
      if (tp !== null) tp.removeChild(tmp)
    }
  },
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

// ---------- thematic break ----------

export function isThematicBreak(line: Uint8Array, offset: number): boolean {
  const [w, pos] = indentWidth(line, offset)
  if (w > 3) return false
  let mark = 0
  let count = 0
  for (let i = pos; i < line.length; i++) {
    const c = line[i]
    if (isSpace(c)) continue
    if (mark === 0) {
      mark = c
      count = 1
      if (mark === 0x2a || mark === 0x2d || mark === 0x5f) continue
      return false
    }
    if (c !== mark) return false
    count++
  }
  return count > 2
}

export const thematicBreakParser: BlockParser = {
  trigger: [0x2d, 0x2a, 0x5f],
  open(_parent, reader) {
    const [line] = reader.peekLine()
    if (isThematicBreak(must(line), reader.lineOffset())) {
      reader.advanceToEOL()
      return [newBlock('ThematicBreak'), NoChildren]
    }
    return [null, NoChildren]
  },
  continue: () => Close,
  close() {},
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

// ---------- ATX heading ----------

export const atxHeadingParser: BlockParser = {
  trigger: [0x23],
  open(_parent, reader, pc) {
    const [line0, segment] = reader.peekLine()
    const line = must(line0)
    const pos = pc.blockOffset
    if (pos < 0) return [null, NoChildren]
    let i = pos
    for (; i < line.length && line[i] === 0x23; i++);
    const level = i - pos
    if (i === pos || level > 6) return [null, NoChildren]
    const heading = (): GNode => {
      const n = newBlock('Heading')
      n.level = level
      return n
    }
    if (i === line.length) return [heading(), NoChildren] // alone '#' (without a new line character)
    const l = trimLeftSpaceLength(line.subarray(i))
    if (l === 0) return [null, NoChildren]
    const start = Math.min(i + l, line.length - 1)
    const node = heading()
    let hl = new Segment(
      segment.start + start - segment.padding,
      segment.start + line.length - segment.padding
    )
    hl = hl.trimRightSpace(reader.source())
    if (hl.length === 0) {
      reader.advanceToEOL()
      return [node, NoChildren]
    }
    const hv = hl.value(reader.source())
    let stop = hv.length
    if (stop !== 0) {
      i = stop - 1
      for (; hv[i] === 0x23 && i > 0; i--);
      if (i === 0 && hv[0] === 0x23) {
        // empty headings like '### ###'
        reader.advanceToEOL()
        return [node, NoChildren]
      }
      if (i !== stop - 1 && isSpace(hv[i])) {
        stop = i
        stop -= trimRightSpaceLength(hv.subarray(0, stop))
      }
    }
    hl = new Segment(hl.start, hl.start + stop, hl.padding)
    node.lines.append(hl)
    reader.advanceToEOL()
    return [node, NoChildren]
  },
  continue: () => Close,
  close() {},
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

// ---------- indented code block ----------

function preserveLeadingTabInCodeBlock(
  segment: Segment,
  reader: TextReader,
  indent: number
): Segment {
  const offsetWithPadding = reader.lineOffset() + indent
  const [sl, ss] = reader.position()
  reader.setPosition(sl, new Segment(ss.start - 1, ss.stop))
  let out = segment
  if (offsetWithPadding === reader.lineOffset())
    out = new Segment(segment.start - 1, segment.stop, 0, segment.forceNewline)
  reader.setPosition(sl, ss)
  return out
}

export const codeBlockParser: BlockParser = {
  trigger: null,
  open(_parent, reader) {
    const [line] = reader.peekLine()
    const [pos, padding] = indentPosition(must(line), reader.lineOffset(), 4)
    if (pos < 0 || isBlank(must(line))) return [null, NoChildren]
    const node = newBlock('CodeBlock')
    reader.advanceAndSetPadding(pos, padding)
    let [, segment] = reader.peekLine()
    if (segment.padding !== 0)
      segment = preserveLeadingTabInCodeBlock(segment, reader, 0)
    segment = segment.withForceNewline(true)
    node.lines.append(segment)
    reader.advanceToEOL()
    return [node, NoChildren]
  },
  continue(node, reader) {
    const [line, segment0] = reader.peekLine()
    let segment = segment0
    if (isBlank(must(line))) {
      node.lines.append(segment.trimLeftSpaceWidth(4, reader.source()))
      return Continue | NoChildren
    }
    const [pos, padding] = indentPosition(must(line), reader.lineOffset(), 4)
    if (pos < 0) return Close
    reader.advanceAndSetPadding(pos, padding)
    ;[, segment] = reader.peekLine()
    if (segment.padding !== 0)
      segment = preserveLeadingTabInCodeBlock(segment, reader, 0)
    segment = segment.withForceNewline(true)
    node.lines.append(segment)
    reader.advanceToEOL()
    return Continue | NoChildren
  },
  close(node, reader) {
    const lines = node.lines
    let length = lines.length - 1
    const source = reader.source()
    while (length >= 0) {
      if (isBlank(lines.at(length).value(source))) length--
      else break
    }
    lines.setSliced(0, length + 1)
  },
  canInterruptParagraph: false,
  canAcceptIndentedLine: true,
}

// ---------- fenced code block ----------

interface FenceData {
  char: number
  indent: number
  length: number
  node: GNode
}
const fencedCodeBlockInfoKey = contextKey('fencedCodeBlockInfo')

export const fencedCodeBlockParser: BlockParser = {
  trigger: [0x7e, 0x60],
  open(_parent, reader, pc) {
    const [line0, segment] = reader.peekLine()
    const line = must(line0)
    const pos = pc.blockOffset
    if (pos < 0 || (line[pos] !== 0x60 && line[pos] !== 0x7e))
      return [null, NoChildren]
    const findent = pos
    const fenceChar = line[pos]
    let i = pos
    for (; i < line.length && line[i] === fenceChar; i++);
    const oFenceLength = i - pos
    if (oFenceLength < 3) return [null, NoChildren]
    let info: GNode | null = null
    if (i < line.length - 1) {
      const rest = line.subarray(i)
      const left = trimLeftSpaceLength(rest)
      const right = trimRightSpaceLength(rest)
      if (left < rest.length - right) {
        const infoStart = segment.start - segment.padding + i + left
        const infoStop = segment.stop - right
        const value = rest.subarray(left, rest.length - right)
        if (fenceChar === 0x60 && value.includes(0x60))
          return [null, NoChildren]
        else if (infoStart !== infoStop) {
          info = new GNode('Text')
          info.segment = new Segment(infoStart, infoStop)
        }
      }
    }
    const node = newBlock('FencedCodeBlock')
    node.info = info
    pc.set(fencedCodeBlockInfoKey, {
      char: fenceChar,
      indent: findent,
      length: oFenceLength,
      node,
    } satisfies FenceData)
    return [node, NoChildren]
  },
  continue(node, reader, pc) {
    const [line0, segment] = reader.peekLine()
    const line = must(line0)
    const fdata = must(pc.get<FenceData>(fencedCodeBlockInfoKey))
    const [w, pos0] = indentWidth(line, reader.lineOffset())
    if (w < 4) {
      let i = pos0
      for (; i < line.length && line[i] === fdata.char; i++);
      const length = i - pos0
      if (length >= fdata.length && isBlank(line.subarray(i))) {
        const newline = line[line.length - 1] !== 0x0a ? 0 : 1
        reader.advance(segment.stop - segment.start - newline + segment.padding)
        return Close
      }
    }
    let [pos, padding] = indentPositionPadding(
      line,
      reader.lineOffset(),
      segment.padding,
      fdata.indent
    )
    if (pos < 0) {
      pos = Math.max(0, firstNonSpacePosition(line)) - segment.padding
      padding = 0
    }
    let seg = new Segment(segment.start + pos, segment.stop, padding)
    if (padding !== 0)
      seg = preserveLeadingTabInCodeBlock(seg, reader, fdata.indent)
    seg = seg.withForceNewline(true) // EOF as newline
    node.lines.append(seg)
    reader.advanceAndSetPadding(segment.stop - segment.start - pos - 1, padding)
    return Continue | NoChildren
  },
  close(node, _reader, pc) {
    const fdata = pc.get<FenceData>(fencedCodeBlockInfoKey)
    if (fdata?.node === node) pc.set(fencedCodeBlockInfoKey, null)
  },
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

// ---------- blockquote ----------

function blockquoteProcess(reader: TextReader): boolean {
  const [line0] = reader.peekLine()
  const line = must(line0)
  const [w, pos0] = indentWidth(line, reader.lineOffset())
  let pos = pos0
  if (w > 3 || pos >= line.length || line[pos] !== 0x3e) return false
  pos++
  if (pos >= line.length || line[pos] === 0x0a) {
    reader.advance(pos)
    return true
  }
  reader.advance(pos)
  if (line[pos] === 0x20 || line[pos] === 0x09) {
    let padding = 0
    if (line[pos] === 0x09) padding = tabWidth(reader.lineOffset()) - 1
    reader.advanceAndSetPadding(1, padding)
  }
  return true
}

export const blockquoteParser: BlockParser = {
  trigger: [0x3e],
  open(_parent, reader) {
    if (blockquoteProcess(reader)) return [newBlock('Blockquote'), HasChildren]
    return [null, NoChildren]
  },
  continue(_node, reader) {
    if (blockquoteProcess(reader)) return Continue | HasChildren
    return Close
  },
  close() {},
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

// ---------- lists ----------

const skipListParserKey = contextKey('skipListParser')
const emptyListItemWithBlankLines = contextKey('emptyListItemWithBlankLines')

type ListItemType = 'notList' | 'bulletList' | 'orderedList'

/** parseListItem: match = [0, indent, indent, markerEnd, contentStart, lineEnd]. */
function parseListItem(line: Uint8Array): [number[], ListItemType] {
  let i = 0
  const l = line.length
  const ret = [0, 0, 0, 0, 0, 0]
  for (; i < l && line[i] === 0x20; i++);
  if (i > 3) return [ret, 'notList']
  ret[0] = 0
  ret[1] = i
  ret[2] = i
  let typ: ListItemType
  if (i < l && (line[i] === 0x2d || line[i] === 0x2a || line[i] === 0x2b)) {
    i++
    ret[3] = i
    typ = 'bulletList'
  } else if (i < l) {
    for (; i < l && isNumeric(line[i]); i++);
    ret[3] = i
    if (ret[3] === ret[2] || ret[3] - ret[2] > 9) return [ret, 'notList']
    if (i < l && (line[i] === 0x2e || line[i] === 0x29)) {
      i++
      ret[3] = i
    } else {
      return [ret, 'notList']
    }
    typ = 'orderedList'
  } else {
    return [ret, 'notList']
  }
  if (i < l && line[i] !== 0x0a) {
    const [w] = indentWidth(line.subarray(i), 0)
    if (w === 0) return [ret, 'notList']
  }
  if (i >= l) {
    ret[4] = -1
    ret[5] = -1
    return [ret, typ]
  }
  ret[4] = i
  ret[5] = line.length
  if (line[ret[5] - 1] === 0x0a && line[i] !== 0x0a) ret[5]--
  return [ret, typ]
}

function matchesListItem(
  source: Uint8Array,
  strict: boolean
): [number[], ListItemType] {
  const [m, typ] = parseListItem(source)
  if (typ !== 'notList' && (!strict || (strict && m[1] < 4))) return [m, typ]
  return [m, 'notList']
}

function calcListOffset(source: Uint8Array, match: number[]): number {
  let offset: number
  if (match[4] < 0 || isBlank(source.subarray(match[4]))) {
    offset = 1 // list item starts with a blank line
  } else {
    offset = indentWidth(source.subarray(match[4]), match[4])[0]
    if (offset > 4) offset = 1 // offseted codeblock
  }
  return offset
}

function lastOffset(node: GNode): number {
  return node.lastChild !== null ? node.lastChild.offset : 0
}

export const listItemParser: BlockParser = {
  trigger: [
    0x2d, 0x2b, 0x2a, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38,
    0x39,
  ],
  open(parent, reader, pc) {
    if (parent.kind !== 'List') return [null, NoChildren] // list item must be a child of a list
    const offset = lastOffset(parent)
    const [line0] = reader.peekLine()
    const line = must(line0)
    const [match, typ] = matchesListItem(line, false)
    if (typ === 'notList') return [null, NoChildren]
    if (match[1] - offset > 3) return [null, NoChildren]
    pc.set(emptyListItemWithBlankLines, null)
    const itemOffset = calcListOffset(line, match)
    const node = newBlock('ListItem')
    node.offset = match[3] + itemOffset
    if (match[4] < 0 || isBlank(line.subarray(match[4], match[5])))
      return [node, NoChildren]
    const [pos, padding] = indentPosition(
      line.subarray(match[4]),
      match[4],
      itemOffset
    )
    const child = match[3] + pos
    reader.advanceAndSetPadding(child, padding)
    return [node, HasChildren]
  },
  continue(node, reader, pc) {
    const [line0] = reader.peekLine()
    const line = must(line0)
    if (isBlank(line)) {
      reader.advanceToEOL()
      return Continue | HasChildren
    }
    const offset = lastOffset(must(node.parent))
    const isEmpty =
      node.childCount === 0 && pc.get(emptyListItemWithBlankLines) !== undefined
    const [indent] = indentWidth(line, reader.lineOffset())
    if ((isEmpty || indent < offset) && indent < 4) {
      const [, typ] = matchesListItem(line, true)
      if (typ !== 'notList') {
        pc.set(skipListParserKey, true)
        return Close
      }
      if (!isEmpty) return Close
    }
    const [pos, padding] = indentPosition(line, reader.lineOffset(), offset)
    reader.advanceAndSetPadding(pos, padding)
    return Continue | HasChildren
  },
  close() {},
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

const listCanContinue = (
  list: GNode,
  marker: number,
  isOrdered: boolean
): boolean => marker === list.marker && isOrdered === listIsOrdered(list)
export const listIsOrdered = (l: GNode): boolean =>
  l.marker === 0x2e || l.marker === 0x29

export const listParser: BlockParser = {
  trigger: [
    0x2d, 0x2b, 0x2a, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38,
    0x39,
  ],
  open(parent, reader, pc) {
    const last = pc.lastOpenedBlock().node
    if (last?.kind === 'List' || pc.get(skipListParserKey) !== undefined) {
      pc.set(skipListParserKey, null)
      return [null, NoChildren]
    }
    const [line0] = reader.peekLine()
    const line = must(line0)
    const [match, typ] = matchesListItem(line, true)
    if (typ === 'notList') return [null, NoChildren]
    let start = -1
    if (typ === 'orderedList') {
      const number = line.subarray(match[2], match[3] - 1)
      start = parseInt(latin1(number), 10)
    }
    if (isParagraph(last) && must(last).parent === parent) {
      // we allow only lists starting with 1 to interrupt paragraphs.
      if (typ === 'orderedList' && start !== 1) return [null, NoChildren]
      // an empty list item cannot interrupt a paragraph:
      if (match[4] < 0 || isBlank(line.subarray(match[4], match[5])))
        return [null, NoChildren]
    }
    const marker = line[match[3] - 1]
    const node = newBlock('List')
    node.marker = marker
    if (start > -1) node.start = start
    pc.set(emptyListItemWithBlankLines, null)
    return [node, HasChildren]
  },
  continue(node, reader, pc) {
    const [line0] = reader.peekLine()
    const line = must(line0)
    if (isBlank(line)) {
      if (must(node.lastChild).childCount === 0)
        pc.set(emptyListItemWithBlankLines, true)
      return Continue | HasChildren
    }
    // "offset" is the width the marker takes; a line indented less than the
    // last item's offset may start a new item of this list.
    const offset = lastOffset(node)
    const lastIsEmpty = must(node.lastChild).childCount === 0
    const [indent] = indentWidth(line, reader.lineOffset())
    if (indent < offset || lastIsEmpty) {
      if (indent < 4) {
        const [match, typ] = matchesListItem(line, false) // may have a leading spaces more than 3
        if (typ !== 'notList' && match[1] - offset < 4) {
          const marker = line[match[3] - 1]
          if (!listCanContinue(node, marker, typ === 'orderedList'))
            return Close
          // Thematic Breaks take precedence over lists
          if (isThematicBreak(line.subarray(match[3] - 1), 0)) {
            let isHeading = false
            const last = pc.lastOpenedBlock().node
            if (isParagraph(last)) {
              const [c, ok] = matchesSetextHeadingBar(
                line.subarray(match[3] - 1)
              )
              if (ok && c === 0x2d) isHeading = true
            }
            if (!isHeading) return Close
          }
          return Continue | HasChildren
        }
      }
      if (!lastIsEmpty) return Close
    }
    if (lastIsEmpty && indent < offset) return Close
    // Non empty items can not exist next to an empty list item with blank lines, so the list closes.
    if (pc.get(emptyListItemWithBlankLines) !== undefined) return Close
    return Continue | HasChildren
  },
  close(node) {
    let tight = node.isTight
    for (let c = node.firstChild; c !== null && tight; c = c.next) {
      if (c.firstChild !== null && c.firstChild !== c.lastChild) {
        for (let c1 = c.firstChild.next; c1 !== null; c1 = c1.next) {
          if (c1.blankPreviousLines) {
            tight = false
            break
          }
        }
      }
      if (c !== node.firstChild && c.blankPreviousLines) tight = false
    }
    node.isTight = tight
    if (node.isTight) {
      for (let child = node.firstChild; child !== null; child = child.next) {
        for (let gc = child.firstChild; gc !== null;) {
          const paragraph = gc
          gc = gc.next
          if (paragraph.kind === 'Paragraph') {
            const textBlock = newBlock('TextBlock')
            textBlock.lines = paragraph.lines
            child.replaceChild(paragraph, textBlock)
          }
        }
      }
    }
  },
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

// ---------- HTML block ----------

const ALLOWED_BLOCK_TAGS = new Set(
  'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul'.split(
    ' '
  )
)

export const ATTRIBUTE_PATTERN =
  '(?:[\\r\\n \\t]+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:[\\r\\n \\t]*=[\\r\\n \\t]*(?:[^"\'=<>`\\x00-\\x20]+|\'[^\']*\'|"[^"]*"))?)'

const type1Open =
  /^[ ]{0,3}<(script|pre|style|textarea)(?:[\t\n\f\r ][^\n]*|>[^\n]*|\/>[^\n]*|)(?:\r\n|\n)?$/i
const type1Close = /^[^\n]*<\/(?:script|pre|style|textarea)>/i
const type2Open = /^[ ]{0,3}<!--/
const type3Open = /^[ ]{0,3}<\?/
const type4Open = /^[ ]{0,3}<![A-Z]+[^\n]*(?:\r\n|\n)?$/
const type5Open = /^[ ]{0,3}<!\[CDATA\[/
const type6 =
  /^[ ]{0,3}<(?:\/[ ]*)?([a-zA-Z]+[a-zA-Z0-9-]*)(?:[ ][^\n]*|>[^\n]*|\/>[^\n]*|)(?:\r\n|\n)?$/
const type7 = new RegExp(
  '^[ ]{0,3}<(\\/[ ]*)?([a-zA-Z]+[a-zA-Z0-9-]*)(' +
    ATTRIBUTE_PATTERN +
    '*)[ ]*(?:>|\\/>)[ ]*(?:\\r\\n|\\n)?$'
)

const bytesContain = (hay: Uint8Array, needle: string): boolean =>
  latin1(hay).includes(needle)

export const htmlBlockParser: BlockParser = {
  trigger: [0x3c],
  open(_parent, reader, pc) {
    let node: GNode | null = null
    const [line0, segment] = reader.peekLine()
    const line = must(line0)
    const last = pc.lastOpenedBlock().node
    const pos = pc.blockOffset
    if (pos < 0 || line[pos] !== 0x3c) return [null, NoChildren]
    const text = latin1(line)
    const make = (t: number): GNode => {
      const n = newBlock('HTMLBlock')
      n.htmlBlockType = t
      return n
    }
    let m: RegExpExecArray | null
    if (type1Open.test(text)) node = make(1)
    else if (type2Open.test(text)) node = make(2)
    else if (type3Open.test(text)) node = make(3)
    else if (type4Open.test(text)) node = make(4)
    else if (type5Open.test(text)) node = make(5)
    else if ((m = type7.exec(text)) !== null) {
      const isCloseTag = m[1] === '/'
      const hasAttr = (m[3] ?? '') !== ''
      const tagName = m[2].toLowerCase()
      if (ALLOWED_BLOCK_TAGS.has(tagName)) {
        node = make(6)
      } else if (
        tagName !== 'script' &&
        tagName !== 'style' &&
        tagName !== 'pre' &&
        !isParagraph(last) &&
        !(isCloseTag && hasAttr)
      ) {
        node = make(7) // type 7 can not interrupt paragraph
      }
    }
    if (node === null) {
      const m6 = type6.exec(text)
      if (m6 !== null && ALLOWED_BLOCK_TAGS.has(m6[1].toLowerCase()))
        node = make(6)
    }
    if (node !== null) {
      reader.advanceToEOL()
      node.lines.append(segment)
      return [node, NoChildren]
    }
    return [null, NoChildren]
  },
  continue(node, reader) {
    const lines = node.lines
    const [line0, segment] = reader.peekLine()
    const line = must(line0)
    let closurePattern: string | null = null
    switch (node.htmlBlockType) {
      case 1:
        if (lines.length === 1) {
          if (type1Close.test(latin1(lines.at(0).value(reader.source()))))
            return Close
        }
        if (type1Close.test(latin1(line))) {
          node.closureLine = segment
          reader.advanceToEOL()
          return Close
        }
        break
      case 2:
      case 3:
      case 4:
      case 5:
        closurePattern = { 2: '-->', 3: '?>', 4: '>', 5: ']]>' }[
          node.htmlBlockType
        ]
        if (lines.length === 1) {
          if (bytesContain(lines.at(0).value(reader.source()), closurePattern))
            return Close
        }
        if (bytesContain(line, closurePattern)) {
          node.closureLine = segment
          reader.advanceToEOL()
          return Close
        }
        break
      case 6:
      case 7:
        if (isBlank(line)) return Close
        break
    }
    node.lines.append(segment)
    reader.advanceToEOL()
    return Continue | NoChildren
  },
  close() {},
  canInterruptParagraph: true,
  canAcceptIndentedLine: false,
}

// ---------- link reference definitions ----------

function parseLinkReferenceDefinition(
  block: TextReader,
  pc: Context
): [number, number] {
  block.skipSpaces()
  let [line] = block.peekLine()
  if (line === null) return [-1, -1]
  const [startLine] = block.position()
  const [width, pos0] = indentWidth(line, 0)
  let pos = pos0
  if (width > 3) return [-1, -1]
  if (width !== 0) pos++
  if (line[pos] !== 0x5b) return [-1, -1]
  block.advance(pos + 1)
  let [segments, found] = block.findClosure(
    0x5b,
    0x5d,
    LINK_FIND_CLOSURE_OPTIONS
  )
  if (!found) return [-1, -1]
  const concat = (): Uint8Array => {
    const parts: Uint8Array[] = []
    for (let i = 0; i < must(segments).length; i++)
      parts.push(block.value(must(segments).at(i)))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
  const label = concat()
  if (isBlank(label)) return [-1, -1]
  if (block.peek() !== 0x3a) return [-1, -1]
  block.advance(1)
  block.skipSpaces()
  const [destination, ok] = parseLinkDestination(block)
  if (!ok) return [-1, -1]
  ;[line] = block.peekLine()
  const isNewLine = line === null || isBlank(line)
  let [endLine] = block.position()
  const [, spaces] = block.skipSpaces()
  const opener = block.peek()
  const addRef = (title: Uint8Array | null): void =>
    pc.addReference(toLinkReference(label), {
      label,
      destination: must(destination),
      title,
    })
  if (opener !== 0x22 && opener !== 0x27 && opener !== 0x28) {
    if (!isNewLine) return [-1, -1]
    addRef(null)
    return [startLine, endLine + 1]
  }
  if (spaces === 0) return [-1, -1]
  block.advance(1)
  const closer = opener === 0x28 ? 0x29 : opener
  ;[segments, found] = block.findClosure(
    opener,
    closer,
    LINK_FIND_CLOSURE_OPTIONS
  )
  if (!found) {
    if (!isNewLine) return [-1, -1]
    addRef(null)
    block.advanceLine()
    return [startLine, endLine + 1]
  }
  const title = concat()
  ;[line] = block.peekLine()
  if (line !== null && !isBlank(line)) {
    if (!isNewLine) return [-1, -1]
    addRef(title)
    return [startLine, endLine]
  }
  ;[endLine] = block.position()
  addRef(title)
  return [startLine, endLine + 1]
}

export const linkReferenceParagraphTransformer: ParagraphTransformer = {
  transform(node, reader, pc) {
    const lines = node.lines
    const block = new BlockReader(reader.source(), lines)
    const removes: Array<[number, number]> = []
    for (;;) {
      let [start, end] = parseLinkReferenceDefinition(block, pc)
      if (start > -1) {
        if (start === end) end++
        removes.push([start, end])
        continue
      }
      break
    }
    let offset = 0
    for (const remove of removes) {
      if (lines.length === 0) break
      const s = lines.sliced(remove[1] - offset, lines.length)
      lines.setSliced(0, remove[0] - offset)
      lines.appendAll(s)
      offset = remove[1]
    }
    if (lines.length === 0) {
      const t = newBlock('TextBlock')
      t.blankPreviousLines = node.blankPreviousLines
      must(node.parent).replaceChild(node, t)
      return
    }
    node.lines = lines
  },
}
