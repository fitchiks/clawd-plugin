import type { ClientModule } from 'claude-code'

// a transparent region over clawd. the desktop does not deliver presses to it yet, but the
// band only shows him with it in place, so it stays, drawing an empty Box.
const Click: ClientModule = (_props, surface) => {
  const { Box } = surface.elements

  return <Box width="100%" height="100%" />
}

export default Click
