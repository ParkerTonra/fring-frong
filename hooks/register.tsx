import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { Score } from '../types'
import { encodeTriplets } from './pong'
import { HEIGHT_PX, WIDTH_PX, svgFlipbook } from './svg'
import {
  COLUMNS,
  FROG_COLUMNS,
  ROWS,
  type Reel,
  type Show,
  agentStart,
  agentStop,
  compactEnd,
  compactStart,
  course,
  frame,
  initial,
  layFans,
  limit,
  permissionAsked,
  permissionDone,
  queued,
  reel,
  setWorking,
  step,
  syncFans,
  toolError,
  turnEnd,
  turnStart,
  visible,
  withScore,
} from './show'

// Fring Frong: while Claude works (a turn, or a subagent running), two frogs play ping pong on a band above the prompt, and react to
// what the session does (see README.md, "What the frogs do"). The pictures and timings are pure, in show.ts;
// this module only feeds it events and the clock, and blits what it draws. No processes, network or files.
//
// Two surfaces draw the band. The terminal gets three Rasters, repainted by $.ui.blit on every tick. The desktop
// app has no Raster and no blit, so it gets one Svg flipbook (svg.ts) of the frames show.ts works out ahead (reel):
// the app plays it with SMIL, and the band redraws only when the show changes course or the reel runs out.

type $ = CoreEngineInterface

const isShown = atom({ plugin: 'fring-frong', key: 'isShown' } as const, false)
// The match's score (a point to whoever touched the ball last when a turn answers), kept across reloads of the mod
// but not past its session: it carries the session's id, and a score of another session (a /clear, a resume) is 0:0.
const scoreAtom = atom({ plugin: 'fring-frong', key: 'score' } as const, { left: 0, right: 0 })
// Bumped to redraw the desktop band with a new reel.
const reels = atom({ plugin: 'fring-frong', key: 'reels' } as const, 0)

const FRAME_MS = 66
// Errors that mean a limit was hit (StopFailure's kinds): the frogs fall asleep.
const LIMIT_ERRORS = new Set(['rate_limit', 'billing_error', 'max_output_tokens'])

let st: Show = initial(1)
let score: Score = { left: 0, right: 0 }
let scoreFor: string | null = null // the session the score belongs to

/** This session's score: the stored one when it is this session's, else a fresh 0:0 (written to the atom unless `write` is false, as while drawing). */
async function sessionScore($: $, write = true): Promise<Score> {
  const id = await $.session.id()
  if (scoreFor === id) return score
  const stored = await read($, scoreAtom)
  score = stored.session === id ? { left: stored.left, right: stored.right, session: id } : { left: 0, right: 0, session: id }
  scoreFor = id
  if (write && stored.session !== id) {
    const fresh = score
    await update($, scoreAtom, () => fresh)
  }
  return score
}

// Main-loop turns running, plus this session's subagents that are running a turn (background ones too): the frogs
// play ping pong while either is there. An agent that is waiting on its own background shells, or idle, is not
// running; monitors and other background shells are not agents.
let turns = 0
let agentsRunning = 0
const working = (): boolean => turns > 0 || agentsRunning > 0
// Claude's fan club (show.ts): a tiny frog for each subagent running a turn, seated by SubagentStart or the list, off
// when it ends or only waits.
async function refreshAgents($: $): Promise<void> {
  try {
    const list = await $.agent.list()
    const mine = list.filter((a) => a.kind === 'local_agent')
    agentsRunning = mine.filter((a) => a.status === 'running').length
    const now = await $.clock.now()
    st = syncFans(st, mine.filter((a) => a.status === 'running').map((a) => a.id), mine.filter((a) => a.status !== 'running').map((a) => a.id), now)
  } catch {
    // keep the last count
  }
}
let bandId: string | null = null
let desk: Reel | null = null // the reel the desktop band plays, while it shows one
let last = { left: '', table: '', right: '' }
let busy = false
let started = false

async function tick($: $): Promise<void> {
  if (busy) return
  busy = true
  try {
    const now = await $.clock.now()
    st = step(setWorking(st, working(), now), now)
    const shown = visible(st, now)
    if (shown !== (await read($, isShown))) {
      last = { left: '', table: '', right: '' }
      await update($, isShown, () => shown)
    }
    if (shown && desk && (now >= desk.until || course(st, now) !== desk.course)) {
      desk = null
      await update($, reels, (n: number) => n + 1)
    }
    if (!shown || !bandId) return
    const f = frame(st, now)
    const table = layFans(withScore(f.table, score), f.crowd)
    const next = { left: encodeTriplets(f.left), table: encodeTriplets(table), right: encodeTriplets(f.right) }
    if (next.table !== last.table) await $.ui.blit({ requestId: bandId, key: 'table', cells: next.table })
    if (next.left !== last.left) await $.ui.blit({ requestId: bandId, key: 'frogL', cells: next.left })
    if (next.right !== last.right) await $.ui.blit({ requestId: bandId, key: 'frogR', cells: next.right })
    last = next
  } catch {
    // not mounted right now (a resize, the band redrawing): the next draw remounts it
  } finally {
    busy = false
  }
}

