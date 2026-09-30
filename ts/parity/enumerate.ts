// Every token sequence up to a length over small alphabets of Markdown-significant tokens (inline- and block-focused),
// plus random longer sequences, compared between Go and TS.
//   npx tsx parity/enumerate.ts [maxExhaustiveLength] [randomCount]
import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'
import { mulberry32 } from './gen.js'

const INLINE = [
  '*',
  '**',
  '_',
  '__',
  '~',
  '~~',
  '`',
  '``',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '!',
  'a',
  ' ',
  '\n',
  '\\',
  '&',
  ';',
  '|',
  'http://x.io',
  'www.x.io',
  'a@b.co',
  '&amp;',
  '.',
  ':',
]
const BLOCK = [
  '#',
  '-',
  '+',
  '*',
  '1.',
  '2)',
  '>',
  ' ',
  '  ',
  '\t',
  '\n',
  '\n\n',
  'a',
  '=',
  '---',
  '|',
  ':',
  '```',
  '~~~',
  '    ',
  '[x]',
  '[ ]',
  '<div>',
  '</div>',
  '<!--',
  '-->',
  '[r]: u',
  '"t"',
  '<br>',
  '`x`',
  '[r]',
]
const maxLen = Number(process.argv[2] ?? 4)
const randomCount = Number(process.argv[3] ?? 1000000)

let bad = 0
let total = 0
async function check(
  label: string,
  inputs: string[],
  width?: number
): Promise<void> {
  const results = await runGo(inputs.map((input) => ({ input, width })))
  results.forEach((r, i) => {
    total++
    let got: string
    try {
      got = markdownToSlackMrkdwn(
        inputs[i]!,
        width === undefined ? {} : { maxTableWidth: width }
      )
    } catch (e) {
      got = `THROW ${(e as Error).message}`
    }
    if (got !== r.out) {
      bad++
      if (bad <= 20)
        console.log(
          label,
          'DIFF',
          JSON.stringify(inputs[i]),
          '\n  go',
          JSON.stringify(r.out),
          '\n  ts',
          JSON.stringify(got)
        )
    }
  })
}

async function exhaustive(label: string, alphabet: string[]): Promise<void> {
  const CHUNK = 50000
  let batch: string[] = []
  const flush = async () => {
    if (batch.length) await check(label, batch)
    batch = []
  }
  const rec = async (prefix: string, depth: number): Promise<void> => {
    if (prefix !== '') {
      batch.push(prefix)
      if (batch.length >= CHUNK) await flush()
    }
    if (depth === maxLen) return
    for (const t of alphabet) await rec(prefix + t, depth + 1)
  }
  await rec('', 0)
  await flush()
  console.log(
    `${label}: exhaustive up to ${maxLen} tokens done, ${bad} diffs so far, ${total} checked`
  )
}

async function random(
  label: string,
  alphabet: string[],
  seed: number
): Promise<void> {
  const r = mulberry32(seed)
  const CHUNK = 50000
  for (let done = 0; done < randomCount; done += CHUNK) {
    const batch: string[] = []
    for (let i = 0; i < CHUNK; i++) {
      const len = 5 + Math.floor(r() * 10)
      let s = ''
      for (let k = 0; k < len; k++)
        s += alphabet[Math.floor(r() * alphabet.length)]
      batch.push(s)
    }
    await check(label, batch, [undefined, 0, 12][Math.floor(r() * 3)])
  }
  console.log(
    `${label}: ${randomCount} random sequences done, ${bad} diffs so far, ${total} checked`
  )
}

async function main() {
  buildGo()
  await exhaustive('inline', INLINE)
  await exhaustive('block', BLOCK)
  await random('inline-random', INLINE, 1)
  await random('block-random', BLOCK, 2)
  await random('mixed-random', [...INLINE, ...BLOCK], 3)
  console.log(`enumerate: ${bad} / ${total} differ`)
}
void main()
