// Fring Frong's desktop drawing, pure. Two styles behind one constant (DESK_STYLE):
// - a sprite scale (2 or 3, sprites.ts): the frogs, the ball, the bonk's froglets and Claude's fans as the terminal's
//   own pixel art scaled up and lightly refined, on a little ping pong table, the band 252 x 48 px; the fly, the
//   tongue, the letters and the score from the terminal's cells;
// - 'cells': the terminal's own cell grid (half-block sprites, braille dots, a few letters) as crisp pixel rects, the
//   band 30 px tall.
// A list of timed frames becomes one SVG flipbook. Each part of the band (each frog, the ball, each fan, the rest of
// the table) is its own track of groups, a group only where that part changes, and SMIL shows each group in its turn:
// a frog that holds a pose for half a rally is drawn once, not on every frame. The app animates the band itself and the
// mod redraws only when the show changes course (see register.tsx).

import { BALL, BALL_HI, DEFAULT_COLOR, FLY, QUAD, TABLE, TONGUE, type Cell } from './pong'
import { COLUMNS, FROG_COLUMNS, ROWS, type Frame } from './show'
import { BALLS, BALLS_HI, DESK_SIZE, FANS, FROGLETS, FROGS, SPRITE_PALETTE, STARS, type SpriteSize, fineUnit, unit } from './sprites'

/** How the desktop band draws: the sprites at a scale, or the terminal's cells. */
export type Style = SpriteSize | 'cells'
export const DESK_STYLE: Style = DESK_SIZE

/**
 * One view unit is a quarter of a cell's width: a braille dot is 2 x 2 units, a terminal sprite pixel 4 x 4, a cell
 * 4 x 8. CSS pixels a unit takes: 1.25 drawn as cells; 1.5 with the sprites, so a sprite pixel is whole pixels (3 at
 * 2x, 2 at 3x; a fan's or the ball's 1.5 at 2x, 1 at 3x).
 */
export const unitPx = (style: Style): number => (style === 'cells' ? 1.25 : 1.5)
export const UNIT_PX = unitPx(DESK_STYLE)
const CW = 4
const CH = 8
const GAP = 1 // cells between a frog and the table
const TABLE_X = (FROG_COLUMNS + GAP) * CW
const RIGHT_X = TABLE_X + (COLUMNS + GAP) * CW
export const VIEW_W = RIGHT_X + FROG_COLUMNS * CW
/** The band's height in view units: the cells' 3 rows, or 32 with the sprites (the frogs' 24 and room over them to hop and see stars). */
export const viewH = (style: Style): number => (style === 'cells' ? ROWS * CH : 32)
export const VIEW_H = viewH(DESK_STYLE)
/** The band's size in CSS pixels: 252 x 48 with the sprites (210 x 30 drawn as cells). */
export const WIDTH_PX = VIEW_W * UNIT_PX
export const HEIGHT_PX = VIEW_H * UNIT_PX
export const MAX_SOURCE = 131_072 // SvgProps.source

// Digits as 3 x 5 pixels, set in a 4 x 8 glyph: the score in the table's corners.
const DIGITS = [
  ['###', '#.#', '#.#', '#.#', '###'],
  ['.#.', '##.', '.#.', '.#.', '###'],
  ['###', '..#', '###', '#..', '###'],
  ['###', '..#', '.##', '..#', '###'],
  ['#.#', '#.#', '###', '..#', '..#'],
  ['###', '#..', '###', '..#', '###'],
  ['###', '#..', '###', '#.#', '###'],
  ['###', '..#', '.#.', '.#.', '.#.'],
  ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '###'],
] as const
const digit = (rows: readonly string[]): string[] => ['....', ...rows.map((r) => r + '.'), '....', '....']

