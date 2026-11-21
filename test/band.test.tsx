import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { FROG_FACE, FROG_FLAT, FROG_SHRUG, STAR, spriteCells } from '../hooks/pong'
import { COLUMNS, MAX_FANS, T } from '../hooks/show'

const BAND = {
  plugin: 'fring-frong',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: { hasSurvey: false, isCollapsed: false, bodyColumns: 80 },
} as const

type Cells = [number, number, number][]

function decode(b64: string): Cells {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const w = new Uint32Array(bytes.buffer)
  const out: Cells = []
  for (let i = 0; i + 2 < w.length; i += 3) out.push([w[i]!, w[i + 1]!, w[i + 2]!])
  return out
}
const same = (a: Cells, b: readonly (readonly number[])[]) => JSON.stringify(a) === JSON.stringify(b)
const has = (cells: Cells, code: number) => cells.some((c) => c[0] === code)

// Everything beneath the plugin answered as an engine would, a mocked clock, and a session started.
// The session's id, as $.session.id() answers it (a /clear moves it on).
const session = { id: 's1' }
async function setup($: any, on: any): Promise<MockClock> {
  const clock = mock.clock(on, { now: 10_000 })
  session.id = 's1'
  on('session.id', () => ({ value: session.id }))
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  for (const c of ['PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'StopFailure', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop'])
    on('classic.' + c, () => ({}))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return clock
}

async function band($: any): Promise<{ left: Cells; table: Cells; right: Cells; score?: string } | null> {
  const ui = await $.ui.mount(BAND)
  try {
    const get = async (key: string) => (await ui.find({ type: 'Raster', key } as any)) as any
    const l = await get('frogL')
    if (!l) return null
    const t = await get('table')
    const r = await get('frogR')
    const table = decode(t.props.cells)
    // the score by its frogs: letters (not braille) in the table's top-left corner (the user's) and top-right (Claude's)
    const text = (cells: Cells) => cells.filter((c) => c[0] < 0x2580).map((c) => String.fromCodePoint(c[0])).join('')
    const you = text(table.slice(0, 2))
    const claude = text(table.slice(COLUMNS - 2, COLUMNS))
    return { left: decode(l.props.cells), table, right: decode(r.props.cells), score: you || claude ? you + ':' + claude : undefined }
  } finally {
    await ui.unmount()
  }
}

const start = ($: any, id = 't1') => $.turn.start({ text: 'hi', turnId: id })
const end = ($: any, reason: string, id = 't1') => $.turn.complete({ turnId: id, reason, answer: '', durationMs: 1, isAborted: reason === 'aborted' })

test('the frogs take the band while a turn runs, and leave it when the turn ends', async ($, on) => {
  const clock = await setup($, on)
  expect(await band($)).toBe(null)
  await start($)
  await clock.advance(300)
  expect(await band($)).not.toBe(null)
  await end($, 'error')
  await clock.advance(100)
  expect(await band($)).toBe(null)
})

test('a subagent turn alone does not start a match', async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' } as any)
  expect(await band($)).toBe(null)
})

test('a prompt queued during a turn: both frogs dash to the middle, bonk and see stars, then the rally resumes', async ($, on) => {
  const clock = await setup($, on)
  await $.prompt.submit({ text: 'first' } as any) // no turn yet: no bonk
  await start($)
  await clock.advance(200)
  await $.prompt.submit({ text: 'and also this' } as any)
  await clock.advance(T.dash + 300)
  const b = (await band($))!
  expect(b.left.every((c) => c[0] === 0x20)).toBe(true) // left its post
  expect(has(b.table, 0x2580)).toBe(true) // the froglets on the table
  expect(has(b.table, 0x2736)).toBe(true) // ✶
  await clock.advance(T.bonk + T.back + 200)
  const after = (await band($))!
  expect(has(after.table, 0x2736)).toBe(false)
  expect(after.left.some((c) => c[0] !== 0x20)).toBe(true)
})

test('a usage limit: they fall asleep with z Z z until the next turn, then one wakes with a start', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await clock.advance(500)
  await $.classic.StopFailure({ error: 'rate_limit' } as any)
  await end($, 'error')
  await clock.advance(5000)
  const b = (await band($))! // still there after the turn: asleep
  expect(has(b.left, 'z'.codePointAt(0)!) || has(b.left, 'Z'.codePointAt(0)!)).toBe(true)
  await start($, 't2')
  await clock.advance(100)
  const w = (await band($))!
  expect(has(w.left, '!'.codePointAt(0)!)).toBe(true)
  await clock.advance(T.wake + 100)
  expect(has((await band($))!.left, '!'.codePointAt(0)!)).toBe(false)
})

