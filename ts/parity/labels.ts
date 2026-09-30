// Link reference labels are matched after Unicode case folding; compare Go and TS for every code point.
import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'

async function main() {
  buildGo()
  const inputs: string[] = []
  for (let cp = 0x20; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    const c = String.fromCodePoint(cp)
    for (const variant of new Set([c.toUpperCase(), c.toLowerCase(), c.toUpperCase().toLowerCase(), c.toLowerCase().toUpperCase()])) {
      if (variant === c) continue
      inputs.push(`[x${c}y]: https://x.io/a\n\n[X${variant}Y] [x${c}y][] [x${variant}y]`)
    }
  }
  for (const [a, b] of [['ß', 'SS'], ['ẞ', 'ss'], ['ß', 'ẞ'], ['İ', 'i̇'], ['ǅ', 'ǆ'], ['ς', 'Σ'], ['ﬁ', 'FI'], ['ŉ', 'ʼN'], ['ǰ', 'J̌'], ['ΐ', 'ΐ']]) inputs.push(`[${a}]: /u\n\n[${b}]`)
  let bad = 0
  const CHUNK = 20000
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const slice = inputs.slice(i, i + CHUNK)
    const results = await runGo(slice.map((input) => ({ input })))
    results.forEach((r, j) => {
      const got = markdownToSlackMrkdwn(slice[j]!)
      if (got !== r.out) {
        bad++
        if (bad <= 12) console.log('DIFF', JSON.stringify(slice[j]), '\n  go', JSON.stringify(r.out), '\n  ts', JSON.stringify(got))
      }
    })
  }
  console.log(`labels: ${bad} / ${inputs.length} differ`)
}
void main()
