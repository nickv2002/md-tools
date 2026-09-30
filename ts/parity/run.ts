import { buildGo, goCorpus, goldmarkCorpus, runGo } from './golib.js'
import { fromJSON, link, type Node } from '../src/tree.js'
import { renderDocument } from '../src/render.js'
import { markdownToSlackMrkdwn, prepare } from '../src/index.js'
import { parseMarkdown } from '../src/parse.js'
import { firstDiff, normalize } from './compare.js'
import { compact } from './dump.js'

const mode = process.argv[2] ?? 'e2e'
const limit = Number(process.argv[3] ?? 10)
const DEFAULT_WIDTH = 100

async function main() {
  buildGo()
  const inputs = process.argv[4] === 'goldmark' ? goldmarkCorpus() : goCorpus()
  console.log(`corpus: ${inputs.length} strings`)
  const results = await runGo(inputs.map((input) => ({ input, ast: true })))
  let bad = 0
  results.forEach((r, i) => {
    const input = inputs[i]!
    let detail: string | null = null
    try {
    if (mode === 'render') {
      const got = renderDocument(link(fromJSON(r.ast as never)) as Node, DEFAULT_WIDTH)
      if (got !== r.out) detail = `go ${JSON.stringify(r.out)}\n  ts ${JSON.stringify(got)}`
    } else if (mode === 'tree') {
      const goTree = normalize(link(fromJSON(r.ast as never)) as Node)
      const source = prepare(input)
      const d = firstDiff(goTree, normalize(parseMarkdown(source)))
      if (d) detail = `${d}\n  go tree ${compact(goTree)}\n  ts tree ${compact(normalize(parseMarkdown(source)))}`
    } else {
      const got = markdownToSlackMrkdwn(input)
      if (got !== r.out) detail = `go ${JSON.stringify(r.out)}\n  ts ${JSON.stringify(got)}`
    }
    } catch (e) {
      detail = `THROW ${(e as Error).stack?.split('\n').slice(0, 4).join(' | ')}`
    }
    if (detail) {
      bad++
      if (bad <= limit) console.log('DIFF', JSON.stringify(input), '\n  ' + detail)
    }
  })
  console.log(`${mode}: ${bad} / ${inputs.length} differ`)
  process.exit(bad ? 1 : 0)
}
void main()