test('an overloaded error is no limit: nobody sleeps', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await $.classic.StopFailure({ error: 'overloaded' } as any)
  await end($, 'error')
  await clock.advance(300)
  expect(await band($)).toBe(null)
})

test('a failed tool: the ball beans a frog, it flips over with stars, then gets back up', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await clock.advance(300)
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'x', error: 'exit 1' } as any)
  await clock.advance(T.beanFly + 300)
  const b = (await band($))!
  const stars = (c: Cells) => c.some((x) => x[1] === STAR || x[2] === STAR)
  expect(stars(b.left) || stars(b.right)).toBe(true)
  await clock.advance(T.bean + T.getUp + 100)
  const a = (await band($))!
  expect(stars(a.left) || stars(a.right)).toBe(false)
})

test('a permission prompt: both face the person, one taps its foot, until the call goes on', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as any)
  await clock.advance(100)
  const b = (await band($))!
  expect(same(b.left, spriteCells(FROG_FACE))).toBe(true)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'x', tool_response: {} } as any)
  await clock.advance(100)
  expect(same((await band($))!.left, spriteCells(FROG_FACE))).toBe(false)
})

test('an interrupted turn: the ball freezes, both shrug, then the band leaves', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await clock.advance(400)
  await end($, 'aborted')
  await clock.advance(100)
  const b = (await band($))!
  expect(same(b.left, spriteCells(FROG_SHRUG))).toBe(true)
  expect(same(b.right, spriteCells(FROG_SHRUG, true))).toBe(true)
  await clock.advance(T.shrug)
  expect(await band($)).toBe(null)
})

test('a finished turn scores a point for whoever touched the ball last, kept across turns', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await clock.advance(400) // the ball is on its way right: the left frog touched it last
  await end($, 'answer')
  await clock.advance(10)
  expect((await band($))!.score).toBe('1:0')
  await start($, 't2')
  await clock.advance(1200) // on its way back: the right frog's
  await end($, 'answer', 't2')
  await clock.advance(10)
  expect((await band($))!.score).toBe('1:1')
  await clock.advance(T.win)
  expect(await band($)).toBe(null)
})

test('compaction squishes both frogs flat, and they pop back up', async ($, on) => {
  const clock = await setup($, on)
  await $.classic.PreCompact({ trigger: 'manual', custom_instructions: null } as any)
  await clock.advance(100)
  const b = (await band($))! // shown even between turns
  expect(same(b.left, spriteCells(FROG_FLAT))).toBe(true)
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: '' } as any)
  await clock.advance(50)
  expect(same((await band($))!.left, spriteCells(FROG_FLAT))).toBe(false)
  await clock.advance(T.pop)
  expect(await band($)).toBe(null)
})

// The score by its frogs, starting over each session.
const seedScore = (on: any, value: unknown) =>
  on('state.get', (_: unknown, e: any, next: any) => (e.key === 'score' ? { value: { value, version: 1 } } : next(e)))

test('a reload in the same session keeps its score', async ($, on) => {
  seedScore(on, { left: 4, right: 7, session: 's1' })
  const clock = await setup($, on)
  await start($)
  await clock.advance(100)
  expect((await band($))!.score).toBe('4:7')
})

test('a new session starts at 0:0, whatever an earlier one stored (an old score with no session too)', async ($, on) => {
  seedScore(on, { left: 4, right: 7, session: 'earlier' })
  const clock = await setup($, on)
  await start($)
  await clock.advance(100)
  expect((await band($))!.score).toBe(undefined)
  await clock.advance(300)
  await end($, 'answer')
  await clock.advance(10)
  expect((await band($))!.score).toBe('1:0')
})

test('an old score stored without a session is not carried in', async ($, on) => {
  seedScore(on, { left: 8, right: 9 })
  const clock = await setup($, on)
  await start($)
  await clock.advance(100)
  expect((await band($))!.score).toBe(undefined)
})