// Letters the terminal draws as text, as 4 x 8 pixel glyphs (one unit each): z Z z, the wake-up '!', the bonk's
// star, the score and the fans' "+N".
const GLYPHS: Readonly<Record<number, readonly string[]>> = {
  ...Object.fromEntries(DIGITS.map((d, i) => [0x30 + i, digit(d)])),
  0x3a: ['....', '....', '.#..', '....', '....', '.#..', '....', '....'], // :
  0x7a: ['....', '....', '....', '####', '..#.', '.#..', '####', '....'], // z
  0x5a: ['....', '####', '...#', '..#.', '.#..', '#...', '####', '....'], // Z
  0x2b: ['....', '....', '.#..', '###.', '.#..', '....', '....', '....'], // +
  0x21: ['.#..', '.#..', '.#..', '.#..', '.#..', '....', '.#..', '....'], // !
  0x2736: ['....', '.#..', '###.', '.#..', '#.#.', '....', '....', '....'], // ✶
}
const UNKNOWN = ['....', '....', '.##.', '.##.', '.##.', '.##.', '....', '....']
// braille dot bits by [x 0..1][y 0..3], as pong.ts packs them
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

type Rect = { x: number; y: number; w: number; h: number; color: number }

const isBraille = (code: number) => code >= 0x2800 && code <= 0x28ff
const isBlock = (code: number) => code === 0x2580 || code === 0x2584 || QUAD.indexOf(code) > 0

function cellRects(c: Cell, x: number, y: number, out: Rect[]): void {
  const [code, fg, bg] = c
  if (code === 0x20) return
  if (code === 0x2580) {
    out.push({ x, y, w: CW, h: CH / 2, color: fg })
    if (bg !== DEFAULT_COLOR) out.push({ x, y: y + CH / 2, w: CW, h: CH / 2, color: bg })
    return
  }
  if (code === 0x2584) {
    out.push({ x, y: y + CH / 2, w: CW, h: CH / 2, color: fg })
    return
  }
  const quad = QUAD.indexOf(code)
  if (quad > 0) {
    // a quadrant cell (the fans): 2 x 2 pixels, each half a cell wide and tall, the mask's in the foreground
    for (let i = 0; i < 4; i++) {
      const color = quad & (1 << i) ? fg : bg
      if (color !== DEFAULT_COLOR) out.push({ x: x + (i % 2) * (CW / 2), y: y + Math.floor(i / 2) * (CH / 2), w: CW / 2, h: CH / 2, color })
    }
    return
  }
  if (isBraille(code)) {
    const bits = code - 0x2800
    for (let dx = 0; dx < 2; dx++)
      for (let dy = 0; dy < 4; dy++) if (bits & DOT[dx]![dy]!) out.push({ x: x + dx * 2, y: y + dy * 2, w: 2, h: 2, color: fg })
    return
  }
  const g = GLYPHS[code] ?? UNKNOWN
  g.forEach((row, gy) => [...row].forEach((p, gx) => p === '#' && out.push({ x: x + gx, y: y + gy, w: 1, h: 1, color: fg })))
}

function gridRects(cells: readonly Cell[], columns: number, ox: number, oy: number, out: Rect[], keep: (c: Cell, row: number) => boolean = () => true, lift: (row: number) => number = () => 0): void {
  cells.forEach((c, i) => {
    const row = Math.floor(i / columns)
    if (keep(c, row)) cellRects(c, ox + (i % columns) * CW, oy + row * CH - lift(row), out)
  })
}

/** A sprite's pixels as rects, `u` units each, its top-left at (x, y); mirrored left to right, or upside down. */
function spriteRects(rows: readonly string[], x: number, y: number, u: number, out: Rect[], mirror = false, upsideDown = false): void {
  const list = upsideDown ? [...rows].reverse() : rows
  list.forEach((row, j) => {
    const w = row.length
    for (let i = 0; i < w; i++) {
      const color = SPRITE_PALETTE[row[mirror ? w - 1 - i : i]!]
      if (color !== undefined) out.push({ x: x + i * u, y: y + j * u, w: u, h: u, color })
    }
  })
}

// ---- the sprite style's table and parts ----

/** The sprite style's table: a slate slab along the bottom, its top at SURFACE, two legs, a little net in the middle. */
const SURFACE = 28
const TABLE_Y = 32 - ROWS * CH // the terminal's table cells, set on the band's bottom
function boardRects(out: Rect[]): void {
  const w = COLUMNS * CW
  out.push({ x: TABLE_X, y: SURFACE, w, h: 1, color: 0x8a9aa8 })
  out.push({ x: TABLE_X, y: SURFACE + 1, w, h: 2, color: TABLE })
  for (const lx of [TABLE_X + 6, TABLE_X + w - 8]) out.push({ x: lx, y: SURFACE + 3, w: 2, h: 1, color: 0x3a4450 })
  const nx = TABLE_X + w / 2 - 1
  out.push({ x: nx, y: SURFACE - 5, w: 2, h: 1, color: 0xf4f4f4 })
  out.push({ x: nx, y: SURFACE - 4, w: 2, h: 4, color: 0xaab6c2 })
}

