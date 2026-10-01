import {
  GNode,
  type DelimiterProcessor,
  isParagraph,
  mergeOrAppendTextSegment,
  mergeOrReplaceTextSegment,
  walk,
} from './ast.js'
import { BlockReader, SourceReader, type TextReader } from './reader.js'
import { Segment } from './segment.js'
import {
  isPunct,
  isSpace,
  isBlank,
  indentWidth,
  isSpaceRune,
  isPunctRune,
  toRune,
} from './util.js'
import { must } from '../must.js'

/** Go slice semantics (shared backing array, length, capacity), which goldmark's opened-block bookkeeping depends on. */
export class GoSlice<T> {
  constructor(
    readonly arr: T[],
    readonly len: number,
    readonly cap: number
  ) {}

  static empty<T>(): GoSlice<T> {
    return new GoSlice<T>([], 0, 0)
  }

  at(i: number): T {
    if (i < 0 || i >= this.len) throw new Error('index out of range')
    return this.arr[i]
  }

  slice(lo: number, hi: number): GoSlice<T> {
    if (lo < 0 || hi < lo || hi > this.cap)
      throw new Error('slice bounds out of range')
    return new GoSlice(this.arr, hi - lo, this.cap - lo).rebase(lo)
  }

  // Slices here always start at 0, which is all goldmark uses.
  private rebase(lo: number): GoSlice<T> {
    if (lo !== 0) throw new Error('unsupported slice offset')
    return this
  }

  append(...items: T[]): GoSlice<T> {
    const newLen = this.len + items.length
    if (newLen <= this.cap) {
      for (let i = 0; i < items.length; i++) this.arr[this.len + i] = items[i]
      return new GoSlice(this.arr, newLen, this.cap)
    }
    let newCap = this.cap * 2
    if (newLen > newCap) newCap = newLen
    const arr = this.arr.slice(0, this.len)
    for (let i = 0; i < items.length; i++) arr[this.len + i] = items[i]
    return new GoSlice(arr, newLen, newCap)
  }

  toArray(): T[] {
    return this.arr.slice(0, this.len)
  }
}

export interface Block {
  node: GNode | null
  parser: BlockParser | null
}

export interface Reference {
  label: Uint8Array
  destination: Uint8Array
  title: Uint8Array | null
}

export const State = {
  None: 1,
  Continue: 2,
  Close: 4,
  HasChildren: 8,
  NoChildren: 16,
  RequireParagraph: 32,
} as const

export interface BlockParser {
  trigger: number[] | null
  open(parent: GNode, reader: TextReader, pc: Context): [GNode | null, number]
  continue(node: GNode, reader: TextReader, pc: Context): number
  close(node: GNode, reader: TextReader, pc: Context): void
  canInterruptParagraph: boolean
  canAcceptIndentedLine: boolean
}

export interface InlineParser {
  trigger: number[]
  parse(parent: GNode, block: TextReader, pc: Context): GNode | null
  closeBlock?(parent: GNode, block: TextReader, pc: Context): void
}

export interface ParagraphTransformer {
  transform(node: GNode, reader: TextReader, pc: Context): void
}

export interface ASTTransformer {
  transform(node: GNode, reader: TextReader, pc: Context): void
}

export const contextKey = (name: string): symbol => Symbol(name)
export const linkLabelStateKey = contextKey('linkLabelState')

/** The state shared by the parsers of one document. */
export class Context {
  private store = new Map<symbol, unknown>()
  private refs = new Map<string, Reference>()
  blockOffset = -1
  blockIndent = -1
  delimiters: GNode | null = null
  lastDelimiter: GNode | null = null
  /** Link bottoms: a delimiter, or null for goldmark's typed-nil pointer when none was pending. Empty means nil. */
  linkBottoms: Array<GNode | null> = []
  private opened: GoSlice<Block> = GoSlice.empty<Block>()

  get<T>(key: symbol): T | undefined {
    return this.store.get(key) as T | undefined
  }

  set(key: symbol, value: unknown): void {
    if (value === undefined || value === null) this.store.delete(key)
    else this.store.set(key, value)
  }