test('a /clear starts the score over: no session.start comes, the session id moves on', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await clock.advance(400)
  await end($, 'answer')
  await clock.advance(10)
  expect((await band($))!.score).toBe('1:0')
  await clock.advance(T.win)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as any)
  session.id = 's2'
  await start($, 't2')
  await clock.advance(100)
  expect((await band($))!.score).toBe(undefined)
  await clock.advance(300)
  await end($, 'answer', 't2')
  await clock.advance(10)
  expect((await band($))!.score).toBe('1:0')
})

// Claude's fan club: a tiny quadrant-pixel frog per subagent running a turn.
const GREEN = 0x4e9a3a
const PUPIL = 0x101010
const MOUTH = 0x8a4a22
const quad = (code: number) => code >= 0x2596 && code <= 0x259f || code === 0x2580 || code === 0x2584 || code === 0x258c || code === 0x2590 || code === 0x2588
const fanColumns = (table: Cells) => {
  const cols = new Set<number>()
  table.forEach((c, i) => {
    if (quad(c[0]) && (c[1] === GREEN || c[2] === GREEN) && Math.floor(i / COLUMNS) >= 0) cols.add(i % COLUMNS)
  })
  return [...cols].sort((a, b) => a - b)
}
const fans = (table: Cells) => Math.round(fanColumns(table).length / 3)
const tableText = (table: Cells) => table.map((c) => (c[0] < 0x2580 && c[0] >= 0x21 ? String.fromCodePoint(c[0]) : ' ')).join('')
function agents(on: any): { list: { id: string; status: string }[] } {
  const box = { list: [] as { id: string; status: string }[] }
  on('agent.list', () => ({ value: box.list.map((a) => ({ ...a, agent_id: a.id, kind: 'local_agent', type: 'Explore', description: '', label: '', taskStatus: a.status, startTime: 0, teammate_id: '' })) }))
  return box
}

test('no subagents: no fans on the table', async ($, on) => {
  agents(on)
  const clock = await setup($, on)
  await start($)
  await clock.advance(1100)
  expect(fans((await band($))!.table)).toBe(0)
})

test('background subagents running with no turn: the match is on, a fan each, seated from Claude\'s frog leftward', async ($, on) => {
  const a = agents(on)
  const clock = await setup($, on)
  expect(await band($)).toBe(null)
  a.list = ['a1', 'a2', 'a3'].map((id) => ({ id, status: 'running' }))
  await clock.advance(1100 + T.arrive) // the list is read each second: they arrive, then sit
  const b = (await band($))!
  expect(b).not.toBe(null)
  expect(fans(b.table)).toBe(3)
  expect(Math.max(...fanColumns(b.table))).toBe(COLUMNS - 3) // clear of Claude's number in the last two columns
  expect(b.table.some((c) => quad(c[0]) && c[1] === PUPIL)).toBe(true)
  expect(b.table.some((c) => quad(c[0]) && c[2] === MOUTH)).toBe(true)
  a.list = a.list.map((x) => ({ ...x, status: 'completed' }))
  await clock.advance(1100 + T.leave)
  expect(await band($)).toBe(null) // the work is done: the band goes
})

test('a fan hops off when its agent finishes (SubagentStop, or the list saying it is done)', async ($, on) => {
  const a = agents(on)
  const clock = await setup($, on)
  a.list = [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }]
  await start($)
  await clock.advance(1100 + T.arrive)
  expect(fans((await band($))!.table)).toBe(2)
  await $.classic.SubagentStop({ agent_id: 'a2', stop_hook_active: false } as any)
  a.list = [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'completed' }]
  await clock.advance(T.leave + 200)
  expect(fans((await band($))!.table)).toBe(1)
})

test('SubagentStart seats a fan at once, before the list names it; one never listed leaves after 3 s', async ($, on) => {
  agents(on)
  const clock = await setup($, on)
  await start($)
  await clock.advance(100)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' } as any)
  await clock.advance(T.arrive + 100)
  expect(fans((await band($))!.table)).toBe(1)
  await clock.advance(3000 + 1100 + T.leave)
  expect(fans((await band($))!.table)).toBe(0)
})

test('an agent only waiting on its own background shells gets no fan', async ($, on) => {
  const a = agents(on)
  const clock = await setup($, on)
  a.list = [{ id: 'me', status: 'running' }, { id: 'old', status: 'waiting' }]
  await start($)
  await clock.advance(1100 + T.arrive)
  expect(fans((await band($))!.table)).toBe(1)
})

