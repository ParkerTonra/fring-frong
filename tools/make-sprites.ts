// Makes hooks/sprites.ts from the terminal's own frogs (hooks/pong.ts, and now-playing's sad frog): every original
// pixel scaled up to a k x k block (k = 2 and 3), then lightly refined: a dark outline around the silhouette, one
// highlight and one shade on the green, a catchlight in each pupil, the outer corners of the blocks rounded at 3x.
// Nothing else is added, so the desktop frogs stay the terminal's frogs.
//   deno run --allow-read --allow-write tools/make-sprites.ts
import * as P from '../hooks/pong.ts'

// now-playing's FROG_SAD (mods/now-playing/hooks/scope.ts), copied so this file reads one mod only
const FROG_SAD = ['........', '.DGGGGD.', 'GDDGGDDG', 'GGWKGWKG', '.GGRRGG.', '.BRGGRB.']
// the terminal's fan (show.ts FAN), quadrant pixels half a cell wide and half a cell tall: each row doubled here so
// the pixels are square (2 x 2 view units)
const FAN = {
  left: ['KGGGKG', 'GGRRGG'],
  right: ['GKGGGK', 'GGRRGG'],
  cheer: ['GYGGYG', 'GGKKGG'],
}

type Grid = string[][]
const T = '.'
const BODY = new Set(['G', 'L', 'S'])

function refine(base: readonly string[], k: number, eyesOnTop = false): string[] {
  const h0 = base.length, w0 = base[0]!.length
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w0 || y >= h0 ? T : base[y]![x]!)
  const W = w0 * k + 2, H = h0 * k + 2
  const g: Grid = Array.from({ length: H }, () => Array(W).fill(T))
  // 1. each original pixel a k x k block (the dark green 'D' is the outline colour)
  for (let y = 0; y < h0; y++)
    for (let x = 0; x < w0; x++) {
      const c = at(x, y)
      if (c === T) continue
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) g[1 + y * k + j]![1 + x * k + i] = c === 'D' ? 'O' : c
    }
  // 2. at 3x, a block's outer corner pixel goes where the block meets open space on both sides and the diagonal
  if (k >= 3)
    for (let y = 0; y < h0; y++)
      for (let x = 0; x < w0; x++) {
        if (at(x, y) === T) continue
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
          if (at(x + dx, y) === T && at(x, y + dy) === T && at(x + dx, y + dy) === T)
            g[1 + y * k + (dy < 0 ? 0 : k - 1)]![1 + x * k + (dx < 0 ? 0 : k - 1)] = T
      }
  const open = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || g[y]![x] === T
  // 3. the green lit from above: a highlight along its top and left edges, a shade along its bottom and right
  const shade = g.map((r) => [...r])
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y]![x] !== 'G') continue
      if (open(x, y - 1)) shade[y]![x] = 'L'
      else if (open(x, y + 1)) shade[y]![x] = 'S'
      else if (open(x - 1, y)) shade[y]![x] = 'L'
      else if (open(x + 1, y)) shade[y]![x] = 'S'
    }
  for (let y = 0; y < H; y++) g[y] = shade[y]!
  // 4. a catchlight in each pupil: the topmost pupil pixel not touching the white with pupil to its left (so it sits
  //    inside the pupil, not on its rim), the leftmost of those
  const seen = new Set<string>()
  for (let y = 0; y < h0; y++)
    for (let x = 0; x < w0; x++) {
      if (at(x, y) !== 'K' || seen.has(x + ',' + y)) continue
      const comp: [number, number][] = []
      const stack: [number, number][] = [[x, y]]
      seen.add(x + ',' + y)
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        comp.push([cx, cy])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx, ny = cy + dy
          if (at(nx, ny) === 'K' && !seen.has(nx + ',' + ny)) (seen.add(nx + ',' + ny), stack.push([nx, ny]))
        }
      }
      const isEye = comp.some(([cx, cy]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(cx + dx!, cy + dy!) === 'W')) || (eyesOnTop && comp.some(([, cy]) => cy === 0))
      if (!isEye) continue
      let best: [number, number, number[]] | null = null
      for (const [cx, cy] of comp)
        for (let j = 0; j < k; j++)
          for (let i = 0; i < k; i++) {
            const px = 1 + cx * k + i, py = 1 + cy * k + j
            if (g[py]![px] !== 'K') continue
            const nearWhite = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[py + dy!]?.[px + dx!] === 'W')
            if (nearWhite && !eyesOnTop) continue
            const inside = g[py]![px - 1] === 'K' ? 0 : 1
            const key = [inside, py, px]
            if (!best || key[0]! < best[2][0]! || (key[0] === best[2][0] && (py < best[1] || (py === best[1] && px < best[0])))) best = [px, py, key]
          }
      if (best) g[best[1]]![best[0]] = 'W'
    }
  // 5. the outline: every open pixel beside the sprite, dark blue beside the shirt alone, dark red beside the tongue alone
  const out = g.map((r) => [...r])
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y]![x] !== T) continue
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => g[y + dy!]?.[x + dx!]).filter((c) => c !== undefined && c !== T)
      if (n.length === 0) continue
      out[y]![x] = n.every((c) => c === 'B') ? 'o' : n.every((c) => c === 'T') ? 'r' : 'O'
    }
  return out.map((r) => r.join(''))
}
const tall = (rows: readonly string[]) => rows.flatMap((r) => [r, r])

const POSES = {
  down: P.FROG_DOWN, up: P.FROG_UP, face: P.FROG_FACE, tap: P.FROG_TAP, shrug: P.FROG_SHRUG, yawn: P.FROG_YAWN,
  sleep: P.FROG_SLEEP, flat: P.FROG_FLAT, tongue: P.FROG_TONGUE, sad: FROG_SAD,
}
export const make = (k: number) => ({
  frogs: Object.fromEntries(Object.entries(POSES).map(([n, rows]) => [n, refine(rows, k)])),
  fans: Object.fromEntries(Object.entries(FAN).map(([n, rows]) => [n, refine(tall(rows), k, true)])),
  froglet: refine(P.FROGLET, k),
})

const list = (rows: readonly string[], pad: string) => '[\n' + rows.map((r) => pad + "  '" + r + "',\n").join('') + pad + ']'
const set = (o: Record<string, readonly string[]>, pad: string) =>
  '{\n' + Object.entries(o).map(([n, r]) => pad + '  ' + n + ': ' + list(r, pad + '  ') + ',\n').join('') + pad + '}'

if (import.meta.main) {
  const a = make(2), b = make(3)
  const tpl = Deno.readTextFileSync(new URL('./sprites.template.txt', import.meta.url))
  const src = tpl
    .replace('/*FROGS*/', '{\n  2: ' + set(a.frogs, '  ') + ',\n  3: ' + set(b.frogs, '  ') + ',\n}')
    .replace('/*FANS*/', '{\n  2: ' + set(a.fans, '  ') + ',\n  3: ' + set(b.fans, '  ') + ',\n}')
    .replace('/*FROGLETS*/', '{\n  2: ' + list(a.froglet, '  ') + ',\n  3: ' + list(b.froglet, '  ') + ',\n}')
  Deno.writeTextFileSync(new URL('../hooks/sprites.ts', import.meta.url), src)
  console.log('wrote hooks/sprites.ts', src.length, 'chars')
}