type Parts = Record<string, Rect[]>

/** Braille colours that are no living table top: the table's dots, the ball (both), the fly, the tongue. */
const NOT_TOP = new Set([TABLE, BALL, BALL_HI, FLY, TONGUE])
/** A cell of a living table top laid under the match (show.ts high frames): lit braille in the bottom row, its own colour. */
const isTop = (c: Cell, row: number) => row === ROWS - 1 && isBraille(c[0]) && c[0] !== 0x2800 && !NOT_TOP.has(c[1])

/**
 * The parts of one frame in a sprite style: the board (the little table) or none, a table top laid on it, each frog,
 * the ball, each fan, and the rest of the table.
 */
function spriteParts(f: Frame, size: SpriteSize): Parts {
  const u = unit(size)
  const parts: Parts = { board: [], top: [], left: [], right: [], table: [], ball: [] }
  const look = f.look
  if (!look || look.board !== false) boardRects(parts.board!)
  const letters = (c: Cell) => !isBlock(c[0]) && !isBraille(c[0]) && c[0] !== 0x20
  for (const side of ['left', 'right'] as const) {
    const ox = side === 'left' ? 0 : RIGHT_X
    const out = parts[side]!
    const l = look?.[side]
    if (!look) {
      gridRects(f[side], FROG_COLUMNS, ox, TABLE_Y, out)
      continue
    }
    if (l) {
      // the frog's feet (its outline under the shirt) on the band's bottom, one outline pixel out to each side
      const rows = FROGS[size][l.pose]
      spriteRects(rows, ox - u, 32 - rows.length * u - (l.hop ? 4 : 0), u, out, side === 'right', l.flip)
      if (l.stars !== undefined) {
        const [a, b] = STARS[size]
        ;[4, 14, 24].forEach((sx, k) => spriteRects((l.stars! + k) % 2 === 0 ? a : b, ox + sx - (a.length * u) / 2 + 2, 0, u, out))
      }
    }
    gridRects(f[side], FROG_COLUMNS, ox, 0, out, letters) // z Z z, the wake-up '!'
  }
  // the table's cells: the fly, the tongue, the score and "+N" (lifted onto the slab), the bonk's ✶; a living table
  // top's dots (lifted too: they rise from the slab); with no board, the table's cells as the terminal draws them
  const lift = (row: number) => (row === ROWS - 1 ? 32 - SURFACE : 0)
  if (!look) gridRects(f.table, COLUMNS, TABLE_X, TABLE_Y, parts.table!)
  else if (look.board === false) gridRects(f.table, COLUMNS, TABLE_X, TABLE_Y, parts.top!, (c) => c[0] !== 0x20 && !isBlock(c[0]))
  else {
    gridRects(f.table, COLUMNS, TABLE_X, TABLE_Y, parts.top!, isTop, lift)
    gridRects(
      f.table,
      COLUMNS,
      TABLE_X,
      TABLE_Y,
      parts.table!,
      (c, row) => c[0] !== 0x20 && !isBlock(c[0]) && !isTop(c, row) && !(isBraille(c[0]) && (c[0] === 0x2800 || c[1] === TABLE || c[1] === BALL || c[1] === BALL_HI)),
      lift,
    )
  }
  if (look) {
    if (look.ball) spriteRects((look.ball.hi ? BALLS_HI : BALLS)[size], TABLE_X + look.ball.x * 2, TABLE_Y + look.ball.y * 2 - 2, fineUnit(size), parts.ball!)
    for (const g of look.froglets) {
      const fx = TABLE_X + g.column * CW
      const rows = FROGLETS[size]
      spriteRects(rows, fx - u, SURFACE - rows.length * u, u, parts.table!, g.mirror) // standing on the slab
      if (g.stars !== undefined) {
        const [a, b] = STARS[size]
        ;[1, 10].forEach((sx, k) => spriteRects((g.stars! + k) % 2 === 0 ? a : b, fx + sx, 4, u, parts.table!))
      }
    }
  }
  ;(f.crowd?.fans ?? []).forEach((p, k) => {
    const out: Rect[] = []
    const rows = FANS[size][p.cheer ? 'cheer' : p.look]
    const q = fineUnit(size)
    spriteRects(rows, TABLE_X + p.column * CW - q, SURFACE - p.lift * (CH / 2) - rows.length * q, q, out) // a cell row up is half a cell here: a bob, not a leap
    parts['fan' + k] = out
  })
  return parts
}