test('the crowd is capped at ' + MAX_FANS + ' seats, then a dim +N', async ($, on) => {
  const a = agents(on)
  const clock = await setup($, on)
  a.list = Array.from({ length: 9 }, (_, i) => ({ id: 'a' + i, status: 'running' }))
  await clock.advance(1100 + T.arrive)
  const b = (await band($))!
  expect(fans(b.table)).toBe(MAX_FANS)
  expect(tableText(b.table).includes('+' + (9 - MAX_FANS))).toBe(true)
})

test('the fans cheer (star-bright eyes) when Claude\'s frog wins a point, not when the user\'s does', async ($, on) => {
  const a = agents(on)
  const clock = await setup($, on)
  a.list = [{ id: 'a1', status: 'running' }]
  await start($)
  await clock.advance(1100 + T.arrive)
  const cheer = (t: Cells) => t.some((c) => quad(c[0]) && (c[1] === STAR || c[2] === STAR))
  expect(cheer((await band($))!.table)).toBe(false)
  await clock.advance(900) // 2600 ms into the turn: the ball on its way back from the right frog
  await end($, 'answer')
  await clock.advance(20)
  const won = (await band($))!
  expect(won.score).toBe('0:1')
  expect(cheer(won.table)).toBe(true)
  await clock.advance(T.win)
  await start($, 't2')
  await clock.advance(400)
  await end($, 'answer', 't2')
  await clock.advance(20)
  const lost = (await band($))!
  expect(lost.score).toBe('1:1')
  expect(cheer(lost.table)).toBe(false)
})

// ---- the desktop app: the same show, drawn as one Svg flipbook ----

async function desktopBand($: any): Promise<{ source: string; score?: string } | null> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  try {
    const svg = (await ui.find({ type: 'Svg' } as any)) as any
    if (!svg) return null
    // the score's digits: 1 x 1 unit pixels in the table's slate (3 x 3 in the sprite style's thirds of a unit)
    const digits = /fill="#5a6a78" d="[^"]*h(1v1h-1|3v3h-3)z/.test(svg.props.source)
    return { source: svg.props.source, score: digits ? 'shown' : undefined }
  } finally {
    await ui.unmount()
  }
}

test('on the desktop app the band is an Svg flipbook while a turn runs, and leaves when the turn ends', async ($, on) => {
  const clock = await setup($, on)
  expect(await desktopBand($)).toBe(null)
  await start($)
  await clock.advance(300)
  const b = (await desktopBand($))!
  expect(b).not.toBe(null)
  expect(b.source.startsWith('<svg')).toBe(true)
  expect(b.source.includes('#4e9a3a')).toBe(true) // frog green
  expect(b.score).toBe(undefined) // no point yet: no numbers
  expect(b.source.includes('repeatCount="indefinite"')).toBe(true) // a plain rally loops in the app itself
  await end($, 'answer')
  await clock.advance(10)
  const won = (await desktopBand($))!
  expect(won.score).toBe('shown') // the numbers in the table's corners, as pixel digits
  expect(won.source.includes('fill="freeze"')).toBe(true) // the winner's hop plays once
  await clock.advance(T.win + 100)
  expect(await desktopBand($)).toBe(null)
})

test('on the desktop app an event redraws the reel: a queued prompt brings the bonk stars', async ($, on) => {
  const clock = await setup($, on)
  await start($)
  await clock.advance(200)
  const before = (await desktopBand($))!.source
  expect(before.includes('#ffd84a')).toBe(false) // no stars in a plain rally
  await $.prompt.submit({ text: 'and also this' } as any)
  await clock.advance(T.dash + 300)
  expect((await desktopBand($))!.source.includes('#ffd84a')).toBe(true)
})

test('on the desktop app Claude\'s fans sit on the table as sprites, and the band stays under the size limit', async ($, on) => {
  const a = agents(on)
  const clock = await setup($, on)
  a.list = Array.from({ length: 6 }, (_, i) => ({ id: 'a' + i, status: 'running' }))
  await start($)
  await clock.advance(1100 + T.arrive + 100)
  const b = (await desktopBand($))!
  expect(b.source.length).toBeLessThan(131_072)
  expect(b.source.includes('repeatCount="indefinite"')).toBe(true) // settled fans: the rally still loops
})
