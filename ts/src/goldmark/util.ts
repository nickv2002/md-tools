// Byte-level helpers ported from goldmark's util package. The parser works on
// UTF-8 bytes (Uint8Array), exactly as goldmark does, so offsets and ASCII
// classification behave identically.

export const NEWLINE = 0x0a
export const EOF = 0xff

const PUNCT = new Set([...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'].map((c) => c.charCodeAt(0)))

export const isPunct = (c: number): boolean => PUNCT.has(c)
/** goldmark's IsSpace: space, tab, newline and carriage return only. */
export const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d
export const isNumeric = (c: number): boolean => c >= 0x30 && c <= 0x39
export const isHexDecimal = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46)
export const isAlphaNumeric = (c: number): boolean => (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)

const SPACES_TRIM = new Set([0x20, 0x09, 0x0a, 0x0b, 0x0c, 0x0d])

export function isBlank(bs: Uint8Array): boolean {
  for (let i = 0; i < bs.length; i++) if (!isSpace(bs[i]!)) return false
  return true
}

export const tabWidth = (currentPos: number): number => 4 - (currentPos % 4)

/** IndentPositionPadding: where an indent of the given width ends, and how much of a tab is left over. */
export function indentPositionPadding(bs: Uint8Array, currentPos: number, paddingv: number, width: number): [number, number] {
  if (width === 0) return [0, paddingv]
  let w = 0
  let i = 0
  const l = bs.length
  let p = paddingv
  for (; i < l; i++) {
    if (p > 0) {
      p--
      w++
      continue
    }
    if (bs[i] === 0x09 && w < width) w += tabWidth(currentPos + w)
    else if (bs[i] === 0x20 && w < width) w++
    else break
  }
  if (w >= width) return [i - paddingv, w - width]
  return [-1, -1]
}

export const indentPosition = (bs: Uint8Array, currentPos: number, width: number): [number, number] => indentPositionPadding(bs, currentPos, 0, width)

/** IndentWidth: the visual width of the leading whitespace and the number of bytes it takes. */
export function indentWidth(bs: Uint8Array, currentPos: number): [number, number] {
  let width = 0
  let pos = 0
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i]!
    if (b === 0x20) {
      width++
      pos++
    } else if (b === 0x09) {
      width += tabWidth(currentPos + width)
      pos++
    } else break
  }
  return [width, pos]
}

export function firstNonSpacePosition(bs: Uint8Array): number {
  for (let i = 0; i < bs.length; i++) {
    const c = bs[i]!
    if (c === 0x20 || c === 0x09) continue
    if (c === 0x0a) return -1
    return i
  }
  return -1
}

export function trimLeftLength(source: Uint8Array, chars: readonly number[]): number {
  let i = 0
  while (i < source.length && chars.includes(source[i]!)) i++
  return i
}

export function trimRightLength(source: Uint8Array, chars: readonly number[]): number {
  let i = source.length - 1
  while (i >= 0 && chars.includes(source[i]!)) i--
  return source.length - (i + 1)
}

export function trimLeftSpaceLength(source: Uint8Array): number {
  let i = 0
  while (i < source.length && isSpace(source[i]!)) i++
  return i
}

export function trimRightSpaceLength(source: Uint8Array): number {
  const l = source.length
  let i = l - 1
  while (i >= 0 && isSpace(source[i]!)) i--
  return i < 0 ? l : l - 1 - i
}

