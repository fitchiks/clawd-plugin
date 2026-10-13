import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { FRAME, SPRITES } from './sprites'

// every sticker is drawn at its own scale, so each is scaled until his body is BODY px
// wide, stood on its own floor row and centred on him.
const SIZE = 60
const HEIGHT = 48
const BODY = 34
const STAGE = 170
const ISLAND = 12
const X_MIN = 0
const X_MAX = STAGE - SIZE
// the app's own background, so the band reads as empty floor rather than a card.
const FLOOR = '#151515'

const look = atom({ plugin: 'clawd', key: 'look' } as const, {
  anim: 'idle',
  n: 0,
  isShown: false,
  x: X_MAX,
  toX: X_MAX,
  ms: 0,
})

// grass on top, dirt tapering to a point, in 2px pixels.
const ISLAND_SVG = [
  ['#4f9a3c', 6, 0, 158, 2],
  ['#7ec850', 8, 0, 154, 1],
  ['#4f9a3c', 4, 2, 162, 2],
  ['#8a5a33', 6, 4, 158, 2],
  ['#7a4e2c', 12, 6, 146, 2],
  ['#6b4426', 24, 8, 122, 2],
  ['#5a3820', 46, 10, 78, 2],
  ['#a8e070', 30, -2, 4, 2],
  ['#a8e070', 88, -2, 2, 2],
  ['#a8e070', 128, -2, 4, 2],
  ['#9b6a40', 40, 5, 4, 2],
  ['#9b6a40', 110, 5, 6, 2],
]
  .map(([fill, x, y, w, h]) => `<rect x="${x}" y="${Number(y) + HEIGHT}" width="${w}" height="${h}" fill="${fill}"/>`)
  .join('')

// clawd always plays exactly one step; when it ends the next step of the current mode's
// script follows, round and round. events only choose the mode.
//
// a step is an animation played where he stands (for ms, or once through without it), or,
// with `to`, a run across the island to the far side or to another spot.
type Step = { anim: string; ms?: number; to?: 'far' | 'spot' }
type Mode = 'idle' | 'think' | 'write' | 'run' | 'search' | 'edit' | 'agent' | 'finish' | 'oops' | 'show'

const SCRIPTS: Record<Mode, Step[]> = {
  idle: [
    { anim: 'idle', ms: 8000 },
    { anim: 'run', ms: 4000 },
    { anim: 'idle', ms: 8000 },
    { anim: 'run', to: 'spot' },
    { anim: 'idle', ms: 8000 },
    { anim: 'dance' },
    { anim: 'idle', ms: 8000 },
    { anim: 'paint', ms: 6000 },
    { anim: 'idle', ms: 8000 },
    { anim: 'run', ms: 4000 },
    { anim: 'idle', ms: 8000 },
    { anim: 'run', to: 'spot' },
    { anim: 'idle', ms: 8000 },
    { anim: 'dance' },
    { anim: 'idle', ms: 8000 },
    { anim: 'detective', ms: 6000 },
  ],
  think: [
    { anim: 'think', ms: 6000 },
    { anim: 'detective', ms: 6000 },
  ],
  write: [
    { anim: 'glide', to: 'far' },
    { anim: 'paint', ms: 6000 },
    { anim: 'race', to: 'far' },
    { anim: 'paint', ms: 6000 },
  ],
  run: [
    { anim: 'run', to: 'far' },
    { anim: 'lift', ms: 5000 },
    { anim: 'run', to: 'far' },
    { anim: 'paint', ms: 5000 },
  ],
  search: [
    { anim: 'detective', ms: 6000 },
    { anim: 'run', to: 'spot' },
  ],
  edit: [
    { anim: 'paint', ms: 7000 },
    { anim: 'glide', to: 'far' },
  ],
  agent: [
    { anim: 'race', to: 'far' },
    { anim: 'race', to: 'far' },
    { anim: 'detective', ms: 5000 },
  ],
  // these play through once and are never cut short.
  finish: [{ anim: 'flag' }, { anim: 'dance' }],
  oops: [{ anim: 'look' }],
  show: [],
}
const ONCE = new Set<Mode>(['finish', 'oops', 'show'])

const MODE_OF_TOOL: Record<string, Mode> = {
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'run',
  PowerShell: 'run',
  Read: 'search',
  Grep: 'search',
  Glob: 'search',
  WebSearch: 'search',
  WebFetch: 'search',
  ToolSearch: 'search',
  Agent: 'agent',
}

// px a second.
const SPEED: Record<string, number> = { run: 45, race: 95, glide: 40 }
// how many times a step without ms plays its animation (the flag is waved, not just raised).
const REPEATS: Record<string, number> = { flag: 3, dance: 2, look: 2 }
// these loop for as long as their step lasts; the rest hold their last frame.
const LOOPS = new Set(['idle', 'think', 'detective', 'paint', 'lift', 'run', 'race', 'glide', 'bounce'])
// a standing step gives way to a new mode once it has shown this long; a move always finishes.
const MIN_SHOW_MS = 3000
const BEAT_MS = 200

