import { expect, test } from 'claude-code/testing'

import { FROGLET, FROG_DOWN, FROG_FACE, FROG_FLAT, FROG_SHRUG, FROG_SLEEP, FROG_TAP, FROG_TONGUE, FROG_UP, FROG_YAWN, PALETTE, spriteCells } from '../hooks/pong'
import { COLUMNS, FAN, MAX_FANS, T, agentStart, agentStop, frame, initial, limit, permissionAsked, queued, reel, toolError, turnEnd, turnStart, withScore } from '../hooks/show'
import { DESK_STYLE, HEIGHT_PX, MAX_SOURCE, VIEW_H, VIEW_W, WIDTH_PX, type Style, frameRects, svgFlipbook, svgFrame, viewH } from '../hooks/svg'
import { BALLS, DESK_SIZE, FANS, FROGLETS, FROGS, SPRITE_PALETTE, STARS, type FrogPose, fineUnit, unit } from '../hooks/sprites'

// A small XML check: every tag closes in order, attributes are quoted, nothing is left open.
function wellFormed(src: string): boolean {
  const stack: string[] = []
  const re = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"<>]*")*)\s*(\/?)>/g
  let at = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (src.slice(at, m.index).includes('<')) return false
    at = re.lastIndex
    if (m[1]) {
      if (stack.pop() !== m[2]) return false
    } else if (!m[4]) stack.push(m[2]!)
  }
  return stack.length === 0 && at === src.length && !src.slice(at).includes('<')
}

test('drawn as cells, a still frame is one well-formed SVG of crisp pixel rects in the frogs\' palette', () => {
  const f = frame(turnStart(initial(), 0), 100)
  const svg = svgFrame(f, 'cells')
  expect(wellFormed(svg)).toBe(true)
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VIEW_W + ' ' + viewH('cells') + '"')).toBe(true)
  expect(svg.includes('shape-rendering="crispEdges"')).toBe(true)
  expect(svg.includes('height="30"')).toBe(true)
  for (const c of ['G', 'D', 'W', 'K', 'B']) expect(svg.includes('#' + PALETTE[c]!.toString(16).padStart(6, '0'))).toBe(true)
  // the left frog's eye white (FROG_DOWN row 2, column 2): a 4 x 4 unit pixel rect at (8, 8)
  expect(svg).toMatch(/fill="#f2f2f2" d="[^"]*M8 8h4v4h-4z/)
})

test('the frog rects follow the sprite pixel for pixel', () => {
  const f = { left: spriteCells(FROG_DOWN), table: frame(initial(), 0).table, right: spriteCells(FROG_DOWN, true) }
  const rects = frameRects(f, 'cells').filter((r) => r.x < 32)
  const lit = FROG_DOWN.join('').replace(/\./g, '').length
  expect(rects.length).toBe(lit)
  expect(rects.every((r) => r.w === 4 && r.h === 4)).toBe(true)
})

test('a reel is a well-formed flipbook under the size limit: a rally loops, a bonk plays once', () => {
  expect(DESK_STYLE).toBe(DESK_SIZE) // the desktop draws the detailed sprites
  const rally = reel(turnStart(initial(), 0), 100)
  expect(rally.loop).toBe(true)
  const a = svgFlipbook(rally.frames, rally.loop)
  expect(wellFormed(a)).toBe(true)
  expect(a.length).toBeLessThan(MAX_SOURCE)
  expect(a.includes('<animate attributeName="visibility" calcMode="discrete"')).toBe(true)
  const s = queued(turnStart(initial(), 0), 100)
  const bonk = reel(s, 100 + T.dash + 100)
  expect(bonk.loop).toBe(false)
  const b = svgFlipbook(bonk.frames, bonk.loop)
  expect(wellFormed(b)).toBe(true)
  expect(b.includes('fill="freeze"')).toBe(true)
  expect(b.includes('#ffd84a')).toBe(true) // the stars
  const asleep = reel(limit(turnStart(initial(), 0), 500), 500 + T.roll * 2)
  expect(wellFormed(svgFlipbook(asleep.frames))).toBe(true)
  expect(asleep.frames.length).toBeGreaterThan(1)
})

