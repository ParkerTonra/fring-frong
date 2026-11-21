// The game both stages draw: the show (show.ts), the score and the work running, kept for the session. register.tsx
// moves it on from the events; a stage (stage.ts) draws it and ticks it on its clock.

import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface } from 'claude-code'

import type { Score } from '../types'
import { type Show, initial, syncFans } from './show'

type $ = CoreEngineInterface

// The mod's own $.state values, under the plugin's own name (its manifest's `name`; a build under another name changes
// it here, and only here). Only this file reads and writes them.
/** The band is drawn (Fring Frong's match: the band comes and goes with it). */
const isShown = atom({ plugin: 'fring-frong', key: 'isShown' } as const, false)
// The match's score (a point to whoever touched the ball last when a turn answers), kept across reloads of the mod
// but not past its session: it carries the session's id, and a score of another session (a /clear, a resume) is 0:0.
const scoreAtom = atom({ plugin: 'fring-frong', key: 'score' } as const, { left: 0, right: 0 })
// Bumped to redraw the desktop band with a new reel.
const reels = atom({ plugin: 'fring-frong', key: 'reels' } as const, 0)

export function readShown($: $): Promise<boolean> {
  return read($, isShown)
}
export async function writeShown($: $, v: boolean): Promise<void> {
  await update($, isShown, () => v)
}
/** The stored score, read so a render redraws when it moves. */
export function readScore($: $): Promise<Score> {
  return read($, scoreAtom)
}
export function readReels($: $): Promise<number> {
  return read($, reels)
}
export async function bumpReels($: $): Promise<void> {
  await update($, reels, (n: number) => n + 1)
}

export const game = {
  st: initial(1) as Show,
  score: { left: 0, right: 0 } as Score,
  scoreFor: null as string | null, // the session the score belongs to
  // Main-loop turns running, plus this session's subagents that are running a turn (background ones too): the frogs
  // play ping pong while either is there. An agent that is waiting on its own background shells, or idle, is not
  // running; monitors and other background shells are not agents.
  turns: 0,
  agentsRunning: 0,
}

export const working = (): boolean => game.turns > 0 || game.agentsRunning > 0

/** This session's score: the stored one when it is this session's, else a fresh 0:0 (written to the atom unless `write` is false, as while drawing). */
export async function sessionScore($: $, write = true): Promise<Score> {
  const id = await $.session.id()
  if (game.scoreFor === id) return game.score
  const stored = await read($, scoreAtom)
  game.score = stored.session === id ? { left: stored.left, right: stored.right, session: id } : { left: 0, right: 0, session: id }
  game.scoreFor = id
  if (write && stored.session !== id) {
    const fresh = game.score
    await update($, scoreAtom, () => fresh)
  }
  return game.score
}

/**
 * Claude's fan club (show.ts): a tiny frog for each subagent running a turn, seated by SubagentStart or the list, off
 * when it ends or only waits.
 */
export async function refreshAgents($: $): Promise<void> {
  try {
    const list = await $.agent.list()
    const mine = list.filter((a) => a.kind === 'local_agent')
    game.agentsRunning = mine.filter((a) => a.status === 'running').length
    const now = await $.clock.now()
    game.st = syncFans(game.st, mine.filter((a) => a.status === 'running').map((a) => a.id), mine.filter((a) => a.status !== 'running').map((a) => a.id), now)
  } catch {
    // keep the last count
  }
}

/** A point to `side` in this session's score, stored. */
export async function addPoint($: $, side: 'left' | 'right'): Promise<void> {
  const cur = await sessionScore($)
  game.score = { ...cur, [side]: cur[side] + 1 }
  const sc = game.score
  await update($, scoreAtom, () => sc)
}
