// Pure drawing for Fring Frong: frog sprites, a braille dot canvas for the table, and the Raster cell encoding.

const BRAILLE = 0x2800
// dot bits by [x 0..1][y 0..3], y 0 at the top
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const
export const DEFAULT_COLOR = 0x01000000

export type Cell = [number, number, number]

export const BALL = 0xfff2cc
export const TABLE = 0x5a6a78
export const TONGUE = 0xe0607a
export const FLY = 0xb8b8b8
export const STAR = 0xffd84a

/**
 * A field of braille cells, `columns` x `rows` (2 x 4 dots each), drawn dot by dot; a cell takes the colour of
 * its last dot. `put` lays a whole cell (a half-block sprite cell, a letter) over the dots.
 */
export class Canvas {
  readonly bits: number[]
  readonly fg: number[]
  readonly whole: (Cell | null)[]
  constructor(readonly columns: number, readonly rows: number) {
    this.bits = new Array<number>(columns * rows).fill(0)
    this.fg = new Array<number>(columns * rows).fill(TABLE)
    this.whole = new Array<Cell | null>(columns * rows).fill(null)
  }
  dot(x: number, y: number, color: number): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 4) return
    const i = (y >> 2) * this.columns + (x >> 1)
    this.bits[i] = (this.bits[i] ?? 0) | DOT[x & 1]![y & 3]!
    this.fg[i] = color
  }
  put(column: number, row: number, cell: Cell): void {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return
    this.whole[row * this.columns + column] = cell
  }
  /** Sprite cells (width x height, row-major) with their top-left at a cell; see-through cells keep what is under. */
  sprite(cells: readonly Cell[], width: number, column: number, row: number): void {
    cells.forEach((c, i) => {
      if (c[0] !== 0x20) this.put(column + (i % width), row + Math.floor(i / width), c)
    })
  }
  table(): void {
    const y = this.rows * 4 - 1
    for (let x = 0; x < this.columns * 2; x += 3) this.dot(x, y, TABLE)
  }
  /** The ball: 2 x 2 dots with its top-left at a dot. */
  ball(x: number, y: number, color = BALL): void {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) this.dot(x + i, y + j, color)
  }
  cells(): Cell[] {
    return this.bits.map((b, i) => this.whole[i] ?? [BRAILLE + b, this.fg[i] ?? TABLE, DEFAULT_COLOR])
  }
}

/** Where the ball flies at rally position `p` (0..2: 0 the left frog's hit, 1 the right's), in dots. */
export function ballAt(p: number, columns: number, rows: number): { x: number; y: number } {
  const H = rows * 4
  const q = ((p % 2) + 2) % 2
  const u = q < 1 ? q : 2 - q // 0 at the left end .. 1 at the right
  return { x: Math.round(u * (columns * 2 - 2)), y: H - 3 - Math.round(4 * u * (1 - u) * (H - 4)) }
}

/** The rally over a `columns` x `rows` field: the ball in its arc and a dotted table along the bottom. */
export function ball(p: number, columns: number, rows: number): Cell[] {
  const c = new Canvas(columns, rows)
  c.table()
  const b = ballAt(p, columns, rows)
  c.ball(b.x, b.y)
  return c.cells()
}

/** Which frog swings at rally position `p` (0..2): the left near 0 and 2, the right near 1. */
export function swings(p: number): { left: boolean; right: boolean } {
  const q = ((p % 2) + 2) % 2
  return { left: q < 0.12 || q > 1.88, right: Math.abs(q - 1) < 0.12 }
}

/** RasterProps.cells: base64 of [codePoint, fg, bg] little-endian u32 triplets. */
export function encodeTriplets(cells: readonly (readonly [number, number, number])[]): string {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach(([c, fg, bg], i) => {
    words[i * 3] = c
    words[i * 3 + 1] = fg
    words[i * 3 + 2] = bg
  })
  return toBase64(new Uint8Array(words.buffer))
}

/** Sprite colours: letters in the pixel rows below ('.' is see-through). */
export const PALETTE: Readonly<Record<string, number>> = {
  G: 0x4e9a3a, // green
  D: 0x1d3a1a, // dark green outline, closed lids
  W: 0xf2f2f2, // eye white
  K: 0x101010, // pupil, open mouth
  R: 0x8a4a22, // mouth
  B: 0x1f4fd8, // shirt
  Y: STAR, // stars
  T: TONGUE,
}

const UPPER = 0x2580 // ▀ top half
const LOWER = 0x2584 // ▄ bottom half

/** Quadrant glyph by mask: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right (the foreground's pixels). */
export const QUAD: readonly number[] = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588,
]

/**
 * Pixel rows (an even count, an even width) to quadrant cells, four pixels per cell: each pixel half a cell wide and
 * half a cell tall. A cell still has only two colours, its foreground (the first opaque pixel's) and its background
 * (the other one, or the terminal's default where a pixel is see-through), so a sprite drawn this way keeps each of
 * its 2 x 2 blocks to two colours (see-through counting as one); a third would show as the background.
 * Row-major, (width / 2) x (rows / 2) cells.
 */
export function quadCells(pixels: readonly string[], mirror = false): Cell[] {
  const rows = pixels.map((r) => (mirror ? [...r].reverse().join('') : r))
  const out: Cell[] = []
  for (let y = 0; y + 1 < rows.length; y += 2)
    for (let x = 0; x + 1 < rows[y]!.length; x += 2) {
      const px = [rows[y]![x]!, rows[y]![x + 1]!, rows[y + 1]![x]!, rows[y + 1]![x + 1]!].map((ch) => PALETTE[ch])
      const fg = px.find((c) => c !== undefined)
      if (fg === undefined) {
        out.push([0x20, DEFAULT_COLOR, DEFAULT_COLOR])
        continue
      }
      const bg = px.find((c) => c !== fg)
      const mask = px.reduce((m: number, c, i) => (c === fg ? m | (1 << i) : m), 0)
      out.push([QUAD[mask]!, fg, bg ?? DEFAULT_COLOR])
    }
  return out
}

