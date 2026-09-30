import { trimLeftSpaceLength, trimRightSpaceLength } from './util.js'

/** A byte range of the source with optional tab padding (goldmark's text.Segment). Treated as an immutable value. */
export class Segment {
  constructor(
    readonly start: number,
    readonly stop: number,
    readonly padding = 0,
    readonly forceNewline = false,
  ) {}

  /** The bytes this segment stands for, padding spaces included. */
  value(buffer: Uint8Array): Uint8Array {
    let result: Uint8Array
    if (this.padding === 0) {
      result = buffer.subarray(this.start, this.stop)
    } else {
      result = new Uint8Array(this.padding + this.stop - this.start)
      result.fill(0x20, 0, this.padding)
      result.set(buffer.subarray(this.start, this.stop), this.padding)
    }
    if (this.forceNewline && result.length > 0 && result[result.length - 1] !== 0x0a) {
      const withNewline = new Uint8Array(result.length + 1)
      withNewline.set(result)
      withNewline[result.length] = 0x0a
      result = withNewline
    }
    return result
  }

  get length(): number {
    return this.stop - this.start + this.padding
  }

  /** The segment between this one and other, which must end where this one ends. */
  between(other: Segment): Segment {
    if (this.stop !== other.stop) throw new Error('invalid state')
    return new Segment(this.start, other.start, this.padding - other.padding)
  }

  isEmpty(): boolean {
    return this.start >= this.stop && this.padding === 0
  }

  trimRightSpace(buffer: Uint8Array): Segment {
    const v = buffer.subarray(this.start, this.stop)
    const l = trimRightSpaceLength(v)
    if (l === v.length) return new Segment(this.start, this.start)
    return new Segment(this.start, this.stop - l, this.padding)
  }

  trimLeftSpace(buffer: Uint8Array): Segment {
    const v = buffer.subarray(this.start, this.stop)
    return new Segment(this.start + trimLeftSpaceLength(v), this.stop)
  }

  trimLeftSpaceWidth(width: number, buffer: Uint8Array): Segment {
    let padding = this.padding
    for (; width > 0; width--) {
      if (padding === 0) break
      padding--
    }
    if (width === 0) return new Segment(this.start, this.stop, padding)
    const text = buffer.subarray(this.start, this.stop)
    let start = this.start
    for (const c of text) {
      if (start >= this.stop - 1 || width <= 0) break
      if (c === 0x20) width--
      else if (c === 0x09) width -= 4
      else break
      start++
    }
    if (width < 0) padding = width * -1
    return new Segment(start, this.stop, padding)
  }

  withStart(v: number): Segment {
    return new Segment(v, this.stop, this.padding)
  }

  withStop(v: number): Segment {
    return new Segment(this.start, v, this.padding)
  }

  withPadding(v: number): Segment {
    return new Segment(this.start, this.stop, v, this.forceNewline)
  }

  withForceNewline(v: boolean): Segment {
    return new Segment(this.start, this.stop, this.padding, v)
  }
}

/** A list of segments (goldmark's text.Segments). */
export class Segments {
  values: Segment[] = []

  append(t: Segment): void {
    this.values.push(t)
  }

  appendAll(t: Segment[]): void {
    this.values.push(...t)
  }

  get length(): number {
    return this.values.length
  }

  at(i: number): Segment {
    return this.values[i]
  }

  set(i: number, v: Segment): void {
    this.values[i] = v
  }

  setSliced(lo: number, hi: number): void {
    this.values = this.values.slice(lo, hi)
  }

  sliced(lo: number, hi: number): Segment[] {
    return this.values.slice(lo, hi)
  }

  clear(): void {
    this.values = []
  }

  unshift(v: Segment): void {
    this.values.unshift(v)
  }

  value(buffer: Uint8Array): Uint8Array {
    const parts = this.values.map((v) => v.value(buffer))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}
