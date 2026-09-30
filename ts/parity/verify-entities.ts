// Checks decode-named-character-reference against Go's html entity table and
// prints the names Go accepts without a semicolon (the legacy list in src/entities.ts).
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { decodeNamedCharacterReference } from 'decode-named-character-reference'

const goroot = execSync('go env GOROOT').toString().trim()
const src = readFileSync(`${goroot}/src/html/entity.go`, 'utf8')
const single = [
  ...src.matchAll(/^\s*"([A-Za-z0-9;]+)":\s*'\\[uU]([0-9A-Fa-f]{4,8})',/gm),
]
const double = [
  ...src.matchAll(
    /^\s*"([A-Za-z0-9;]+)":\s*\{'\\[uU]([0-9A-Fa-f]{4,8})', '\\[uU]([0-9A-Fa-f]{4,8})'\},/gm
  ),
]
const legacy: string[] = []
let bad = 0
const check = (name: string, want: string) => {
  if (!name.endsWith(';')) return void legacy.push(name)
  if (decodeNamedCharacterReference(name.slice(0, -1)) !== want) {
    bad++
    console.log(
      'MISMATCH',
      name,
      JSON.stringify(decodeNamedCharacterReference(name.slice(0, -1))),
      JSON.stringify(want)
    )
  }
}
for (const m of single) check(m[1]!, String.fromCodePoint(parseInt(m[2]!, 16)))
for (const m of double)
  check(m[1]!, String.fromCodePoint(parseInt(m[2]!, 16), parseInt(m[3]!, 16)))
console.log(
  'go entries',
  single.length + double.length,
  'mismatches',
  bad,
  'legacy',
  legacy.length
)
console.log(JSON.stringify(legacy.sort()))
