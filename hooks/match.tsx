// Fring Frong's stage: while Claude works (a turn, or a subagent running) the two frogs play ping pong on a band above
// the prompt, and the band goes when the match does. The terminal gets three Rasters, repainted by $.ui.blit on every
// tick. The desktop app has no Raster and no blit, so it gets one Svg flipbook (svg.ts) of the frames show.ts works out
// ahead (reel): the app plays it with SMIL, and the band redraws only when the show changes course or the reel runs out.

import type { CoreEngineInterface, RenderElement } from 'claude-code'

import { bumpReels, game, readReels, readScore, readShown, refreshAgents, sessionScore, working, writeShown } from './game'
import { encodeTriplets } from './pong'
import { COLUMNS, FROG_COLUMNS, ROWS, type Reel, course, frame, layFans, reel, setWorking, step, visible, withScore } from './show'
import { HEIGHT_PX, WIDTH_PX, svgFlipbook } from './svg'

type $ = CoreEngineInterface

const FRAME_MS = 66
/** A turn's start goes through the tick before the engine sees it, and the tick after a turn's start or end is awaited. */
export const MATCH_EAGER = true

let bandId: string | null = null
let desk: Reel | null = null // the reel the desktop band plays, while it shows one
let last = { left: '', table: '', right: '' }
let busy = false

export async function matchTick($: $): Promise<void> {
  if (busy) return
  busy = true
  try {
    const now = await $.clock.now()
    game.st = step(setWorking(game.st, working(), now), now)
    const shown = visible(game.st, now)
    if (shown !== (await readShown($))) {
      last = { left: '', table: '', right: '' }
      await writeShown($, shown)
    }
    if (shown && desk && (now >= desk.until || course(game.st, now) !== desk.course)) {
      desk = null
      await bumpReels($)
    }
    if (!shown || !bandId) return
    const f = frame(game.st, now)
    const table = layFans(withScore(f.table, game.score), f.crowd)
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

export async function matchStart($: $): Promise<void> {
  await writeShown($, false) // a reload mid-turn starts from rest; the next turn starts the match
  $.clock.every(FRAME_MS, () => void matchTick($))
  $.clock.every(1000, () => refreshAgents($)) // background agents start and end without a turn event here
}

export async function matchRender($: $, e: any, next: (e: any) => any): Promise<RenderElement> {
  await readScore($) // redraws when the score moves
  await sessionScore($, false).catch(() => game.score) // a render never writes: the next turn's point stores it
  const now = await $.clock.now()
  // The atom makes the band redraw when it comes and goes; the clock decides, so a late tick shows nothing stale.
  const shown = (await readShown($)) && visible(game.st, now)
  if (e.surface === 'desktop') {
    await readReels($)
    if (!shown || e.props.hasSurvey) {
      desk = null
      return next(e)
    }
    desk = reel(game.st, now, game.score)
    const { Box, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center">
        <Svg source={svgFlipbook(desk.frames, desk.loop)} alt="Two frogs playing ping pong" width={WIDTH_PX} height={HEIGHT_PX} isInteractive />
      </Box>
    )
  }
  if (!shown || e.props.hasSurvey || e.surface !== 'terminal') {
    bandId = null
    return next(e)
  }
  bandId = e.requestId
  const f = frame(game.st, now)
  const table = layFans(withScore(f.table, game.score), f.crowd)
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
}