/**
 * Pixel rows (equal length, an even count) to terminal cells, two pixels per cell using half blocks:
 * a cell shows the pixel above in its foreground and the one below in its background.
 * Row-major, (width) x (rows / 2) cells.
 */
export function spriteCells(pixels: readonly string[], mirror = false): Cell[] {
  const rows = pixels.map((r) => (mirror ? [...r].reverse().join('') : r))
  const out: Cell[] = []
  for (let y = 0; y + 1 < rows.length; y += 2) {
    const top = rows[y]!, bottom = rows[y + 1]!
    for (let x = 0; x < top.length; x++) {
      const t = PALETTE[top[x]!], b = PALETTE[bottom[x]!]
      if (t !== undefined && b !== undefined) out.push([UPPER, t, b])
      else if (t !== undefined) out.push([UPPER, t, DEFAULT_COLOR])
      else if (b !== undefined) out.push([LOWER, b, DEFAULT_COLOR])
      else out.push([0x20, DEFAULT_COLOR, DEFAULT_COLOR])
    }
  }
  return out
}

/** Letters over sprite cells (one per cell, ' ' leaves the cell), the row of cells from the top. */
export function letters(cells: readonly Cell[], width: number, row: number, text: string, color: number): Cell[] {
  const out = cells.map((c) => [...c] as Cell)
  ;[...text].forEach((ch, x) => {
    if (ch !== ' ' && x < width) out[row * width + x] = [ch.codePointAt(0)!, color, DEFAULT_COLOR]
  })
  return out
}

/** A sprite moved up by one pixel (a hop), the bottom row left empty. */
export const hopped = (pixels: readonly string[]): string[] => [...pixels.slice(1), '.'.repeat(pixels[0]!.length)]
/** A sprite upside down (flipped over). */
export const flipped = (pixels: readonly string[]): string[] => [...pixels].reverse()
/** A row of stars `width` pixels wide; `phase` 0 or 1 swaps them. */
export const stars = (width: number, phase: number): string =>
  (phase % 2 === 0 ? 'Y..Y...Y' : '.Y...Y..').repeat(Math.ceil(width / 8)).slice(0, width)
/** Stars twinkling in a sprite's top pixel row, as wide as the sprite. */
export const starred = (pixels: readonly string[], phase: number): string[] => [stars(pixels[0]!.length, phase), ...pixels.slice(1)]
/** Stars twinkling over a sprite's head: a star row and a clear row on top, one cell row taller. */
export const starsAbove = (pixels: readonly string[], phase: number): string[] => {
  const w = pixels[0]!.length
  return [stars(w, phase), '.'.repeat(w), ...pixels]
}

/** The frog, arms up (swinging) and arms down. 8 x 6 pixels = 8 x 3 cells. */
export const FROG_UP: readonly string[] = [
  'G......G',
  'GDGGGGDG',
  '.GWKGWK.',
  '.GGGGGG.',
  '.GRRRRG.',
  '..BBBB..',
]
export const FROG_DOWN: readonly string[] = [
  '........',
  '.DGGGGD.',
  'GGWKGWKG',
  'GGGGGGGG',
  '.GRRRRG.',
  '.BBBBBB.',
]
/** Turned to the person: big round eyes looking out of the screen. */
export const FROG_FACE: readonly string[] = [
  '........',
  '.DGGGGD.',
  'GWWGGWWG',
  'GKKGGKKG',
  '.GRRRRG.',
  '.BBBBBB.',
]
/** FROG_FACE with one foot out: tap, tap. */
export const FROG_TAP: readonly string[] = [...FROG_FACE.slice(0, 5), '.BBBBBBG']
/** Palms up at the shoulders, mouth flat: a shrug. */
export const FROG_SHRUG: readonly string[] = [
  '........',
  'G.DGGD.G',
  'GGWKGWKG',
  '.GGGGGG.',
  '.GGRRGG.',
  '.BBBBBB.',
]
/** Eyes shut, mouth wide open. */
export const FROG_YAWN: readonly string[] = [
  '........',
  '.DGGGGD.',
  'GGDDGDDG',
  'GGGGGGGG',
  '.GRKKRG.',
  '.BBKKBB.',
]
/** Lying down asleep: the top cell row is left for the z's. */
export const FROG_SLEEP: readonly string[] = [
  '........',
  '........',
  '........',
  '.DGGGGGD',
  'GDDGGDDG',
  'GBBBRRGG',
]
/** Squished flat (compaction). */
export const FROG_FLAT: readonly string[] = [
  '........',
  '........',
  '........',
  '........',
  'GWKGGWKG',
  'BBGRRGBB',
]
/** Tongue out to the side (the fly). */
export const FROG_TONGUE: readonly string[] = [
  '........',
  '.DGGGGD.',
  'GGWKGWKG',
  'GGGGGGGG',
  '.GRRRTTT',
  '.BBBBBB.',
]
/** A small frog for the table (the bonk): 4 x 4 pixels = 4 x 2 cells. */
export const FROGLET: readonly string[] = [
  '.DD.',
  'WKWK',
  'GRRG',
  'BBBB',
]

export const EMPTY: readonly string[] = ['........', '........', '........', '........', '........', '........']

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }
  return out
}