/** The parts of one frame drawn as the terminal's cells: the frogs and the table. */
function cellParts(f: Frame): Parts {
  const parts: Parts = { left: [], table: [], right: [] }
  gridRects(f.left, FROG_COLUMNS, 0, 0, parts.left!)
  gridRects(f.table, COLUMNS, TABLE_X, 0, parts.table!)
  gridRects(f.right, FROG_COLUMNS, RIGHT_X, 0, parts.right!)
  return parts
}

const partsOf = (f: Frame, style: Style): Parts => (style === 'cells' ? cellParts(f) : spriteParts(f, style))

/** Every pixel rect of one frame, in view units. */
export function frameRects(f: Frame, style: Style = DESK_STYLE): Rect[] {
  return Object.values(partsOf(f, style)).flat()
}

const hex = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0')

/**
 * View units a style's SVG coordinates are counted in: thirds of a unit with the sprites, so a 2/3 or 4/3 unit pixel
 * (3x) lands on whole numbers and the source stays short.
 */
const grain = (style: Style): number => (style === 'cells' ? 1 : 3)

/** Runs of the same left edge and width that touch top to bottom join into one taller rect (a table top's bars). */
function stack(runs: Rect[]): Rect[] {
  runs.sort((a, b) => a.x - b.x || a.w - b.w || a.y - b.y)
  const out: Rect[] = []
  for (const r of runs) {
    const last = out[out.length - 1]
    if (last && last.x === r.x && last.w === r.w && last.y + last.h === r.y) last.h += r.h
    else out.push({ ...r })
  }
  return out
}

/**
 * One path per colour, each pixel run a rect subpath; runs of the same colour and height on a row join. `whole`: every
 * rect is on whole units (a table top's dots), so its runs also stack in columns and are written in units under one
 * scale, keeping the numbers short.
 */
function paths(rects: readonly Rect[], style: Style, whole = false): string {
  const g = whole ? 1 : grain(style)
  const n = (v: number) => Math.round(v * g * 1000) / 1000
  const byColor = new Map<number, Rect[]>()
  for (const q of rects) {
    const r = { x: n(q.x), y: n(q.y), w: n(q.w), h: n(q.h), color: q.color }
    const list = byColor.get(r.color) ?? []
    list.push(r)
    byColor.set(r.color, list)
  }
  let out = ''
  for (const [color, list] of byColor) {
    list.sort((a, b) => a.y - b.y || a.h - b.h || a.x - b.x)
    const runs: Rect[] = []
    for (const r of list) {
      const last = runs[runs.length - 1]
      if (last && last.y === r.y && last.h === r.h && last.x + last.w === r.x) last.w += r.w
      else if (!(last && last.y === r.y && last.h === r.h && r.x >= last.x && r.x + r.w <= last.x + last.w)) runs.push({ ...r })
    }
    const d = (whole ? stack(runs) : runs).map((r) => 'M' + r.x + ' ' + r.y + 'h' + r.w + 'v' + r.h + 'h-' + r.w + 'z').join('')
    out += '<path fill="' + hex(color) + '" d="' + d + '"/>'
  }
  return whole && out !== '' && grain(style) !== 1 ? '<g transform="scale(' + grain(style) + ')">' + out + '</g>' : out
}
/** A part's paths: a table top's in whole units (see paths). */
const partPaths = (key: string, rects: readonly Rect[], style: Style): string => paths(rects, style, key === 'top')

/** A frame and how long it shows, in ms. */
export type Timed = { frame: Frame; ms: number }

const head = (style: Style, body: string) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VIEW_W * grain(style) + ' ' + viewH(style) * grain(style) + '" width="' + VIEW_W * unitPx(style) + '" height="' + viewH(style) * unitPx(style) +
  '" shape-rendering="crispEdges">' + body + '</svg>'

