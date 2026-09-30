import { Segment, Segments } from './segment.js'
import { EOF, decodeRune, isBlank, isPunct, isRuneStart, isSpace, latin1, tabWidth } from './util.js'

const INVALID = -1

export interface FindClosureOptions {
  codeSpan?: boolean
  nesting?: boolean
  newline?: boolean
  advance?: boolean
}

/** goldmark's text.Reader, for both whole-source and block (segment list) readers. */
export interface TextReader {
  source(): Uint8Array
  peek(): number
  peekLine(): [Uint8Array | null, Segment]
  precedingCharacter(): number
  value(seg: Segment): Uint8Array
  lineOffset(): number
  position(): [number, Segment]
  setPosition(line: number, pos: Segment): void
  setPadding(n: number): void
  advance(n: number): void
  advanceAndSetPadding(n: number, padding: number): void
  advanceToEOL(): void
  advanceLine(): void
  skipSpaces(): [Segment, number, boolean]
  skipBlankLines(): [Segment, number, boolean]
  match(reg: RegExp): boolean
  findClosure(opener: number, closer: number, opts: FindClosureOptions): [Segments | null, boolean]
}

interface Pos {
  start: number
  stop: number
  padding: number
}

const seg = (p: Pos): Segment => new Segment(p.start, p.stop, p.padding)

abstract class BaseReader implements TextReader {
  protected pos: Pos = { start: 0, stop: 0, padding: 0 }
  protected line = -1
  protected head = 0
  protected cachedLineOffset = -1

  constructor(protected src: Uint8Array) {}

  abstract peek(): number
  abstract peekLine(): [Uint8Array | null, Segment]
  abstract precedingCharacter(): number
  abstract value(s: Segment): Uint8Array
  abstract advance(n: number): void
  abstract advanceToEOL(): void
  abstract advanceLine(): void
  abstract setPosition(line: number, pos: Segment): void
  abstract match(reg: RegExp): boolean

  source(): Uint8Array {
    return this.src
  }

  lineOffset(): number {
    if (this.cachedLineOffset < 0) {
      let v = 0
      for (let i = this.head; i < this.pos.start; i++) {
        if (this.src[i] === 0x09) v += tabWidth(v)
        else v++
      }
      this.cachedLineOffset = v - this.pos.padding
    }
    return this.cachedLineOffset
  }

  position(): [number, Segment] {
    return [this.line, seg(this.pos)]
  }

  setPadding(v: number): void {
    this.cachedLineOffset = -1
    this.pos.padding = v
  }

  advanceAndSetPadding(n: number, padding: number): void {
    this.advance(n)
    if (padding > this.pos.padding) this.setPadding(padding)
  }

  skipSpaces(): [Segment, number, boolean] {
    let chars = 0
    for (;;) {
      const [line, segment] = this.peekLine()
      if (line === null) return [segment, chars, false]
      for (let i = 0; i < line.length; i++) {
        if (isSpace(line[i]!)) {
          chars++
          this.advance(1)
          continue
        }
        return [segment.withStart(segment.start + i + 1), chars, true]
      }
    }
  }

  skipBlankLines(): [Segment, number, boolean] {
    let lines = 0
    for (;;) {
      const [line, segment] = this.peekLine()
      if (line === null) return [segment, lines, false]
      if (isBlank(line)) {
        lines++
        this.advanceLine()
      } else {
        return [segment, lines, true]
      }
    }
  }

  findClosure(opener: number, closer: number, opts: FindClosureOptions): [Segments | null, boolean] {
    let opened = 1
    let codeSpanOpener = 0
    let closed = false
    const [orgline, orgpos] = this.position()
    let ret: Segments | null = null
    outer: for (;;) {
      const [bs, segment] = this.peekLine()
      if (bs === null) break
      let i = 0
      while (i < bs.length) {
        const c = bs[i]!
        if (opts.codeSpan && codeSpanOpener !== 0 && c === 0x60) {
          let codeSpanCloser = 0
          for (; i < bs.length; i++) {
            if (bs[i] === 0x60) codeSpanCloser++
            else {
              i--
              break
            }
          }
          if (codeSpanCloser === codeSpanOpener) codeSpanOpener = 0
        } else if (codeSpanOpener === 0 && c === 0x5c && i < bs.length - 1 && isPunct(bs[i + 1]!)) {
          i += 2
          continue
        } else if (opts.codeSpan && codeSpanOpener === 0 && c === 0x60) {
          for (; i < bs.length; i++) {
            if (bs[i] === 0x60) codeSpanOpener++
            else {
              i--
              break
            }
          }
        } else if ((opts.codeSpan && codeSpanOpener === 0) || !opts.codeSpan) {
          if (c === closer) {
            opened--
            if (opened === 0) {
              ret ??= new Segments()
              ret.append(segment.withStop(segment.start + i))
              this.advance(i + 1)
              closed = true
              break outer
            }
          } else if (c === opener) {
            if (!opts.nesting) break outer
            opened++
          }
        }
        i++
      }
      if (!opts.newline) break
      this.advanceLine()
      ret ??= new Segments()
      ret.append(segment)
    }
    if (!opts.advance) this.setPosition(orgline, orgpos)
    return closed ? [ret, true] : [null, false]
  }
}

