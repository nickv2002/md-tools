// Differential fuzzing against the Go converter.
//   npx tsx parity/fuzz.ts <tree|e2e> [seed] [count] [clusters]
import {
  type Input,
  buildGo,
  goFuzzCache,
  goldmarkCorpus,
  runGo,
  toText,
} from './golib.js'
import { fromJSON, link, type Node } from '../src/tree.js'
import { markdownToSlackMrkdwn, prepare } from '../src/index.js'
import { parseMarkdown } from '../src/parse.js'
import { firstDiff, normalize } from './compare.js'
import { compact } from './dump.js'
import { generate } from './gen.js'

const mode = process.argv[2] ?? 'tree'
const seed = Number(process.argv[3] ?? 1)
const count = Number(process.argv[4] ?? 5000)
const showClusters = Number(process.argv[5] ?? 15)

const signature = (d: string): string =>
  d
    .replace(/^[^:]*: /, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/\d+/g, 'N')

async function main() {
  buildGo()
  const inputs = generate(
    seed,
    count,
    [...goldmarkCorpus(), ...goFuzzCache()].map(toText)
  )
  const WIDTHS = [undefined, undefined, 0, 1, 8, 20, 60]
  const widths = inputs.map(
    (_, i) => WIDTHS[(i * 2654435761 + seed) % WIDTHS.length]
  )
  const results = await runGo(
    inputs.map((input, i) => ({
      input,
      width: widths[i],
      ast: mode === 'tree',
    }))
  )
  const clusters = new Map<
    string,
    { n: number; input: Input; detail: string }
  >()
  let bad = 0
  results.forEach((r, i) => {
    const input = inputs[i]!
    let key: string | null = null
    let detail = ''
    try {
      if (mode === 'tree') {
        const goTree = normalize(link(fromJSON(r.ast as never)) as Node)
        const tsTree = normalize(parseMarkdown(prepare(toText(input))))
        const d = firstDiff(goTree, tsTree)
        if (d) {
          key = signature(d)
          detail = `${d}\n    go ${compact(goTree)}\n    ts ${compact(tsTree)}`
        }
      } else {
        const got = markdownToSlackMrkdwn(
          toText(input),
          widths[i] === undefined ? {} : { maxTableWidth: widths[i]! }
        )
        if (got !== r.out) {
          const a = got.split('\n')
          const b = r.out.split('\n')
          const at = a.findIndex((l, j) => l !== b[j])
          key = `line ${Math.min(at, 9)}`
          detail = `go ${JSON.stringify(r.out)}\n    ts ${JSON.stringify(got)}`
        }
      }
    } catch (e) {
      key = `THROW ${(e as Error).message.slice(0, 80)}`
      detail = String((e as Error).stack).slice(0, 400)
    }
    if (key !== null) {
      bad++
      const c = clusters.get(key)
      if (!c) clusters.set(key, { n: 1, input, detail })
      else {
        c.n++
        if (input.length < c.input.length) {
          c.input = input
          c.detail = detail
        }
      }
    }
  })
  const sorted = [...clusters.entries()].sort((a, b) => b[1].n - a[1].n)
  for (const [key, c] of sorted.slice(0, showClusters))
    console.log(
      `\n[${c.n}x] ${key}\n  input ${JSON.stringify(typeof c.input === 'string' ? c.input : Buffer.from(c.input).toString('latin1'))}\n    ${c.detail}`
    )
  console.log(
    `\n${mode} seed=${seed}: ${bad} / ${inputs.length} differ in ${clusters.size} clusters`
  )
}
void main()