  computeIfAbsent<T>(key: symbol, f: () => T): T {
    let v = this.store.get(key) as T | undefined
    if (v === undefined) {
      v = f()
      this.store.set(key, v)
    }
    return v
  }

  addReference(label: string, ref: Reference): void {
    if (!this.refs.has(label)) this.refs.set(label, ref)
  }

  reference(label: string): Reference | undefined {
    return this.refs.get(label)
  }

  openedBlocks(): GoSlice<Block> {
    return this.opened
  }

  setOpenedBlocks(v: GoSlice<Block>): void {
    this.opened = v
  }

  lastOpenedBlock(): Block {
    return this.opened.len !== 0
      ? this.opened.at(this.opened.len - 1)
      : { node: null, parser: null }
  }

  isInLinkLabel(): boolean {
    return this.store.has(linkLabelStateKey)
  }

  pushDelimiter(d: GNode): void {
    if (this.delimiters === null) {
      this.delimiters = d
      this.lastDelimiter = d
    } else {
      const l = must(this.lastDelimiter)
      this.lastDelimiter = d
      l.nextDelimiter = d
      d.previousDelimiter = l
    }
  }

  removeDelimiter(d: GNode): void {
    if (d.previousDelimiter === null) {
      this.delimiters = d.nextDelimiter
    } else {
      d.previousDelimiter.nextDelimiter = d.nextDelimiter
      if (d.nextDelimiter !== null)
        d.nextDelimiter.previousDelimiter = d.previousDelimiter
    }
    if (d.nextDelimiter === null) this.lastDelimiter = d.previousDelimiter
    if (this.delimiters !== null) this.delimiters.previousDelimiter = null
    if (this.lastDelimiter !== null) this.lastDelimiter.nextDelimiter = null
    d.nextDelimiter = null
    d.previousDelimiter = null
    if (d.length !== 0) mergeOrReplaceTextSegment(must(d.parent), d, d.segment)
    else must(d.parent).removeChild(d)
  }

  clearDelimiters(bottom: GNode | null | undefined): void {
    if (this.lastDelimiter === null) return
    let c: GNode | null = this.lastDelimiter
    while (c !== null && c !== bottom) {
      const prev: GNode | null = c.prev
      if (c.kind === 'Delimiter') this.removeDelimiter(c)
      c = prev
    }
  }
}

export function newDelimiter(
  canOpen: boolean,
  canClose: boolean,
  length: number,
  char: number,
  processor: DelimiterProcessor
): GNode {
  const d = new GNode('Delimiter')
  d.canOpen = canOpen
  d.canClose = canClose
  d.length = length
  d.originalLength = length
  d.char = char
  d.processor = processor
  return d
}

export function consumeCharacters(d: GNode, n: number): void {
  d.length -= n
  d.segment = d.segment.withStop(d.segment.start + d.length)
}

export function calcConsumption(d: GNode, closer: GNode): number {
  if (
    (d.canClose || closer.canOpen) &&
    (d.originalLength + closer.originalLength) % 3 === 0 &&
    closer.originalLength % 3 !== 0
  )
    return 0
  if (d.length >= 2 && closer.length >= 2) return 2
  return 1
}

/** ScanDelimiter: reads a run of delimiter characters at the start of line and works out whether it can open or close emphasis. */
export function scanDelimiter(
  line: Uint8Array,
  before: number,
  minimum: number,
  processor: DelimiterProcessor
): GNode | null {
  const i = 0
  const c = line[i]
  let j = i
  if (!processor.isDelimiter(c)) return null
  for (; j < line.length && c === line[j]; j++);
  if (j - i >= minimum) {
    let after = 0x20
    if (j !== line.length) after = toRune(line, j)
    const beforeIsPunctuation = isPunctRune(before)
    const beforeIsWhitespace = isSpaceRune(before)
    const afterIsPunctuation = isPunctRune(after)
    const afterIsWhitespace = isSpaceRune(after)
    const isLeft =
      !afterIsWhitespace &&
      (!afterIsPunctuation || beforeIsWhitespace || beforeIsPunctuation)
    const isRight =
      !beforeIsWhitespace &&
      (!beforeIsPunctuation || afterIsWhitespace || afterIsPunctuation)
    let canOpen: boolean
    let canClose: boolean
    if (line[i] === 0x5f) {
      canOpen = isLeft && (!isRight || beforeIsPunctuation)
      canClose = isRight && (!isLeft || afterIsPunctuation)
    } else {
      canOpen = isLeft
      canClose = isRight
    }
    return newDelimiter(canOpen, canClose, j - i, c, processor)
  }
  return null
}