let mode: Mode = 'idle'
let wanted: Mode = 'idle'
let resume: Mode = 'idle'
let step = 0
let stepStart = 0
let stepEnd = 0
let isMoving = false
let posX = X_MAX
// milliseconds counted by beat(), the one clock this module trusts.
let now = 0
let seq = 0

// kept for /clawd debug.
const renders: string[] = []
const NL = String.fromCharCode(10)

function note(line: string) {
  const time = new Date().toTimeString().slice(0, 8)
  renders.push(`${time} t=${now} ${line}`)
  if (renders.length > 25) {
    renders.shift()
  }
}

// the widened window is clipped to the frame so no neighbouring frame of the strip shows.
function sprite(anim: string, id: string, repeat: string) {
  const s = SPRITES[anim] ?? SPRITES.idle
  const unitsPerPx = s.body / BODY
  const wide = SIZE * unitsPerPx
  const tall = HEIGHT * unitsPerPx
  const box = `${(s.cx - wide / 2).toFixed(2)} ${(s.bottom - tall).toFixed(2)} ${wide.toFixed(2)} ${tall.toFixed(2)}`

  return (
    `<svg x="0" y="0" width="${SIZE}" height="${HEIGHT}" viewBox="${box}">` +
    `<clipPath id="${id}"><rect x="0" y="0" width="${FRAME}" height="${FRAME}"/></clipPath>` +
    `<g clip-path="url(#${id})">` +
    `<image href="data:image/png;base64,${s.png}" x="0" y="0" width="${FRAME * s.frames}" height="${FRAME}" ` +
    `preserveAspectRatio="none" style="image-rendering:pixelated">` +
    `<animate attributeName="x" values="${s.xs}" keyTimes="${s.keyTimes}" dur="${s.dur}s" ` +
    `calcMode="discrete" repeatCount="${repeat}" fill="freeze"/></image></g></svg>`
  )
}

// the island, and his box on it at x, moving to toX over ms when they differ.
function svg(anim: string, n: number, x: number, toX: number, ms: number) {
  const isMove = toX !== x
  const repeat = isMove || LOOPS.has(anim) ? 'indefinite' : String(REPEATS[anim] ?? 1)
  const move = isMove
    ? `<animateTransform attributeName="transform" type="translate" from="${x} 1" to="${toX} 1" ` +
      `dur="${(ms / 1000).toFixed(2)}s" fill="freeze"/>`
    : ''
  // moving left, he faces left: mirrored about his box's middle.
  const face = isMove && toX < x ? ` transform="translate(${SIZE} 0) scale(-1 1)"` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" id="c${n}" viewBox="0 0 ${STAGE} ${HEIGHT + ISLAND}" ` +
    `width="${STAGE}" height="${HEIGHT + ISLAND}" shape-rendering="crispEdges">${ISLAND_SVG}` +
    `<g transform="translate(${isMove ? x : toX} 1)">${move}<g${face}>${sprite(anim, `f${n}`, repeat)}</g></g></svg>`
  )
}

async function draw($: EngineInterface, anim: string, from: number, to: number, ms: number) {
  seq += 1
  const n = seq
  await update($, look, v => ({ ...v, anim, n, x: from, toX: to, ms }))
}

function spotAwayFrom(from: number) {
  const far = (X_MAX - X_MIN) / 3
  let to = from
  while (Math.abs(to - from) < far) {
    to = X_MIN + Math.random() * (X_MAX - X_MIN)
  }

  return Math.round(to)
}

async function play($: EngineInterface, s: Step) {
  stepStart = now
  if (s.to !== undefined) {
    const from = posX
    const to = s.to === 'far' ? (from > (X_MIN + X_MAX) / 2 ? X_MIN : X_MAX) : spotAwayFrom(from)
    const ms = Math.round((Math.abs(to - from) / (SPEED[s.anim] ?? 45)) * 1000)
    posX = to
    isMoving = true
    stepEnd = now + Math.max(ms, BEAT_MS)
    await draw($, s.anim, from, to, ms)
    return
  }

  const once = (SPRITES[s.anim]?.dur ?? 1) * 1000 * (REPEATS[s.anim] ?? 1)
  isMoving = false
  stepEnd = now + (s.ms ?? once)
  await draw($, s.anim, posX, posX, 0)
}

// the rest of a play-once script, else the wanted mode's script from the top, else the next in line.
async function advance($: EngineInterface) {
  if (ONCE.has(mode)) {
    if (step < SCRIPTS[mode].length) {
      await play($, SCRIPTS[mode][step++])
      return
    }

    mode = ONCE.has(wanted) && wanted !== mode ? wanted : resume
    wanted = mode
    resume = 'idle'
    step = 0
  } else if (wanted !== mode) {
    mode = wanted
    step = 0
  } else if (step >= SCRIPTS[mode].length) {
    step = 0
  }

  const script = SCRIPTS[mode]
  await play($, script[step % script.length])
  step += 1
}