/** Reads the whole source line by line. */
export class SourceReader extends BaseReader {
  private peekedLine: Uint8Array | null = null

  constructor(source: Uint8Array) {
    super(source)
    this.head = 0
    this.line = -1
    this.cachedLineOffset = -1
    this.advanceLine()
  }

  /** Offset of the next newline relative to from, or -1. */
  private newlineFrom(from: number): number {
    const at = this.src.indexOf(0x0a, from)
    return at === -1 ? -1 : at - from
  }

  peek(): number {
    if (this.pos.start >= 0 && this.pos.start < this.src.length) {
      if (this.pos.padding !== 0) return 0x20
      return this.src[this.pos.start]!
    }
    return EOF
  }

  peekLine(): [Uint8Array | null, Segment] {
    if (this.pos.start >= 0 && this.pos.start < this.src.length) {
      this.peekedLine ??= seg(this.pos).value(this.src)
      return [this.peekedLine, seg(this.pos)]
    }
    return [null, seg(this.pos)]
  }

  value(s: Segment): Uint8Array {
    return s.value(this.src)
  }

  precedingCharacter(): number {
    if (this.pos.start <= 0) return this.pos.padding !== 0 ? 0x20 : 0x0a
    let i = this.pos.start - 1
    for (; i >= 0; i--) if (isRuneStart(this.src[i]!)) break
    return decodeRune(this.src, i)[0]
  }

  advance(n: number): void {
    this.cachedLineOffset = -1
    if (this.peekedLine !== null && n < this.peekedLine.length && this.pos.padding === 0) {
      this.pos.start += n
      this.peekedLine = null
      return
    }
    this.peekedLine = null
    const l = this.src.length
    for (; n > 0 && this.pos.start < l; n--) {
      if (this.pos.padding !== 0) {
        this.pos.padding--
        continue
      }
      if (this.src[this.pos.start] === 0x0a) {
        this.advanceLine()
        continue
      }
      this.pos.start++
    }
  }

  advanceToEOL(): void {
    if (this.pos.start >= this.src.length) return
    this.cachedLineOffset = -1
    let i = -1
    if (this.peekedLine !== null) {
      this.pos.start += this.peekedLine.length - this.pos.padding - 1
      if (this.src[this.pos.start] === 0x0a) i = 0
    }
    if (i === -1) i = this.newlineFrom(this.pos.start)
    this.peekedLine = null
    if (i !== -1) this.pos.start += i
    else this.pos.start = this.src.length
    this.pos.padding = 0
  }

  advanceLine(): void {
    this.cachedLineOffset = -1
    this.peekedLine = null
    this.pos.start = this.pos.stop
    this.head = this.pos.start
    if (this.pos.start < 0 || this.pos.start >= this.src.length) return
    this.pos.stop = this.src.length
    let i = 0
    if (this.src[this.pos.start] !== 0x0a) i = this.newlineFrom(this.pos.start)
    if (i !== -1) this.pos.stop = this.pos.start + i + 1
    this.line++
    this.pos.padding = 0
  }

  setPosition(line: number, pos: Segment): void {
    this.cachedLineOffset = -1
    this.line = line
    this.pos = { start: pos.start, stop: pos.stop, padding: pos.padding }
  }

  match(_reg: RegExp): boolean {
    throw new Error('match is only used with block readers')
  }
}

/** Reads the lines of one block, given as segments of the source. */
export class BlockReader extends BaseReader {
  private segments = new Segments()
  private last = 0

  constructor(source: Uint8Array, segments?: Segments) {
    super(source)
    if (segments) this.reset(segments)
  }

  private get segmentsLength(): number {
    return this.segments.length
  }

