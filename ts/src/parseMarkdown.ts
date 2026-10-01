import { parseGoldmark } from './goldmark/index.js'
import { toRenderTree } from './goldmark/toRenderTree.js'
import { link, type Node } from './tree.js'
import { stringToBytes } from './goldmark/util.js'

/** Parses Markdown into the tree the renderer reads, using a port of goldmark's parser so the tree matches the Go converter's. */
export function parseMarkdown(source: string): Node {
  const bytes = stringToBytes(source)
  return link(toRenderTree(parseGoldmark(bytes), bytes))
}
