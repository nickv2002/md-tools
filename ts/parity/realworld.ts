// Runs real Markdown files found on disk through both converters.
//   npx tsx parity/realworld.ts <root>... [--max N]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'
import { decodeUtf8Lossy } from '../src/gotext.js'

const args = process.argv.slice(2)
const maxIdx = args.indexOf('--max')
const max = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 20000
const roots = args.filter(
  (a, i) => !a.startsWith('--') && args[i - 1] !== '--max'
)

function* walk(dir: string): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === '.git') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (/\.(md|markdown|mdx)$/i.test(e.name)) yield p
  }
}

async function main() {
  buildGo()
  const files: Buffer[] = []
  for (const root of roots)
    for (const f of walk(root)) {
      try {
        if (statSync(f).size <= 300_000) files.push(readFileSync(f))
      } catch {
        // unreadable file
      }
      if (files.length >= max) break
    }
  console.log(`${files.length} files`)
  let bad = 0
  let throws = 0
  let bytes = 0
  const CHUNK = 200
  for (let i = 0; i < files.length; i += CHUNK) {
    const slice = files.slice(i, i + CHUNK)
    const results = await runGo(slice.map((input) => ({ input })))
    results.forEach((r, j) => {
      const input = slice[j]!
      bytes += input.length
      let got: string
      try {
        got = markdownToSlackMrkdwn(decodeUtf8Lossy(input))
      } catch (e) {
        throws++
        console.log(
          'THROW file index',
          i + j,
          input.length,
          'bytes:',
          (e as Error).message,
          '| go output',
          r.out.length,
          'chars | head',
          JSON.stringify(input.subarray(0, 60).toString())
        )
        return
      }
      if (got !== r.out) {
        bad++
        if (bad <= 5) {
          const a = got.split('\n')
          const b = r.out.split('\n')
          const at = a.findIndex((l, k) => l !== b[k])
          console.log(
            'DIFF file index',
            i + j,
            'first differing line',
            at,
            '\n  go',
            JSON.stringify(b[at]),
            '\n  ts',
            JSON.stringify(a[at])
          )
        }
      }
    })
  }
  console.log(
    `realworld: ${throws} threw, ${bad} / ${files.length} differ (${(bytes / 1e6).toFixed(1)} MB of Markdown)`
  )
}
void main()
