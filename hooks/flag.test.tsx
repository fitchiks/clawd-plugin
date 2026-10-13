import { expect, mock, test } from 'claude-code/testing'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

// moves the beat clock on, letting each 200ms beat settle.
async function wait(clock: { advance: (ms: number) => Promise<void> }, ms: number) {
  for (let t = 0; t < ms; t += 200) {
    await clock.advance(200)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('a commanded flag waves after the current step, then Clawd goes back to idle', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'clawd', args: 'flag' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'desktop', component: 'AbovePrompt', props: PROPS as never })

  await wait(clock, 3400)
  await ui.redraw()
  const flag = JSON.stringify(await ui.drawn())
  console.log('SVG>>' + JSON.parse(flag).children[1].children[1].children[0].props.source + '<<SVG')
  expect(flag.includes('repeatCount=\\"3\\"')).toBe(true)

  await wait(clock, 3200)
  await ui.redraw()
  const after = JSON.stringify(await ui.drawn())
  expect(after.includes('repeatCount=\\"3\\"')).toBe(false)
})
