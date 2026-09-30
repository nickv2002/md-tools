import { type GNode } from './ast.js'
import { atxHeadingParser, blockquoteParser, codeBlockParser, fencedCodeBlockParser, htmlBlockParser, linkReferenceParagraphTransformer, listItemParser, listParser, paragraphParser, setextHeadingParser, thematicBreakParser } from './blocks.js'
import { strikethroughParser, linkifyParser, tableASTTransformer, tableParagraphTransformer, taskCheckBoxParser } from './ext.js'
import { autoLinkParser, codeSpanParser, emphasisParser, rawHTMLParser } from './inlines.js'
import { linkParser } from './link.js'
import { Parser } from './parser.js'

/** goldmark.New(WithExtensions(extension.GFM)): default CommonMark parsers plus linkify, tables, strikethrough and task lists. */
const gfmParser = new Parser({
  blockParsers: [
    { parser: setextHeadingParser, priority: 100 },
    { parser: thematicBreakParser, priority: 200 },
    { parser: listParser, priority: 300 },
    { parser: listItemParser, priority: 400 },
    { parser: codeBlockParser, priority: 500 },
    { parser: atxHeadingParser, priority: 600 },
    { parser: fencedCodeBlockParser, priority: 700 },
    { parser: blockquoteParser, priority: 800 },
    { parser: htmlBlockParser, priority: 900 },
    { parser: paragraphParser, priority: 1000 },
  ],
  inlineParsers: [
    { parser: codeSpanParser, priority: 100 },
    { parser: linkParser, priority: 200 },
    { parser: autoLinkParser, priority: 300 },
    { parser: rawHTMLParser, priority: 400 },
    { parser: emphasisParser, priority: 500 },
    { parser: linkifyParser, priority: 999 },
    { parser: strikethroughParser, priority: 500 },
    { parser: taskCheckBoxParser, priority: 0 },
  ],
  paragraphTransformers: [
    { parser: linkReferenceParagraphTransformer, priority: 100 },
    { parser: tableParagraphTransformer, priority: 200 },
  ],
  astTransformers: [{ parser: tableASTTransformer, priority: 0 }],
})

/** Parses UTF-8 Markdown bytes into goldmark's AST. */
export function parseGoldmark(source: Uint8Array): GNode {
  return gfmParser.parse(source)
}
