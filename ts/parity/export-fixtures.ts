// Writes test/fixtures.json: inputs with the Go converter's output, so the TS converter can be tested without Go.
//   npx tsx parity/export-fixtures.ts
import { writeFileSync } from 'node:fs'
import {
  buildGo,
  goCorpus,
  goFuzzCache,
  goldmarkCorpus,
  runGo,
  toText,
} from './golib.js'
import { generate } from './gen.js'

const MAX_LENGTH = 500

async function main() {
  buildGo()
  const seen = new Set<string>()
  const cases: Array<{ in: string; w?: number }> = []
  const add = (input: string, w?: number): void => {
    if (
      input.length > MAX_LENGTH ||
      seen.has(`${w}:${input}`) ||
      input.includes('\ufffd')
    )
      return
    seen.add(`${w}:${input}`)
    cases.push(w === undefined ? { in: input } : { in: input, w })
  }
  for (const b of goCorpus()) add(toText(b))
  for (const b of goldmarkCorpus()) add(toText(b))
  for (const b of goFuzzCache()) add(toText(b))
  const pool = goldmarkCorpus().map(toText)
  for (const input of generate(2024, 1500, pool))
    if (typeof input === 'string') add(input)
  // The same tables at several widths, since the width limit changes the layout.
  for (const c of [...cases])
    if (/^\s*\|/m.test(c.in)) for (const w of [0, 1, 20]) add(c.in, w)
  const results = await runGo(cases.map((c) => ({ input: c.in, width: c.w })))
  const fixtures = cases.map((c, i) => ({ ...c, out: results[i]!.out }))
  writeFileSync(
    new URL('../test/fixtures.json', import.meta.url),
    JSON.stringify(fixtures)
  )
  console.log(`wrote ${fixtures.length} fixtures`)
}
void main()
