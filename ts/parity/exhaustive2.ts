// Entities (every name, prefixes, every numeric reference) and random sequences of width-relevant code points.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { buildGo, runGo } from './golib.js'
import { markdownToSlackMrkdwn } from '../src/index.js'
import { generateSequences } from './seq.js'

const goroot = execSync('go env GOROOT').toString().trim()
const names = [...readFileSync(`${goroot}/src/html/entity.go`, 'utf8').matchAll(/^\s*"([A-Za-z0-9;]+)":/gm)].map((m) => m[1]!.replace(/;$/, ''))

async function check(label: string, inputs: string[], width?: number): Promise<number> {
  let bad = 0
  const CHUNK = 20000
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const slice = inputs.slice(i, i + CHUNK)
    const results = await runGo(slice.map((input) => ({ input, width })))
    results.forEach((r, j) => {
      const got = markdownToSlackMrkdwn(slice[j]!, width === undefined ? {} : { maxTableWidth: width })
      if (got !== r.out) {
        bad++
        if (bad <= 10) console.log(label, 'DIFF', JSON.stringify(slice[j]), '\n  go', JSON.stringify(r.out), '\n  ts', JSON.stringify(got))
      }
    })
  }
  console.log(`${label}: ${bad} / ${inputs.length} differ`)
  return bad
}

async function main() {
  buildGo()
  const entityInputs: string[] = []
  for (const n of names) {
    entityInputs.push(`a &${n}; b`, `a &${n} b`, `&${n};x`, `[l](https://x.io/?q=&${n};)`, `\`&${n};\``)
    for (let k = 1; k < Math.min(n.length, 8); k++) entityInputs.push(`&${n.slice(0, k)}; &${n.slice(0, k)}z;`)
  }
  for (const n of ['amp', 'lt', 'gt', 'quot', 'notit', 'copyx', 'ampx', 'ltgt', 'AMPERSAND', 'nbsp', 'shy']) for (const tail of [';', 'x;', '1;', ';;']) entityInputs.push(`&${n}${tail}`)
  await check('entities', entityInputs)
  const numeric: string[] = []
  for (let n = 0; n < 0x110100; n += 1) numeric.push(`&#${n}; &#x${n.toString(16)}; &#X${n.toString(16).toUpperCase()};`)
  for (const s of ['&#;', '&#x;', '&#xZ;', '&#12345678;', '&#x1234567;', '&#0000000065;', '&# 65;', '&#65', '&#x41', '&#-1;', '&#1_0;']) numeric.push(s, `a${s}b`)
  await check('numeric', numeric)
  const seqs = generateSequences(400000, 7)
  const tables = seqs.map((s) => `| h | x |\n|:-:|--:|\n| ${s} | ${s}${s} |\n| a | ${s.slice(0, 1)} |`)
  await check('width sequences', tables, 0)
  await check('span boundaries', seqs.map((s) => `${s}**b**${s}_c_~d~${s}\`e\`${s}`))
}
void main()
