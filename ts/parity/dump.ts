// Prints goldmark's tree (and ours once it exists) for inputs given as JSON strings: npx tsx parity/dump.ts '"a\nb"'
import { buildGo, runGo } from './golib.js'
import { fromJSON, link, type Node } from '../src/tree.js'
import { parseMarkdown } from '../src/parse.js'

export function compact(n: Node): string {
  const attrs: string[] = []
  if (n.v !== undefined) attrs.push(JSON.stringify(n.v))
  if (n.soft) attrs.push('soft')
  if (n.hard) attrs.push('hard')
  if (n.level) attrs.push(`L${n.level}`)
  if (n.ordered) attrs.push(`ord${n.start}`)
  if (n.k === 'List') attrs.push(`n${n.count}`)
  if (n.dest !== undefined) attrs.push(`dest=${JSON.stringify(n.dest)}`)
  if (n.email) attrs.push('email')
  if (n.checked) attrs.push('checked')
  if (n.aligns) attrs.push(n.aligns.join('/'))
  if (n.lines && n.lines.length) attrs.push(JSON.stringify(n.lines))
  const head = n.k + (attrs.length ? `<${attrs.join(' ')}>` : '')
  return n.c.length ? `${head}(${n.c.map(compact).join(' ')})` : head
}

async function main() {
  buildGo()
  const inputs = process.argv.slice(2).map((a) => JSON.parse(a) as string)
  const res = await runGo(inputs.map((input) => ({ input, ast: true })))
  inputs.forEach((input, i) => {
    console.log(JSON.stringify(input))
    console.log('  go:', compact(link(fromJSON(res[i]!.ast as never))))
    console.log('  ts:', compact(parseMarkdown(input)))
  })
}
if (process.argv[1]?.endsWith('dump.ts')) void main()
