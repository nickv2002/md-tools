import { toWellFormed } from './gotext.js'
import { parseMarkdown } from './parse.js'
import { renderDocument } from './render.js'

export interface Options {
  /** The widest aligned table grid to emit, in monospace cells; wider tables become one record per row. Zero keeps every table as a grid. */
  maxTableWidth?: number
}

/** The widest table, in monospace cells, kept as an aligned grid by default. */
export const DEFAULT_MAX_TABLE_WIDTH = 100

function stripFrontMatter(input: string): string {
  const s = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const lines = s.split('\n')
  if (lines[0] !== '---' && lines[0] !== '+++') return s
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[0] || (lines[0] === '---' && lines[i] === '...'))
      return lines.slice(i + 1).join('\n')
  }
  return s
}

/** The parser's input: well-formed text with front matter removed. */
export const prepare = (input: string): string =>
  stripFrontMatter(toWellFormed(input))

/** Renders Markdown as Slack mrkdwn. Unsupported block syntax becomes readable plain text; front matter and raw HTML are omitted. */
export function markdownToSlackMrkdwn(
  input: string,
  opts: Options = {}
): string {
  return renderDocument(
    parseMarkdown(prepare(input)),
    opts.maxTableWidth ?? DEFAULT_MAX_TABLE_WIDTH
  )
}

export { decodeUtf8Lossy } from './gotext.js'