// ---- the desktop sprites (sprites.ts) ----

const SIZES = [2, 3] as const
const fanned = (n: number, at = 0) => {
  let s = turnStart(initial(), 0)
  for (let i = 0; i < n; i++) s = agentStart(s, 'a' + i, at)
  return s
}
const FROG_SAD = ['........', '.DGGGGD.', 'GDDGGDDG', 'GGWKGWKG', '.GGRRGG.', '.BRGGRB.'] // now-playing's
const ORIGINALS: Record<FrogPose, readonly string[]> = {
  down: FROG_DOWN, up: FROG_UP, face: FROG_FACE, tap: FROG_TAP, shrug: FROG_SHRUG, yawn: FROG_YAWN, sleep: FROG_SLEEP,
  flat: FROG_FLAT, tongue: FROG_TONGUE, sad: FROG_SAD,
}
// a desktop colour back to the terminal's: the greens are green, the outline the dark green (or see-through, see below)
const CLASS: Record<string, string> = { G: 'G', L: 'G', S: 'G', O: 'D', W: 'W', K: 'K', R: 'R', B: 'B', T: 'T', Y: 'Y', o: '.', r: '.', '.': '.' }
/** Each k x k block inside the outline, read back as its most common terminal colour. */
function downscale(rows: readonly string[], k: number): string[] {
  const h = (rows.length - 2) / k, w = (rows[0]!.length - 2) / k
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const n = new Map<string, number>()
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
        const c = CLASS[rows[1 + y * k + j]![1 + x * k + i]!]!
        n.set(c, (n.get(c) ?? 0) + 1)
      }
      if (n.size === 1 && n.has('D')) return 'D' // a whole block of the dark green
      n.delete('D') // else outline round the sprite: see-through in the original
      return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '.'
    }).join(''),
  )
}

/** The read-back matches the original; a see-through notch the outline filled whole (beside the sprite) reads as outline. */
function matches(back: readonly string[], orig: readonly string[]): boolean {
  const at = (x: number, y: number) => orig[y]?.[x] ?? '.'
  return orig.every((row, y) =>
    [...row].every((c, x) => back[y]![x] === c || (c === '.' && back[y]![x] === 'D' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx!, y + dy!) !== '.'))),
  )
}

test('every desktop frog is its terminal original scaled up: each k x k block reads back as the original pixel', () => {
  for (const size of SIZES) {
    for (const [pose, orig] of Object.entries(ORIGINALS)) {
      const rows = FROGS[size][pose as FrogPose]
      expect(rows.length).toBe(orig.length * size + 2) // one outline pixel round it
      expect(rows.every((r) => r.length === orig[0]!.length * size + 2)).toBe(true)
      expect(matches(downscale(rows, size), orig)).toBe(true)
    }
    expect(matches(downscale(FROGLETS[size], size), FROGLET)).toBe(true)
    for (const look of ['left', 'right', 'cheer'] as const) expect(matches(downscale(FANS[size][look], size), FAN[look].flatMap((r) => [r, r]))).toBe(true)
  }
})

test('the refinement adds nothing new: the frogs\' palette, an outline, shaded green and a catchlight in each eye', () => {
  for (const size of SIZES) {
    for (const [pose, rows] of Object.entries(FROGS[size])) {
      const px = rows.join('')
      for (const ch of px) if (ch !== '.') expect(SPRITE_PALETTE[ch]).not.toBe(undefined)
      expect(px.includes('O')).toBe(true) // outlined
      expect(px.includes('L') && px.includes('S')).toBe(true) // one highlight, one shade
      const eyes = ORIGINALS[pose as FrogPose].join('').includes('W')
      if (eyes) expect(rows.some((r, y) => [...r].some((c, x) => c === 'W' && rows[y]![x - 1] === 'K'))).toBe(true) // a catchlight in a pupil
    }
    for (const rows of Object.values(FANS[size])) expect(rows[0]!.length).toBe(6 * size + 2) // 12 units and the outline
    expect(BALLS[size].length * fineUnit(size)).toBe(4)
    expect(STARS[size][0].length).toBe(STARS[size][1].length)
  }
})