/**
 * ProcessDelimiters. bottom is undefined for a nil interface and null for the
 * typed-nil delimiter goldmark stores when a link opens with no delimiter
 * pending; the two take different paths there.
 */
export function processDelimiters(
  bottom: GNode | null | undefined,
  pc: Context
): void {
  const lastDelimiter = pc.lastDelimiter
  if (lastDelimiter === null) return
  let closer: GNode | null = null
  if (bottom !== undefined) {
    if (bottom !== lastDelimiter) {
      for (
        let c: GNode | null = lastDelimiter.prev;
        c !== null && c !== bottom;
      ) {
        if (c.kind === 'Delimiter') closer = c
        c = c.prev
      }
    }
  } else {
    closer = pc.delimiters
  }
  if (closer === null) {
    pc.clearDelimiters(bottom)
    return
  }
  while (closer !== null) {
    if (!closer.canClose) {
      closer = closer.nextDelimiter
      continue
    }
    let consume = 0
    let found = false
    let maybeOpener = false
    let opener: GNode | null
    for (
      opener = closer.previousDelimiter;
      opener !== null && opener !== bottom;
      opener = opener.previousDelimiter
    ) {
      if (
        opener.canOpen &&
        must(opener.processor).canOpenCloser(opener, closer)
      ) {
        maybeOpener = true
        consume = calcConsumption(opener, closer)
        if (consume > 0) {
          found = true
          break
        }
      }
    }
    if (!found) {
      const next: GNode | null = closer.nextDelimiter
      if (!maybeOpener && !closer.canOpen) pc.removeDelimiter(closer)
      closer = next
      continue
    }
    const op = must(opener)
    consumeCharacters(op, consume)
    consumeCharacters(closer, consume)
    const node = must(op.processor).onMatch(consume)
    const parent = must(op.parent)
    let child = op.next
    while (child !== null && child !== closer) {
      const next: GNode | null = child.next
      node.appendChild(child)
      child = next
    }
    parent.insertAfter(op, node)
    for (let c = op.nextDelimiter; c !== null && c !== closer;) {
      const next: GNode | null = c.nextDelimiter
      pc.removeDelimiter(c)
      c = next
    }
    if (op.length === 0) pc.removeDelimiter(op)
    if (closer.length === 0) {
      const next: GNode | null = closer.nextDelimiter
      pc.removeDelimiter(closer)
      closer = next
    }
  }
  pc.clearDelimiters(bottom)
}

interface LineStat {
  lineNum: number
  level: number
  isBlank: boolean
}

function isBlankLine(
  lineNum: number,
  level: number,
  stats: LineStat[]
): boolean {
  const l = stats.length
  if (l === 0) return true
  for (let i = l - 1 - level; i >= 0; i--) {
    const s = stats[i]
    if (s.lineNum === lineNum && s.level <= level) return s.isBlank
    else if (s.lineNum < lineNum) break
  }
  return false
}

const paragraphContinuation = 1
const newBlocksOpened = 2
const noBlocksOpened = 3

const LINE_BREAK_HARD = 1
const LINE_BREAK_SOFT = 2
const LINE_BREAK_VISIBLE = 4

export interface ParserConfig {
  blockParsers: Array<{ parser: BlockParser; priority: number }>
  inlineParsers: Array<{ parser: InlineParser; priority: number }>
  paragraphTransformers: Array<{
    parser: ParagraphTransformer
    priority: number
  }>
  astTransformers: Array<{ parser: ASTTransformer; priority: number }>
}

const byPriority = <T extends { priority: number }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.priority - b.priority)

