// Runs every code point through shapes that exercise width and boundary logic, comparing Go and TS output.
//   npx tsx parity/exhaustive.ts [from] [to]
import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'

const from = Number(process.argv[2] ?? 0)
const to = Number(process.argv[3] ?? 0x110000)

const shapes: Array<(c: string) => string> = [
  (c) => `| h |\n|---|\n| ${c} |\n| a${c}b |`,
  (c) =>
    `| h |\n|:-:|\n| ${c}️ |\n| ${c}\u200d${c} |\n| ${c}́ |\n| ${c}︎ |\n| ${c}\u{1f3fd} |`,
  (c) => `${c}**b**`,
  (c) => `**b**${c}`,
  (c) => `${c}_b_${c}`,
  (c) => `a${c}~b~`,
  (c) => `*${c}*x ${c}*y*`,
  (c) => `\`x\`${c}\n${c}\`y\``,
  (c) => `[${c}](${c}) <${c}> &${c};`,
]

async function main() {
  buildGo()
  let bad = 0
  let total = 0
  const CHUNK = 20000
  for (let start = from; start < to; start += CHUNK) {
    const inputs: string[] = []
    for (let cp = start; cp < Math.min(start + CHUNK, to); cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      const c = String.fromCodePoint(cp)
      for (const shape of shapes) inputs.push(shape(c))
    }
    const results = await runGo(inputs.map((input) => ({ input, width: 0 })))
    results.forEach((r, i) => {
      total++
      const got = markdownToSlackMrkdwn(inputs[i]!, { maxTableWidth: 0 })
      if (got !== r.out) {
        bad++
        if (bad <= 15)
          console.log(
            'DIFF',
            JSON.stringify(inputs[i]),
            '\n  go',
            JSON.stringify(r.out),
            '\n  ts',
            JSON.stringify(got)
          )
      }
    })
    if (start % (CHUNK * 10) === 0)
      console.log(`... U+${start.toString(16)} ${bad} diffs so far`)
  }
  console.log(`exhaustive: ${bad} / ${total} differ`)
}
void main()
