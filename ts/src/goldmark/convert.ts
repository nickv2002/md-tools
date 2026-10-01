import { type GNode } from './ast.js'
import { type Node, type Kind, node } from '../tree.js'
import { bytesToString } from './util.js'
import { must } from '../must.js'

const KINDS = new Set<string>([
  'Document',
  'Paragraph',
  'TextBlock',
  'Heading',
  'List',
  'ListItem',
  'Blockquote',
  'FencedCodeBlock',
  'CodeBlock',
  'ThematicBreak',
  'HTMLBlock',
  'Table',
  'TableHeader',
  'TableRow',
  'TableCell',
  'Text',
  'Emphasis',
  'Strikethrough',
  'CodeSpan',
  'Link',
  'AutoLink',
  'Image',
  'TaskCheckBox',
  'RawHTML',
])

/** Reduces goldmark's AST to what the renderer reads. Iterative so deeply nested documents do not overflow the stack. */
export function toRenderTree(root: GNode, source: Uint8Array): Node {
  const out = node('Document')
  const stack: Array<[GNode, Node]> = [[root, out]]
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [n, target] = item
    target.k = n.kind as Kind
    fill(n, target, source)
    if (n.kind === 'AutoLink') continue
    for (let c = n.firstChild; c !== null; c = c.next) {
      const child = node('Document')
      target.c.push(child)
      stack.push([c, child])
    }
  }
  return out
}

function fill(n: GNode, out: Node, source: Uint8Array): void {
  if (!KINDS.has(n.kind)) {
    throw new Error(`unexpected node kind ${n.kind} left in the tree`)
  }
  switch (n.kind) {
    case 'Text':
      out.v = bytesToString(n.segment.value(source))
      out.soft = n.soft
      out.hard = n.hard
      break
    case 'Emphasis':
      out.level = n.level
      break
    case 'List':
      out.ordered = n.marker === 0x2e || n.marker === 0x29
      out.start = n.start
      out.count = n.childCount
      break
    case 'Link':
    case 'Image':
      out.dest = n.destination ? bytesToString(n.destination) : ''
      break
    case 'AutoLink': {
      const value = must(n.value).segment.value(source)
      out.v = n.protocol
        ? bytesToString(n.protocol) + '://' + bytesToString(value)
        : bytesToString(value)
      out.email = n.autoLinkType === 'email'
      break
    }
    case 'TaskCheckBox':
      out.checked = n.isChecked
      break
    case 'RawHTML':
      out.v = bytesToString(n.segments.value(source))
      break
    case 'Table':
      out.aligns = n.alignments
      break
    case 'FencedCodeBlock':
    case 'CodeBlock': {
      out.lines = []
      for (let i = 0; i < n.lines.length; i++) {
        out.lines.push(bytesToString(n.lines.at(i).value(source)))
      }
      break
    }
  }
}
