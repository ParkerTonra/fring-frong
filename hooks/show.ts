// Fring Frong's state machine, pure: what the frogs are doing, moved on by events and by time, and the three
// pictures (left frog, table, right frog) for any moment. No $, no clock of its own: every call is handed `now`.

import {
  BALL,
  Canvas,
  EMPTY,
  FLY,
  FROG_DOWN,
  FROG_FACE,
  FROG_FLAT,
  FROG_SHRUG,
  FROG_SLEEP,
  FROG_TAP,
  FROG_TONGUE,
  FROG_UP,
  FROG_YAWN,
  FROGLET,
  STAR,
  TABLE,
  TONGUE,
  type Cell,
  ballAt,
  flipped,
  hopped,
  letters,
  quadCells,
  spriteCells,
  starred,
  starsAbove,
  swings,
} from './pong'

/** A fan of Claude's: one running subagent, seated since `at`, hopping off since `goneAt`. */
export type Fan = { id: string; at: number; goneAt: number | null }

export const COLUMNS = 24 // the table, in cells
export const ROWS = 3
export const FROG_COLUMNS = 8

/** Timings, in ms. */
export const T = {
  cycle: 1600, // one rally: left hit, right hit, left hit
  slowCycle: 2600, // the rally of a long turn
  longTurn: 120_000,
  yawnEvery: 9000,
  yawn: 1400,
  dash: 400, // the bonk: both run to the middle
  bonk: 1500, // seeing stars
  back: 300, // and back to their places
  beanFly: 350, // the ball on its way to a frog's head
  bean: 1200, // flipped over, dizzy
  getUp: 300,
  shrug: 1500, // an interrupted turn: the frogs shrug, then the band goes
  win: 900, // the winner's hop, then the band goes
  hop: 400,
  pop: 400, // back up after the squish
  squishMax: 60_000, // a compaction that never said it ended
  roll: 1500, // the ball rolling to a stop as they fall asleep
  wake: 900,
  fly: 1600,
  flySnap: 900, // when the tongue goes out
  flyOdds: 40, // one rally in this many
  arrive: 600, // a fan dropping in to its seat
  leave: 600, // a fan hopping off when its agent is done
  bob: 800, // a fan's bob, a whole number of them in one rally (the looped reel)
  cheer: 150, // a cheering fan's hop
} as const

/**
 * Claude's fan club (one tiny frog per running subagent): how many show; past that, "+N". Four seats of 3 columns, one
 * apart, take columns 7..21: the score's corners stay clear on the right, and "+N" (up to "+99") fits in 4..6 with
 * the left frog's end of the table free.
 */
export const MAX_FANS = 4
/** A fan's width in table columns (two quadrant pixels a column). */
export const FAN_W = 3
/** The columns each side's number takes in the table's top row, next to its frog (99 at most). */
export const SCORE_W = 2
/**
 * Where fan `k` sits (0 the one next to Claude's frog): its left column on the table. Three columns wide, one apart,
 * and clear of the score's two corner columns, so a hopping head never meets Claude's number.
 */
export const fanColumn = (k: number): number => COLUMNS - SCORE_W - FAN_W - (FAN_W + 1) * k

export type Side = 'left' | 'right'
export type Score = { left: number; right: number; session?: string }

export type Show = {
  working: boolean // a main-loop turn or a subagent runs: the match is on
  p: number // the rally, 0..2 (0 the left frog's hit, 1 the right's)
  lastAt: number // when p last moved
  turnAt: number | null // the main-loop turn running since, or null
  bonkAt: number | null
  beanAt: number | null
  beanSide: Side
  waitAt: number | null // a permission prompt waiting since
  endAt: number | null // the turn ended at: the outro runs, then the band goes
  endKind: 'shrug' | 'win'
  winner: Side
  sleepAt: number | null // asleep since (a limit), until the next turn
  sleepX: number // where the ball was when they fell asleep, in dots
  wakeAt: number | null
  squishAt: number | null
  squishEndAt: number | null
  flyAt: number | null
  flySide: Side
  fans: Fan[] // Claude's fan club: one per running subagent, oldest first, leaving ones until they are off
  seed: number
}