export class Parser {
  private blockParsers: Array<BlockParser[] | null> = Array.from(
    { length: 256 },
    () => null
  )
  private freeBlockParsers: BlockParser[] = []
  private inlineParsers: Array<InlineParser[] | null> = Array.from(
    { length: 256 },
    () => null
  )
  private closeBlockers: InlineParser[] = []
  private paragraphTransformers: ParagraphTransformer[]
  private astTransformers: ASTTransformer[]

  constructor(config: ParserConfig) {
    for (const { parser } of byPriority(config.blockParsers)) {
      if (parser.trigger === null) this.freeBlockParsers.push(parser)
      else
        for (const tc of parser.trigger)
          (this.blockParsers[tc] ??= []).push(parser)
    }
    for (const list of this.blockParsers) list?.push(...this.freeBlockParsers)
    for (const { parser } of byPriority(config.inlineParsers)) {
      if (parser.closeBlock) this.closeBlockers.push(parser)
      for (const tc of parser.trigger)
        (this.inlineParsers[tc] ??= []).push(parser)
    }
    this.paragraphTransformers = byPriority(config.paragraphTransformers).map(
      (p) => p.parser
    )
    this.astTransformers = byPriority(config.astTransformers).map(
      (p) => p.parser
    )
  }

  parse(source: Uint8Array): GNode {
    const reader = new SourceReader(source)
    const pc = new Context()
    const root = new GNode('Document')
    this.parseBlocks(root, reader, pc)
    const blockReader = new BlockReader(source)
    this.walkBlock(root, (node) => this.parseBlock(blockReader, node, pc))
    for (const at of this.astTransformers) at.transform(root, reader, pc)
    return root
  }

  private transformParagraph(
    node: GNode,
    reader: TextReader,
    pc: Context
  ): boolean {
    for (const pt of this.paragraphTransformers) {
      pt.transform(node, reader, pc)
      if (node.parent === null) return true
    }
    return false
  }

  private closeBlocks(
    from: number,
    to: number,
    reader: TextReader,
    pc: Context
  ): void {
    let blocks = pc.openedBlocks()
    for (let i = from; i >= to; i--) {
      const node = must(blocks.at(i).node)
      if (node.kind === 'Paragraph' && node.parent !== null)
        this.transformParagraph(node, reader, pc)
      if (node.parent !== null)
        must(blocks.at(i).parser).close(must(blocks.at(i).node), reader, pc) // closes only if node has not been transformed
    }
    if (from === blocks.len - 1) {
      blocks = blocks.slice(0, to)
    } else {
      const tail: Block[] = []
      for (let k = from + 1; k < blocks.len; k++) tail.push(blocks.at(k))
      blocks = blocks.slice(0, to).append(...tail)
    }
    pc.setOpenedBlocks(blocks)
  }

  private openBlocks(
    parentIn: GNode,
    blankLine: boolean,
    reader: TextReader,
    pc: Context
  ): number {
    let parent = parentIn
    let result = noBlocksOpened
    let continuable = false
    let lastBlock = pc.lastOpenedBlock()
    if (lastBlock.node !== null) continuable = isParagraph(lastBlock.node)
    for (;;) {
      let again = false
      const [line] = reader.peekLine()
      const [w, pos] = indentWidth(
        line ?? new Uint8Array(0),
        reader.lineOffset()
      )
      if (w >= (line?.length ?? 0)) {
        pc.blockOffset = -1
        pc.blockIndent = -1
      } else {
        pc.blockOffset = pos
        pc.blockIndent = w
      }
      if (line === null || line[0] === 0x0a) break
      let bps: BlockParser[] | null = this.freeBlockParsers
      if (pos < line.length)
        bps = this.blockParsers[line[pos]] ?? this.freeBlockParsers
      for (const bp of bps) {
        if (
          continuable &&
          result === noBlocksOpened &&
          !bp.canInterruptParagraph
        )
          continue
        if (w > 3 && !bp.canAcceptIndentedLine) continue
        lastBlock = pc.lastOpenedBlock()
        const last = lastBlock.node
        const [node, state] = bp.open(parent, reader, pc)
        if (node !== null) {
          if ((state & State.RequireParagraph) !== 0) {
            if (last === parent.lastChild) {
              must(lastBlock.parser).close(must(last), reader, pc)
              const blocks = pc.openedBlocks()
              pc.setOpenedBlocks(blocks.slice(0, blocks.len - 1))
              if (this.transformParagraph(must(last), reader, pc)) {
                continuable = false
                again = true
                break
              }
            }
          }
          node.blankPreviousLines = blankLine
          if (last?.parent === null) {
            const lastPos = pc.openedBlocks().len - 1
            this.closeBlocks(lastPos, lastPos, reader, pc)
          }
          parent.appendChild(node)
          result = newBlocksOpened
          pc.setOpenedBlocks(pc.openedBlocks().append({ node, parser: bp }))
          if ((state & State.HasChildren) !== 0) {
            parent = node
            again = true // try child block
          }
          break // with no children, no more blocks can open on this line
        }
      }
      if (!again) break
    }
    if (result === noBlocksOpened && continuable) {
      const state = must(lastBlock.parser).continue(
        must(lastBlock.node),
        reader,
        pc
      )
      if ((state & State.Continue) !== 0) result = paragraphContinuation
    }
    return result
  }

