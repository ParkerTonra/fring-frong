/** The match's score: a point to whoever touched the ball last when a turn answers; `session` the session it belongs to. */
export type Score = { left: number; right: number; session?: string }

declare module 'claude-code' {
  interface PluginState {
    'fring-frong': { isShown: boolean; score: Score; reels: number }
  }
}
