import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export const tsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const repoRoot = resolve(tsRoot, '..')
const bin = resolve(tsRoot, '.cache/godump')

export function buildGo(): void {
  execFileSync('go', ['build', '-tags', 'slackdump', '-o', bin, './scripts/ts-parity/godump'], { cwd: repoRoot, stdio: 'inherit' })
  if (!existsSync(bin)) throw new Error('godump build failed')
}

export interface GoResult {
  out: string
  ast?: unknown
  err?: string
}

export interface GoRequest {
  input: string
  width?: number
  ast?: boolean
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
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
    child.on('exit', (code) => code !== 0 && results.length < reqs.length && rej(new Error(`godump exited ${code}`)))
  })
  const CHUNK = 500
  for (let i = 0; i < reqs.length; i += CHUNK) {
    const text = reqs
      .slice(i, i + CHUNK)
      .map((r) => JSON.stringify({ in: b64(r.input), w: r.width, ast: r.ast }) + '\n')
      .join('')
    if (!child.stdin.write(text)) await new Promise((r) => child.stdin.once('drain', r))
  }
  child.stdin.end()
  if (reqs.length > 0) await done
  return results
}

/** Every string literal in the Go tests and the Go fuzz corpus. */
export function goCorpus(): string[] {
  const out = execFileSync(bin, ['corpus', repoRoot], { maxBuffer: 1 << 28 }).toString()
  return out
    .split('\n')
    .filter((l) => l !== '')
    .map(unb64)
}