  private parseBlocks(parent: GNode, reader: TextReader, pc: Context): void {
    pc.setOpenedBlocks(GoSlice.empty<Block>())
    const blankLines: LineStat[] = []
    for (;;) {
      // process blocks separated by blank lines
      const [, , ok] = reader.skipBlankLines()
      if (!ok) return
      if (this.openBlocks(parent, true, reader, pc) !== newBlocksOpened) return
      reader.advanceLine()
      blankLines.length = 0
      for (;;) {
        // process opened blocks line by line
        const openedBlocks = pc.openedBlocks()
        const l = openedBlocks.len
        if (l === 0) break
        let lastIndex = l - 1
        for (let i = 0; i < l; i++) {
          const be = openedBlocks.at(i)
          const [line] = reader.peekLine()
          if (line === null) {
            this.closeBlocks(lastIndex, 0, reader, pc)
            reader.advanceLine()
            return
          }
          const [lineNum] = reader.position()
          blankLines.push({ lineNum, level: i, isBlank: isBlank(line) })
          // A paragraph's continuation is decided by openBlocks, so it is not processed here.
          if (!isParagraph(be.node)) {
            const state = must(be.parser).continue(must(be.node), reader, pc)
            if ((state & State.Continue) !== 0) {
              // A container block with no children yet may open a new child.
              if ((state & State.HasChildren) !== 0 && i === lastIndex) {
                const blank = isBlankLine(lineNum - 1, i + 1, blankLines)
                this.openBlocks(must(be.node), blank, reader, pc)
                break
              }
              continue
            }
          }
          // The current node may be closed or continued lazily.
          const blank = isBlankLine(lineNum - 1, i, blankLines)
          const thisParent =
            i !== 0 ? must(openedBlocks.at(i - 1).node) : parent
          const lastNode = openedBlocks.at(lastIndex).node
          const result = this.openBlocks(thisParent, blank, reader, pc)
          if (result !== paragraphContinuation) {
            // lastNode is a paragraph and was transformed by the paragraph transformers.
            if (openedBlocks.at(lastIndex).node !== lastNode) lastIndex--
            this.closeBlocks(lastIndex, i, reader, pc)
          }
          break
        }
        reader.advanceLine()
      }
    }
  }

  /** Post-order walk (children before their parent), without recursion. */
  private walkBlock(root: GNode, cb: (node: GNode) => void): void {
    const stack = [{ node: root, child: root.firstChild }]
    while (stack.length > 0) {
      const top = must(stack[stack.length - 1])
      if (top.child === null) {
        stack.pop()
        cb(top.node)
        const parent = stack[stack.length - 1]
        if (parent) parent.child = must(parent.child).next
      } else {
        stack.push({ node: top.child, child: top.child.firstChild })
      }
    }
  }

