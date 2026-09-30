import { decodeNamedCharacterReference } from 'decode-named-character-reference'

// Go's unicode.IsSpace set. JavaScript's \s and trim() also match U+FEFF, which Go keeps.
const SPACE_CLASS = '\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const SPACE_RUN = new RegExp(`[${SPACE_CLASS}]+`, 'u')
const LEADING_SPACE = new RegExp(`^[${SPACE_CLASS}]+`, 'u')
const TRAILING_SPACE = new RegExp(`[${SPACE_CLASS}]+$`, 'u')

export const isSpace = (cp: number): boolean =>
  (cp >= 0x09 && cp <= 0x0d) || cp === 0x20 || cp === 0x85 || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) ||
  cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000

export const trimSpace = (s: string): string => s.replace(LEADING_SPACE, '').replace(TRAILING_SPACE, '')

/** strings.Fields: split on Unicode white space, dropping empty fields. */
export const fields = (s: string): string[] => s.split(SPACE_RUN).filter((f) => f !== '')

/** strings.Join(strings.Fields(s), " ") */
export const collapseUnicodeSpace = (s: string): string => fields(s).join(' ')

export function firstCodePoint(s: string): number {
  return s.codePointAt(0) ?? 0
}

export function lastCodePoint(s: string): number {
  const last = s.charCodeAt(s.length - 1)
  if (last >= 0xdc00 && last <= 0xdfff && s.length > 1) {
    const hi = s.charCodeAt(s.length - 2)
    if (hi >= 0xd800 && hi <= 0xdbff) return (hi - 0xd800) * 0x400 + (last - 0xdc00) + 0x10000
  }
  return last
}

/** strings.TrimRight(s, cutset) for a cutset of BMP characters. */
export function trimRight(s: string, cutset: string): string {
  let end = s.length
  while (end > 0 && cutset.includes(s.charAt(end - 1))) end--
  return s.slice(0, end)
}

const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
export const isASCIIPunct = (c: string): boolean => c.length === 1 && ASCII_PUNCT.includes(c)

const ENTITY_REF = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y

// Names Go's html package accepts without the closing semicolon.
const LEGACY = new Set(
  'AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml'.split(' '),
)

// The only two names decode-named-character-reference knows that Go's table lacks.
const NOT_IN_GO = new Set(['nGt', 'nLt'])

// html.UnescapeString's table for numeric references 0x80-0x9f (Windows-1252).
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019,
  0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
]

/**
 * html.UnescapeString for one match of ENTITY_REF, including Go's quirk of
 * decoding the longest legacy prefix ("&notit;" becomes "¬it;").
 */
function unescapeEntity(m: string): string {
  if (m.charAt(1) === '#') {
    const hex = m.charAt(2) === 'x' || m.charAt(2) === 'X'
    let x = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
    if (x >= 0x80 && x <= 0x9f) x = CP1252[x - 0x80]!
    else if (x === 0 || (x >= 0xd800 && x <= 0xdfff) || x > 0x10ffff) x = 0xfffd
    return String.fromCodePoint(x)
  }
  const name = m.slice(1, -1)
  const exact = NOT_IN_GO.has(name) ? false : decodeNamedCharacterReference(name)
  if (exact !== false) return exact
  for (let j = Math.min(name.length, 6); j > 1; j--) {
    if (LEGACY.has(name.slice(0, j))) return decodeNamedCharacterReference(name.slice(0, j)) + name.slice(j) + ';'
  }
  return m
}

/**
 * Resolves Markdown backslash escapes and HTML entities in a raw text segment.
 * With neutralize, an escaped *, _, ~ or ` keeps Slack from reading it as
 * markup, since mrkdwn has no backslash escape.
 */
export function unescapeText(s: string, neutralize: boolean): string {
  if (!s.includes('\\') && !s.includes('&')) return s
  let out = ''
  for (let i = 0; i < s.length; ) {
    const c = s.charAt(i)
    if (c === '\\' && i + 1 < s.length && isASCIIPunct(s.charAt(i + 1))) {
      const next = s.charAt(i + 1)
      if (neutralize && next === '*') {
        // A zero-width space does not stop Slack bolding *x*; the asterisk operator looks the same and is inert.
        out += '∗'
      } else if (neutralize && next === '`') {
        out += 'ˋ' // same stand-in used for backticks inside code spans
      } else {
        if (neutralize && (next === '_' || next === '~')) out += '\u200b'
        out += next
      }
      i += 2
      continue
    }
    if (c === '&') {
      ENTITY_REF.lastIndex = i
      const m = ENTITY_REF.exec(s)
      if (m) {
        const u = unescapeEntity(m[0])
        if (u !== m[0]) {
          out += u
          i += m[0].length
          continue
        }
      }
    }
    out += c
    i++
  }
  return out
}
