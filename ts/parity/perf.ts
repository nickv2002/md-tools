// Rough timing of the TS converter on large and adversarial inputs.
import { markdownToSlackMrkdwn } from '../src/index.js'
import { generate } from './gen.js'

const time = (label: string, input: string): void => {
  const t = performance.now()
  const out = markdownToSlackMrkdwn(input)
  console.log(
    `${label}: ${input.length} chars in ${(performance.now() - t).toFixed(0)}ms (${out.length} out)`
  )
}
const docs = generate(5, 300).join('\n\n')
time('mixed 3000 generated docs', docs)
time('long paragraph', 'word *em* `code` [l](https://x.io) '.repeat(2000))
time(
  'many lines',
  Array.from({ length: 2000 }, (_, i) => `line ${i} **b** _i_`).join('\n')
)
time('deep quote', '> '.repeat(50) + 'x')
time(
  'deep list',
  Array.from({ length: 100 }, (_, i) => '  '.repeat(i) + '- x').join('\n')
)
time('many brackets', '['.repeat(2000) + ']'.repeat(2000))
time('many stars', '*'.repeat(2000))
time('many stars alternating', '*a'.repeat(2000))
time('many backticks', '`a'.repeat(2000))
time('html tags', '<a b="c" '.repeat(500))
time('big table', '| a | b |\n|---|---|\n' + '| 1 | 2 |\n'.repeat(2000))
time('many emails', 'a@b.co '.repeat(2000))
time('many links', '[a](https://x.io) '.repeat(2000))
time('many entities', '&amp; &copy; &#35; '.repeat(2000))
