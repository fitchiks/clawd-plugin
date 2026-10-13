import { expect, mock, test } from 'claude-code/testing'

const PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 20,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

async function wait(clock: { advance: (ms: number) => Promise<void> }, ms: number) {
  for (let t = 0; t < ms; t += 200) {
    await clock.advance(200)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('a failed command is reacted to even when another command follows at once', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => e as never)
  let fail = true
  on('tool.call', () => (fail ? { result: 'boom', isError: true } : { result: 'ok' }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'clawd', args: 'on' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'desktop', component: 'AbovePrompt', props: PROPS as never })

  await $.tool.call({ tool: 'Bash', command: 'ls /nope' } as never)
  fail = false
  await $.tool.call({ tool: 'Bash', command: 'rm x' } as never)

  const seen: string[] = []
  for (let i = 0; i < 40; i++) {
    await wait(clock, 500)
    await ui.redraw()
    const anim = JSON.stringify(await ui.drawn()).match(/width=\\"(\d+)\\" height=\\"100\\" preserveAspectRatio/)?.[1]
    seen.push(String(anim))
  }
  console.log('strips seen: ' + [...new Set(seen)].join(' '))
  // look is 2 repeats of an 18-frame strip, so its strip is 1800 wide
  expect(seen.includes('1800')).toBe(true)
})
