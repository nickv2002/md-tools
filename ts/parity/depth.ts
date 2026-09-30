import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'
import { appendFileSync } from 'node:fs'
const log = (s: string) => appendFileSync('/tmp/depth.log', s + '\n')
buildGo()
const shapes: Record<string, (n: number) => string> = {
  emphasis: (n) => '*a **b '.repeat(n) + '** c*'.repeat(n),
  quotes: (n) => '> '.repeat(n) + 'x',
  lists: (n) => Array.from({ length: n }, (_, i) => '  '.repeat(i) + '- x').join('\n'),
  'nested brackets': (n) => '[a '.repeat(n) + 'x' + '](u)'.repeat(n),
  'strike': (n) => '~~a '.repeat(n) + 'x' + ' b~~'.repeat(n),
}
for (const [name, make] of Object.entries(shapes)) {
  for (const n of [100, 400, 1000, 3000]) {
    if (name === 'lists' || name === 'emphasis' || name === 'quotes') continue
    const input = make(n)
    let ts = 'ok'
    let out = ''
    try { out = markdownToSlackMrkdwn(input) } catch (e) { ts = (e as Error).message.slice(0, 40) }
    const [go] = await runGo([{ input }])
    log(`${name.padEnd(16)} n=${String(n).padEnd(6)} ts=${ts.padEnd(42)} go=${go!.err ?? 'ok'} same=${out === go!.out}`)
  }
}