  reset(segments: Segments): void {
    this.segments = segments
    this.resetPosition()
  }

  private resetPosition(): void {
    this.line = -1
    this.head = 0
    this.last = 0
    this.cachedLineOffset = -1
    this.pos = { start: -1, stop: -1, padding: 0 }
    if (this.segmentsLength > 0) this.last = this.segments.at(this.segmentsLength - 1).stop
    this.advanceLine()
  }

  value(s: Segment): Uint8Array {
    let line = this.segmentsLength - 1
    const ret: number[] = []
    for (; line >= 0; line--) if (s.start >= this.segments.at(line).start) break
    let i = s.start
    for (; line < this.segmentsLength; line++) {
      const cur = this.segments.at(line)
      if (i < 0) i = cur.start
      for (let k = 0; k < cur.padding; k++) ret.push(0x20)
      for (; i < s.stop && i < cur.stop; i++) ret.push(this.src[i]!)
      i = -1
      if (cur.stop > s.stop) break
    }
    return Uint8Array.from(ret)
  }

  precedingCharacter(): number {
    if (this.pos.padding !== 0) return 0x20
    if (this.segments.length < 1) return 0x0a
    const first = this.segments.at(0)
    if (this.line === 0 && this.pos.start <= first.start) return 0x0a
    const l = this.src.length
    let i = this.pos.start - 1
    for (; i < l && i >= 0; i--) if (isRuneStart(this.src[i]!)) break
    if (i < 0 || i >= l) return 0x0a
    return decodeRune(this.src, i)[0]
  }

  peek(): number {
    if (this.line < this.segmentsLength && this.pos.start >= 0 && this.pos.start < this.last) {
      if (this.pos.padding !== 0) return 0x20
      return this.src[this.pos.start]!
    }
    return EOF
  }

  peekLine(): [Uint8Array | null, Segment] {
    if (this.line < this.segmentsLength && this.pos.start >= 0 && this.pos.start < this.last) return [seg(this.pos).value(this.src), seg(this.pos)]
    return [null, seg(this.pos)]
  }

  advance(n: number): void {
    this.cachedLineOffset = -1
    if (n < this.pos.stop - this.pos.start && this.pos.padding === 0) {
      this.pos.start += n
      return
    }
    for (; n > 0; n--) {
      if (this.pos.padding !== 0) {
        this.pos.padding--
        continue
      }
      if (this.pos.start >= this.pos.stop - 1 && this.pos.stop < this.last) {
        this.advanceLine()
        continue
      }
      this.pos.start++
    }
  }

  advanceToEOL(): void {
    this.cachedLineOffset = -1
    this.pos.padding = 0
    const c = this.src[this.pos.stop - 1]
    this.pos.start = c === 0x0a ? this.pos.stop - 1 : this.pos.stop
  }

  advanceLine(): void {
    this.setPosition(this.line + 1, new Segment(INVALID, INVALID))
    this.head = this.pos.start
  }

  setPosition(line: number, pos: Segment): void {
    this.cachedLineOffset = -1
    this.line = line
    if (pos.start === INVALID) {
      if (this.line < this.segmentsLength) {
        const s = this.segments.at(line)
        this.head = s.start
        this.pos = { start: s.start, stop: s.stop, padding: s.padding }
      }
    } else {
      this.pos = { start: pos.start, stop: pos.stop, padding: pos.padding }
      if (this.line < this.segmentsLength) this.head = this.segments.at(line).start
    }
  }

  /** Matches reg, which must be anchored at the start, against the rest of the block and advances past the match. */
  match(reg: RegExp): boolean {
    const [oldLine, oldSeg] = this.position()
    const stream = this.stream()
    this.setPosition(oldLine, oldSeg)
    const m = reg.exec(stream)
    if (!m || m.index !== 0) return false
    this.advance(m[0].length)
    return true
  }

  /** The remaining bytes of the block as one byte-per-char string, cut where Go's rune reader would stop at an invalid rune. */
  private stream(): string {
    const parts: Uint8Array[] = []
    const [line] = this.peekLine()
    if (line !== null) {
      parts.push(line)
      for (let k = this.line + 1; k < this.segmentsLength; k++) parts.push(this.segments.at(k).value(this.src))
    }
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      all.set(p, at)
      at += p.length
    }
    for (let i = 0; i < all.length; ) {
      const [r, size] = decodeRune(all, i)
      if (r === 0xfffd) return latin1(all.subarray(0, i))
      i += size
    }
    return latin1(all)
  }
}
