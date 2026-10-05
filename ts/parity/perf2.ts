import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'

const shapes: Record<string, (n: number) => string> = {
  'deep list': (n) =>
    Array.from({ length: n }, (_, i) => '  '.repeat(i) + '- x').join('\n'),
  emails: (n) => 'a@b.co '.repeat(n),
  'long para': (n) => 'word *em* `code` [l](https://x.io) '.repeat(n),
  'quote lines': (n) =>
    Array.from({ length: n }, () => '> line **b**').join('\n'),
  'nested quotes': (n) => '> '.repeat(n) + 'x',
  'list items': (n) =>
    Array.from({ length: n }, (_, i) => `- item ${i} *x*`).join('\n'),
  'loose list': (n) =>
    Array.from({ length: n }, (_, i) => `- item ${i}\n`).join('\n'),
  'table rows': (n) =>
    '| a | b |\n|---|---|\n' + '| 1 | [l](https://x.io) |\n'.repeat(n),
  brackets: (n) => '[a '.repeat(n) + ']'.repeat(n),
  emph: (n) => '*a **b '.repeat(n) + '** c*'.repeat(n),
}
async function main() {
  buildGo()
  for (const [name, make] of Object.entries(shapes)) {
    if (process.argv[2] && process.argv[2] !== name) continue
    for (const n of [500, 2000]) {
      const input = make(n)
      const t0 = performance.now()
      await runGo([{ input }])
      const tGo = performance.now() - t0
      const t1 = performance.now()
      markdownToSlackMrkdwn(input)
      const tTs = performance.now() - t1
      console.log(
        `${name.padEnd(14)} n=${String(n).padEnd(5)} chars=${String(input.length).padEnd(7)} go ${tGo.toFixed(0).padStart(5)}ms (incl. process start)  ts ${tTs.toFixed(0).padStart(5)}ms`
      )
    }
  }
}
void main()