/** TrimLeftSpace/TrimRightSpace use the wider set that also has \v and \f. */
export function trimSpaceWide(source: Uint8Array): Uint8Array {
  let a = 0
  let b = source.length
  while (a < b && SPACES_TRIM.has(source[a]!)) a++
  while (b > a && SPACES_TRIM.has(source[b - 1]!)) b--
  return source.subarray(a, b)
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const encoder = new TextEncoder()
export const bytesToString = (b: Uint8Array): string => decoder.decode(b)
export const stringToBytes = (s: string): Uint8Array => encoder.encode(s)

/** The bytes as a string with one char per byte, so regular expressions see byte offsets. */
export function latin1(b: Uint8Array): string {
  let out = ''
  for (let i = 0; i < b.length; i += 8192) out += String.fromCharCode(...b.subarray(i, Math.min(i + 8192, b.length)))
  return out
}

export const isRuneStart = (b: number): boolean => (b & 0xc0) !== 0x80

/** utf8.DecodeRune: [rune, size]; invalid input yields [0xfffd, 1]. */
export function decodeRune(b: Uint8Array, i = 0): [number, number] {
  const n = b.length - i
  if (n <= 0) return [0xfffd, 0]
  const b0 = b[i]!
  if (b0 < 0x80) return [b0, 1]
  const cont = (k: number): number => (i + k < b.length && (b[i + k]! & 0xc0) === 0x80 ? b[i + k]! & 0x3f : -1)
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    const c1 = cont(1)
    if (c1 >= 0) return [((b0 & 0x1f) << 6) | c1, 2]
  } else if (b0 >= 0xe0 && b0 <= 0xef) {
    const c1 = cont(1)
    const c2 = cont(2)
    const lo = b0 === 0xe0 ? 0xa0 : 0x80
    const hi = b0 === 0xed ? 0x9f : 0xbf
    if (c1 >= 0 && c2 >= 0 && b[i + 1]! >= lo && b[i + 1]! <= hi) return [((b0 & 0x0f) << 12) | (c1 << 6) | c2, 3]
  } else if (b0 >= 0xf0 && b0 <= 0xf4) {
    const c1 = cont(1)
    const c2 = cont(2)
    const c3 = cont(3)
    const lo = b0 === 0xf0 ? 0x90 : 0x80
    const hi = b0 === 0xf4 ? 0x8f : 0xbf
    if (c1 >= 0 && c2 >= 0 && c3 >= 0 && b[i + 1]! >= lo && b[i + 1]! <= hi) return [((b0 & 0x07) << 18) | (c1 << 12) | (c2 << 6) | c3, 4]
  }
  return [0xfffd, 1]
}

/** util.ToRune: decode the rune that contains the byte at pos. */
export function toRune(source: Uint8Array, pos: number): number {
  let i = pos
  for (; i >= 0; i--) if (isRuneStart(source[i]!)) break
  return decodeRune(source, Math.max(i, 0))[0]
}

const PUNCT_RUNE = /^[\p{P}\p{S}]$/u
const SPACE_RUNE_CLASS = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u

/** unicode.IsSymbol(r) || unicode.IsPunct(r) */
export const isPunctRune = (r: number): boolean => r <= 0x10ffff && r >= 0 && !(r >= 0xd800 && r <= 0xdfff) && PUNCT_RUNE.test(String.fromCodePoint(r))

/** r <= 256 && IsSpace(byte(r)) || unicode.IsSpace(r) */
export const isSpaceRune = (r: number): boolean => (r <= 256 && isSpace(r)) || (r >= 0 && r <= 0x10ffff && SPACE_RUNE_CLASS.test(String.fromCodePoint(r)))

/** FindURLIndex: stop index of [A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]* at the start of b, or -1. */
export function findURLIndex(b: Uint8Array): number {
  let i = 0
  const schemeStart = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
  const schemeRest = (c: number): boolean => schemeStart(c) || (c >= 0x30 && c <= 0x39) || c === 0x2e || c === 0x2b || c === 0x2d
  if (!(b.length > 0 && schemeStart(b[0]!))) return -1
  i++
  for (; i < b.length; i++) if (!schemeRest(b[i]!)) break
  if (i === 1 || i > 33 || i >= b.length) return -1
  if (b[i] !== 0x3a) return -1
  i++
  for (; i < b.length; i++) {
    const c = b[i]!
    if (c <= 0x20 || c === 0x3c || c === 0x3e) break
  }
  return i
}

const EMAIL_LOCAL = new Set([...'.!#$%&\'*+/=?^_`{|}~-'].map((c) => c.charCodeAt(0)))
const isEmailLocal = (c: number): boolean => isAlphaNumeric(c) || EMAIL_LOCAL.has(c)
const EMAIL_DOMAIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/

/** FindEmailIndex: stop index if b starts like an email address, or -1. */
export function findEmailIndex(b: Uint8Array): number {
  let i = 0
  for (; i < b.length; i++) if (!isEmailLocal(b[i]!)) break
  if (i === 0) return -1
  if (i >= b.length || b[i] !== 0x40) return -1
  i++
  if (i >= b.length) return -1
  const m = EMAIL_DOMAIN.exec(latin1(b.subarray(i)))
  if (!m) return -1
  return i + m[0].length
}

/** ToLinkReference: case-folds, trims and collapses white space so link labels compare equal. */
export function toLinkReference(v: Uint8Array): string {
  const folded = foldCase(bytesToString(trimSpaceWide(v)))
  let out = ''
  let inSpace = false
  for (const ch of folded) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (!inSpace) out += ' '
      inSpace = true
    } else {
      out += ch
      inSpace = false
    }
  }
  return out
}

function foldCase(s: string): string {
  return s.toLowerCase().toUpperCase().toLowerCase()
}
