import type { CoreEngineInterface, Register } from 'claude-code'

import { addPoint, game, refreshAgents, sessionScore, working } from './game'
import {
  type Show,
  agentStart,
  agentStop,
  compactEnd,
  compactStart,
  initial,
  limit,
  permissionAsked,
  permissionDone,
  queued,
  setWorking,
  toolError,
  turnEnd,
  turnStart,
} from './show'
import { EAGER, stageRender, stageStart, stageTick } from './stage'

// Fring Frong: while Claude works (a turn, or a subagent running), two frogs play ping pong on a band above the prompt,
// and react to what the session does (see README.md, "What the frogs do"). This module feeds the game (game.ts) the
// events; the pictures and timings are pure, in show.ts; the stage (stage.ts names it) draws the band and ticks it:
// the match alone (match.tsx), or an add-on's stage around it.

type $ = CoreEngineInterface

// Errors that mean a limit was hit (StopFailure's kinds): the frogs fall asleep.
const LIMIT_ERRORS = new Set(['rate_limit', 'billing_error', 'max_output_tokens'])
let started = false

// The clock is read before the show: `st = fn(st, await ...)` would hold the show of before the await and write it back
// over whatever another hook or the tick did meanwhile.
async function act($: $, fn: (s: Show, now: number) => Show): Promise<void> {
  const now = await $.clock.now()
  game.st = fn(setWorking(game.st, working(), now), now)
  await stageTick($)
}

// After a turn starts or ends: the stage draws it now, not on its next tick (awaited, or not, as the stage says).
async function kick($: $): Promise<void> {
  if (EAGER) await stageTick($)
  else void stageTick($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    if (!started) {
      started = true
      game.st = initial(((await $.clock.now()) & 0xffff) + 1)
      game.scoreFor = null
      await sessionScore($) // a reload keeps this session's score; a new session starts at 0:0
      await stageStart($)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      game.turns++
      if (EAGER) await act($, turnStart).catch(() => {})
      else {
        const now = await $.clock.now() // read before the show (see act)
        game.st = turnStart(game.st, now)
      }
    }
    const r = await next(e)
    await refreshAgents($) // a subagent's turn is running now
    await kick($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      game.turns = Math.max(0, game.turns - 1)
      if (game.turns === 0) {
        const now = await $.clock.now() // read before the show (see act)
        const r = turnEnd(game.st, now, e.reason)
        game.st = r.show
        const point = r.point
        if (point) await addPoint($, point)
      }
    }
    const r = await next(e)
    await refreshAgents($)
    await kick($)
    return r
  })

  // A /clear ends the session with no session.start after it: the next session's score starts at 0:0.
  on('session.end', async ($, e, next) => {
    game.score = { left: 0, right: 0 }
    game.scoreFor = null
    return next(e)
  })

  // A prompt typed while a turn runs is queued: the frogs run into each other.
  on('prompt.submit', async ($, e, next) => {
    if (game.turns > 0) await act($, queued).catch(() => {})
    return next(e)
  })

  // A tool that failed (not one the person interrupted): the ball beans a frog.
  on('classic.PostToolUseFailure', async ($, e, next) => {
    game.st = permissionDone(game.st)
    if (!e.is_interrupt) await act($, toolError).catch(() => {})
    return next(e)
  })

  // A permission dialog is about to ask the person: the frogs turn to face them until the call goes on.
  on('classic.PermissionRequest', async ($, e, next) => {
    await act($, permissionAsked).catch(() => {})
    return next(e)
  })
  // The call went on (ran, failed or was refused): nobody is asked any more. Classic events only: a tool.call or
  // tool.run hook would keep every tool's output from moving to the background.
  on('classic.PostToolUse', async ($, e, next) => {
    game.st = permissionDone(game.st)
    return next(e)
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    game.st = permissionDone(game.st)
    return next(e)
  })

  // A usage, token or rate limit: asleep until the next turn.
  on('classic.StopFailure', async ($, e, next) => {
    if (LIMIT_ERRORS.has(e.error)) await act($, limit).catch(() => {})
    return next(e)
  })
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.some((w) => w.percentUsed >= 100) && game.turns > 0) await act($, limit).catch(() => {})
    return next(e)
  })

  // Compaction squishes both frogs, then they pop back up.
  on('classic.PreCompact', async ($, e, next) => {
    await act($, compactStart).catch(() => {})
    return next(e)
  })
  on('classic.PostCompact', async ($, e, next) => {
    await act($, compactEnd).catch(() => {})
    return next(e)
  })

  // A subagent running: a fan of Claude's takes a seat on its side, and hops off when the agent is done.
  on('classic.SubagentStart', async ($, e, next) => {
    const now = await $.clock.now()
    game.st = agentStart(game.st, e.agent_id, now)
    return next(e)
  })
  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    game.st = agentStop(game.st, e.agent_id, now)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => stageRender($, e, next))
}
