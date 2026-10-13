import { expect, mock, test } from 'claude-code/testing'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

test('desktop band draws Clawd', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.command.run({ command: 'clawd', args: 'on' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'desktop', component: 'AbovePrompt', props: PROPS as never })
  const drawn = JSON.stringify(await ui.drawn())
  const short = drawn
    .split('base64,')
    .map((part, i) => (i === 0 ? part : part.slice(part.indexOf(' x='))))
    .join('B64')
  console.log(short.slice(0, 2500))
  expect(drawn.includes('Svg')).toBe(true)
})
