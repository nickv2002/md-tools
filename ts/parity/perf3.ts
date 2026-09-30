import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'
buildGo()
const mk = (n: number) => Array.from({ length: n }, (_, i) => '  '.repeat(i) + '- x').join('\n')
for (const n of [50, 100, 200, 300]) {
  const input = mk(n)
  const t0 = performance.now()
  await runGo([{ input }])
  const tGo = performance.now() - t0
  const t1 = performance.now()
  try { markdownToSlackMrkdwn(input) } catch (e) { console.log('ts threw', (e as Error).message) }
  console.log(`deep list n=${n} chars=${input.length} go ${tGo.toFixed(0)}ms ts ${(performance.now() - t1).toFixed(0)}ms`)
}
