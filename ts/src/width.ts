import { must } from './must.js'

/**
 * Code points that render two cells wide: East Asian Wide and Fullwidth blocks
 * plus characters with default emoji presentation.
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f320],
  [0x1f32d, 0x1f335], [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440], [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567], [0x1f57a, 0x1f57a], [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7], [0x1f6dc, 0x1f6df], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]

function isWide(r: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) {
    if (r < lo) return false
    if (r <= hi) return true
  }
  return false
}

const ZERO_WIDTH_CLASS = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]$/u

/** Combining marks, format characters (ZWJ, ZWSP, tags, variation selectors) and controls occupy no cell of their own. */
const isZeroWidth = (r: number): boolean => ZERO_WIDTH_CLASS.test(String.fromCodePoint(r)) || (r >= 0x1160 && r <= 0x11ff)

const isRegionalIndicator = (r: number): boolean => r >= 0x1f1e6 && r <= 0x1f1ff

const isEmojiModifier = (r: number): boolean => r >= 0x1f3fb && r <= 0x1f3ff

/**
 * Approximates monospace cell width by grapheme cluster: a base character
 * followed by combining marks or a text/emoji variation selector, an emoji
 * with a skin-tone modifier, a flag (two regional indicators) and a ZWJ
 * sequence each take the width of their base, and a sequence that is
 * emoji-styled (VS16, modifier, keycap, flag, ZWJ) is two cells wide.
 */
export function displayWidth(s: string): number {
  const rs = Array.from(s, (ch) => must(ch.codePointAt(0)))
  let total = 0
  let i = 0
  while (i < rs.length) {
    const base = rs[i++]
    if (isZeroWidth(base)) continue
    let width = isWide(base) ? 2 : 1
    let emoji = false
    if (isRegionalIndicator(base)) {
      // a flag, or a lone letter drawn in a box
      if (i < rs.length && isRegionalIndicator(rs[i])) i++
      width = 2
      emoji = true
    }
    while (i < rs.length) {
      const r = rs[i]
      if (r === 0xfe0f || r === 0x20e3 || isEmojiModifier(r)) {
        emoji = true
      } else if (r === 0x200d && i + 1 < rs.length && !isZeroWidth(rs[i + 1])) {
        i++ // the joined character belongs to this cluster
        emoji = true
      } else if (r === 0xfe0e) {
        width = 1 // text presentation
        emoji = false
      } else if (!isZeroWidth(r)) {
        break
      }
      i++
    }
    if (emoji) width = 2
    total += width
  }
  return total
}
