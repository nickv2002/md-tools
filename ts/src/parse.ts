import { type Node, node } from './tree.js'

export function parseMarkdown(_source: string): Node {
  return node('Document')
}
