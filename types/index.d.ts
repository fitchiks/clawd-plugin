export type Look = {
  /** the animation on screen, a key of SPRITES. */
  anim: string
  /** bumped on every change so a replay of the same animation restarts it. */
  n: number
  /** false until the chat has a message, or after /clawd off. */
  isShown: boolean
  /** where his box stands on the island, in px from its left edge. */
  x: number
  /** where he is running to: equal to x when he stands. */
  toX: number
  /** how long the run from x to toX takes. */
  ms: number
}

declare module 'claude-code' {
  interface PluginState {
    clawd: { look: Look }
  }
}
