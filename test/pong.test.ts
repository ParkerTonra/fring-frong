import { expect, test } from 'claude-code/testing'

import { FROG_DOWN, FROG_UP, ball, encodeTriplets, spriteCells, swings } from '../hooks/pong'

test('cells encode as base64 u32 triplets', () => {
  expect(encodeTriplets([[0x2588, 0xff8800, 0x01000000]])).toBe('iCUAAACI/wAAAAAB')
})

test('sprites use half blocks: two pixels per cell, mirrored on request', () => {
  const cells = spriteCells(FROG_UP)
  expect(cells.length).toBe(8 * 3)
  expect(cells[0]![0]).toBe(0x2580)
  expect(spriteCells(FROG_UP, true)[7]).toEqual(cells[0])
  expect(spriteCells(FROG_DOWN).length).toBe(cells.length)
})

test('the ball flies left to right and back, an arc above the table', () => {
  const lit = (q: number) => ball(q, 12, 3).filter((c) => c[1] === 0xfff2cc).length
  expect(ball(0, 12, 3).length).toBe(36)
  expect(lit(0)).toBeGreaterThan(0)
  expect(lit(0.5)).toBeGreaterThan(0)
  const row = (q: number) => ball(q, 12, 3).findIndex((c) => c[1] === 0xfff2cc) / 12
  expect(Math.floor(row(0.5))).toBeLessThan(Math.floor(row(0)))
  const col = (q: number) => ball(q, 12, 3).findIndex((c) => c[1] === 0xfff2cc) % 12
  expect(col(1)).toBeGreaterThan(col(0))
  expect(ball(2, 12, 3)).toEqual(ball(0, 12, 3))
})

test('the left frog swings at the ends of a rally, the right one in the middle', () => {
  expect(swings(0)).toEqual({ left: true, right: false })
  expect(swings(1)).toEqual({ left: false, right: true })
  expect(swings(0.5)).toEqual({ left: false, right: false })
  expect(swings(1.95)).toEqual({ left: true, right: false })
})
