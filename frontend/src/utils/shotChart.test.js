import assert from "node:assert/strict"
import test from "node:test"

import { buildShotChart } from "./shotChart.js"

test("maps ShotChartDetail locations and makes onto the existing court coordinates", () => {
  const chart = buildShotChart([
    { GAME_EVENT_ID: 11, LOC_X: "-23", LOC_Y: "140", SHOT_MADE_FLAG: "1" },
    { GAME_EVENT_ID: 12, LOC_X: 23, LOC_Y: 140, SHOT_MADE_FLAG: 0 },
  ])

  assert.equal(chart.made, 1)
  assert.equal(chart.missed, 1)
  assert.deepEqual(chart.shots.map(({ x, y, made, key }) => ({ x, y, made, key })), [
    { x: 227, y: 192.5, made: true, key: "11" },
    { x: 273, y: 192.5, made: false, key: "12" },
  ])
})

test("keeps coincident shots distinct by their game event ids", () => {
  const chart = buildShotChart([
    { GAME_EVENT_ID: 21, LOC_X: 0, LOC_Y: 100, SHOT_MADE_FLAG: 1 },
    { GAME_EVENT_ID: 22, LOC_X: 0, LOC_Y: 100, SHOT_MADE_FLAG: 0 },
  ])

  assert.deepEqual(chart.shots.map(shot => shot.key), ["21", "22"])
  assert.equal(new Set(chart.shots.map(shot => shot.key)).size, 2)
})

test("discards missing and non-finite locations", () => {
  const chart = buildShotChart([
    { GAME_EVENT_ID: 1, LOC_X: null, LOC_Y: 100, SHOT_MADE_FLAG: 1 },
    { GAME_EVENT_ID: 2, LOC_X: "NaN", LOC_Y: 100, SHOT_MADE_FLAG: 0 },
    { GAME_EVENT_ID: 3, LOC_X: 4, LOC_Y: undefined, SHOT_MADE_FLAG: 1 },
  ])

  assert.equal(chart.shots.length, 0)
  assert.equal(chart.made, 0)
  assert.equal(chart.missed, 0)
})

test("extends the chart for deep shots and preserves locations past half court", () => {
  const chart = buildShotChart([
    { GAME_EVENT_ID: 31, LOC_X: 0, LOC_Y: 430, SHOT_MADE_FLAG: 0 },
  ])

  assert.equal(chart.shots[0].y, 482.5)
  assert.equal(chart.courtHeight, 470)
  assert.ok(chart.viewHeight > chart.shots[0].y)
})