// The clock is read before st: `st = fn(st, await ...)` would hold the st of before the await and write it back over
// whatever another hook or the tick did meanwhile.
async function act($: $, fn: (s: Show, now: number) => Show): Promise<void> {
  const now = await $.clock.now()
  st = fn(setWorking(st, working(), now), now)
  await tick($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    if (!started) {
      started = true
      st = initial(((await $.clock.now()) & 0xffff) + 1)
      scoreFor = null
      await sessionScore($) // a reload keeps this session's score; a new session starts at 0:0
      await update($, isShown, () => false) // a reload mid-turn starts from rest; the next turn starts the match
      $.clock.every(FRAME_MS, () => void tick($))
      $.clock.every(1000, () => refreshAgents($)) // background agents start and end without a turn event here
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turns++
      await act($, turnStart).catch(() => {})
    }
    const r = await next(e)
    await refreshAgents($) // a subagent's turn is running now
    await tick($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      turns = Math.max(0, turns - 1)
      if (turns === 0) {
        const now = await $.clock.now() // read before st (see act)
        const r = turnEnd(st, now, e.reason)
        st = r.show
        const point = r.point
        if (point) {
          const cur = await sessionScore($)
          score = { ...cur, [point]: cur[point] + 1 }
          const sc = score
          await update($, scoreAtom, () => sc)
        }
      }
    }
    const r = await next(e)
    await refreshAgents($)
    await tick($)
    return r
  })

  // A /clear ends the session with no session.start after it: the next session's score starts at 0:0.
  on('session.end', async ($, e, next) => {
    score = { left: 0, right: 0 }
    scoreFor = null
    return next(e)
  })

  // A prompt typed while a turn runs is queued: the frogs run into each other.
  on('prompt.submit', async ($, e, next) => {
    if (turns > 0) await act($, queued).catch(() => {})
    return next(e)
  })

  // A tool that failed (not one the person interrupted): the ball beans a frog.
  on('classic.PostToolUseFailure', async ($, e, next) => {
    st = permissionDone(st)
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
    st = permissionDone(st)
    return next(e)
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    st = permissionDone(st)
    return next(e)
  })

  // A usage, token or rate limit: asleep until the next turn.
  on('classic.StopFailure', async ($, e, next) => {
    if (LIMIT_ERRORS.has(e.error)) await act($, limit).catch(() => {})
    return next(e)
  })
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.some((w) => w.percentUsed >= 100) && turns > 0) await act($, limit).catch(() => {})
    return next(e)
  })

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
    st = agentStart(st, e.agent_id, now)
    return next(e)
  })
  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    st = agentStop(st, e.agent_id, now)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, scoreAtom) // redraws when the score moves
    await sessionScore($, false).catch(() => score) // a render never writes: the next turn's point stores it
    const now = await $.clock.now()
    // The atom makes the band redraw when it comes and goes; the clock decides, so a late tick shows nothing stale.
    const shown = (await read($, isShown)) && visible(st, now)
    if (e.surface === 'desktop') {
      await read($, reels)
      if (!shown || e.props.hasSurvey) {
        desk = null
        return next(e)
      }
      desk = reel(st, now, score)
      const { Box, Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" alignItems="center">
          <Svg
            source={svgFlipbook(desk.frames, desk.loop)}
            alt="Two frogs playing ping pong"
            width={WIDTH_PX}
            height={HEIGHT_PX}
            isInteractive
          />
        </Box>
      )
    }
    if (!shown || e.props.hasSurvey || e.surface !== 'terminal') {
      bandId = null
      return next(e)
    }
    bandId = e.requestId
    const f = frame(st, now)
    const table = layFans(withScore(f.table, score), f.crowd)
    last = { left: '', table: '', right: '' }
    const { Box, Text, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center">
        <Raster key="frogL" columns={FROG_COLUMNS} rows={ROWS} cells={encodeTriplets(f.left)} />
        <Text> </Text>
        <Raster key="table" columns={COLUMNS} rows={ROWS} cells={encodeTriplets(table)} />
        <Text> </Text>
        <Raster key="frogR" columns={FROG_COLUMNS} rows={ROWS} cells={encodeTriplets(f.right)} />
      </Box>
    )
  })
}
