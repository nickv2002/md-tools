import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { decodeUtf8Lossy } from '../src/gotext.js'

export const tsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const repoRoot = resolve(tsRoot, '..')
const bin = resolve(tsRoot, '.cache/godump')

export function buildGo(): void {
  execFileSync(
    'go',
    ['build', '-tags', 'slackdump', '-o', bin, './scripts/ts-parity/godump'],
    { cwd: repoRoot, stdio: 'inherit' }
  )
  if (!existsSync(bin)) throw new Error('godump build failed')
}

export interface GoResult {
  out: string
  ast?: unknown
  err?: string
}

/** Raw bytes (possibly invalid UTF-8) or text. */
export type Input = string | Uint8Array

export interface GoRequest {
  input: Input
  width?: number
  ast?: boolean
}

const b64 = (s: Input): string =>
  Buffer.from(s as never, 'utf8').toString('base64')
const unb64 = (s: string): string => Buffer.from(s, 'base64').toString('utf8')

/** Runs the Go converter over many inputs in one process. */
export async function runGo(reqs: GoRequest[]): Promise<GoResult[]> {
  const child = spawn(bin, ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const results: GoResult[] = []
  const rl = createInterface({ input: child.stdout })
  const done = new Promise<void>((res, rej) => {
    rl.on('line', (line) => {
      const r = JSON.parse(line) as { out: string; ast?: unknown; err?: string }
      results.push({ out: unb64(r.out ?? ''), ast: r.ast, err: r.err })
      if (results.length === reqs.length) res()
    })
    child.on('error', rej)
    child.on(
      'exit',
      (code) =>
        code !== 0 &&
        results.length < reqs.length &&
        rej(new Error(`godump exited ${code}`))
    )
  })
  const CHUNK = 500
  for (let i = 0; i < reqs.length; i += CHUNK) {
    const text = reqs
      .slice(i, i + CHUNK)
      .map(
        (r) =>
          JSON.stringify({ in: b64(r.input), w: r.width, ast: r.ast }) + '\n'
      )
      .join('')
    if (!child.stdin.write(text))
      await new Promise((r) => child.stdin.once('drain', r))
  }
  child.stdin.end()
  if (reqs.length > 0) await done
  return results
}

/** Every string literal in the Go tests and the Go fuzz corpus. */
export function goCorpus(extra: string[] = []): Buffer[] {
  const out = execFileSync(bin, ['corpus', repoRoot, ...extra], {
    maxBuffer: 1 << 28,
  }).toString()
  return out
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => Buffer.from(l, 'base64'))
}

/** The markdown examples shipped with goldmark (CommonMark spec, extension and extra tests) plus the string literals of its Go tests, as raw bytes. */
export function goldmarkCorpus(): Buffer[] {
  const dir = execFileSync(
    'go',
    ['list', '-m', '-f', '{{.Dir}}', 'github.com/yuin/goldmark'],
    { cwd: repoRoot }
  )
    .toString()
    .trim()
  const out = new Map<string, Buffer>()
  const add = (b: Buffer): void => void out.set(b.toString('base64'), b)
  for (const b of goCorpus([dir])) add(b as Buffer)
  const spec = JSON.parse(
    readFileSync(`${dir}/_test/spec.json`, 'utf8')
  ) as Array<{ markdown: string }>
  for (const e of spec) add(Buffer.from(e.markdown))
  for (const file of [
    `${dir}/_test/extra.txt`,
    `${dir}/_test/options.txt`,
    ...readdirSync(`${dir}/extension/_test`).map(
      (f) => `${dir}/extension/_test/${f}`
    ),
  ]) {
    for (const block of readFileSync(file, 'utf8').split(
      /\/\/= = =[= ]*\/\//
    )) {
      for (const part of block.split(/\/\/- - -[- ]*\/\//))
        if (part.trim() !== '') add(Buffer.from(part.replace(/^\n/, '')))
    }
  }
  return [...out.values()]
}

/** Entries of the Go fuzz engine's cache for FuzzConvert and FuzzTableGrid, as raw bytes. */
export function goFuzzCache(): Input[] {
  const cache = execFileSync('go', ['env', 'GOCACHE']).toString().trim()
  const files: string[] = []
  for (const target of ['FuzzConvert', 'FuzzTableGrid']) {
    const dir = `${cache}/fuzz/github.com/nickv2002/md-tools/internal/slack/${target}`
    if (existsSync(dir))
      for (const f of readdirSync(dir)) files.push(`${dir}/${f}`)
  }
  const out = execFileSync(bin, ['fuzzfiles', ...files], {
    maxBuffer: 1 << 28,
  }).toString()
  return out
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => Buffer.from(l, 'base64'))
}

/** The text the TS converter is given for an input: bytes decode the way the Go converter prepares them. */
export const toText = (input: Input): string =>
  typeof input === 'string' ? input : decodeUtf8Lossy(input)
