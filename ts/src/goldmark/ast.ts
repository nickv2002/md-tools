import { Segment, Segments } from './segment.js'
import { must } from '../must.js'

export type GKind =
  | 'Document' | 'Paragraph' | 'TextBlock' | 'Heading' | 'ThematicBreak' | 'CodeBlock' | 'FencedCodeBlock' | 'Blockquote' | 'List' | 'ListItem' | 'HTMLBlock'
  | 'Text' | 'CodeSpan' | 'Emphasis' | 'Link' | 'Image' | 'AutoLink' | 'RawHTML'
  | 'Strikethrough' | 'TaskCheckBox' | 'Table' | 'TableHeader' | 'TableRow' | 'TableCell'
  | 'Delimiter' | 'LinkLabelState'

export type Alignment = 'left' | 'right' | 'center' | 'none'

export interface DelimiterProcessor {
  isDelimiter(b: number): boolean
  canOpenCloser(opener: GNode, closer: GNode): boolean
  onMatch(consumes: number): GNode
}

/** A goldmark AST node. One class carries the fields of every node kind; only the ones a kind uses are set. */
export class GNode {
  parent: GNode | null = null
  prev: GNode | null = null
  next: GNode | null = null
  firstChild: GNode | null = null
  lastChild: GNode | null = null
  childCount = 0

  // blocks
  lines = new Segments()
  blankPreviousLines = false
  level = 0 // Heading, Emphasis
  marker = 0 // List
  isTight = true // List
  start = 0 // List
  offset = 0 // ListItem
  htmlBlockType = 0
  closureLine: Segment = new Segment(-1, -1)
  info: GNode | null = null // FencedCodeBlock
  alignments: Alignment[] = [] // Table, TableRow
  alignment: Alignment = 'none' // TableCell

  // inlines
  segment: Segment = new Segment(0, 0) // Text, Delimiter, LinkLabelState
  soft = false
  hard = false
  raw = false
  destination: Uint8Array | null = null // Link, Image
  title: Uint8Array | null = null
  autoLinkType: 'email' | 'url' = 'url'
  protocol: Uint8Array | null = null
  value: GNode | null = null // AutoLink
  segments = new Segments() // RawHTML
  isChecked = false // TaskCheckBox

  // delimiters
  canOpen = false
  canClose = false
  length = 0
  originalLength = 0
  char = 0
  previousDelimiter: GNode | null = null
  nextDelimiter: GNode | null = null
  processor: DelimiterProcessor | null = null

  // link label state
  isImage = false
  labelPrev: GNode | null = null
  labelNext: GNode | null = null
  labelFirst: GNode | null = null
  labelLast: GNode | null = null

  constructor(readonly kind: GKind) {}

  get isRaw(): boolean {
    if (this.kind === 'Text') return this.raw
    return this.kind === 'CodeBlock' || this.kind === 'FencedCodeBlock' || this.kind === 'HTMLBlock'
  }

  hasChildren(): boolean {
    return this.firstChild !== null
  }

  private ensureIsolated(v: GNode): void {
    if (v.parent) v.parent.removeChild(v)
  }

  appendChild(v: GNode): void {
    this.ensureIsolated(v)
    if (this.firstChild === null) {
      this.firstChild = v
      v.next = null
      v.prev = null
    } else {
      const last = must(this.lastChild)
      last.next = v
      v.prev = last
    }
    v.parent = this
    this.lastChild = v
    this.childCount++
  }

  removeChild(v: GNode): void {
    if (v.parent !== this) return
    this.childCount--
    const prev = v.prev
    const next = v.next
    if (prev) prev.next = next
    else this.firstChild = next
    if (next) next.prev = prev
    else this.lastChild = prev
    v.parent = null
    v.prev = null
    v.next = null
  }

  replaceChild(v1: GNode, insertee: GNode): void {
    this.insertBefore(v1, insertee)
    this.removeChild(v1)
  }

  insertAfter(v1: GNode, insertee: GNode): void {
    this.insertBefore(v1.next, insertee)
  }

  /** Mirrors goldmark, including its child count bump when appending through a nil reference. */
  insertBefore(v1: GNode | null, insertee: GNode): void {
    this.childCount++
    if (v1 === null) {
      this.appendChild(insertee)
      return
    }
    this.ensureIsolated(insertee)
    if (v1.parent === this) {
      const prev = v1.prev
      if (prev) {
        prev.next = insertee
        insertee.prev = prev
      } else {
        this.firstChild = insertee
        insertee.prev = null
      }
      insertee.next = v1
      v1.prev = insertee
      insertee.parent = this
    }
  }
}

export function newText(segment: Segment): GNode {
  const n = new GNode('Text')
  n.segment = segment
  return n
}

export function newRawText(segment: Segment): GNode {
  const n = newText(segment)
  n.raw = true
  return n
}

/** ast.MergeOrAppendTextSegment */
export function mergeOrAppendTextSegment(parent: GNode, s: Segment): void {
  const last = parent.lastChild
  if (last?.kind === 'Text' && last.segment.stop === s.start && !last.soft) last.segment = last.segment.withStop(s.stop)
  else parent.appendChild(newText(s))
}

/** ast.MergeOrReplaceTextSegment */
export function mergeOrReplaceTextSegment(parent: GNode, n: GNode, s: Segment): void {
  const prev = n.prev
  if (prev?.kind === 'Text' && prev.segment.stop === s.start && !prev.soft) {
    prev.segment = prev.segment.withStop(s.stop)
    parent.removeChild(n)
  } else {
    parent.replaceChild(n, newText(s))
  }
}

export const isParagraph = (n: GNode | null | undefined): boolean => !!n && n.kind === 'Paragraph'

export function walk(n: GNode, walker: (n: GNode, entering: boolean) => 'stop' | 'skip' | 'continue'): void {
  walkHelper(n, walker)
}

function walkHelper(n: GNode, walker: (n: GNode, entering: boolean) => 'stop' | 'skip' | 'continue'): 'stop' | 'continue' {
  const status = walker(n, true)
  if (status === 'stop') return 'stop'
  if (status !== 'skip') {
    for (let c = n.firstChild; c; c = c.next) if (walkHelper(c, walker) === 'stop') return 'stop'
  }
  return walker(n, false) === 'stop' ? 'stop' : 'continue'
}
