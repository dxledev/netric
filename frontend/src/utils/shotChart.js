const HOOP_X = 250
const HOOP_Y = 52.5

function finiteCoordinate(value) {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const coordinate = Number(value)
  return Number.isFinite(coordinate) ? coordinate : null
}

function isMade(value) {
  return value === 1 || value === "1" || value === true
}

// ShotChartDetail locations are in tenths of a foot from the basket. The chart
// keeps the existing 500 by 470 court coordinate system and centers the hoop.
export function buildShotChart(rawShots) {
  const sourceShots = Array.isArray(rawShots) ? rawShots : []
  const shots = sourceShots.flatMap((shot, index) => {
    const locX = finiteCoordinate(shot?.LOC_X)
    const locY = finiteCoordinate(shot?.LOC_Y)

    if (locX === null || locY === null) {
      return []
    }

    const rawEventId = shot?.GAME_EVENT_ID
    const key = rawEventId === null || rawEventId === undefined || rawEventId === ""
      ? `shot-${index}`
      : String(rawEventId)

    return [{
      key,
      x: Math.round((HOOP_X + locX) * 10) / 10,
      y: Math.round((HOOP_Y + locY) * 10) / 10,
      made: isMade(shot?.SHOT_MADE_FLAG),
    }]
  })

  const made = shots.reduce((count, shot) => count + Number(shot.made), 0)
  const missed = shots.length - made
  const dotRadius = shots.length > 28 ? 7.5 : 9
  const step = Math.min(70, 1000 / Math.max(shots.length, 1))
  const maxY = shots.reduce((height, shot) => Math.max(height, shot.y + dotRadius), 310)

  return {
    made,
    missed,
    dotRadius,
    courtHeight: maxY > 310 ? 470 : 310,
    viewHeight: Math.max(maxY > 310 ? 470 : 310, maxY),
    shots: shots.map((shot, index) => ({ ...shot, delay: Math.round(index * step) })),
  }
}