test('the frogs are drawn as their named sprites, mirrored for the right one, the band 252 x 48 px', () => {
  expect(VIEW_H).toBe(32)
  expect(HEIGHT_PX).toBe(48)
  expect(WIDTH_PX).toBe(252)
  for (const size of SIZES) {
    const f = frame(turnStart(initial(), 0), 100)
    const rects = frameRects(f, size)
    const left = rects.filter((r) => r.x < 34)
    const lit = FROGS[size][f.look!.left!.pose].join('').replace(/\./g, '').length
    expect(left.length).toBe(lit)
    expect(left.every((r) => r.w === unit(size))).toBe(true)
    expect(Math.max(...left.map((r) => r.y + r.h))).toBe(32) // standing on the band's bottom
    const right = rects.filter((r) => r.x >= VIEW_W - 34)
    expect(right.length).toBe(FROGS[size][f.look!.right!.pose].join('').replace(/\./g, '').length)
  }
})

test('a reel at either scale, in every scene and with a full crowd, is a well-formed flipbook under the size limit', () => {
  const sc = { left: 12, right: 34 }
  const w = turnStart(initial(), 0)
  const crowd = fanned(MAX_FANS + 3, 0)
  const scenes = [
    reel(w, 100, sc),
    reel(crowd, T.arrive + 10, sc),
    reel(fanned(MAX_FANS + 3, 100), 100, sc), // all arriving at once
    reel(agentStop(crowd, 'a1', 1000), 1000, sc), // one hopping off
    reel(queued(crowd, 1000), 1000 + T.dash + 100, sc),
    reel(toolError(crowd, 1000), 1000 + T.beanFly, sc),
    reel(limit(crowd, 1000), 1000 + T.roll, sc),
    reel(permissionAsked(crowd, 1000), 1010, sc),
    reel(turnEnd({ ...crowd, p: 1.4 }, 4000, 'answer').show, 4010, sc),
    reel({ ...crowd, flyAt: 1000, flySide: 'left' }, 1000, sc),
  ]
  for (const size of [...SIZES, 'cells'] as Style[]) {
    for (const r of scenes) {
      const s = svgFlipbook(r.frames, r.loop, size)
      expect(wellFormed(s)).toBe(true)
      expect(s.length).toBeLessThan(MAX_SOURCE)
    }
  }
})

test('a frog that holds its pose is drawn once in a reel, not once a frame', () => {
  const r = reel(turnStart(initial(), 0), 100)
  const src = svgFlipbook(r.frames, r.loop, 3)
  const greenPaths = src.split('fill="#4e9a3a"').length - 1
  expect(r.frames.length).toBeGreaterThan(20)
  expect(greenPaths).toBeLessThan(12) // each frog: arms down and arms up, a few runs each
})

test('the sprite style draws the fans, the ball, the bonk\'s froglets and the score; the cells style the same frames', () => {
  const s = fanned(2, 0)
  const f = { ...frame(s, T.arrive + 10) }
  const scored = { ...f, table: withScore(f.table, { left: 4, right: 7 }) }
  for (const size of SIZES) {
    const rects = frameRects(scored, size)
    const onTable = rects.filter((r) => r.x >= 36 && r.x < 36 + COLUMNS * 4)
    const fanPx = FANS[size].left.join('').replace(/\./g, '').length
    expect(onTable.filter((r) => r.color === SPRITE_PALETTE.R && r.w === fineUnit(size)).length).toBeGreaterThanOrEqual(2) // the fans' mouths
    expect(onTable.length).toBeGreaterThan(fanPx * 2)
    expect(rects.some((r) => r.color === 0xfff2cc)).toBe(true) // the ball
    expect(rects.filter((r) => r.w === 1 && r.color === 0x5a6a78).length).toBeGreaterThan(5) // pixel digits
    const bonk = frame(queued(turnStart(initial(), 0), 0), T.dash + 100)
    const b = frameRects(bonk, size)
    expect(b.filter((r) => r.x < 32).length).toBe(0) // the frogs left their posts
    expect(b.some((r) => r.color === SPRITE_PALETTE.Y)).toBe(true) // stars over the froglets
  }
})
