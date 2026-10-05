// Compares Unicode classification tables (Go's unicode package vs this runtime) over every code point.
import { execFileSync } from 'node:child_process'
import { buildGo, tsRoot } from './golib.js'
import { isPunctRune, isSpaceRune } from '../src/goldmark/util.js'
import { isSpace as goSpace } from '../src/gotext.js'
import { displayWidth } from '../src/width.js'

buildGo()
const go = Buffer.from(
  execFileSync(`${tsRoot}/.cache/godump`, ['classes'], {
    maxBuffer: 1 << 26,
  }).toString(),
  'base64'
)
const zero = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]$/u
let bad = 0
const report = (what: string, cp: number, want: boolean) => {
  bad++
  if (bad <= 40)
    console.log(`${what} U+${cp.toString(16)} go=${want} ts=${!want}`)
}
for (let cp = 0; cp < 0x110000; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue
  const mask = go[cp]!
  if (isPunctRuneLocal(cp) !== ((mask & 1) !== 0))
    report('punct/symbol', cp, (mask & 1) !== 0)
  if (goSpace(cp) !== ((mask & 2) !== 0)) report('space', cp, (mask & 2) !== 0)
  if (zero.test(String.fromCodePoint(cp)) !== ((mask & 4) !== 0))
    report('zero-width', cp, (mask & 4) !== 0)
}
function isPunctRuneLocal(cp: number): boolean {
  return isPunctRune(cp)
}
void isSpaceRune
void displayWidth
console.log(
  `${bad} differences over ${0x110000 - 0x800} code points (node ${process.version}, unicode ${process.versions.unicode})`
)
