import { GNode, mergeOrReplaceTextSegment, newText } from './ast.js'
import {
  type InlineParser,
  type Context,
  linkLabelStateKey,
  processDelimiters,
} from './parser.js'
import type { FindClosureOptions, TextReader } from './reader.js'
import { Segment } from './segment.js'
import { isBlank, isPunct, isSpace, toLinkReference } from './util.js'
import { must } from '../must.js'

export const LINK_FIND_CLOSURE_OPTIONS: FindClosureOptions = {
  nesting: false,
  newline: true,
  advance: true,
}

function newLinkLabelState(segment: Segment, isImage: boolean): GNode {
  const s = new GNode('LinkLabelState')
  s.segment = segment
  s.isImage = isImage
  return s
}

function linkLabelStateLength(v: GNode | undefined): number {
  if (!v?.labelLast || !v.labelFirst) return 0
  return v.labelLast.segment.stop - v.labelFirst.segment.start
}

function pushLinkLabelState(pc: Context, v: GNode): void {
  const list = pc.get<GNode>(linkLabelStateKey)
  if (list === undefined) {
    v.labelFirst = v
    v.labelLast = v
    pc.set(linkLabelStateKey, v)
  } else {
    const l = must(list.labelLast)
    list.labelLast = v
    l.labelNext = v
    v.labelPrev = l
  }
}

function removeLinkLabelState(pc: Context, d: GNode): void {
  let list = pc.get<GNode>(linkLabelStateKey)
  if (list === undefined) return
  if (d.labelPrev === null) {
    const next = d.labelNext
    if (next !== null) {
      next.labelFirst = d
      next.labelLast = d.labelLast
      next.labelPrev = null
      pc.set(linkLabelStateKey, next)
      list = next
    } else {
      pc.set(linkLabelStateKey, null)
      list = undefined
    }
  } else {
    d.labelPrev.labelNext = d.labelNext
    if (d.labelNext !== null) d.labelNext.labelPrev = d.labelPrev
  }
  if (list !== undefined && d.labelNext === null) list.labelLast = d.labelPrev
  d.labelNext = null
  d.labelPrev = null
  d.labelFirst = null
  d.labelLast = null
}

function pushLinkBottom(pc: Context): void {
  pc.linkBottoms.push(pc.lastDelimiter)
}

function popLinkBottom(pc: Context): GNode | null | undefined {
  if (pc.linkBottoms.length === 0) return undefined
  return pc.linkBottoms.pop()
}

function containsLink(n: GNode | null): boolean {
  for (let c = n; c !== null; c = c.next) {
    if (c.kind === 'Link') return true
    if (containsLink(c.firstChild)) return true
  }
  return false
}

function processLinkLabelOpen(
  block: TextReader,
  pos: number,
  isImage: boolean,
  pc: Context
): GNode {
  let start = pos
  if (isImage) start--
  const state = newLinkLabelState(new Segment(start, pos + 1), isImage)
  pushLinkLabelState(pc, state)
  block.advance(1)
  return state
}

function processLinkLabel(
  parent: GNode,
  link: GNode,
  last: GNode,
  pc: Context
): void {
  const bottom = popLinkBottom(pc)
  processDelimiters(bottom, pc)
  for (let c = last.next; c !== null;) {
    const next: GNode | null = c.next
    parent.removeChild(c)
    link.appendChild(c)
    c = next
  }
}

function concatSegments(
  block: TextReader,
  segments: { length: number; at(i: number): Segment }
): Uint8Array {
  const parts: Uint8Array[] = []
  for (let i = 0; i < segments.length; i++)
    parts.push(block.value(segments.at(i)))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export function parseLinkDestination(
  block: TextReader
): [Uint8Array | null, boolean] {
  block.skipSpaces()
  const [line0] = block.peekLine()
  const line = line0 ?? new Uint8Array(0)
  if (block.peek() === 0x3c) {
    let i = 1
    while (i < line.length) {
      const c = line[i]
      if (c === 0x5c && i < line.length - 1 && isPunct(line[i + 1])) {
        i += 2
        continue
      } else if (c === 0x3e) {
        block.advance(i + 1)
        return [line.subarray(1, i), true]
      }
      i++
    }
    return [null, false]
  }
  let opened = 0
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === 0x5c && i < line.length - 1 && isPunct(line[i + 1])) {
      i += 2
      continue
    } else if (c === 0x28) {
      opened++
    } else if (c === 0x29) {
      opened--
      if (opened < 0) break
    } else if (isSpace(c)) {
      break
    }
    i++
  }
  block.advance(i)
  return [line.subarray(0, i), i !== 0]
}

function parseLinkTitle(block: TextReader): [Uint8Array | null, boolean] {
  block.skipSpaces()
  const opener = block.peek()
  if (opener !== 0x22 && opener !== 0x27 && opener !== 0x28)
    return [null, false]
  const closer = opener === 0x28 ? 0x29 : opener
  block.advance(1)
  const [segments, found] = block.findClosure(
    opener,
    closer,
    LINK_FIND_CLOSURE_OPTIONS
  )
  if (found) return [concatSegments(block, must(segments)), true]
  return [null, false]
}

function newLink(): GNode {
  return new GNode('Link')
}