// the mode starts when the current step ends, sooner if that step stands and has shown long
// enough. a play-once mode is never overridden: one asked for meanwhile waits in `resume`.
function want(next: Mode) {
  if (ONCE.has(next)) {
    if (!ONCE.has(wanted)) {
      resume = wanted
    }
  } else if (ONCE.has(wanted) || ONCE.has(mode)) {
    resume = next
    return
  }

  if (next === wanted) {
    return
  }

  wanted = next
  if (!isMoving && !ONCE.has(mode)) {
    stepEnd = Math.min(stepEnd, Math.max(now, stepStart + MIN_SHOW_MS))
  }
}

async function beat($: EngineInterface) {
  now += BEAT_MS
  if (now >= stepEnd) {
    await advance($)
  }
}

async function onCommand($: EngineInterface, args: string) {
  const word = args.trim()
  const names = Object.keys(SPRITES).join(', ')
  if (word === 'debug') {
    const v = await read($, look)
    const state =
      `mode=${mode} wanted=${wanted} resume=${resume} step=${step} anim=${v.anim} moving=${isMoving} ` +
      `x=${posX} clock=${now}ms stepStart=${stepStart} stepEnd=${stepEnd}`
    const last = renders.length > 0 ? renders.join(NL) : 'no band draws yet'
    return `State: ${state}${NL}Band draws, oldest first (now ${new Date().toTimeString().slice(0, 8)}):${NL}${last}`
  }

  if (word === 'off') {
    await update($, look, v => ({ ...v, isShown: false }))
    return 'Clawd hidden. /clawd on brings him back.'
  }

  if (word === 'on' || word === '') {
    await update($, look, v => ({ ...v, isShown: true }))
    return `Clawd is here. /clawd <animation> plays one after the current step: ${names}`
  }

  if (SPRITES[word] === undefined) {
    return `No animation "${word}". Known: ${names}`
  }

  await update($, look, v => ({ ...v, isShown: true }))
  SCRIPTS.show = [SPEED[word] !== undefined ? { anim: word, to: 'far' } : { anim: word }]
  want('show')
  return `Playing ${word} after the current step.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clawd',
      description: 'Clawd above the prompt: on, off, debug, or the name of an animation to play',
    })

    try {
      const messages = await $.session.messages()
      if (messages.length > 0) {
        await update($, look, v => ({ ...v, isShown: true }))
      }
    } catch {
      // no transcript to read: wait for the first prompt.
    }

    await advance($)
    $.clock.every(BEAT_MS, () => void beat($))

    return next(e)
  })

  on('command.run', { command: 'clawd' }, async ($, e) => ({ text: await onCommand($, e.args) }))

  on('prompt.submit', async ($, e, next) => {
    await update($, look, v => ({ ...v, isShown: true }))
    want('think')

    return next(e)
  })

  // thinking and answering arrive as chunks of the model's stream.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    for await (const chunk of next(e)) {
      if (chunk.kind === 'thinking') {
        want('think')
      } else if (chunk.kind === 'text') {
        want('write')
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    want(MODE_OF_TOOL[e.tool] ?? 'run')
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      want('oops')
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      if (e.reason === 'answer') {
        want('finish')
        resume = 'idle'
      } else if (e.reason === 'error' || e.reason === 'refusal') {
        want('oops')
        resume = 'idle'
      } else {
        want('idle')
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, look)
    const hides = !v.isShown || e.props.hasSurvey || e.surface !== 'desktop'
    note(`${hides ? 'HID' : 'drew'} ${v.anim} survey=${e.props.hasSurvey} working=${e.props.isWorking}`)
    if (hides) {
      return next(e)
    }

    const { Box, Svg, Client } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column" flexGrow={1}>
        {/* the engine's own nodes may not sit under a positioned Box. */}
        {below}
        <Box position="relative" flexDirection="column">
          {/* bleeds past the band's own padding so its lighter frame is painted over. */}
          <Box position="absolute" top={-3} left={-3} right={-3} bottom={-3} backgroundColor={FLOOR} />
          {/* positioned too: the desktop paints positioned boxes above in-flow ones. in the flow, so it gives the band its height. */}
          <Box position="relative" justifyContent="flex-end" alignItems="flex-end">
            <Box key="clawd-pet" position="relative">
              <Svg source={svg(v.anim, v.n, v.x, v.toX, v.ms)} alt="Clawd" width={STAGE} height={HEIGHT + ISLAND} />
              <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                <Client key="clawd-click" module="./click.tsx" width="100%" height="100%" />
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })
}
