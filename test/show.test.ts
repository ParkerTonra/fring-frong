import { expect, test } from 'claude-code/testing'

import { BALL, DEFAULT_COLOR, FROGLET, FROG_DOWN, FROG_TAP, FROG_TONGUE, FROG_UP, FROG_YAWN, PALETTE, QUAD, STAR, hopped, spriteCells, starred, starsAbove } from '../hooks/pong'
import {
  COLUMNS,
  FAN,
  FAN_W,
  MAX_FANS,
  ROWS,
  SCORE_W,
  T,
  type Crowd,
  type Pose,
  agentStart,
  agentStop,
  crowd,
  fanColumn,
  fanCount,
  frame,
  frogPixels,
  initial,
  lastTouch,
  layFans,
  limit,
  permissionAsked,
  queued,
  scoreText,
  setWorking,
  step,
  syncFans,
  turnEnd,
  turnStart,
  visible,
  withScore,
} from '../hooks/show'

const run = (s: ReturnType<typeof initial>, from: number, to: number, dt = 66) => {
  for (let t = from; t <= to; t += dt) s = step(s, t)
  return s
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

test('a long turn slows the rally, and a frog yawns now and then', () => {
  const quick = run(turnStart(initial(), 0), 0, 800)
  const late = run(turnStart(initial(), 0), 0, T.longTurn)
  const p0 = late.p
  const slow = run(late, T.longTurn, T.longTurn + 800)
  const moved = (slow.p - p0 + 2) % 2
  expect(moved).toBeLessThan(quick.p)
  let yawned = false
  let s = late
  for (let t = T.longTurn; t < T.longTurn + T.yawnEvery * 2; t += 66) {
    s = step(s, t)
    const f = frame(s, t)
    if (same(f.left, spriteCells(FROG_YAWN)) || same(f.right, spriteCells(FROG_YAWN, true))) yawned = true
  }
  expect(yawned).toBe(true)
})

test('about one rally in 40 brings the fly, the same for the same seed, and a frog snaps it with its tongue', () => {
  let flies = 0
  let snapped = false
  for (let seed = 1; seed <= 200; seed++) {
    let s = turnStart(initial(seed), 0)
    for (let t = 0; t <= T.cycle + 66 * 3; t += 66) s = step(s, t)
    if (s.flyAt !== null) {
      flies++
      const at = s.flyAt + T.flySnap + 50
      const f = frame({ ...s, lastAt: at }, at)
      if (same(f.left, spriteCells(FROG_TONGUE)) || same(f.right, spriteCells(FROG_TONGUE, true))) snapped = true
    }
  }
  expect(flies).toBeGreaterThan(0)
  expect(flies).toBeLessThan(20) // 200 rallies: about 5
  expect(snapped).toBe(true)
  const a = run(turnStart(initial(7), 0), 0, 30_000)
  const b = run(turnStart(initial(7), 0), 0, 30_000)
  expect(a.seed).toBe(b.seed)
})

test('the winner is who touched last, and hops once', () => {
  expect(lastTouch(0.5)).toBe('left')
  expect(lastTouch(1.5)).toBe('right')
  const s = { ...turnStart(initial(), 0), p: 1.4 }
  const { show, point } = turnEnd(s, 1000, 'answer')
  expect(point).toBe('right')
  expect(same(frame(show, 1100).right, spriteCells(hopped(FROG_UP), true))).toBe(true)
  expect(same(frame(show, 1000 + T.hop + 50).right, spriteCells(hopped(FROG_UP), true))).toBe(false)
  expect(visible(setWorking(show, false, 1000), 1000 + T.win)).toBe(false) // the main turn was the only work
  expect(visible(show, 1000 + T.win)).toBe(true) // a subagent still running: the match goes on after the hop
  expect(same(frame(show, 1000 + T.win).right, spriteCells(hopped(FROG_UP), true))).toBe(false)
})

test('waiting on the person: the right frog taps its foot', () => {
  const s = permissionAsked(turnStart(initial(), 0), 100)
  const frames = [100, 350, 600, 850].map((t) => same(frame(s, t).right, spriteCells(FROG_TAP, true)))
  expect(frames.some((x) => x)).toBe(true)
  expect(frames.every((x) => x)).toBe(false)
})

test('asleep, the ball rolls to a stop and they stay asleep past the turn', () => {
  const s = limit(run(turnStart(initial(), 0), 0, 500), 500)
  expect(same(frame(s, 500 + T.roll).table, frame(s, 500 + T.roll * 3).table)).toBe(true)
  expect(same(frame(s, 600).table, frame(s, 500 + T.roll).table)).toBe(false)
  const ended = turnEnd(s, 900, 'error').show
  expect(visible(ended, 100_000)).toBe(true)
  expect(turnStart(ended, 100_000).sleepAt).toBe(null)
})

test('star rows fit the sprite they twinkle on: the bean frog keeps its 8-wide row, the froglet gets 4', () => {
  expect(starred(FROG_DOWN, 0)[0]).toBe('Y..Y...Y')
  expect(starred(FROG_DOWN, 1)[0]).toBe('.Y...Y..')
  for (const ph of [0, 1]) {
    const up = starsAbove(FROGLET, ph)
    expect(up.every((r) => r.length === 4)).toBe(true)
    expect(up.slice(2)).toEqual([...FROGLET]) // the froglet itself whole, under its stars
    expect(spriteCells(up).length).toBe(4 * 3)
  }
})

test('the bonk: whole froglets meet mid-table with stars over their heads, not garbled', () => {
  const r0 = run(turnStart(initial(3), 0), 0, 500)
  const s = queued(r0, 500)
  const row = (cells: readonly number[][], r: number, c: number, w: number) => cells.slice(r * COLUMNS + c, r * COLUMNS + c + w)
  const lc = COLUMNS / 2 - 4
  const rc = COLUMNS - 4 - lc
  for (const dt of [T.dash + 100, T.dash + 300]) {
    const f = frame(s, 500 + dt)
    // the froglet's body cells, rows 1 and 2, exactly the plain froglet's
    const body = spriteCells(FROGLET)
    expect(row(f.table, 1, lc, 4).concat(row(f.table, 2, lc, 4))).toEqual(body)
    expect(row(f.table, 1, rc, 4).concat(row(f.table, 2, rc, 4))).toEqual(spriteCells(FROGLET, true))
    // stars in the row above, nothing else of the froglet up there
    expect(row(f.table, 0, lc, 8).some((c) => c[1] === STAR)).toBe(true)
  }
  const dashing = frame(s, 500 + 100) // on the way: no stars yet, the froglets in their row
  expect(dashing.table.some((c) => c[1] === STAR)).toBe(false)
})

test('a subagent running with no main turn: the match is on, and ends when it does', () => {
  const s = setWorking(initial(), true, 0)
  expect(visible(s, 100)).toBe(true)
  const moved = step(step(s, 100), 400)
  expect(moved.p).toBeGreaterThan(0) // they rally
  expect(visible(setWorking(moved, false, 500), 600)).toBe(false)
})

test('every frame names its frogs and ball (the desktop sprites) the same as its cells show them', () => {
  const states = [
    turnStart(initial(), 0),
    queued(turnStart(initial(), 0), 0),
    limit(turnStart(initial(), 0), 0),
    permissionAsked(turnStart(initial(), 0), 0),
    turnEnd({ ...turnStart(initial(), 0), p: 1.4 }, 0, 'answer').show,
    turnEnd(turnStart(initial(), 0), 0, 'aborted').show,
  ]
  let seen = 0
  for (const s0 of states) {
    let s = s0
    for (let t = 0; t < 3000; t += 66) {
      s = step(s, t)
      const f = frame(s, t)
      expect(f.look).not.toBe(undefined)
      // every cell but a letter laid over it is the named pose's sprite
      const wantL = spriteCells(frogPixels(f.look!.left))
      const wantR = spriteCells(frogPixels(f.look!.right), true)
      const block = (c: readonly number[]) => c[0] === 0x2580 || c[0] === 0x2584 || c[0] === 0x20
      f.left.forEach((c, i) => block(c) && expect(c).toEqual(wantL[i]!))
      f.right.forEach((c, i) => block(c) && expect(c).toEqual(wantR[i]!))
      if (f.look!.ball) {
        const i = Math.floor(f.look!.ball.y / 4) * COLUMNS + Math.floor(f.look!.ball.x / 2)
        expect(f.table[i]![1]).toBe(BALL)
        seen++
      }
    }
  }
  expect(seen).toBeGreaterThan(50)
})

// ---- the score by its frogs ----

test('each number sits by its frog: the user\'s in the top-left corner, Claude\'s in the top-right', () => {
  expect(scoreText({ left: 0, right: 0 })).toEqual({ left: '', right: '' })
  expect(scoreText({ left: 3, right: 0 })).toEqual({ left: '3', right: '0' })
  expect(scoreText({ left: 150, right: 12 })).toEqual({ left: '99', right: '12' })
  const t = withScore(frame(turnStart(initial(), 0), 0).table, { left: 4, right: 7 })
  expect(t.length).toBe(COLUMNS * 3)
  expect(String.fromCodePoint(t[0]![0])).toBe('4')
  expect(String.fromCodePoint(t[COLUMNS - 1]![0])).toBe('7')
  const two = withScore(frame(turnStart(initial(), 0), 0).table, { left: 12, right: 34 })
  expect(String.fromCodePoint(two[0]![0], two[1]![0])).toBe('12')
  expect(String.fromCodePoint(two[COLUMNS - 2]![0], two[COLUMNS - 1]![0])).toBe('34')
  expect(two.slice(SCORE_W, COLUMNS - SCORE_W).every((c) => c[0] >= 0x2800 && c[0] <= 0x28ff)).toBe(true) // nothing between
})

// Claude's fan club: one tiny frog per running subagent.
const seat = (n: number, at = 0) => {
  let s = turnStart(initial(), 0)
  for (let i = 0; i < n; i++) s = agentStart(s, 'a' + i, at)
  return s
}

test('the numbers\' corners stay clear: the ball, the bonk\'s froglets and star, and the seated fans never reach them', () => {
  const corners = [0, 1, COLUMNS - 2, COLUMNS - 1]
  for (let p = 0; p < 2; p += 0.01) {
    const f = frame({ ...turnStart(initial(), 0), p }, 0)
    for (const i of corners) expect(f.table[i]![1] === BALL).toBe(false)
  }
  const b = queued(turnStart(initial(), 0), 0)
  for (let t = 0; t < T.dash + T.bonk + T.back; t += 33) {
    const f = frame(b, t)
    for (const i of corners) expect(f.table[i]![0] >= 0x2800 && f.table[i]![0] <= 0x28ff).toBe(true)
  }
  const s = seat(MAX_FANS + 2)
  for (let t = T.arrive; t < T.arrive + 2000; t += 50) {
    for (const f of crowd(s, t).fans) {
      expect(f.column).toBeGreaterThanOrEqual(SCORE_W)
      expect(f.column + FAN_W).toBeLessThanOrEqual(COLUMNS - SCORE_W)
    }
  }
})

test('a fan per agent, seated right to left from Claude\'s frog; one agent seated twice is one fan', () => {
  const s = agentStart(seat(3), 'a1', 50)
  expect(fanCount(s)).toBe(3)
  const c = crowd(s, T.arrive + 10)
  expect(c.fans.map((f) => f.column)).toEqual([fanColumn(0), fanColumn(1), fanColumn(2)])
  expect(c.fans[0]!.column + FAN_W).toBe(COLUMNS - SCORE_W)
  expect(c.fans[1]!.column + FAN_W).toBeLessThan(c.fans[0]!.column)
  expect(c.more).toBe(0)
})

test('past MAX_FANS the rest are counted, not drawn', () => {
  const c = crowd(seat(MAX_FANS + 4), T.arrive + 10)
  expect(c.fans.length).toBe(MAX_FANS)
  expect(c.more).toBe(4)
})

test('arriving, a fan drops in from above; seated, it bobs; leaving, it hops off right and is gone after T.leave', () => {
  const s = seat(1, 1000)
  expect(crowd(s, 1000).fans[0]!.lift).toBe(2)
  expect(crowd(s, 1000 + T.arrive - 1).fans[0]!.lift).toBe(0)
  const lifts = new Set([0, 100, 200, 300, 400, 500, 600, 700].map((t) => crowd(s, 2000 + t).fans[0]!.lift))
  expect([...lifts].sort()).toEqual([0, 1])
  const off = agentStop(s, 'a0', 3000)
  expect(fanCount(off)).toBe(0)
  const cols = [0, 250, 450].map((t) => crowd(off, 3000 + t).fans[0]!.column)
  expect(cols[2]!).toBeGreaterThan(cols[0]!)
  expect(step(off, 3000 + T.leave).fans.length).toBe(0)
  expect(agentStop(off, 'a0', 3100)).toBe(off)
})

test('the agent list: running ids arrive, done (or only waiting) ids leave, an unlisted one leaves after 3 s', () => {
  let s = syncFans(initial(), ['a', 'b'], [], 0)
  expect(fanCount(s)).toBe(2)
  s = syncFans(s, ['a'], ['b'], 100)
  expect(fanCount(s)).toBe(1)
  s = agentStart(s, 'c', 200)
  expect(fanCount(syncFans(s, ['a'], [], 1000))).toBe(2)
  expect(fanCount(syncFans(s, ['a'], [], 3200))).toBe(1)
})

test('the fans cheer while Claude\'s frog hops for its point, not the user\'s, and sit still asleep', () => {
  const s = { ...seat(2), p: 1.4 }
  expect(crowd(turnEnd(s, 5000, 'answer').show, 5010).fans.every((f) => f.cheer)).toBe(true)
  expect(crowd(turnEnd({ ...s, p: 0.4 }, 5000, 'answer').show, 5010).fans.some((f) => f.cheer)).toBe(false)
  expect(crowd(limit(s, 5000), 6000).fans.every((f) => f.lift === 0)).toBe(true)
})

test('fans are tiny frogs (6 x 2 quadrant pixels, 3 x 1 cells), eyes following the ball; star-yellow cheering', () => {
  for (const px of Object.values(FAN)) {
    expect(px.length).toBe(2)
    expect(px.every((r) => r.length === FAN_W * 2)).toBe(true)
  }
  expect(FAN.cheer[0]!.includes('Y')).toBe(true)
  const s = seat(1)
  const looks = new Set<string>()
  for (let p = 0; p < 2; p += 0.05) looks.add(crowd({ ...s, p }, T.arrive + 10).fans[0]!.look)
  expect([...looks].sort()).toEqual(['left', 'right'])
})

test('fans are cells over plain table cells only: the ball and the score stay on top, "+N" for the rest', () => {
  const s = seat(MAX_FANS + 2)
  const f = frame(s, T.arrive + 10)
  const t = layFans(withScore(f.table, { left: 3, right: 4 }), f.crowd)
  expect(t.every((c) => c[0] < 0x10000)).toBe(true) // width-1 BMP only: what a Raster takes
  expect(String.fromCodePoint(t[0]![0], t[COLUMNS - 1]![0])).toBe('34')
  expect(t.slice(2 * COLUMNS).map((c) => String.fromCodePoint(c[0])).join('').includes('+2')).toBe(true)
  expect(frame(turnStart(initial(), 0), 100).crowd).toBe(undefined)
})

test('no fan cell holds more than 2 colours at any lift: each draws its 2 x 2 pixels exactly', () => {
  const poses: Pose[] = []
  for (const cheer of [false, true]) for (const look of ['left', 'right'] as const) for (let lift = 0; lift < ROWS; lift++) poses.push({ column: fanColumn(1), lift, cheer, look })
  const blank = Array.from({ length: COLUMNS * ROWS }, () => [0x2800, 0x5a6a78, DEFAULT_COLOR] as [number, number, number])
  for (const p of poses) {
    const t = layFans(blank, { fans: [p], more: 0 } satisfies Crowd)
    const px = FAN[p.cheer ? 'cheer' : p.look]
    for (const [i, c] of t.entries()) {
      if (c[0] === 0x2800) continue
      const mask = QUAD.indexOf(c[0])
      expect(mask).toBeGreaterThan(0)
      const x = ((i % COLUMNS) - p.column) * 2
      const want = [px[0]![x]!, px[0]![x + 1]!, px[1]![x]!, px[1]![x + 1]!].map((ch) => PALETTE[ch] ?? DEFAULT_COLOR)
      expect([0, 1, 2, 3].map((k) => (mask & (1 << k) ? c[1] : c[2]))).toEqual(want)
    }
  }
})
