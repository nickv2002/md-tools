import { buildGo, goCorpus, runGo } from './golib.js'
import { fromJSON, link, type Node } from '../src/tree.js'
import { renderDocument } from '../src/render.js'

const mode = process.argv[2] ?? 'render'
const DEFAULT_WIDTH = 100

async function main() {
  buildGo()
  const inputs = goCorpus()
  console.log(`corpus: ${inputs.length} strings`)
  const results = await runGo(inputs.map((input) => ({ input, ast: true })))
  let bad = 0
  results.forEach((r, i) => {
    const root = link(fromJSON(r.ast as never)) as Node
    const got = renderDocument(root, DEFAULT_WIDTH)
    if (got !== r.out) {
      bad++
      if (bad <= 10) console.log('DIFF', JSON.stringify(inputs[i]), '\n  go :', JSON.stringify(r.out), '\n  ts :', JSON.stringify(got))
    }
  })
  console.log(`${mode}: ${bad} / ${inputs.length} differ`)
  process.exit(bad ? 1 : 0)
}
void main()
