import { type Node } from '../src/tree.js'
import { compact } from './dump.js'

/** Drops the fields that carry no information so Go's JSON and our tree compare equal. */
export function normalize(n: Node): Node {
  const copy: Node = { ...n, c: n.c.map(normalize), parent: null, index: 0 }
  if (copy.v === '') delete copy.v
  if (copy.dest === '') delete copy.dest
  if (copy.start === 0) delete copy.start
  return copy
}

/** A one-line description of the first place two trees differ, or null when equal. */
export function firstDiff(a: Node, b: Node, path = 'Document'): string | null {
  const ca = compact({ ...a, c: [] })
  const cb = compact({ ...b, c: [] })
  if (ca !== cb) return `${path}: go ${ca} vs ts ${cb}`
  const len = Math.max(a.c.length, b.c.length)
  for (let i = 0; i < len; i++) {
    const x = a.c[i]
    const y = b.c[i]
    if (!x || !y)
      return `${path}: child ${i} go ${x ? compact(x) : 'missing'} vs ts ${y ? compact(y) : 'missing'}`
    const d = firstDiff(x, y, `${path}/${x.k}[${i}]`)
    if (d) return d
  }
  return null
}