/** The order the parts are drawn in: the board under all, the fans under the ball, the frogs on top. */
const ORDER = ['board', 'top', 'fan3', 'fan2', 'fan1', 'fan0', 'table', 'ball', 'left', 'right']
const ordered = (parts: Parts): string[] => [...ORDER.filter((k) => k in parts), ...Object.keys(parts).filter((k) => !ORDER.includes(k))]

/** One still frame as an SVG document. */
export const svgFrame = (f: Frame, style: Style = DESK_STYLE): string => {
  const parts = partsOf(f, style)
  return head(style, ordered(parts).map((k) => partPaths(k, parts[k]!, style)).join(''))
}

const same = (a: Frame, b: Frame) => a.left.length === b.left.length && JSON.stringify(a) === JSON.stringify(b)

/** Folds runs of equal frames into one, their times added. */
export function fold(frames: readonly Timed[]): Timed[] {
  const out: Timed[] = []
  for (const t of frames) {
    const last = out[out.length - 1]
    if (last && same(last.frame, t.frame)) last.ms += t.ms
    else out.push({ frame: t.frame, ms: t.ms })
  }
  return out
}

/** Every other frame dropped, its time given to the one before: for a flipbook over the size limit. */
const thin = (frames: readonly Timed[]): Timed[] =>
  frames.reduce<Timed[]>((acc, t, i) => (i % 2 === 0 ? [...acc, { ...t }] : (acc[acc.length - 1]!.ms += t.ms, acc)), [])

function book(frames: readonly Timed[], loop: boolean, style: Style): string {
  if (frames.length === 1) return svgFrame(frames[0]!.frame, style)
  const total = frames.reduce((n, t) => n + t.ms, 0)
  const k = (ms: number) => +(ms / total).toFixed(4)
  // each part's track: its drawing frame by frame, runs of the same drawing folded into one
  const tracks = new Map<string, { svg: string; from: number; to: number }[]>()
  let at = 0
  for (const t of frames) {
    const parts = partsOf(t.frame, style)
    for (const key of ordered(parts)) if (!tracks.has(key)) tracks.set(key, [])
    for (const [key, list] of tracks) {
      const svg = parts[key] ? partPaths(key, parts[key]!, style) : ''
      const last = list[list.length - 1]
      if (last && last.svg === svg && last.to === at) last.to = at + t.ms
      else list.push({ svg, from: at, to: at + t.ms })
    }
    at += t.ms
  }
  let body = ''
  for (const key of ORDER.filter((x) => tracks.has(x)).concat([...tracks.keys()].filter((x) => !ORDER.includes(x)))) {
    const runs = tracks.get(key)!
    if (runs.length === 1) {
      body += runs[0]!.svg // the same all through: drawn once, never hidden
      continue
    }
    for (const g of runs) {
      if (g.svg === '') continue // the part is not there for this stretch
      const first = g.from === 0
      const last = g.to >= total
      // discrete visibility: shown from `from` to `to` of the run; the first group shows where SMIL does not play
      const values = first ? 'visible;hidden' : last && !loop ? 'hidden;visible' : 'hidden;visible;hidden'
      const times = first ? '0;' + k(g.to) : last && !loop ? '0;' + k(g.from) : '0;' + k(g.from) + ';' + k(g.to)
      body +=
        '<g visibility="' + (first ? 'visible' : 'hidden') + '"><animate attributeName="visibility" calcMode="discrete" values="' + values +
        '" keyTimes="' + times + '" dur="' + total + 'ms" ' + (loop ? 'repeatCount="indefinite"' : 'fill="freeze"') + '/>' + g.svg + '</g>'
    }
  }
  return head(style, body)
}

/**
 * Timed frames as one SVG flipbook: played once and held on the last frame, or looped. Equal neighbours fold into
 * one; a book past SvgProps' size limit drops every other frame until it fits.
 */
export function svgFlipbook(frames: readonly Timed[], loop = false, style: Style = DESK_STYLE): string {
  let list = fold(frames)
  let out = book(list, loop, style)
  while (out.length > MAX_SOURCE && list.length > 1) {
    list = fold(thin(list))
    out = book(list, loop, style)
  }
  return out
}