function parseReferenceLink(
  parent: GNode,
  last: GNode,
  block: TextReader,
  pc: Context
): [GNode | null, boolean] {
  const [, orgpos] = block.position()
  block.advance(1) // skip '['
  const [segments, found] = block.findClosure(
    0x5b,
    0x5d,
    LINK_FIND_CLOSURE_OPTIONS
  )
  if (!found) return [null, false]
  let maybeReference = concatSegments(block, must(segments))
  if (isBlank(maybeReference)) {
    // collapsed reference link
    maybeReference = block.value(
      new Segment(last.segment.stop, orgpos.start - 1)
    )
  }
  if (maybeReference.length > 999) return [null, true]
  const ref = pc.reference(toLinkReference(maybeReference))
  if (ref === undefined) return [null, true]
  const link = newLink()
  processLinkLabel(parent, link, last, pc)
  link.title = ref.title
  link.destination = ref.destination
  return [link, true]
}

function parseLink(
  parent: GNode,
  last: GNode,
  block: TextReader,
  pc: Context
): GNode | null {
  block.advance(1) // skip '('
  block.skipSpaces()
  let title: Uint8Array | null = null
  let destination: Uint8Array | null = null
  if (block.peek() === 0x29) {
    // empty link like '[link]()'
    block.advance(1)
  } else {
    let ok: boolean
    ;[destination, ok] = parseLinkDestination(block)
    if (!ok) return null
    block.skipSpaces()
    if (block.peek() === 0x29) {
      block.advance(1)
    } else {
      ;[title, ok] = parseLinkTitle(block)
      if (!ok) return null
      block.skipSpaces()
      if (block.peek() === 0x29) block.advance(1)
      else return null
    }
  }
  const link = newLink()
  processLinkLabel(parent, link, last, pc)
  link.destination = destination
  link.title = title
  return link
}

function newImage(link: GNode): GNode {
  const c = new GNode('Image')
  c.destination = link.destination
  c.title = link.title
  for (let n = link.firstChild; n !== null;) {
    const next: GNode | null = n.next
    link.removeChild(n)
    c.appendChild(n)
    n = next
  }
  return c
}

export const linkParser: InlineParser = {
  trigger: [0x21, 0x5b, 0x5d],
  parse(parent, block, pc) {
    const [line0, segment] = block.peekLine()
    const line = must(line0)
    if (line[0] === 0x21) {
      if (line.length > 1 && line[1] === 0x5b) {
        block.advance(1)
        pushLinkBottom(pc)
        return processLinkLabelOpen(block, segment.start + 1, true, pc)
      }
      return null
    }
    if (line[0] === 0x5b) {
      pushLinkBottom(pc)
      return processLinkLabelOpen(block, segment.start, false, pc)
    }
    // line[0] == ']'
    const tlist = pc.get<GNode>(linkLabelStateKey)
    if (tlist === undefined) return null
    const last = tlist.labelLast
    if (last === null) {
      popLinkBottom(pc)
      return null
    }
    block.advance(1)
    removeLinkLabelState(pc, last)
    // CommonMark spec says: "Unmatched brackets' length is limited to 999 characters".
    if (linkLabelStateLength(tlist) > 998) {
      mergeOrReplaceTextSegment(must(last.parent), last, last.segment)
      popLinkBottom(pc)
      return null
    }
    if (!last.isImage && containsLink(last)) {
      // a link in a link text is not allowed
      mergeOrReplaceTextSegment(must(last.parent), last, last.segment)
      popLinkBottom(pc)
      return null
    }
    const c = block.peek()
    const [l, pos] = block.position()
    let link: GNode | null = null
    let hasValue = false
    if (c === 0x28) {
      // normal link
      link = parseLink(parent, last, block, pc)
    } else if (c === 0x5b) {
      // reference link
      ;[link, hasValue] = parseReferenceLink(parent, last, block, pc)
      if (link === null && hasValue) {
        mergeOrReplaceTextSegment(must(last.parent), last, last.segment)
        popLinkBottom(pc)
        return null
      }
    }
    if (link === null) {
      // maybe a shortcut reference link
      block.setPosition(l, pos)
      const ssegment = new Segment(last.segment.stop, segment.start)
      const maybeReference = block.value(ssegment)
      // CommonMark spec says: "A link label can have at most 999 characters inside the square brackets"
      if (maybeReference.length > 999) {
        mergeOrReplaceTextSegment(must(last.parent), last, last.segment)
        popLinkBottom(pc)
        return null
      }
      const ref = pc.reference(toLinkReference(maybeReference))
      if (ref === undefined) {
        mergeOrReplaceTextSegment(must(last.parent), last, last.segment)
        popLinkBottom(pc)
        return null
      }
      link = newLink()
      processLinkLabel(parent, link, last, pc)
      link.title = ref.title
      link.destination = ref.destination
    }
    const lastParent = must(last.parent)
    if (last.isImage) {
      lastParent.removeChild(last)
      return newImage(link)
    }
    lastParent.removeChild(last)
    return link
  },
  closeBlock(_parent, _block, pc) {
    pc.linkBottoms = []
    const tlist = pc.get<GNode>(linkLabelStateKey)
    if (tlist === undefined) return
    for (let s: GNode | null = tlist; s !== null;) {
      const next: GNode | null = s.labelNext
      removeLinkLabelState(pc, s)
      must(s.parent).replaceChild(s, newText(s.segment))
      s = next
    }
  },
}