  private parseBlock(block: BlockReader, parent: GNode, pc: Context): void {
    if (parent.isRaw) return
    let escaped = false
    const source = block.source()
    block.reset(parent.lines)
    for (;;) {
      const [line] = block.peekLine()
      if (line === null) break
      let lineLength = line.length
      let lineBreakFlags = 0
      const hasNewLine = line[lineLength - 1] === 0x0a
      if (
        ((lineLength >= 3 &&
          line[lineLength - 2] === 0x5c &&
          line[lineLength - 3] !== 0x5c) ||
          (lineLength === 2 && line[lineLength - 2] === 0x5c)) &&
        hasNewLine
      ) {
        lineLength -= 2
        lineBreakFlags |= LINE_BREAK_HARD | LINE_BREAK_VISIBLE
      } else if (
        ((lineLength >= 4 &&
          line[lineLength - 3] === 0x5c &&
          line[lineLength - 2] === 0x0d &&
          line[lineLength - 4] !== 0x5c) ||
          (lineLength === 3 &&
            line[lineLength - 3] === 0x5c &&
            line[lineLength - 2] === 0x0d)) &&
        hasNewLine
      ) {
        lineLength -= 3
        lineBreakFlags |= LINE_BREAK_HARD | LINE_BREAK_VISIBLE
      } else if (
        lineLength >= 3 &&
        line[lineLength - 3] === 0x20 &&
        line[lineLength - 2] === 0x20 &&
        hasNewLine
      ) {
        lineLength -= 3
        lineBreakFlags |= LINE_BREAK_HARD
      } else if (
        lineLength >= 4 &&
        line[lineLength - 4] === 0x20 &&
        line[lineLength - 3] === 0x20 &&
        line[lineLength - 2] === 0x0d &&
        hasNewLine
      ) {
        lineLength -= 4
        lineBreakFlags |= LINE_BREAK_HARD
      } else if (hasNewLine) {
        lineBreakFlags |= LINE_BREAK_SOFT
      }
      const [l, startPositionIn] = block.position()
      let startPosition = startPositionIn
      let n = 0
      let restart = false
      for (let i = 0; i < lineLength && !restart; i++) {
        const c = line[i]
        if (c === 0x0a) break
        const spaceChar = isSpace(c) && c !== 0x0d && c !== 0x0a
        const punct = isPunct(c)
        if ((punct && !escaped) || spaceChar || i === 0) {
          let parserChar = c
          if (spaceChar || (i === 0 && !punct)) parserChar = 0x20
          const ips = this.inlineParsers[parserChar]
          if (ips) {
            block.advance(n)
            n = 0
            const [savedLine, savedPosition] = block.position()
            if (i !== 0) {
              const [, currentPosition] = block.position()
              mergeOrAppendTextSegment(
                parent,
                startPosition.between(currentPosition)
              )
              startPosition = block.position()[1]
            }
            let inlineNode: GNode | null = null
            for (const ip of ips) {
              inlineNode = ip.parse(parent, block, pc)
              if (inlineNode !== null) break
              block.setPosition(savedLine, savedPosition)
            }
            if (inlineNode !== null) {
              parent.appendChild(inlineNode)
              restart = true
              continue
            }
          }
        }
        if (escaped) {
          escaped = false
          n++
          continue
        }
        if (c === 0x5c) {
          escaped = true
          n++
          continue
        }
        escaped = false
        n++
      }
      if (restart) continue
      if (n !== 0) block.advance(n)
      const [currentL, currentPosition] = block.position()
      if (l !== currentL) continue
      const diff = startPosition.between(currentPosition)
      const text =
        (lineBreakFlags & (LINE_BREAK_HARD | LINE_BREAK_VISIBLE)) ===
        (LINE_BREAK_HARD | LINE_BREAK_VISIBLE)
          ? diff
          : diff.trimRightSpace(source)
      const node = new GNode('Text')
      node.segment = text
      node.soft = (lineBreakFlags & LINE_BREAK_SOFT) !== 0
      node.hard = (lineBreakFlags & LINE_BREAK_HARD) !== 0
      parent.appendChild(node)
      block.advanceLine()
    }
    processDelimiters(undefined, pc)
    for (const ip of this.closeBlockers) ip.closeBlock?.(parent, block, pc)
  }
}

export { walk, Segment }