export const initial = (seed = 1): Show => ({
  working: false,
  p: 0,
  lastAt: 0,
  turnAt: null,
  bonkAt: null,
  beanAt: null,
  beanSide: 'left',
  waitAt: null,
  endAt: null,
  endKind: 'win',
  winner: 'left',
  sleepAt: null,
  sleepX: 0,
  wakeAt: null,
  squishAt: null,
  squishEndAt: null,
  flyAt: null,
  flySide: 'left',
  fans: [],
  seed: (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0 || 1, // spread small seeds out
})

const within = (at: number | null, now: number, ms: number): boolean => at !== null && now >= at && now - at < ms
const BONK_MS = T.dash + T.bonk + T.back
const BEAN_MS = T.beanFly + T.bean + T.getUp

/** Who touched the ball last: the left frog while it flies right (p 0..1), else the right. */
export const lastTouch = (p: number): Side => ((((p % 2) + 2) % 2) < 1 ? 'left' : 'right')

// A small seeded random number (xorshift32): the same seed, the same flies.
function rand(s: Show): number {
  let x = s.seed
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  s.seed = x >>> 0
  return s.seed / 0x100000000
}

// ---- events ----

/** Work started or stopped (a main-loop turn or a subagent): the match is on while it runs. */
export function setWorking(s: Show, working: boolean, now: number): Show {
  if (working === s.working) return s
  return working ? { ...s, working, lastAt: now } : { ...s, working, bonkAt: null, beanAt: null, waitAt: null, flyAt: null }
}

export function turnStart(s: Show, now: number): Show {
  const asleep = s.sleepAt !== null
  return { ...s, working: true, turnAt: now, lastAt: now, p: 0, endAt: null, waitAt: null, sleepAt: null, wakeAt: asleep ? now : null, bonkAt: null, beanAt: null, flyAt: null }
}

/** A main-loop turn ended: `reason` as turn.complete says. A normal answer scores a point for whoever touched last. */
export function turnEnd(s: Show, now: number, reason: string): { show: Show; point: Side | null } {
  if (s.turnAt === null) return { show: s, point: null }
  const base = { ...s, turnAt: null, waitAt: null, bonkAt: null, beanAt: null, flyAt: null, wakeAt: null }
  if (s.sleepAt !== null) return { show: base, point: null } // a limit ended it: they sleep on
  if (reason === 'aborted') return { show: { ...base, endAt: now, endKind: 'shrug' }, point: null }
  if (reason === 'answer') {
    const w = lastTouch(s.p)
    return { show: { ...base, endAt: now, endKind: 'win', winner: w }, point: w }
  }
  return { show: base, point: null }
}

/** A prompt typed while the turn runs (queued): both dash to the middle and bonk. */
export const queued = (s: Show, now: number): Show =>
  s.turnAt === null || s.sleepAt !== null || within(s.bonkAt, now, BONK_MS) ? s : { ...s, bonkAt: now }

/** A tool call failed: the ball beans the frog it was flying at. */
export function toolError(s: Show, now: number): Show {
  if (!s.working || s.sleepAt !== null || within(s.beanAt, now, BEAN_MS) || within(s.bonkAt, now, BONK_MS)) return s
  return { ...s, beanAt: now, beanSide: lastTouch(s.p) === 'left' ? 'right' : 'left' }
}

export const permissionAsked = (s: Show, now: number): Show => (s.working ? { ...s, waitAt: s.waitAt ?? now } : s)
export const permissionDone = (s: Show): Show => (s.waitAt === null ? s : { ...s, waitAt: null })

/** A usage, token or rate limit: they lie down until the next turn starts. */
export function limit(s: Show, now: number): Show {
  if (s.sleepAt !== null) return s
  return { ...s, sleepAt: now, sleepX: ballAt(s.p, COLUMNS, ROWS).x, waitAt: null, bonkAt: null, beanAt: null, flyAt: null, endAt: null }
}

export const compactStart = (s: Show, now: number): Show => ({ ...s, squishAt: now, squishEndAt: null })
export const compactEnd = (s: Show, now: number): Show => (s.squishAt === null ? s : { ...s, squishEndAt: now })
/** A subagent running (`id` its agent id): its fan arrives. One already seated stays as it is. */
export function agentStart(s: Show, id: string, now: number): Show {
  if (s.fans.some((f) => f.id === id && f.goneAt === null)) return s
  return { ...s, fans: [...s.fans.filter((f) => f.id !== id), { id, at: now, goneAt: null }] }
}
/** A subagent done: its fan hops off. */
export function agentStop(s: Show, id: string, now: number): Show {
  if (!s.fans.some((f) => f.id === id && f.goneAt === null)) return s
  return { ...s, fans: s.fans.map((f) => (f.id === id && f.goneAt === null ? { ...f, goneAt: now } : f)) }
}
/**
 * The agent list as it stands: `running` the ids running a turn (they arrive if not seated), `done` the ids it
 * names doing anything else, ended or waiting on its own background shells (they leave). A seated fan the list does
 * not name at all leaves once it has sat `grace` ms (the list can lag behind SubagentStart, and an agent can start
 * and end between two looks with its SubagentStop missed): the fans settle to the list's running count.
 */
export function syncFans(s: Show, running: readonly string[], done: readonly string[], now: number, grace = 3000): Show {
  let out = s
  for (const id of running) out = agentStart(out, id, now)
  for (const f of out.fans)
    if (f.goneAt === null && !running.includes(f.id) && (done.includes(f.id) || now - f.at >= grace)) out = agentStop(out, f.id, now)
  return out
}
/** The fans still there (not hopping off). */
export const fanCount = (s: Show): number => s.fans.filter((f) => f.goneAt === null).length
/** Fans that finished hopping off are gone. */
const prune = (s: Show, now: number): Show =>
  s.fans.some((f) => f.goneAt !== null && now - f.goneAt >= T.leave) ? { ...s, fans: s.fans.filter((f) => f.goneAt === null || now - f.goneAt < T.leave) } : s

// ---- time ----

const squishing = (s: Show, now: number): boolean =>
  s.squishAt !== null && (s.squishEndAt === null ? now - s.squishAt < T.squishMax : now - s.squishEndAt < T.pop)

/** The outro of the turn that just ended (the shrug or the winner's hop) is still playing. */
export const outro = (s: Show, now: number): boolean =>
  s.turnAt === null && s.endAt !== null && now - s.endAt < (s.endKind === 'shrug' ? T.shrug : T.win)

/** Where the band is drawn at all: work running (a turn or a subagent), sleep, an outro or a squish. */
export const visible = (s: Show, now: number): boolean => s.working || s.turnAt !== null || s.sleepAt !== null || outro(s, now) || squishing(s, now)

const rallying = (s: Show, now: number): boolean =>
  s.working && s.sleepAt === null && s.waitAt === null && !squishing(s, now) && !outro(s, now) &&
  !within(s.bonkAt, now, BONK_MS) && !within(s.beanAt, now, BEAN_MS) && !within(s.wakeAt, now, T.wake)

/** Moves the rally on to `now`: slower in a long turn, still while anything else plays out. A new rally may bring the fly. */
export function step(s: Show, now: number): Show {
  s = prune(s, now)
  const dt = Math.max(0, Math.min(500, now - s.lastAt))
  if (!rallying(s, now)) return s.lastAt === now ? s : { ...s, lastAt: now }
  const long = s.turnAt !== null && now - s.turnAt >= T.longTurn
  const p = s.p + (2 * dt) / (long ? T.slowCycle : T.cycle)
  const next = { ...s, lastAt: now, p: p % 2 }
  if (p >= 2 && next.flyAt === null) {
    if (Math.floor(rand(next) * T.flyOdds) === 0) {
      next.flyAt = now
      next.flySide = rand(next) < 0.5 ? 'left' : 'right'
    }
  } else if (next.flyAt !== null && now - next.flyAt >= T.fly) next.flyAt = null
  return next
}

// ---- pictures ----

/** A big frog's pose by name: the terminal's sprite in pong.ts, and the desktop's detailed one in sprites.ts. */
export type PoseName = 'up' | 'down' | 'face' | 'tap' | 'shrug' | 'yawn' | 'sleep' | 'flat' | 'tongue'
const POSES: Readonly<Record<PoseName, readonly string[]>> = {
  up: FROG_UP,
  down: FROG_DOWN,
  face: FROG_FACE,
  tap: FROG_TAP,
  shrug: FROG_SHRUG,
  yawn: FROG_YAWN,
  sleep: FROG_SLEEP,
  flat: FROG_FLAT,
  tongue: FROG_TONGUE,
}
/** A big frog at one moment: its pose, hopped a pixel up, flipped over, stars twinkling over it (their phase). */
export type FrogLook = { pose: PoseName; hop?: boolean; flip?: boolean; stars?: number }
/**
 * What a frame shows, by name rather than by cell: the frogs (null: off at the bonk), the ball (top-left, in dots)
 * and the bonk's froglets (left column, mirrored, stars phase). The desktop's detailed sprites draw from this; the
 * terminal and the plain desktop drawing use the cells.
 */
export type Look = {
  left: FrogLook | null
  right: FrogLook | null
  ball: { x: number; y: number } | null
  froglets: { column: number; mirror: boolean; stars?: number }[]
}

/** `crowd`: Claude's fans, laid on the table as cells by layFans; `look`: the frame by name (see Look). */
export type Frame = { left: Cell[]; table: Cell[]; right: Cell[]; crowd?: Crowd; look?: Look }

/** A FrogLook's pixel rows, as the terminal draws it. */
export function frogPixels(l: FrogLook | null): readonly string[] {
  if (!l) return EMPTY
  let p: readonly string[] = POSES[l.pose]
  if (l.flip) p = flipped(p)
  if (l.stars !== undefined) p = starred(p, l.stars)
  if (l.hop) p = hopped(p)
  return p
}
const frogCells = (l: FrogLook | null, side: Side): Cell[] => spriteCells(frogPixels(l), side === 'right')
const zzz = (cells: Cell[], t: number): Cell[] => letters(cells, FROG_COLUMNS, 0, ['z Z z   ', ' z Z z  ', '  z Z z '][Math.floor(t / 400) % 3]!, 0x9aa8c8)

/** Braille colours that stay over the fans: the ball, the fly, the tongue. */
const ON_TOP = new Set([BALL, FLY, TONGUE])

/** One fan at one moment: its left column on the table, how many whole cell rows up (0..2), cheering, which way it looks. */
export type Pose = { column: number; lift: number; cheer: boolean; look: Side }
/** The fan club at one moment: the fans in their seats (at most MAX_FANS) and how many more there are. */
export type Crowd = { fans: Pose[]; more: number }

/**
 * Where each fan is at `now`: arriving drops in from the top row, seated bobs a cell up (each a beat after the one
 * beside it), leaving hops off to the right; all of them cheer while Claude's frog (the right) hops for a point it
 * won (star eyes, a quick hop a cell up), and sit still while the frogs sleep. Every move is by whole cells: a fan is
 * one cell row tall, and half a cell off would put see-through, eye and face colours in one cell (three colours).
 * Seated, bobbing and cheering they keep below the top row, the fly's.
 */
export function crowd(s: Show, now: number): Crowd {
  const shown = s.fans.slice(0, MAX_FANS)
  const more = fanCount(s) - shown.filter((f) => f.goneAt === null).length
  const cheering = outro(s, now) && s.endKind === 'win' && s.winner === 'right'
  const asleep = s.sleepAt !== null
  // the fans watch the ball: their eyes follow it while the rally runs (it is in cells here, its dots halved)
  const ballColumn = s.working && s.sleepAt === null ? ballAt(s.p, COLUMNS, ROWS).x / 2 : -1
  const fans = shown.map((f, k): Pose => {
    const column = fanColumn(k)
    const look: Side = ballColumn > column + FAN_W / 2 ? 'right' : 'left'
    if (f.goneAt !== null) {
      const t = Math.max(0, now - f.goneAt)
      const hop = Math.floor((t / T.leave) * 3) // three hops to the right, off the table
      return { column: column + 1 + hop, lift: hop % 2 === 0 ? 1 : 0, cheer: false, look: 'right' }
    }
    const t = now - f.at
    if (t >= 0 && t < T.arrive) return { column, lift: 2 - Math.floor((t / T.arrive) * 3), cheer: false, look }
    if (asleep) return { column, lift: 0, cheer: false, look: 'left' }
    if (cheering) return { column, lift: Math.floor(now / T.cheer + k) % 2 === 0 ? 1 : 0, cheer: true, look }
    const ph = (((now + k * (T.bob / 4)) % T.bob) + T.bob) % T.bob
    return { column, lift: ph < T.bob / 4 ? 1 : 0, cheer: false, look }
  })
  return { fans, more }
}

/**
 * A fan as quadrant pixels (half a cell wide, half a cell tall): the big frog made tiny, 6 wide and 2 tall, 3 x 1
 * cells. Black-dot eyes on top, to the side it looks (no whites: a white and a pupil over green would be three
 * colours in one cell), the brown mouth under them, no shirt. Cheering: star-yellow eyes and the mouth open black.
 * Each 2 x 2 block holds two colours, so every cell draws exactly.
 */
export const FAN: Readonly<Record<'left' | 'right' | 'cheer', readonly string[]>> = {
  left: ['KGGGKG', 'GGRRGG'],
  right: ['GKGGGK', 'GGRRGG'],
  cheer: ['GYGGYG', 'GGKKGG'],
}
const FAN_CELLS = { left: quadCells(FAN.left), right: quadCells(FAN.right), cheer: quadCells(FAN.cheer) }
const fanCells = (f: Pose): readonly Cell[] => FAN_CELLS[f.cheer ? 'cheer' : f.look]

/**
 * Claude's fans as tiny quadrant-pixel frogs laid over the table (the terminal's Raster and the desktop's Svg alike),
 * one cell row each, sitting on its bottom row `lift` rows up, with "+N" dimly left of the last seat. A fan covers
 * only plain table cells: the ball, the fly, the tongue, a froglet and the score stay on top.
 */
export function layFans(table: readonly Cell[], c: Crowd | undefined): Cell[] {
  const out = table.map((x) => [...x] as Cell)
  if (!c || (c.fans.length === 0 && c.more <= 0)) return out
  const plain = (i: number) => {
    const x = out[i]!
    return x[0] >= 0x2800 && x[0] <= 0x28ff && !ON_TOP.has(x[1])
  }
  for (const f of c.fans) {
    const row = ROWS - 1 - Math.max(0, Math.min(ROWS - 1, f.lift))
    fanCells(f).forEach((cell, i) => {
      const col = f.column + i
      if (col < 0 || col >= COLUMNS || cell[0] === 0x20) return
      const at = row * COLUMNS + col
      if (plain(at)) out[at] = [...cell] as Cell
    })
  }
  if (c.more > 0) {
    const text = '+' + Math.min(99, c.more)
    const right = fanColumn(MAX_FANS - 1) - 1
    ;[...text].forEach((ch, i) => {
      const at = (ROWS - 1) * COLUMNS + right - text.length + 1 + i
      if (at >= (ROWS - 1) * COLUMNS && plain(at)) out[at] = [ch.codePointAt(0)!, TABLE, 0x01000000]
    })
  }
  return out
}

/** Each side's number (capped at 99), or '' for both before the first point. */
export const scoreText = (sc: Score): { left: string; right: string } =>
  sc.left + sc.right > 0 ? { left: String(Math.min(99, sc.left)), right: String(Math.min(99, sc.right)) } : { left: '', right: '' }

/**
 * The score by its frogs: the user's number dimly in the table's top-left corner, beside the left frog's head, and
 * Claude's in the top-right corner beside the right frog's. The ball never flies that high at the ends, the bonk's
 * stars twinkle in the middle, and the fans' seats keep clear of those columns.
 */
export function withScore(table: readonly Cell[], sc: Score): Cell[] {
  const text = scoreText(sc)
  const out = table.map((c) => [...c] as Cell)
  const lay = (s: string, at: number) => [...s].forEach((ch, i) => (out[at + i] = [ch.codePointAt(0)!, TABLE, 0x01000000]))
  lay(text.left, 0)
  lay(text.right, COLUMNS - text.right.length)
  return out
}

/** The pictures at `now`, from the most pressing thing going on down to the plain rally; Claude's fans with them. */
export function frame(s: Show, now: number): Frame {
  const f = matchFrame(s, now)
  return s.fans.length > 0 ? { ...f, crowd: crowd(s, now) } : f
}

function matchFrame(s: Show, now: number): Frame {
  const c = new Canvas(COLUMNS, ROWS)
  c.table()
  const b = ballAt(s.p, COLUMNS, ROWS)
  const restY = ROWS * 4 - 3
  let ballPos: { x: number; y: number } | null = null
  const ball = (x: number, y: number) => {
    c.ball(x, y)
    ballPos = { x: Math.round(x), y: Math.round(y) }
  }
  // the three pictures, the frogs by name: the cells follow from the names, a letter or two laid over them
  const out = (l: FrogLook | null, r: FrogLook | null, over?: { left?: (x: Cell[]) => Cell[]; right?: (x: Cell[]) => Cell[] }, table?: Canvas, froglets: Look['froglets'] = []): Frame => {
    const lc = frogCells(l, 'left')
    const rc = frogCells(r, 'right')
    return {
      left: over?.left ? over.left(lc) : lc,
      table: (table ?? c).cells(),
      right: over?.right ? over.right(rc) : rc,
      look: { left: l, right: r, ball: table ? null : ballPos, froglets },
    }
  }

  if (s.sleepAt !== null) {
    const t = now - s.sleepAt
    const k = Math.min(1, t / T.roll)
    ball(Math.min(COLUMNS * 2 - 2, s.sleepX + 8 * (1 - (1 - k) * (1 - k))), restY) // rolls on, slowing to a stop
    return out({ pose: 'sleep' }, { pose: 'sleep' }, { left: (x) => zzz(x, t), right: (x) => zzz(x, t + 600) })
  }
  if (outro(s, now)) {
    const t = now - s.endAt!
    ball(b.x, b.y) // frozen in mid-air
    if (s.endKind === 'shrug') return out({ pose: 'shrug' }, { pose: 'shrug' })
    const hop = t < T.hop
    return out(
      s.winner === 'left' && hop ? { pose: 'up', hop: true } : { pose: 'down' },
      s.winner === 'right' && hop ? { pose: 'up', hop: true } : { pose: 'down' },
    )
  }
  if (squishing(s, now)) {
    const popping = s.squishEndAt !== null
    ball(b.x, restY)
    const pose: PoseName = popping ? 'up' : 'flat'
    return out({ pose }, { pose })
  }
  if (s.waitAt !== null) {
    ball(COLUMNS - 1, restY) // resting mid-table
    const tap = Math.floor((now - s.waitAt) / 250) % 2 === 1
    return out({ pose: 'face' }, { pose: tap ? 'tap' : 'face' })
  }
  if (within(s.bonkAt, now, BONK_MS)) {
    const t = now - s.bonkAt!
    const meet = COLUMNS / 2 - 4 // the left froglet's column when they touch
    const k = t < T.dash ? t / T.dash : t < T.dash + T.bonk ? 1 : 1 - (t - T.dash - T.bonk) / T.back
    const lc = Math.round(k * meet)
    const rc = COLUMNS - 4 - lc
    const dizzy = t >= T.dash && t < T.dash + T.bonk
    const blank = new Canvas(COLUMNS, ROWS)
    blank.table()
    // seeing stars: the froglets keep their row, a row of stars twinkles in the cell row over their heads
    const ph = Math.floor(t / 200)
    if (dizzy) {
      blank.sprite(spriteCells(starsAbove(FROGLET, ph)), 4, lc, 0)
      blank.sprite(spriteCells(starsAbove(FROGLET, ph + 1), true), 4, rc, 0)
    } else {
      blank.sprite(spriteCells(FROGLET), 4, lc, 1)
      blank.sprite(spriteCells(FROGLET, true), 4, rc, 1)
    }
    if (dizzy) blank.put(COLUMNS / 2 - 1 + (Math.floor(t / 200) % 2), 0, [0x2736, STAR, 0x01000000]) // ✶
    const stars = (p: number) => (dizzy ? { stars: p } : {})
    return out(null, null, undefined, blank, [
      { column: lc, mirror: false, ...stars(ph) },
      { column: rc, mirror: true, ...stars(ph + 1) },
    ])
  }
  if (within(s.beanAt, now, BEAN_MS)) {
    const t = now - s.beanAt!
    const side = s.beanSide
    if (t < T.beanFly) {
      const k = t / T.beanFly
      const tx = side === 'left' ? 0 : COLUMNS * 2 - 2
      ball(b.x + (tx - b.x) * k, b.y + (0 - b.y) * k)
      return out({ pose: 'down' }, { pose: 'down' })
    }
    const down = t < T.beanFly + T.bean
    const hit: FrogLook = down ? { pose: 'down', flip: true, stars: Math.floor(t / 200) } : { pose: 'up' }
    ball(side === 'left' ? 2 : COLUMNS * 2 - 4, restY)
    return side === 'left' ? out(hit, { pose: 'down' }) : out({ pose: 'down' }, hit)
  }
  if (within(s.wakeAt, now, T.wake)) {
    ball(b.x, restY)
    return out({ pose: 'up' }, { pose: 'sleep' }, {
      left: (x) => letters(x, FROG_COLUMNS, 0, '   !    ', STAR),
      right: (x) => zzz(x, now - s.wakeAt!),
    })
  }

  // The rally, with its extras: the fly and the yawns of a long turn.
  ball(b.x, b.y)
  const sw = swings(s.p)
  let left: FrogLook = { pose: sw.left ? 'up' : 'down' }
  let right: FrogLook = { pose: sw.right ? 'up' : 'down' }
  if (s.flyAt !== null && now - s.flyAt < T.fly) {
    const t = now - s.flyAt
    const k = t / T.fly
    const fromLeft = s.flySide === 'right' // it flies toward the frog that snaps it
    const fx = fromLeft ? k * COLUMNS * 2 : (1 - k) * COLUMNS * 2
    const snap = t >= T.flySnap && t < T.flySnap + 300
    if (t < T.flySnap) {
      c.dot(fx, 1 + (Math.floor(t / 100) % 2), FLY)
      c.dot(fx + 1, 1, FLY)
    }
    if (snap) {
      const reach = Math.round(COLUMNS * 2 * 0.35)
      for (let i = 0; i < reach; i++) c.dot(s.flySide === 'left' ? i : COLUMNS * 2 - 1 - i, 5, TONGUE)
    }
    if (t >= T.flySnap) {
      // busy with the fly, the snapper misses the ball
      const busy: FrogLook = { pose: snap ? 'tongue' : 'down' }
      if (s.flySide === 'left') left = busy
      else right = busy
    }
  }
  if (s.turnAt !== null && now - s.turnAt >= T.longTurn) {
    const since = now - s.turnAt - T.longTurn
    if (since % T.yawnEvery < T.yawn) {
      const who: Side = Math.floor(since / T.yawnEvery) % 2 === 0 ? 'left' : 'right'
      if (who === 'left' && !sw.left) left = { pose: 'yawn' }
      if (who === 'right' && !sw.right) right = { pose: 'yawn' }
    }
  }
  return out(left, right)
}


// ---- the desktop reel ----

/**
 * What the show is doing, as a key: it changes whenever the pictures take a turn no reel could foresee (an event,
 * the fly, a long turn starting, a reaction ending, a fan coming or going). The desktop band redraws when it changes.
 */
export const course = (s: Show, now: number): string =>
  JSON.stringify([
    s.working, s.turnAt, s.sleepAt, s.endAt, s.endKind, s.winner, s.squishAt, s.squishEndAt, s.waitAt, s.bonkAt, s.beanAt, s.wakeAt, s.flyAt, s.fans,
    squishing(s, now), within(s.bonkAt, now, BONK_MS), within(s.beanAt, now, BEAN_MS), within(s.wakeAt, now, T.wake), outro(s, now),
    s.turnAt !== null && now - s.turnAt >= T.longTurn,
  ])

export const REEL_MS = 2000 // how far ahead a reel that does not loop is drawn
export const REEL_STEP = 66 // its frame time, the terminal's tick

export type Reel = { frames: { frame: Frame; ms: number }[]; loop: boolean; until: number; course: string }

/**
 * The pictures from `now` on (the score by its frogs, the fans on the table), worked out ahead with the same step
 * and frame the terminal ticks through: one rally looped while nothing else goes on, else the next REEL_MS played
 * once (`until`: when it runs out).
 */
export function reel(s: Show, now: number, sc: Score = { left: 0, right: 0 }): Reel {
  const settled = s.fans.every((f) => f.goneAt === null && now - f.at >= T.arrive) // no fan coming or going
  const plain = rallying(s, now) && s.flyAt === null && settled && !(s.turnAt !== null && now - s.turnAt + T.cycle >= T.longTurn)
  const span = plain ? T.cycle : REEL_MS
  const frames: { frame: Frame; ms: number }[] = []
  let st = { ...s, lastAt: now }
  for (let t = 0; t < span; t += REEL_STEP) {
    st = step(st, now + t)
    // a looped rally keeps the fly out: if one comes, the show changes course and the band redraws then
    const f = frame(plain ? { ...st, flyAt: null } : st, now + t)
    frames.push({ frame: { ...f, table: layFans(withScore(f.table, sc), f.crowd) }, ms: Math.min(REEL_STEP, span - t) })
  }
  return { frames, loop: plain, until: plain ? Infinity : now + span, course: course(s, now) }
}
