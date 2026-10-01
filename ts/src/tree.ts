export type Kind =
  | 'Document'
  | 'Paragraph'
  | 'TextBlock'
  | 'Heading'
  | 'List'
  | 'ListItem'
  | 'Blockquote'
  | 'FencedCodeBlock'
  | 'CodeBlock'
  | 'ThematicBreak'
  | 'HTMLBlock'
  | 'Table'
  | 'TableHeader'
  | 'TableRow'
  | 'TableCell'
  | 'Text'
  | 'String'
  | 'Emphasis'
  | 'Strikethrough'
  | 'CodeSpan'
  | 'Link'
  | 'AutoLink'
  | 'Image'
  | 'TaskCheckBox'
  | 'RawHTML'

export type Align = 'none' | 'left' | 'right' | 'center'

/** The goldmark tree reduced to what the renderer reads. */
export interface Node {
  k: Kind
  c: Node[]
  parent: Node | null
  index: number
  v?: string
  soft?: boolean
  hard?: boolean
  level?: number
  ordered?: boolean
  count?: number
  start?: number
  dest?: string
  email?: boolean
  checked?: boolean
  aligns?: Align[]
  lines?: string[]
}

export function node(k: Kind, attrs: Partial<Node> = {}, c: Node[] = []): Node {
  return { k, c, parent: null, index: 0, ...attrs }
}

/** Sets parent and index on every node; iterative so deep trees do not overflow the stack. */
export function link(root: Node): Node {
  const stack: Node[] = [root]
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    for (let i = 0; i < n.c.length; i++) {
      const child = n.c[i]
      child.parent = n
      child.index = i
      stack.push(child)
    }
  }
  return root
}

export const prevSibling = (n: Node): Node | null =>
  n.parent?.c[n.index - 1] ?? null
export const nextSibling = (n: Node): Node | null =>
  n.parent?.c[n.index + 1] ?? null

interface JsonNode {
  k: Kind
  c?: JsonNode[]
  [attr: string]: unknown
}

/** Rebuild a tree from the Go dumper's JSON. */
export function fromJSON(j: JsonNode): Node {
  const { k, c, ...attrs } = j
  return node(k, attrs, (c ?? []).map(fromJSON))
}

/** Plain structural form for comparing two trees. */
export function plain(n: Node): unknown {
  const out: Record<string, unknown> = { k: n.k }
  for (const key of [
    'v',
    'soft',
    'hard',
    'level',
    'ordered',
    'count',
    'start',
    'dest',
    'email',
    'checked',
    'aligns',
    'lines',
  ] as const) {
    const val = n[key]
    if (
      val !== undefined &&
      val !== false &&
      val !== 0 &&
      val !== '' &&
      !(Array.isArray(val) && val.length === 0)
    )
      out[key] = val
  }
  if (n.c.length > 0) out.c = n.c.map(plain)
  return out
}
